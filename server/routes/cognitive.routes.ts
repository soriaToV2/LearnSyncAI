import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding, generateJson, generateContent } from '../lib/gemini';
import { FreeRecallSchema, CognitiveReviewSchema } from '../types/api';

const router = Router();
router.use(authenticate, requireRole('student'));

// ─── Helper: Cosine similarity between two equal-length vectors ───────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

/**
 * Supabase returns pgvector columns as a JSON string like "[0.1, 0.2, ...]" or
 * a PostgreSQL vector string like "[-0.013,0.024,...]".
 * This helper normalises either format into a proper number[].
 */
function parseVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as number[];
    } catch {
      // Fallback: strip brackets and split
      const stripped = raw.replace(/^\[|\]$/g, '');
      return stripped.split(',').map(Number);
    }
  }
  return [];
}


/**
 * POST /api/cognitive/free-recall
 *
 * Evaluates a Free Recall submission using the Concept-Extraction Pipeline.
 *
 * Flow:
 * 1. Fetch ALL concepts (with embeddings) for the selected material_ids from DB.
 * 2. Send student's raw text to Gemini to extract discrete concepts they discussed.
 * 3. Embed each extracted student concept individually (gemini-embedding-001).
 * 4. For each true DB concept, compute its highest cosine similarity against the student's concept vectors.
 * 5. Grade: "Missed" if highest match < 0.70, "Covered" otherwise.
 * 6. Compute overall similarity score (avg of all best-match scores).
 * 7. Save the result to cognitive_logs.
 * 8. Return { similarity_score, missed_concepts[], overall_verdict }.
 *
 * Body: { space_id, material_ids[], user_input }
 */
router.post('/free-recall', async (req: Request, res: Response): Promise<void> => {
  const parsed = FreeRecallSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, user_input } = parsed.data;

  try {
    // ── 1. Fetch all reference concepts for the selected materials ────────
    const { data: allConcepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition, embedding')
      .in('material_id', material_ids);

    if (conceptsError) {
      res.status(500).json({ error: 'Failed to fetch concepts', message: conceptsError.message });
      return;
    }

    if (!allConcepts || allConcepts.length === 0) {
      res.status(400).json({ error: 'No processed concepts found for the selected materials. Ensure documents have finished parsing.' });
      return;
    }

    // Filter to only concepts that have embeddings
    const conceptsWithEmbeddings = allConcepts.filter(c => {
      const vec = parseVector(c.embedding);
      return vec.length > 0;
    });

    if (conceptsWithEmbeddings.length === 0) {
      res.status(400).json({ error: 'Concept embeddings are not ready yet. Please wait for material processing to complete.' });
      return;
    }

    // ── 2. Extract discrete concepts from the student's text via Gemini ───
    interface ExtractedConcept { term: string; explanation: string }

    const extractionPrompt = `
You are an expert academic assistant. Extract the distinct concepts and/or definitions that the student has discussed in their response.

Student Response:
"""
${user_input}
"""

Return a JSON array of objects. Each object must have:
- "term": the concept or topic name (e.g. "Action Potential", "Calcium Influx")
- "explanation": the student's brief explanation or description of that concept

If the student mentioned no distinct concepts, return an empty array [].

Example output:
[
  { "term": "Mitochondria", "explanation": "The student described it as the powerhouse of the cell that generates ATP." },
  { "term": "Cellular Respiration", "explanation": "The student explained this is how cells convert glucose into energy." }
]
`;

    const extractedConcepts = await generateJson<ExtractedConcept[]>(extractionPrompt);

    // ── 3. Handle edge case: student wrote nothing recognizable ───────────
    if (!Array.isArray(extractedConcepts) || extractedConcepts.length === 0) {
      // Score is 0 — all concepts are missed
      const missedConcepts = conceptsWithEmbeddings.map(c => c.term);
      const { data: log } = await supabaseAdmin.from('cognitive_logs').insert({
        space_id,
        concept_id: null,
        mode: 'free_recall',
        user_input,
        similarity_score: 0,
        ai_feedback: JSON.stringify({ missed_concepts: missedConcepts, overall_verdict: 'needs_review' }),
      }).select().single();

      res.status(201).json({
        data: {
          log_id: log?.id,
          similarity_score: 0,
          score_percent: 0,
          missed_concepts: missedConcepts,
          overall_verdict: 'needs_review',
        },
      });
      return;
    }

    // ── 4. Embed each student-extracted concept individually ──────────────
    const studentEmbeddings: { term: string; embedding: number[] }[] = [];
    for (const ec of extractedConcepts) {
      const textToEmbed = `${ec.term}: ${ec.explanation}`;
      const rawEmbedding = await generateEmbedding(textToEmbed);
      // generateEmbedding already returns number[] but normalise just in case
      const embedding = parseVector(rawEmbedding);
      studentEmbeddings.push({ term: ec.term, embedding });
    }

    // ── 5. Grade each reference concept by its best match ─────────────────
    const COVERAGE_THRESHOLD = 0.70;
    const missedConcepts: string[] = [];
    let coveredCount = 0;

    for (const refConcept of conceptsWithEmbeddings) {
      const refEmbedding = parseVector(refConcept.embedding);
      if (refEmbedding.length === 0) continue;

      // Find highest similarity score against any of the student's concept vectors
      let bestScore = 0;
      for (const sc of studentEmbeddings) {
        const sim = cosineSimilarity(refEmbedding, sc.embedding);
        if (sim > bestScore) bestScore = sim;
      }

      if (bestScore >= COVERAGE_THRESHOLD) {
        coveredCount++;
      } else {
        missedConcepts.push(refConcept.term);
      }
    }

    // ── 6. Compute score as coverage ratio ────────────────────────────────
    // Score = covered / total. This avoids the "hubness" problem where random
    // vector overlap inflates scores for concepts the student never discussed.
    const totalConcepts = conceptsWithEmbeddings.length;
    const similarityScore = totalConcepts > 0 ? coveredCount / totalConcepts : 0;
    const scorePercent = Math.round(similarityScore * 100);

    const overallVerdict: 'strong' | 'partial' | 'needs_review' =
      similarityScore >= 0.75 ? 'strong' :
      similarityScore >= 0.40 ? 'partial' :
      'needs_review';

    // ── 7. Save to cognitive_logs ─────────────────────────────────────────
    const feedbackPayload = JSON.stringify({ missed_concepts: missedConcepts, overall_verdict: overallVerdict });

    const { data: log, error: logError } = await supabaseAdmin
      .from('cognitive_logs')
      .insert({
        space_id,
        concept_id: null,
        mode: 'free_recall',
        user_input,
        similarity_score: similarityScore,
        ai_feedback: feedbackPayload,
      })
      .select()
      .single();

    if (logError) {
      res.status(500).json({ error: 'Failed to save cognitive log', message: logError.message });
      return;
    }

    // ── 8. Return results to the frontend ────────────────────────────────
    res.status(201).json({
      data: {
        log_id: log.id,
        similarity_score: similarityScore,
        score_percent: scorePercent,
        missed_concepts: missedConcepts,
        overall_verdict: overallVerdict,
        created_at: log.created_at,
      },
      message: 'Free recall scored successfully',
    });

  } catch (err: any) {
    console.error('[FreeRecall] Error:', err);
    res.status(500).json({ error: 'Failed to process free recall submission', message: err.message });
  }
});

