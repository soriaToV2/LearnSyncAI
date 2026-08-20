import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  generateEmbedding,
  generateJson,
  GeminiUnavailableError,
  GEMINI_GRADING_MODEL,
  GEMINI_UTILITY_MODEL,
} from '../lib/gemini';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
// The canonical term-matching convention, shared with extraction so a student
// typing "SSDLC" resolves to the same concept the fold would have joined it to.
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

/**
 * Confirms the caller owns the study space they named.
 *
 * `requireRole('student')` only proves the caller is *a* student. Every route
 * here reads or writes that space's submissions, and the service-role key
 * bypasses RLS (migration 0008: "The API layer must still enforce role and
 * ownership itself"), so ownership has to be checked here.
 *
 * Answers 404 rather than 403 — a 403 would confirm the id names a real space.
 * Returns the space id on success, or null after sending the response.
 */
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
 * Fingerprints the educator content a submission is graded against.
 *
 * This is what lets an identical resubmission be reused SAFELY. Reuse must stop
 * the moment the educator changes the material, and `concepts` has **no
 * `updated_at` column** — editing a definition changes no timestamp anywhere — so
 * the fingerprint has to be taken over the content itself.
 *
 * Both callers already fetch exactly these rows before their AI call, so this
 * costs no extra query. Sorted by id so row order from Postgres cannot affect it,
 * and hashed as JSON rather than concatenated text so no combination of field
 * values can be reassembled into a different set that hashes the same.
 *
 * `extra` carries anything else the grading depended on — Feynman passes the
 * lesson glossary, because that list drives its jargon detection.
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

/** Every payload we memoise carries the fingerprint it was produced against. */
interface MemoisableFeedback {
  concepts_fingerprint?: string;
}

/**
 * Returns a previous identical attempt's stored result, or null.
 *
 * REPRODUCIBILITY LIVES HERE. `temperature: 0` used to pin the scoring pipeline,
 * but Gemini 3 dropped the sampling parameters entirely, so there is no model-side
 * knob left. Rather than hope threshold quantisation absorbs the drift, an
 * identical submission is answered from what it scored last time — which is exact,
 * and true whichever model is configured. That is precisely what makes the model a
 * free variable rather than a load-bearing part of the guarantee.
 *
 * A hit skips EVERY AI call for that submission, which also matters on a free tier
 * metered at 20 requests per day per model.
 *
 * Matched on: same student, same mode, same text, same materials, and the same
 * concept content. The fingerprint is the part that makes this safe — an educator
 * edit changes it, so the next submission is evaluated fresh instead of being
 * served a score for a lesson that no longer exists.
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
      // Rows written before this field existed have no fingerprint and cannot be
      // proven current, so they are ignored rather than trusted.
      if (parsed.concepts_fingerprint === fingerprint) return parsed;
    } catch {
      // Unparseable prior — fall through and evaluate fresh.
    }
  }

  return null;
}

/** Shape of the concepts a student's own answer is broken into. */
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

/** Shape of the coaching prose. Pins structure only — emptiness is caught below. */
const RECALL_FEEDBACK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    feedback: { type: Type.STRING },
    // Required rather than optional so "nothing to flag" is an explicit empty
    // string the model had to decide on, not a field it quietly omitted.
    corrections: { type: Type.STRING },
  },
  required: ['feedback', 'corrections'],
  propertyOrdering: ['feedback', 'corrections'],
};

/**
 * Embeds many texts at once, preserving order, a few at a time.
 *
 * Bounded rather than a plain `Promise.all`: a long answer can extract 60+
 * points, and firing all of them at once risks a rate-limit burst costing far
 * more than the serialisation saves. Eight keeps wall time within a whisker of
 * unbounded while never putting more than eight requests in flight.
 *
 * Measured on a real submission: 29 points took 11.5s one-at-a-time versus 1.5s
 * in parallel — 75% of everything spent before the feedback call, purely because
 * this was written as a for-loop over independent calls.
 *
 * Results are written by index, so the output lines up with the input whatever
 * order the responses arrive in.
 */
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

