/**
 * Spaced repetition scheduling — the one place intervals and due-ness are defined.
 *
 * They were previously defined in four places that disagreed: ARCHITECTURE.md §4,
 * the spaced_repetition_logs comment and the study view's button label all said
 * Easy = 7 days, while the rate route and the results screen said 4. The database
 * settles it — `interval_days` is CHECK (interval_days IN (1, 3, 7)), so 4 could
 * never have been written at all.
 */

export type EaseRating = 'easy' | 'medium' | 'hard';

/** Leitner tiers from ARCHITECTURE.md §4. Must stay within the CHECK constraint. */
export const REVIEW_INTERVALS: Record<EaseRating, 1 | 3 | 7> = {
  easy: 7,
  medium: 3,
  hard: 1,
};

/**
 * Philippine Standard Time, fixed at UTC+8.
 *
 * A constant offset rather than a timezone library because the Philippines has
 * observed no daylight saving since 1978, and the platform serves one school in
 * Pasig. If it ever serves more than one timezone, this becomes a per-profile
 * setting rather than a constant.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The UTC instant of midnight in Manila, `days` days after `now`.
 *
 * Day boundaries, not `now + N × 24h`. A student who rates a card at 8pm on
 * Monday and revises after school on Tuesday must find it waiting — with exact
 * 24-hour intervals it would not appear until 8pm Tuesday, and the deck would
 * look broken.
 */
export function nextReviewAt(now: Date, days: number): Date {
  // Shift into the Manila frame so getUTC* reads local wall-clock parts.
  const local = new Date(now.getTime() + MANILA_OFFSET_MS);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + days
  );
  return new Date(localMidnight - MANILA_OFFSET_MS);
}

/**
 * Whether a card is ready to be reviewed — the single rule the whole feature
 * rests on. A rating counts only when this is true.
 *
 * `<=` rather than `===` a date, so an overdue card still counts: a student who
 * misses three days must not be locked out of the cards that were waiting.
 *
 * Null reads as due. The column defaults to now() so it should never be null,
 * but a card that somehow lost its schedule should be reviewable, not stranded.
 */
export function isDue(nextReviewAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!nextReviewAtIso) return true;
  const due = new Date(nextReviewAtIso);
  if (Number.isNaN(due.getTime())) return true;
  return due.getTime() <= now.getTime();
}
