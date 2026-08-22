import { Router, type Request, type Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { requireOwnedMaterial, rosterFor } from '../lib/educatorScope';
import { requireOwnedSpace, spaceMaterialIds } from '../lib/spaceAccess';
import { accessibleMaterialIds } from '../lib/materialAccess';
import { GeminiUnavailableError } from '../lib/gemini';
import {
  AssessmentGenerationError,
  generateAssessment,
  type ConceptForAssessment,
} from '../lib/assessmentGeneration';
import { gatePhaseOf } from '../lib/assessmentGate';
import {
  ASSESSMENT_MIN_ITEMS,
  ReleaseAssessmentSchema,
  StartAssessmentAttemptSchema,
  SubmitAssessmentAnswerSchema,
  type AssessmentPhaseValue,
  type StoredAssessmentItem,
  type StoredAssessmentPayload,
} from '../types/api';

/**
 * Pre-test / post-test — TEMPORARY research instrument (migration 0024).
 *
 * Removed after the school study. It serves paper RQ4 (p. 55) and nothing else:
 * no route here writes `bkt_mastery`, `bkt_update_logs`, `practice_telemetry` or
 * `activity_logs`. A pre-test that moved mastery would corrupt the baseline it
 * exists to measure, and paper p. 58 limits mastery writers to Adaptive
 * Flashcards and Adaptive Test Mode regardless.
 *
 * ⚠️ EVERY ROUTE CARRIES ITS OWN `requireRole`, and that is not stylistic. This
 * router mounts `authenticate` alone at the top (the `materials.routes.ts`
 * precedent, because it serves both educators and students), and `requireRole`
 * is THE ONLY MIDDLEWARE THAT READS `profiles` — so it is also the only thing
 * enforcing the disabled-account check and the first-login activation gate. Four
 * routes elsewhere in this codebase were holes for exactly this reason. A route
 * added below without a `requireRole` is a fifth.
 *
 * ⚠️ THE ANSWER KEY LIVES ON THE ASSESSMENT ROW, NOT PER STUDENT.
 * `stripAssessmentKey()` below is the only function permitted to serialise an
 * item toward a browser. It is a second serialiser in a codebase whose rule is
 * "`stripKey()` is the only one" — the rule is not broken, because `stripKey()`
 * remains the sole serialiser for `StoredTestQuestion` and this one never touches
 * that type. Do not merge them, and do not add a third.
 */

const router = Router();
router.use(authenticate);

interface AssessmentRow {
  id: string;
  material_id: string;
  created_by: string;
  items: StoredAssessmentPayload;
  item_count: number;
  pre_released_at: string | null;
  post_released_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AttemptRow {
  id: string;
  assessment_id: string;
  student_id: string;
  phase: AssessmentPhaseValue;
  answers: Record<string, { answer: string; latency_ms: number }> | null;
  score: number | null;
  correct_count: number | null;
  status: 'in_progress' | 'completed';
  started_at: string;
  completed_at: string | null;
}

const itemsOf = (row: AssessmentRow): StoredAssessmentItem[] => row.items?.items ?? [];

// ─────────────────────────────────────────────────────────────────────────────
// Serialisation — the answer key never leaves this file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE ONLY FUNCTION THAT SENDS AN ITEM TO A BROWSER.
 *
 * Allow-lists fields rather than deleting `answer`, so a field added to
 * `StoredAssessmentItem` later cannot leak by omission — the same doctrine as
 * `stripKey()` in `practice.routes.ts`.
 *
 * ⚠️ IT TAKES THE PHASE, AND THAT PARAMETER IS LOAD-BEARING TWICE OVER.
 *
 * Both wordings sit on one item, so a phase-blind serialiser would show a student
 * every post-test question WHILE THEY SIT THE PRE-TEST — handing over the whole
 * test they have not taken yet. `post_stem` is answer-key material during the pre
 * phase just as surely as `answer` is.
 *
 * And the option ORDER differs per phase by design (different shuffle seeds), so
 * emitting the wrong array would grade correctly but let a student who noted
 * "the answer was C" carry that across.
 */
function stripAssessmentKey(item: StoredAssessmentItem, phase: AssessmentPhaseValue) {
  return {
    index: item.index,
    prompt: phase === 'pre' ? item.pre_stem : item.post_stem,
    options: phase === 'pre' ? item.options_pre : item.options_post,
  };
}

/** Normalised comparison. The student picks from four literal strings the server
 *  wrote, so there is nothing to be lenient about — deliberately NOT
 *  `testGrading.ts`'s alias ladder, which exists for text a student typed. */
const normAnswer = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

interface AssessmentResult {
  score: number;
  correct_count: number;
  total: number;
  review: {
    index: number;
    prompt: string;
    options: string[];
    student_answer: string | null;
    correct_answer: string;
    is_correct: boolean;
  }[];
}

/**
 * Grade an attempt. Pure and re-runnable — recomputed on every read rather than
 * cached, mirroring `buildResult()` in `practice.routes.ts`. Only `score` and
 * `correct_count` are denormalised onto the row.
 *
 * An unanswered item is wrong, and the score divides by TOTAL, never by answered.
 */
function buildAssessmentResult(
  items: StoredAssessmentItem[],
  attempt: AttemptRow
): AssessmentResult {
  const stored = attempt.answers ?? {};
  const review = items.map((item) => {
    const given = stored[String(item.index)]?.answer ?? null;
    return {
      index: item.index,
      prompt: attempt.phase === 'pre' ? item.pre_stem : item.post_stem,
      options: attempt.phase === 'pre' ? item.options_pre : item.options_post,
      student_answer: given,
      correct_answer: item.answer,
      is_correct: given !== null && normAnswer(given) === normAnswer(item.answer),
    };
  });

  const correct = review.filter((r) => r.is_correct).length;
  return {
    score: items.length === 0 ? 0 : correct / items.length,
    correct_count: correct,
    total: items.length,
    review,
  };
}

/**
 * What a STUDENT is allowed to see after finishing.
 *
 * ⚠️ THE PRE-TEST RETURNS NO ITEMS AT ALL — a score and nothing else.
 *
 * The obvious mirror of `GET /api/practice/:id/result` returns the full review on
 * completion, and here that would be the single worst leak available: the pre-test
 * and post-test share every answer, so a student who opens DevTools on their
 * pre-test result reads the post-test's key three weeks early, and their measured
 * "learning gain" becomes a measure of how carefully they read a JSON response.
 *
 * The post-test has nothing left to protect and returns the full review, which is
 * also where it does the most good.
 */
function studentResult(result: AssessmentResult, phase: AssessmentPhaseValue) {
  const summary = {
    score: result.score,
    correct_count: result.correct_count,
    total: result.total,
  };
  return phase === 'pre' ? summary : { ...summary, review: result.review };
}

// ─────────────────────────────────────────────────────────────────────────────
// Educator
// ─────────────────────────────────────────────────────────────────────────────

async function loadAssessment(materialId: string): Promise<AssessmentRow | null> {
  const { data } = await supabaseAdmin
    .from('material_assessments')
    .select('*')
    .eq('material_id', materialId)
    .maybeSingle();
  return (data as unknown as AssessmentRow) ?? null;
}

async function attemptCounts(assessmentId: string): Promise<{ pre: number; post: number; total: number }> {
  const { data } = await supabaseAdmin
    .from('assessment_attempts')
    .select('phase, status')
    .eq('assessment_id', assessmentId);

  const rows = data ?? [];
  return {
    pre: rows.filter((r) => r.phase === 'pre' && r.status === 'completed').length,
    post: rows.filter((r) => r.phase === 'post' && r.status === 'completed').length,
    total: rows.length,
  };
}

/**
 * GET /api/assessments/overview — one row per material this educator has a test for.
 *
 * Accepts NOTHING: no body, no query, no path parameter. Every set is derived from
 * `req.user!.id`, so it has zero IDOR surface and needs no Zod schema — the same
 * bar `GET /api/dashboard` and `GET /api/educator/overview` meet.
 *
 * It exists so the materials library can show which lessons already have a test
 * WITHOUT widening `GET /api/materials`. "All uploaded materials should have a
 * set" is a question about coverage across the library, and a separate read keeps
 * the removal of this feature to one fetch rather than an edit to a shared route.
 * Carries no items and therefore no answer key.
 */
router.get(
  '/overview',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const { data: materials } = await supabaseAdmin
      .from('materials')
      .select('id')
      .eq('educator_id', req.user!.id);

    const ids = (materials ?? []).map((m) => m.id as string);
    if (ids.length === 0) {
      res.json({ data: { assessments: [] } });
      return;
    }

    const { data } = await supabaseAdmin
      .from('material_assessments')
      .select('material_id, item_count, pre_released_at, post_released_at')
      .in('material_id', ids);

    res.json({ data: { assessments: data ?? [] } });
  }
);

/**
 * GET /api/assessments/materials/:materialId — the educator's full view.
 *
 * Returns the items WITH the answer key, which is correct here and nowhere else:
 * the educator wrote the material these questions come from, and they cannot
 * approve a test they are not allowed to read.
 */
router.get(
  '/materials/:materialId',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const assessment = await loadAssessment(material.id);
    if (!assessment) {
      res.json({ data: { assessment: null, attempts: { pre: 0, post: 0, total: 0 } } });
      return;
    }

    res.json({
      data: {
        assessment: {
          id: assessment.id,
          material_id: assessment.material_id,
          item_count: assessment.item_count,
          pre_released_at: assessment.pre_released_at,
          post_released_at: assessment.post_released_at,
          created_at: assessment.created_at,
          items: itemsOf(assessment),
        },
        attempts: await attemptCounts(assessment.id),
      },
    });
  }
);

