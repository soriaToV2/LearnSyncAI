import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { RateFlashcardSchema } from '../types/api';

const router = Router();
router.use(authenticate, requireRole('student'));

// Spaced repetition intervals in days
const REVIEW_INTERVALS: Record<string, number> = {
  easy: 4,
  medium: 3,
  hard: 1,
};

/**
 * POST /api/flashcards/rate
 *
 * Records a spaced repetition rating for a flashcard.
 *
 * Flow:
 * 1. Validate rating (easy | medium | hard)
 * 2. Insert a log row into spaced_repetition_logs
 * 3. Update flashcards.next_review_at and ease_rating based on interval
 * 4. Trigger a BKT update for the linked concept (via bkt_mastery upsert)
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
  const daysUntilReview = REVIEW_INTERVALS[rating];

  // Calculate next review timestamp
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + daysUntilReview);

  // 1. Log the rating event
  const { error: logError } = await supabaseAdmin
    .from('spaced_repetition_logs')
    .insert({
      student_id: studentId,
      flashcard_id,
      rating,
    });

  if (logError) {
    res.status(500).json({ error: 'Failed to log rating', message: logError.message });
    return;
  }

  // 2. Update the flashcard's next_review_at and ease_rating
  const { error: updateError } = await supabaseAdmin
    .from('flashcards')
    .update({
      next_review_at: nextReviewAt.toISOString(),
      ease_rating: rating,
    })
    .eq('id', flashcard_id);

  if (updateError) {
    res.status(500).json({ error: 'Failed to update flashcard schedule', message: updateError.message });
    return;
  }

  res.status(200).json({
    data: {
      flashcard_id,
      rating,
      next_review_at: nextReviewAt.toISOString(),
      days_until_review: daysUntilReview,
    },
    message: `Card scheduled for review in ${daysUntilReview} day${daysUntilReview !== 1 ? 's' : ''}`,
  });
});

/**
 * GET /api/flashcards/due/:spaceId
 *
 * Returns all flashcards in a study space that are due for review today.
 * Useful for a "due today" dashboard widget.
 */
router.get('/due/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const now = new Date().toISOString();

  // Get all decks in this space
  const { data: decks, error: deckError } = await supabaseAdmin
    .from('flashcard_decks')
    .select('id')
    .eq('space_id', req.params.spaceId);

  if (deckError || !decks) {
    res.status(500).json({ error: 'Failed to fetch decks', message: deckError?.message });
    return;
  }

  const deckIds = decks.map(d => d.id);
  if (!deckIds.length) {
    res.json({ data: [] });
    return;
  }

  // Get flashcards due for review
  const { data: dueCards, error: cardError } = await supabaseAdmin
    .from('flashcards')
    .select('id, term, definition, next_review_at, ease_rating, deck_id')
    .in('deck_id', deckIds)
    .lte('next_review_at', now)
    .order('next_review_at', { ascending: true });

  if (cardError) {
    res.status(500).json({ error: 'Failed to fetch due cards', message: cardError.message });
    return;
  }

  res.json({ data: dueCards });
});

export default router;
