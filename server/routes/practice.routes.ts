import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
import { requireOwnedSpace, spaceMaterialIds, type SpaceOwner } from '../lib/spaceAccess';
import { GeminiUnavailableError, studentFacingError } from '../lib/gemini';
import { allocateConcepts, type QuestionFormat } from '../lib/testAllocation';
import { applyTestCompletion, bktProblems } from '../lib/bkt';
import { logActivity } from '../lib/activity';
import {
  documentMastery,
  latestUpdate,
  masteryRows,
  masterySnapshot,
  masteryTier,
  P_L0,
} from '../lib/testDifficulty';
import { generateTestQuestions, type ConceptForTest } from '../lib/testGeneration';
import { gradeAnswer } from '../lib/testGrading';
import {
  CreatePracticeTestSchema,
  SubmitAnswerSchema,
  type StoredAnswer,
  type StoredTestPayload,
  type StoredTestQuestion,
} from '../types/api';

/**
 * Adaptive Test Mode. One of the two permitted mastery writers (paper p. 58), and it writes in exactly
 * one place: `PUT /:id/complete` via applyTestCompletion().
 * Every route checks ownership and material access; `is_correct` is always computed from the stored key.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

// Gates

interface TestRow {
  id: string;
  space_id: string;
  title: string;
  source_material_ids: string[] | null;
  question_types: QuestionFormat[] | null;
  questions_payload: StoredTestPayload;
  student_answers: Record<string, StoredAnswer> | null;
  score: number | null;
  difficulty_tier: string | null;
  mastery_snapshot: number | null;
  status: 'in_progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

/** The caller's own test row, or null after a 404. Reads are scoped as tightly as writes. */
async function requireOwnedTest(
  testId: string,
  req: Request,
  res: Response
): Promise<TestRow | null> {
  const { data } = await supabaseAdmin
    .from('practice_tests')
    .select('*')
    .eq('id', testId)
    .eq('student_id', req.user!.id)
    .maybeSingle();

  if (!data) {
    res.status(404).json({ error: 'Practice test not found' });
    return null;
  }
  return data as unknown as TestRow;
}

// Serialisation

/**
 * The only function that sends a question to a browser. Allow-lists fields so nothing new can leak.
 * Do not add a second serialiser.
 */
function stripKey(q: StoredTestQuestion) {
  return {
    index: q.index,
    concept_id: q.concept_id,
    concept_term: q.concept_term,
    format: q.format,
    difficulty: q.difficulty,
    prompt: q.prompt,
    ...(q.options ? { options: q.options } : {}),
    ...(q.blockId ? { blockId: q.blockId } : {}),
  };
}

const questionsOf = (row: TestRow): StoredTestQuestion[] => row.questions_payload?.questions ?? [];

function answersOf(row: TestRow): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(row.student_answers ?? {})) {
    if (value?.answer) out[Number(key)] = value.answer;
  }
  return out;
}

function toGeneratedTest(row: TestRow) {
  return {
    id: row.id,
    title: row.title,
    space_id: row.space_id,
    material_id: row.source_material_ids?.[0] ?? '',
    formats: row.question_types ?? [],
    difficulty_tier: row.difficulty_tier ?? 'foundational',
    questions: questionsOf(row).map(stripKey),
    status: row.status,
    created_at: row.created_at,
    answers: answersOf(row),
  };
}

function toSummary(row: TestRow) {
  const questions = questionsOf(row);
  return {
    id: row.id,
    title: row.title,
    material_id: row.source_material_ids?.[0] ?? '',
    created_at: row.created_at,
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    total: questions.length,
    answered: Object.keys(row.student_answers ?? {}).length,
    formats: row.question_types ?? [],
  };
}

