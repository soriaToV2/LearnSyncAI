import { supabaseAdmin } from './supabase';
import type { ActivityType } from './activity';

/**
 * Badge catalogue and evaluator. There is no `badges` table; `UNIQUE (student_id, badge_name)`
 * makes awarding idempotent.
 */

/** UI grouping only. */
export type BadgeFamily = 'streak' | 'mastery' | 'first' | 'performance';

export interface BadgeDef {
  /** Stored in `user_badges.badge_name`. Never rename: it would re-award under a new name. */
  name: string;
  label: string;
  description: string;
  family: BadgeFamily;
  /** Activity types that can unlock this badge; other activities skip the rule. */
  triggers: ActivityType[];
}

export interface AwardedBadge {
  name: string;
  awarded_at: string;
}

/** The `advanced` tier threshold. */
const MASTERED_AT = 0.85;

/** Sized to the ~2-week study; an unreachable badge reads as broken. */
export const STREAK_THRESHOLDS = [3, 5, 7] as const;

const MASTERY_THRESHOLDS = [1, 10, 25] as const;

const CENTURY_AT = 100;

const ANY: ActivityType[] = ['flashcard', 'free_recall', 'feynman', 'adaptive_test', 'game', 'chat'];

/** Chat counts toward streaks but has no first-time badge (too cheap to farm). */
export const BADGES: readonly BadgeDef[] = [
  // Streak (from gamification_profiles.longest_streak)
  {
    name: 'streak_3',
    label: 'Getting Started',
    description: 'Studied three days in a row.',
    family: 'streak',
    triggers: ANY,
  },
  {
    name: 'streak_5',
    label: 'On a Roll',
    description: 'Studied five days in a row.',
    family: 'streak',
    triggers: ANY,
  },
  {
    name: 'streak_7',
    label: 'Week Warrior',
    description: 'Studied seven days in a row.',
    family: 'streak',
    triggers: ANY,
  },

  // First-time: the activity being logged is the evidence.
  {
    name: 'first_flashcard',
    label: 'First Review',
    description: 'Reviewed your first flashcard.',
    family: 'first',
    triggers: ['flashcard'],
  },
  {
    name: 'first_test',
    label: 'First Test',
    description: 'Finished your first adaptive test.',
    family: 'first',
    triggers: ['adaptive_test'],
  },
  {
    name: 'first_recall',
    label: 'First Recall',
    description: 'Completed your first free recall.',
    family: 'first',
    triggers: ['free_recall'],
  },
  {
    name: 'first_feynman',
    label: 'First Explanation',
    description: 'Explained your first concept in your own words.',
    family: 'first',
    triggers: ['feynman'],
  },
  {
    name: 'first_game',
    label: 'First Game',
    description: 'Played your first study game.',
    family: 'first',
    triggers: ['game'],
  },

  // Mastery: only the two modes that can move mastery trigger these (paper p. 58).
  {
    name: 'mastery_1',
    label: 'First Mastery',
    description: 'Reached 85% mastery on your first concept.',
    family: 'mastery',
    triggers: ['flashcard', 'adaptive_test'],
  },
  {
    name: 'mastery_10',
    label: 'Ten Mastered',
    description: 'Reached 85% mastery on ten concepts.',
    family: 'mastery',
    triggers: ['flashcard', 'adaptive_test'],
  },
  {
    name: 'mastery_25',
    label: 'Twenty-Five Mastered',
    description: 'Reached 85% mastery on twenty-five concepts.',
    family: 'mastery',
    triggers: ['flashcard', 'adaptive_test'],
  },

  // Performance
  {
    name: 'perfect_test',
    label: 'Perfect Score',
    description: 'Answered every question on an adaptive test correctly.',
    family: 'performance',
    triggers: ['adaptive_test'],
  },
  {
    name: 'flawless_game',
    label: 'Flawless',
    description: 'Finished a study game without a single mistake.',
    family: 'performance',
    triggers: ['game'],
  },
  {
    name: 'cards_100',
    label: 'Century',
    description: 'Reviewed one hundred flashcards.',
    family: 'performance',
    triggers: ['flashcard'],
  },
];

const BY_NAME = new Map(BADGES.map((b) => [b.name, b]));

export function badgeDef(name: string): BadgeDef | undefined {
  return BY_NAME.get(name);
}

/** Facts a rule may need, gathered at most once per evaluation. */
interface Evidence {
  longestStreak: number | null;
  masteredCount: number | null;
  flashcardCount: number | null;
}

/**
 * Every "reach N" badge and its counter. The single source for both `satisfied()` and
 * `badgeProgress()`; a badge not listed has no progress bar.
 */
const COUNTABLE: Record<string, { target: number; of: (e: Evidence) => number | null }> = {
  streak_3: { target: STREAK_THRESHOLDS[0], of: (e) => e.longestStreak },
  streak_5: { target: STREAK_THRESHOLDS[1], of: (e) => e.longestStreak },
  streak_7: { target: STREAK_THRESHOLDS[2], of: (e) => e.longestStreak },
  mastery_1: { target: MASTERY_THRESHOLDS[0], of: (e) => e.masteredCount },
  mastery_10: { target: MASTERY_THRESHOLDS[1], of: (e) => e.masteredCount },
  mastery_25: { target: MASTERY_THRESHOLDS[2], of: (e) => e.masteredCount },
  cards_100: { target: CENTURY_AT, of: (e) => e.flashcardCount },
};

