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

/**
 * Documented ingest limits: 20 MB per material (`materials_file_size_limit` and
 * the bucket's `file_size_limit` both say 20,971,520), and scanned or
 * photographed documents at most 20 pages (`materials_scanned_page_limit`).
 * Both are enforced HERE, before anything reaches storage, so the educator gets
 * a sentence rather than a CHECK-constraint 500 after the file is already up.
 */
const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
const MAX_SCANNED_PAGES = 20;

/**
 * One upload is EITHER one PDF (text or scanned) OR up to MAX_SCANNED_PAGES
 * photos of the pages, all under the same `file` field. Photos are assembled
 * into a single PDF server-side (`pdfAssemble.ts`), so from the storage bucket
 * onward there is only ever one shape of material. The mimetype filter is a
 * courtesy; the bytes are sniffed again before they are embedded.
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

// GET /api/materials/space/:spaceId was removed. It filtered on materials.space_id,
// which migration 0003 dropped, so it had been failing for every caller. The
// student read path now goes through GET /api/spaces/:id/materials, which joins
// study_space_materials and applies the grade-level and subject filters.

/**
 * Every `materials` column EXCEPT `ocr_pages`, for the educator list, detail
 * and upload responses. A 20-page transcript is tens of kilobytes and belongs
 * to one screen; it is served by `GET /:id/ocr-text` on demand, never carried
 * by a list. Add a column here when the table gains one a screen renders.
 */
// One literal, not a concatenation: supabase-js types the result by parsing the
// select string, and a `string`-typed expression parses to GenericStringError.
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
 * POST /api/materials
 * Uploads a learning module and inserts a material record. Educators only.
 *
 * Three inputs, one storage shape:
 *   - a text PDF          → stored as-is, concept extraction runs on its text layer;
 *   - a scanned PDF       → stored as-is, OCR (`ocr.ts`) produces the text first;
 *   - JPEG/PNG photos     → assembled into one PDF (`pdfAssemble.ts`), then as a scan.
 *
 * Every branch ends in `processMaterialAsync()`; nothing is marked failed at
 * upload any more. Until 2026-09-19 a scanned PDF was stored `failed` with
 * "OCR is a later phase", which contradicted the paper (p. 60).
 *
 * Form data: file (one PDF, or 1–20 photos), title, subject, description?, grade_levels (JSON array)
 */