/** Grades stored answers against the stored key. Pure; recomputed on every read. */
function buildResult(row: TestRow) {
  const questions = questionsOf(row);
  const stored = row.student_answers ?? {};

  const results = questions.map((q) => {
    const given = stored[String(q.index)]?.answer ?? null;
    return {
      index: q.index,
      concept_id: q.concept_id,
      concept_term: q.concept_term,
      format: q.format,
      prompt: q.prompt,
      student_answer: given,
      correct_answer: q.answer,
      is_correct: gradeAnswer(q.format, q.answer, given),
      explanation: q.explanation,
    };
  });

  const correct = results.filter((r) => r.is_correct).length;

  const byConcept = new Map<string, { concept_id: string; term: string; wrong: number; asked: number }>();
  for (const r of results) {
    const entry = byConcept.get(r.concept_id) ?? {
      concept_id: r.concept_id,
      term: r.concept_term,
      wrong: 0,
      asked: 0,
    };
    entry.asked += 1;
    if (!r.is_correct) entry.wrong += 1;
    byConcept.set(r.concept_id, entry);
  }

  const { questions: _q, ...test } = toGeneratedTest(row);
  const { answers: _a, ...testMeta } = test;

  return {
    test: testMeta,
    // Divide by the total, never by the number answered, so skipping can't raise a score.
    score: results.length > 0 ? correct / results.length : 0,
    correct,
    total: results.length,
    results,
    missed_concepts: [...byConcept.values()]
      .filter((c) => c.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || a.term.localeCompare(b.term)),
    elapsed_ms: Object.values(stored).reduce((sum, a) => sum + (a?.latency_ms ?? 0), 0),
  };
}

