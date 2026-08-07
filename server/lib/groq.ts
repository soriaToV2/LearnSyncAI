import Groq from 'groq-sdk';
import { createHash } from 'node:crypto';

/**
 * Read ONCE, at module load. That is normal, but it makes swapping the key in
 * `.env` a silent no-op until the server restarts — the process keeps the old
 * one and keeps reporting the old account's exhausted quota, which reads as "my
 * new key doesn't work". `npm run dev:server` now watches `.env` so the restart
 * happens on its own; the fingerprint below is here so the log says which key
 * is actually live rather than leaving you to infer it.
 */
const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GROQ_API_KEY is not set. AI question and game generation will fail.');
} else {
  // Never the secret itself — enough to tell two keys apart in a log.
  const fingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
  console.log(`[Groq] key loaded — fingerprint ${fingerprint}`);
}

const groq = new Groq({ apiKey: apiKey ?? '' });

/** A single concept pulled from the concepts table */
export interface ConceptInput {
  term: string;
  definition: string;
}

// ──────────────────────────────────────────────────────────────
// Failure classification
//
// Groq calls had no typed error and no retry at all, so every upstream failure
// arrived at a route as a raw `Groq.APIError` and left as a generic 502 —
// flagged in games.routes.ts, freeRecallImplementationPlan.md and
// feynmanImplementationPlan.md without ever being fixed. A rate limit reported
// as "generation failed" tells a student to retry immediately, which is the one
// thing guaranteed not to work.
//
// This mirrors the Gemini layer in gemini.ts deliberately, down to the class
// shape, so a route can handle both with the same `err.status` branch.
//
// Note the division of labour: groq-sdk already retries 429 and 5xx twice
// internally, honouring Retry-After. What was missing is CLASSIFYING the final
// failure and carrying its status out, so that is all this adds — no second
// retry loop on top of the SDK's.
// ──────────────────────────────────────────────────────────────

export class GroqUnavailableError extends Error {
  readonly status: number;
  /** Seconds the upstream asked us to wait, when it said. */
  readonly retryAfterSeconds?: number;

  constructor(
    message = 'The question writer is temporarily unavailable. Please try again in a moment.',
    options: { status?: number; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'GroqUnavailableError';
    this.status = options.status ?? 503;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/**
 * Rate limited. Extends GroqUnavailableError so one `instanceof` catches both,
 * but answers 429 so the client can tell "wait and retry" from "it broke".
 */
export class GroqRateLimitError extends GroqUnavailableError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, { status: 429, retryAfterSeconds });
    this.name = 'GroqRateLimitError';
  }
}

/**
 * Groq refuses on two different clocks and only one of them recovers by itself.
 *
 *   TPM — tokens per minute (12,000). Clears in seconds. Worth retrying.
 *   TPD — tokens per DAY (100,000). Does not clear until the daily reset.
 *         Retrying spends four attempts and seven seconds to fail anyway, and
 *         tells the student "try again in a moment" when the truth is "not
 *         today".
 *
 * Groq names the window in the message — "on tokens per day (TPD)" — so the two
 * are distinguishable. Mirrors `classifyFailure()` in gemini.ts, which splits
 * per-minute from per-day for exactly this reason.
 */
function isDailyExhaustion(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(TPD|RPD)\b|per\s*day/i.test(message);
}

function upstreamStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * How long Groq wants us to wait, in ms.
 *
 * It says so in two places and neither is guaranteed: a `retry-after` header,
 * and prose inside the error body — "Please try again in 1.23s". The prose form
 * is the one that actually shows up on a tokens-per-minute refusal, so parse it
 * too rather than falling back to a blind backoff that overshoots by 10×.
 */
