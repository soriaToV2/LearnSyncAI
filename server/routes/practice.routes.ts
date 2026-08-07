import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { rejectInaccessibleMaterials, publishedMaterialIds } from '../lib/materialAccess';
import { GroqUnavailableError } from '../lib/groq';
import { allocateConcepts, type QuestionFormat } from '../lib/testAllocation';
import { masterySnapshot, masteryTier } from '../lib/testDifficulty';
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
 * Adaptive Test Mode.
 *
 * Rewritten from a version that had zero callers and six defects, each of which
 * is now a rule rather than a fix:
 *
 *   1. `practice_telemetry.question_type` is NOT NULL and was never supplied, so
 *      every telemetry write silently failed and BKT never received an
 *      observation. It is written in `completeTest()` and nowhere else.
 *   2. Generation called a dead Gemini model with no try/catch, so a quota error
 *      rejected unhandled under Express 4 and hung the request. Every AI call is
 *      wrapped and mapped to `err.status`.
 *   3. There was no ownership or material-access check at all. Both gates run on
 *      every route, in the order below.
 *   4. `is_correct` came from the request body. It is now computed from the
 *      stored key, always.
 *   5. The model echoed `concept_id` UUIDs that were never validated. The model
 *      no longer sees a UUID; see `testGeneration.ts`.
 *   6. Completion fired at a pyBKT FastAPI service, which CLAUDE.md forbids.
 *      Removed; Phase 3 hangs the in-process BKT engine on the seam below.
 *
 * NO BKT HERE. This phase reads `bkt_mastery` to pick a difficulty tier and
 * writes `practice_telemetry`. It never writes `bkt_mastery` or
 * `bkt_update_logs`.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

// ─────────────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceOwner {
  id: string;
  subject: string;
  gradeLevel: number;
}

/**
 * The caller's own space, or null after the caller has already been answered.
 *
 * 404 rather than 403 throughout: a 403 confirms the id names a real space, and
 * space ids are visible in the address bar. Mirrors `loadOwnedSpace()` in
 * `studyspaces.routes.ts`, including the active/role/grade checks — a disabled
 * account must not be able to generate anything.
 */
async function requireOwnedSpace(
  spaceId: string,
  req: Request,
  res: Response
): Promise<SpaceOwner | null> {
  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('id, subject, student_id')
    .eq('id', spaceId)
    .maybeSingle();

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('grade_level, status, role')
    .eq('id', req.user!.id)
    .maybeSingle();

  if (
    !space ||
    space.student_id !== req.user!.id ||
    !profile ||
    profile.status !== 'active' ||
    profile.role !== 'student' ||
    profile.grade_level === null ||
    profile.grade_level === undefined
  ) {
    res.status(404).json({ error: 'Study space not found' });
    return null;
  }

  return { id: space.id, subject: space.subject, gradeLevel: profile.grade_level };
}

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