function failGeneration(res: Response, err: unknown): void {
  if (err instanceof GeminiUnavailableError) {
    // 429 for spent quota, 503 for an outage. GeminiQuotaError extends GeminiUnavailableError.
    const retryAfterMs = err.upstream?.retryAfterMs;
    if (retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    // userMessage, never err.message.
    res.status(err.status).json({
      error: 'Question writer unavailable',
      message: studentFacingError(err),
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unknown generation error';
  console.error('[Practice] Generation failed:', message);
  res.status(502).json({
    error: 'Test generation failed',
    message: 'The questions could not be written, so nothing was saved. Please try again.',
  });
}

// GET /api/practice/space/:spaceId: the overview list

router.get('/space/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const space = await requireOwnedSpace(req.params.spaceId, req, res);
  if (!space) return;

  const { data, error } = await supabaseAdmin
    .from('practice_tests')
    .select('*')
    .eq('space_id', space.id)
    .eq('student_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to load practice tests', message: error.message });
    return;
  }

  res.json({ data: (data ?? []).map((row) => toSummary(row as unknown as TestRow)) });
});

// GET /api/practice/space/:spaceId/mastery: EQ(4) per material (read-only)

/**
 * Mastery per material and overall: EQ(4) (paper p. 81), unassessed = P(L₀).
 * Uses the same computation as test difficulty so the shown figure is the one the generator used.
 * `concepts_assessed` lets the UI avoid printing the prior as a score.
 */
router.get('/space/:spaceId/mastery', async (req: Request, res: Response): Promise<void> => {
  const space = await requireOwnedSpace(req.params.spaceId, req, res);
  if (!space) return;

  const materialIds = await spaceMaterialIds(space);

  if (materialIds.length === 0) {
    res.json({
      data: {
        overall: null,
        tier: 'foundational',
        concepts_total: 0,
        concepts_assessed: 0,
        last_updated: null,
        by_material: [],
      },
    });
    return;
  }

  const { data: conceptRows, error: conceptError } = await supabaseAdmin
    .from('concepts')
    .select('id, material_id')
    .in('material_id', materialIds);

  if (conceptError) {
    res.status(500).json({ error: 'Failed to load mastery', message: conceptError.message });
    return;
  }

  const byMaterial = new Map<string, string[]>();
  for (const row of conceptRows ?? []) {
    const id = row.material_id as string;
    const list = byMaterial.get(id);
    if (list) list.push(row.id as string);
    else byMaterial.set(id, [row.id as string]);
  }

  const allConceptIds = (conceptRows ?? []).map((c) => c.id as string);

  // One read of bkt_mastery, then the arithmetic in memory.
  const rows = await masteryRows(req.user!.id, allConceptIds);
  const byConcept = new Map<string, number>();
  for (const [conceptId, row] of rows) byConcept.set(conceptId, row.mastery);

  const overall = documentMastery(allConceptIds, byConcept);

  const perMaterial = [];
  for (const materialId of materialIds) {
    const ids = byMaterial.get(materialId) ?? [];
    if (ids.length === 0) continue;
    const mDoc = documentMastery(ids, byConcept);
    perMaterial.push({
      material_id: materialId,
      m_doc: mDoc,
      tier: masteryTier(mDoc),
      concept_count: ids.length,
      assessed_concept_count: ids.filter((id) => byConcept.has(id)).length,
    });
  }

  res.json({
    data: {
      // null, not 0.10, when nothing is assessed.
      overall: byConcept.size === 0 ? null : overall,
      tier: masteryTier(overall),
      concepts_total: allConceptIds.length,
      concepts_assessed: byConcept.size,
      last_updated: latestUpdate(rows),
      by_material: perMaterial,
    },
  });
});

/**
 * What one submission did to mastery, per concept. Present only on the request that flipped the
 * status: missing means "no claim", `[]` means "ran and moved nothing". Never reconstruct it from
 * bkt_update_logs.
 */
interface MasteryChangeDto {
  concept_id: string;
  term: string;
  /** P(L) before this test. Meaningless unless `assessed_before` (otherwise it's P(L₀)). */
  before: number;
  /** P(L) after, exactly as persisted to `bkt_mastery.latent_mastery`. */
  after: number;
  /** Items in THIS test that asked about the concept. */
  observations: number;
  /** Total attempts ever, after this test — flashcard ratings included. */
  opportunity_count: number;
  assessed_before: boolean;
}

// GET /api/practice/space/:spaceId/mastery/concepts: the same, per concept

interface ConceptMasteryDto {
  concept_id: string;
  term: string;
  /** Exactly P(L₀) when `assessed` is false; never print it as a percentage then. */
  mastery: number;
  /** False when the student has no `bkt_mastery` row for this concept. */
  assessed: boolean;
  opportunity_count: number;
  last_updated: string | null;
  source_pages: number[] | null;
}

interface MaterialMasteryDetailDto {
  material_id: string;
  /** Sent by the server: client-side joins can disagree during a re-upload. */
  title: string;
  m_doc: number;
  tier: string;
  concept_count: number;
  assessed_concept_count: number;
  last_updated: string | null;
  /** Assessed first, weakest ascending; unassessed after, alphabetically. */
  concepts: ConceptMasteryDto[];
}

/**
 * GET /api/practice/space/:spaceId/mastery/concepts: `/mastery` plus every concept in the space.
 * A separate route to keep `/mastery` (Test Mode's hot path) small. Read-only, permanently.
 */
router.get('/space/:spaceId/mastery/concepts', async (req: Request, res: Response): Promise<void> => {
  const space = await requireOwnedSpace(req.params.spaceId, req, res);
  if (!space) return;

  const materialIds = await spaceMaterialIds(space);

  if (materialIds.length === 0) {
    res.json({
      data: {
        overall: null,
        tier: 'foundational',
        concepts_total: 0,
        concepts_assessed: 0,
        last_updated: null,
        by_material: [],
      },
    });
    return;
  }

  const [{ data: materialRows }, { data: conceptRows, error: conceptError }] = await Promise.all([
    supabaseAdmin.from('materials').select('id, title').in('id', materialIds),
    supabaseAdmin
      .from('concepts')
      .select('id, material_id, term, source_pages')
      .in('material_id', materialIds)
      .order('created_at'),
  ]);

  if (conceptError) {
    res.status(500).json({ error: 'Failed to load mastery', message: conceptError.message });
    return;
  }

  const titles = new Map((materialRows ?? []).map((m) => [m.id as string, m.title as string]));

  const grouped = new Map<string, { id: string; term: string; source_pages: number[] | null }[]>();
  for (const row of conceptRows ?? []) {
    const materialId = row.material_id as string;
    const concept = {
      id: row.id as string,
      term: row.term as string,
      source_pages: (row.source_pages as number[] | null) ?? null,
    };
    const list = grouped.get(materialId);
    if (list) list.push(concept);
    else grouped.set(materialId, [concept]);
  }

  const allConceptIds = (conceptRows ?? []).map((c) => c.id as string);
  const rows = await masteryRows(req.user!.id, allConceptIds);
  const byConcept = new Map<string, number>();
  for (const [conceptId, row] of rows) byConcept.set(conceptId, row.mastery);

  const byMaterial: MaterialMasteryDetailDto[] = [];
  for (const materialId of materialIds) {
    const concepts = grouped.get(materialId) ?? [];
    if (concepts.length === 0) continue;

    const ids = concepts.map((c) => c.id);
    const idSet = new Set(ids);
    const mDoc = documentMastery(ids, byConcept);

    const detail: ConceptMasteryDto[] = concepts.map((c) => {
      const row = rows.get(c.id);
      return {
        concept_id: c.id,
        term: c.term,
        mastery: row ? row.mastery : P_L0,
        assessed: row !== undefined,
        opportunity_count: row?.opportunityCount ?? 0,
        last_updated: row?.lastUpdated ?? null,
        source_pages: c.source_pages,
      };
    });

    // Weakest assessed first; unassessed last (they have no position on the scale).
    detail.sort((a, b) => {
      if (a.assessed !== b.assessed) return a.assessed ? -1 : 1;
      if (a.assessed && a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.term.localeCompare(b.term);
    });

    byMaterial.push({
      material_id: materialId,
      title: titles.get(materialId) ?? 'Untitled lesson',
      m_doc: mDoc,
      tier: masteryTier(mDoc),
      concept_count: ids.length,
      assessed_concept_count: ids.filter((id) => byConcept.has(id)).length,
      last_updated: latestUpdate(rows, idSet),
      concepts: detail,
    });
  }

  const overall = documentMastery(allConceptIds, byConcept);

  res.json({
    data: {
      overall: byConcept.size === 0 ? null : overall,
      tier: masteryTier(overall),
      concepts_total: allConceptIds.length,
      concepts_assessed: byConcept.size,
      last_updated: latestUpdate(rows),
      by_material: byMaterial,
    },
  });
});

// POST /api/practice: generate

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePracticeTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  const { space_id, material_id, formats } = parsed.data;

  // Gate order: ownership → grade/archive → linked to this space (proves the space holds it, not just read access).
  const space = await requireOwnedSpace(space_id, req, res);
  if (!space) return;
  if (!(await rejectInaccessibleMaterials(req, res, [material_id]))) return;

  if (!(await spaceMaterialIds(space)).includes(material_id)) {
    res.status(404).json({ error: 'Material not found in this study space' });
    return;
  }

  const { data: material } = await supabaseAdmin
    .from('materials')
    .select('title')
    .eq('id', material_id)
    .maybeSingle();

  // Document order. Don't reorder weakest-first: every concept gets a question anyway, and it would
  // give the weakest concepts the highest-P(G) format.
  const { data: conceptRows, error: conceptError } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition')
    .eq('material_id', material_id)
    .order('created_at');

  if (conceptError) {
    res.status(500).json({ error: 'Failed to load concepts', message: conceptError.message });
    return;
  }

  const concepts: ConceptForTest[] = (conceptRows ?? []).map((c) => ({
    id: c.id as string,
    term: c.term as string,
    definition: c.definition as string,
  }));

  if (concepts.length === 0) {
    res.status(422).json({
      error: 'No concepts',
      message: 'This lesson has no concepts yet, so a test cannot be built from it.',
    });
    return;
  }

  // Server-authoritative length: one question per concept.
  const allocation = allocateConcepts(concepts.length, formats as QuestionFormat[]);
  if (allocation.items.length === 0) {
    res.status(422).json({
      error: 'No questions',
      message: 'None of the chosen question types fit this lesson. Try adding another type.',
    });
    return;
  }

  // Difficulty (paper p. 81). Unassessed concepts count as P(L₀).
  const { snapshot } = await masterySnapshot(req.user!.id, concepts.map((c) => c.id));
  const tier = masteryTier(snapshot);

  let generated;
  try {
    generated = await generateTestQuestions({
      concepts,
      allocation: allocation.items,
      tier,
      materialTitle: (material?.title as string) ?? 'this lesson',
    });
  } catch (err) {
    failGeneration(res, err);
    return;
  }

  const payload: StoredTestPayload = {
    version: 1,
    questions: generated.questions,
    fallback_count: generated.fallbackCount,
  };

  const { data: row, error: insertError } = await supabaseAdmin
    .from('practice_tests')
    .insert({
      space_id: space.id,
      student_id: req.user!.id,
      title: (material?.title as string) ?? 'Practice Test',
      source_material_ids: [material_id],
      question_types: allocation.items.map((i) => i.format),
      questions_payload: payload,
      student_answers: {},
      // Both stored for the Difficulty Alignment check (paper p. 98).
      difficulty_tier: tier,
      mastery_snapshot: snapshot,
      status: 'in_progress',
    })
    .select('*')
    .single();

  if (insertError || !row) {
    res.status(500).json({ error: 'Failed to save practice test', message: insertError?.message });
    return;
  }

  res.status(201).json({
    data: toGeneratedTest(row as unknown as TestRow),
    message: 'Practice test generated',
  });
});

