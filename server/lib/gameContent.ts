import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';
import type { DifficultyTier } from './testAllocation';
import { TIER_GUIDANCE } from './testDifficulty';
import {
  CROSSWORD_TIER_RULES,
  MATCH_TIER_RULES,
  TRIVIA_TIER_RULES,
  TRIVIA_QUESTION_MS,
} from './gameDifficulty';

/**
 * Game content generation (PlayMe module) — term matching, timed trivia, crossword.
 *
 * Each helper takes pre-extracted concepts and returns strict JSON matching the
 * frontend CourseGameData sub-shapes. `tier` is derived server-side from the
 * student's M_doc (paper p. 83) and reaches the model as prompt text only —
 * nothing here touches mastery scores. See server/lib/gameDifficulty.ts.
 *
 * PLACEMENT IS THE WHOLE POINT OF THE PROMPT STRUCTURE BELOW. These prompts used
 * to carry one bare `DIFFICULTY_GUIDANCE` line buried mid-bullet-list, which is
 * exactly the placement testDifficulty.ts records as measured-failed: with the
 * tier only in a shared header, output came back byte-identical across tiers
 * because the specific imperative rules after it won. So each prompt states the
 * tier three times — the paper's framing as a standalone paragraph, a
 * game-specific focus paragraph, and the operative fields spliced onto the
 * bullets that actually decide the output.
 *
 * ⚠️ THE PROMPT TEXT IS LOAD-BEARING AND WAS TUNED OVER FOUR MEASURED FAILURES.
 * `gameDifficulty.ts` and `GAMES_CALIBRATION_IMPLEMENTATION.md` §7.2 record them:
 * pushing the difficulty into the QUESTION produced invented facts ("What does
 * Cross-Site Scripting *prevent*?" answered "Malicious script execution", which
 * XSS *causes*), then ungrammatical fragments, then subjectless stems naming no
 * concept at all; and stating trivia's reading budget one-sidedly collapsed
 * advanced to "What is XSS?", the EASIEST output of the three tiers. The
 * difficulty lives in the DISTRACTORS. Do not "improve" any of this.
 *
 * GAMES READ MASTERY AND NEVER WRITE IT (paper p. 58). Note what that looks like
 * here: `ConceptInput` carries no `id`, so a generated game has no route back to
 * a `concepts` row at all. `bkt_source` stays a two-value enum and nothing on
 * this path imports `server/lib/bkt.ts`.
 *
 * Lived in `groq.ts` until 2026-08-19, on `llama-3.1-8b-instant` and
 * `llama-3.3-70b-versatile` — both decommissioned 17 June 2026. These moved out
 * rather than merely off Groq because `groq.ts` is deleted at the end of this
 * migration.
 */

/** A single concept pulled from the concepts table. Deliberately no `id` — see above. */
export interface ConceptInput {
  term: string;
  definition: string;
}

/** A term/definition pair for the Term Matching game (matches frontend TermItem). */
export interface GeneratedTerm {
  term: string;
  definition: string;
}

/** A trivia question (matches frontend Question). */
export interface GeneratedTrivia {
  question: string;
  options: string[];
  correct: string;
}

/** A crossword answer + clue. The grid layout is computed separately in code. */
export interface GeneratedCrosswordWord {
  answer: string;
  clue: string;
}

/**
 * Builds the numbered concept list shared by every game prompt.
 *
 * THE ORDER IS MEANINGFUL. `pickConceptsByMastery()` sorts by how much the
 * student needs the practice, and every prompt tells the model to prefer items
 * listed earlier when it has to choose. Do not sort or shuffle this.
 */
function conceptListOf(concepts: ConceptInput[]): string {
  return concepts.map((c, i) => `${i + 1}. Term: "${c.term}" — Definition: ${c.definition}`).join('\n');
}