/**
 * GET /api/cognitive/history/:spaceId
 *
 * Returns the last 20 cognitive log sessions for a given study space.
 * Ordered by most recent first.
 */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const { spaceId } = req.params;

  const { data: logs, error } = await supabaseAdmin
    .from('cognitive_logs')
    .select('id, mode, user_input, similarity_score, ai_feedback, created_at')
    .eq('space_id', spaceId)
    .eq('mode', 'free_recall')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch history', message: error.message });
    return;
  }

  res.json({ data: logs ?? [] });
});

/**
 * POST /api/cognitive/recall  (LEGACY — kept for Feynman Technique)
 *
 * Scores a Feynman Technique submission against a single concept.
 * Body: { concept_id, space_id, mode: 'feynman', user_input }
 */
router.post('/recall', async (req: Request, res: Response): Promise<void> => {
  const parsed = CognitiveReviewSchema.safeParse(req.body);
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
  const refEmbedding = parseVector(concept.embedding);
  const studentEmbedding = parseVector(userEmbedding);
  const similarityScore = cosineSimilarity(refEmbedding, studentEmbedding);
  const scorePercent = Math.round(Math.max(0, Math.min(1, similarityScore)) * 100);

  // 3. Generate coaching feedback with Gemini
  const feedbackPrompt = `
You are a supportive academic tutor giving feedback on a student's Feynman Technique explanation.

Concept: "${concept.term}"
True Definition: "${concept.definition}"

Student's Explanation:
"${user_input}"

Similarity Score: ${scorePercent}%

Give concise, encouraging feedback (2–4 sentences) that:
1. Acknowledges what the student got right
2. Clarifies any gaps or misconceptions
3. Reinforces the core concept

Keep it friendly and academic.
`;

  const aiFeedback = await generateContent(feedbackPrompt);

  // 4. Save to cognitive_logs
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
