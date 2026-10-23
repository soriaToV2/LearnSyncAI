import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  CreateStudySpaceSchema,
  UpdateStudySpaceSchema,
  CreateDeckSchema,
  UpdateDeckSchema,
  GenerateDeckCardsSchema,
  SyncSpaceMaterialsSchema,
} from '../types/api';
import { publishedMaterialIds, rejectInaccessibleMaterials } from '../lib/materialAccess';
import { loadOwnedSpace, type SpaceOwner } from '../lib/spaceAccess';
import { generateQuestionsForConcepts } from '../lib/questionGeneration';
import { GeminiUnavailableError, studentFacingError } from '../lib/gemini';
import type { SpaceMaterial } from '../types/database';

const router = Router();
router.use(authenticate);

// Study space contents. A space's materials are a stored list (study_space_materials), which is what
// makes "N new materials available" possible. Reads filter it against live rules, so archiving hides
// a material without deleting the link row.

/** Columns the student side is allowed to see. No educator_id, no storage_path. */
const SPACE_MATERIAL_COLUMNS =
  'id, title, description, subject, file_size_bytes, page_count, is_scanned, parsed_status, parse_error';

/** Raised by `ux_study_spaces_student_subject` (one space per student per subject). */
const UNIQUE_VIOLATION = '23505';

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
 * The space's visible materials plus `available_count`: published to (subject, grade), not archived,
 * minus already linked.
 */
async function buildSpaceMaterials(space: SpaceOwner): Promise<{
  space: { id: string; title: string; subject: string };
  materials: SpaceMaterial[];
  available_count: number;
}> {
  const published = await publishedMaterialIds(space.subject, space.gradeLevel);
  const linked = await linkedMaterialIds(space.id);
  const linkedSet = new Set(linked);

  // Linked and still published.
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

  // Already in added_at order.
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

/** Links every published material the space is missing. Idempotent via ignoreDuplicates. */
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

// Study spaces

/** GET /api/spaces: the caller's spaces. */
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
 * POST /api/spaces: creates a one-subject space and fills it with that subject's published materials.
 * One space per subject (409 SUBJECT_SPACE_EXISTS): a BKT integrity guard. The "one lesson in one
 * deck" check on generation is per space, so a second copy of a subject would let a student card a
 * lesson again with every card born due. See CLAUDE.md § Study Spaces.
 */
router.post('/', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateStudySpaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { title, description, subject } = parsed.data;

  // Check the subject first so an unknown code is a 400, not an FK 500.
  const { data: subjectRow } = await supabaseAdmin
    .from('subjects')
    .select('code, name')
    .eq('code', subject)
    .maybeSingle();

  if (!subjectRow) {
    res.status(400).json({
      error: 'Unknown subject',
      message: `"${subject}" is not a recognised subject.`,
    });
    return;
  }

  const subjectTaken = (existingTitle?: string) =>
    res.status(409).json({
      error: 'Subject already has a space',
      code: 'SUBJECT_SPACE_EXISTS',
      message: existingTitle
        ? `You already have a space for ${subjectRow.name} ("${existingTitle}"). Each subject has one space; open that one instead.`
        : `You already have a space for ${subjectRow.name}. Each subject has one space; open that one instead.`,
    });

  // A courtesy for a readable message; ux_study_spaces_student_subject is the guarantee.
  const { data: existingSpace, error: existingError } = await supabaseAdmin
    .from('study_spaces')
    .select('id, title')
    .eq('student_id', req.user!.id)
    .eq('subject', subject)
    .maybeSingle();

  if (existingError) {
    res.status(500).json({ error: 'Failed to read study spaces', message: existingError.message });
    return;
  }

  if (existingSpace) {
    subjectTaken(existingSpace.title as string);
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

  // A double-submit that passed the pre-check above.
  if (spaceError?.code === UNIQUE_VIOLATION) {
    subjectTaken();
    return;
  }

  if (spaceError || !newSpace) {
    res.status(500).json({ error: 'Failed to create study space', message: spaceError?.message });
    return;
  }

  // Pre-fill. On failure the space still exists and the student can sync later.
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

/** GET /api/spaces/:id. Owner only. requireRole is what rejects disabled and un-activated accounts. */
router.get('/:id', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
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

/** GET /api/spaces/:id/materials: materials plus a count of newly published ones. Owner only. */
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

/** POST /api/spaces/:id/materials/sync: links newly published materials. The set is derived server-side. */
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

/** PUT /api/spaces/:id: rename or edit description. The subject is immutable. */
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

/** DELETE /api/spaces/:id. Owner only. */
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

// Flashcard decks. Students own decks but not cards: cards arrive only by generation against a
// material, so every card has a vetted concept to attach mastery to.

/**
 * GET /api/spaces/:id/decks. Owner only; reads are guarded like writes because decks expose
 * ease_rating and next_review_at.
 */
router.get('/:id/decks', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .select('*')
    .eq('space_id', space.id)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch decks', message: error.message });
    return;
  }

  res.json({ data });
});

/** POST /api/spaces/:id/decks: creates an empty deck. Owner only (404 otherwise). */
router.post('/:id/decks', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateDeckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      space_id: space.id,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to create deck', message: error.message });
    return;
  }

  res.status(201).json({ data, message: 'Deck created' });
});

