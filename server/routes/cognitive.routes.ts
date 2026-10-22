import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  generateEmbedding,
  generateJson,
  studentFacingError,
  GeminiUnavailableError,
  GEMINI_GRADING_MODEL,
  GEMINI_UTILITY_MODEL,
} from '../lib/gemini';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
// Shared with extraction so "SSDLC" resolves to the concept extraction folded it into.
import { foldKey, acronymOf } from '../lib/conceptExtraction';
import {
  FreeRecallSchema,
  FeynmanEvaluationSchema,
  type FeynmanAudience,
  type FeynmanConceptResult,
  type FeynmanFeedback,
  type FeynmanVerdict,
  type FreeRecallFeedback,
  type FreeRecallWrittenFeedback,
} from '../types/api';
import { logActivity } from '../lib/activity';

const router = Router();
router.use(authenticate, requireRole('student'));

/** Ownership check (RLS is bypassed). 404, never 403. Returns the student id, or null after responding. */
async function requireOwnedSpace(
  spaceId: string,
  req: Request,
  res: Response
): Promise<string | null> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
    return null;
  }

  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('id')
    .eq('id', spaceId)
    .eq('student_id', userId)
    .maybeSingle();

  if (!space) {
    res.status(404).json({ error: 'Study space not found' });
    return null;
  }

  return userId;
}

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

/** Supabase returns pgvector columns as strings; normalise to number[]. */
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
 * Hash of the concept content a submission is graded against (concepts have no updated_at), so an
 * educator edit invalidates the memo. `extra` carries other grading inputs (Feynman's glossary).
 */
function fingerprintConcepts(
  concepts: Array<{ id: string; term: string; definition: string }>,
  extra: string[] = []
): string {
  const canonical = [...concepts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(c => [c.id, c.term, c.definition]);
  return createHash('sha256')
    .update(JSON.stringify([canonical, [...extra].sort()]))
    .digest('hex');
}

interface MemoisableFeedback {
  concepts_fingerprint?: string;
}

/**
 * A previous identical attempt's stored result, or null. This is the reproducibility guarantee
 * (Gemini 3 has no temperature): same student, mode, text, materials and concept fingerprint.
 * Don't remove it when swapping models.
 */
async function findMemoisedAttempt<T extends MemoisableFeedback>(params: {
  studentId: string;
  mode: 'free_recall' | 'feynman';
  userInput: string;
  materialIds: string[];
  fingerprint: string;
}): Promise<T | null> {
  const { studentId, mode, userInput, materialIds, fingerprint } = params;

  const { data: priors } = await supabaseAdmin
    .from('cognitive_logs')
    .select('material_ids, ai_feedback')
    .eq('student_id', studentId)
    .eq('mode', mode)
    .eq('user_input', userInput)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!priors?.length) return null;

  const wanted = [...materialIds].sort().join(',');

  for (const prior of priors) {
    const priorMaterials = [...((prior.material_ids as string[]) ?? [])].sort().join(',');
    if (priorMaterials !== wanted) continue;

    try {
      const parsed = JSON.parse((prior.ai_feedback as string) ?? '{}') as T;
      // Rows without a fingerprint are never reused.
      if (parsed.concepts_fingerprint === fingerprint) return parsed;
    } catch {
      // Unparseable: evaluate fresh.
    }
  }

  return null;
}

/** Concepts extracted from a student's answer. */
const STUDENT_CONCEPT_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      term: { type: Type.STRING },
      explanation: { type: Type.STRING },
    },
    required: ['term', 'explanation'],
    propertyOrdering: ['term', 'explanation'],
  },
};

/** Coaching prose. Structure only; emptiness is checked by the caller. */
const RECALL_FEEDBACK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    feedback: { type: Type.STRING },
    // Required so "nothing to flag" is an explicit ''.
    corrections: { type: Type.STRING },
  },
  required: ['feedback', 'corrections'],
  propertyOrdering: ['feedback', 'corrections'],
};

/** Embeds texts with bounded concurrency (avoids rate-limit bursts), preserving input order. */
const EMBED_CONCURRENCY = 8;

async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let next = 0;

  const worker = async () => {
    for (let i = next++; i < texts.length; i = next++) {
      out[i] = parseVector(await generateEmbedding(texts[i]));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, texts.length) }, worker)
  );
  return out;
}

/** Fixed prose (no model call) when extraction finds no points in the answer. */
const NO_MATCH_FEEDBACK: FreeRecallWrittenFeedback = {
  feedback:
    "Nothing you wrote matched the ideas in this lesson yet. That usually means the answer is about a different material, or it is still too short for us to match anything against — it does not mean what you wrote is wrong. Open the material again, read one section, then close it and write down every idea from that section you can remember in your own words.",
};

/**
 * Coaching prose for a Free Recall attempt. Returns null instead of throwing, so a failure never
 * costs the student their score. May only name gaps from `missedTerms`.
 */
