import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding, generateJsonFromDocument } from '../lib/gemini';
import { CreateMaterialSchema } from '../types/api';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() }); // Store file in memory for upload to Supabase Storage

router.use(authenticate);

/**
 * GET /api/materials/course/:courseId
 * Lists all materials for a course.
 */
router.get('/course/:courseId', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('*')
    .eq('course_id', req.params.courseId)
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
  upload.single('file'),
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

    const { course_id, title } = parsed.data;
    const fileName = `${course_id}/${Date.now()}-${req.file.originalname}`;

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
        course_id,
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
    // Note: The trigger_new_material DB trigger auto-notifies enrolled students.
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
    // Reset to pending so it can be retried on next server restart
    await supabaseAdmin
      .from('materials')
      .update({ parsed_status: 'pending' })
      .eq('id', materialId);
  }
}

export default router;
