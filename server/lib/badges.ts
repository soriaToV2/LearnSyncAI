import { supabaseAdmin } from './supabase';
import type { ActivityType } from './activity';

/**
 * The badge catalogue and its evaluator.
 *
 * ══ WHY THERE IS NO `badges` TABLE ══
 * `user_badges.badge_name` is bare TEXT by deliberate schema choice, so the
 * catalogue lives here. A table nobody can edit is a constant with extra steps,
 * and building an editor for it would repeat the `educator_assignments` mistake
 * — built, then removed as going beyond the specification. `UNIQUE (student_id,
 * badge_name)` is what makes awarding idempotent, so this module never needs to
 * read-then-write.
 *
 * ══ `name` IS THE IDENTITY. NEVER RENAME ONE. ══
 * The string is written into the database. Changing `streak_3` to `streak_three`
 * does not migrate anyone — it silently re-awards the badge to every student who
 * already held it, under a second name, and leaves the first one orphaned in
 * rows the client can no longer label. `label` and `description` are free to
 * change; `name` is not.
 *
 * ══ THRESHOLDS ARE SIZED TO THE STUDY ══
 * Streaks are 3 / 5 / 7 for a two-week study. A badge nobody can reach is worse
 * than no badge: it renders permanently grey and reads as a feature that does
 * not work. If the study lengthens, `STREAK_THRESHOLDS` is the one edit.
 */

/** What a badge is awarded FOR. Drives grouping in the UI, nothing in the logic. */
export type BadgeFamily = 'streak' | 'mastery' | 'first' | 'performance';

export interface BadgeDef {
  /** Written to `user_badges.badge_name`. NEVER change once live. */
  name: string;
  label: string;
  description: string;
  family: BadgeFamily;
  /**
   * Which activity types can possibly unlock this badge. The evaluator only
   * considers a rule when the activity just logged is in this list, so a
   * flashcard rating never runs the "first adaptive test" check.
   */
  triggers: ActivityType[];
}

export interface AwardedBadge {
  name: string;
  awarded_at: string;
}

/** Mastery at or above this counts as "mastered" — the `advanced` tier threshold. */
const MASTERED_AT = 0.85;

/**
 * Sized to a ~2-week study. 14 was considered and dropped: with a fortnight of
 * access it is unreachable, and an unearnable badge is a permanently grey tile
 * that reads as broken.
 */
export const STREAK_THRESHOLDS = [3, 5, 7] as const;

const MASTERY_THRESHOLDS = [1, 10, 25] as const;

/** Reviewed-card count behind `cards_100`. */
const CENTURY_AT = 100;

/** Every activity type. Streak badges are unlocked by studying, whatever the form. */
const ANY: ActivityType[] = ['flashcard', 'free_recall', 'feynman', 'adaptive_test', 'game', 'chat'];

/**
 * The 14 badges.
 *
 * `chat` deliberately has no first-time badge. It counts toward a streak — the
 * `activity_type` enum committed to that, and a student whose only session that
 * day was the chatbot should not lose their run — but it is by far the cheapest
 * activity to farm, and rewarding one question with a permanent trophy invites
 * exactly that.
 */