// GET /api/practice/:id: resume

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;
  res.json({ data: toGeneratedTest(row) });
});

// GET /api/practice/:id/result: review a finished test

router.get('/:id/result', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;

  if (row.status !== 'completed') {
    res.status(409).json({
      error: 'Test not finished',
      message: 'This test has not been submitted yet.',
    });
    return;
  }

  res.json({ data: buildResult(row) });
});

// PUT /api/practice/:id/answer: record one answer

router.put('/:id/answer', async (req: Request, res: Response): Promise<void> => {
  const parsed = SubmitAnswerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  const { question_index, answer, latency_ms } = parsed.data;

  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;

  if (row.status === 'completed') {
    res.status(409).json({
      error: 'Test already submitted',
      message: 'This test has been submitted and can no longer be changed.',
    });
    return;
  }

  const questions = questionsOf(row);
  if (question_index >= questions.length) {
    res.status(400).json({ error: 'Unknown question', message: 'That question is not in this test.' });
    return;
  }

  // One UPDATE in the database, never a read-modify-write here: simultaneous saves (a matching
  // block's four) each wrote back their own copy of student_answers and the last writer won (QA
  // D21-race). The function merges this one key and adds the latency to what was stored.
  const { data: saved, error } = await supabaseAdmin.rpc('record_test_answer', {
    p_test_id: row.id,
    p_student_id: req.user!.id,
    p_index: question_index,
    p_answer: answer,
    p_latency_ms: latency_ms,
  });

  if (error) {
    res.status(500).json({ error: 'Failed to record answer', message: error.message });
    return;
  }

  // NULL: the test was completed between the check above and this write.
  if (saved !== true) {
    res.status(409).json({
      error: 'Test already submitted',
      message: 'This test has been submitted and can no longer be changed.',
    });
    return;
  }

  // No correctness until submission.
  res.json({ data: { saved: true } });
});