/** The one line every game prompt uses to spend the surplus in SELECT_BUFFER. */
const ORDERING_RULE =
  'When two candidates are equally suitable, prefer the one listed EARLIER — the concepts are ' +
  'ordered by what this student most needs to practise.';

/**
 * Nothing here reasons. The model rewrites definitions it has been handed into
 * cards, questions and clues; the tier it must write to is chosen server-side
 * from BKT, the timer is a table lookup, and the crossword grid is solved in
 * code. Measured, `gemini-3.6-flash` runs ~2s at MINIMAL against 5–20s at LOW,
 * and thinking tokens bill at the OUTPUT rate.
 */
const THINKING = ThinkingLevel.MINIMAL;

/**
 * Output ceilings, PORTED from the Groq budgets rather than doubled.
 *
 * ⚠️ This deliberately differs from `testGeneration.ts` and `questionGeneration.ts`,
 * which both doubled theirs on the way across. There the model writes twenty dense
 * items per batch and the visible output genuinely approaches the ceiling, so
 * MINIMAL thinking tokens — which draw on the same budget — could tip a call into
 * `finishReason=MAX_TOKENS`. A game is one small payload against a budget Groq
 * already sized generously: 4 term pairs ≈ 150 tokens against 2048, 10 trivia
 * items ≈ 900 against 4096, 12 crossword entries ≈ 350 against 3072. The headroom
 * the doubling buys is already here.
 *
 * If that ever stops being true, `describeEmptyResponse()` in `gemini.ts` names
 * the cause explicitly rather than reporting a bare empty response — raise the
 * one budget that hit it.
 */
const MAX_OUTPUT_TOKENS = {
  term_matcher: 2048,
  timed_trivia: 4096,
  crossword: 3072,
} as const;

/**
 * Pins each response shape. STRUCTURE ONLY, and the distinction is load-bearing:
 * a schema cannot express "exactly 4 options", "`correct` is one of them
 * verbatim", "the answer is 3–10 letters of A–Z" or the survivor floors below.
 * Every one of those checks stays exactly as it was written for Groq, which had
 * no schema at all. Pinning the shape removes a failure mode; it removes no
 * validation.
 *
 * The envelope names match what each prompt already asks for — `terms`, `trivia`,
 * `words` — so adding these changed no prompt text.
 */
const TERMS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING }, definition: { type: Type.STRING } },
        required: ['term', 'definition'],
        propertyOrdering: ['term', 'definition'],
      },
    },
  },
  required: ['terms'],
};

const TRIVIA_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    trivia: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correct: { type: Type.STRING },
        },
        required: ['question', 'options', 'correct'],
        propertyOrdering: ['question', 'options', 'correct'],
      },
    },
  },
  required: ['trivia'],
};

const WORDS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    words: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { answer: { type: Type.STRING }, clue: { type: Type.STRING } },
        required: ['answer', 'clue'],
        propertyOrdering: ['answer', 'clue'],
      },
    },
  },
  required: ['words'],
};

/**
 * One model call per game, timed.
 *
 * A typed Gemini failure passes through UNTOUCHED, so `games.routes.ts` can tell
 * a spent daily quota (429) from an outage (503). Wrapping it in a plain Error
 * collapses both into a generic 502 and tells a student to retry immediately on a
 * day when retrying cannot possibly work.
 *
 * NO `temperature`. The 0.6 / 0.7 / 0.6 that used to sit at these three call
 * sites are gone: Gemini 3 dropped the sampling parameters and `generateJson()`
 * strips one loudly if passed. Nothing is lost, because temperature was never
 * what made "Play Again" produce a different game — `pickConceptsByMastery()` is.
 * That is Efraimidis–Spirakis A-Res weighted sampling in `gameDifficulty.ts`,
 * which hands the model a genuinely different (and differently ordered) set of
 * concepts on every generation; its own comment records that a deterministic
 * weakest-first sort would rebuild a byte-identical game, which is the failure
 * replay variety actually guards against.
 */
