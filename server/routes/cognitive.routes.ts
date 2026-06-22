import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding, generateContent } from '../lib/gemini';
import { FreeRecallSchema } from '../types/api';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * POST /api/cognitive/recall
 *
 * Scores a Free Recall or Feynman Technique submission.
 *
 * Flow:
 * 1. Embed the student's user_input using Gemini text-embedding-004
 * 2. Run a pgvector cosine similarity query against the concept's stored embedding
 * 3. Generate AI coaching feedback using Gemini Flash
 * 4. Save the log to cognitive_logs
 * 5. Return the score and feedback to the UI
 *
 * Body: { concept_id, space_id, mode: 'free_recall'|'feynman', user_input }
 */
router.post('/recall', async (req: Request, res: Response): Promise<void> => {
  const parsed = FreeRecallSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { concept_id, space_id, mode, user_input } = parsed.data;

  // 1. Fetch the target concept (with its stored embedding)
  const { data: concept, error: conceptError } = await supabaseAdmin
    .from('concepts')
    .select('term, definition, embedding')
    .eq('id', concept_id)
    .single();

  if (conceptError || !concept) {
    res.status(404).json({ error: 'Concept not found' });
    return;
  }

  if (!concept.embedding) {
    res.status(400).json({ error: 'This concept does not have an embedding yet. Wait for material processing to complete.' });
    return;
  }

  // 2. Embed the student's input
  const userEmbedding = await generateEmbedding(user_input);
  const embeddingStr = `[${userEmbedding.join(',')}]`;

  // 3. Cosine similarity via pgvector — lower value = higher similarity (cosine distance)
  const { data: similarityResult, error: simError } = await supabaseAdmin
    .rpc('match_concept_similarity', {
      concept_embedding: concept.embedding,
      query_embedding: embeddingStr,
    });

  // Fallback: manual dot-product similarity if the RPC isn't available yet
  let similarityScore: number;
  if (simError || !similarityResult) {
    // Simple cosine similarity in JS as a fallback
    const a = concept.embedding as number[];
    const b = userEmbedding;
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    similarityScore = magA && magB ? dot / (magA * magB) : 0;
  } else {
    similarityScore = similarityResult as number;
  }

  const scorePercent = Math.round(Math.max(0, Math.min(1, similarityScore)) * 100);

  // 4. Generate coaching feedback with Gemini
  const feedbackPrompt = `
You are a supportive academic tutor giving feedback on a student's explanation.

Concept: "${concept.term}"
True Definition: "${concept.definition}"

Student's Explanation (${mode === 'feynman' ? 'Feynman Technique' : 'Free Recall'}):
"${user_input}"

Similarity Score: ${scorePercent}%

Give concise, encouraging feedback (2–4 sentences) that:
1. Acknowledges what the student got right
2. Clarifies any gaps or misconceptions
3. Reinforces the core concept

Keep it friendly and academic.
`;

  const aiFeedback = await generateContent(feedbackPrompt);

  // 5. Save to cognitive_logs
  const { data: log, error: logError } = await supabaseAdmin
    .from('cognitive_logs')
    .insert({
      space_id,
      concept_id,
      mode,
      user_input,
      similarity_score: similarityScore,
      ai_feedback: aiFeedback,
    })
    .select()
    .single();

  if (logError) {
    res.status(500).json({ error: 'Failed to save cognitive log', message: logError.message });
    return;
  }

  // 6. Return results to the UI
  res.status(201).json({
    data: {
      log_id: log.id,
      similarity_score: similarityScore,
      score_percent: scorePercent,
      ai_feedback: aiFeedback,
      concept: { term: concept.term, definition: concept.definition },
    },
    message: 'Recall scored successfully',
  });
});

export default router;
