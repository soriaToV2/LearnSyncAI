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
 *      Removed; the in-process BKT engine now runs in `completeTest()`.
 *
 * THIS IS ONE OF THE TWO PERMITTED MASTERY WRITERS. Paper p. 58 limits BKT
 * updates to Adaptive Flashcards and Adaptive Test Mode; `flashcards.routes.ts`
 * is the other. Games, Free Recall and Feynman read mastery and must never write
 * it. The write happens in exactly one place — `PUT /:id/complete` — via
 * `applyTestCompletion()` in `server/lib/bkt.ts`.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

// ─────────────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────────────

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
  if (err instanceof GeminiUnavailableError) {
    // 429 for spent quota, 503 for an outage. A rate limit reported as a generic
    // failure tells the student to retry at once, which cannot work.
    //
    // GeminiQuotaError extends GeminiUnavailableError, so one instanceof still
    // catches both, exactly as with the Groq pair this replaces. What moved is the
    // retry hint: Groq exposed `retryAfterSeconds` on the error itself, Gemini
    // parses Google's RetryInfo into `upstream.retryAfterMs`. Hence the /1000.
    const retryAfterMs = err.upstream?.retryAfterMs;
    if (retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    // `userMessage`, never `err.message` — see studentFacingError() in gemini.ts.
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
// Mastery — EQ(4), read-only
// ─────────────────────────────────────────────────────────────────────────────

// `latestUpdate()` moved to `server/lib/testDifficulty.ts` when the educator
// analytics needed it against a `masteryRows()` map of its own.

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/practice/space/:spaceId/mastery — EQ(4) per material
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the student has actually mastered in this space, per material and overall.
 *
 * EQ(4), paper p. 81: the arithmetic mean of per-concept probabilities over every
 * concept in the document, with an unassessed concept counting as P(L₀) = 0.10.
 *
 * Built from `masterySnapshot()` — the SAME function that picks a test's
 * difficulty tier — rather than the `v_student_material_mastery` view, for two
 * reasons. It guarantees the figure shown to the student is the exact figure the
 * generator used, which is what the paper's Difficulty Alignment check (p. 98) is
 * about. And that view double-counts: a material linked to two of the same
 * student's spaces joins twice, inflating `concept_count` (the average survives).
 *
 * `concepts_assessed` is not decoration. Without it the UI cannot tell "10%
 * because they have shown no evidence" from "10% because they genuinely know
 * very little", and rendering the prior as a measured percentage would tell a
 * student who has done nothing that they know a tenth of the lesson.
 *
 * Mastery is per (student, concept), so a material sitting in two of the
 * student's spaces reports the same number in both. That is correct — it is
 * their knowledge, not the space's.
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

  /*
   * ONE read of `bkt_mastery`, then all the arithmetic in memory.
   *
   * This loop used to call `masterySnapshot()` once per material, plus a
   * separate query for `last_updated` — `6 + N` round trips. Every one of those
   * re-fetched rows the first call already had: EQ(4) is an arithmetic mean, and
   * a per-material `byConcept` is provably the restriction of the full one to
   * that material's ids. Constant now, whatever the space holds.
   */
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
      // null, not 0.10, when nothing has been assessed — the caller must be able
      // to say "not assessed yet" rather than print the prior as a score.
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
 * What one submission did to the student's mastery — one row per concept the
 * test asked about, in the order `applyTestCompletion()` applied them.
 *
 * ⚠️ IT RIDES ON `PUT /:id/complete` ONLY, AND ITS ABSENCE IS MEANINGFUL. It is
 * present only on the request that actually flipped the status. The two
 * idempotent replay paths return the stored grading with no `mastery_changes`
 * at all, because they ran no BKT update and the before/after pair from the
 * original run was never persisted — and reconstructing it from
 * `bkt_update_logs` would make this route the audit trail's second UI reader,
 * which is precisely what `logWriteError` staying non-fatal depends on nobody
 * doing. A client must read "missing" as "no claim", never as "nothing moved".
 *
 * `[]` is a different statement: the update ran and moved nothing.
 */
interface MasteryChangeDto {
  concept_id: string;
  term: string;
  /**
   * P(L) before this test's observations.
   *
   * ⚠️ MEANINGLESS UNLESS `assessed_before`. When this test was the concept's
   * first evidence it is exactly P(L₀) = 0.10, and rendering "10% → 33%" prints
   * the engine's initialisation constant as a measurement.
   */
  before: number;
  /** P(L) after, exactly as persisted to `bkt_mastery.latent_mastery`. */
  after: number;
  /** Items in THIS test that asked about the concept. */
  observations: number;
  /** Total attempts ever, after this test — flashcard ratings included. */
  opportunity_count: number;
  assessed_before: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/practice/space/:spaceId/mastery/concepts — the same, per concept
// ─────────────────────────────────────────────────────────────────────────────

interface ConceptMasteryDto {
  concept_id: string;
  term: string;
  /**
   * Exactly P(L₀) = 0.10 when `assessed` is false — a PRIOR, not a measurement.
   * A client must not print it as a percentage in that case.
   */
  mastery: number;
  /** False when the student has no `bkt_mastery` row for this concept. */
  assessed: boolean;
  opportunity_count: number;
  last_updated: string | null;
  source_pages: number[] | null;
}

interface MaterialMasteryDetailDto {
  material_id: string;
  /**
   * Sent by the server rather than joined client-side. The obvious join target,
   * `GET /spaces/:id/materials`, filters on `parsed_status = 'completed'` while
   * this route filters on published ∩ linked — so during a re-upload a material
   * can appear here with concepts intact and no title on the other side.
   */
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
 * GET /api/practice/space/:spaceId/mastery/concepts
 *
 * Everything `/mastery` returns, plus every concept of every material in the
 * space. Owner only.
 *
 * A SEPARATE ROUTE, not a flag on `/mastery`, because Test Mode refetches that
 * one on mount and after every submission — it must not start carrying a payload
 * it discards on a hot path. One request rather than expand-on-demand because
 * the whole space is ~10 KB gzipped at realistic sizes, and a cross-material
 * "weakest concepts" list is impossible without it.
 *
 * READ-ONLY, PERMANENTLY. Paper p. 58 and the `bkt_source` enum allow exactly two
 * mastery writers — `PUT /:id/complete` here and the flashcard rating route.
 * Nothing served from this endpoint may ever write `bkt_mastery` or
 * `bkt_update_logs`.
 *
 * The path segment is the literal `concepts`, not `:materialId`, so it can never
 * swallow an id.
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

    /*
     * Sorted here, not on the client: weakest-first is what makes the list
     * actionable without a second widget, and it is the ordering
     * `testDifficulty.ts` anticipated. Unassessed always sort last regardless of
     * their 0.10 — they have no position on a scale they were never measured on.
     */
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

  if (!(await spaceMaterialIds(space)).includes(material_id)) {
    res.status(404).json({ error: 'Material not found in this study space' });
    return;
  }

  const { data: material } = await supabaseAdmin
    .from('materials')
    .select('title')
    .eq('id', material_id)
    .maybeSingle();

  /*
   * Document order, which is extraction order.
   *
   * THIS IS NOT A TODO. An earlier note here proposed re-ordering by ascending
   * `bkt_mastery.latent_mastery` once BKT existed, to "test the weakest concepts
   * first". BKT now exists and the change should NOT be made, for two reasons.
   *
   * It would achieve nothing. `allocateConcepts()` emits one question per
   * concept for every concept — there is no length cap — so ordering cannot
   * change WHICH concepts are asked about, only which format each one lands in.
   * (The lone exception is a matching-only test, where coverage is a multiple of
   * four and one to three concepts fall off the end.)
   *
   * And the sign is wrong anyway. `orderedFormats()` puts `multiple_choice`
   * first, so weakest-first would hand the least-known concepts the format with
   * the HIGHEST guess probability, P(G) = 0.25 — the least informative evidence
   * for precisely the concepts most in need of measurement.
   */
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
// PUT /api/practice/:id/complete — grade, write telemetry, update BKT mastery
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:id/complete', async (req: Request, res: Response): Promise<void> => {
  const row = await requireOwnedTest(req.params.id, req, res);
  if (!row) return;

  // Fast path for an obviously-finished test. The real guarantee is the
  // compare-and-swap below, not this read — see there.
  if (row.status === 'completed') {
    res.json({ data: buildResult(row), message: 'Practice test already submitted' });
    return;
  }

  const result = buildResult(row);
  const questions = questionsOf(row);
  const stored = row.student_answers ?? {};

  /*
   * COMPARE-AND-SWAP, not a plain update.
   *
   * `.eq('status', 'in_progress')` is what actually makes completion idempotent.
   * The status check above reads a row fetched moments earlier, so two requests
   * racing — a double-tap on Submit, or a retry after a slow response — both see
   * `in_progress` and both fall through. Before BKT that duplicated a telemetry
   * batch; now it would apply every observation twice and inflate mastery for
   * the whole test. Postgres serialises the two updates, so exactly one gets a
   * row back and the loser writes nothing.
   */
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
    // Another request completed it between our read and our write. Grading is
    // pure, so the stored result is the same one that request returned.
    res.json({ data: buildResult(row), message: 'Practice test already submitted' });
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
    // is the thing they are waiting for. A missing telemetry batch breaks the
    // `count(bkt_update_logs) == count(practice_telemetry)` reconciliation,
    // which is how the gap gets noticed.
    console.error('[Practice] Telemetry insert failed:', telemetryError.message);
  }

  /*
   * BKT. One observation per question, each with the P(G) its format implies.
   *
   * Fed from `telemetry` rather than re-derived from `questions`, so the audit
   * rows and the telemetry rows cannot disagree about what happened. A matching
   * block already contributes four rows — one per matched term — which is
   * exactly paper p. 75's "applied per matched item", so it needs no special
   * handling here.
   *
   * Runs even when the telemetry insert failed: mastery is the student's actual
   * knowledge state and outranks the audit trail's completeness.
   *
   * Awaited and inside its own try/catch. Not fire-and-forget — Express 4 does
   * not forward async rejections and there is no `unhandledRejection` handler,
   * so a detached promise that rejects would take the process down. And never
   * fatal: a BKT failure must not cost a student the score they are waiting for,
   * the same rule that governs Free Recall's feedback call.
   */
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

    /*
     * Report the movement only when the state was actually persisted.
     * `applyBktObservations()` already returns `updated: []` on a mastery write
     * failure, so this cannot claim a change that was rolled back — the explicit
     * check states the rule rather than inheriting it.
     */
    if (!bkt.masteryWriteError) {
      // The term as of GENERATION, from the same `questions_payload` every other
      // row on the results screen reads. Stale if an educator has renamed the
      // concept since — deliberately, because a second source would let two
      // blocks on one screen disagree about one concept's name.
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

  /*
   * Activity + badges. Past the compare-and-swap, so a double-submitted test
   * logs one row and awards `perfect_test` once.
   *
   * `elapsed_ms` rather than `completed_at — created_at`: it is the sum of the
   * per-question latencies already stored on each answer, so it measures time on
   * task instead of wall clock. A test opened before dinner and finished after
   * it would otherwise contribute three hours of "study". It feeds only
   * `total_study_hours`, which no screen displays.
   *
   * `score` is the server's own `correct / total` from `buildResult()` — never a
   * client-supplied figure, the same rule that keeps `is_correct` server-side.
   */
  await logActivity({
    studentId: req.user!.id,
    type: 'adaptive_test',
    spaceId: row.space_id,
    materialId: row.source_material_ids?.[0] ?? null,
    durationMs: result.elapsed_ms,
    outcome: { score: result.score },
  });

  /*
   * `buildResult()` is untouched and stays untouched: it is pure, re-runnable
   * and shared by four call sites including `GET /:id/result`, which grades a
   * PAST test and has no before/after to report. `mastery_changes` is spread on
   * at the one call site that earned it.
   */
  res.json({
    data: { ...buildResult({ ...row, status: 'completed' }), mastery_changes: masteryChanges },
    message: 'Practice test submitted',
  });
});

export default router;
