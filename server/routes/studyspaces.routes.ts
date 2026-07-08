import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  CreateStudySpaceSchema,
  UpdateStudySpaceSchema,
  CreateDeckSchema,
  CreateFlashcardSchema,
} from '../types/api';
import { randomBytes } from 'crypto';

const router = Router();
router.use(authenticate);

/** Generates a secure shareable token for CollabShare */
function generateShareToken(): string {
  return randomBytes(16).toString('hex');
}

// ── Study Spaces ──────────────────────────────────────────

/**
 * GET /api/spaces
 * Returns all study spaces owned by the authenticated student.
 */
router.get('/', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('study_spaces')
    .select('*')
    .eq('student_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch study spaces', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/spaces
 * Creates a new study space or clones an existing one. Students only.
 */
router.post('/', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateStudySpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { title, description } = parsed.data;

  const { data: newSpace, error: spaceError } = await supabaseAdmin
    .from('study_spaces')
    .insert({
      title,
      description: description || null,
      student_id: req.user!.id,
      is_published: false,
      share_token: generateShareToken(),
    })
    .select()
    .single();

  if (spaceError || !newSpace) {
    res.status(500).json({ error: 'Failed to create study space', message: spaceError?.message });
    return;
  }

  // If this is a cloned space, clone all its decks and flashcards
  const cloned_from_id: string | undefined = req.body.cloned_from_id;
  if (cloned_from_id) {
    const { data: originalDecks } = await supabaseAdmin
      .from('flashcard_decks')
      .select('*')
      .eq('space_id', cloned_from_id);

    if (originalDecks && originalDecks.length > 0) {
      for (const deck of originalDecks) {
        const { data: newDeck } = await supabaseAdmin
          .from('flashcard_decks')
          .insert({
            space_id: newSpace.id,
            title: deck.title,
            description: deck.description || ''
          })
          .select()
          .single();

        if (newDeck) {
          const { data: originalCards } = await supabaseAdmin
            .from('flashcards')
            .select('*')
            .eq('deck_id', deck.id);

          if (originalCards && originalCards.length > 0) {
            const cardsToInsert = originalCards.map(c => ({
              deck_id: newDeck.id,
              term: c.term,
              definition: c.definition,
              is_ai_generated: c.is_ai_generated || false
            }));

            await supabaseAdmin
              .from('flashcards')
              .insert(cardsToInsert);
          }
        }
      }
    }
  }

  res.status(201).json({ data: newSpace, message: 'Study space created' });
});

/**
 * GET /api/spaces/:id
 * Returns a single study space. Owners get full access; public spaces are readable by all authenticated users.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('study_spaces')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  // Access control: must be owner or space must be published
  if (data.student_id !== req.user!.id && !data.is_published) {
    res.status(403).json({ error: 'This study space is private' });
    return;
  }

  res.json({ data });
});

/**
 * PUT /api/spaces/:id
 * Updates a study space (title, is_published). Owner only.
 */
router.put('/:id', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateStudySpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  // Prevent renaming cloned spaces
  if (parsed.data.title !== undefined) {
    const { data: spaceCheck } = await supabaseAdmin
      .from('study_spaces')
      .select('cloned_from_id')
      .eq('id', req.params.id)
      .single();

    if (spaceCheck?.cloned_from_id) {
      res.status(403).json({ error: 'Cannot rename a cloned study space' });
      return;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('study_spaces')
    .update(parsed.data)
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id)
    .select()
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Study space not found or unauthorized', message: error?.message });
    return;
  }

  res.json({ data, message: 'Study space updated' });
});

/**
 * DELETE /api/spaces/:id
 * Deletes a study space. Owner only.
 */
router.delete('/:id', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const { error } = await supabaseAdmin
    .from('study_spaces')
    .delete()
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Failed to delete study space', message: error.message });
    return;
  }

  res.json({ message: 'Study space deleted' });
});

// ── Flashcard Decks ───────────────────────────────────────

/**
 * GET /api/spaces/:id/decks
 * Returns all flashcard decks in a study space.
 */
router.get('/:id/decks', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .select('*')
    .eq('space_id', req.params.id)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch decks', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/spaces/:id/decks
 * Creates a new flashcard deck. Students only.
 */
router.post('/:id/decks', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateDeckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .insert({ ...parsed.data, space_id: req.params.id })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to create deck', message: error.message });
    return;
  }

  res.status(201).json({ data, message: 'Deck created' });
});

// ── Flashcards ────────────────────────────────────────────

/**
 * GET /api/spaces/:id/decks/:deckId/flashcards
 * Returns all flashcards in a deck.
 */