function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: Record<string, string> })?.headers;
  const header = Number(headers?.['retry-after'] ?? headers?.['Retry-After']);
  if (Number.isFinite(header) && header > 0) return header * 1000;

  const message = err instanceof Error ? err.message : String(err);
  const prose = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(message);
  if (prose) {
    const value = Number(prose[1]);
    if (Number.isFinite(value)) return prose[2].toLowerCase() === 'ms' ? value : value * 1000;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Never sit on a request longer than this waiting for a window to clear. */
const MAX_RETRY_WAIT_MS = 20_000;
const MAX_ATTEMPTS = 4;

/**
 * Wraps a Groq call so its failures arrive typed, and retries the ones that
 * recover on their own.
 *
 * WHY THE RETRY EARNS ITS KEEP: Groq's free tier caps TOKENS PER MINUTE (12,000
 * on `llama-3.3-70b-versatile`), not requests per day. A single 29-question test
 * is most of that budget, so two students generating within the same minute is
 * enough to refuse the second — and the refusal names its own wait, usually
 * one or two seconds. Failing outright on a one-second wait would be throwing
 * away a test the student can have.
 *
 * This does NOT make the free tier sufficient for fifty simultaneous students.
 * It converts the common case — a few overlapping requests — from an error into
 * a short pause, and leaves the genuine capacity problem visible as a 429 when
 * the queue is truly too deep.
 *
 * A missing API key is caught up front rather than as an opaque 401, because
 * "invalid api key" sends people looking in the wrong place.
 */
export async function withGroq<T>(fn: () => Promise<T>, label: string): Promise<T> {
  if (!apiKey) {
    throw new GroqUnavailableError(
      'GROQ_API_KEY is not configured on the server, so questions cannot be written.',
      { status: 503 }
    );
  }

  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = upstreamStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      const daily = status === 429 && isDailyExhaustion(err);
      const retryable = !daily && (status === 429 || (status !== undefined && status >= 500));

      console.warn(
        `[Groq] ${label} attempt ${attempt}/${MAX_ATTEMPTS} — HTTP ${status ?? '?'}` +
          `${daily ? ' [daily quota]' : ''}: ${message.slice(0, 200)}`
      );

      // The daily allowance is spent. Nothing about waiting fixes it, so say so
      // once rather than backing off four times into the same wall.
      if (daily) {
        throw new GroqRateLimitError(
          "The question writer's daily limit has been reached, so no more tests can be " +
            'written today. It resets on a daily cycle.'
        );
      }

      // 4xx other than 429, or no status at all: a bug or a bad key, not a wait.
      if (!retryable) throw err;
      if (attempt === MAX_ATTEMPTS) break;

      const suggested = retryAfterMs(err);
      // Groq's own hint when it gives one, plus a little slack so the window has
      // definitely rolled; otherwise 1s, 2s, 4s with jitter.
      const wait = Math.min(
        suggested !== undefined ? suggested + 400 : 1000 * 2 ** (attempt - 1) + Math.random() * 250,
        MAX_RETRY_WAIT_MS
      );
      console.warn(`[Groq] ${label} retrying in ${Math.round(wait)}ms${suggested ? ' (server-suggested)' : ''}`);
      await sleep(wait);
    }
  }

  const status = upstreamStatus(lastErr);
  if (status === 429) {
    const after = retryAfterMs(lastErr);
    throw new GroqRateLimitError(
      'Too many tests are being written at once. Please wait a moment and try again.',
      after ? Math.ceil(after / 1000) : undefined
    );
  }
  throw new GroqUnavailableError(
    `The question writer is temporarily unavailable (HTTP ${status ?? '5xx'}). Please try again in a moment.`,
    { status: 503 }
  );
}

// ──────────────────────────────────────────────────────────────
// Flashcard question generation
//
// The model writes the QUESTION only. The answer on the back of every card is
// the educator's stored definition, verbatim — the earlier helper had the model
// rewrite that too, which put text nobody vetted in front of students. Here the
// definition is passed in as the fixed answer and the model writes a prompt for
// it, so the AI adds pedagogy without touching the facts.
//
// Two failure modes the old helper had, addressed here:
//   * Truncation. It asked for one card per concept under max_tokens: 4096, and
//     a real material has ~68 concepts. This batches instead.
//   * Lost linkage. It returned bare {front, back} with no way back to a
//     concept_id, which is exactly what BKT needs. Here the model echoes each
//     concept's number in its batch, every echo is range-checked, and anything
//     unmatched is simply absent from the returned map — the caller falls back
//     to the term for those, so a card is never lost and never unlinked.
// ──────────────────────────────────────────────────────────────

/** A concept to write a question for. `id` is the concepts row id. */
export interface ConceptForQuestion {
  id: string;
  term: string;
  definition: string;
}

/** Concepts per Groq call. 20 × ~30 tokens of question leaves ample headroom. */
const QUESTION_BATCH_SIZE = 20;

/**
 * Writes one question per concept, keyed by concept id.
 *
 * A concept missing from the result is not an error — the caller uses its term
 * as the card front instead. Throws only when a Groq call itself fails, which
 * the route treats as "write nothing and let them retry" rather than saving a
 * deck of mixed quality.
 */
