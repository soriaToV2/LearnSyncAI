import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  CreateStudySpaceSchema,
  UpdateStudySpaceSchema,
  CreateDeckSchema,
  CreateFlashcardSchema,
  SyncSpaceMaterialsSchema,
} from '../types/api';
import { publishedMaterialIds } from '../lib/materialAccess';
import type { SpaceMaterial } from '../types/database';

const router = Router();
router.use(authenticate);

// ── Study space contents ──────────────────────────────────
//
// A space's materials live in study_space_materials, not in a query run fresh on
// every page load. That is deliberate: the stored list is what lets the Resources
// tab say "2 new materials are available" — you cannot diff against a set that is
// recomputed each time. Nothing is added to the list without the student asking.
//
// Reads still filter the stored list against the live rules (not archived, still
// published to the student's grade, still this space's subject), so an educator
// archiving a material removes it from every student's view immediately while the
// link row survives — un-archive and it comes back on its own.

/** Columns the student side is allowed to see. No educator_id, no storage_path. */
const SPACE_MATERIAL_COLUMNS =
  'id, title, description, subject, file_size_bytes, page_count, is_scanned, parsed_status, parse_error';

interface SpaceOwner {
  id: string;
  title: string;
  subject: string;
  gradeLevel: number;
}

/**
 * Loads the space plus its owner's grade level, but only for the owner.
 *
 * 404 rather than 403 for someone else's space, so a student cannot probe which
 * space ids exist. Returns null on any failure; the caller sends the 404.
 */
async function loadOwnedSpace(spaceId: string, userId: string): Promise<SpaceOwner | null> {
  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('id, title, subject, student_id')
    .eq('id', spaceId)
    .maybeSingle();

  if (!space || space.student_id !== userId) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('grade_level, status, role')
    .eq('id', userId)
    .maybeSingle();

  if (!profile || profile.status !== 'active' || profile.role !== 'student') return null;
  if (profile.grade_level === null || profile.grade_level === undefined) return null;

  return {
    id: space.id,
    title: space.title,
    subject: space.subject,
    gradeLevel: profile.grade_level,
  };
}

/** Material ids currently linked to a space, in the order they were added. */
async function linkedMaterialIds(spaceId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('study_space_materials')
    .select('material_id, added_at')
    .eq('space_id', spaceId)
    .order('added_at');

  return (data ?? []).map((row) => row.material_id as string);
}

/**
 * The space's visible materials plus the count of published ones it does not have
 * yet — everything the Resources tab renders, in one round trip.
 *
 * `available_count` is a set subtraction: everything published to
 * (space.subject, student's grade) that is not archived, minus everything already
 * linked. Zero means no "new materials" notice at all.
 */
async function buildSpaceMaterials(space: SpaceOwner): Promise<{
  space: { id: string; title: string; subject: string };
  materials: SpaceMaterial[];
  available_count: number;
}> {
  const published = await publishedMaterialIds(space.subject, space.gradeLevel);
  const linked = await linkedMaterialIds(space.id);
  const linkedSet = new Set(linked);

  // Linked AND still published — the filter that hides archived / regraded
  // materials without deleting the link row.
  const visibleIds = linked.filter((id) => published.includes(id));
  const availableCount = published.filter((id) => !linkedSet.has(id)).length;

  if (visibleIds.length === 0) {
    return {
      space: { id: space.id, title: space.title, subject: space.subject },
      materials: [],
      available_count: availableCount,
    };
  }

  const [{ data: rows }, { data: conceptRows }, { data: linkRows }] = await Promise.all([
    supabaseAdmin.from('materials').select(SPACE_MATERIAL_COLUMNS).in('id', visibleIds),
    supabaseAdmin.from('concepts').select('material_id').in('material_id', visibleIds),
    supabaseAdmin
      .from('study_space_materials')
      .select('material_id, added_at')
      .eq('space_id', space.id)
      .in('material_id', visibleIds),
  ]);

  const counts: Record<string, number> = {};
  for (const row of conceptRows ?? []) {
    counts[row.material_id] = (counts[row.material_id] ?? 0) + 1;
  }

  const addedAt: Record<string, string> = {};
  for (const row of linkRows ?? []) {
    addedAt[row.material_id] = row.added_at;
  }

  const byId = new Map((rows ?? []).map((row) => [row.id as string, row]));

  // visibleIds is already in added_at order, so the list reads oldest-first.
  const materials = visibleIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      ...row,
      concept_count: counts[row.id] ?? 0,
      added_at: addedAt[row.id] ?? '',
    })) as SpaceMaterial[];

  return {
    space: { id: space.id, title: space.title, subject: space.subject },
    materials,
    available_count: availableCount,
  };
}

