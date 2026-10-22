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
 * POST /api/flashcards/rate. A rating counts (reschedules and updates BKT) only if the card was due.
 * That single check stops re-drill farming, double taps and stale tabs; don't relax it. The client
 * never decides. Easy/Medium are correct observations, Hard is incorrect (paper pp. 78-79).
 */
router.post('/rate', async (req: Request, res: Response): Promise<void> => {
  const parsed = RateFlashcardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { flashcard_id, rating } = parsed.data;
  const studentId = req.user!.id;

  // 1. Ownership: card → deck → space → this student. 404 on any miss.
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

  // 2. Not due: write nothing (no schedule, BKT or activity).
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

  // 3. Schedule as a compare-and-swap so a double tap applies once.
  // `.or(...)`, not `.lte(...)`: a NULL schedule is due and NULL never satisfies `<=`.
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
    // A concurrent request claimed it; answer like the not-due branch.
    res.status(200).json({
      data: { flashcard_id, rating, counted: false, next_review_at: card.next_review_at },
      message: "Not due — this card's schedule is unchanged.",
    });
    return;
  }

  // 4. Log it, with interval_days and next_review_at set explicitly.
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
    // The schedule stands; report the lost audit row.
    console.error(`[Flashcards] Rating logged failed for card=${flashcard_id}`, logError.message);
  }

  // 5. BKT, on counted ratings only. Awaited and caught; never fatal.
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

  // 6. Activity + badges, past the CAS so a double tap logs once.
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