// PUT /api/practice/:id/complete: grade, write telemetry, update mastery

router.put('/:id/complete', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;

  // Fast path only; the compare-and-swap below is the guarantee.
  if (row.status === 'completed') {
    res.json({ data: buildResult(row), message: 'Practice test already submitted' });
    return;
  }

  const result = buildResult(row);
  const questions = questionsOf(row);
  const stored = row.student_answers ?? {};

  // Compare-and-swap on status makes completion idempotent; a race would otherwise apply every
  // BKT observation twice.
  const { data: claimed, error: updateError } = await supabaseAdmin
    .from('practice_tests')
    .update({
      status: 'completed',
      score: result.score,
      completed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('student_id', req.user!.id)
    .eq('status', 'in_progress')
    .select('id');

  if (updateError) {
    res.status(500).json({ error: 'Failed to submit test', message: updateError.message });
    return;
  }

  if (!claimed || claimed.length === 0) {
    // Another request completed it first; grading is pure, so return the stored result.
    res.json({ data: buildResult(row), message: 'Practice test already submitted' });
    return;
  }

  // Telemetry: one row per question, written once here (not per answer, which would double-count
  // revised answers). question_type is NOT NULL and selects P(G).
  const telemetry = questions.map((q) => ({
    student_id: req.user!.id,
    concept_id: q.concept_id,
    practice_test_id: row.id,
    question_type: q.format,
    question_index: q.index,
    is_correct: result.results[q.index]?.is_correct ?? false,
    latency_ms: stored[String(q.index)]?.latency_ms ?? 0,
  }));

  const { error: telemetryError } = await supabaseAdmin.from('practice_telemetry').insert(telemetry);

  if (telemetryError) {
    // Not fatal: the score is already saved.
    console.error('[Practice] Telemetry insert failed:', telemetryError.message);
  }

  // BKT: fed the same telemetry array that was inserted. Runs even if telemetry failed. Awaited in
  // its own try/catch and never fatal to the score.
  let masteryChanges: MasteryChangeDto[] | undefined;

  try {
    const bkt = await applyTestCompletion({
      studentId: req.user!.id,
      practiceTestId: row.id,
      items: telemetry.map((t) => ({
        conceptId: t.concept_id,
        questionType: t.question_type,
        isCorrect: t.is_correct,
        questionIndex: t.question_index,
      })),
    });
    for (const problem of bktProblems(bkt)) {
      console.error(`[BKT] test=${row.id} student=${req.user!.id}: ${problem}`);
    }

    // Report movement only when mastery was persisted.
    if (!bkt.masteryWriteError) {
      // The term as of generation, matching the rest of the results screen.
      const termByConcept = new Map(questions.map((q) => [q.concept_id, q.concept_term]));
      masteryChanges = bkt.updated.map((u) => ({
        concept_id: u.conceptId,
        term: termByConcept.get(u.conceptId) ?? 'This concept',
        before: u.priorBefore,
        after: u.mastery,
        observations: u.observations,
        opportunity_count: u.opportunityCount,
        assessed_before: u.assessedBefore,
      }));
    }
  } catch (err) {
    console.error(
      `[BKT] engine threw for test=${row.id} student=${req.user!.id}:`,
      err instanceof Error ? err.message : err
    );
  }

  // Activity + badges, after the CAS so a double submit logs once. Duration is summed answer
  // latency, not wall clock. Score is server-computed.
  await logActivity({
    studentId: req.user!.id,
    type: 'adaptive_test',
    spaceId: row.space_id,
    materialId: row.source_material_ids?.[0] ?? null,
    durationMs: result.elapsed_ms,
    outcome: { score: result.score },
  });

  // mastery_changes is added only here; buildResult() stays pure and shared.
  res.json({
    data: { ...buildResult({ ...row, status: 'completed' }), mastery_changes: masteryChanges },
    message: 'Practice test submitted',
  });
});

export default router;