export async function generateQuestionsForConcepts(
  concepts: ConceptForQuestion[]
): Promise<Map<string, string>> {
  const questions = new Map<string, string>();

  for (let start = 0; start < concepts.length; start += QUESTION_BATCH_SIZE) {
    const batch = concepts.slice(start, start + QUESTION_BATCH_SIZE);

    const list = batch
      .map((c, i) => `${i + 1}. Term: "${c.term}" — Answer: ${c.definition}`)
      .join('\n');

    const prompt = `You are writing the question side of study flashcards.

For each numbered item below you are given a term and the EXACT answer that will
appear on the back of its card. Write a question whose answer is that text.

Rules for each question:
- It must be fully answered by the given answer text — nothing more, nothing less.
- Name the term in the question. The student is being asked to explain it, so
  hiding the term makes the card unanswerable.
- Ask what it means, how it works, or why it matters — prefer understanding over
  a bare "define X".
- One sentence. No preamble, no "according to the text".
- Echo back the item's number in "n" so each question stays matched to its term.

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "questions": [
    { "n": 1, "question": "<question text>" }
  ]
}

Items:
${list}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      // Low but not zero: flashcards are not graded, so exact reproducibility is
      // not required, but a Refresh should not reword every card gratuitously.
      temperature: 0.3,
      max_tokens: 2048,
    });

    const parsed = parseGroqJson<{ questions: Array<{ n: number; question: string }> }>(
      completion.choices[0]?.message?.content
    );

    for (const item of parsed.questions ?? []) {
      const n = Number(item?.n);
      // Range-checked: a hallucinated or out-of-range number is dropped rather
      // than attaching a question to the wrong concept.
      if (!Number.isInteger(n) || n < 1 || n > batch.length) continue;
      const text = typeof item?.question === 'string' ? item.question.trim() : '';
      if (!text) continue;
      questions.set(batch[n - 1].id, text);
    }
  }

  return questions;
}

// ──────────────────────────────────────────────────────────────
// Game content generation (PlayMe module)
//
// Each helper takes pre-extracted concepts and returns strict JSON matching
// the frontend CourseGameData sub-shapes. `difficulty` tunes the prompt only —
// it is a seam for future BKT calibration and does not touch mastery scores.
// ──────────────────────────────────────────────────────────────

export type GameDifficulty = 'easy' | 'medium' | 'hard';

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
  difficulty: GameDifficulty;
}

/** A crossword answer + clue. The grid layout is computed separately in code. */
export interface GeneratedCrosswordWord {
  answer: string;
  clue: string;
}

const DIFFICULTY_GUIDANCE: Record<GameDifficulty, string> = {
  easy: 'Target foundational recall. Keep language simple and unambiguous.',
  medium: 'Target solid understanding. Mix straightforward and moderately challenging items.',
  hard: 'Target deep mastery. Favor nuanced, application-level items and subtle distractors.',
};

/** Builds the numbered concept list shared by every game prompt. */
function conceptListOf(concepts: ConceptInput[]): string {
  return concepts.map((c, i) => `${i + 1}. Term: "${c.term}" — Definition: ${c.definition}`).join('\n');
}

/** Parses a Groq JSON-mode response or throws a consistent, truncated error. */
function parseGroqJson<T>(rawText: string | null | undefined): T {
  if (!rawText) {
    throw new Error('Groq returned an empty response.');
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`Failed to parse Groq JSON response: ${rawText.slice(0, 200)}`);
  }
}

/**
 * Generates term/definition pairs for the Term Matching game.
 * Model: llama-3.1-8b-instant (simple selection/rewriting — fast and cheap).
 */
export async function generateTermMatches(
  concepts: ConceptInput[],
  count = 4,
  difficulty: GameDifficulty = 'medium'
): Promise<GeneratedTerm[]> {
  const prompt = `You are building a term-matching study game.

From the concepts below, select the ${count} best pairs and rewrite each as a concise, game-friendly card:
- "term": a short label (1–4 words), no trailing punctuation.
- "definition": one clear sentence (max ~18 words) that unambiguously matches its term.
${DIFFICULTY_GUIDANCE[difficulty]}
Every definition must be distinct enough that a student can match it to exactly one term.

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "terms": [
    { "term": "<short term>", "definition": "<one-sentence definition>" }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 2048,
  });

  const parsed = parseGroqJson<{ terms: GeneratedTerm[] }>(completion.choices[0]?.message?.content);
  const terms = (parsed.terms ?? []).filter(
    (t) => t && typeof t.term === 'string' && t.term.trim() && typeof t.definition === 'string' && t.definition.trim()
  );

  if (terms.length < 2) {
    throw new Error('Groq did not return enough valid term/definition pairs.');
  }
  return terms;
}

