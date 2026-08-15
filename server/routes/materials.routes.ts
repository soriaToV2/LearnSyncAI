import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding } from '../lib/gemini';
import {
  CreateMaterialSchema, UpdateMaterialSchema,
  CreateConceptSchema, UpdateConceptSchema,
} from '../types/api';
import { extractPdfPages, type PdfPage } from '../lib/pdfText';
import { extractConcepts } from '../lib/conceptExtraction';
import { requireMaterialAccess, rejectInaccessibleMaterials } from '../lib/materialAccess';
import { loadOwnedMaterial } from '../lib/educatorScope';
import multer from 'multer';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

router.use(authenticate);

// GET /api/materials/space/:spaceId was removed. It filtered on materials.space_id,
// which migration 0003 dropped, so it had been failing for every caller. The
// student read path now goes through GET /api/spaces/:id/materials, which joins
// study_space_materials and applies the grade-level and subject filters.

const SCANNED_NOT_SUPPORTED =
  'Scanned documents are not supported yet. This module has no readable text layer; ' +
  'OCR for image-based PDFs is a later phase. Please upload a text-based PDF.';

/** Builds a filesystem-safe storage key under the educator's own folder. */
function storageKey(educatorId: string, title: string): string {
  const safeTitle =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'material';
  return `${educatorId}/${Date.now()}-${safeTitle}.pdf`;
}

/**
 * POST /api/materials
 * Uploads a plain-text PDF learning module and inserts a material record.
 * Educators only. A text PDF starts background concept extraction; a scanned
 * (image-only) PDF is stored and marked failed with a plain-language reason.
 *
 * Form data: file (PDF binary), title, subject, description?, grade_levels (JSON array)
 */
router.post(
  '/',
  requireRole('educator'),
  (req: Request, res: Response, next: import('express').NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        // Multer's own errors (file too large, wrong type) are user-facing 400s.
        const message =
          err?.code === 'LIMIT_FILE_SIZE'
            ? 'That file is larger than the 20 MB limit.'
            : err?.message ?? 'File upload failed';
        return res.status(400).json({ error: 'Upload rejected', message });
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded', message: 'Choose a PDF to upload.' });
      return;
    }

    const { title, subject, description, grade_levels } = parsed.data;
    const educatorId = req.user!.id;

    // Validate the subject up front so a bad code returns a readable 400 rather
    // than a foreign-key 500 after the file is already in storage.
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

    // Read the PDF once: page count, per-page text, and whether it is scanned.
    let pdf;
    try {
      pdf = await extractPdfPages(req.file.buffer);
    } catch {
      res.status(400).json({
        error: 'Unreadable PDF',
        message: 'This file could not be read as a PDF. Please upload a valid PDF.',
      });
      return;
    }

    if (pdf.pageCount < 1) {
      res.status(400).json({ error: 'Empty PDF', message: 'This PDF has no pages.' });
      return;
    }

    // Store the raw file (private bucket). The leading educator folder is what
    // storage RLS keys on.
    const fileName = storageKey(educatorId, title);
    const { error: storageError } = await supabaseAdmin.storage
      .from('materials')
      .upload(fileName, req.file.buffer, { contentType: 'application/pdf' });

    if (storageError) {
      res.status(500).json({ error: 'File upload failed', message: storageError.message });
      return;
    }

    // Insert the material row. Scanned files are marked failed immediately and
    // never sent to extraction; text PDFs start as pending.
    const { data: material, error: dbError } = await supabaseAdmin
      .from('materials')
      .insert({
        educator_id: educatorId,
        title,
        description: description ?? null,
        subject,
        grade_levels,
        storage_path: fileName,
        file_size_bytes: req.file.size,
        page_count: pdf.pageCount,
        is_scanned: pdf.isScanned,
        parsed_status: pdf.isScanned ? 'failed' : 'pending',
        parse_error: pdf.isScanned ? SCANNED_NOT_SUPPORTED : null,
      })
      .select()
      .single();

    if (dbError) {
      // Roll back the orphaned storage object so a failed insert leaves nothing behind.
      await supabaseAdmin.storage.from('materials').remove([fileName]);
      res.status(500).json({ error: 'Failed to save material record', message: dbError.message });
      return;
    }

    if (pdf.isScanned) {
      res.status(201).json({
        data: material,
        message: 'Scanned document detected — saved but not processed (OCR is a later phase).',
      });
      return;
    }

    // Fire-and-forget background extraction, reusing the text we already parsed.
    processMaterialAsync(material.id, pdf.pages).catch((err) =>
      console.error(`[Material Processing Error] material_id=${material.id}`, err)
    );

    res.status(201).json({ data: material, message: 'Material uploaded. Concept extraction started.' });
  }
);

