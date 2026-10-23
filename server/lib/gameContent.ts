import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';
import type { DifficultyTier } from './testAllocation';
import { TIER_GUIDANCE } from './testDifficulty';
import { balancedSlots } from './answerPlacement';
import {
  CROSSWORD_TIER_RULES,
  MATCH_TIER_RULES,
  TRIVIA_TIER_RULES,
  TRIVIA_QUESTION_MS,
} from './gameDifficulty';

/**
 * Game content generation: term matching, timed trivia, crossword.
 * The tier is derived server-side from M_doc (paper p. 83) and reaches the model as prompt text.
 * Each prompt states the tier three times (framing, focus, operative bullets); the wording was
 * tuned against measured failures, see GAMES_CALIBRATION_IMPLEMENTATION.md before changing it.
 * Games never write mastery: ConceptInput has no `id`.
 */

export interface ConceptInput {
  term: string;
  definition: string;
}

/** Matches frontend TermItem. */
export interface GeneratedTerm {
  term: string;
  definition: string;
}

/** Matches frontend Question. */
export interface GeneratedTrivia {
  question: string;
  options: string[];
  correct: string;
}

/** The grid layout is computed separately in code. */
export interface GeneratedCrosswordWord {
  answer: string;
  clue: string;
}

/** Numbered concept list for prompts. Order is meaningful (weakest first); don't sort or shuffle. */
function conceptListOf(concepts: ConceptInput[]): string {
  return concepts.map((c, i) => `${i + 1}. Term: "${c.term}" — Definition: ${c.definition}`).join('\n');
}

/** Spends the SELECT_BUFFER surplus on the concepts the student most needs. */
const ORDERING_RULE =
  'When two candidates are equally suitable, prefer the one listed EARLIER — the concepts are ' +
  'ordered by what this student most needs to practise.';

/** Nothing here reasons, so MINIMAL thinking. */
const THINKING = ThinkingLevel.MINIMAL;

/** Small payloads, so these leave ample headroom. */
const MAX_OUTPUT_TOKENS = {
  term_matcher: 2048,
  timed_trivia: 4096,
  crossword: 3072,
} as const;

/** Response shapes. Structure only; value checks stay in each generator. */
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

/** One timed model call. Typed Gemini failures are rethrown unwrapped so the route can answer 429 vs 503. */
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

function logGame(gameType: string, tier: DifficultyTier, count: number, elapsedMs: number): void {
  console.log(
    `[Games] ${gameType} ${tier} — ${count} item${count === 1 ? '' : 's'} in ` +
      `${(elapsedMs / 1000).toFixed(1)}s`
  );
}

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

const OPTIONS_PER_QUESTION = 4;

/**
 * Re-places each correct answer, discarding the model's ordering (it favours A).
 * Splice by index, never filter by value: options aren't guaranteed distinct.
 * Exported for the balance check in scripts/.
 */
export function placeAnswers(items: GeneratedTrivia[]): GeneratedTrivia[] {
  // Balanced, shuffled, Math.random(): games must not be reproducible (see answerPlacement.ts).
  const slots = balancedSlots(items.length, OPTIONS_PER_QUESTION);
  return items.map((q, i) => {
    const options = [...q.options];
    options.splice(options.indexOf(q.correct), 1);
    options.splice(slots[i], 0, q.correct);
    return { ...q, options };
  });
}

export async function generateTrivia(
  concepts: ConceptInput[],
  count = 6,
  tier: DifficultyTier = 'foundational'
): Promise<GeneratedTrivia[]> {
  const rules = TRIVIA_TIER_RULES[tier];
  const seconds = Math.round(TRIVIA_QUESTION_MS[tier] / 1000);
  // Word budget stated as a target, not a ceiling; as a ceiling the model wrote trivially short questions.
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
- The correct answer must not stand out by SHAPE — match its length and level of detail to the other three, so it cannot be picked out without reading them.
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
  const placed = placeAnswers(trivia);
  logGame('timed_trivia', tier, placed.length, elapsedMs);
  return placed;
}

/** Crossword answer/clue candidates. buildCrossword() lays out the grid; the model never assigns coordinates. */
export async function generateCrosswordWords(
  concepts: ConceptInput[],
  tier: DifficultyTier = 'foundational'
): Promise<GeneratedCrosswordWord[]> {
  const rules = CROSSWORD_TIER_RULES[tier];

  // Keep the A–Z / 3–10 letter and no-abbreviation rules tier-independent and right after
  // "answer": they keep the puzzle buildable.
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
