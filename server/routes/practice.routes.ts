import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateJson } from '../lib/gemini';
import { CreatePracticeTestSchema, SubmitAnswerSchema } from '../types/api';
import axios from 'axios';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * POST /api/practice
 * Generates a new adaptive practice test using BKT mastery scores.
 *
 * Flow:
 * 1. Fetch student's current BKT mastery for concepts in selected materials
 * 2. Build a mastery-aware prompt for Gemini
 * 3. Generate questions (harder for high mastery, easier for low mastery)
 * 4. Save as a new practice_tests record
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePracticeTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, title, source_material_ids } = parsed.data;
  const studentId = req.user!.id;

  // 1. Fetch concepts from selected materials
  const { data: concepts, error: conceptsError } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition')
    .in('material_id', source_material_ids);

  if (conceptsError || !concepts?.length) {
    res.status(400).json({ error: 'No concepts found in selected materials' });
    return;
  }

  const conceptIds = concepts.map((c) => c.id);

  // 2. Fetch existing BKT mastery scores for those concepts
  const { data: masteryScores } = await supabaseAdmin
    .from('bkt_mastery')
    .select('concept_id, latent_mastery')
    .eq('student_id', studentId)
    .in('concept_id', conceptIds);

  const masteryMap = new Map(
    (masteryScores ?? []).map((m) => [m.concept_id, m.latent_mastery ?? 0])
  );

  // 3. Build mastery-aware concept list for the prompt
  const conceptsWithMastery = concepts.map((c) => ({
    ...c,
    mastery: masteryMap.get(c.id) ?? 0, // Default: 0 (no mastery data yet)
  }));

  const conceptList = conceptsWithMastery
    .map((c) => `- "${c.term}" (mastery: ${Math.round((c.mastery ?? 0) * 100)}%): ${c.definition}`)
    .join('\n');

  const prompt = `
You are an adaptive learning engine. Generate a personalized practice test for a student.

Practice Test Title: "${title}"

Concepts and their current mastery levels:
${conceptList}

Adaptive Rules:
- Mastery < 30%: Generate EASY questions (definitions, basic recall)
- Mastery 30–70%: Generate MEDIUM questions (application, examples)
- Mastery > 70%: Generate HARD questions (analysis, edge cases, synthesis)

Generate 10 questions total, distributed across all concepts proportionally.

Return a JSON object with this exact shape:
{
  "questions": [
    {
      "id": number,
      "concept_id": "uuid-string",
      "concept": "string",
      "type": "multiple_choice" | "true_false" | "short_answer",
      "difficulty": "easy" | "medium" | "hard",
      "question": "string",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] | null,
      "answer": "string",
      "explanation": "string"
    }
  ]
}

IMPORTANT: Use the actual concept_id UUIDs provided above for each question's concept_id field.
`;

  const questionsPayload = await generateJson<{ questions: unknown[] }>(prompt);

  // 4. Save as a new practice test
  const { data: practiceTest, error: insertError } = await supabaseAdmin
    .from('practice_tests')
    .insert({
      space_id,
      student_id: studentId,
      title,
      source_material_ids,
      questions_payload: questionsPayload,
      status: 'in_progress',
    })
    .select()
    .single();

  if (insertError) {
    res.status(500).json({ error: 'Failed to create practice test', message: insertError.message });
    return;
  }

  // 5. Initialize BKT mastery rows for any new concepts (upsert)
  const newMasteryRows = conceptIds.map((concept_id) => ({
    student_id: studentId,
    concept_id,
    latent_mastery: masteryMap.get(concept_id) ?? 0.0,
  }));

  await supabaseAdmin
    .from('bkt_mastery')
    .upsert(newMasteryRows, { onConflict: 'student_id,concept_id' });

  res.status(201).json({ data: practiceTest, message: 'Adaptive practice test generated' });
});

/**
 * PUT /api/practice/:id/answer
 * Records a single answer + telemetry as the student works through the test.
 * This updates the student_answers JSONB and logs to practice_telemetry.
 */
router.put('/:id/answer', async (req: Request, res: Response): Promise<void> => {
  const parsed = SubmitAnswerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { question_index, answer, concept_id, is_correct, latency_ms } = parsed.data;

  // 1. Log telemetry
  await supabaseAdmin.from('practice_telemetry').insert({
    student_id: req.user!.id,
    concept_id,
    practice_test_id: req.params.id,
    is_correct,
    latency_ms,
  });

  // 2. Update student_answers (merge into existing JSONB)
  const { data: test } = await supabaseAdmin
    .from('practice_tests')
    .select('student_answers')
    .eq('id', req.params.id)
    .single();

  const currentAnswers = (test?.student_answers as Record<string, unknown>) ?? {};
  currentAnswers[question_index] = { answer, is_correct, latency_ms };

  await supabaseAdmin
    .from('practice_tests')
    .update({ student_answers: currentAnswers })
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id);

  res.json({ message: 'Answer recorded' });
});

/**
 * PUT /api/practice/:id/complete
 * Marks a practice test as completed and triggers BKT recalculation.
 */
router.put('/:id/complete', async (req: Request, res: Response): Promise<void> => {
  const { data: test, error: fetchError } = await supabaseAdmin
    .from('practice_tests')
    .select('student_answers, questions_payload')
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id)
    .single();

  if (fetchError || !test) {
    res.status(404).json({ error: 'Practice test not found' });
    return;
  }

  // Calculate score
  const answers = (test.student_answers as Record<string, { is_correct: boolean }>) ?? {};
  const totalAnswered = Object.keys(answers).length;
  const correct = Object.values(answers).filter((a) => a.is_correct).length;
  const score = totalAnswered > 0 ? correct / totalAnswered : 0;

  await supabaseAdmin
    .from('practice_tests')
    .update({ status: 'completed', score, completed_at: new Date().toISOString() })
    .eq('id', req.params.id);

  // Trigger BKT recalculation (non-blocking)
  const bktServiceUrl = process.env.BKT_SERVICE_URL ?? 'http://localhost:8000';
  axios
    .post(`${bktServiceUrl}/recalculate`, {
      student_id: req.user!.id,
      practice_test_id: req.params.id,
    })
    .catch((err) => console.warn('[BKT] Recalculation service unavailable:', err.message));

  res.json({
    data: { score, correct, total: totalAnswered },
    message: 'Practice test completed. BKT mastery update queued.',
  });
});

export default router;
