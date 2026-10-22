/**
 * Student dashboard wire types and its API call. Mastery helpers are re-exported from mastery.ts.
 * `overall` is null when nothing is assessed, so the prior is never printed; gate on concepts_assessed.
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

/** One curve point. `t` is a learning-opportunity index (the x axis), not a timestamp; `at` is for date labels. */
export interface CurvePoint {
  t: number;
  at: string;
  m_doc: number;
}

export interface MasteryCurveData {
  /** Ascending; the last point equals `mastery.overall`. */
  points: CurvePoint[];
  /** Updates in the window; can be below the row count (invisible concepts are dropped). */
  total_updates: number;
  /** 1 = every update plotted; k = every k-th. */
  stride: number;
  /** Hit the cap: the curve starts mid-history. */
  truncated: boolean;
}

export interface FocusConcept {
  concept_id: string;
  term: string;
  /** Assessed concepts only. */
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
      /** Null when the space was deleted. */
      space_id: string | null;
      space_title: string | null;
      game_type: string;
      accuracy: number | null;
    };

export interface EarnedBadge {
  /** Catalogue key; resolve via badgeStyle(). */
  name: string;
  awarded_at: string;
}

/**
 * Distance to an unearned countable badge (the gallery draws a bar only for these). `mastery_*` uses
 * the badge rule's own source, so it can differ from `mastery.concepts_mastered`.
 */
export interface BadgeProgressRow {
  name: string;
  /** Clamped server-side. */
  current: number;
  target: number;
}

/** Streaks and badges; mirrors GamificationBlock. No total_study_hours: most activities record no duration. */
export interface GamificationBlock {
  day_streak: number;
  /** Best run ever (badges use this). */
  longest_streak: number;
  /** Asia/Manila date; null until the first activity. */
  last_active_on: string | null;
  /** Earned only. */
  badges: EarnedBadge[];
  /** Unearned countable badges. */
  badge_progress: BadgeProgressRow[];
}

export interface DashboardData {
  mastery: {
    /** EQ(4) across every space; null when nothing is assessed. */
    overall: number | null;
    tier: DifficultyTier;
    concepts_total: number;
    concepts_assessed: number;
    /** Assessed and at or above 0.85. */
    concepts_mastered: number;
    /** Flashcard ratings + test items ("attempts"). */
    total_attempts: number;
    last_updated: string | null;
    /** These don't average to `overall`, which is over the deduplicated union of materials. */
    by_space: SpaceMasteryRow[];
  };
  /** null when nothing is assessed or there are fewer than two points. */
  curve: MasteryCurveData | null;
  /** Weakest assessed concepts across every space. */
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
