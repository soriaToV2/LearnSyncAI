import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  allMasteryRows,
  documentMastery,
  masteryTier,
  P_L0,
  type ConceptMasteryRow,
} from '../lib/testDifficulty';
import type { DifficultyTier } from '../lib/testAllocation';

/**
 * The student dashboard — the one GLOBAL read in the student API.
 *
 * Everything else a student can read is scoped to a single owned space, and
 * `server/index.ts` records that as deliberate. This route is the documented
 * exception, because a dashboard is by definition about all of them: fanned out
 * client-side it would cost 1 + N HTTP requests, each per-space mastery call
 * being ~6 database round trips on its own.
 *
 * ══ IT ACCEPTS NOTHING ══
 * No body, no query string, no path parameter. Every set below is derived from
 * `req.user!.id`, so the route has no IDOR surface at all — it cannot be pointed
 * at another student's space, deck, test or concept, because there is nothing to
 * point with. That is a stronger guarantee than `requireOwnedSpace()` gives, and
 * it is why there is no Zod schema here: there is no input to validate. If a
 * parameter is ever added, `safeParse(req.query)` it.
 *
 * ══ READ-ONLY, PERMANENTLY ══
 * Nothing here writes. In particular it must never call the gamification profile
 * route, which INSERTs a row on a GET.
 *
 * ══ ONE REQUEST, BECAUSE OF THE ANCHOR ══
 * The mastery curve's final point must equal the headline mastery number. That
 * is only enforceable inside a single request — split across two endpoints, a
 * test completing between them leaves the chart ending somewhere other than the
 * number printed beside it. See `buildCurve()`.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

/** Supabase serialises `.in()` into the query string; same bound as testDifficulty.ts. */
const IN_CHUNK = 200;

/** Plotted points. ~5px each in a 320px card — more is noise, not detail. */
const MAX_CURVE_POINTS = 60;

/** Newest-first window over the audit log. Truncation drops the OLDEST history,
 *  never the anchor, which is what makes backward reconstruction cappable. */
const CURVE_ROW_CAP = 2000;

const RECENT_LIMIT = 6;
const FOCUS_COUNT = 5;

/** Mastery at or above this counts as "mastered" — the `advanced` tier threshold. */
const MASTERED_AT = 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Wire types — mirrored field-for-field by src/lib/dashboard.ts
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceMasteryRow {
  space_id: string;
  title: string;
  subject: string;
  m_doc: number;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  material_count: number;
  due_count: number;
}

/**
 * Streaks and badges.
 *
 * `total_study_hours` is deliberately ABSENT. It is written (see
 * `server/lib/activity.ts`) but only games and adaptive tests carry a real
 * duration; flashcards, both cognitive modes and chat measure nothing, so the
 * figure is a partial sum that would read as a total. That is the same failure
 * as the frozen `day_streak` this whole feature exists to fix. If a screen ever
 * wants it, the missing piece is real timing, not a field here.
 */
interface GamificationBlock {
  day_streak: number;
  longest_streak: number;
  /** Asia/Manila calendar date, not a timestamp. Null until the first activity. */
  last_active_on: string | null;
  badges: { name: string; awarded_at: string }[];
}

const EMPTY_GAMIFICATION: GamificationBlock = {
  day_streak: 0,
  longest_streak: 0,
  last_active_on: null,
  badges: [],
};

interface CurvePoint {
  /** Learning-opportunity index, not a timestamp. See buildCurve(). */
  t: number;
  at: string;
  m_doc: number;
}

type ActivityItem =
  | { kind: 'test'; id: string; at: string; space_id: string; space_title: string; title: string; score: number }
  | { kind: 'free_recall'; id: string; at: string; space_id: string; space_title: string }
  | { kind: 'feynman'; id: string; at: string; space_id: string; space_title: string }
  | {
      kind: 'game';
      id: string;
      at: string;
      space_id: string | null;
      space_title: string | null;
      game_type: string;
      accuracy: number | null;
    };

// ─────────────────────────────────────────────────────────────────────────────
// The curve
// ─────────────────────────────────────────────────────────────────────────────

interface LogRow {
  concept_id: string;
  p_l_prior: number;
  p_l_posterior: number;
  created_at: string;
}