/**
 * PUT /api/spaces/:id/decks/:deckId: title, description, answer_first. A partial write built key by
 * key, so an omitted field is never wiped.
 */
router.put('/:id/decks/:deckId', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateDeckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  // Test against undefined: null description means "clear it".
  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.answer_first !== undefined) patch.answer_first = parsed.data.answer_first;

  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .update(patch)
    .eq('id', req.params.deckId)
    .eq('space_id', space.id)
    .select()
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: 'Failed to update deck', message: error.message });
    return;
  }

  if (!data) {
    res.status(404).json({ error: 'Deck not found' });
    return;
  }

  res.json({ data, message: 'Deck updated' });
});

/** DELETE /api/spaces/:id/decks/:deckId: deletes the deck and its cards (concepts are untouched). */
router.delete('/:id/decks/:deckId', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  // Confirm the deck is in this space before deleting anything.
  const { data: deck } = await supabaseAdmin
    .from('flashcard_decks')
    .select('id')
    .eq('id', req.params.deckId)
    .eq('space_id', space.id)
    .maybeSingle();

  if (!deck) {
    res.status(404).json({ error: 'Deck not found' });
    return;
  }

  await supabaseAdmin.from('flashcards').delete().eq('deck_id', deck.id);

  const { error } = await supabaseAdmin.from('flashcard_decks').delete().eq('id', deck.id);

  if (error) {
    res.status(500).json({ error: 'Failed to delete deck', message: error.message });
    return;
  }

  res.json({ message: 'Deck deleted' });
});

// Flashcards

/** GET /api/spaces/:id/decks/:deckId/flashcards. Confirms the deck is in the owned space first. */
router.get(
  '/:id/decks/:deckId/flashcards',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const space = await loadOwnedSpace(req.params.id, req.user!.id);
    if (!space) {
      res.status(404).json({ error: 'Study space not found' });
      return;
    }

    const { data: deck } = await supabaseAdmin
      .from('flashcard_decks')
      .select('id')
      .eq('id', req.params.deckId)
      .eq('space_id', space.id)
      .maybeSingle();

    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('flashcards')
      .select('*')
      .eq('deck_id', deck.id)
      .order('created_at');

    if (error) {
      res.status(500).json({ error: 'Failed to fetch flashcards', message: error.message });
      return;
    }

    res.json({ data });
  }
);

/**
 * POST /api/spaces/:id/decks/:deckId/generate: one card per concept of a material.
 * The back is always the educator's definition; only the front varies ('term', or a model-written
 * 'question'). Every card carries its concept_id.
 */
