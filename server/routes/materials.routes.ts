import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateFlashcardsFromConcepts } from '../lib/groq';
import { generateEmbedding } from '../lib/gemini';
import {
  CreateMaterialSchema, GenerateFlashcardsSchema,
  CreateConceptSchema, UpdateConceptSchema,
} from '../types/api';
import { extractPdfPages, type PdfPage } from '../lib/pdfText';
import { extractConcepts } from '../lib/conceptExtraction';
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

/**
 * GET /api/materials/space/:spaceId
 * Lists all materials for a study space.
 *
 * NOTE: this targets the dropped `space_id` column and belongs to the student
 * study-space read path, which is outside the scope of the upload rebuild. Left
 * as-is intentionally; it should be reworked to join through
 * `study_space_materials` when the student side is revisited.
 */
router.get('/space/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('*')
    .eq('space_id', req.params.spaceId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch materials', message: error.message });
    return;
  }

  res.json({ data });
});

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
 */
router.get('/:id/view', async (req: Request, res: Response): Promise<void> => {
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
 * Returns all extracted concepts for a material.
 */
router.get('/:id/concepts', async (req: Request, res: Response): Promise<void> => {
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

/** Returns the material if it exists AND belongs to the caller, else null. */
async function ownedMaterial(userId: string, materialId: string) {
  const { data } = await supabaseAdmin
    .from('materials')
    .select('id, educator_id')
    .eq('id', materialId)
    .maybeSingle();
  if (!data || data.educator_id !== userId) return null;
  return data;
}

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
  if (!(await ownedMaterial(req.user!.id, req.params.id))) {
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
    if (!(await ownedMaterial(req.user!.id, req.params.materialId))) {
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
    if (!(await ownedMaterial(req.user!.id, req.params.materialId))) {
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
 */
import { FetchConceptsBatchSchema } from '../types/api';

router.post('/concepts/batch', async (req: Request, res: Response): Promise<void> => {
  const parsed = FetchConceptsBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { material_ids } = parsed.data;

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
 * Returns the current parsed_status of a material.
 */
router.get('/:id/status', async (req: Request, res: Response): Promise<void> => {
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

/**
 * POST /api/materials/generate-flashcards
 *
 * Generates AI flashcard pairs from the pre-extracted concepts of the selected materials.
 *
 * Flow:
 * 1. Validate the request body (material_ids)
 * 2. Fetch all concepts from the concepts table WHERE material_id IN (...)
 * 3. Pass concepts to Groq llama-3.3-70b-versatile via generateFlashcardsFromConcepts()
 * 4. Return { title, description, cards: [{ front, back }] } to the frontend
 *
 * Body: { material_ids: string[] }
 */
router.post('/generate-flashcards', async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateFlashcardsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { material_ids, format } = parsed.data;

  // 1. Fetch all concepts for the selected materials
  const { data: concepts, error: conceptsError } = await supabaseAdmin
    .from('concepts')
    .select('term, definition')
    .in('material_id', material_ids)
    .order('created_at', { ascending: true });

  if (conceptsError) {
    res.status(500).json({ error: 'Failed to fetch concepts', message: conceptsError.message });
    return;
  }

  if (!concepts || concepts.length === 0) {
    res.status(422).json({
      error: 'No concepts found',
      message: 'The selected materials have no extracted concepts yet. Please wait for processing to complete.',
    });
    return;
  }

  console.log(`[Flashcard Generation] 🃏 Generating flashcards from ${concepts.length} concepts across ${material_ids.length} material(s)`);

  // 2. Generate flashcards using Groq
  try {
    const result = await generateFlashcardsFromConcepts(concepts, format);

    console.log(`[Flashcard Generation] ✅ Generated ${result.cards.length} flashcards`);

    res.status(200).json({
      data: result,
      message: `Generated ${result.cards.length} flashcards from ${concepts.length} concepts`,
    });
  } catch (err: any) {
    console.error('[Flashcard Generation] ❌ Error:', err.message);
    res.status(500).json({
      error: 'Flashcard generation failed',
      message: err.message ?? 'Unknown error from Groq',
    });
  }
});

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
