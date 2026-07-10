import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateEmbedding, generateJson, generateContent, GeminiUnavailableError } from '../lib/gemini';
import {
  FreeRecallSchema,
  CognitiveReviewSchema,
  FeynmanEvaluationSchema,
  type FeynmanAudience,
  type FeynmanConceptResult,
  type FeynmanFeedback,
  type FeynmanVerdict,
} from '../types/api';

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
 * GET /api/cognitive/history/:spaceId?mode=free_recall|feynman
 *
 * Returns the last 20 cognitive log sessions for a given study space.
 * Ordered by most recent first. Defaults to `free_recall` when `mode` is
 * omitted, preserving the original behaviour for existing callers.
 */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const { spaceId } = req.params;

  const rawMode = req.query.mode;
  const mode = typeof rawMode === 'string' ? rawMode : 'free_recall';
  if (mode !== 'free_recall' && mode !== 'feynman') {
    res.status(400).json({ error: "Invalid mode. Expected 'free_recall' or 'feynman'." });
    return;
  }

  const { data: logs, error } = await supabaseAdmin
    .from('cognitive_logs')
    .select('id, mode, user_input, similarity_score, ai_feedback, created_at')
    .eq('space_id', spaceId)
    .eq('mode', mode)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch history', message: error.message });
    return;
  }

  res.json({ data: logs ?? [] });
});

// ─── Feynman: audience rubrics ────────────────────────────────────────────
// The audience swaps the grading rubric, never the output schema.
const AUDIENCE_RUBRICS: Record<FeynmanAudience, string> = {
  '10yr_old': `The student is explaining to a 10-YEAR-OLD CHILD.

Simplicity rubric (be strict):
- Every technical or academic term used without being unpacked in plain words is JARGON. Flag it.
- Reward concrete, everyday analogies (dominoes, mailboxes, cargo ships, water in pipes).
- Reward short sentences and cause-and-effect storytelling.
- A textbook-accurate explanation that a child could not follow scores LOW on simplicity, no matter how correct it is.
- Always supply an "analogy_idea" a child would grasp, unless the student's own analogy is already excellent.`,

  self: `The student is explaining to THEMSELVES, to test whether they truly understand it.

Simplicity rubric (different goal — do NOT penalise vocabulary):
- Technical terms are ALLOWED and expected here. Only flag a term as jargon if the student leans on it as a substitute for explaining the underlying mechanism (i.e. name-dropping without saying what actually happens).
- Score simplicity on MECHANISTIC CLARITY: did they explain *why* and *how* it works, step by step, or did they recite memorised terminology?
- Reward causal chains ("this happens, which causes that, which results in..."). Penalise circular definitions and restated textbook phrasing.
- For "analogy_idea", suggest a deeper probing question or a level of mechanism they should push into to prove they understand it.`,
};

/** Clamp an untrusted model-produced number into a 0–100 integer. */
function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Verdict is derived from accuracy, never taken from the model.
 *
 * When asked for a verdict directly, the model leaks the simplicity axis into
 * it — a jargon-heavy but flawless explanation came back `needs_improvement`
 * on an accuracy of 100. Deriving it guarantees the badge always agrees with
 * the accuracy score the student is looking at.
 *
 * Bands mirror the accuracy scale described in the prompt.
 */
function deriveVerdict(accuracyScore: number): FeynmanVerdict {
  if (accuracyScore >= 80) return 'correct';
  if (accuracyScore >= 30) return 'needs_improvement';
  return 'incorrect';
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Strips the concept's own name from its jargon list. The student was asked to
 * explain that term, so naming it cannot be jargon — but the model flags it
 * anyway when the explanation is circular. The prompt forbids this; this is the
 * belt-and-braces enforcement.
 *
 * Also drops the parenthetical acronym: "Cross-Site Request Forgery (CSRF)"
 * yields both "cross-site request forgery" and "csrf" as forbidden entries.
 */
function stripSelfReferentialJargon(jargon: string[], term: string): string[] {
  const forbidden = new Set<string>();
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  forbidden.add(normalise(term));
  // "Physical Layer (OSI Model)" → also forbid "physical layer"
  forbidden.add(normalise(term.replace(/\s*\([^)]*\)\s*/g, '')));
  // Capture the parenthetical itself, e.g. "(CSRF)" → "csrf"
  for (const match of term.matchAll(/\(([^)]*)\)/g)) {
    forbidden.add(normalise(match[1]));
  }

  return jargon.filter(j => !forbidden.has(normalise(j)));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * POST /api/cognitive/feynman
 *
 * Grades a Feynman Technique submission on TWO independent axes:
 *   - accuracy_score   (0–100) — against the concept's stored `definition`
 *   - simplicity_score (0–100) — against the selected audience rubric
 *
 * These are deliberately separate: an explanation can be beautifully simple
 * and factually wrong, and it must not score highly for that.
 *
 * Unlike free-recall, this endpoint does NOT use embeddings. Cosine similarity
 * cannot see jargon or misconceptions — a student who parrots the textbook
 * verbatim would score ~0.95 while completely failing the Feynman exercise.
 * Instead we ground `gemini-2.5-flash` on the stored definitions as truth.
 *
 * Body: { space_id, material_ids[], audience, explanations: [{ concept_id, explanation }] }
 */