/**
 * POST /api/assessments/materials/:materialId/generate
 *
 * SYNCHRONOUS — one Gemini call. MEASURED AT 36.1s for 20 items on a 30-concept
 * material, not the ~2-3s a single MINIMAL call suggests: forty sentences is a lot
 * of output, and output is the bottleneck. It stays synchronous anyway.
 * `processMaterialAsync` in `materials.routes.ts` is fire-and-forget because
 * concept extraction is many calls over many windows; this is one, and going async
 * would buy a status column, a client poll, and the defect that pipeline actually
 * has: a server restart mid-job strands the row on `processing` forever with
 * nothing to reap it.
 *
 * The cost is bounded, which is what makes that safe: the request writes at most
 * ASSESSMENT_MAX_ITEMS + SPARE = 26 items however large the material, so ~36s is
 * near the ceiling rather than the start of a curve. It is also a once-per-material
 * action an educator performs before the study, never on a student's path.
 *
 * ⚠️ REGENERATION IS REFUSED ONCE ANY ATTEMPT EXISTS, and the check is HERE, not
 * on a disabled button. Rewriting a question after a student has answered it
 * destroys the pre/post comparison the whole study rests on — verify by reading
 * the stored row, never by the response code.
 */
router.post(
  '/materials/:materialId/generate',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    if (material.parsedStatus !== 'completed') {
      res.status(422).json({
        error: 'Material not ready',
        message: 'Concept extraction has not finished for this material yet.',
      });
      return;
    }

    const existing = await loadAssessment(material.id);
    if (existing) {
      const counts = await attemptCounts(existing.id);
      if (counts.total > 0) {
        res.status(409).json({
          error: 'Assessment in use',
          message:
            `${counts.total} student attempt${counts.total === 1 ? ' has' : 's have'} already been ` +
            'recorded against this test. Its questions can no longer be changed.',
        });
        return;
      }
    }

    const { data: conceptRows, error: conceptError } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition')
      .eq('material_id', material.id)
      .order('created_at');

    if (conceptError) {
      res.status(500).json({ error: 'Failed to load concepts', message: conceptError.message });
      return;
    }

    const concepts: ConceptForAssessment[] = (conceptRows ?? []).map((c) => ({
      id: c.id as string,
      term: c.term as string,
      definition: c.definition as string,
    }));

    let generated;
    try {
      generated = await generateAssessment(concepts, material.title);
    } catch (err) {
      if (err instanceof AssessmentGenerationError) {
        res.status(422).json({ error: 'Cannot build a test', message: err.message });
        return;
      }
      if (err instanceof GeminiUnavailableError) {
        // 429 for a spent daily quota, 503 for an outage — the distinction matters
        // because "try again" cannot work on the first and always works on the second.
        const retryAfterMs = err.upstream?.retryAfterMs;
        if (retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
        res.status(err.status).json({ error: 'Question writer unavailable', message: err.message });
        return;
      }
      console.error('[Assessment] Generation failed:', err instanceof Error ? err.message : err);
      res.status(502).json({
        error: 'Test generation failed',
        message: 'The questions could not be written, so nothing was saved. Please try again.',
      });
      return;
    }

    // Upsert on the UNIQUE material_id. Release timestamps are deliberately NOT
    // cleared: an educator regenerating a released-but-unattempted test keeps it
    // released, which is what "regenerate" means to them.
    const { data: row, error: writeError } = await supabaseAdmin
      .from('material_assessments')
      .upsert(
        {
          material_id: material.id,
          created_by: req.user!.id,
          items: generated.payload,
          item_count: generated.itemCount,
        },
        { onConflict: 'material_id' }
      )
      .select('*')
      .single();

    if (writeError || !row) {
      res.status(500).json({ error: 'Failed to save the test', message: writeError?.message });
      return;
    }

    const saved = row as unknown as AssessmentRow;
    res.status(201).json({
      data: {
        assessment: {
          id: saved.id,
          material_id: saved.material_id,
          item_count: saved.item_count,
          pre_released_at: saved.pre_released_at,
          post_released_at: saved.post_released_at,
          created_at: saved.created_at,
          items: itemsOf(saved),
        },
        attempts: { pre: 0, post: 0, total: 0 },
      },
      message: `${generated.itemCount} questions written.`,
    });
  }
);