/**
 * Fixed prose for an attempt that matched NOTHING in the material.
 *
 * Written in code rather than by the model, for two reasons. There is nothing
 * specific to say — no point landed, and naming gaps from a 28-item missed list
 * is exactly the reciting the prompt forbids. And it would cost a model call to
 * say something already known, on the slowest step of the request.
 *
 * Used for both zero extracted points and zero COVERED concepts. The second case
 * is the common one: an off-topic answer still yields plenty of points
 * ("chlorophyll", "glucose"), so extraction is not empty — only the matching is.
 */
const NO_MATCH_FEEDBACK: FreeRecallWrittenFeedback = {
  feedback:
    "Nothing you wrote matched the ideas in this lesson yet. That usually means the answer is about a different material, or it is still too short for us to match anything against — it does not mean what you wrote is wrong. Open the material again, read one section, then close it and write down every idea from that section you can remember in your own words.",
};

/**
 * Writes coaching prose for a Free Recall attempt.
 *
 * Deliberately returns null instead of throwing. The caller invokes this
 * BEFORE saving and outside the scoring try block, so a failure here costs the
 * student their paragraphs and nothing else — the score, verdict and missed
 * list are already computed and still get written.
 *
 * Everything named here is read by the student as a statement about their own
 * answer, so the prompt below forbids naming any gap that is not in `missedTerms`.
 */