/**
 * GET /api/materials
 * Lists the calling educator's own materials, each with its concept count.
 */
router.get('/', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const { data: materials, error } = await supabaseAdmin
    .from('materials')
    .select('*')
    .eq('educator_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch materials', message: error.message });
    return;
  }

  const ids = (materials ?? []).map((m) => m.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: conceptRows } = await supabaseAdmin
      .from('concepts')
      .select('material_id')
      .in('material_id', ids);
    for (const row of conceptRows ?? []) {
      counts[row.material_id] = (counts[row.material_id] ?? 0) + 1;
    }
  }

  res.json({ data: (materials ?? []).map((m) => ({ ...m, concept_count: counts[m.id] ?? 0 })) });
});

/**
 * GET /api/materials/:id
 * Returns one of the calling educator's own materials (with its concept count).
 */
router.get('/:id', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const { data: material, error } = await supabaseAdmin
    .from('materials')
    .select('*')
    .eq('id', req.params.id)
    .eq('educator_id', req.user!.id)
    .maybeSingle();

  if (error || !material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const { count } = await supabaseAdmin
    .from('concepts')
    .select('*', { count: 'exact', head: true })
    .eq('material_id', material.id);

  res.json({ data: { ...material, concept_count: count ?? 0 } });
});

/**
 * PATCH /api/materials/:id
 *
 * The only writer for `is_archived` and `grade_levels`. Both controls existed in
 * the UI as local `useState` toggles that looked functional and persisted
 * nothing, because there was no endpoint behind them — the seven educator routes
 * were upload, list, get, delete and concept CRUD, and none of them mutated the
 * material row.
 *
 * `UpdateMaterialSchema` accepts those two fields and nothing else; the reasons
 * per excluded field are on the schema itself.
 *
 * ── Archiving needs no cascade, and must not have one ────────────────────────
 *
 * Every READ already honours `is_archived`: `accessibleMaterialIds()` and
 * `publishedMaterialIds()` filter it for students (the educator branch is
 * archive-blind on purpose, so an educator keeps access to their own archived
 * lesson), and `spaceMaterialIds()` intersects the stored
 * `study_space_materials` list against the live published set. So archiving
 * removes the material from every student's space at their next read while the
 * LINK ROW SURVIVES — un-archiving brings it back on its own, with no
 * bookkeeping. Deleting `study_space_materials` here would break exactly that.
 *
 * BKT mastery is keyed on (student, concept) and is untouched either way.
 * Archive is reversible; DELETE is not, because it cascades concepts → mastery.
 *
 * ── Changing the grade level is the same mechanism ───────────────────────────
 *
 * Students in the old grade stop seeing it, their link rows and mastery rows
 * survive, and setting the grade back restores everything. Class Performance
 * follows too: `rosterFor()` re-derives the class from `grade_levels`, so the old
 * grade's students disappear and the new grade's appear as "not started".
 */
router.patch('/:id', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  // 404, never 403 — a 403 confirms the id names a real material, and material
  // ids are visible in the address bar.
  if (!(await loadOwnedMaterial(req.params.id, req.user!.id))) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const update: Record<string, unknown> = {
    // `updated_at` is NOT NULL DEFAULT now() with no trigger behind it, so an
    // unset value here would leave the row claiming its upload time forever.
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.is_archived !== undefined) update.is_archived = parsed.data.is_archived;
  if (parsed.data.grade_levels !== undefined) update.grade_levels = parsed.data.grade_levels;

  const { data: material, error } = await supabaseAdmin
    .from('materials')
    .update(update)
    .eq('id', req.params.id)
    .eq('educator_id', req.user!.id)
    .select('*')
    .maybeSingle();

  if (error || !material) {
    res.status(500).json({ error: 'Failed to update material' });
    return;
  }

  // Same shape as GET /:id so the client can replace its row wholesale rather
  // than merging fields and drifting.
  const { count } = await supabaseAdmin
    .from('concepts')
    .select('*', { count: 'exact', head: true })
    .eq('material_id', material.id);

  res.json({ data: { ...material, concept_count: count ?? 0 } });
});

/**
 * DELETE /api/materials/:id
 * Deletes one of the calling educator's own materials and its storage file.
 * Educators only; ownership is checked explicitly because the service role
 * bypasses RLS.
 */
