/**
 * Client-side mirror of `server/lib/reviewSchedule.ts`.
 *
 * **The server remains the authority.** `POST /api/flashcards/rate` decides
 * whether a rating actually counts and reschedules the card; this only decides
 * what to *show* and which cards a session opens with. If the two ever
 * disagree, the server is right.
 *
 * It lives here rather than inside a tab because more than one screen needs it:
 * `FlashcardsTab` composes sessions and labels cards, and `StudySpace` counts
 * due cards for the tab badge. A tab exporting a utility up to its own parent
 * is backwards, and two copies of a scheduling rule drift.
 */

/**
 * Is this card due for review?
 *
 * `<=` rather than `<` so overdue cards still count as due. A null date means
 * the card has never been scheduled — `flashcards.next_review_at` defaults to
 * `now()`, so a freshly generated card is born due and its first honest pass is
 * the one that counts.
 */
export function isDue(nextReviewAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!nextReviewAt) return true;
  const due = new Date(nextReviewAt).getTime();
  return Number.isNaN(due) || due <= now;
}