async function generateRecallFeedback(params: {
  userInput: string;
  studentPoints: string[];
  coveredTerms: string[];
  /** Plain terms — the only gaps the prose is allowed to name. */
  missedTerms: string[];
  /**
   * The same missed terms carrying their `source_pages`, e.g. "Injection (p. 24,
   * 25)". This is what turns "review injection" into somewhere the student can
   * actually go, and it is the whole reason `next_steps` survives as its own
   * field rather than dissolving into the summary.
   */
  missedWithPages: string[];
  /**
   * Every concept in the material with its page, not just the missed ones.
   *
   * A student who covers everything still gets a next step — "go deeper on X" —
   * and with only the missed list supplied there were no pages left to cite.
   * Two 100%-coverage attempts came back with "review the section on access
   * control in your lesson materials", the model correctly declining to invent
   * a page number it had not been given.
   */
  conceptPages: string[];
  /**
   * Each point the student made, paired with the closest thing the LESSON says.
   * This is the only ground truth in the prompt — without it the writer sees
   * concept names and no definitions, so it cannot tell a correct statement
   * from a confident error, and may praise the error back to the student.
   */
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
    // LOW rather than MINIMAL: the prompt carries real restraint rules — "do NOT
    // recite the missed list", and "stay silent unless the lesson text settles
    // it" — and a zero-thinking pass tends to just list things.
    //
    // 6144: the prompt carries a definition per student point plus a paged
    // missed list, the passage runs 4-5 sentences, and thinking tokens draw on
    // this same allowance. A truncated response surfaces as unparseable JSON,
    // which here means the student silently loses their feedback.
    //
    // MEDIUM, raised from LOW when `corrections` landed. Comparing ~25 claims
    // against ~20 definitions is the actual work in this call, and at LOW the
    // model found one injected error, stopped, and then praised the second one
    // as a strength. Still the utility model, not the grading model — the rule
    // in CLAUDE.md turns on whether the model's judgement becomes a number the
    // student is shown, and this one only ever becomes prose.
    const raw = await generateJson<Record<string, unknown>>(prompt, {
      model: GEMINI_UTILITY_MODEL,
      thinkingLevel: ThinkingLevel.MEDIUM,
      responseSchema: RECALL_FEEDBACK_SCHEMA,
      maxOutputTokens: 6144,
    });
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    const feedback: FreeRecallWrittenFeedback = {
      feedback: str(raw?.feedback),
      // Empty is the expected answer, so it is never part of the emptiness test
      // below — an attempt with nothing to correct is a normal attempt.
      corrections: str(raw?.corrections),
    };

    // An empty passage is a failed generation, not feedback. Treat it as
    // unavailable so the student sees the honest note rather than a blank card.
    if (!feedback.feedback) return null;
    return feedback;
  } catch (err) {
    console.error('[FreeRecall] Written feedback unavailable:', err);
    return null;
  }
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
 * 6. Compute overall similarity score (coverage ratio).
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

  // ── 0. Ownership and access ─────────────────────────────────────────────
  // The response lists every concept term the student did not cover, so an
  // ungated call would dump another grade's concept list to anyone who submits
  // gibberish against its material id.
  const studentId = await requireOwnedSpace(space_id, req, res);
  if (!studentId) return;
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  try {
    // ── 1. Fetch all reference concepts for the selected materials ────────
    const { data: allConcepts, error: conceptsError } = await supabaseAdmin
      .from('concepts')
      // `source_pages` is carried purely so the feedback can tell a student WHERE
      // to go and read. Extraction already records it for educator traceability.
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

    // Filter to only concepts that have embeddings
    const conceptsWithEmbeddings = allConcepts.filter(c => {
      const vec = parseVector(c.embedding);
      return vec.length > 0;
    });

    if (conceptsWithEmbeddings.length === 0) {
      res.status(400).json({ error: 'Concept embeddings are not ready yet. Please wait for material processing to complete.' });
      return;
    }

    // ── 1b. Identical resubmission? Answer from what it scored last time ───
    // Runs BEFORE any AI call, so a hit costs zero Gemini requests (this endpoint
    // otherwise spends 2 plus one embedding per student concept). This is also
    // what guarantees an identical submission scores identically now that Gemini 3
    // has no `temperature` to pin — see findMemoisedAttempt.
    const fingerprint = fingerprintConcepts(conceptsWithEmbeddings);
    const memoised = await findMemoisedAttempt<FreeRecallFeedback & MemoisableFeedback>({
      studentId,
      mode: 'free_recall',
      userInput: user_input,
      materialIds: material_ids,
      fingerprint,
    });

    if (memoised) {
      // Still writes a row: a resubmission is a real attempt and must appear in
      // the student's history exactly as before. Only the model calls are skipped.
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

      /*
       * A memoised attempt still counts. It writes a real `cognitive_logs` row
       * and appears in the student's history exactly as a fresh one does, so it
       * must count toward the streak too — only the model calls are skipped,
       * not the fact that the student sat down and did the work.
       */
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

    // ── 2. Extract discrete concepts from the student's text via Gemini ───
    interface ExtractedConcept { term: string; explanation: string }

    // GRANULARITY IS THE WHOLE JOB HERE, and it is not a stylistic preference.
    //
    // Each item becomes one vector, and a reference concept is "covered" only if
    // some student vector clears 0.70 against it. A point that summarises a whole
    // paragraph embeds as an average, so no individual concept inside it matches
    // well — the student is then marked as having missed things they plainly
    // wrote. Measured on a real submission: an earlier version of this prompt
    // yielded 8 points for a six-paragraph answer and produced FIVE such false
    // misses, including "Saves Money and Resources" and "Protects Data and
    // Privacy" from the sentence "the benefits are that it minimises the damage,
    // reduces downtime, protects data and privacy, and saves money". The rules
    // below took the same answer to 21 points and zero false misses.
    //
    // The list rule carries most of that. Educator-side extraction stores each
    // item of an enumeration as its own concept ("Preparation", "Containment",
    // "Reduces Downtime"), so a student listing them in one sentence must be
    // split the same way or the two sides cannot line up.
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

    // This is the only sampling step that feeds the score — a different concept
    // list embeds differently and shifts the coverage ratio. `temperature: 0`
    // used to pin it; Gemini 3 ignores temperature, so the schema pins the shape
    // and findMemoisedAttempt above pins repeat submissions exactly.
    //
    // The utility model is correct here despite feeding a score: the model only
    // ENUMERATES what the student mentioned. Nothing it returns is a score — the
    // number comes from cosine similarity against COVERAGE_THRESHOLD, computed
    // below in code.
    //
    // LOW rather than MINIMAL, and 8192 rather than 4096. Splitting an
    // enumeration the student wrote as one sentence is a judgement the model
    // will not make with thinking off, and a granular pass returns roughly three
    // times as many items — a budget sized for the old coarse output truncates
    // mid-array, which surfaces as unparseable JSON rather than a clean error.
    const extractedConcepts = await generateJson<ExtractedConcept[]>(extractionPrompt, {
      model: GEMINI_UTILITY_MODEL,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: STUDENT_CONCEPT_SCHEMA,
      maxOutputTokens: 8192,
    });

    // ── 3. Handle edge case: student wrote nothing recognizable ───────────
    if (!Array.isArray(extractedConcepts) || extractedConcepts.length === 0) {
      // Score is 0 — all concepts are missed
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

    // ── 4. Embed each student-extracted concept individually ──────────────
    //
    // In parallel. Granular extraction turns one answer into ~30 points, and one
    // await per point made this the single slowest stage of the request:
    // measured 11.5s sequential against 1.5s in parallel for 29 points, 75% of
    // everything spent before the feedback call. The calls are independent, so
    // the only reason it was serial is that it was written as a for-loop.
    const vectors = await embedAll(
      extractedConcepts.map(ec => `${ec.term}: ${ec.explanation}`)
    );
    const studentEmbeddings = extractedConcepts.map((ec, i) => ({
      term: ec.term,
      embedding: vectors[i],
    }));

    // ── 5. Grade each reference concept by its best match ─────────────────
    const COVERAGE_THRESHOLD = 0.70;
    const missedConcepts: string[] = [];
    // Covered terms are kept, not just counted — the written feedback needs to
    // name what the student actually got, not only what they left out.
    const coveredConcepts: string[] = [];
    // The same misses, carrying the page they are taught on — prompt only. The
    // stored `missed_concepts` stays plain terms so the payload shape and the
    // UI's collapsible list are unaffected.
    const missedWithPages: string[] = [];

    /** One line per concept, so a page can be cited even at full coverage. */
    const pagesOf = (c: { source_pages?: unknown }) => {
      const pages = (c.source_pages as number[] | null) ?? [];
      return pages.length ? ` (p. ${pages.join(', ')})` : '';
    };
    const conceptPages = conceptsWithEmbeddings.map(c => `- ${c.term}${pagesOf(c)}`);

    // The reverse pairing, for the accuracy note only: for each point the STUDENT
    // made, which concepts is the lesson's closest answer to it?
    //
    // Deliberately ignores COVERAGE_THRESHOLD. A badly wrong statement drifts
    // AWAY from the concept it is wrong about — "Injection is when a hacker plugs
    // in a USB stick" scored 0.609 against Injection, so it is not in the covered
    // list at all, and the definition needed to contradict it would never be seen.
    //
    // Two rather than one, because that drift also REORDERS the neighbours: for
    // that same sentence Injection ranked SIXTH, behind XSS, SQLi, File Inclusion,
    // Integrity Failures and Cybersecurity. Vectors alone cannot be relied on to
    // surface the right concept for a badly wrong claim — which is why the term
    // lookup below exists and this is only the fallback for claims the student
    // never named.
    const TOP_NEAREST = 2;
    const nearestRef: { refIdx: number; score: number }[][] =
      studentEmbeddings.map(() => []);

    for (const [refIdx, refConcept] of conceptsWithEmbeddings.entries()) {
      const refEmbedding = parseVector(refConcept.embedding);
      if (refEmbedding.length === 0) continue;

      // Find highest similarity score against any of the student's concept vectors
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

    // Resolve the NAME the student used straight to the concept it names.
    //
    // This is the primary route, not a refinement of the vector search. A
    // student explaining injection writes the word "Injection", and an exact
    // name match finds that concept instantly where cosine buried it sixth. It
    // is also deterministic and free.
    //
    // Aliased through the extraction module's own foldKey/acronymOf rather than
    // a second copy of the rule, so "SSDLC" typed by a student resolves to
    // "SECURE SOFTWARE DEVELOPMENT LIFE CYCLE (SSDLC)" exactly as it would
    // during extraction.
    const conceptIdxByAlias = new Map<string, number>();
    for (const [refIdx, c] of conceptsWithEmbeddings.entries()) {
      const term = c.term as string;
      for (const alias of [normaliseTerm(term), foldKey(term), acronymOf(term)]) {
        // First writer wins: an earlier concept should not be displaced by a
        // later one that merely shares an acronym.
        if (alias && !conceptIdxByAlias.has(alias)) conceptIdxByAlias.set(alias, refIdx);
      }
    }

    // Pair each student point with the lesson text that could settle it — the
    // concept they named, plus their nearest neighbours for claims they only
    // described. Deduplicated on the concept, so a student who circled the same
    // idea five times does not repeat its definition five times in the prompt.
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

    // ── 6. Compute score as coverage ratio ────────────────────────────────
    // Score = covered / total. This avoids the "hubness" problem where random
    // vector overlap inflates scores for concepts the student never discussed.
    const totalConcepts = conceptsWithEmbeddings.length;
    const similarityScore = totalConcepts > 0 ? coveredCount / totalConcepts : 0;
    const scorePercent = Math.round(similarityScore * 100);

    // The denominator is every concept the material yielded, and extraction is
    // granular — one lesson produced 78 concepts, including supporting details
    // ("radio waves", "light pulses") nobody writes out from memory. Recalling
    // a document well lands near 20-30%, not 75%, so the bands sit there. The
    // ratio itself is left honest; only the label moved.
    const overallVerdict: 'strong' | 'partial' | 'needs_review' =
      similarityScore >= 0.30 ? 'strong' :
      similarityScore >= 0.15 ? 'partial' :
      'needs_review';

    // ── 7. Written feedback — allowed to fail, never allowed to cost the score ─
    // Scoring is finished and in memory by this point. The call below swallows
    // its own errors and yields null, so an overloaded or misbehaving model
    // costs the student their paragraphs and nothing else.
    //
    // Reuse of a previous identical attempt is handled earlier, before extraction
    // ran at all — see the memo check in step 1b.
    //
    // Zero coverage is NOT short-circuited to fixed prose, though it was tried.
    // The assumption was that an answer matching nothing leaves nothing to say;
    // measured against a real off-topic submission, that was wrong. The model
    // wrote "your recall drifted into biology, you missed the actual material we
    // are studying" and sent them to page 2 — specific, and better than any
    // fixed sentence. The genuine emptiness case is caught earlier, where
    // extraction itself returns nothing.
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

    // ── 8. Save to cognitive_logs ─────────────────────────────────────────
    // `concepts_fingerprint` is what lets an identical resubmission be answered
    // from this row instead of re-calling the model, and what stops that reuse
    // the moment the educator edits a concept.
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

      // Streak + badges. Never throws, so no try/catch of its own.
    await logActivity({
      studentId,
      type: 'free_recall',
      spaceId: space_id,
      materialId: material_ids?.[0] ?? null,
    });

    // ── 9. Return results to the frontend ────────────────────────────────
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
      // Surface the upstream failure with its own status — 503 for an overload,
      // 429 when the key's quota is spent — rather than dumping Google's raw
      // error JSON into the student's face. A quota refusal must not read as a
      // retryable outage; retrying it just fails again.
      res.status(err.status).json({ error: 'AI service unavailable', message: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to process free recall submission', message: err.message });
  }
});

/**
 * GET /api/cognitive/history/:spaceId?mode=free_recall|feynman
 *
 * Returns the caller's last 20 cognitive log sessions for a given study space.
 * Ordered by most recent first. Defaults to `free_recall` when `mode` is
 * omitted, preserving the original behaviour for existing callers.
 *
 * These rows are the student's own written work. Filtering on space_id alone
 * let anyone read another student's submissions, scores and feedback by
 * supplying their space id, so the caller must own the space AND the rows.
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
    // `material_ids` is what lets the client compare an attempt to the earlier
    // attempt on the SAME material. A space can hold attempts against several
    // materials, and their coverage ratios have different denominators — so
    // comparing across them would repeat the very error the verdict bands made.
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

// ─── Feynman: audience rubric ─────────────────────────────────────────────
// The paper specifies one audience — a 10-year-old child. Kept as a lookup so
// the rubric stays swappable without touching the prompt or the output schema.
const AUDIENCE_RUBRICS: Record<FeynmanAudience, string> = {
  '10yr_old': `The student is explaining to a 10-YEAR-OLD CHILD.

Simplicity rubric (be strict):
- Every technical or academic term used without being unpacked in plain words is JARGON. Flag it.
- Reward concrete, everyday analogies (dominoes, mailboxes, cargo ships, water in pipes).
- Reward short sentences and cause-and-effect storytelling.
- A textbook-accurate explanation that a child could not follow scores LOW on simplicity, no matter how correct it is.`,
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

const normaliseTerm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Every way a student might name the concept they were asked to explain.
 *
 * "Physical Layer (OSI Model)" yields the full string, "physical layer", and
 * "osi model" — so naming the concept never counts against them, whichever
 * form they used.
 */
function selfReferentialForms(term: string): Set<string> {
  const forms = new Set<string>();
  forms.add(normaliseTerm(term));
  forms.add(normaliseTerm(term.replace(/\s*\([^)]*\)\s*/g, '')));
  for (const match of term.matchAll(/\(([^)]*)\)/g)) {
    forms.add(normaliseTerm(match[1]));
  }
  return forms;
}

/**
 * Strips the concept's own name from its jargon list. The student was asked to
 * explain that term, so naming it cannot be jargon — but the model flags it
 * anyway when the explanation is circular. The prompt forbids this; this is the
 * belt-and-braces enforcement.
 */
function stripSelfReferentialJargon(jargon: string[], term: string): string[] {
  const forbidden = selfReferentialForms(term);
  return jargon.filter(j => !forbidden.has(normaliseTerm(j)));
}

/**
 * True when a claimed "everyday comparison" is built out of the lesson's own
 * vocabulary — which makes it an in-domain example, not an analogy.
 *
 * Measured against the live model: it accepted "it's like a backup server
 * taking over automatically" as an everyday comparison for Resilience. It says
 * "like" twice, but compares computers to computers, and "Web server" is a term
 * in that lesson's glossary. The prompt forbids this; the prompt alone did not
 * hold, so this enforces it in code — and therefore holds whichever model grades.
 *
 * The concept's own name is excluded: "Defense-in-depth is like a castle" must
 * stay a valid analogy even though "Defense-in-depth" is itself a glossary term.
 *
 * Deliberately matches WHOLE glossary terms only, never their individual words.
 * Splitting multi-word terms was tried and rejected: this material's glossary
 * yields head nouns like "pages" (Web pages), "traffic" (HTTP/HTTPS traffic),
 * "control" (Broken Access Control), "fields" (Input fields) and "waves" (Radio
 * waves). Matching those would reject "like pages in a book" and "like traffic
 * on a road" — precisely the everyday analogies the feature exists to reward.
 *
 * Consequence: a comparison sharing only a head noun ("a backup server") is not
 * caught here. That case is the prompt's job; this is the backstop for
 * unambiguous ones. A false rejection is the worse error, because the student is
 * then told to do something they already did.
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
    // Terms under 4 characters are too generic to be reliable evidence.
    if (term.length < 4 || own.has(term)) continue;

    // Match singular and plural in both directions: a glossary "Web server"
    // must catch "web servers", and "Web pages" must catch "web page".
    // Only the trailing "s" comes off — stripping "es" would turn "pages" into
    // "pag" and stop matching "page" at all.
    const base = term.replace(/s$/, '');
    if (base.length < 4) continue;
    const pattern = new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:es|s)?\\b`);
    if (pattern.test(haystack)) return true;
  }

  return false;
}

/**
 * Shown instead of the model's own analogy verdict when the backstop above
 * fires. The model wrote its `analogy_idea` believing the comparison counted,
 * so it reads as praise — displaying that under "No everyday comparison" would
 * contradict itself. This says plainly why it did not count, and what would.
 */
const IN_DOMAIN_ANALOGY_NOTE =
  'Your comparison used words from this lesson, so it only makes sense to someone who already ' +
  'studied the topic. Try comparing it to something from everyday life instead — a castle with ' +
  'many walls, a lock on a door, or water flowing through pipes.';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Shape of a Feynman grading response.
 *
 * STRUCTURE ONLY. It guarantees the keys exist and are the right type; it says
 * nothing about whether `accuracy_score` is sane, whether `concept_id` echoes an
 * id we actually sent, or whether a claimed analogy is really an analogy. The
 * coercion layer after the call is what enforces all of that and must stay.
 */
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
 * Instead we ground GEMINI_GRADING_MODEL on the stored definitions as truth.
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

  // ── 0. Ownership and access ─────────────────────────────────────────────
  // Grading echoes each concept's term back, and the feedback paraphrases its
  // stored definition, so this is a read of the material's content.
  const studentId = await requireOwnedSpace(space_id, req, res);
  if (!studentId) return;
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

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
    //
    // One row per term is guaranteed upstream by extraction, so a submitted id
    // names exactly one definition — see the ONE ROW PER TERM invariant in
    // `lib/conceptExtraction.ts`.
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

    // ── 2b. Load the lesson glossary for the jargon check ─────────────────
    // The paper's step 1 compares the explanation "against the main glossary
    // list extracted during the document upload phase" — that list is every
    // term extracted from the selected materials, not just the ones being
    // explained. Terms only; definitions would balloon the prompt for nothing.
    const { data: glossaryRows } = await supabaseAdmin
      .from('concepts')
      .select('term')
      .in('material_id', material_ids);

    const glossaryTerms = [...new Set((glossaryRows ?? []).map(r => r.term as string))];

    // ── 2c. Identical resubmission? Answer from what it graded last time ──
    // Built before the prompt so a hit costs zero Gemini requests. This is also
    // what keeps an identical explanation scoring identically now that Gemini 3
    // ignores `temperature` — a drifting accuracy_score would otherwise be able to
    // cross deriveVerdict()'s 80 boundary and flip the badge a student is shown.
    //
    // The glossary is part of the fingerprint because it drives jargon detection,
    // so adding a concept to the material legitimately changes the grade.
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
      // Still writes a row — a resubmission is a real attempt and must appear in
      // history exactly as before. Only the model call is skipped.
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

      // Counts toward the streak for the same reason it writes a log row: the
      // student did the work, and only the model call was skipped.
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

    // The grading model, not the utility one: `accuracy_score` below comes
    // straight from the model and drives deriveVerdict(), so this is the one call
    // in the codebase where the model's judgement IS the number a student is told.
    //
    // MEDIUM thinking is where that model earns its price — two anti-correlated
    // axes, a restraint rule, analogy classification and glossary-grounded jargon
    // in one pass. maxOutputTokens is generous because thinking tokens draw on the
    // same budget and a multi-concept submission is already a long response.
    //
    // `temperature: 0` used to pin repeat submissions; Gemini 3 ignores it, so
    // findMemoisedAttempt above does that job exactly instead.
    const raw = await generateJson<RawFeynmanResponse>(prompt, {
      model: GEMINI_GRADING_MODEL,
      thinkingLevel: ThinkingLevel.MEDIUM,
      responseSchema: FEYNMAN_SCHEMA,
      maxOutputTokens: 16384,
    });
    const rawConcepts = Array.isArray(raw?.concepts) ? (raw.concepts as Record<string, unknown>[]) : [];

    // ── 4. Coerce the model output — never trust it to hold its schema ────
    // Match on the echoed concept_id, falling back to positional order.
    const results: FeynmanConceptResult[] = explanations.map((e, i) => {
      const concept = conceptById.get(e.concept_id)!;
      const match =
        rawConcepts.find(rc => rc?.concept_id === e.concept_id) ?? rawConcepts[i] ?? {};

      const accuracyScore = clampScore(match.accuracy_score);

      // Two independent ways a claimed analogy is rejected:
      //   1. No quote — the model asserted one without producing the student's
      //      words, so there is nothing to show and nothing to trust.
      //   2. The quote is built from the lesson's own vocabulary, which makes it
      //      an in-domain example rather than an everyday comparison.
      // Either way a student is never told they did something they did not.
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

    // `concepts_fingerprint` is what lets an identical resubmission be answered
    // from this row instead of re-grading, and what stops that reuse the moment
    // the educator edits a concept or the glossary changes.
    const feedbackPayload: FeynmanFeedback & MemoisableFeedback = {
      concepts_fingerprint: fingerprint,
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
    // `userInput` was built in step 2c — it doubles as the memo key.
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

    // Streak + badges. Never throws, so no try/catch of its own.
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
      // Surface the upstream failure with its own status — 503 for an overload,
      // 429 when the key's quota is spent — rather than dumping Google's raw
      // error JSON into the student's face. A quota refusal must not read as a
      // retryable outage; retrying it just fails again.
      res.status(err.status).json({ error: 'AI service unavailable', message: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to evaluate Feynman submission', message: err.message });
  }
});

export default router;