/**
 * A test row belonging to the caller, or null after answering 404.
 *
 * Scoped by `student_id` on reads as tightly as on writes. A practice test
 * carries its own answer key and the student's answers; an unguarded read would
 * hand both to anyone holding an id.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Serialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE ONLY FUNCTION THAT SENDS A QUESTION TO A BROWSER.
 *
 * It allow-lists fields rather than deleting `answer` and `explanation`, so a
 * field added to `StoredTestQuestion` later cannot leak by omission. The whole
 * point of storing the key server-side is undone the moment a second serialiser
 * exists — do not add one.
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

/**
 * Grades the stored answers against the stored key.
 *
 * Pure and re-runnable: the result is recomputed on every read rather than
 * cached, so a fix to the grading ladder applies to past tests too. Only `score`
 * is denormalised onto the row, for the list view.
 */
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
    // Divided by TOTAL, never by the number answered — skipping a question must
    // not be a way to raise a score.
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
  if (err instanceof GroqUnavailableError) {
    // 429 for a rate limit, 503 for an outage. A rate limit reported as a
    // generic failure tells the student to retry at once, which cannot work.
    if (err.retryAfterSeconds) res.setHeader('Retry-After', String(Math.ceil(err.retryAfterSeconds)));
    res.status(err.status).json({ error: 'Question writer unavailable', message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unknown generation error';
  console.error('[Practice] Generation failed:', message);
  res.status(502).json({
    error: 'Test generation failed',
    message: 'The questions could not be written, so nothing was saved. Please try again.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/practice/space/:spaceId — the overview list
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/practice — generate
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePracticeTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  const { space_id, material_id, formats } = parsed.data;

  // Gate order, copied from the deck generator: ownership, then grade/archive,
  // then space membership. The last is not redundant — passing the grade rule
  // only proves the student may READ the material, not that this space holds it,
  // and a test generated from another subject would corrupt the space's picture.
  const space = await requireOwnedSpace(space_id, req, res);
  if (!space) return;
  if (!(await rejectInaccessibleMaterials(req, res, [material_id]))) return;

  const published = await publishedMaterialIds(space.subject, space.gradeLevel);
  const { data: linked } = await supabaseAdmin
    .from('study_space_materials')
    .select('material_id')
    .eq('space_id', space.id);
  const linkedIds = (linked ?? []).map((r) => r.material_id as string);

  if (!published.includes(material_id) || !linkedIds.includes(material_id)) {
    res.status(404).json({ error: 'Material not found in this study space' });
    return;
  }

  const { data: material } = await supabaseAdmin
    .from('materials')
    .select('title')
    .eq('id', material_id)
    .maybeSingle();

  // Document order, which is extraction order. Phase 3's seam: replace this
  // ordering with ascending `bkt_mastery.latent_mastery` to test the weakest
  // concepts first once there is a mastery signal to sort by.
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

  // Difficulty, paper p. 81. Every concept without a bkt_mastery row counts as
  // P(L0) = 0.10, so until Phase 3 this is 0.10 / foundational for everyone —
  // correct, not broken.
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
      // Both stored because the paper's Difficulty Alignment check (p. 98)
      // verifies that the mastery parameter reached the prompt, and it cannot
      // be run against data that was never written.
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/practice/:id — resume
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;
  res.json({ data: toGeneratedTest(row) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/practice/:id/result — review a finished test
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/practice/:id/answer — record one answer
// ─────────────────────────────────────────────────────────────────────────────

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

  // Read-modify-write on a JSONB column. Safe here because the client sends one
  // answer at a time per test and a lost write is recoverable — the client keeps
  // its own copy and re-sends everything before completing.
  const merged: Record<string, StoredAnswer> = { ...(row.student_answers ?? {}) };
  const previous = merged[String(question_index)]?.latency_ms ?? 0;
  merged[String(question_index)] = { answer, latency_ms: previous + latency_ms };

  const { error } = await supabaseAdmin
    .from('practice_tests')
    .update({ student_answers: merged })
    .eq('id', row.id)
    .eq('student_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Failed to record answer', message: error.message });
    return;
  }

  // Deliberately does NOT return correctness. Nothing is graded until the test
  // is submitted, and telling the client would also tell the student.
  res.json({ data: { saved: true } });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/practice/:id/complete — grade and write telemetry
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:id/complete', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;

  // Idempotent: a retried request must not write a second set of telemetry rows,
  // which would double every BKT observation the test produces.
  if (row.status === 'completed') {
    res.json({ data: buildResult(row), message: 'Practice test already submitted' });
    return;
  }

  const result = buildResult(row);
  const questions = questionsOf(row);
  const stored = row.student_answers ?? {};

  const { error: updateError } = await supabaseAdmin
    .from('practice_tests')
    .update({
      status: 'completed',
      score: result.score,
      completed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('student_id', req.user!.id);

  if (updateError) {
    res.status(500).json({ error: 'Failed to submit test', message: updateError.message });
    return;
  }

  /*
   * Telemetry: one row per question, written ONCE, here.
   *
   * Not per answer, despite paper p. 80's "during active testing". The student
   * can jump back and change an answer, so a per-answer write would produce two
   * rows for one question — two BKT observations for one piece of evidence — and
   * a real-time BKT update cannot be un-applied when the answer changes. Writing
   * from the final answers keeps what the paper actually requires ("graded as a
   * binary value ... on a per-question basis", each with its own P(G)) while
   * staying coherent with a test you can revise.
   *
   * `question_type` is the column whose omission broke this endpoint since
   * migration 0011 made it NOT NULL. It selects the P(G) for the observation, so
   * a missing value is not a reporting gap — it is an ungradeable row.
   */
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
    // Loud, but not fatal: the student's score is already saved and showing it
    // is the thing they are waiting for. A missing telemetry batch costs BKT an
    // observation, which Phase 3 can detect by comparing row counts.
    console.error('[Practice] Telemetry insert failed:', telemetryError.message);
  }

  // PHASE 3 SEAM. The in-process BKT engine runs here, over `telemetry`, using
  // the per-format P(G) from `bkt_parameters` and writing `bkt_mastery` plus
  // `bkt_update_logs`. It must NOT be an HTTP call to the pyBKT service that
  // used to sit here — CLAUDE.md and ARCHITECTURE.md both forbid pyBKT.

  res.json({ data: buildResult({ ...row, status: 'completed' }), message: 'Practice test submitted' });
});

export default router;