async function askModel<T>(
  prompt: string,
  maxOutputTokens: number,
  responseSchema: Schema,
  label: string
): Promise<{ parsed: T; elapsedMs: number }> {
  const startedAt = Date.now();
  try {
    const parsed = await generateJson<T>(prompt, {
      model: GEMINI_CONTENT_MODEL,
      thinkingLevel: THINKING,
      responseSchema,
      maxOutputTokens,
    });
    return { parsed, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Game content generation failed on ${label}: ${reason}`);
  }
}

/** One line per generated game — the only place its cost is visible. */
function logGame(gameType: string, tier: DifficultyTier, count: number, elapsedMs: number): void {
  console.log(
    `[Games] ${gameType} ${tier} — ${count} item${count === 1 ? '' : 's'} in ` +
      `${(elapsedMs / 1000).toFixed(1)}s`
  );
}

/**
 * Generates term/definition pairs for the Term Matching game.
 */
export async function generateTermMatches(
  concepts: ConceptInput[],
  count = 4,
  tier: DifficultyTier = 'foundational'
): Promise<GeneratedTerm[]> {
  const rules = MATCH_TIER_RULES[tier];

  const prompt = `You are building a term-matching study game.

${TIER_GUIDANCE[tier]}

FOR THIS GAME SPECIFICALLY: ${rules.focus}

From the concepts below, ${rules.selection}, and rewrite ${count} of them as game-friendly cards:
- "term": a short label (1–4 words), no trailing punctuation.
- "definition": ${rules.definition}
- Keep every definition to one sentence of at most ~18 words.
- Every definition must be distinct enough that a student can match it to exactly one term.
- ${ORDERING_RULE}

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "terms": [
    { "term": "<short term>", "definition": "<one-sentence definition>" }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const { parsed, elapsedMs } = await askModel<{ terms: GeneratedTerm[] }>(
    prompt,
    MAX_OUTPUT_TOKENS.term_matcher,
    TERMS_SCHEMA,
    `term_matcher[${tier}]`
  );

  const terms = (parsed.terms ?? []).filter(
    (t) => t && typeof t.term === 'string' && t.term.trim() && typeof t.definition === 'string' && t.definition.trim()
  );

  if (terms.length < 2) {
    throw new Error('The game writer did not return enough valid term/definition pairs.');
  }
  logGame('term_matcher', tier, terms.length, elapsedMs);
  return terms;
}

/**
 * Generates multiple-choice trivia questions for the Timed Trivia game.
 */
export async function generateTrivia(
  concepts: ConceptInput[],
  count = 6,
  tier: DifficultyTier = 'foundational'
): Promise<GeneratedTrivia[]> {
  const rules = TRIVIA_TIER_RULES[tier];
  const seconds = Math.round(TRIVIA_QUESTION_MS[tier] / 1000);
  // A reading budget, stated as a TARGET rather than a ceiling. An earlier
  // version said only "the student has N seconds, anything they cannot finish
  // reading measures nothing" — and the model optimised the one thing it could
  // check, collapsing advanced to 2.5-word questions like "What is XSS?" with
  // two-word options: the EASIEST output of the three tiers. Time pressure has
  // to be two-sided or terseness becomes a way to comply with "make it hard".
  const budget = seconds * 4;

  const prompt = `You are writing multiple-choice trivia questions for a timed study game.

${TIER_GUIDANCE[tier]}

FOR THIS GAME SPECIFICALLY: ${rules.focus}

READING BUDGET: the student has ${seconds} seconds per question, which is room for about ${budget}
words across the question and its four options together. USE THAT ROOM — aim for roughly ${budget}
words, not far under it. Coming in short does not make a question harder; it makes it easier, and a
question a student can answer at a glance measures nothing.

Generate ${count} questions drawn from the concepts below.
Rules for EACH question:
- "question": ${rules.question}
- "options": EXACTLY 4 distinct answer choices. They ${rules.options}
- "correct": MUST be copied verbatim from one of the 4 options.
- Questions must be self-contained (do not say "according to the text").
- NEVER state a relationship a definition does not support. If a concept's definition does not say what it causes, prevents or costs, do not ask — and never answer — as though it did. A wrong fact taught confidently is worse than an easy question.
- ${ORDERING_RULE}

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "trivia": [
    {
      "question": "<question text>",
      "options": ["<a>", "<b>", "<c>", "<d>"],
      "correct": "<one of the options, verbatim>"
    }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const { parsed, elapsedMs } = await askModel<{ trivia: GeneratedTrivia[] }>(
    prompt,
    MAX_OUTPUT_TOKENS.timed_trivia,
    TRIVIA_SCHEMA,
    `timed_trivia[${tier}]`
  );

  const trivia = (parsed.trivia ?? []).filter(
    (q) =>
      q &&
      typeof q.question === 'string' &&
      q.question.trim() &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.options.every((o) => typeof o === 'string' && o.trim()) &&
      typeof q.correct === 'string' &&
      q.options.includes(q.correct)
  );

  if (trivia.length === 0) {
    throw new Error('The game writer did not return any valid trivia questions.');
  }
  logGame('timed_trivia', tier, trivia.length, elapsedMs);
  return trivia;
}

/**
 * Generates crossword answer/clue candidates. The grid is laid out separately
 * by buildCrossword() in lib/crossword.ts — the model never assigns coordinates.
 */
export async function generateCrosswordWords(
  concepts: ConceptInput[],
  tier: DifficultyTier = 'foundational'
): Promise<GeneratedCrosswordWord[]> {
  const rules = CROSSWORD_TIER_RULES[tier];

  // The two hard constraints below stay tier-INDEPENDENT and immediately after
  // the tier'd "answer" line, because they are what keeps the puzzle buildable:
  // words outside 3–10 letters are filtered out, buildCrossword() needs at least
  // two survivors, and the route throws on an empty layout. Advanced answers name
  // consequences and are the longest, so this is exactly where a 502 would come
  // from if the length rule got diluted by tier prose.
  const prompt = `You are creating clues for a crossword puzzle built from study material.

${TIER_GUIDANCE[tier]}

FOR THIS GAME SPECIFICALLY: ${rules.focus}

From the concepts below, produce 8–12 crossword entries.
Rules for EACH entry:
- "answer": ${rules.answer}
- The answer must be a SINGLE, COMPLETE, real word, letters A–Z only (no spaces, digits, hyphens, or punctuation), 3–10 letters long.
- NEVER abbreviate, truncate, or invent a token to fit the length (e.g. do not shorten "VULNERABLE" to "VULNER"). If the word you want is longer than 10 letters, choose a different word from the same concept that a clue can point to instead.
- "clue": ${rules.clue}
- Do NOT include the answer word in the clue.
- Prefer answers that share letters with each other so they can interlock.
- ${ORDERING_RULE}

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "words": [
    { "answer": "AXON", "clue": "The long projection of a neuron that carries impulses" }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const { parsed, elapsedMs } = await askModel<{ words: GeneratedCrosswordWord[] }>(
    prompt,
    MAX_OUTPUT_TOKENS.crossword,
    WORDS_SCHEMA,
    `crossword[${tier}]`
  );

  const words = (parsed.words ?? [])
    .map((w) => ({
      answer: typeof w?.answer === 'string' ? w.answer.toUpperCase().replace(/[^A-Z]/g, '') : '',
      clue: typeof w?.clue === 'string' ? w.clue.trim() : '',
    }))
    .filter((w) => w.answer.length >= 3 && w.answer.length <= 10 && w.clue);

  if (words.length < 2) {
    throw new Error('The game writer did not return enough valid crossword words.');
  }
  logGame('crossword', tier, words.length, elapsedMs);
  return words;
}
