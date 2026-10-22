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
import { imagesToPdf } from '../lib/pdfAssemble';
import { transcribeScannedPdf } from '../lib/ocr';
import { requireMaterialAccess, rejectInaccessibleMaterials } from '../lib/materialAccess';
import { loadOwnedMaterial } from '../lib/educatorScope';
import multer from 'multer';

const router = Router();

/** Ingest limits (20 MB per material, 20 scanned pages), enforced here before anything reaches storage. */
const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
const MAX_SCANNED_PAGES = 20;

/**
 * One PDF, or up to MAX_SCANNED_PAGES photos, under the `file` field. Photos become one PDF server-side.
 * The mimetype filter is a courtesy; bytes are sniffed again before embedding.
 */
const ACCEPTED_MIMETYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MATERIAL_BYTES, files: MAX_SCANNED_PAGES },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only a PDF or JPEG/PNG photos can be uploaded.'));
    }
  },
});

router.use(authenticate);

/** Every materials column except the large `ocr_pages` (served by GET /:id/ocr-text). */
// Must stay one string literal: supabase-js types the select by parsing it.
const MATERIAL_COLUMNS =
  'id, educator_id, title, description, subject, grade_levels, storage_path, file_size_bytes, page_count, is_scanned, parsed_status, parse_error, is_archived, created_at, updated_at';

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
 * POST /api/materials: upload a text PDF, a scanned PDF, or JPEG/PNG photos (assembled into one PDF).
 * Every kind is processed by processMaterialAsync(); scans go through OCR first.
 */
router.post(
  '/',
  requireRole('educator'),
  (req: Request, res: Response, next: import('express').NextFunction) => {
    upload.array('file', MAX_SCANNED_PAGES)(req, res, (err: any) => {
      if (err) {
        // Multer errors (size, count, type) are user-facing 400s.
        const message =
          err?.code === 'LIMIT_FILE_SIZE'
            ? 'That file is larger than the 20 MB limit.'
            : err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE'
              ? `Upload at most ${MAX_SCANNED_PAGES} photos per material.`
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

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      res.status(400).json({ error: 'No file uploaded', message: 'Choose a PDF, or photos of the pages, to upload.' });
      return;
    }

    const { title, subject, description, grade_levels } = parsed.data;
    const educatorId = req.user!.id;

    // Validate the subject first so a bad code is a 400, not an FK 500 after upload.
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

    // One PDF, or photos only.
    const pdfCount = files.filter((f) => f.mimetype === 'application/pdf').length;
    if (pdfCount > 1 || (pdfCount === 1 && files.length > 1)) {
      res.status(400).json({
        error: 'Mixed upload',
        message: 'Upload one PDF, or photos of the pages — not both in the same material.',
      });
      return;
    }

    // The 20 MB limit is per material; multer only caps each file.
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_MATERIAL_BYTES) {
      res.status(400).json({
        error: 'Upload too large',
        message: `These photos add up to ${(totalBytes / (1024 * 1024)).toFixed(1)} MB. The limit is 20 MB per material.`,
      });
      return;
    }

    // From here on there is one PDF.
    let fileBuffer: Buffer;
    if (pdfCount === 1) {
      fileBuffer = files[0].buffer;
    } else {
      try {
        fileBuffer = await imagesToPdf(files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype })));
      } catch (err) {
        res.status(400).json({
          error: 'Unreadable photo',
          message: err instanceof Error ? err.message : 'One of the photos could not be read.',
        });
        return;
      }
      if (fileBuffer.length > MAX_MATERIAL_BYTES) {
        res.status(400).json({
          error: 'Upload too large',
          message: 'These photos make a document larger than the 20 MB limit. Use fewer or smaller photos.',
        });
        return;
      }
    }

    // Page count, per-page text and scan detection. Assembled photos read as scanned by construction.
    let pdf;
    try {
      pdf = await extractPdfPages(fileBuffer);
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

    if (pdf.isScanned && pdf.pageCount > MAX_SCANNED_PAGES) {
      res.status(400).json({
        error: 'Too many pages',
        message: `Scanned or photographed documents are limited to ${MAX_SCANNED_PAGES} pages; this one has ${pdf.pageCount}. Split it into two materials.`,
      });
      return;
    }

    // Private bucket; storage RLS keys on the leading educator folder.
    const fileName = storageKey(educatorId, title);
    const { error: storageError } = await supabaseAdmin.storage
      .from('materials')
      .upload(fileName, fileBuffer, { contentType: 'application/pdf' });

    if (storageError) {
      res.status(500).json({ error: 'File upload failed', message: storageError.message });
      return;
    }

    // Every kind starts pending.
    const { data: material, error: dbError } = await supabaseAdmin
      .from('materials')
      .insert({
        educator_id: educatorId,
        title,
        description: description ?? null,
        subject,
        grade_levels,
        storage_path: fileName,
        file_size_bytes: fileBuffer.length,
        page_count: pdf.pageCount,
        is_scanned: pdf.isScanned,
        parsed_status: 'pending',
        parse_error: null,
      })
      .select(MATERIAL_COLUMNS)
      .single();

    if (dbError) {
      // Roll back the orphaned storage object.
      await supabaseAdmin.storage.from('materials').remove([fileName]);
      res.status(500).json({ error: 'Failed to save material record', message: dbError.message });
      return;
    }

    // Fire-and-forget processing. A scan carries its bytes for OCR.
    processMaterialAsync(
      material.id,
      pdf.pages,
      pdf.isScanned ? { buffer: fileBuffer, pageCount: pdf.pageCount } : undefined
    ).catch((err) => console.error(`[Material Processing Error] material_id=${material.id}`, err));

    res.status(201).json({
      data: material,
      message: pdf.isScanned
        ? 'Material uploaded. Reading the pages, then extracting concepts.'
        : 'Material uploaded. Concept extraction started.',
    });
  }
);