/**
 * M_doc over time, reconstructed BACKWARD from the current state.
 *
 * `bkt_update_logs` stores both phases of every update, including `p_l_prior` —
 * the value that concept held *before* the update. So rather than replaying
 * forward from P(L₀), we start from `bkt_mastery` (the authoritative state), walk
 * the log newest-to-oldest, and step each concept back to its prior.
 *
 * ══ WHY BACKWARD, AND WHY IT MATTERS ══
 * The Analytics work rejected reading this table at all, for a good reason:
 * `applyBktObservations()` treats a failed log write as non-fatal by deliberate
 * design (mastery is the state everything reads; the audit trail has no runtime
 * reader). Giving the UI a read on it threatened to turn a tolerated log failure
 * into a visibly wrong chart, which would force that error to become fatal and
 * invert a documented failure-ordering decision.
 *
 * Reconstructing backward dissolves that coupling:
 *
 *   - The chart NEVER sources the current number. `bkt_mastery` does. The last
 *     point equals `overall` BY CONSTRUCTION — there is no reconciliation branch,
 *     so there is no branch to get wrong.
 *   - A missing log row degrades LOCALLY. Forward replay would leave that concept
 *     at a stale value for the rest of the curve *including the end*; backward
 *     simply does not step back at that moment, so one concept reads slightly
 *     too-new in one window — at most 1/N of one BKT step. Reduced resolution in
 *     the history, never a wrong current value.
 *   - It makes the row cap safe. Forward replay REQUIRES the log from t=0 or its
 *     baseline is wrong; backward can start anywhere.
 *   - A concept with mastery but no surviving log rows is invisible to forward
 *     replay (pinned at P(L₀) through the end). Backward holds it flat at its true
 *     value, which is the honest "we don't know when this moved".
 *
 * So `logWriteError` STAYS NON-FATAL. Do not promote it because this reader exists.
 *
 * ══ THE DENOMINATOR IS FIXED AT "NOW" ══
 * Every point is a mean over the current visible concept set, so log rows for
 * concepts outside it are dropped (`total_updates` may therefore be lower than
 * the student's row count — expected, not a bug). Concepts created after an early
 * point did not exist then, so past M_doc renders slightly low. The alternative —
 * a denominator that changes with time — would move the line while the student
 * did nothing, which is worse. The caption says what the line is out of.
 *
 * ══ X IS A LEARNING-OPPORTUNITY INDEX, NOT WALL CLOCK ══
 * Two reasons, and the first is fatal on its own. Every update in a session shares
 * a timestamp to the millisecond, so a real study day plots as a vertical line.
 * And BKT has no forgetting term: a two-week gap is a perfectly flat segment,
 * which reads to a student as "you stalled" when the model is incapable of moving
 * without evidence. The paper's own time index is the learning opportunity `t`.
 * Each point still carries `at` so the UI can print date context.
 */
