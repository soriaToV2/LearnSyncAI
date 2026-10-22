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
import { badgeProgress } from '../lib/badges';

/**
 * The student dashboard: the one global student read (everything else is per-space).
 * Accepts no input, so no IDOR surface and no schema. Read-only; never call GET /gamification/profile.
 * One request so the curve's last point provably equals the headline mastery.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

/** Supabase serialises `.in()` into the query string; same bound as testDifficulty.ts. */
const IN_CHUNK = 200;

/** Plotted points. ~5px each in a 320px card — more is noise, not detail. */
const MAX_CURVE_POINTS = 60;

/** Newest-first audit-log window; truncation drops the oldest history, never the anchor. */
const CURVE_ROW_CAP = 2000;

const RECENT_LIMIT = 6;
const FOCUS_COUNT = 5;

/** Mastery at or above this counts as "mastered" — the `advanced` tier threshold. */
const MASTERED_AT = 0.85;

// Wire types, mirrored by src/lib/dashboard.ts

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

/** Streaks and badges. `total_study_hours` is omitted on purpose: most activities record no duration. */
interface GamificationBlock {
  day_streak: number;
  longest_streak: number;
  /** Asia/Manila calendar date, not a timestamp. Null until the first activity. */
  last_active_on: string | null;
  badges: { name: string; awarded_at: string }[];
  /**
   * Progress toward unearned countable badges. `mastery_*` may differ from `mastery.concepts_mastered`
   * because it uses the badge rule's own source.
   */
  badge_progress: { name: string; current: number; target: number }[];
}

const EMPTY_GAMIFICATION: GamificationBlock = {
  day_streak: 0,
  longest_streak: 0,
  last_active_on: null,
  badges: [],
  badge_progress: [],
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

// The curve

interface LogRow {
  concept_id: string;
  p_l_prior: number;
  p_l_posterior: number;
  created_at: string;
}

/**
 * M_doc over time, reconstructed backward from bkt_mastery through bkt_update_logs priors, so the last
 * point equals `overall` by construction and a lost log row only blurs history.
 * logWriteError stays non-fatal; don't promote it because this reader exists.
 * The denominator is the current visible concept set. X is a learning-opportunity index, not wall
 * clock (sessions share timestamps, and BKT has no forgetting).
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

  // Running sum over the same set documentMastery() averages.
  const values = new Map<string, number>();
  for (const id of conceptIds) values.set(id, byConcept.get(id) ?? P_L0);
  let sum = 0;
  for (const v of values.values()) sum += v;

  const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

  // Newest first; the first point is the anchor.
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

  // Decimate without interpolating: each point is a real mean at a real event.
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

/** GET /api/dashboard: everything the dashboard renders, in a constant number of round trips. */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  try {
    // 1. Identity + spaces + gamification. Gamification is read here so it survives the early returns
    // below. Plain SELECTs, never GET /gamification/profile.
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

    const badges = (badgeRows ?? []).map((b) => ({
      name: b.badge_name as string,
      awarded_at: b.awarded_at as string,
    }));

    // Badge progress: needs the held set; zero queries once every countable badge is held. Above the
    // early returns for the same reason.
    const gamification: GamificationBlock = {
      day_streak: Number(gamificationRow?.day_streak ?? 0),
      longest_streak: Number(gamificationRow?.longest_streak ?? 0),
      last_active_on: (gamificationRow?.last_active_on as string | null) ?? null,
      badges,
      badge_progress: await badgeProgress(studentId, new Set(badges.map((b) => b.name))),
    };

    const spaces = (spaceRows ?? []) as { id: string; title: string; subject: string }[];
    const gradeLevel = profile?.grade_level ?? null;

    // No spaces: nothing else to read.
    if (spaces.length === 0 || gradeLevel === null) {
      res.json({ data: emptyDashboard(0, gamification) });
      return;
    }

    const spaceIds = spaces.map((s) => s.id);
    const subjects = [...new Set(spaces.map((s) => s.subject))];

    // 2. Published materials + link rows + mastery
    const [{ data: publishedRows }, { data: linkRows }, masteryByConcept] = await Promise.all([
      // One query over the distinct subjects (not archived, this grade).
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

    // Visible = linked, still published to (subject, grade), and subject matches the space.
    // Must match spaceMaterialIds().
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

    // The global set is the deduplicated union, so per-space figures won't average to it. Correct.
    const visibleMaterialIds = [...new Set([...materialsBySpace.values()].flat())];

    if (visibleMaterialIds.length === 0) {
      res.json({ data: emptyDashboard(spaces.length, gamification) });
      return;
    }

    // 3. Concepts
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

    // Intersect with visible concepts; mastery rows survive archiving/unlinking.
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

    // 4. Decks and due cards
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
        // Same predicate as the rating route. `.or` not `.lte`: a NULL schedule is due.
        .or(`next_review_at.is.null,next_review_at.lte.${new Date().toISOString()}`)
        .in('deck_id', deckIds.slice(i, i + IN_CHUNK));

      for (const card of data ?? []) {
        const spaceId = spaceOfDeck.get(card.deck_id as string);
        if (!spaceId) continue;
        dueBySpace.set(spaceId, (dueBySpace.get(spaceId) ?? 0) + 1);
        dueTotal++;
      }
    }

    // 5. History: logs, tests, cognitive, games
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
        // PostgREST sorts NULLs first by default.
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

    // 6. Assemble
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

    // Weakest assessed concepts across every space. Unassessed are excluded (they'd sort below every
    // struggling concept).
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

    // Assert the anchor invariant.
    if (curve && Math.abs(curve.points[curve.points.length - 1].m_doc - overall) > 1e-9) {
      console.error(
        `[Dashboard] curve endpoint ${curve.points[curve.points.length - 1].m_doc} != overall ${overall} ` +
          `for student=${studentId}`
      );
    }

    // Audit-trail gaps are logged, never shown.
    warnOnLogGaps(rowsInScope, logRows ?? [], studentId);

    const resumeRow = (inProgress ?? [])[0];
    const resume_test = resumeRow
      ? {
          id: resumeRow.id as string,
          title: (resumeRow.title as string) ?? 'Practice test',
          space_id: resumeRow.space_id as string,
          space_title: titleOfSpace.get(resumeRow.space_id as string) ?? '',
          // questions_payload holds the answer key: count questions only, never serialise it.
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
          // null, not 0.10, when nothing is assessed.
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
    // Passed through: an empty dashboard says nothing about the streak.
    gamification,
    counts: { spaces: spaceCount, materials: 0 },
  };
}

/** Warns when a concept's newest audit row disagrees with stored mastery. Server log only. */
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