/**
 * Generates multiple-choice trivia questions for the Timed Trivia game.
 * Model: llama-3.3-70b-versatile (distractor quality matters).
 */
export async function generateTrivia(
  concepts: ConceptInput[],
  count = 6,
  difficulty: GameDifficulty = 'medium'
): Promise<GeneratedTrivia[]> {
  const prompt = `You are writing multiple-choice trivia questions for a timed study game.

Generate ${count} questions drawn from the concepts below.
Rules for EACH question:
- "options": EXACTLY 4 distinct answer choices.
- "correct": MUST be copied verbatim from one of the 4 options.
- The 3 wrong options must be plausible distractors (related to the topic, not obviously wrong).
- "difficulty": one of "easy", "medium", or "hard". Include a spread across tiers.
${DIFFICULTY_GUIDANCE[difficulty]}
- Questions must be self-contained (do not say "according to the text").

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "trivia": [
    {
      "question": "<question text>",
      "options": ["<a>", "<b>", "<c>", "<d>"],
      "correct": "<one of the options, verbatim>",
      "difficulty": "easy"
    }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const parsed = parseGroqJson<{ trivia: GeneratedTrivia[] }>(completion.choices[0]?.message?.content);
  const allowed: GameDifficulty[] = ['easy', 'medium', 'hard'];
  const trivia = (parsed.trivia ?? []).filter(
    (q) =>
      q &&
      typeof q.question === 'string' &&
      q.question.trim() &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.options.every((o) => typeof o === 'string' && o.trim()) &&
      typeof q.correct === 'string' &&
      q.options.includes(q.correct) &&
      allowed.includes(q.difficulty)
  );

  if (trivia.length === 0) {
    throw new Error('Groq did not return any valid trivia questions.');
  }
  return trivia;
}

/**
 * Generates crossword answer/clue candidates. The grid is laid out separately
 * by buildCrossword() in lib/crossword.ts — the model never assigns coordinates.
 * Model: llama-3.3-70b-versatile (concise clue writing).
 */
export async function generateCrosswordWords(
  concepts: ConceptInput[],
  difficulty: GameDifficulty = 'medium'
): Promise<GeneratedCrosswordWord[]> {
  const prompt = `You are creating clues for a crossword puzzle built from study material.

From the concepts below, produce 8–12 crossword entries.
Rules for EACH entry:
- "answer": a SINGLE, COMPLETE, real word, letters A–Z only (no spaces, digits, hyphens, or punctuation), 3–10 letters long.
- NEVER abbreviate, truncate, or invent a token to fit the length (e.g. do not shorten "VULNERABLE" to "VULNER"). If a concept's key word is longer than 10 letters, choose a different word the clue can point to instead.
- "clue": a concise definition-style clue that unambiguously points to the full answer word. Do NOT include the answer word in the clue.
${DIFFICULTY_GUIDANCE[difficulty]}
- Prefer answers that share letters with each other so they can interlock.

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{
  "words": [
    { "answer": "AXON", "clue": "The long projection of a neuron that carries impulses" }
  ]
}

Concepts:
${conceptListOf(concepts)}`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    temperature: 0.6,
    max_tokens: 3072,
  });

  const parsed = parseGroqJson<{ words: GeneratedCrosswordWord[] }>(completion.choices[0]?.message?.content);
  const words = (parsed.words ?? [])
    .map((w) => ({
      answer: typeof w?.answer === 'string' ? w.answer.toUpperCase().replace(/[^A-Z]/g, '') : '',
      clue: typeof w?.clue === 'string' ? w.clue.trim() : '',
    }))
    .filter((w) => w.answer.length >= 3 && w.answer.length <= 10 && w.clue);

  if (words.length < 2) {
    throw new Error('Groq did not return enough valid crossword words.');
  }
  return words;
}

/**
 * Streams a chat completion from Groq using llama-3.1-8b-instant.
 * Returns an async iterable of token chunks for SSE streaming to the client.
 *
 * @param messages   Full conversation (system + history + user message)
 * @returns          Async iterable stream of Groq chunks
 */
export async function streamChatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
) {
  return groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages,
    stream: true,
    temperature: 0.6,
    max_tokens: 2048,
  });
}

export { groq };