/**
 * PATCH /api/assessments/materials/:materialId/release
 *
 * `false` UN-RELEASES, and that is the escape hatch, not an accident: a released
 * phase locks the material until the student completes it, so without un-release a
 * student who will not sit the test is locked out of the lesson permanently.
 * Un-releasing destroys no attempts — the same doctrine archiving and re-grading
 * follow.
 *
 * Releasing `post` while `pre` is unreleased is refused HERE as well as by the
 * `material_assessments_release_order` CHECK, so the educator gets a sentence
 * rather than a constraint violation. The gate reads the LATEST released phase,
 * so a post-first release would strand every student still owing the pre-test.
 */
router.patch(
  '/materials/:materialId/release',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ReleaseAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const assessment = await loadAssessment(material.id);
    if (!assessment) {
      res.status(404).json({ error: 'No test has been generated for this material yet' });
      return;
    }

    const now = new Date().toISOString();
    const preAt =
      parsed.data.pre_released === undefined
        ? assessment.pre_released_at
        : parsed.data.pre_released
          ? (assessment.pre_released_at ?? now)
          : null;
    const postAt =
      parsed.data.post_released === undefined
        ? assessment.post_released_at
        : parsed.data.post_released
          ? (assessment.post_released_at ?? now)
          : null;

    if (postAt && !preAt) {
      // ⚠️ THE MESSAGE MUST NAME THE ACTION THE EDUCATOR ACTUALLY TOOK. One rule
      // (post cannot be open while pre is closed) is reachable from two
      // directions, and a single sentence is wrong for one of them: an educator
      // CLOSING the pre-test while the post-test is open was being told to
      // "release the pre-test first", which describes a different action than the
      // one they attempted and reads as the app malfunctioning.
      const closingPre = parsed.data.pre_released === false;
      res.status(422).json({
        error: 'Release order',
        message: closingPre
          ? 'Close the post-test first. The post-test cannot stay open while the pre-test is ' +
            'closed — a student who has not taken the pre-test yet would have no way back to it.'
          : 'Release the pre-test first. Releasing the post-test on its own would lock out every ' +
            'student who has not yet taken the pre-test.',
      });
      return;
    }

    const { data: row, error } = await supabaseAdmin
      .from('material_assessments')
      .update({ pre_released_at: preAt, post_released_at: postAt })
      .eq('id', assessment.id)
      .select('*')
      .single();

    if (error || !row) {
      res.status(500).json({ error: 'Failed to update release state', message: error?.message });
      return;
    }

    const saved = row as unknown as AssessmentRow;
    res.json({
      data: {
        id: saved.id,
        material_id: saved.material_id,
        pre_released_at: saved.pre_released_at,
        post_released_at: saved.post_released_at,
      },
    });
  }
);

