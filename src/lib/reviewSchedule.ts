/**
 * Client mirror of server/lib/reviewSchedule.ts, for display and session composition only.
 * The server decides whether a rating counts.
 */

/** Due if overdue or never scheduled (cards are born due). */
export function isDue(nextReviewAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!nextReviewAt) return true;
  const due = new Date(nextReviewAt).getTime();
  return Number.isNaN(due) || due <= now;
}

/** A self-rating; mirrors the server type and the ease_rating CHECK. */
export type EaseRating = 'easy' | 'medium' | 'hard';
