/**
 * The student dashboard's wire types and its one API call.
 *
 * Its own module for the same reason `mastery.ts` is: the dashboard reads across
 * every feature — mastery, flashcards, tests, cognitive attempts, games — so
 * filing it under any one of them would be arbitrary.
 *
 * IT DECLARES NO MASTERY LOGIC. `masteryTier`, `masteryPercent`, `TIER_TONE`,
 * `TIER_LABEL`, `masteryCaption`, `relativeTime` and `P_L0` all come from
 * `mastery.ts` and are re-exported here only for convenience. A second copy of a
 * tier threshold is the drift this codebase keeps warning about.
 *
 * THE ONE RULE, inherited verbatim from `mastery.ts`: a concept with no
 * `bkt_mastery` row sits at P(L₀) = 0.10, which is an ASSUMPTION, not a
 * measurement. `overall` is `null` when nothing has been assessed precisely so
 * that the prior cannot be printed as a score. Gate on `concepts_assessed`,
 * never on the value.
 */

import { api } from './api';
import type { DifficultyTier } from './mastery';

export type { DifficultyTier };

export interface SpaceMasteryRow {
  space_id: string;
  title: string;
  subject: string;
  /** EQ(4) over this space's own concepts. */
  m_doc: number;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  material_count: number;
  due_count: number;
}

/**
 * One reconstructed point on the mastery curve.
 *
 * `t` is a LEARNING-OPPORTUNITY INDEX, not a timestamp — that is the x axis. Every
 * update in one study session shares a timestamp to the millisecond, so a
 * time-based axis renders a real day as a vertical line; and because BKT has no
 * forgetting term, a two-week gap is a perfectly flat segment that reads as "you
 * stalled" when the model simply had no evidence. `at` is carried for date
 * context under the axis, not for positioning.
 */
export interface CurvePoint {
  t: number;
  at: string;
  m_doc: number;
}

export interface MasteryCurveData {
  /** Ascending. The LAST point equals `mastery.overall` by construction. */
  points: CurvePoint[];
  /** Updates inside the window. May be below the student's total row count when
   *  some belong to concepts no longer visible — expected, not a bug. */
  total_updates: number;
  /** 1 = every update plotted; k = every k-th. */
  stride: number;
  /** The window hit its cap, so the curve begins mid-history rather than at cold start. */
  truncated: boolean;
}

export interface FocusConcept {
  concept_id: string;
  term: string;
  /** Always a real measurement — unassessed concepts never reach this list. */
  mastery: number;
  opportunity_count: number;
  material_id: string;
  material_title: string;
  space_id: string;
  space_title: string;
}

export interface ResumeTest {
  id: string;
  title: string;
  space_id: string;
  space_title: string;
  total: number;
  answered: number;
  created_at: string;
}

export type ActivityItem =
  | { kind: 'test'; id: string; at: string; space_id: string; space_title: string; title: string; score: number }
  | { kind: 'free_recall'; id: string; at: string; space_id: string; space_title: string }
  | { kind: 'feynman'; id: string; at: string; space_id: string; space_title: string }
  | {
      kind: 'game';
      id: string;
      at: string;
      /** Null when the space has since been deleted — `ON DELETE SET NULL`. */
      space_id: string | null;
      space_title: string | null;
      game_type: string;
      accuracy: number | null;
    };

export interface EarnedBadge {
  /** Catalogue key from `server/lib/badges.ts`. Resolve it via `badgeStyle()`. */
  name: string;
  awarded_at: string;
}

/**
 * Distance to one badge the student has NOT yet earned.
 *
 * Only countable rules appear — streaks, mastery counts and `cards_100`. The
 * rest have no partial state (`first_*` is a single act, `perfect_test` and
 * `flawless_game` are outcomes of one session), so the gallery draws a bar iff a
 * row exists here rather than deciding for itself.
 *
 * ⚠️ The `mastery_*` rows will NOT agree with `mastery.concepts_mastered` when a
 * mastered concept sits on an archived or unlinked material. Correct, not drift:
 * this comes from the badge rule's own source, so the bar shows the count the
 * evaluator actually checks. Never substitute the dashboard's figure.
 */
export interface BadgeProgressRow {
  name: string;
  /** Already clamped server-side, so it never exceeds `target`. */
  current: number;
  target: number;
}

/**
 * Streaks and badges. Mirrors `GamificationBlock` in `dashboard.routes.ts`.
 *
 * `total_study_hours` is deliberately absent from BOTH sides. It is written, but
 * only games and adaptive tests carry a real duration — flashcards, the two
 * cognitive modes and chat measure nothing — so the figure is a partial sum that
 * would read as a total. Do not add it here without real timing behind it.
 */
export interface GamificationBlock {
  day_streak: number;
  /** Best run ever. Badges are awarded off this, so it never decreases. */
  longest_streak: number;
  /** Asia/Manila calendar date, not a timestamp. Null until the first activity. */
  last_active_on: string | null;
  /** Earned only. The catalogue itself is client-side — see `src/lib/badges.ts`. */
  badges: EarnedBadge[];
  /** Unearned countable badges only. Empty once they are all held. */
  badge_progress: BadgeProgressRow[];
}

export interface DashboardData {
  mastery: {
    /** EQ(4) across every concept in every space. `null` when nothing is assessed. */
    overall: number | null;
    tier: DifficultyTier;
    concepts_total: number;
    concepts_assessed: number;
    /** Assessed and at or above 0.85. */
    concepts_mastered: number;
    /** Flashcard ratings + test items combined. Call these "attempts". */
    total_attempts: number;
    last_updated: string | null;
    /**
     * ⚠️ These do NOT average to `overall`. The global figure is over the UNION of
     * materials (deduplicated), so a material in two spaces contributes its
     * concepts once; each row here is over its own space's set, where it
     * contributes to both. Correct — mastery is per (student, concept).
     */
    by_space: SpaceMasteryRow[];
  };
  /** `null` when nothing is assessed or fewer than two points exist. */
  curve: MasteryCurveData | null;
  /** Weakest ASSESSED concepts across every space, ascending. */
  focus: FocusConcept[];
  flashcards_due: number;
  resume_test: ResumeTest | null;
  recent: ActivityItem[];
  gamification: GamificationBlock;
  counts: { spaces: number; materials: number };
}

export const dashboardApi = {
  /** Everything the dashboard renders, in one request. */
  async load(): Promise<DashboardData> {
    const res = await api.get<DashboardData>('/dashboard');
    return res.data;
  },
};
