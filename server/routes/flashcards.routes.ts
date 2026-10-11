import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { RateFlashcardSchema } from '../types/api';
import { REVIEW_INTERVALS, nextReviewAt, isDue } from '../lib/reviewSchedule';
import { applyFlashcardRating, bktProblems } from '../lib/bkt';
import { logActivity } from '../lib/activity';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * POST /api/flashcards/rate
 *
 * Records a spaced repetition rating.
 *
 * THE RULE: a rating reschedules the card if and only if the card was DUE when
 * it was rated. Nothing else about the request matters — not which session it
 * came from, not whether the student called it practice.
 *
 * That one check covers every case for free. A card re-drilled thirty seconds
 * after being rated is no longer due, so the second rating is ignored; without
 * this a student could rate Hard, immediately rate Easy after reading the
 * answer, and push the card a week out on the strength of their short-term
 * memory.
 *
 * THAT PROTECTION NOW GUARDS BKT MASTERY TOO, which is the more important half.
 * This is one of the two writers paper p. 58 permits (`practice.routes.ts` is
 * the other), and without the due-check mastery would climb fastest on exactly
 * the concepts a student re-drills BECAUSE they are struggling — while BKT
 * assumes each observation is an independent test of latent knowledge, which a
 * re-read thirty seconds later is not. Do not relax it.
 *
 * The client is never trusted to decide this. It posts every rating; the server
 * answers `counted` and the UI reports what actually happened. The client no
 * longer OFFERS a session over cards that are not due (there is no practice
 * mode), but that is a courtesy — this check remains the guarantee, for a stale
 * second tab and for any request not made by our UI.
 *
 * Ratings map to observations per paper pp. 78-79: Easy and Medium both record a
 * CORRECT answer (obs = 1) differing only in P(G); Hard records an INCORRECT one
 * (obs = 0). Hard is not a weak pass.
 *
 * Body: { flashcard_id: UUID, rating: 'easy' | 'medium' | 'hard' }
 */