async function generateRecallFeedback(params: {
  userInput: string;
  studentPoints: string[];
  coveredTerms: string[];
  /** The only gaps the prose may name. */
  missedTerms: string[];
  /** Missed terms with their pages, e.g. "Injection (p. 24, 25)". */
  missedWithPages: string[];
  /** Every concept with its page, so a page can be cited even at full coverage. */
  conceptPages: string[];
  /** Each student point paired with the lesson text that could settle it; the only ground truth. */
  nearestLessonText: string[];
  scorePercent: number;
}): Promise<FreeRecallWrittenFeedback | null> {
  const { userInput, studentPoints, coveredTerms, missedTerms, missedWithPages, conceptPages, nearestLessonText, scorePercent } = params;

  const prompt = `You are a supportive tutor giving feedback on a student's free recall attempt.
They wrote down everything they could remember from a lesson, without notes.

THE STUDENT'S ANSWER:
"""
${userInput}
"""

POINTS THEY RAISED (extracted from their answer):
${studentPoints.length ? studentPoints.map(p => `- ${p}`).join('\n') : '(none identified)'}

LESSON CONCEPTS THEY COVERED (${coveredTerms.length}):
${coveredTerms.length ? coveredTerms.join(', ') : '(none)'}
${coveredTerms.length === 0 ? `
!! NOTHING THEY WROTE BELONGS TO THIS MATERIAL. Read that literally: not one of their points
   matched this lesson. Whatever they remembered is from somewhere else — very likely a different
   material in the same subject, which will LOOK correct to you.
   Lead the summary with that fact, in plain words, and be clear their answer is not WRONG, just
   not this lesson. Do NOT describe any part of it as good recall, and do not praise it.
` : ''}

LESSON CONCEPTS THEY DID NOT COVER (${missedTerms.length}), with the page each is taught on:
${missedWithPages.length ? missedWithPages.join('\n') : '(none — they covered everything)'}

Coverage score: ${scorePercent}%

WHERE EVERY CONCEPT IS TAUGHT — the only page numbers you may cite. Never state a page that is not in this list:
${conceptPages.length ? conceptPages.join('\n') : '(no page information available)'}

WHAT THE LESSON ITSELF SAYS, matched to each point they raised.
This is the ONLY source of truth you have. Judge nothing against your own knowledge of the subject:
${nearestLessonText.length ? nearestLessonText.join('\n') : '(no concepts to compare against)'}

Write ONE passage of feedback, plus corrections. Rules for both:
- Ground every sentence in what THIS student actually wrote. Refer to their specific points. Never write praise that would fit any answer ("good effort", "nice work").
- ADDRESS THE STUDENT DIRECTLY as "you" and "your". Write "You explained..." or "Your answer covered...", never "The student explained". You are speaking to them, not reporting on them to someone else.
- Speak to a Junior High School student. Plain language, warm, direct, no jargon about the scoring system itself. Never mention percentages, cosine similarity, or concept counts.
- No bullet points, no markdown.

"feedback" — FOUR TO FIVE sentences, written as one flowing passage:
- Cover both what landed and what did not, WOVEN TOGETHER. Do NOT write a praise half followed by a criticism half — that structure leaves you repeating yourself, and it reads like a form rather than a person.
- Describe what they REMEMBERED AND EXPLAINED. Do NOT certify a claim as factually correct here; you are describing ground covered, not marking answers. Anything conflicting with the lesson text goes in "corrections" and must not be praised here.
- THE COVERED LIST DECIDES WHAT COUNTED. Never describe a point as recalled, remembered or explained unless it appears in that list. Their answer shows what they WROTE; the covered list shows what belongs to THIS lesson, and only the second is recall. A student can write an excellent, accurate passage that earns nothing here because it is about a different material — a subject you may know well is not the same as the subject in front of you.
- The "did not cover" list is machine-generated from the whole document and includes minor supporting details nobody would recall from memory. Do NOT recite it. Choose only the 2-3 genuinely important ideas from it.
- Name a gap ONLY if it appears in that list. Never infer a further omission from the coverage score, from the length of their answer, or from a topic you expected and did not see. Anything you name is read by the student as a fact about their own answer, and telling them they forgot something they can see themselves having written destroys their trust in the whole exercise.
- IMPORTANT — if the student clearly NAMED something that still appears in the "did not cover" list, say so and say why: naming a concept in passing is not the same as recalling it, and only an explanation counts. For example, "you listed injection among the risks but did not say what it does, so it did not count." This is usually the single most useful sentence you can write, because that distinction is invisible from the score alone.
- If the "did not cover" list is empty, do not invent gaps. Write instead about depth: which of their own points they stated but did not explain.
- END WITH ONE CONCRETE THING TO DO, AND NAME THE PAGE IT IS ON. This closing sentence is required, not optional — "Injection is on page 24, read it and then write what it does in your own words" is worth more than any amount of encouragement, and it is the only part of this passage the student can act on today.
- Take that page ONLY from the "where every concept is taught" list. If the concept is not in that list, do not guess a page — give the action without one.
- If they covered everything and there are no gaps, still end with an action: send them to deepen a concept they explained only briefly, and name ITS page from the same list. A complete answer still has a next step.

"corrections" has its own rules, and silence is the correct answer far more often than not:
- Work through the points ONE AT A TIME against the lesson text matched to each, before you answer. Do not stop at the first contradiction you notice.
- Flag a statement ONLY when it CONTRADICTS the lesson text quoted above — a swapped name, a reversed cause and effect, a definition belonging to a different concept. Quote the student's own words, then say what the lesson says instead.
- A REVERSED MECHANISM is the easiest kind to read straight past, because the vocabulary matches the lesson perfectly and only the direction is wrong: the student says a thing happens at the end when the lesson says throughout, or that A causes B when the lesson says B causes A. Check the direction of every claim, not just its subject.
- Incomplete is NOT incorrect. Missing detail, vagueness, or a simplified explanation are not contradictions. Neither is wording that differs from the lesson while meaning the same thing. Those belong in "feedback" or nowhere.
- If the lesson text above does not settle it, say nothing. Never correct a student from your own knowledge of the subject — an educator may define a term more narrowly or simply than you would, and their definition is the one that counts.
- At most TWO corrections, the most important first. Return an EMPTY STRING when nothing contradicts, which will be the usual case.
- Telling a student they are wrong when they are right is far worse than missing an error. When in doubt, stay silent.

Return ONLY a JSON object of this exact shape:
{
  "feedback": "Spoken to the student as 'you': four to five sentences weaving together what you recalled and what did not land, naming your actual points, and CLOSING with one concrete thing to do and the page it is on.",
  "corrections": "Empty string if nothing contradicts the lesson. Otherwise, spoken to the student as 'you': quote what you wrote and say what the lesson says instead."
}`;

  try {
    // MEDIUM: at LOW the model missed planted errors in `corrections`. Utility model because the
    // output is prose, never a score. 6144 tokens since thinking shares the budget.
    const raw = await generateJson<Record<string, unknown>>(prompt, {
      model: GEMINI_UTILITY_MODEL,
      thinkingLevel: ThinkingLevel.MEDIUM,
      responseSchema: RECALL_FEEDBACK_SCHEMA,
      maxOutputTokens: 6144,
    });
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    const feedback: FreeRecallWrittenFeedback = {
      feedback: str(raw?.feedback),
      // '' is the normal answer.
      corrections: str(raw?.corrections),
    };

    // An empty passage counts as a failed generation.
    if (!feedback.feedback) return null;
    return feedback;
  } catch (err) {
    console.error('[FreeRecall] Written feedback unavailable:', err);
    return null;
  }
}