/**
 * GET /api/assessments/materials/:materialId/results — the RQ4 data.
 *
 * Every ACTIVE student in the material's grade, via `rosterFor()`, including those
 * who have taken neither test: "nineteen of twenty have not sat the pre-test" is
 * the finding an educator needs before releasing the post-test, and filtering them
 * out would hide it. Same reasoning as the Class Performance roster.
 *
 * `gain` is post − pre and is null unless BOTH exist. A gain computed against a
 * missing pre-test is not a gain.
 */
router.get(
  '/materials/:materialId/results',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const assessment = await loadAssessment(material.id);
    if (!assessment) {
      res.json({ data: { material_title: material.title, item_count: 0, students: [] } });
      return;
    }

    const roster = await rosterFor(material);
    const { data: attempts } = await supabaseAdmin
      .from('assessment_attempts')
      .select('student_id, phase, score, correct_count, status, completed_at')
      .eq('assessment_id', assessment.id)
      .eq('status', 'completed');

    const byStudent = new Map<string, Record<string, { correct: number; at: string | null }>>();
    for (const a of attempts ?? []) {
      const entry = byStudent.get(a.student_id as string) ?? {};
      entry[a.phase as string] = {
        correct: (a.correct_count as number) ?? 0,
        at: (a.completed_at as string) ?? null,
      };
      byStudent.set(a.student_id as string, entry);
    }

    const students = roster.map((s) => {
      const entry = byStudent.get(s.id) ?? {};
      const pre = entry.pre?.correct ?? null;
      const post = entry.post?.correct ?? null;
      return {
        student_id: s.id,
        first_name: s.firstName,
        last_name: s.lastName,
        grade_level: s.gradeLevel,
        pre_correct: pre,
        post_correct: post,
        pre_at: entry.pre?.at ?? null,
        post_at: entry.post?.at ?? null,
        gain: pre !== null && post !== null ? post - pre : null,
      };
    });

    res.json({
      data: { material_title: material.title, item_count: assessment.item_count, students },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Student
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/assessments/space/:spaceId
 *
 * Everything the two tabs, the lock banner and the picker filters need, in ONE
 * request — a per-tab fetch would let the Pre-Test tab and the Flashcards picker
 * disagree about what is locked.
 *
 * Goes through `requireOwnedSpace()` then `spaceMaterialIds()`, which is what
 * gives it the live archive / grade / subject filter for free: a material the
 * educator archived stops being listed here the moment they archive it, and stops
 * locking anything, without this route knowing those rules exist.
 *
 * Carries no items and no answers — only what is released and what the caller has
 * already completed.
 */
router.get(
  '/space/:spaceId',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const space = await requireOwnedSpace(req.params.spaceId, req, res);
    if (!space) return;

    const materialIds = await spaceMaterialIds(space);
    if (materialIds.length === 0) {
      res.json({ data: { materials: [] } });
      return;
    }

    const { data: assessments } = await supabaseAdmin
      .from('material_assessments')
      .select('id, material_id, item_count, pre_released_at, post_released_at')
      .in('material_id', materialIds);

    const rows = (assessments ?? []).filter((r) => r.pre_released_at || r.post_released_at);
    if (rows.length === 0) {
      res.json({ data: { materials: [] } });
      return;
    }

    const [{ data: attempts }, { data: materials }] = await Promise.all([
      supabaseAdmin
        .from('assessment_attempts')
        .select('assessment_id, phase, status, score, correct_count, completed_at')
        .eq('student_id', req.user!.id)
        .in('assessment_id', rows.map((r) => r.id as string)),
      supabaseAdmin
        .from('materials')
        .select('id, title')
        .in('id', rows.map((r) => r.material_id as string)),
    ]);

    const titleOf = new Map((materials ?? []).map((m) => [m.id as string, m.title as string]));
    const attemptOf = new Map(
      (attempts ?? []).map((a) => [`${a.assessment_id}:${a.phase}`, a])
    );

    const phaseState = (assessmentId: string, phase: AssessmentPhaseValue, releasedAt: string | null) => {
      if (!releasedAt) return { released: false, taken: false, correct_count: null, completed_at: null };
      const attempt = attemptOf.get(`${assessmentId}:${phase}`);
      const taken = attempt?.status === 'completed';
      return {
        released: true,
        taken,
        correct_count: taken ? ((attempt?.correct_count as number) ?? null) : null,
        completed_at: taken ? ((attempt?.completed_at as string) ?? null) : null,
      };
    };

    res.json({
      data: {
        materials: rows.map((r) => {
          const pre = phaseState(r.id as string, 'pre', r.pre_released_at as string | null);
          const post = phaseState(r.id as string, 'post', r.post_released_at as string | null);

          // THE PHASE THE LOCK IS ON. The client must never derive this itself --
          // see gatePhaseOf()'s note on why "any released phase" is the wrong rule.
          const gate = gatePhaseOf(r as any);
          const lockedPhase =
            !gate || attemptOf.get(`${r.id}:${gate}`)?.status === 'completed' ? null : gate;

          /*
           * THE PHASE THE STUDENT MUST ACTUALLY SIT NEXT, which is NOT the same
           * thing and must not be conflated with it.
           *
           * The gate points at the LATEST released phase, so a student who owes a
           * pre-test while the post-test is also out is gated on 'post' -- and a
           * banner reading that field told them to "take the post-test", which is
           * the one thing they are forbidden to do until the pre-test is done.
           *
           * Ordering wins here: pre before post, always.
           */
          const actionPhase: AssessmentPhaseValue | null =
            pre.released && !pre.taken ? 'pre' : post.released && !post.taken ? 'post' : null;

          return {
            assessment_id: r.id as string,
            material_id: r.material_id as string,
            material_title: titleOf.get(r.material_id as string) ?? 'Lesson',
            item_count: r.item_count as number,
            pre,
            post,
            locked_phase: lockedPhase,
            action_phase: actionPhase,
          };
        }),
      },
    });
  }
);

/**
 * Load an assessment a STUDENT is entitled to sit, and the phase they may sit.
 *
 * Answers 404 for everything: a wrong id, someone else's material, an unreleased
 * phase and a material outside the caller's grade are all indistinguishable from
 * outside, which is the same doctrine `requireMaterialAccess()` follows. A 403
 * here would confirm that a test exists for a material the student cannot reach.
 */
async function loadSittableAssessment(
  assessmentId: string,
  phase: AssessmentPhaseValue,
  req: Request,
  res: Response
): Promise<AssessmentRow | null> {
  const { data } = await supabaseAdmin
    .from('material_assessments')
    .select('*')
    .eq('id', assessmentId)
    .maybeSingle();

  const assessment = (data as unknown as AssessmentRow) ?? null;
  if (!assessment) {
    res.status(404).json({ error: 'Test not found' });
    return null;
  }

  const releasedAt = phase === 'pre' ? assessment.pre_released_at : assessment.post_released_at;
  if (!releasedAt) {
    res.status(404).json({ error: 'Test not found' });
    return null;
  }

  // The material must still be readable by this caller — grade, archive, status.
  // Reusing the same primitive every other student route uses means an educator
  // archiving a material stops its test dead without this route knowing the rule.
  const allowed = await accessibleMaterialIds(req.user!.id, [assessment.material_id]);
  if (!allowed.has(assessment.material_id)) {
    res.status(404).json({ error: 'Test not found' });
    return null;
  }

  return assessment;
}

/**
 * POST /api/assessments/:assessmentId/attempts — start or RESUME.
 *
 * ⚠️ IDEMPOTENT BY NECESSITY, not politeness. `UNIQUE (assessment_id, student_id,
 * phase)` means one attempt per phase and no retakes — so a student who closes the
 * tab mid-test would, on a 409, be left with an `in_progress` row they can never
 * complete and a material locked forever. Returning the existing row is the only
 * behaviour that is safe.
 *
 * A COMPLETED attempt is not resumable: it returns the result instead, so the tab
 * can render the score without a second round trip.
 */
router.post(
  '/:assessmentId/attempts',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = StartAssessmentAttemptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }
    const { phase } = parsed.data;

    const assessment = await loadSittableAssessment(req.params.assessmentId, phase, req, res);
    if (!assessment) return;

    const items = itemsOf(assessment);
    if (items.length < ASSESSMENT_MIN_ITEMS) {
      res.status(422).json({ error: 'This test is not usable', message: 'It has too few questions.' });
      return;
    }

    /*
     * THE POST-TEST REQUIRES A COMPLETED PRE-TEST. Ordering the instruments is
     * NOT the same job as the lock, and the lock alone does not do it: the gate
     * points at the LATEST released phase, so once the post-test is out a student
     * who never sat the pre-test is gated on `post` and nothing stops them starting
     * it. Observed on a real account.
     *
     * A post score with no baseline is not a weaker data point, it is an unusable
     * one -- RQ4 measures a DIFFERENCE, and there is nothing to subtract from.
     * Worse, the student has now seen the item set, so a "pre"-test taken
     * afterwards measures recall of the post-test rather than prior knowledge.
     * That contamination is not recoverable by re-testing.
     *
     * THIS CANNOT STRAND ANYONE, and the reason is the CHECK constraint rather
     * than anything here: material_assessments_release_order forbids the
     * post-test being released while the pre-test is not, so whenever the
     * post-test is offered the pre-test is offered too. The student always has a
     * way to satisfy this. Do not relax that constraint without revisiting this.
     *
     * It runs BEFORE the existing-attempt lookup on purpose, so an orphaned
     * in_progress post attempt created before this guard existed cannot be
     * resumed either.
     */
    if (phase === 'post') {
      const { data: preDone } = await supabaseAdmin
        .from('assessment_attempts')
        .select('id')
        .eq('assessment_id', assessment.id)
        .eq('student_id', req.user!.id)
        .eq('phase', 'pre')
        .eq('status', 'completed')
        .maybeSingle();

      if (!preDone) {
        res.status(409).json({
          error: 'Pre-test required',
          message:
            'Take the pre-test for this lesson first. The post-test is only meaningful once there ' +
            'is a starting score to compare it against.',
        });
        return;
      }
    }

    const { data: existing } = await supabaseAdmin
      .from('assessment_attempts')
      .select('*')
      .eq('assessment_id', assessment.id)
      .eq('student_id', req.user!.id)
      .eq('phase', phase)
      .maybeSingle();

    let attempt = (existing as unknown as AttemptRow) ?? null;

    if (attempt?.status === 'completed') {
      res.json({
        data: {
          attempt_id: attempt.id,
          phase,
          status: 'completed',
          result: studentResult(buildAssessmentResult(items, attempt), phase),
        },
      });
      return;
    }

    if (!attempt) {
      const { data: created, error } = await supabaseAdmin
        .from('assessment_attempts')
        .insert({ assessment_id: assessment.id, student_id: req.user!.id, phase, answers: {} })
        .select('*')
        .single();

      if (error || !created) {
        res.status(500).json({ error: 'Could not start the test', message: error?.message });
        return;
      }
      attempt = created as unknown as AttemptRow;
    }

    res.status(201).json({
      data: {
        attempt_id: attempt.id,
        phase,
        status: 'in_progress',
        item_count: items.length,
        items: items.map((item) => stripAssessmentKey(item, phase)),
        answers: Object.fromEntries(
          Object.entries(attempt.answers ?? {}).map(([k, v]) => [k, v.answer])
        ),
      },
    });
  }
);