/** GET /api/materials: the caller's own materials with concept counts. */
router.get('/', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const { data: materials, error } = await supabaseAdmin
    .from('materials')
    .select(MATERIAL_COLUMNS)
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

/** GET /api/materials/:id: one of the caller's own materials. */
router.get('/:id', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const { data: material, error } = await supabaseAdmin
    .from('materials')
    .select(MATERIAL_COLUMNS)
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
 * PATCH /api/materials/:id: the only writer for is_archived, grade_levels, title and subject.
 * No cascade, and there must not be one: reads filter live, so link rows and mastery survive and
 * reverting the change restores everything. Delete is the destructive operation.
 */
router.patch('/:id', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  // 404, never 403.
  if (!(await loadOwnedMaterial(req.params.id, req.user!.id))) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  // Same subject check as upload.
  if (parsed.data.subject !== undefined) {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('code')
      .eq('code', parsed.data.subject)
      .maybeSingle();
    if (!subjectRow) {
      res.status(400).json({
        error: 'Unknown subject',
        message: `"${parsed.data.subject}" is not a recognised subject.`,
      });
      return;
    }
  }

  const update: Record<string, unknown> = {
    // No trigger maintains updated_at.
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.is_archived !== undefined) update.is_archived = parsed.data.is_archived;
  if (parsed.data.grade_levels !== undefined) update.grade_levels = parsed.data.grade_levels;
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.subject !== undefined) update.subject = parsed.data.subject;

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

  // Same shape as GET /:id so the client can replace its row wholesale.
  const { count } = await supabaseAdmin
    .from('concepts')
    .select('*', { count: 'exact', head: true })
    .eq('material_id', material.id);

  res.json({ data: { ...material, concept_count: count ?? 0 } });
});

/** DELETE /api/materials/:id: the caller's own material and its file (concepts cascade). */
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

  // Storage first (best effort), then the row.
  await supabaseAdmin.storage.from('materials').remove([material.storage_path]);

  const { error } = await supabaseAdmin.from('materials').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Failed to delete material', message: error.message });
    return;
  }

  res.json({ message: 'Material deleted' });
});

/**
 * GET /api/materials/:id/view: a short-lived signed URL to the PDF. Guarded by material access;
 * works whatever the parse status.
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
 * GET /api/materials/:id/ocr-text: the OCR transcript `{ pages: [{ page, text }] }`. Owner only;
 * never reaches students.
 */
router.get('/:id/ocr-text', requireRole('educator'), async (req: Request, res: Response): Promise<void> => {
  const owned = await loadOwnedMaterial(req.params.id, req.user!.id);
  if (!owned) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('ocr_pages')
    .eq('id', owned.id)
    .single();

  if (error || !data) {
    res.status(500).json({ error: 'Failed to load the transcript', message: error?.message });
    return;
  }

  const pages = Array.isArray(data.ocr_pages) ? data.ocr_pages : [];
  res.json({ data: { pages } });
});

/** GET /api/materials/:id/concepts. Guarded: reading concepts is reading the material. */
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

// Concept editing. Educator edits are re-embedded so they behave like extracted concepts.

const CONCEPT_RETURN = 'id, term, definition, parent_concept_id, source_pages, created_at';

/** POST /api/materials/:id/concepts: add a missed concept. Own materials only. */
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

/** PUT /api/materials/:materialId/concepts/:conceptId. Re-embeds when the definition changes. */
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

/** DELETE /api/materials/:materialId/concepts/:conceptId. */
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
 * POST /api/materials/concepts/batch: concepts for several materials (used by the Feynman tab).
 * requireRole('student') applies the activation gate.
 */
import { FetchConceptsBatchSchema } from '../types/api';

router.post('/concepts/batch', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = FetchConceptsBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { material_ids } = parsed.data;

  // Every id must be readable, so a valid id can't smuggle in a forbidden one.
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

/** GET /api/materials/:id/status. Guarded so it can't confirm which ids exist. */
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

// Background processing

/** Insert concepts in modest batches so one large document doesn't send a huge payload. */
const CONCEPT_INSERT_BATCH = 25;

/** A scan's bytes, carried from upload so OCR needn't re-download them. */
interface ScanInput {
  buffer: Buffer;
  pageCount: number;
}

/**
 * Extracts and inserts concepts after upload. Failures set parsed_status = 'failed' with a readable
 * parse_error. For scans, OCR runs first and its transcript is saved before extraction.
 */
async function processMaterialAsync(
  materialId: string,
  pages: PdfPage[],
  scan?: ScanInput
): Promise<void> {
  await supabaseAdmin
    .from('materials')
    .update({ parsed_status: 'processing', parse_error: null })
    .eq('id', materialId);

  try {
    if (scan) {
      pages = await transcribeScannedPdf(scan.buffer, scan.pageCount);
      const { error: ocrSaveError } = await supabaseAdmin
        .from('materials')
        .update({ ocr_pages: pages })
        .eq('id', materialId);
      if (ocrSaveError) {
        throw new Error(`Saving the page transcript failed: ${ocrSaveError.message}`);
      }
    }

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