/**
 * POST /api/cognitive/free-recall. Extract the student's points → embed each → a lesson concept is
 * covered if its best match ≥ 0.70 → score = covered / total. See CLAUDE.md § Free Recall Scoring.
 */
router.post('/free-recall', async (req: Request, res: Response): Promise<void> => {
  const parsed = FreeRecallSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, user_input } = parsed.data;

  // 0. Ownership and access (the response lists concept terms).
  const studentId = await requireOwnedSpace(space_id, req, res);
  if (!studentId) return;
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  try {
    // 1. Reference concepts (source_pages lets feedback cite where to read).
    const { data: allConcepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition, embedding, source_pages')
      .in('material_id', material_ids);

    if (conceptsError) {
      res.status(500).json({ error: 'Failed to fetch concepts', message: conceptsError.message });
      return;
    }

    if (!allConcepts || allConcepts.length === 0) {
      res.status(400).json({ error: 'No processed concepts found for the selected materials. Ensure documents have finished parsing.' });
      return;
    }

    const conceptsWithEmbeddings = allConcepts.filter(c => {
      const vec = parseVector(c.embedding);
      return vec.length > 0;
    });

    if (conceptsWithEmbeddings.length === 0) {
      res.status(400).json({ error: 'Concept embeddings are not ready yet. Please wait for material processing to complete.' });
      return;
    }

    // 1b. Identical resubmission: answer from the stored result, before any AI call.
    const fingerprint = fingerprintConcepts(conceptsWithEmbeddings);
    const memoised = await findMemoisedAttempt<FreeRecallFeedback & MemoisableFeedback>({
      studentId,
      mode: 'free_recall',
      userInput: user_input,
      materialIds: material_ids,
      fingerprint,
    });

    if (memoised) {
      // Still a real attempt: write a row and log activity; only the model calls are skipped.
      const memoScore = memoised.total_concepts
        ? memoised.covered_count / memoised.total_concepts
        : 0;

      const { data: log, error: logError } = await supabaseAdmin
        .from('cognitive_logs')
        .insert({
          student_id: studentId,
          space_id,
          concept_id: null,
          material_ids,
          mode: 'free_recall',
          user_input,
          similarity_score: memoScore,
          ai_feedback: JSON.stringify(memoised),
        })
        .select()
        .single();

      if (logError) {
        res.status(500).json({ error: 'Failed to save cognitive log', message: logError.message });
        return;
      }

      await logActivity({
        studentId,
        type: 'free_recall',
        spaceId: space_id,
        materialId: material_ids?.[0] ?? null,
      });

      res.status(201).json({
        data: {
          log_id: log.id,
          similarity_score: memoScore,
          score_percent: Math.round(memoScore * 100),
          covered_count: memoised.covered_count,
          total_concepts: memoised.total_concepts,
          missed_concepts: memoised.missed_concepts,
          overall_verdict: memoised.overall_verdict,
          written_feedback: memoised.written_feedback,
          feedback_unavailable: memoised.written_feedback === null,
          created_at: log.created_at,
        },
        message: 'Free recall scored successfully',
      });
      return;
    }

    // 2. Extract the student's points.
    interface ExtractedConcept { term: string; explanation: string }

    // Must stay granular (one item per idea, lists split): a coarse point embeds as an average
    // and causes false misses. See CLAUDE.md § Free Recall Scoring.
    const extractionPrompt = `
You are an expert academic assistant. Break the student's response below into EVERY distinct idea it contains, so each one can be matched against the lesson's concept list.

Student Response:
"""
${user_input}
"""

Rules:
- Be GRANULAR. One item per distinct idea — not one per paragraph, and not one per topic.
- If the student lists several things — steps, phases, benefits, types, examples, layers — return EACH listed item as its OWN item, even when they wrote them all in a single sentence. A list of five benefits is five items, not one.
- Include anything the student named, including laws, agencies, acronyms and roles.
- "explanation" is what the student said about that idea, in their own terms. If they only named it without elaborating, say so plainly.
- Do NOT add ideas the student did not mention, and do not correct their mistakes — this is a record of what they wrote, not of what is true.

If the student mentioned no distinct ideas, return an empty array [].

Return a JSON array of objects. Each object must have:
- "term": the concept or topic name (e.g. "Action Potential", "Calcium Influx")
- "explanation": the student's brief explanation or description of that concept

Example output:
[
  { "term": "Mitochondria", "explanation": "The student described it as the powerhouse of the cell that generates ATP." },
  { "term": "Cellular Respiration", "explanation": "The student explained this is how cells convert glucose into energy." }
]
`;

    // Utility model: it only enumerates; the score is computed in code. LOW because MINIMAL
    // won't split lists; 8192 because granular output is long.
    const extractedConcepts = await generateJson<ExtractedConcept[]>(extractionPrompt, {
      model: GEMINI_UTILITY_MODEL,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: STUDENT_CONCEPT_SCHEMA,
      maxOutputTokens: 8192,
    });

    // 3. Nothing recognisable: score 0, everything missed.
    if (!Array.isArray(extractedConcepts) || extractedConcepts.length === 0) {
      const missedConcepts = conceptsWithEmbeddings.map(c => c.term);

      const emptyFeedback = NO_MATCH_FEEDBACK;

      const emptyPayload: FreeRecallFeedback & MemoisableFeedback = {
        concepts_fingerprint: fingerprint,
        missed_concepts: missedConcepts,
        overall_verdict: 'needs_review',
        written_feedback: emptyFeedback,
        covered_count: 0,
        total_concepts: conceptsWithEmbeddings.length,
      };

      const { data: log } = await supabaseAdmin.from('cognitive_logs').insert({
        student_id: studentId,
        space_id,
        concept_id: null,
        material_ids,
        mode: 'free_recall',
        user_input,
        similarity_score: 0,
        ai_feedback: JSON.stringify(emptyPayload),
      }).select().single();

      res.status(201).json({
        data: {
          log_id: log?.id,
          similarity_score: 0,
          score_percent: 0,
          covered_count: 0,
          total_concepts: conceptsWithEmbeddings.length,
          missed_concepts: missedConcepts,
          overall_verdict: 'needs_review',
          written_feedback: emptyFeedback,
          feedback_unavailable: false,
          created_at: log?.created_at,
        },
      });
      return;
    }

    // 4. Embed each point (in parallel).
    const vectors = await embedAll(
      extractedConcepts.map(ec => `${ec.term}: ${ec.explanation}`)
    );
    const studentEmbeddings = extractedConcepts.map((ec, i) => ({
      term: ec.term,
      embedding: vectors[i],
    }));

    // 5. Grade each reference concept by its best match.
    const COVERAGE_THRESHOLD = 0.70;
    const missedConcepts: string[] = [];
    const coveredConcepts: string[] = [];
    // Prompt only; stored missed_concepts stay plain terms.
    const missedWithPages: string[] = [];

    const pagesOf = (c: { source_pages?: unknown }) => {
      const pages = (c.source_pages as number[] | null) ?? [];
      return pages.length ? ` (p. ${pages.join(', ')})` : '';
    };
    const conceptPages = conceptsWithEmbeddings.map(c => `- ${c.term}${pagesOf(c)}`);

    // For `corrections` only: each student point's nearest lesson concepts. Ignores the threshold
    // (wrong claims score below it) and keeps two (wrong claims reorder neighbours). This is the
    // fallback; the term lookup below is primary.
    const TOP_NEAREST = 2;
    const nearestRef: { refIdx: number; score: number }[][] =
      studentEmbeddings.map(() => []);

    for (const [refIdx, refConcept] of conceptsWithEmbeddings.entries()) {
      const refEmbedding = parseVector(refConcept.embedding);
      if (refEmbedding.length === 0) continue;

      let bestScore = 0;
      for (const [scIdx, sc] of studentEmbeddings.entries()) {
        const sim = cosineSimilarity(refEmbedding, sc.embedding);
        if (sim > bestScore) bestScore = sim;

        const top = nearestRef[scIdx];
        if (top.length < TOP_NEAREST) {
          top.push({ refIdx, score: sim });
          top.sort((a, b) => b.score - a.score);
        } else if (sim > top[top.length - 1].score) {
          top[top.length - 1] = { refIdx, score: sim };
          top.sort((a, b) => b.score - a.score);
        }
      }

      if (bestScore >= COVERAGE_THRESHOLD) {
        coveredConcepts.push(refConcept.term);
      } else {
        missedConcepts.push(refConcept.term);
        missedWithPages.push(`- ${refConcept.term}${pagesOf(refConcept)}`);
      }
    }

    const coveredCount = coveredConcepts.length;

    // Primary pairing: resolve the term the student named straight to its concept, via the
    // extraction module's foldKey/acronymOf.
    const conceptIdxByAlias = new Map<string, number>();
    for (const [refIdx, c] of conceptsWithEmbeddings.entries()) {
      const term = c.term as string;
      for (const alias of [normaliseTerm(term), foldKey(term), acronymOf(term)]) {
        // First writer wins.
        if (alias && !conceptIdxByAlias.has(alias)) conceptIdxByAlias.set(alias, refIdx);
      }
    }

    // Pair each point with the named concept plus nearest neighbours, deduplicated by concept.
    const seenRef = new Set<number>();
    const nearestLessonText: string[] = [];

    for (const [scIdx, sc] of studentEmbeddings.entries()) {
      const named = conceptIdxByAlias.get(normaliseTerm(sc.term)) ?? conceptIdxByAlias.get(foldKey(sc.term));
      const candidates = [
        ...(named === undefined ? [] : [named]),
        ...nearestRef[scIdx].map(n => n.refIdx),
      ];

      const lines: string[] = [];
      for (const refIdx of candidates) {
        if (refIdx < 0 || seenRef.has(refIdx)) continue;
        seenRef.add(refIdx);
        const ref = conceptsWithEmbeddings[refIdx];
        lines.push(`    ${ref.term}: ${ref.definition}`);
      }
      if (lines.length) nearestLessonText.push(`- You wrote about "${sc.term}":\n${lines.join('\n')}`);
    }

    // 6. Coverage ratio, not a mean of raw cosines (which "hubness" inflates).
    const totalConcepts = conceptsWithEmbeddings.length;
    const similarityScore = totalConcepts > 0 ? coveredCount / totalConcepts : 0;
    const scorePercent = Math.round(similarityScore * 100);

    // Stored for analysis only; never displayed.
    const overallVerdict: 'strong' | 'partial' | 'needs_review' =
      similarityScore >= 0.30 ? 'strong' :
      similarityScore >= 0.15 ? 'partial' :
      'needs_review';

    // 7. Written feedback; may fail (null) without costing the score. Zero coverage still goes
    // to the model on purpose: it writes more useful prose than a fixed message.
    const writtenFeedback = await generateRecallFeedback({
      userInput: user_input,
      studentPoints: extractedConcepts.map(ec => `${ec.term}: ${ec.explanation}`),
      coveredTerms: coveredConcepts,
      missedTerms: missedConcepts,
      missedWithPages,
      conceptPages,
      nearestLessonText,
      scorePercent,
    });

    // 8. Save. concepts_fingerprint enables memoised resubmissions.
    const payload: FreeRecallFeedback & MemoisableFeedback = {
      missed_concepts: missedConcepts,
      overall_verdict: overallVerdict,
      written_feedback: writtenFeedback,
      covered_count: coveredCount,
      total_concepts: totalConcepts,
      concepts_fingerprint: fingerprint,
    };

    const { data: log, error: logError } = await supabaseAdmin
      .from('cognitive_logs')
      .insert({
        student_id: studentId,
        space_id,
        concept_id: null,
        material_ids,
        mode: 'free_recall',
        user_input,
        similarity_score: similarityScore,
        ai_feedback: JSON.stringify(payload),
      })
      .select()
      .single();

    if (logError) {
      res.status(500).json({ error: 'Failed to save cognitive log', message: logError.message });
      return;
    }

    // Never throws.
    await logActivity({
      studentId,
      type: 'free_recall',
      spaceId: space_id,
      materialId: material_ids?.[0] ?? null,
    });

    res.status(201).json({
      data: {
        log_id: log.id,
        similarity_score: similarityScore,
        score_percent: scorePercent,
        covered_count: coveredCount,
        total_concepts: totalConcepts,
        missed_concepts: missedConcepts,
        overall_verdict: overallVerdict,
        written_feedback: writtenFeedback,
        feedback_unavailable: writtenFeedback === null,
        created_at: log.created_at,
      },
      message: 'Free recall scored successfully',
    });

  } catch (err: any) {
    console.error('[FreeRecall] Error:', err);
    if (err instanceof GeminiUnavailableError) {
      // The upstream status (429 vs 503) with the student-safe message, never err.message.
      res.status(err.status).json({ error: 'AI service unavailable', message: studentFacingError(err) });
      return;
    }
    res.status(500).json({
      error: 'Failed to process free recall submission',
      // Never send err.message to a student; it's logged above.
      message: 'Your writing could not be checked just now. Please try again in a moment.',
    });
  }
});