router.post(
  '/:id/decks/:deckId/generate',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GenerateDeckCardsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const { material_id, replace, format } = parsed.data;

    const space = await loadOwnedSpace(req.params.id, req.user!.id);
    if (!space) {
      res.status(404).json({ error: 'Study space not found' });
      return;
    }

    const { data: deck } = await supabaseAdmin
      .from('flashcard_decks')
      .select('id, title')
      .eq('id', req.params.deckId)
      .eq('space_id', space.id)
      .maybeSingle();

    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // Grade/archive rule first.
    if (!(await rejectInaccessibleMaterials(req, res, [material_id]))) return;

    // Then space membership: the material must be one this space holds.
    const published = await publishedMaterialIds(space.subject, space.gradeLevel);
    const linked = await linkedMaterialIds(space.id);
    if (!published.includes(material_id) || !linked.includes(material_id)) {
      res.status(404).json({ error: 'Material not found in this study space' });
      return;
    }

    const { data: concepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition')
      .eq('material_id', material_id)
      .order('created_at', { ascending: true });

    if (conceptsError) {
      res.status(500).json({ error: 'Failed to read concepts', message: conceptsError.message });
      return;
    }

    if (!concepts || concepts.length === 0) {
      res.status(422).json({
        error: 'No concepts found',
        message: 'This material has no concepts yet, so there is nothing to make cards from.',
      });
      return;
    }

    // What this deck already holds from this material.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('flashcards')
      .select('id, concept_id, is_ai_generated')
      .eq('deck_id', deck.id)
      .eq('source_material_id', material_id);

    if (existingError) {
      res.status(500).json({ error: 'Failed to read deck contents', message: existingError.message });
      return;
    }

    const existingCards = existing ?? [];

    // One lesson per deck per space (409 MATERIAL_IN_ANOTHER_DECK): a BKT integrity guard. New cards
    // are born due, so a second deck would add observations on already-assessed concepts.
    // Fires regardless of `replace`, but not when this deck already holds the material.
    // See CLAUDE.md § Important Rules.
    if (existingCards.length === 0) {
      const { data: siblingDecks, error: siblingError } = await supabaseAdmin
        .from('flashcard_decks')
        .select('id, title')
        .eq('space_id', space.id)
        .neq('id', deck.id);

      if (siblingError) {
        res.status(500).json({ error: 'Failed to read decks', message: siblingError.message });
        return;
      }

      const siblingIds = (siblingDecks ?? []).map((d) => d.id as string);
      if (siblingIds.length > 0) {
        const { data: elsewhere, error: elsewhereError } = await supabaseAdmin
          .from('flashcards')
          .select('deck_id')
          .in('deck_id', siblingIds)
          .eq('source_material_id', material_id);

        if (elsewhereError) {
          res
            .status(500)
            .json({ error: 'Failed to read deck contents', message: elsewhereError.message });
          return;
        }

        const found = elsewhere ?? [];
        if (found.length > 0) {
          // Name the deck holding the most of it.
          const byDeck = new Map<string, number>();
          for (const row of found) {
            const id = row.deck_id as string;
            byDeck.set(id, (byDeck.get(id) ?? 0) + 1);
          }
          let ownerId = siblingIds[0];
          let ownerCount = 0;
          for (const [id, count] of byDeck) {
            if (count > ownerCount) {
              ownerId = id;
              ownerCount = count;
            }
          }
          const ownerTitle =
            (siblingDecks ?? []).find((d) => d.id === ownerId)?.title ?? 'another deck';

          res.status(409).json({
            error: 'Already in another deck',
            // A code, so the client can tell this 409 from the per-deck "Already generated" one.
            code: 'MATERIAL_IN_ANOTHER_DECK',
            message: `This material is already in "${ownerTitle}" (${ownerCount} card${ownerCount === 1 ? '' : 's'}). A lesson lives in one deck at a time, so its review dates stay in one place.`,
            data: { deck_id: ownerId, deck_title: ownerTitle, existing_count: ownerCount },
          });
          return;
        }
      }
    }

    // Already here without `replace`: write nothing. current_format lets the client offer a Refresh.
    if (existingCards.length > 0 && !replace) {
      const currentFormat = existingCards.some((c) => c.is_ai_generated) ? 'question' : 'term';
      res.status(409).json({
        error: 'Already generated',
        message: `This material is already in "${deck.title}" (${existingCards.length} card${existingCards.length === 1 ? '' : 's'}).`,
        data: {
          existing_count: existingCards.length,
          concept_count: concepts.length,
          current_format: currentFormat,
        },
      });
      return;
    }

    // Fronts. A concept the model skips falls back to its term. A thrown call aborts before any write.
    let questions = new Map<string, string>();
    if (format === 'question') {
      try {
        questions = await generateQuestionsForConcepts(
          concepts.map((c) => ({ id: c.id as string, term: c.term, definition: c.definition }))
        );
      } catch (err) {
        // Log the cause.
        console.error('[Decks] question generation failed:', err);

        // Typed Gemini failures keep their status (429 quota / 503 outage). Nothing has been written.
        if (err instanceof GeminiUnavailableError) {
          res.status(err.status).json({
            error: 'Question generation failed',
            // userMessage, never err.message.
            message:
              `${studentFacingError(err)} Nothing was added to this deck — ` +
              'you can add these cards as terms and definitions instead.',
          });
          return;
        }

        res.status(502).json({
          error: 'Question generation failed',
          message:
            'The question writer could not be reached, so nothing was added. Please try again, or add these cards as terms and definitions.',
        });
        return;
      }
    }

    const frontFor = (concept: { id: string; term: string }): string =>
      (format === 'question' ? questions.get(concept.id)?.trim() : '') || concept.term;

    /** True only where the model wrote the front; drives current_format. */
    const aiWrote = (concept: { id: string }): boolean =>
      format === 'question' && Boolean(questions.get(concept.id)?.trim());

    /** Cards that fell back to the term. */
    const fallbackCount =
      format === 'question'
        ? concepts.filter((c) => !questions.get(c.id as string)?.trim()).length
        : 0;

    const fallbackNote =
      fallbackCount > 0
        ? ` ${fallbackCount} card${fallbackCount === 1 ? '' : 's'} show the term instead — no question could be written for ${fallbackCount === 1 ? 'it' : 'them'}.`
        : '';

    // First run: one insert, all or nothing.
    if (existingCards.length === 0) {
      const { error: insertError } = await supabaseAdmin.from('flashcards').insert(
        concepts.map((c) => ({
          deck_id: deck.id,
          term: frontFor(c as any),
          definition: c.definition,
          concept_id: c.id,
          source_material_id: material_id,
          is_ai_generated: aiWrote(c as any),
        }))
      );

      if (insertError) {
        res.status(500).json({ error: 'Failed to add cards', message: insertError.message });
        return;
      }

      res.status(201).json({
        data: { added: concepts.length, updated: 0, removed: 0, fallback: fallbackCount },
        message: `Added ${concepts.length} card${concepts.length === 1 ? '' : 's'} to ${deck.title}.${fallbackNote}`,
      });
      return;
    }

    // Refresh: reconcile by concept_id in place. Never delete-then-reinsert: rating logs cascade on
    // delete and every schedule would reset.
    const cardByConcept = new Map(
      existingCards
        .filter((c) => c.concept_id)
        .map((c) => [c.concept_id as string, c.id as string])
    );
    const liveConceptIds = new Set(concepts.map((c) => c.id as string));

    const toInsert = concepts.filter((c) => !cardByConcept.has(c.id as string));
    const toUpdate = concepts.filter((c) => cardByConcept.has(c.id as string));
    // Cards whose concept is gone, or with no concept_id, can't be reconciled.
    const staleIds = existingCards
      .filter((c) => !c.concept_id || !liveConceptIds.has(c.concept_id as string))
      .map((c) => c.id as string);

    for (const c of toUpdate) {
      const { error } = await supabaseAdmin
        .from('flashcards')
        .update({
          term: frontFor(c as any),
          definition: c.definition,
          is_ai_generated: aiWrote(c as any),
        })
        .eq('id', cardByConcept.get(c.id as string)!);

      if (error) {
        res.status(500).json({ error: 'Failed to refresh cards', message: error.message });
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from('flashcards').insert(
        toInsert.map((c) => ({
          deck_id: deck.id,
          term: frontFor(c as any),
          definition: c.definition,
          concept_id: c.id,
          source_material_id: material_id,
          is_ai_generated: aiWrote(c as any),
        }))
      );

      if (error) {
        res.status(500).json({ error: 'Failed to add new cards', message: error.message });
        return;
      }
    }

    if (staleIds.length > 0) {
      const { error } = await supabaseAdmin.from('flashcards').delete().in('id', staleIds);
      if (error) {
        res.status(500).json({ error: 'Failed to remove outdated cards', message: error.message });
        return;
      }
    }

    res.json({
      data: {
        added: toInsert.length,
        updated: toUpdate.length,
        removed: staleIds.length,
        fallback: fallbackCount,
      },
      message: `Refreshed ${deck.title} — ${toUpdate.length} updated, ${toInsert.length} added, ${staleIds.length} removed.${fallbackNote}`,
    });
  }
);

export default router;
