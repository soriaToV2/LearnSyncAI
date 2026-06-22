import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateJson } from '../lib/gemini';
import {
  CreateAssessmentSchema,
  UpdateAssessmentStatusSchema,
  SubmitAssessmentSchema,
} from '../types/api';

const router = Router();
router.use(authenticate);

/**
 * GET /api/assessments/course/:courseId
 * Lists all assessments for a course.
 */
router.get('/course/:courseId', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('assessments')
    .select('*')
    .eq('course_id', req.params.courseId)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch assessments', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/assessments
 * Creates a new assessment record (status: draft). Instructors only.
 */
router.post('/', requireRole('instructor'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateAssessmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('assessments')
    .insert({ ...parsed.data, status: 'draft' })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to create assessment', message: error.message });
    return;
  }

  res.status(201).json({ data, message: 'Assessment created in draft' });
});

/**
 * POST /api/assessments/:id/generate
 * Triggers AI generation of question sets. Instructors only.
 *
 * Reads concepts from the assessment's source_material_ids,
 * generates isomorphic question sets using Gemini, and saves them
 * as assessment_sets records. Updates status to 'ready'.
 */
router.post(
  '/:id/generate',
  requireRole('instructor'),
  async (req: Request, res: Response): Promise<void> => {
    const { data: assessment, error: fetchError } = await supabaseAdmin
      .from('assessments')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }

    if (!assessment.source_material_ids?.length) {
      res.status(400).json({ error: 'No source materials specified for generation' });
      return;
    }

    // Fetch concepts from the selected materials
    const { data: concepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      .select('term, definition')
      .in('material_id', assessment.source_material_ids);

    if (conceptsError || !concepts?.length) {
      res.status(400).json({ error: 'No concepts found in selected materials. Ensure materials are fully processed.' });
      return;
    }

    const conceptSummary = concepts
      .map((c) => `- ${c.term}: ${c.definition}`)
      .join('\n');

    const setNames = Array.from(
      { length: assessment.number_of_sets ?? 1 },
      (_, i) => String.fromCharCode(65 + i) // A, B, C...
    );

    // Generate each set
    const generatedSets = [];
    for (const setName of setNames) {
      const prompt = `
You are an expert exam creator. Generate a ${assessment.assessment_type} question set for academic assessment.

Assessment: "${assessment.title}"
Set Name: Set ${setName}
Total Questions: ${assessment.total_questions}
Question Types: ${(assessment.question_types ?? []).join(', ')}

Concepts to test (from course materials):
${conceptSummary}

IMPORTANT — Isomorphic Rule:
${setNames.length > 1 ? `This is Set ${setName} of ${setNames.length} sets. All sets must test the EXACT same concepts at the EXACT same difficulty level, but use DIFFERENT wording, scenarios, or values to prevent cheating.` : 'Generate one comprehensive set.'}

Return a JSON object with this exact shape:
{
  "set_name": "Set ${setName}",
  "questions": [
    {
      "id": number,
      "type": "multiple_choice" | "true_false" | "essay" | "enumeration",
      "question": "string",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] | null,
      "answer": "string",
      "concept": "string",
      "points": number
    }
  ]
}
`;

      const payload = await generateJson<{ set_name: string; questions: unknown[] }>(prompt);
      generatedSets.push({ assessment_id: assessment.id, set_name: `Set ${setName}`, questions_payload: payload });
    }

    // Insert all generated sets
    const { data: sets, error: insertError } = await supabaseAdmin
      .from('assessment_sets')
      .insert(generatedSets)
      .select();

    if (insertError) {
      res.status(500).json({ error: 'Failed to save question sets', message: insertError.message });
      return;
    }

    // Update assessment status to 'ready' for instructor review
    await supabaseAdmin
      .from('assessments')
      .update({ status: 'ready' })
      .eq('id', assessment.id);

    res.json({ data: sets, message: `${setNames.length} question set(s) generated successfully` });
  }
);

/**
 * PUT /api/assessments/:id/status
 * Updates assessment status. Instructors only.
 * Deploying (status → 'deployed') triggers the DB notification trigger.
 */
router.put(
  '/:id/status',
  requireRole('instructor'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateAssessmentStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('assessments')
      .update({ status: parsed.data.status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update status', message: error.message });
      return;
    }

    // Note: The DB trigger `trigger_assessment_deployed` automatically
    // notifies enrolled students when status changes to 'deployed'.

    res.json({ data, message: `Assessment status updated to '${parsed.data.status}'` });
  }
);

/**
 * GET /api/assessments/:id/sets
 * Returns all question sets for an assessment.
 * Students only receive their assigned set (randomly assigned).
 */
router.get('/:id/sets', async (req: Request, res: Response): Promise<void> => {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', req.user!.id)
    .single();

  const { data: sets, error } = await supabaseAdmin
    .from('assessment_sets')
    .select('*')
    .eq('assessment_id', req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch sets', message: error.message });
    return;
  }

  // Instructors see all sets; students get one randomly assigned
  if (profile?.role === 'instructor') {
    res.json({ data: sets });
  } else {
    const assigned = sets[Math.floor(Math.random() * sets.length)] ?? null;
    res.json({ data: assigned ? [assigned] : [] });
  }
});

/**
 * POST /api/assessments/:id/submit
 * Student submits their answers for an assessment. Students only.
 * Write-once: RLS prevents updates/deletes on assessment_submissions.
 */
router.post(
  '/:id/submit',
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    // Check for existing submission (no double submission)
    const { data: existing } = await supabaseAdmin
      .from('assessment_submissions')
      .select('id')
      .eq('assessment_id', req.params.id)
      .eq('student_id', req.user!.id)
      .single();

    if (existing) {
      res.status(409).json({ error: 'You have already submitted this assessment' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('assessment_submissions')
      .insert({
        assessment_id: req.params.id,
        assessment_set_id: parsed.data.assessment_set_id,
        student_id: req.user!.id,
        student_answers: parsed.data.student_answers,
        latency_ms: parsed.data.latency_ms,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Submission failed', message: error.message });
      return;
    }

    res.status(201).json({ data, message: 'Assessment submitted successfully' });
  }
);

export default router;