function buildCurve(
  conceptIds: readonly string[],
  byConcept: Map<string, number>,
  overall: number,
  logs: LogRow[]
): { points: CurvePoint[]; total_updates: number; stride: number; truncated: boolean } | null {
  const inScope = logs.filter((row) => byConcept.has(row.concept_id) || conceptIds.includes(row.concept_id));
  if (inScope.length === 0) return null;

  const n = conceptIds.length;
  if (n === 0) return null;

  // Running sum over the SAME set `documentMastery()` averages, so every point
  // and the anchor share one definition of the mean.
  const values = new Map<string, number>();
  for (const id of conceptIds) values.set(id, byConcept.get(id) ?? P_L0);
  let sum = 0;
  for (const v of values.values()) sum += v;

  const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

  // Newest first. The first emitted point is the anchor itself.
  const reversed: CurvePoint[] = [{ t: inScope.length, at: new Date().toISOString(), m_doc: overall }];

  for (let i = 0; i < inScope.length; i++) {
    const row = inScope[i];
    const prior = Number(row.p_l_prior);
    if (!Number.isFinite(prior)) continue;

    const current = values.get(row.concept_id);
    if (current === undefined) continue;

    sum += prior - current;
    values.set(row.concept_id, prior);

    reversed.push({ t: inScope.length - i - 1, at: row.created_at, m_doc: round4(sum / n) });
  }

  const ascending = reversed.reverse();
  if (ascending.length < 2) return null;

  // Decimate. Every emitted point remains a real reconstructed mean at a real
  // event boundary — nothing is interpolated, smoothed or averaged. The usual
  // objection to decimation (hidden extrema) does not apply here: one event moves
  // one concept's posterior, so the MEAN moves by at most ~1/N, which makes
  // single-event spikes structurally impossible. A moving average would be worse.
  const stride = Math.max(1, Math.ceil(ascending.length / MAX_CURVE_POINTS));
  const points: CurvePoint[] = [];
  for (let i = 0; i < ascending.length; i += stride) points.push(ascending[i]);
  const last = ascending[ascending.length - 1];
  if (points[points.length - 1] !== last) points.push(last); // the anchor is never dropped

  return {
    points,
    total_updates: inScope.length,
    stride,
    truncated: logs.length >= CURVE_ROW_CAP,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard
 *
 * Everything the student dashboard renders, in one request. Constant round trips
 * regardless of how many spaces, materials or concepts the student has.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  try {
    // ── 1. Identity + spaces + gamification ─────────────────────────────────
    /*
     * Streaks and badges are fetched HERE, not later, because they must survive
     * the early returns below. A student whose educator archived every material
     * still holds the streak and badges they earned — zeroing those out on an
     * otherwise-empty dashboard would look like the app forgetting their work.
     *
     * Two plain SELECTs, deliberately NOT `GET /api/gamification/profile` — that
     * route INSERTs a row on a GET and this endpoint is read-only permanently
     * (see the header). A missing profile row yields zeros rather than being
     * created; `handle_new_user()` writes one for every student, so the branch is
     * nearly dead, and "no activity yet" is the only answer a read may give.
     */
    const [
      { data: profile },
      { data: spaceRows },
      { data: gamificationRow },
      { data: badgeRows },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('grade_level').eq('id', studentId).maybeSingle(),
      supabaseAdmin
        .from('study_spaces')
        .select('id, title, subject')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('gamification_profiles')
        .select('day_streak, longest_streak, last_active_on')
        .eq('student_id', studentId)
        .maybeSingle(),
      supabaseAdmin
        .from('user_badges')
        .select('badge_name, awarded_at')
        .eq('student_id', studentId)
        .order('awarded_at', { ascending: false }),
    ]);

    const gamification: GamificationBlock = {
      day_streak: Number(gamificationRow?.day_streak ?? 0),
      longest_streak: Number(gamificationRow?.longest_streak ?? 0),
      last_active_on: (gamificationRow?.last_active_on as string | null) ?? null,
      badges: (badgeRows ?? []).map((b) => ({
        name: b.badge_name as string,
        awarded_at: b.awarded_at as string,
      })),
    };

    const spaces = (spaceRows ?? []) as { id: string; title: string; subject: string }[];
    const gradeLevel = profile?.grade_level ?? null;

    // No spaces means no materials, no decks and no activity — `practice_tests`,
    // `cognitive_logs` and `game_content` all require a space to exist.
    if (spaces.length === 0 || gradeLevel === null) {
      res.json({ data: emptyDashboard(0, gamification) });
      return;
    }

    const spaceIds = spaces.map((s) => s.id);
    const subjects = [...new Set(spaces.map((s) => s.subject))];

    // ── 2. Published materials + link rows + the whole mastery vector ───────
    const [{ data: publishedRows }, { data: linkRows }, masteryByConcept] = await Promise.all([
      // ONE query over the distinct subjects, replacing N calls to
      // publishedMaterialIds(). Same filter: not archived, published to this grade.
      supabaseAdmin
        .from('materials')
        .select('id, title, subject')
        .in('subject', subjects)
        .eq('is_archived', false)
        .contains('grade_levels', [gradeLevel]),
      supabaseAdmin
        .from('study_space_materials')
        .select('space_id, material_id')
        .in('space_id', spaceIds),
      allMasteryRows(studentId),
    ]);

    const published = new Map(
      (publishedRows ?? []).map((m) => [m.id as string, { title: m.title as string, subject: m.subject as string }])
    );

    // A material is visible in a space iff it is LINKED, still PUBLISHED to this
    // (subject, grade), and its subject matches the space's. That third clause is
    // `spaceMaterialIds()`'s rule and dropping it would let a stray cross-subject
    // link row make this page disagree with the Analytics tab for the same space.
    const materialsBySpace = new Map<string, string[]>();
    for (const space of spaces) materialsBySpace.set(space.id, []);
    const subjectOfSpace = new Map(spaces.map((s) => [s.id, s.subject]));

    for (const link of linkRows ?? []) {
      const spaceId = link.space_id as string;
      const materialId = link.material_id as string;
      const material = published.get(materialId);
      if (!material) continue;
      if (material.subject !== subjectOfSpace.get(spaceId)) continue;
      materialsBySpace.get(spaceId)?.push(materialId);
    }

    // The GLOBAL set is the union over materials, deduplicated — a material in two
    // of the student's spaces contributes its concepts once. Each per-space set is
    // its own, so the per-space rows will NOT average to the global figure. That
    // is correct: mastery is per (student, concept), not per space.
    const visibleMaterialIds = [...new Set([...materialsBySpace.values()].flat())];

    if (visibleMaterialIds.length === 0) {
      res.json({ data: emptyDashboard(spaces.length, gamification) });
      return;
    }

    // ── 3. Concepts ─────────────────────────────────────────────────────────
    const conceptRows: { id: string; material_id: string; term: string }[] = [];
    for (let i = 0; i < visibleMaterialIds.length; i += IN_CHUNK) {
      const { data } = await supabaseAdmin
        .from('concepts')
        .select('id, material_id, term')
        .in('material_id', visibleMaterialIds.slice(i, i + IN_CHUNK));
      for (const row of data ?? []) {
        conceptRows.push({
          id: row.id as string,
          material_id: row.material_id as string,
          term: row.term as string,
        });
      }
    }

    const conceptsByMaterial = new Map<string, string[]>();
    for (const c of conceptRows) {
      const list = conceptsByMaterial.get(c.material_id);
      if (list) list.push(c.id);
      else conceptsByMaterial.set(c.material_id, [c.id]);
    }

    const globalConceptIds = conceptRows.map((c) => c.id);

    // Intersect the mastery vector with what is actually visible. Rows for
    // archived or unlinked materials survive in bkt_mastery and must not count.
    const byConcept = new Map<string, number>();
    const rowsInScope = new Map<string, ConceptMasteryRow>();
    for (const id of globalConceptIds) {
      const row = masteryByConcept.get(id);
      if (row) {
        byConcept.set(id, row.mastery);
        rowsInScope.set(id, row);
      }
    }

    const overall = documentMastery(globalConceptIds, byConcept);
    const assessed = rowsInScope.size;
    let mastered = 0;
    let attempts = 0;
    let lastUpdated: string | null = null;
    for (const row of rowsInScope.values()) {
      if (row.mastery >= MASTERED_AT) mastered++;
      attempts += row.opportunityCount;
      if (row.lastUpdated && (lastUpdated === null || row.lastUpdated > lastUpdated)) {
        lastUpdated = row.lastUpdated;
      }
    }

    // ── 4. Decks and due cards ──────────────────────────────────────────────
    const { data: deckRows } = await supabaseAdmin
      .from('flashcard_decks')
      .select('id, space_id')
      .in('space_id', spaceIds);

    const spaceOfDeck = new Map((deckRows ?? []).map((d) => [d.id as string, d.space_id as string]));
    const dueBySpace = new Map<string, number>();
    let dueTotal = 0;

    const deckIds = [...spaceOfDeck.keys()];
    for (let i = 0; i < deckIds.length; i += IN_CHUNK) {
      const { data } = await supabaseAdmin
        .from('flashcards')
        .select('deck_id')
        // The same predicate the rating route uses. `.or(...)` not `.lte(...)`:
        // a NULL schedule counts as due and NULL never satisfies `<=`.
        .or(`next_review_at.is.null,next_review_at.lte.${new Date().toISOString()}`)
        .in('deck_id', deckIds.slice(i, i + IN_CHUNK));

      for (const card of data ?? []) {
        const spaceId = spaceOfDeck.get(card.deck_id as string);
        if (!spaceId) continue;
        dueBySpace.set(spaceId, (dueBySpace.get(spaceId) ?? 0) + 1);
        dueTotal++;
      }
    }

    // ── 5. History: logs, tests, cognitive, games ───────────────────────────
    const [
      { data: logRows },
      { data: inProgress },
      { data: doneTests },
      { data: cognitive },
      { data: games },
    ] = await Promise.all([
      supabaseAdmin
        .from('bkt_update_logs')
        .select('concept_id, p_l_prior, p_l_posterior, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(CURVE_ROW_CAP),
      supabaseAdmin
        .from('practice_tests')
        .select('id, title, space_id, questions_payload, student_answers, created_at')
        .eq('student_id', studentId)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('practice_tests')
        .select('id, title, space_id, score, completed_at')
        .eq('student_id', studentId)
        .eq('status', 'completed')
        // PostgREST puts NULLs FIRST by default, which would float an anomalous
        // row to the top of Recent Activity.
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
      supabaseAdmin
        .from('cognitive_logs')
        .select('id, mode, space_id, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
      supabaseAdmin
        .from('game_sessions')
        .select('id, game_type, accuracy, space_id, completed_at')
        .eq('student_id', studentId)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
    ]);


    const titleOfSpace = new Map(spaces.map((s) => [s.id, s.title]));

    // ── 6. Assemble ─────────────────────────────────────────────────────────
    const by_space: SpaceMasteryRow[] = spaces.map((space) => {
      const materialIds = materialsBySpace.get(space.id) ?? [];
      const conceptIds = materialIds.flatMap((id) => conceptsByMaterial.get(id) ?? []);
      const spaceAssessed = conceptIds.filter((id) => byConcept.has(id)).length;
      const mDoc = documentMastery(conceptIds, byConcept);
      return {
        space_id: space.id,
        title: space.title,
        subject: space.subject,
        m_doc: mDoc,
        tier: masteryTier(mDoc),
        concept_count: conceptIds.length,
        assessed_concept_count: spaceAssessed,
        material_count: materialIds.length,
        due_count: dueBySpace.get(space.id) ?? 0,
      };
    });

    // Weakest ASSESSED concepts across every space — impossible per-space, and the
    // single most actionable thing on the page. Unassessed are excluded by
    // construction, not filtered afterwards: they sit at P(L₀) = 0.10, BELOW every
    // genuinely struggling concept (the transition step floors any observed
    // posterior at P(T) = 0.20), so including them would fill the list with
    // concepts nobody has ever asked about.
    const spaceOfMaterial = new Map<string, string>();
    for (const [spaceId, materialIds] of materialsBySpace) {
      for (const id of materialIds) if (!spaceOfMaterial.has(id)) spaceOfMaterial.set(id, spaceId);
    }

    const focus = conceptRows
      .filter((c) => rowsInScope.has(c.id))
      .map((c) => {
        const row = rowsInScope.get(c.id)!;
        const spaceId = spaceOfMaterial.get(c.material_id) ?? '';
        return {
          concept_id: c.id,
          term: c.term,
          mastery: row.mastery,
          opportunity_count: row.opportunityCount,
          material_id: c.material_id,
          material_title: published.get(c.material_id)?.title ?? 'This lesson',
          space_id: spaceId,
          space_title: titleOfSpace.get(spaceId) ?? '',
        };
      })
      .sort((a, b) => a.mastery - b.mastery || a.term.localeCompare(b.term))
      .slice(0, FOCUS_COUNT);

    const curve =
      assessed === 0
        ? null
        : buildCurve(globalConceptIds, byConcept, overall, (logRows ?? []).map((r) => ({
            concept_id: r.concept_id as string,
            p_l_prior: Number(r.p_l_prior),
            p_l_posterior: Number(r.p_l_posterior),
            created_at: r.created_at as string,
          })));

    // The anchor invariant, asserted rather than assumed. Costs nothing, survives
    // future refactors, and matches the reconciliation idiom used for telemetry.
    if (curve && Math.abs(curve.points[curve.points.length - 1].m_doc - overall) > 1e-9) {
      console.error(
        `[Dashboard] curve endpoint ${curve.points[curve.points.length - 1].m_doc} != overall ${overall} ` +
          `for student=${studentId}`
      );
    }

    // A gap between the audit trail and stored mastery is a diagnostic, never a
    // student-visible signal — the chart is already correct at its endpoint.
    warnOnLogGaps(rowsInScope, logRows ?? [], studentId);

    const resumeRow = (inProgress ?? [])[0];
    const resume_test = resumeRow
      ? {
          id: resumeRow.id as string,
          title: (resumeRow.title as string) ?? 'Practice test',
          space_id: resumeRow.space_id as string,
          space_title: titleOfSpace.get(resumeRow.space_id as string) ?? '',
          // `questions_payload` carries the ANSWER KEY. It is read here only to
          // count questions and must never be serialised — same rule as stripKey().
          total: ((resumeRow.questions_payload as { questions?: unknown[] })?.questions ?? []).length,
          answered: Object.keys((resumeRow.student_answers as Record<string, unknown>) ?? {}).length,
          created_at: resumeRow.created_at as string,
        }
      : null;

    const recent: ActivityItem[] = [
      ...(doneTests ?? []).map((t): ActivityItem => ({
        kind: 'test',
        id: t.id as string,
        at: (t.completed_at as string) ?? '',
        space_id: t.space_id as string,
        space_title: titleOfSpace.get(t.space_id as string) ?? '',
        title: (t.title as string) ?? 'Practice test',
        score: Number(t.score ?? 0),
      })),
      ...(cognitive ?? []).map((c): ActivityItem => ({
        kind: c.mode === 'feynman' ? 'feynman' : 'free_recall',
        id: c.id as string,
        at: c.created_at as string,
        space_id: c.space_id as string,
        space_title: titleOfSpace.get(c.space_id as string) ?? '',
      })),
      ...(games ?? []).map((g): ActivityItem => ({
        kind: 'game',
        id: g.id as string,
        at: (g.completed_at as string) ?? '',
        // ON DELETE SET NULL — a session can outlive its space.
        space_id: (g.space_id as string) ?? null,
        space_title: g.space_id ? titleOfSpace.get(g.space_id as string) ?? null : null,
        game_type: g.game_type as string,
        accuracy: g.accuracy === null || g.accuracy === undefined ? null : Number(g.accuracy),
      })),
    ]
      .filter((item) => item.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, RECENT_LIMIT);

    res.json({
      data: {
        mastery: {
          // null, not 0.10, when nothing has been assessed — the caller must be
          // able to say "not measured yet" rather than print the prior as a score.
          overall: assessed === 0 ? null : overall,
          tier: masteryTier(overall),
          concepts_total: globalConceptIds.length,
          concepts_assessed: assessed,
          concepts_mastered: mastered,
          total_attempts: attempts,
          last_updated: lastUpdated,
          by_space,
        },
        curve,
        focus,
        flashcards_due: dueTotal,
        resume_test,
        recent,
        gamification,
        counts: { spaces: spaces.length, materials: visibleMaterialIds.length },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to load your dashboard', message });
  }
});

/** The zero-shaped payload, so the client renders empty states rather than branching on null. */
function emptyDashboard(spaceCount = 0, gamification: GamificationBlock = EMPTY_GAMIFICATION) {
  return {
    mastery: {
      overall: null,
      tier: 'foundational' as DifficultyTier,
      concepts_total: 0,
      concepts_assessed: 0,
      concepts_mastered: 0,
      total_attempts: 0,
      last_updated: null,
      by_space: [],
    },
    curve: null,
    focus: [],
    flashcards_due: 0,
    resume_test: null,
    recent: [],
    // Passed in, never zeroed: an empty dashboard is about materials and
    // mastery, and says nothing about whether the student has a streak.
    gamification,
    counts: { spaces: spaceCount, materials: 0 },
  };
}

/**
 * Logs a warning when a concept's newest audit row disagrees with its stored
 * mastery. Server-side only — the curve is already anchored to `bkt_mastery`, so
 * a gap costs resolution rather than correctness, and there is nothing here for a
 * student to act on.
 */
function warnOnLogGaps(
  rowsInScope: Map<string, ConceptMasteryRow>,
  logs: { concept_id: unknown; p_l_posterior: unknown }[],
  studentId: string
): void {
  const newest = new Map<string, number>();
  for (const row of logs) {
    const id = row.concept_id as string;
    if (!newest.has(id)) newest.set(id, Number(row.p_l_posterior)); // logs arrive newest-first
  }

  const gaps: string[] = [];
  for (const [conceptId, row] of rowsInScope) {
    const logged = newest.get(conceptId);
    if (logged !== undefined && Math.abs(logged - row.mastery) > 1e-6) gaps.push(conceptId);
  }

  if (gaps.length > 0) {
    console.warn(
      `[Dashboard] ${gaps.length} concept(s) whose newest bkt_update_logs row disagrees with ` +
        `bkt_mastery for student=${studentId}: ${gaps.slice(0, 5).join(', ')}`
    );
  }
}

export default router;
