import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GEMINI_CONTENT_MODEL } from './gemini';
import { foldKey } from './conceptExtraction';
import { mentionsTerm } from './testGeneration';
import {
  ASSESSMENT_MAX_ITEMS,
  ASSESSMENT_MIN_ITEMS,
  ASSESSMENT_OPTIONS_PER_ITEM,
  type StoredAssessmentItem,
  type StoredAssessmentPayload,
} from '../types/api';

/**
 * Writing a material's pre-test and post-test — TEMPORARY research instrument.
 *
 * Removed after the school study (see schema.sql §17). It exists to serve the
 * paper's RQ4 (p. 55): the significance of the difference between a student's
 * standard pre-test score and their post-test score.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ITEM IS THE INVERSE OF `writeChoice()` IN `testGeneration.ts`, AND THAT IS
 * THE DECISION EVERYTHING ELSE FOLLOWS FROM.
 *
 * An adaptive-test MCQ names the term and offers four generated definitions. This
 * one describes the concept without naming it and offers four TERM NAMES — the
 * concept's own `term` plus three other terms from the same material:
 *
 *   "This phase of incident response removes the threat from the system after it
 *    has been contained."      Containment · Eradication · Preparation · Recovery
 *
 * Three things fall out of that, all of which the study depends on:
 *
 *  1. THE MODEL NEVER WRITES AN OPTION AND NEVER WRITES AN ANSWER. Every option
 *     is an educator-vetted `concepts.term` the server chose. There is no
 *     hallucination surface on the answer key at all — unlike `writeChoice`,
 *     where three of the four options are model prose.
 *
 *  2. "SAME ANSWER, SAME DIFFICULTY" IS STRUCTURAL. The pre and post forms are
 *     the same row: same concept, same `answer`, same four options. Only the
 *     sentence and the option order differ. Two separate generations could drift
 *     apart on the answer; this cannot.
 *
 *  3. GRADING IS A NORMALISED STRING COMPARE against the stored term, which is
 *     safe ONLY because a term appears at most once per material — the invariant
 *     `conceptExtraction.ts` enforces by folding before it embeds. Do not import
 *     `testGrading.ts`'s alias ladder here: the student picks from four literal
 *     strings the server wrote, so there is nothing to be lenient about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE MODEL CALL WRITES BOTH FORMS. Per concept the model returns `pre_stem` and
 * `post_stem` together, so the two wordings are provably about the same concept
 * and the call cost is ONE request per material — against the adaptive test's
 * five, on a 20/day free-tier bucket.
 *
 * THERE IS NO DIFFICULTY TIER, BY DESIGN. A "standard pre-test" (paper p. 55)
 * must not adapt: nothing here reads `bkt_mastery`, there is no `difficulty_tier`
 * column, and no tier machinery is imported. The guidance below is fixed, and is
 * deliberately definitional — the same register as
 * `FORMAT_TIER_GUIDANCE.matching_type.foundational`.
 */

/** One concept as it enters generation. Same shape as `ConceptForTest`. */
export interface ConceptForAssessment {
  id: string;
  term: string;
  definition: string;
}

export class AssessmentGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentGenerationError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Nothing here reasons: the server owns the answer, the options and the order. */
const THINKING = ThinkingLevel.MINIMAL;

/**
 * 20 items × TWO stems each is more output than any single-format ceiling in
 * `testGeneration.ts` was sized for (identification is 6144). MINIMAL thinking is
 * not *no* thinking and Gemini 3 thinking tokens draw on `maxOutputTokens`, so a
 * budget sized for the visible text alone returns `finishReason=MAX_TOKENS` with
 * no text — which throws away the entire generation, not one item. A ceiling is
 * not a reservation; unused headroom is free.
 */
const MAX_OUTPUT_TOKENS = 8192;

/** Definitions are capped in the prompt for the same token reason as testGeneration. */
const PROMPT_DEFINITION_CAP = 400;