router.post(
  '/',
  requireRole('educator'),
  (req: Request, res: Response, next: import('express').NextFunction) => {
    upload.array('file', MAX_SCANNED_PAGES)(req, res, (err: any) => {
      if (err) {
        // Multer's own errors (file too large, too many, wrong type) are user-facing 400s.
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

    // One PDF, or photos only. A PDF among photos has no sensible page order,
    // and two PDFs are two materials.
    const pdfCount = files.filter((f) => f.mimetype === 'application/pdf').length;
    if (pdfCount > 1 || (pdfCount === 1 && files.length > 1)) {
      res.status(400).json({
        error: 'Mixed upload',
        message: 'Upload one PDF, or photos of the pages — not both in the same material.',
      });
      return;
    }

    // The 20 MB limit is on the MATERIAL. Multer only caps each file, so twenty
    // 3 MB photos would otherwise sail through and fail at the bucket.
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_MATERIAL_BYTES) {
      res.status(400).json({
        error: 'Upload too large',
        message: `These photos add up to ${(totalBytes / (1024 * 1024)).toFixed(1)} MB. The limit is 20 MB per material.`,
      });
      return;
    }

    // Whatever arrived, we hold ONE PDF from here on.
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

    // Read the PDF once: page count, per-page text, and whether it is scanned.
    // Photos assembled above come back `isScanned` by construction — there is
    // no text layer to find — which is exactly the branch they need.
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

    // Store the file (private bucket). The leading educator folder is what
    // storage RLS keys on.
    const fileName = storageKey(educatorId, title);
    const { error: storageError } = await supabaseAdmin.storage
      .from('materials')
      .upload(fileName, fileBuffer, { contentType: 'application/pdf' });

    if (storageError) {
      res.status(500).json({ error: 'File upload failed', message: storageError.message });
      return;
    }

    // Insert the material row. Every kind starts pending; the scanned branch of
    // processMaterialAsync() runs OCR before extraction.
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
      // Roll back the orphaned storage object so a failed insert leaves nothing behind.
      await supabaseAdmin.storage.from('materials').remove([fileName]);
      res.status(500).json({ error: 'Failed to save material record', message: dbError.message });
      return;
    }

    // Fire-and-forget background processing. A text PDF reuses the pages we
    // already parsed; a scan carries its bytes along so OCR can read them.
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

/**
 * GET /api/materials
 * Lists the calling educator's own materials, each with its concept count.
 */
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

/**
 * GET /api/materials/:id
 * Returns one of the calling educator's own materials (with its concept count).
 */
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
 * PATCH /api/materials/:id
 *
 * The only writer for `is_archived`, `grade_levels`, `title` and `subject`.
 * Archive and grade access existed in
 * the UI as local `useState` toggles that looked functional and persisted
 * nothing, because there was no endpoint behind them — the seven educator routes
 * were upload, list, get, delete and concept CRUD, and none of them mutated the
 * material row.
 *
 * `UpdateMaterialSchema` accepts those four fields and nothing else; the reasons
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
 *
 * ── So is changing the subject ───────────────────────────────────────────────
 *
 * `spaceMaterialIds()` requires the material's live subject to equal the space's,
 * so it leaves spaces of the old subject and is offered by "N new materials
 * available" in spaces of the new one. Link rows and mastery survive; setting the
 * subject back restores it. Class Performance is unaffected — the roster is
 * grade-based, not subject-based.
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

  // Same check as upload, so an unknown code is a readable 400 rather than an
  // FK violation surfacing as a 500.
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
    // `updated_at` is NOT NULL DEFAULT now() with no trigger behind it, so an
    // unset value here would leave the row claiming its upload time forever.
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
 * GET /api/materials/:id/ocr-text
 * The per-page transcript OCR produced for a scanned or photographed material,
 * `{ pages: [{ page, text }] }`, empty for a text PDF or a scan that has not
 * been read yet. Owner only — 404 otherwise, like every other educator read.
 *
 * Its own route rather than a column on the detail payload because a 20-page
 * transcript is tens of kilobytes that exactly one collapsible panel wants;
 * `MATERIAL_COLUMNS` keeps it out of the list and the detail on purpose. A
 * student never reaches it: they read the pages themselves in the viewer, and
 * the assistant reads the concepts.
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
 *
 * ⚠️ Ran on bare `authenticate` until the first-login gate landed. Its ONLY
 * caller is the student Feynman tab (`FeynmanTab.tsx`), so `requireRole('student')`
 * is the correct set — verified before narrowing it, since a wider guard here
 * would have broken an educator path had one existed. `rejectInaccessibleMaterials()`
 * below already rejected disabled accounts, but that is material access, not
 * account state: `requireRole` is the only middleware that reads `profiles`, and
 * therefore the only place the activation gate can apply.
 */
import { FetchConceptsBatchSchema } from '../types/api';

router.post('/concepts/batch', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
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
 * The bytes of a scanned/photographed PDF, carried from the upload handler so
 * OCR can read them without a round trip to storage.
 */
interface ScanInput {
  buffer: Buffer;
  pageCount: number;
}

/**
 * Runs windowed concept extraction over the page text, then inserts each
 * concept (with its embedding and source pages). Runs asynchronously after
 * upload. Any failure lands in `parsed_status = 'failed'` with a readable
 * `parse_error`, so the educator sees a reason rather than a document stuck on
 * Processing.
 *
 * For a scan (`scan` present) the page text comes from OCR first. The transcript
 * is written to `ocr_pages` BEFORE extraction runs, so an extraction failure —
 * or a model quota spent halfway — still leaves the educator the text that was
 * read, which is the one thing that tells a blurry photo from a model problem.
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