router.delete('/:id', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const { data: material, error: fetchError } = await supabaseAdmin
    .from('materials')
    .select('storage_path, educator_id')
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchError || !material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  if (material.educator_id !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own materials.' });
    return;
  }

  // Delete from storage (best effort), then the DB record (cascade removes concepts).
  await supabaseAdmin.storage.from('materials').remove([material.storage_path]);

  const { error } = await supabaseAdmin.from('materials').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Failed to delete material', message: error.message });
    return;
  }

  res.json({ message: 'Material deleted' });
});

/**
 * GET /api/materials/:id/view
 * Returns a short-lived signed URL for viewing the material's file directly
 * from the private "materials" storage bucket. The file exists in storage from
 * the moment of upload, so this works regardless of parsed_status.
 *
 * Guarded: this hands out a URL to the actual PDF, so a student may only reach a
 * non-archived material published to their own grade level. The educator who owns
 * it, and admins, still pass.
 */
router.get('/:id/view', requireMaterialAccess(), async (req: Request, res: Response): Promise<void> => {
  const { data: material, error: fetchError } = await supabaseAdmin
    .from('materials')
    .select('storage_path')
    .eq('id', req.params.id)
    .single();

  if (fetchError || !material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const { data, error } = await supabaseAdmin.storage
    .from('materials')
    .createSignedUrl(material.storage_path, 3600); // 1-hour expiry

  if (error || !data) {
    res.status(500).json({ error: 'Failed to create view URL', message: error?.message });
    return;
  }

  res.json({ data: { url: data.signedUrl } });
});

/**
 * GET /api/materials/:id/concepts
 * Returns all extracted concepts for a material. Guarded — concepts are the
 * material's content in text form, so reading them is reading the material.
 */
router.get('/:id/concepts', requireMaterialAccess(), async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition, parent_concept_id, source_pages, created_at')
    .eq('material_id', req.params.id)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch concepts', message: error.message });
    return;
  }

  res.json({ data });
});

// ── Concept editing (educator-curated knowledge base) ──────────
//
// Concepts are the exclusive knowledge base for every AI-assisted feature, so an
// educator can correct or supplement what the extractor produced. A hand-added or
// edited definition is embedded the same way an extracted one is, so it works in
// Free Recall, the chatbot, and generated assessments — otherwise it would be dead
// weight the similarity search never matches.

const CONCEPT_RETURN = 'id, term, definition, parent_concept_id, source_pages, created_at';

// The private `ownedMaterial()` that used to live here is now
// `loadOwnedMaterial()` in `server/lib/educatorScope.ts`. It moved when
// `educator.routes.ts` needed the same check: educator material ownership gets
// one home before it acquires a second copy, which is exactly how
// `loadOwnedSpace` reached four before `spaceAccess.ts` collected it.

/**
 * POST /api/materials/:id/concepts
 * Adds a concept the extractor missed. Educators only, own materials only.
 */