/** Shuffle seeds. Different per phase so a memorised option position is worthless. */
const SEED_PRE = 0x5f37;
const SEED_POST = 0x9e3d;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER },
          pre_stem: { type: Type.STRING },
          post_stem: { type: Type.STRING },
        },
        required: ['n', 'pre_stem', 'post_stem'],
        propertyOrdering: ['n', 'pre_stem', 'post_stem'],
      },
    },
  },
  required: ['items'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Small local helpers
//
// `hash`/`seededShuffle` are copied from testGeneration.ts rather than exported
// from it. They are utility, not rule — and this feature is deliberately built
// to be deleted in one pass, so the fewer edits its removal requires elsewhere,
// the better. `mentionsTerm` IS a rule, which is why that one is imported.
// ─────────────────────────────────────────────────────────────────────────────

const hash = (n: number) => (Math.imul(n, 2654435761) >>> 0);

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** An item number leaking into the prose, the failure `looksClean` catches upstream. */
const ORPHAN_INDEX = /^\s*\d+\s*[.):]/;

function shorten(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concept selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Up to 20 concepts, spread EVENLY across the material rather than taken from
 * the front.
 *
 * A test built from the first 20 rows of a 57-concept lesson measures the first
 * few pages, and a student who ran out of time reading would score as if they had
 * learned nothing. Stride sampling covers the whole document, and it is
 * deterministic — a regenerated test asks about the same concepts, which matters
 * because `concepts` are stored in extraction (document) order.
 */
export function selectConcepts<T>(concepts: T[], limit = ASSESSMENT_MAX_ITEMS): T[] {
  if (concepts.length <= limit) return [...concepts];
  const stride = concepts.length / limit;
  const out: T[] = [];
  for (let i = 0; i < limit; i++) out.push(concepts[Math.floor(i * stride)]);
  return out;
}

/**
 * Three distractor terms for one item, drawn from the rest of the material.
 *
 * ⚠️ THE SUBSTRING GUARD IS NOT TIDINESS. `CLAUDE.md` states it directly for the
 * grader: *"'Injection' is contained in 'SQL Injection', and both are entries in
 * the same lesson."* Here it is worse than a grading nuisance — a stem written to
 * describe `Injection` may describe `SQL Injection` just as truthfully, so an
 * item offering both has TWO defensible answers and is ungradeable. The student
 * is not wrong; the item is.
 *
 * So a candidate is rejected when its folded form contains, or is contained by,
 * the answer's or another chosen option's folded form — and again when the stem
 * itself names it, which would hand the answer over in the opposite direction.
 *
 * ⚠️ CANDIDATES ARE DRAWN FROM THE ANSWER'S DOCUMENT NEIGHBOURHOOD FIRST, and
 * that is a measured rule rather than a preference. `CLAUDE.md` records it for the
 * games: what works is "options drawn from the lesson's own neighbouring
 * concepts", which the model can confuse with each other. Drawing from the whole
 * material instead produced items like
 *
 *   "This web application of a larger markup standard…"
 *      HTML · wind_gust_mph · XSL · dewpoint_c
 *
 * where `wind_gust_mph` and `dewpoint_c` are field names lifted from the lesson's
 * own worked example. They are real concept rows, so nothing here was wrong — but
 * a student can eliminate both without knowing anything, which turns a 4-option
 * item into a 2-option one. On a PRE-test that inflates the baseline toward 50%
 * and shrinks the very gain paper RQ4 measures, so it is a measurement defect and
 * not a cosmetic one.
 *
 * Concepts are stored in extraction (document) order, so a window around the
 * answer's position is the same lesson section, and the widening fallback keeps a
 * concept near the start or end of a short material from starving.
 *
 * Returns fewer than three when the material cannot supply them; the caller
 * treats that as a rejected item and refills.
 */
const NEIGHBOUR_WINDOW = 6;

function pickDistractors(
  answer: ConceptForAssessment,
  pool: ConceptForAssessment[],
  stems: string[],
  seed: number
): string[] {
  const chosenFolds = [foldKey(answer.term)];
  const picked: string[] = [];

  const at = pool.findIndex((c) => c.id === answer.id);
  const near =
    at < 0
      ? []
      : pool.slice(Math.max(0, at - NEIGHBOUR_WINDOW), at + NEIGHBOUR_WINDOW + 1);

  const consider = (candidate: ConceptForAssessment): void => {
    if (picked.length >= ASSESSMENT_OPTIONS_PER_ITEM - 1) return;
    if (candidate.id === answer.id) return;

    const fold = foldKey(candidate.term);
    if (!fold) return;
    if (picked.includes(candidate.term)) return;
    if (chosenFolds.some((f) => f === fold || f.includes(fold) || fold.includes(f))) return;
    // A distractor the stem names is a giveaway in reverse: the student picks the
    // word they can see in the sentence, and it is the wrong answer.
    if (stems.some((stem) => mentionsTerm(stem, candidate.term))) return;

    chosenFolds.push(fold);
    picked.push(candidate.term);
  };

  for (const candidate of seededShuffle(near, seed)) consider(candidate);
  for (const candidate of seededShuffle(pool, seed)) consider(candidate);

  return picked;
}

// ─────────────────────────────────────────────────────────────────────────────
// The model call
// ─────────────────────────────────────────────────────────────────────────────

const GUIDANCE = [
  'Each description must define the term plainly and completely enough that a',
  'student who studied the lesson can identify it with certainty, and a student',
  'who has not cannot guess it. Use only what the definition states — never add a',
  'fact that is not in it.',
].join(' ');

function buildPrompt(concepts: ConceptForAssessment[], materialTitle: string): string {
  const list = concepts
    .map(
      (c, i) =>
        `${i + 1}. Term: "${c.term}" — Definition: ${shorten(c.definition, PROMPT_DEFINITION_CAP)}`
    )
    .join('\n');

  return `You are writing a pre-test and a post-test for Junior High School students, drawn ONLY from the lesson "${materialTitle}".

For each numbered term, write TWO descriptions of it: "pre_stem" and "post_stem".

${GUIDANCE}

Rules for BOTH descriptions:
- One sentence, at most 200 characters, plain language a 13-year-old reads without effort.
- NEVER write the term itself or its abbreviation anywhere in the sentence. The
  student picks the term from a list, so naming it hands over the answer.
- Do not write the item's number inside the sentence — it belongs only in "n".

THE TWO DESCRIPTIONS MUST BE GENUINELY DIFFERENT SENTENCES:
- They describe the SAME term and must both be true of it.
- Rewrite from scratch: change the sentence structure, the opening words and the
  vocabulary. Do not reorder the same clauses or swap one synonym.
- "post_stem" is read weeks after "pre_stem" by the same student. If it merely
  echoes "pre_stem", the student recognises the sentence instead of recalling the
  term, and the test measures nothing.

Echo the item's number in "n".

Respond ONLY with valid JSON (no markdown):
{ "items": [ { "n": 1, "pre_stem": "...", "post_stem": "..." } ] }

Items:
${list}`;
}

interface StemPair {
  pre: string;
  post: string;
}

/**
 * One model call. Returns stems keyed by position in `concepts`.
 *
 * The range check on `n` is the point of the echo: an out-of-range or non-integer
 * number is DROPPED rather than allowed to attach this sentence to a different
 * concept. Same rule as `askBatch()` in `testGeneration.ts`, and for the same
 * reason — mis-attribution is undetectable downstream.
 */
async function writeStems(
  concepts: ConceptForAssessment[],
  materialTitle: string
): Promise<Map<number, StemPair>> {
  const parsed = await generateJson<{ items?: { n?: unknown; pre_stem?: unknown; post_stem?: unknown }[] }>(
    buildPrompt(concepts, materialTitle),
    {
      model: GEMINI_CONTENT_MODEL,
      thinkingLevel: THINKING,
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }
  );

  const byIndex = new Map<number, StemPair>();
  for (const item of parsed?.items ?? []) {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > concepts.length) continue;
    byIndex.set(n - 1, { pre: str(item.pre_stem), post: str(item.post_stem) });
  }
  return byIndex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spare concepts requested beyond the 20 wanted, so a rejected item can be
 * refilled WITHOUT a second model call.
 *
 * `generateTestQuestions()` handles a skipped item with a deterministic template
 * built from the definition. THERE IS NO TEMPLATE THAT CAN INVENT A SECOND,
 * DIFFERENTLY-WORDED STEM — a fallback here would have to either repeat the pre
 * wording as the post wording, which destroys the whole instrument, or paste the
 * definition, which names the term it is asking for. So validation replaces
 * fallback, and the spare pool is what makes validation affordable.
 */
const SPARE = 6;

function looksClean(text: string): boolean {
  return text.length > 0 && !ORPHAN_INDEX.test(text);
}

/**
 * Is this a usable parallel pair?
 *
 * The third test is the one that earns its place. At MINIMAL thinking on a
 * one-line definition, the likeliest failure is not a malformed response — it is
 * the model returning the SAME SENTENCE TWICE, or a near-copy with one synonym
 * swapped. That ships silently, reads correctly in the educator preview at a
 * glance, and quietly turns the post-test into a recognition exercise. Compare
 * normalised, so punctuation and casing cannot disguise it.
 */
function validPair(pair: StemPair | undefined, term: string): pair is StemPair {
  if (!pair) return false;
  if (!looksClean(pair.pre) || !looksClean(pair.post)) return false;
  if (mentionsTerm(pair.pre, term) || mentionsTerm(pair.post, term)) return false;
  return norm(pair.pre) !== norm(pair.post);
}

export interface GeneratedAssessment {
  payload: StoredAssessmentPayload;
  itemCount: number;
  /** Concepts the model wrote unusable stems for. Logged, not surfaced. */
  rejected: number;
}

/**
 * Write both forms for one material.
 *
 * Throws `AssessmentGenerationError` when the material cannot carry a test, and
 * lets `GeminiUnavailableError` pass through untouched so the route can map 429
 * (daily quota) and 503 (outage) separately from a 502 — the same contract
 * `generateTestQuestions()` has with `failGeneration()`.
 */
export async function generateAssessment(
  concepts: ConceptForAssessment[],
  materialTitle: string
): Promise<GeneratedAssessment> {
  if (concepts.length < ASSESSMENT_MIN_ITEMS) {
    throw new AssessmentGenerationError(
      `This material has ${concepts.length} concept${concepts.length === 1 ? '' : 's'}. ` +
        `A pre/post test needs at least ${ASSESSMENT_MIN_ITEMS}, because every question offers ` +
        `${ASSESSMENT_OPTIONS_PER_ITEM} different terms to choose from.`
    );
  }

  const started = Date.now();
  const pool = selectConcepts(concepts, Math.min(concepts.length, ASSESSMENT_MAX_ITEMS + SPARE));
  const stems = await writeStems(pool, materialTitle);

  // Keep only usable pairs, then RE-SPREAD. Taking the first 20 survivors in
  // document order would undo the stride sampling and bias the test toward the
  // front of the lesson exactly when the model has been fussy about the back.
  const usable = pool.filter((c, i) => validPair(stems.get(i), c.term));
  const rejected = pool.length - usable.length;
  const chosen = selectConcepts(usable, ASSESSMENT_MAX_ITEMS);

  const items: StoredAssessmentItem[] = [];
  for (const concept of chosen) {
    const pair = stems.get(pool.indexOf(concept));
    if (!pair) continue;

    const distractors = pickDistractors(concept, concepts, [pair.pre, pair.post], hash(items.length + 1));
    if (distractors.length < ASSESSMENT_OPTIONS_PER_ITEM - 1) continue;

    const options = [concept.term, ...distractors];
    items.push({
      index: items.length,
      concept_id: concept.id,
      concept_term: concept.term,
      pre_stem: shorten(pair.pre, 300),
      post_stem: shorten(pair.post, 300),
      options_pre: seededShuffle(options, SEED_PRE + items.length),
      options_post: seededShuffle(options, SEED_POST + items.length),
      answer: concept.term,
    });
  }

  if (items.length < ASSESSMENT_MIN_ITEMS) {
    throw new AssessmentGenerationError(
      `Only ${items.length} usable question${items.length === 1 ? '' : 's'} could be written from ` +
        `this material's ${concepts.length} concepts. Nothing was saved. This usually means the ` +
        `definitions are too short or too similar to tell apart — try again, and if it repeats, ` +
        `edit the concepts on the Concepts tab first.`
    );
  }

  console.log(
    `[Assessment] ${items.length} items (${rejected} rejected) — "${materialTitle}" in ${(
      (Date.now() - started) / 1000
    ).toFixed(1)}s`
  );

  return { payload: { version: 1, items }, itemCount: items.length, rejected };
}
