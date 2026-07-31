import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { RateFlashcardSchema } from '../types/api';
import { REVIEW_INTERVALS, nextReviewAt, isDue } from '../lib/reviewSchedule';

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
 * memory. When BKT is attached here the same protection applies to mastery,
 * which is the more important half — otherwise mastery would climb fastest on
 * exactly the concepts a student re-drills because they are struggling.
 *
 * The client is never trusted to decide this. It posts every rating; the server
 * answers `counted` and the UI reports what actually happened.
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
    .select('id, deck_id, concept_id, next_review_at')
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

  // 2. Due check. Not due → write nothing. The student reviewed the card, which
  // is good for them, but it was not a scheduled retrieval so it is not evidence
  // and it does not move the schedule.
  const now = new Date();
  if (!isDue(card.next_review_at, now)) {
    res.status(200).json({
      data: {
        flashcard_id,
        rating,
        counted: false,
        next_review_at: card.next_review_at,
      },
      message: 'Practice rating — this card was not due, so its schedule is unchanged.',
    });
    return;
  }

  // 3. Schedule.
  const intervalDays = REVIEW_INTERVALS[rating];
  const dueAt = nextReviewAt(now, intervalDays).toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('flashcards')
    .update({ next_review_at: dueAt, ease_rating: rating })
    .eq('id', flashcard_id);

  if (updateError) {
    res.status(500).json({ error: 'Failed to update flashcard schedule', message: updateError.message });
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