/**
 * GET /api/cognitive/history/:spaceId?mode=free_recall|feynman: the caller's last 20 attempts.
 * Filters on both the owned space and the student id.
 */
router.get('/history/:spaceId', async (req: Request, res: Response): Promise<void> => {
  const { spaceId } = req.params;

  const rawMode = req.query.mode;
  const mode = typeof rawMode === 'string' ? rawMode : 'free_recall';
  if (mode !== 'free_recall' && mode !== 'feynman') {
    res.status(400).json({ error: "Invalid mode. Expected 'free_recall' or 'feynman'." });
    return;
  }

  const studentId = await requireOwnedSpace(spaceId, req, res);
  if (!studentId) return;

  const { data: logs, error } = await supabaseAdmin
    .from('cognitive_logs')
    // material_ids lets the client compare attempts on the same material only.
    .select('id, mode, user_input, similarity_score, ai_feedback, material_ids, created_at')
    .eq('space_id', spaceId)
    .eq('student_id', studentId)
    .eq('mode', mode)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch history', message: error.message });
    return;
  }

  res.json({ data: logs ?? [] });
});

// Feynman: audience rubric (the paper specifies one audience).
const AUDIENCE_RUBRICS: Record<FeynmanAudience, string> = {
  '10yr_old': `The student is explaining to a 10-YEAR-OLD CHILD.

Simplicity rubric (be strict):
- Every technical or academic term used without being unpacked in plain words is JARGON. Flag it.
- Reward concrete, everyday analogies (dominoes, mailboxes, cargo ships, water in pipes).
- Reward short sentences and cause-and-effect storytelling.
- A textbook-accurate explanation that a child could not follow scores LOW on simplicity, no matter how correct it is.`,
};