/**
 * Links every material published to (subject, grade) that the space is missing.
 * `ignoreDuplicates` on the composite primary key makes this idempotent, so
 * running it twice never produces a second copy of anything.
 */
async function attachPublishedMaterials(
  spaceId: string,
  subject: string,
  gradeLevel: number
): Promise<number> {
  const published = await publishedMaterialIds(subject, gradeLevel);
  if (published.length === 0) return 0;

  const linked = new Set(await linkedMaterialIds(spaceId));
  const missing = published.filter((id) => !linked.has(id));
  if (missing.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from('study_space_materials')
    .upsert(
      missing.map((material_id) => ({ space_id: spaceId, material_id })),
      { onConflict: 'space_id,material_id', ignoreDuplicates: true }
    );

  if (error) throw new Error(error.message);
  return missing.length;
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
 * Creates a study space for one subject and immediately fills it with every
 * material published to that subject at the student's grade level. Students only.
 *
 * The auto-fill is the point: the paper's ingestion core "makes the processed
 * content available to students within the educator's selected grade level", so a
 * new Science space should already hold the student's Science materials rather
 * than sending them hunting.
 */
router.post('/', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateStudySpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { title, description, subject } = parsed.data;

  // Check the subject up front so an unknown code is a readable 400 rather than a
  // foreign-key 500 after the row is half-built. Same pattern as material upload.
  const { data: subjectRow } = await supabaseAdmin
    .from('subjects')
    .select('code')
    .eq('code', subject)
    .maybeSingle();

  if (!subjectRow) {
    res.status(400).json({
      error: 'Unknown subject',
      message: `"${subject}" is not a recognised subject.`,
    });
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('grade_level')
    .eq('id', req.user!.id)
    .maybeSingle();

  const gradeLevel = profile?.grade_level ?? null;
  if (gradeLevel === null) {
    res.status(400).json({
      error: 'No grade level',
      message: 'Your account has no grade level set. Ask your administrator to assign one.',
    });
    return;
  }

  const { data: newSpace, error: spaceError } = await supabaseAdmin
    .from('study_spaces')
    .insert({
      title,
      description: description || null,
      student_id: req.user!.id,
      subject,
    })
    .select()
    .single();

  if (spaceError || !newSpace) {
    res.status(500).json({ error: 'Failed to create study space', message: spaceError?.message });
    return;
  }

  // Pre-fill. A failure here leaves a usable (empty) space rather than losing it —
  // the student can pull the same materials in from the Resources tab.
  let attached = 0;
  try {
    attached = await attachPublishedMaterials(newSpace.id, subject, gradeLevel);
  } catch (err: any) {
    console.error(`[Study Space] Pre-fill failed for space_id=${newSpace.id}`, err?.message ?? err);
  }

  res.status(201).json({
    data: { ...newSpace, material_count: attached },
    message: 'Study space created',
  });
});

/**
 * GET /api/spaces/:id
 * Returns a single study space. Owner only — study spaces are private, and
 * migration 0003 removed peer sharing entirely.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('study_spaces')
    .select('*')
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  res.json({ data });
});

/**
 * GET /api/spaces/:id/materials
 * The space's materials plus a count of newly published ones it does not hold yet.
 * Owner only.
 */
router.get('/:id/materials', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  try {
    res.json({ data: await buildSpaceMaterials(space) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load space materials', message: err?.message });
  }
});

/**
 * POST /api/spaces/:id/materials/sync
 * Pulls every newly published material for this space's subject and the student's
 * grade level into the space. Owner only.
 *
 * The client does not choose what to attach — the set is derived server-side — so
 * there is nothing a student could pass to reach another subject or grade.
 */
router.post(
  '/:id/materials/sync',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SyncSpaceMaterialsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const space = await loadOwnedSpace(req.params.id, req.user!.id);
    if (!space) {
      res.status(404).json({ error: 'Study space not found' });
      return;
    }

    try {
      const added = await attachPublishedMaterials(space.id, space.subject, space.gradeLevel);
      res.json({
        data: { ...(await buildSpaceMaterials(space)), added_count: added },
        message: added === 1 ? '1 material added' : `${added} materials added`,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to add materials', message: err?.message });
    }
  }
);

/**
 * PUT /api/spaces/:id
 * Renames a study space or edits its description. Owner only.
 * The subject cannot be changed — see UpdateStudySpaceSchema.
 */
router.put('/:id', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateStudySpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
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