router.post('/:id/concepts', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateConceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  if (!(await loadOwnedMaterial(req.params.id, req.user!.id))) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const { term, definition, source_pages } = parsed.data;

  let embedding: number[];
  try {
    embedding = await generateEmbedding(definition);
  } catch (err: any) {
    res.status(502).json({ error: 'Embedding failed', message: err?.message ?? 'Could not embed the definition.' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('concepts')
    .insert({
      material_id: req.params.id,
      term,
      definition,
      embedding: `[${embedding.join(',')}]`,
      source_pages: source_pages ?? null,
    })
    .select(CONCEPT_RETURN)
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to add concept', message: error.message });
    return;
  }
  res.status(201).json({ data });
});

/**
 * PUT /api/materials/:materialId/concepts/:conceptId
 * Edits a concept's term and/or definition. Re-embeds when the definition changes.
 */
router.put(
  '/:materialId/concepts/:conceptId',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateConceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }
    if (!(await loadOwnedMaterial(req.params.materialId, req.user!.id))) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }

    const { term, definition, source_pages } = parsed.data;
    const update: Record<string, unknown> = {};
    if (term !== undefined) update.term = term;
    if (source_pages !== undefined) update.source_pages = source_pages;
    if (definition !== undefined) {
      update.definition = definition;
      try {
        const embedding = await generateEmbedding(definition);
        update.embedding = `[${embedding.join(',')}]`;
      } catch (err: any) {
        res.status(502).json({ error: 'Embedding failed', message: err?.message ?? 'Could not embed the definition.' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('concepts')
      .update(update)
      .eq('id', req.params.conceptId)
      .eq('material_id', req.params.materialId)
      .select(CONCEPT_RETURN)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: 'Failed to update concept', message: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Concept not found' });
      return;
    }
    res.json({ data });
  }
);

/**
 * DELETE /api/materials/:materialId/concepts/:conceptId
 * Removes a concept from a material the educator owns.
 */
router.delete(
  '/:materialId/concepts/:conceptId',
  requireRole('educator'),
  async (req: Request, res: Response): Promise<void> => {
    if (!(await loadOwnedMaterial(req.params.materialId, req.user!.id))) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('concepts')
      .delete()
      .eq('id', req.params.conceptId)
      .eq('material_id', req.params.materialId);

    if (error) {
      res.status(500).json({ error: 'Failed to delete concept', message: error.message });
      return;
    }
    res.json({ message: 'Concept deleted' });
  }
);

/**
 * POST /api/materials/concepts/batch
 * Returns all extracted concepts for an array of materials.
 *
 * One row per term is guaranteed by extraction (see the ONE ROW PER TERM
 * invariant in `lib/conceptExtraction.ts`), so callers can render these directly
 * without collapsing duplicates.
 */
import { FetchConceptsBatchSchema } from '../types/api';

router.post('/concepts/batch', async (req: Request, res: Response): Promise<void> => {
  const parsed = FetchConceptsBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { material_ids } = parsed.data;

  // Every id must be one the caller may read — otherwise a single valid id could
  // be used to smuggle another grade's material into the same batch.
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  const { data, error } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition, parent_concept_id, material_id, created_at')
    .in('material_id', material_ids)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch batch concepts', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * GET /api/materials/:id/status
 * Returns the current parsed_status of a material. Guarded — an unguarded status
 * probe confirms which material ids exist.
 */
router.get('/:id/status', requireMaterialAccess(), async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('parsed_status')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Material not found', message: error?.message });
    return;
  }

  res.json({ data });
});

// Flashcard generation used to live here: it asked Groq to rewrite every concept
// into a question/answer pair and handed the result to the browser to save.
// It is now POST /api/spaces/:id/decks/:deckId/generate, which builds cards from
// the concept rows verbatim and writes them itself. Three reasons it moved:
// the educator vets concepts, so a model paraphrase put unvetted text in front of
// students; the prompt asked for one card per concept but capped at 4096 tokens,
// which truncates on a real material; and free-form pairs cannot be traced back
// to a concept_id, which is the one thing BKT needs.

// ── Background Processing ──────────────────────────────────

/** Insert concepts in modest batches so one large document doesn't send a huge payload. */
const CONCEPT_INSERT_BATCH = 25;

/**
 * Runs windowed concept extraction over the already-parsed page text, then
 * inserts each concept (with its embedding and source pages). Runs asynchronously
 * after upload. Any failure lands in `parsed_status = 'failed'` with a readable
 * `parse_error`, so the educator sees a reason rather than a document stuck on
 * Processing.
 */
async function processMaterialAsync(materialId: string, pages: PdfPage[]): Promise<void> {
  await supabaseAdmin
    .from('materials')
    .update({ parsed_status: 'processing', parse_error: null })
    .eq('id', materialId);

  try {
    const concepts = await extractConcepts(pages);

    const rows = concepts.map((c) => ({
      material_id: materialId,
      term: c.term,
      definition: c.definition,
      embedding: `[${c.embedding.join(',')}]`, // pgvector text format
      source_pages: c.source_pages,
    }));

    for (let i = 0; i < rows.length; i += CONCEPT_INSERT_BATCH) {
      const chunk = rows.slice(i, i + CONCEPT_INSERT_BATCH);
      const { error: insertError } = await supabaseAdmin.from('concepts').insert(chunk);
      if (insertError) {
        throw new Error(`Saving extracted concepts failed: ${insertError.message}`);
      }
    }

    await supabaseAdmin
      .from('materials')
      .update({ parsed_status: 'completed' })
      .eq('id', materialId);

    console.log(`[Material Processing] ✅ material_id=${materialId} — ${rows.length} concepts stored`);
  } catch (err: any) {
    const errorMessage = (err?.message ?? String(err)).slice(0, 500);
    console.error(`[Material Processing] ❌ material_id=${materialId} — ${errorMessage}`);
    if (err?.stack) console.error(err.stack);
    await supabaseAdmin
      .from('materials')
      .update({ parsed_status: 'failed', parse_error: errorMessage })
      .eq('id', materialId);
  }
}

export default router;