/** The caller's own in-progress attempt, or null having answered. */
async function requireOwnAttempt(
  attemptId: string,
  req: Request,
  res: Response
): Promise<AttemptRow | null> {
  const { data } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*')
    .eq('id', attemptId)
    .eq('student_id', req.user!.id)
    .maybeSingle();

  const attempt = (data as unknown as AttemptRow) ?? null;
  if (!attempt) {
    res.status(404).json({ error: 'Attempt not found' });
    return null;
  }
  return attempt;
}

/**
 * PUT /api/assessments/attempts/:attemptId/answer
 *
 * Records the option TEXT the student picked and NEVER returns correctness — the
 * response is `{ saved: true }`. Telling a student whether each answer was right
 * as they go would turn the pre-test into a study session on the exact 20 concepts
 * the post-test asks about.
 *
 * Latency ACCUMULATES across revisits, matching `PUT /api/practice/:id/answer`.
 */
router.put(
  '/attempts/:attemptId/answer',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitAssessmentAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }
    const { item_index, answer, latency_ms } = parsed.data;

    const attempt = await requireOwnAttempt(req.params.attemptId, req, res);
    if (!attempt) return;

    if (attempt.status === 'completed') {
      res.status(409).json({ error: 'This test has already been submitted' });
      return;
    }

    const { data: assessmentRow } = await supabaseAdmin
      .from('material_assessments')
      .select('items')
      .eq('id', attempt.assessment_id)
      .maybeSingle();

    const items = ((assessmentRow?.items as StoredAssessmentPayload) ?? { items: [] }).items ?? [];
    if (item_index >= items.length) {
      res.status(400).json({ error: 'No such question in this test' });
      return;
    }

    const merged = { ...(attempt.answers ?? {}) };
    const previous = merged[String(item_index)]?.latency_ms ?? 0;
    merged[String(item_index)] = { answer, latency_ms: previous + latency_ms };

    const { error } = await supabaseAdmin
      .from('assessment_attempts')
      .update({ answers: merged })
      .eq('id', attempt.id)
      .eq('status', 'in_progress');

    if (error) {
      res.status(500).json({ error: 'Failed to save the answer', message: error.message });
      return;
    }

    res.json({ data: { saved: true } });
  }
);