/** Clamps an untrusted model number to an integer 0–100. */
function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Derived from accuracy, never asked of the model (it leaks simplicity into the verdict). */
function deriveVerdict(accuracyScore: number): FeynmanVerdict {
  if (accuracyScore >= 80) return 'correct';
  if (accuracyScore >= 30) return 'needs_improvement';
  return 'incorrect';
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

const normaliseTerm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Forms of the concept's own name, e.g. "Physical Layer (OSI Model)" → full, "physical layer", "osi model". */
function selfReferentialForms(term: string): Set<string> {
  const forms = new Set<string>();
  forms.add(normaliseTerm(term));
  forms.add(normaliseTerm(term.replace(/\s*\([^)]*\)\s*/g, '')));
  for (const match of term.matchAll(/\(([^)]*)\)/g)) {
    forms.add(normaliseTerm(match[1]));
  }
  return forms;
}

/** Naming the concept being explained is never jargon; enforced here as well as in the prompt. */
function stripSelfReferentialJargon(jargon: string[], term: string): string[] {
  const forbidden = selfReferentialForms(term);
  return jargon.filter(j => !forbidden.has(normaliseTerm(j)));
}

/**
 * True when a claimed analogy uses the lesson's own glossary terms (an in-domain example, not an
 * analogy). Whole terms only, never single words, which would reject "like pages in a book".
 * The concept's own name is excluded.
 */
