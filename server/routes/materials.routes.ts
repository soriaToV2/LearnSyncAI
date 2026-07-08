import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding, generateJsonFromDocument } from '../lib/gemini';
import { generateFlashcardsFromConcepts } from '../lib/groq';
import { CreateMaterialSchema, GenerateFlashcardsSchema } from '../types/api';
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

/**
 * POST /api/materials
 * Uploads a file to Supabase Storage and inserts a material record.
 * Instructors only. Triggers background concept extraction.
 *
 * Form data: file (binary), course_id, title
 */
router.post(
  '/',
  requireRole('student'),
  (req: Request, res: Response, next: import('express').NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message });
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
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { space_id, title } = parsed.data;
    const fileName = `${space_id}/${Date.now()}-${req.file.originalname}`;

    // 1. Upload to Supabase Storage bucket "materials"
    const { error: storageError } = await supabaseAdmin.storage
      .from('materials')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (storageError) {
      res.status(500).json({ error: 'File upload failed', message: storageError.message });
      return;
    }

    // 2. Insert material record with status 'pending'
    const { data: material, error: dbError } = await supabaseAdmin
      .from('materials')
      .insert({
        space_id,
        uploader_id: req.user!.id,
        title,
        storage_path: fileName,
        parsed_status: 'pending',
      })
      .select()
      .single();

    if (dbError) {
      res.status(500).json({ error: 'Failed to save material record', message: dbError.message });
      return;
    }

    // 3. Trigger background concept extraction (non-blocking)
    processMaterialAsync(material.id, req.file.buffer, req.file.mimetype).catch((err) =>
      console.error(`[Material Processing Error] material_id=${material.id}`, err)
    );

    res.status(201).json({ data: material, message: 'Material uploaded. Concept extraction started.' });
  }
);

/**
 * DELETE /api/materials/:id
 * Deletes a material and its storage file. Instructors only.
 */
router.delete('/:id', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  // Get storage path first
  const { data: material, error: fetchError } = await supabaseAdmin
    .from('materials')
    .select('storage_path')
    .eq('id', req.params.id)
    .single();

  if (fetchError || !material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  // Delete from storage
  await supabaseAdmin.storage.from('materials').remove([material.storage_path]);

  // Delete DB record (cascade removes concepts)
  const { error } = await supabaseAdmin.from('materials').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ error: 'Failed to delete material', message: error.message });
    return;
  }

  res.json({ message: 'Material deleted' });
});

/**
 * GET /api/materials/:id/concepts
 * Returns all extracted concepts for a material.
 */
router.get('/:id/concepts', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition, parent_concept_id, created_at')
    .eq('material_id', req.params.id)
    .order('created_at');

  if (error) {
    res.status(500).json({ error: 'Failed to fetch concepts', message: error.message });
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

/**
 * Extracts concepts from a file buffer using Gemini, generates embeddings,
 * and inserts them into the concepts table. Runs asynchronously after upload.
 */
async function processMaterialAsync(
  materialId: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<void> {
  // Update status to 'processing'
  await supabaseAdmin
    .from('materials')
    .update({ parsed_status: 'processing' })
    .eq('id', materialId);

  try {
    // Convert buffer to base64 for Gemini
    const base64File = fileBuffer.toString('base64');

    const prompt = `
You are an expert academic concept extractor.
Analyze the attached document and extract the most important terms and their definitions.

Return a JSON array of objects with this exact shape:
[{ "term": "string", "definition": "string" }]

Rules:
- Extract all key concepts without missing important details
- Definitions should be concise (1–3 sentences)
- Focus on domain-specific terminology
`;

    const concepts = await generateJsonFromDocument<Array<{ term: string; definition: string }>>(
      prompt,
      mimeType,
      base64File
    );

    // Generate embeddings and insert concepts
    let insertedCount = 0;
    for (const concept of concepts) {
      const embedding = await generateEmbedding(concept.definition);

      // Log the dimension count on the first concept to verify it matches the DB
      if (insertedCount === 0) {
        console.log(`[Material Processing] 🔢 Embedding dimensions: ${embedding.length}`);
      }

      const { error: insertError } = await supabaseAdmin.from('concepts').insert({
        material_id: materialId,
        term: concept.term,
        definition: concept.definition,
        embedding: `[${embedding.join(',')}]`, // pgvector format
      });

      if (insertError) {
        console.error(`[Material Processing] ⚠️ Failed to insert concept "${concept.term}": ${insertError.message}`);
      } else {
        insertedCount++;
      }
    }

    // Update status to 'completed'
    await supabaseAdmin
      .from('materials')
      .update({ parsed_status: 'completed' })
      .eq('id', materialId);

    console.log(`[Material Processing] ✅ material_id=${materialId} — ${insertedCount}/${concepts.length} concepts stored`);
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    console.error(`[Material Processing] ❌ material_id=${materialId} — Error: ${errorMessage}`);
    if (err?.stack) console.error(err.stack);
    // Mark as failed so UI knows it's unrecoverable right now
    await supabaseAdmin
      .from('materials')
      .update({ parsed_status: 'failed' })
      .eq('id', materialId);
  }
}

export default router;
