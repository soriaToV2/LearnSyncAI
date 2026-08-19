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
import { GeminiUnavailableError } from '../lib/gemini';
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
 *
 * ⚠️ This was the ONE space route without `requireRole('student')`, running on
 * bare `authenticate` and scoping by `student_id` alone. Ownership made it safe
 * against other students, but it read no account state — so a disabled account,
 * and later an un-activated one, could still open a space. `requireRole` is the
 * only middleware that reads `profiles`, so both gates live or die with it.
 */
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
//
// A deck is an empty folder the student owns: they create it, rename it and
// delete it to organise their lessons however they like. What goes INSIDE it is
// not theirs to write. Every flashcard assesses a concept an educator uploaded
// and vetted, so cards arrive by generation against a selected material and by
// no other route — the create / update / delete card endpoints are gone. A
// hand-written card would have no concept to attach mastery to, or would inject
// unvetted text into the knowledge base that Free Recall, Feynman, the chatbot
// and adaptive tests all read from.

/**
 * GET /api/spaces/:id/decks
 * Returns all flashcard decks in a study space. Owner only.
 *
 * Reading is guarded as tightly as writing. A space id is visible in the browser
 * address bar (/student/space/:spaceId), so a screenshot or a shared link is
 * enough for another student to hold one — and a deck carries its owner's
 * ease_rating and next_review_at, which is a direct readout of the concepts they
 * are struggling with. Migration 0003 removed peer sharing to guarantee data
 * isolation between students; leaving this open contradicted that.
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

/**
 * POST /api/spaces/:id/decks
 * Creates an empty deck. Owner only — 404 for anyone else, matching every other
 * space route, so a student cannot probe which space ids exist.
 *
 * The deck starts empty by design: cards arrive when the student generates
 * against a material from POST /api/materials/generate-flashcards.
 */
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
 * PUT /api/spaces/:id/decks/:deckId
 * Renames a deck or edits its description. Owner only.
 *
 * Title and description are the only fields a student may set — the update is
 * built from the parsed schema, never spread from req.body, so an extra field
 * in the payload cannot reach the table.
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

  const { data, error } = await supabaseAdmin
    .from('flashcard_decks')
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
    })
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

/**
 * DELETE /api/spaces/:id/decks/:deckId
 * Deletes a deck and the cards filed in it. Owner only.
 *
 * Deleting generated cards is safe — they are this student's copies. The
 * concepts they were generated from are the educator's and are untouched.
 */
router.delete('/:id/decks/:deckId', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const space = await loadOwnedSpace(req.params.id, req.user!.id);
  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return;
  }

  // Confirm the deck is in this space before deleting anything, so a deck id
  // from another student's space cannot have its cards wiped.
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

// ── Flashcards ────────────────────────────────────────────

/**
 * GET /api/spaces/:id/decks/:deckId/flashcards
 * Returns all flashcards in a deck. Owner only.
 *
 * The deck must be confirmed to sit in the owned space before its cards are
 * read — checking the space alone would let any deck id be paired with a space
 * the caller happens to own.
 */
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
 * POST /api/spaces/:id/decks/:deckId/generate
 *
 * Fills a deck with one card per concept of the selected material.
 *
 * The BACK of every card is the educator's stored definition, verbatim, in both
 * formats — a model never writes the answer, so a student never studies a fact
 * nobody vetted. Only the front varies:
 *
 *   format: 'term'     -> the concept's term. No model in the path at all.
 *   format: 'question' -> an AI-written question whose answer is that definition.
 *
 * Every card carries its concept_id either way, which is the link BKT needs and
 * the reason the model is asked to echo indices rather than return loose pairs.
 *
 * Body: { material_id: UUID, replace?: boolean, format?: 'term' | 'question' }
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

    // Grade level / archive rule first.
    if (!(await rejectInaccessibleMaterials(req, res, [material_id]))) return;

    // Then space membership. Passing the grade check is not enough — the
    // material must also be one this space actually holds, or a student could
    // pull another subject's content into this space's deck and corrupt the
    // mastery picture the space is supposed to represent.
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

    // Already here and no explicit go-ahead: say so and write nothing, rather
    // than silently doubling the deck. `current_format` comes back so the client
    // can offer a Refresh that keeps the deck's existing style.
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

    // ── Fronts.
    //
    // 'question' asks Gemini for one question per concept. A concept the model
    // omits or mis-numbers falls back to its term, so a card is never lost and
    // never left without a concept_id. A call that throws aborts the whole
    // request before anything is written — a deck half in one style and half in
    // another is worse than a clean retry.
    let questions = new Map<string, string>();
    if (format === 'question') {
      try {
        questions = await generateQuestionsForConcepts(
          concepts.map((c) => ({ id: c.id as string, term: c.term, definition: c.definition }))
        );
      } catch (err) {
        // Logged, because this catch used to discard the cause entirely — which
        // left a failed deck with no server-side trace of WHY.
        console.error('[Decks] question generation failed:', err);

        // A typed Gemini failure carries its own status and its own true
        // sentence: 429 when the key's daily allowance is spent, 503 for an
        // outage. Answering a flat 502 to both tells a student "please try
        // again" on a day when retrying cannot possibly work — the same split
        // failGeneration() makes for adaptive tests. Nothing has been written in
        // either case, which is the guarantee that actually matters here.
        if (err instanceof GeminiUnavailableError) {
          res.status(err.status).json({
            error: 'Question generation failed',
            message: `${err.message} Nothing was added to this deck — you can add these cards as terms and definitions instead.`,
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

    /** True only where the model actually wrote the front. Drives current_format. */
    const aiWrote = (concept: { id: string }): boolean =>
      format === 'question' && Boolean(questions.get(concept.id)?.trim());

    /** How many fell back to the term because the model skipped them. */
    const fallbackCount =
      format === 'question'
        ? concepts.filter((c) => !questions.get(c.id as string)?.trim()).length
        : 0;

    const fallbackNote =
      fallbackCount > 0
        ? ` ${fallbackCount} card${fallbackCount === 1 ? '' : 's'} show the term instead — no question could be written for ${fallbackCount === 1 ? 'it' : 'them'}.`
        : '';

    // ── First run: one insert, so it either all lands or none of it does and
    // the student is never left with a half-filled deck.
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

    // ── Refresh: reconcile against the current concepts by concept_id.
    //
    // Deliberately NOT delete-then-reinsert. spaced_repetition_logs.flashcard_id
    // is ON DELETE CASCADE, so wiping the cards would take the student's whole
    // rating history with it and reset every next_review_at. Updating in place
    // keeps both. bkt_mastery is keyed on (student, concept) and is untouched
    // either way.
    const cardByConcept = new Map(
      existingCards
        .filter((c) => c.concept_id)
        .map((c) => [c.concept_id as string, c.id as string])
    );
    const liveConceptIds = new Set(concepts.map((c) => c.id as string));

    const toInsert = concepts.filter((c) => !cardByConcept.has(c.id as string));
    const toUpdate = concepts.filter((c) => cardByConcept.has(c.id as string));
    // Cards whose concept the educator has since deleted, plus any legacy card
    // with no concept_id at all — neither can be reconciled, so both go.
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