router.get('/:id/decks/:deckId/flashcards', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('flashcards')
    .select('*')
    .eq('deck_id', req.params.deckId)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch flashcards', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/spaces/:id/decks/:deckId/flashcards
 * Creates a new flashcard in a deck. Students only.
 */
router.post(
  '/:id/decks/:deckId/flashcards',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateFlashcardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('flashcards')
      .insert({ ...parsed.data, deck_id: req.params.deckId })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create flashcard', message: error.message });
      return;
    }

    res.status(201).json({ data, message: 'Flashcard created' });
  }
);

/**
 * PUT /api/spaces/:id/decks/:deckId
 * Updates a deck title/description. Owner only.
 */
router.put('/:id/decks/:deckId', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('student_id')
    .eq('id', req.params.id)
    .single();

  if (!space || space.student_id !== req.user!.id) {
    res.status(403).json({ error: 'Unauthorized or space not found' });
    return;
  }

  const { title, description } = req.body;
  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .update({ title, description })
    .eq('id', req.params.deckId)
    .eq('space_id', req.params.id)
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: 'Failed to update deck', message: error?.message });
    return;
  }

  res.json({ data, message: 'Deck updated' });
});

/**
 * DELETE /api/spaces/:id/decks/:deckId
 * Deletes a deck. Owner only.
 */
router.delete('/:id/decks/:deckId', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('student_id')
    .eq('id', req.params.id)
    .single();

  if (!space || space.student_id !== req.user!.id) {
    res.status(403).json({ error: 'Unauthorized or space not found' });
    return;
  }

  await supabaseAdmin
    .from('flashcards')
    .delete()
    .eq('deck_id', req.params.deckId);

  const { error } = await supabaseAdmin
    .from('flashcard_decks')
    .delete()
    .eq('id', req.params.deckId)
    .eq('space_id', req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to delete deck', message: error.message });
    return;
  }

  res.json({ message: 'Deck deleted' });
});

/**
 * PUT /api/spaces/:id/decks/:deckId/flashcards/:cardId
 * Updates a single flashcard. Owner only.
 */
router.put(
  '/:id/decks/:deckId/flashcards/:cardId',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const { data: space } = await supabaseAdmin
      .from('study_spaces')
      .select('student_id')
      .eq('id', req.params.id)
      .single();

    if (!space || space.student_id !== req.user!.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { term, definition } = req.body;
    const { data, error } = await supabaseAdmin
      .from('flashcards')
      .update({ term, definition })
      .eq('id', req.params.cardId)
      .eq('deck_id', req.params.deckId)
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: 'Failed to update flashcard', message: error?.message });
      return;
    }

    res.json({ data, message: 'Flashcard updated' });
  }
);

/**
 * DELETE /api/spaces/:id/decks/:deckId/flashcards/:cardId
 * Deletes a single flashcard. Owner only.
 */
router.delete(
  '/:id/decks/:deckId/flashcards/:cardId',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const { data: space } = await supabaseAdmin
      .from('study_spaces')
      .select('student_id')
      .eq('id', req.params.id)
      .single();

    if (!space || space.student_id !== req.user!.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('flashcards')
      .delete()
      .eq('id', req.params.cardId)
      .eq('deck_id', req.params.deckId);

    if (error) {
      res.status(500).json({ error: 'Failed to delete flashcard', message: error.message });
      return;
    }

    res.json({ message: 'Flashcard deleted' });
  }
);

/**
 * POST /api/spaces/:id/decks/:deckId/flashcards/bulk
 * Overwrites all flashcards in a deck. Owner only.
 */
router.post(
  '/:id/decks/:deckId/flashcards/bulk',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const { data: space } = await supabaseAdmin
      .from('study_spaces')
      .select('student_id')
      .eq('id', req.params.id)
      .single();

    if (!space || space.student_id !== req.user!.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const cards = req.body.cards;
    if (!Array.isArray(cards)) {
      res.status(400).json({ error: 'Validation error: cards must be an array' });
      return;
    }

    // Delete old ones
    await supabaseAdmin
      .from('flashcards')
      .delete()
      .eq('deck_id', req.params.deckId);

    // Insert new ones
    if (cards.length > 0) {
      const toInsert = cards.map((c: any) => ({
        deck_id: req.params.deckId,
        term: c.term || c.front,
        definition: c.definition || c.back,
        is_ai_generated: c.is_ai_generated || false,
      }));
      const { error } = await supabaseAdmin
        .from('flashcards')
        .insert(toInsert);

      if (error) {
        res.status(500).json({ error: 'Failed to insert flashcards', message: error.message });
        return;
      }
    }

    res.json({ message: 'Flashcards bulk synced' });
  }
);

export default router;