export interface EvaluateInput {
  studentId: string;
  type: ActivityType;
  /** Server-computed outcome of the activity just logged. Never client-supplied. */
  outcome?: { score?: number; accuracy?: number };
}

/**
 * Awards newly satisfied badges and returns those that landed. Never throws.
 * Runs after every activity, so it reads held badges first and returns before any other
 * query when no candidate remains. Don't add a rule that queries before that filter.
 */
export async function evaluateBadges(input: EvaluateInput): Promise<AwardedBadge[]> {
  const { studentId, type, outcome } = input;

  try {
    const { data: held, error: heldError } = await supabaseAdmin
      .from('user_badges')
      .select('badge_name')
      .eq('student_id', studentId);

    if (heldError) {
      console.error(`[Badges] could not read held badges for student=${studentId}:`, heldError.message);
      return [];
    }

    const heldNames = new Set((held ?? []).map((row) => row.badge_name as string));
    const candidates = BADGES.filter((b) => !heldNames.has(b.name) && b.triggers.includes(type));

    if (candidates.length === 0) return [];

    const evidence = await gatherEvidence(studentId, candidates);
    const earned = candidates.filter((b) => satisfied(b, evidence, outcome)).map((b) => b.name);

    if (earned.length === 0) return [];

    // ON CONFLICT DO NOTHING; the UNIQUE constraint settles concurrent awards. `.select()` returns what landed.
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('user_badges')
      .upsert(
        earned.map((name) => ({ student_id: studentId, badge_name: name })),
        { onConflict: 'student_id,badge_name', ignoreDuplicates: true }
      )
      .select('badge_name, awarded_at');

    if (insertError) {
      console.error(`[Badges] award failed for student=${studentId}:`, insertError.message);
      return [];
    }

    return (inserted ?? []).map((row) => ({
      name: row.badge_name as string,
      awarded_at: row.awarded_at as string,
    }));
  } catch (err) {
    console.error(
      `[Badges] evaluator threw for student=${studentId} type=${type}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Fetches only the facts the remaining candidates need. */
async function gatherEvidence(studentId: string, candidates: readonly BadgeDef[]): Promise<Evidence> {
  const evidence: Evidence = { longestStreak: null, masteredCount: null, flashcardCount: null };
  const names = new Set(candidates.map((b) => b.name));

  const needsStreak = candidates.some((b) => b.family === 'streak');
  const needsMastery = candidates.some((b) => b.family === 'mastery');
  const needsCards = names.has('cards_100');

  // Supabase builders are thenables, so .then() yields PromiseLike.
  const reads: PromiseLike<void>[] = [];

  if (needsStreak) {
    // longest_streak, not day_streak: streak badges record a best-ever run.
    // Not racy: the streak trigger has already run when the activity insert resolves.
    reads.push(
      supabaseAdmin
        .from('gamification_profiles')
        .select('longest_streak')
        .eq('student_id', studentId)
        .maybeSingle()
        .then(({ data }) => {
          evidence.longestStreak = data ? Number(data.longest_streak) : 0;
        })
    );
  }

  if (needsMastery) {
    reads.push(
      supabaseAdmin
        .from('bkt_mastery')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .gte('latent_mastery', MASTERED_AT)
        .then(({ count }) => {
          evidence.masteredCount = count ?? 0;
        })
    );
  }

  if (needsCards) {
    // activity_logs is the single source for every "N times" rule.
    reads.push(
      supabaseAdmin
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .eq('activity_type', 'flashcard')
        .then(({ count }) => {
          evidence.flashcardCount = count ?? 0;
        })
    );
  }

  await Promise.all(reads);
  return evidence;
}

/** The rule for one badge. Anything unverifiable is false. */
function satisfied(badge: BadgeDef, evidence: Evidence, outcome: EvaluateInput['outcome']): boolean {
  const countable = COUNTABLE[badge.name];
  if (countable) return (countable.of(evidence) ?? 0) >= countable.target;

  switch (badge.name) {
    // Not yet held, and the activity was just logged, so this is the first.
    case 'first_flashcard':
    case 'first_test':
    case 'first_recall':
    case 'first_feynman':
    case 'first_game':
      return true;

    // Strict equality: a ratio above 1 is a bug and must not award a badge.
    case 'perfect_test':
      return outcome?.score === 1;
    case 'flawless_game':
      return outcome?.accuracy === 1;

    default:
      return false;
  }
}

export interface BadgeProgress {
  name: string;
  /** Clamped to `target`. */
  current: number;
  target: number;
}

/**
 * Progress toward each unheld countable badge, for the gallery. Never throws.
 * Reads the evaluator's sources (gatherEvidence), not the dashboard's, so the bar matches the rule.
 */
export async function badgeProgress(
  studentId: string,
  held: ReadonlySet<string>
): Promise<BadgeProgress[]> {
  const candidates = BADGES.filter((b) => !held.has(b.name) && b.name in COUNTABLE);
  if (candidates.length === 0) return [];

  try {
    const evidence = await gatherEvidence(studentId, candidates);

    return candidates.map((badge) => {
      const rule = COUNTABLE[badge.name];
      return {
        name: badge.name,
        current: Math.min(rule.of(evidence) ?? 0, rule.target),
        target: rule.target,
      };
    });
  } catch (err) {
    console.error(
      `[Badges] progress read threw for student=${studentId}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