router.post('/rate', async (req: Request, res: Response): Promise<void> => {
  const parsed = RateFlashcardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { flashcard_id, rating } = parsed.data;
  const studentId = req.user!.id;

  // 1. Ownership: card → deck → space → this student.
  //
  // 404 rather than 403 on every miss, matching the space routes, so a card id
  // cannot be probed for existence. Without this any student could reschedule a
  // stranger's cards by id — and, once BKT lands, write mastery against them.
  const { data: card } = await supabaseAdmin
    .from('flashcards')
    .select('id, deck_id, concept_id, source_material_id, next_review_at')
    .eq('id', flashcard_id)
    .maybeSingle();

  if (!card) {
    res.status(404).json({ error: 'Flashcard not found' });
    return;
  }

  const { data: deck } = await supabaseAdmin
    .from('flashcard_decks')
    .select('id, space_id')
    .eq('id', card.deck_id)
    .maybeSingle();

  if (!deck) {
    res.status(404).json({ error: 'Flashcard not found' });
    return;
  }

  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('id, student_id')
    .eq('id', deck.space_id)
    .maybeSingle();

  if (!space || space.student_id !== studentId) {
    res.status(404).json({ error: 'Flashcard not found' });
    return;
  }

  // 2. Due check. Not due → write nothing at all: no schedule, no BKT
  // observation, and no activity row.
  //
  // ⚠️ NO `logActivity()` HERE, AND THAT IS A REVERSAL. This branch used to log,
  // so a student with nothing due could keep a streak by practising. Practice
  // sessions were removed from the client (2026-10-11: a session holds only due
  // cards), so a not-due rating now comes only from a stale second tab or a
  // hand-made request — neither of which should earn a streak day or count
  // toward `cards_100`. A flashcard activity means a due review.
  const now = new Date();
  if (!isDue(card.next_review_at, now)) {
    res.status(200).json({
      data: {
        flashcard_id,
        rating,
        counted: false,
        next_review_at: card.next_review_at,
      },
      message: "Not due — this card's schedule is unchanged.",
    });
    return;
  }

  // 3. Schedule — as a COMPARE-AND-SWAP, which is what makes the due-check
  // hold under a double-tap.
  //
  // The `isDue` test above reads a row fetched a moment earlier, so two racing
  // requests both see the card as due and both fall through. Re-asserting
  // due-ness inside the UPDATE lets Postgres serialise them: the first moves
  // `next_review_at` into the future, the second matches nothing, and only one
  // BKT observation is recorded. Without this a double-click would apply the
  // rating twice — measured elsewhere in this codebase, where one Feynman
  // answer was graded twice three seconds apart from identical input.
  //
  // `.or(...)` rather than `.lte(...)`: `isDue()` treats a NULL schedule as due,
  // and `next_review_at = NULL` never satisfies `<=`, so a plain `.lte` would
  // make a card that lost its schedule permanently unratable.
  const intervalDays = REVIEW_INTERVALS[rating];
  const dueAt = nextReviewAt(now, intervalDays).toISOString();

  const { data: rescheduled, error: updateError } = await supabaseAdmin
    .from('flashcards')
    .update({ next_review_at: dueAt, ease_rating: rating })
    .eq('id', flashcard_id)
    .or(`next_review_at.is.null,next_review_at.lte.${now.toISOString()}`)
    .select('id');

  if (updateError) {
    res.status(500).json({ error: 'Failed to update flashcard schedule', message: updateError.message });
    return;
  }

  if (!rescheduled || rescheduled.length === 0) {
    // A concurrent request already claimed this rating. Answer exactly as the
    // not-due branch does, so the UI reports one counted rating, not two.
    res.status(200).json({
      data: { flashcard_id, rating, counted: false, next_review_at: card.next_review_at },
      message: "Not due — this card's schedule is unchanged.",
    });
    return;
  }

  // 4. Log it. concept_id comes from the row already read above, so the column
  // BKT will join on costs no extra query. interval_days and next_review_at were
  // both previously left to their defaults, which made every row claim 1 day.
  const { error: logError } = await supabaseAdmin
    .from('spaced_repetition_logs')
    .insert({
      student_id: studentId,
      flashcard_id,
      concept_id: card.concept_id,
      rating,
      interval_days: intervalDays,
      next_review_at: dueAt,
    });

  if (logError) {
    // The card is already rescheduled. Losing the audit row is worse than
    // silent, so it is reported — but the student's schedule stands.
    console.error(`[Flashcards] Rating logged failed for card=${flashcard_id}`, logError.message);
  }

  /*
   * 5. BKT. Reached only on a counted rating, which is the point.
   *
   * A hand-written card has no `concept_id` and produces no observation — the
   * engine skips it rather than failing, since there is no concept to trace.
   *
   * Awaited and caught, never fire-and-forget: Express 4 does not forward async
   * rejections and there is no `unhandledRejection` handler. Never fatal
   * either — the card is already rescheduled and the student is owed their
   * confirmation.
   */
  try {
    const bkt = await applyFlashcardRating({
      studentId,
      conceptId: card.concept_id,
      flashcardId: flashcard_id,
      rating,
    });
    for (const problem of bktProblems(bkt)) {
      console.error(`[BKT] card=${flashcard_id} student=${studentId}: ${problem}`);
    }
  } catch (err) {
    console.error(
      `[BKT] engine threw for card=${flashcard_id} student=${studentId}:`,
      err instanceof Error ? err.message : err
    );
  }

  /*
   * 6. Activity + badges. Reached only past the compare-and-swap, so a
   * double-tap logs one row rather than two — the loser of that race returned
   * above with `counted: false` and no activity, because it is a duplicate
   * request rather than a second study event.
   *
   * `logActivity` never throws, so it needs no try/catch of its own.
   */
  await logActivity({
    studentId,
    type: 'flashcard',
    spaceId: space.id,
    materialId: card.source_material_id,
  });

  res.status(200).json({
    data: {
      flashcard_id,
      rating,
      counted: true,
      interval_days: intervalDays,
      next_review_at: dueAt,
    },
    message: `Card scheduled for review in ${intervalDays} day${intervalDays !== 1 ? 's' : ''}`,
  });
});

export default router;