/**
 * PUT /api/assessments/attempts/:attemptId/complete
 *
 * Grades, stores the score, and unlocks the material.
 *
 * ⚠️ THE UPDATE IS A COMPARE-AND-SWAP (`.eq('status', 'in_progress').select('id')`),
 * not the status check above it. That check reads a row fetched a moment earlier,
 * so two racing submits both fall through it — and this row IS the study's
 * measurement, so a second pass must not be able to rewrite a recorded score.
 * Same idiom as `PUT /api/practice/:id/complete` and the flashcard rating.
 *
 * Nothing else happens here. No BKT, no telemetry, no `activity_logs` row: a
 * pre-test does not extend a study streak, which is the honest cost of keeping a
 * research instrument out of the gamification surface.
 */
router.put(
  '/attempts/:attemptId/complete',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const attempt = await requireOwnAttempt(req.params.attemptId, req, res);
    if (!attempt) return;

    const { data: assessmentRow } = await supabaseAdmin
      .from('material_assessments')
      .select('id, material_id, items')
      .eq('id', attempt.assessment_id)
      .maybeSingle();

    const items = ((assessmentRow?.items as StoredAssessmentPayload) ?? { items: [] }).items ?? [];
    const result = buildAssessmentResult(items, attempt);

    if (attempt.status === 'completed') {
      res.json({
        data: {
          attempt_id: attempt.id,
          phase: attempt.phase,
          material_id: (assessmentRow?.material_id as string) ?? null,
          result: studentResult(result, attempt.phase),
        },
      });
      return;
    }

    const { data: swapped, error } = await supabaseAdmin
      .from('assessment_attempts')
      .update({
        status: 'completed',
        score: result.score,
        correct_count: result.correct_count,
        completed_at: new Date().toISOString(),
      })
      .eq('id', attempt.id)
      .eq('status', 'in_progress')
      .select('id');

    if (error) {
      res.status(500).json({ error: 'Failed to submit the test', message: error.message });
      return;
    }
    if (!swapped || swapped.length === 0) {
      // Lost the race. The other request recorded the identical score from the
      // identical answers, so this is a success, not a conflict.
      console.warn(`[Assessment] duplicate completion ignored for attempt ${attempt.id}`);
    }

    res.json({
      data: {
        attempt_id: attempt.id,
        phase: attempt.phase,
        material_id: (assessmentRow?.material_id as string) ?? null,
        result: studentResult(result, attempt.phase),
      },
    });
  }
);

export default router;
