/** Spaced repetition: the only place intervals and due-ness are defined. */

export type EaseRating = 'easy' | 'medium' | 'hard';

/** Must match CHECK (interval_days IN (1, 3, 7)). */
export const REVIEW_INTERVALS: Record<EaseRating, 1 | 3 | 7> = {
  easy: 7,
  medium: 3,
  hard: 1,
};

/** Philippine time, UTC+8 (no DST). */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Midnight in Manila `days` days after `now`, so cards are due from the start of the day. */
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

/** A rating counts only when this is true. Overdue and null schedules count as due. */
export function isDue(nextReviewAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!nextReviewAtIso) return true;
  const due = new Date(nextReviewAtIso);
  if (Number.isNaN(due.getTime())) return true;
  return due.getTime() <= now.getTime();
}