router.post('/feynman', async (req: Request, res: Response): Promise<void> => {
  const parsed = FeynmanEvaluationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, audience, explanations } = parsed.data;

  try {
    // ── 1. Reject duplicate concept submissions up front ──────────────────
    const conceptIds = explanations.map(e => e.concept_id);
    const uniqueConceptIds = [...new Set(conceptIds)];
    if (uniqueConceptIds.length !== conceptIds.length) {
      res.status(400).json({ error: 'Each concept may only be explained once per submission.' });
      return;
    }

    // ── 2. Look up the authoritative term + definition for each concept ───
    // Scoped to material_ids so a client cannot grade against a concept from
    // a material it did not select.
    const { data: concepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition')
      .in('id', uniqueConceptIds)
      .in('material_id', material_ids);

    if (conceptsError) {
      res.status(500).json({ error: 'Failed to fetch concepts', message: conceptsError.message });
      return;
    }

    if (!concepts || concepts.length !== uniqueConceptIds.length) {
      res.status(400).json({
        error: 'One or more selected concepts do not exist in the selected materials.',
      });
      return;
    }

    const conceptById = new Map(concepts.map(c => [c.id, c]));

    // ── 3. Build a single grounded prompt covering every concept ──────────
    const submissionBlock = explanations
      .map((e, i) => {
        const concept = conceptById.get(e.concept_id)!;
        return `--- Concept ${i + 1} ---
concept_id: ${concept.id}
Term: ${concept.term}
True Definition (ground truth): ${concept.definition}
Student's Explanation: """${e.explanation}"""`;
      })
      .join('\n\n');

    const prompt = `You are an expert academic tutor grading a student's Feynman Technique explanations.

${AUDIENCE_RUBRICS[audience]}

Grade EACH concept below on two INDEPENDENT axes:

1. "accuracy_score" (0-100): Is what the student ASSERTED true, judged ONLY against the True Definition? Ignore how simple or complex the wording is.

   Use these bands. They are not suggestions — pick the band that matches, then fine-tune within it:
   - 0-20  — The explanation ASSERTS something FALSE. It describes a different concept, reverses cause and effect, or contradicts the True Definition. Reserve this band for statements that are WRONG.
   - 30-50 — Everything asserted is TRUE, but the explanation is hollow: it restates the term, defines it circularly, or names it without explaining any mechanism. Nothing to correct, but nothing of substance said.
   - 55-75 — Everything asserted is TRUE and some real mechanism is given, but an essential step or condition from the True Definition is missing.
   - 80-100 — Accurate AND covers the essential mechanism from the True Definition.

   CRITICAL: An explanation that says too little is NOT the same as an explanation that says something wrong. Never score below 30 unless you can quote the specific false statement the student made. Vagueness, circularity, and omission are capped at 50 — they are not zeros.

2. "simplicity_score" (0-100): How well does it suit the target audience, per the rubric above? Ignore factual correctness here. A hollow, circular explanation should score LOW here — this axis, not accuracy, is where emptiness is punished.

An explanation can score high on one axis and low on the other. Do not let one score drag the other. In particular: a true-but-empty answer scores mid on accuracy and low on simplicity, while a fluent-but-false answer scores low on accuracy and high on simplicity.

Also produce for each concept:
- "jargon_found": array of terms from the student's own text that violate the simplicity rubric. Use the student's exact wording. NEVER include the concept's own Term (or its acronym) — the student was asked to explain it, so naming it is not jargon. Empty array if none.
- "feedback": 2-4 encouraging sentences. Say what they got right, name any factual error explicitly, then say how to improve.
- "analogy_idea": one concrete suggestion per the rubric. Empty string only if their explanation genuinely needs no improvement.

${submissionBlock}

Return ONLY a JSON object of this exact shape:
{
  "overall_feedback": "2-3 sentences summarising the submission as a whole.",
  "concepts": [
    {
      "concept_id": "<echo the concept_id exactly as given>",
      "accuracy_score": 0,
      "simplicity_score": 0,
      "jargon_found": ["..."],
      "feedback": "...",
      "analogy_idea": "..."
    }
  ]
}
The "concepts" array must contain exactly ${explanations.length} object(s), one per concept above, in the same order.`;

    interface RawFeynmanResponse {
      overall_feedback?: unknown;
      concepts?: unknown;
    }

    // temperature: 0 makes grading reproducible — resubmitting the same
    // explanation must not yield a different score. Without it, sampling
    // variance can drift a score across a verdict band boundary (an 80-vs-70
    // swing flips the badge between "Correct" and "Needs Improvement").
    const raw = await generateJson<RawFeynmanResponse>(prompt, { temperature: 0 });
    const rawConcepts = Array.isArray(raw?.concepts) ? (raw.concepts as Record<string, unknown>[]) : [];

    // ── 4. Coerce the model output — never trust it to hold its schema ────
    // Match on the echoed concept_id, falling back to positional order.
    const results: FeynmanConceptResult[] = explanations.map((e, i) => {
      const concept = conceptById.get(e.concept_id)!;
      const match =
        rawConcepts.find(rc => rc?.concept_id === e.concept_id) ?? rawConcepts[i] ?? {};

      const accuracyScore = clampScore(match.accuracy_score);
      return {
        concept_id: concept.id,
        term: concept.term,
        accuracy_score: accuracyScore,
        simplicity_score: clampScore(match.simplicity_score),
        verdict: deriveVerdict(accuracyScore),
        jargon_found: stripSelfReferentialJargon(coerceStringArray(match.jargon_found), concept.term),
        feedback: typeof match.feedback === 'string' ? match.feedback : '',
        analogy_idea: typeof match.analogy_idea === 'string' ? match.analogy_idea : '',
      };
    });

    const accuracyScore = mean(results.map(r => r.accuracy_score));
    const simplicityScore = mean(results.map(r => r.simplicity_score));

    const feedbackPayload: FeynmanFeedback = {
      audience,
      accuracy_score: accuracyScore,
      simplicity_score: simplicityScore,
      overall_feedback: typeof raw?.overall_feedback === 'string' ? raw.overall_feedback : '',
      jargon_found: [...new Set(results.flatMap(r => r.jargon_found))],
      concepts: results,
    };

    // ── 5. Persist one log row per submission ─────────────────────────────
    // `concept_id` is null because a submission spans several concepts; the
    // per-concept breakdown lives inside the ai_feedback JSON.
    // `similarity_score` stores mean accuracy as a 0–1 numeric, matching the
    // convention free-recall already uses for this column.
    const userInput = explanations
      .map(e => `Concept: ${conceptById.get(e.concept_id)!.term}\nExplanation: ${e.explanation}`)
      .join('\n\n');

    const { data: log, error: logError } = await supabaseAdmin
      .from('cognitive_logs')
      .insert({
        space_id,
        concept_id: null,
        mode: 'feynman',
        user_input: userInput,
        similarity_score: accuracyScore / 100,
        ai_feedback: JSON.stringify(feedbackPayload),
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
        created_at: log.created_at,
        ...feedbackPayload,
      },
      message: 'Feynman explanation evaluated successfully',
    });

  } catch (err: any) {
    console.error('[Feynman] Error:', err);
    if (err instanceof GeminiUnavailableError) {
      // Surface the upstream overload as a 503 so the client can offer a retry,
      // rather than dumping Google's raw error JSON into the student's face.
      res.status(503).json({ error: 'AI service unavailable', message: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to evaluate Feynman submission', message: err.message });
  }
});

/**
 * POST /api/cognitive/recall  (LEGACY — superseded by POST /api/cognitive/feynman)
 *
 * Scores a single concept via cosine similarity and writes prose (not JSON) to
 * `ai_feedback`. The Feynman tab no longer calls this. Retained only so any
 * older client keeps working; prefer /feynman for new work.
 *
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