export const BADGES: readonly BadgeDef[] = [
  // ── Streak ────────────────────────────────────────────────────────────────
  // Read off gamification_profiles.longest_streak, which the DB trigger has
  // already written by the time the evaluator runs. Zero extra queries.
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

  // ── First-time ────────────────────────────────────────────────────────────
  // No query at all: the activity being logged IS the evidence, and the UNIQUE
  // constraint makes the second attempt a no-op. These are the only badges a
  // brand-new account can earn on day one, which matters for a short study.
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

  // ── Mastery ───────────────────────────────────────────────────────────────
  // Triggered only by the two interaction modes permitted to MOVE mastery
  // (paper p. 58). A game or a chat turn cannot change the count, so checking
  // after one would be a query guaranteed to find nothing new.
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

  // ── Performance ───────────────────────────────────────────────────────────
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

/** Presentation lookup for anything server-side that needs a label. */
export function badgeDef(name: string): BadgeDef | undefined {
  return BY_NAME.get(name);
}

/** Facts a rule may need, gathered lazily and at most once per evaluation. */
interface Evidence {
  longestStreak: number | null;
  masteredCount: number | null;
  flashcardCount: number | null;
}

/**
 * Every badge whose rule is "reach N", with the counter it reads.
 *
 * ══ ONE HOME PER THRESHOLD ══
 * Read by BOTH `satisfied()`, which decides whether a badge is earned, and
 * `badgeProgress()`, which tells a student how far off they are. These were
 * separate before the badge gallery existed, and a second copy of `100` or
 * `[1, 10, 25]` is exactly the drift that would let a progress bar read "99/100"
 * beside a badge the evaluator had already awarded.
 *
 * A badge absent from this table has no partial state — `first_*` is a single
 * act, and `perfect_test`/`flawless_game` are outcomes of one session. The
 * gallery shows those as criteria text with no bar, which is why membership
 * here is what decides whether a bar is drawn at all.
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
 * Awards every badge whose rule the student now satisfies, and returns only the
 * ones that actually landed.
 *
 * ══ THE ORDER IS WHAT KEEPS THIS CHEAP ══
 * This runs after EVERY study interaction, including each individual flashcard
 * rating — thirty per deck in a normal session. So:
 *
 *   1. One indexed read of the badges already held.
 *   2. Narrow the catalogue to (not held) ∧ (triggered by this activity type).
 *   3. If nothing survives, RETURN. Zero further queries.
 *
 * Step 3 is the steady state. Once a student holds the badges reachable from an
 * activity, that activity costs exactly one indexed lookup forever after — and
 * every rule needing a COUNT stops running the moment its badge is earned.
 *
 * ══ NEVER THROWS ══
 * Same contract as `logActivity()`, which is its only caller. A badge is a
 * reward; failing to award one must never surface to the student, and there is
 * nothing they could do about it if it did.
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

    // The common case for an established student. Nothing below runs.
    if (candidates.length === 0) return [];

    const evidence = await gatherEvidence(studentId, candidates);
    const earned = candidates.filter((b) => satisfied(b, evidence, outcome)).map((b) => b.name);

    if (earned.length === 0) return [];

    /*
     * ON CONFLICT DO NOTHING via `ignoreDuplicates`, and `.select()` so the
     * return value is what actually landed rather than what was attempted.
     *
     * The conflict is reachable in practice, not just in theory: two tabs, or a
     * double-submitted answer, can evaluate the same rule concurrently and both
     * read an empty `held` set. The UNIQUE constraint is the arbiter, which is
     * why no read-then-write lock is needed here.
     */
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

/**
 * Fetches only the facts the surviving candidates actually need — at most three
 * reads, usually zero or one. A first-time or outcome-driven badge needs none.
 */
async function gatherEvidence(studentId: string, candidates: readonly BadgeDef[]): Promise<Evidence> {
  const evidence: Evidence = { longestStreak: null, masteredCount: null, flashcardCount: null };
  const names = new Set(candidates.map((b) => b.name));

  const needsStreak = candidates.some((b) => b.family === 'streak');
  const needsMastery = candidates.some((b) => b.family === 'mastery');
  const needsCards = names.has('cards_100');

  // PromiseLike, not Promise: a Supabase query builder is a thenable, and
  // calling .then() on one yields PromiseLike rather than a real Promise.
  const reads: PromiseLike<void>[] = [];

  if (needsStreak) {
    /*
     * `longest_streak`, NOT `day_streak`. A streak badge records a best-ever
     * run, so it must be permanent. Reading `day_streak` would be equivalent
     * today — badge rows are never deleted — but the rule and the badge would
     * then disagree the moment anyone read them together, and a student who
     * broke a 7-day run would see "Week Warrior" beside a current streak of 1
     * with no way to tell which was lying.
     *
     * Safe to read immediately after the activity insert: trigger_update_streak
     * is AFTER INSERT in the same transaction, so the profile is already
     * updated by the time that insert resolves. It looks racy and is not.
     */
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
    /*
     * Counted over `activity_logs`, NOT `spaced_repetition_logs`. The latter
     * gets no row for a practice rating on an un-due card, so the two tables
     * disagree about what "reviewed" means — and the streak the student is
     * looking at is built from activity_logs. One source for every "N times"
     * rule.
     */
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

/** The rule for one badge. Anything it cannot verify is false, never assumed. */
function satisfied(badge: BadgeDef, evidence: Evidence, outcome: EvaluateInput['outcome']): boolean {
  // Every "reach N" rule — streaks, mastery counts and cards_100 — lives in one
  // table so the threshold checked here is the threshold the gallery draws.
  const countable = COUNTABLE[badge.name];
  if (countable) return (countable.of(evidence) ?? 0) >= countable.target;

  switch (badge.name) {
    // The activity itself is the evidence — it was just written, and the badge
    // is not yet held, so this IS the first one.
    case 'first_flashcard':
    case 'first_test':
    case 'first_recall':
    case 'first_feynman':
    case 'first_game':
      return true;

    // Strict equality on a server-computed ratio. `>= 1` would be identical
    // today, but both are bounded at 1 by construction and a value above it is
    // a bug that should not quietly award a trophy.
    case 'perfect_test':
      return outcome?.score === 1;
    case 'flawless_game':
      return outcome?.accuracy === 1;

    default:
      return false;
  }
}

/** How far a student is from one unearned badge. Countable rules only. */
export interface BadgeProgress {
  name: string;
  /** Clamped to `target` — a locked badge must never read "12 / 10". */
  current: number;
  target: number;
}

/**
 * Progress toward every COUNTABLE badge the student does not yet hold, for the
 * dashboard's badge gallery.
 *
 * ══ IT READS THE EVALUATOR'S SOURCES, NOT THE DASHBOARD'S ══
 * `gatherEvidence()` unchanged, so the number a student is shown is the number
 * the rule reads. That matters most for mastery: this counts EVERY `bkt_mastery`
 * row at or above 0.85, including concepts on materials since archived or
 * unlinked, whereas the dashboard's own "Concepts mastered" stat counts only
 * currently-visible ones. Feeding the gallery the visible figure would show
 * "8 / 10" beside a badge the rule already considers satisfied at 12.
 *
 * ══ SAME EARLY EXIT AS THE EVALUATOR ══
 * Once a student holds all seven countable badges this issues ZERO queries, so
 * an established account pays nothing for the feature on every dashboard load.
 *
 * ══ NEVER THROWS ══
 * Same contract as `evaluateBadges()`. A missing progress bar must never cost a
 * student their dashboard.
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