function analogyUsesLessonVocabulary(
  quote: string,
  glossaryTerms: string[],
  conceptTerm: string
): boolean {
  const haystack = normaliseTerm(quote);
  if (!haystack) return false;

  const own = selfReferentialForms(conceptTerm);

  for (const raw of glossaryTerms) {
    const term = normaliseTerm(raw);
    // Terms under 4 characters are too generic.
    if (term.length < 4 || own.has(term)) continue;

    // Singular/plural both ways. Strip only a trailing "s" ("pages" → "page", not "pag").
    const base = term.replace(/s$/, '');
    if (base.length < 4) continue;
    const pattern = new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:es|s)?\\b`);
    if (pattern.test(haystack)) return true;
  }

  return false;
}

/** Replaces the model's analogy note when the backstop above fires (the model's would read as praise). */
const IN_DOMAIN_ANALOGY_NOTE =
  'Your comparison used words from this lesson, so it only makes sense to someone who already ' +
  'studied the topic. Try comparing it to something from everyday life instead — a castle with ' +
  'many walls, a lock on a door, or water flowing through pipes.';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Structure only; the coercion after the call validates values and must stay. */
const FEYNMAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overall_feedback: { type: Type.STRING },
    concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concept_id: { type: Type.STRING },
          accuracy_score: { type: Type.INTEGER },
          simplicity_score: { type: Type.INTEGER },
          jargon_found: { type: Type.ARRAY, items: { type: Type.STRING } },
          feedback: { type: Type.STRING },
          analogy_used: { type: Type.BOOLEAN },
          analogy_quote: { type: Type.STRING },
          analogy_idea: { type: Type.STRING },
        },
        required: [
          'concept_id', 'accuracy_score', 'simplicity_score', 'jargon_found',
          'feedback', 'analogy_used', 'analogy_quote', 'analogy_idea',
        ],
        propertyOrdering: [
          'concept_id', 'accuracy_score', 'simplicity_score', 'jargon_found',
          'feedback', 'analogy_used', 'analogy_quote', 'analogy_idea',
        ],
      },
    },
  },
  required: ['overall_feedback', 'concepts'],
  propertyOrdering: ['overall_feedback', 'concepts'],
};

/**
 * POST /api/cognitive/feynman. Grades two independent axes: accuracy (vs the stored definition)
 * and simplicity (vs the audience rubric). Model-graded, not embeddings, which can't see jargon.
 */
router.post('/feynman', async (req: Request, res: Response): Promise<void> => {
  const parsed = FeynmanEvaluationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, audience, explanations } = parsed.data;

  // 0. Ownership and access.
  const studentId = await requireOwnedSpace(space_id, req, res);
  if (!studentId) return;
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  try {
    // 1. Reject duplicate concepts.
    const conceptIds = explanations.map(e => e.concept_id);
    const uniqueConceptIds = [...new Set(conceptIds)];
    if (uniqueConceptIds.length !== conceptIds.length) {
      res.status(400).json({ error: 'Each concept may only be explained once per submission.' });
      return;
    }

    // 2. Authoritative term + definition, scoped to the selected materials.
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

    // 2b. Lesson glossary (every term in the materials) for the jargon check.
    const { data: glossaryRows } = await supabaseAdmin
      .from('concepts')
      .select('term')
      .in('material_id', material_ids);

    const glossaryTerms = [...new Set((glossaryRows ?? []).map(r => r.term as string))];

    // 2c. Identical resubmission: reuse the stored grade. The glossary is in the fingerprint.
    const userInput = explanations
      .map(e => `Concept: ${conceptById.get(e.concept_id)!.term}\nExplanation: ${e.explanation}`)
      .join('\n\n');

    const fingerprint = fingerprintConcepts(concepts, glossaryTerms);
    const memoised = await findMemoisedAttempt<FeynmanFeedback & MemoisableFeedback>({
      studentId,
      mode: 'feynman',
      userInput,
      materialIds: material_ids,
      fingerprint,
    });

    if (memoised) {
      // Still a real attempt: write a row and log activity.
      const { data: log, error: memoLogError } = await supabaseAdmin
        .from('cognitive_logs')
        .insert({
          student_id: studentId,
          space_id,
          concept_id: null,
          material_ids,
          mode: 'feynman',
          user_input: userInput,
          similarity_score: memoised.accuracy_score / 100,
          ai_feedback: JSON.stringify(memoised),
        })
        .select()
        .single();

      if (memoLogError) {
        res.status(500).json({ error: 'Failed to save cognitive log', message: memoLogError.message });
        return;
      }

      await logActivity({
        studentId,
        type: 'feynman',
        spaceId: space_id,
        materialId: material_ids?.[0] ?? null,
      });

      res.status(201).json({
        data: { log_id: log.id, created_at: log.created_at, ...memoised },
        message: 'Feynman explanation evaluated successfully',
      });
      return;
    }

    // 3. One grounded prompt covering every concept.
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

EVERY piece of writing you produce is read by the student themselves, so ADDRESS THEM DIRECTLY as "you" and "your". Write "Your explanation captured...", never "The student's explanation captured...". Never refer to them in the third person and never call them "the student" — you are speaking to them, not reporting on them to someone else. Keep it warm, plain and direct, suitable for a Junior High School student.

Also produce for each concept:
- "jargon_found": array of terms from the student's own text that violate the simplicity rubric. Use the student's exact wording. Any term from the LESSON GLOSSARY below that the student used without unpacking it in plain words IS jargon for a 10-year-old and MUST be flagged — the glossary is this lesson's technical vocabulary, so a child has not met those words. Also flag technical terms outside that list. NEVER include the concept's own Term (or its acronym) — the student was asked to explain it, so naming it is not jargon. Empty array only if the answer genuinely contains no technical vocabulary at all.
- "feedback": 2-4 encouraging sentences addressed to the student as "you". Say what they got right, name any factual error explicitly, then say how to improve.

ANALOGY VERIFICATION — judge this from the student's own text, do not invent one for them:
- "analogy_used": true ONLY if the student compared the concept to something from ORDINARY EVERYDAY LIFE that has nothing to do with this subject — castles, water in pipes, mailboxes, cooking, sport, a guard checking IDs at a door.

  APPLY THIS TEST: could the comparison be understood by someone who has never studied this subject at all? If it needs subject knowledge, it is NOT an analogy.

  The word "like" does NOT make something an analogy. Comparing one thing from this subject to another thing from the same subject is an IN-DOMAIN EXAMPLE, not an everyday comparison — mark it false.

  Worked example of what to REJECT:
    "Resilience is like when a server keeps running after a failure. For example, it's like a backup server taking over automatically."
    → analogy_used: FALSE. It says "like" twice, but it compares computers to computers. A child who knows nothing about computers learns nothing from it.

  Worked example of what to ACCEPT:
    "Defense-in-depth is like a castle with a moat, then a wall, then guards inside."
    → analogy_used: TRUE. Castles have nothing to do with computing, and any child pictures one instantly.

  Also reject: restating the definition, naming a technical case, or listing an instance of the concept. If in doubt, FALSE.
- "analogy_quote": if analogy_used is true, the student's comparison in THEIR OWN WORDS, quoted from their text. Empty string if analogy_used is false.
- "analogy_idea": addressed to the student as "you". If analogy_used is true, one sentence on whether their comparison actually helps and how to sharpen it. If analogy_used is false, suggest one concrete everyday analogy a 10-year-old would grasp — phrase it as an invitation ("Try comparing it to..."), not as a report.

LESSON GLOSSARY (technical vocabulary from this material):
${glossaryTerms.join(', ') || '(none extracted)'}

${submissionBlock}

Return ONLY a JSON object of this exact shape:
{
  "overall_feedback": "2-3 sentences spoken TO the student about their submission as a whole, using 'you' and 'your'. Start from what they did, e.g. 'Your explanation of X was...' — never 'The student's explanation'.",
  "concepts": [
    {
      "concept_id": "<echo the concept_id exactly as given>",
      "accuracy_score": 0,
      "simplicity_score": 0,
      "jargon_found": ["..."],
      "feedback": "...",
      "analogy_used": false,
      "analogy_quote": "",
      "analogy_idea": "..."
    }
  ]
}
The "concepts" array must contain exactly ${explanations.length} object(s), one per concept above, in the same order.`;

    interface RawFeynmanResponse {
      overall_feedback?: unknown;
      concepts?: unknown;
    }

    // Grading model: accuracy_score is the number the student sees. MEDIUM thinking for a hard
    // multi-axis prompt; generous tokens because thinking shares the budget.
    const raw = await generateJson<RawFeynmanResponse>(prompt, {
      model: GEMINI_GRADING_MODEL,
      thinkingLevel: ThinkingLevel.MEDIUM,
      responseSchema: FEYNMAN_SCHEMA,
      maxOutputTokens: 16384,
    });
    const rawConcepts = Array.isArray(raw?.concepts) ? (raw.concepts as Record<string, unknown>[]) : [];

    // 4. Coerce the output. Match on echoed concept_id, falling back to position.
    const results: FeynmanConceptResult[] = explanations.map((e, i) => {
      const concept = conceptById.get(e.concept_id)!;
      const match =
        rawConcepts.find(rc => rc?.concept_id === e.concept_id) ?? rawConcepts[i] ?? {};

      const accuracyScore = clampScore(match.accuracy_score);

      // A claimed analogy is rejected if it has no quote, or the quote uses lesson vocabulary.
      const analogyQuote = typeof match.analogy_quote === 'string' ? match.analogy_quote.trim() : '';
      const claimedAnalogy = match.analogy_used === true && analogyQuote.length > 0;
      const inDomain =
        claimedAnalogy && analogyUsesLessonVocabulary(analogyQuote, glossaryTerms, concept.term);
      const analogyUsed = claimedAnalogy && !inDomain;

      const modelAnalogyIdea = typeof match.analogy_idea === 'string' ? match.analogy_idea : '';

      return {
        concept_id: concept.id,
        term: concept.term,
        accuracy_score: accuracyScore,
        simplicity_score: clampScore(match.simplicity_score),
        verdict: deriveVerdict(accuracyScore),
        jargon_found: stripSelfReferentialJargon(coerceStringArray(match.jargon_found), concept.term),
        feedback: typeof match.feedback === 'string' ? match.feedback : '',
        analogy_used: analogyUsed,
        analogy_quote: analogyUsed ? analogyQuote : '',
        analogy_idea: inDomain ? IN_DOMAIN_ANALOGY_NOTE : modelAnalogyIdea,
      };
    });

    const accuracyScore = mean(results.map(r => r.accuracy_score));
    const simplicityScore = mean(results.map(r => r.simplicity_score));

    const feedbackPayload: FeynmanFeedback & MemoisableFeedback = {
      concepts_fingerprint: fingerprint,
      audience,
      accuracy_score: accuracyScore,
      simplicity_score: simplicityScore,
      overall_feedback: typeof raw?.overall_feedback === 'string' ? raw.overall_feedback : '',
      jargon_found: [...new Set(results.flatMap(r => r.jargon_found))],
      concepts: results,
    };

    // 5. One row per submission; per-concept results live in ai_feedback.
    // similarity_score holds mean accuracy as 0–1.
    const { data: log, error: logError } = await supabaseAdmin
      .from('cognitive_logs')
      .insert({
        student_id: studentId,
        space_id,
        concept_id: null,
        material_ids,
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

    // Never throws.
    await logActivity({
      studentId,
      type: 'feynman',
      spaceId: space_id,
      materialId: material_ids?.[0] ?? null,
    });

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
      res.status(err.status).json({ error: 'AI service unavailable', message: studentFacingError(err) });
      return;
    }
    res.status(500).json({
      error: 'Failed to evaluate Feynman submission',
      message: 'Your explanation could not be checked just now. Please try again in a moment.',
    });
  }
});

export default router;
