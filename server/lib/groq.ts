import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GROQ_API_KEY is not set. AI flashcard generation will fail.');
}

const groq = new Groq({ apiKey: apiKey ?? '' });

/** A single concept pulled from the concepts table */
export interface ConceptInput {
  term: string;
  definition: string;
}

/** The shape of a single generated flashcard */
export interface GeneratedFlashcard {
  front: string;
  back: string;
}

/** The full payload Groq returns for flashcard generation */
export interface FlashcardGenerationResult {
  title: string;
  description: string;
  cards: GeneratedFlashcard[];
}

/**
 * Generates flashcards from a list of pre-extracted concepts using
 * Groq's llama-3.3-70b-versatile model (free tier).
 *
 * Uses JSON mode to ensure a valid, parseable response.
 *
 * @param concepts   Array of { term, definition } objects from the concepts table
 * @param format     'question' for question-style front, 'term' for just the term on front
 * @returns          Parsed flashcard generation result with title, description, and cards[]
 */
export async function generateFlashcardsFromConcepts(
  concepts: ConceptInput[],
  format: 'question' | 'term' = 'question'
): Promise<FlashcardGenerationResult> {
  // Build a numbered concept list for the prompt
  const conceptList = concepts
    .map((c, i) => `${i + 1}. Term: "${c.term}" — Definition: ${c.definition}`)
    .join('\n');

  const formatRules = format === 'question' 
    ? `- FRONT: A clear, concise question or prompt about the concept (not the term itself)
- BACK: The accurate, direct answer (2–4 sentences max, plain language)
- Avoid trivial or overly obvious questions
- Questions should test understanding, not just recall`
    : `- FRONT: Just the exact term of the concept (e.g. "Cybercrime")
- BACK: A clear, concise, and accurate definition or explanation of the term (2–4 sentences max, plain language)
- Do not phrase the front as a question.`;

  const prompt = `You are an expert study tool designed to help students learn more effectively.

Given the following list of academic concepts and their definitions, generate exactly one high-quality flashcard for EACH concept in the list. This means you will generate exactly ${concepts.length} flashcards in total.

Each flashcard must follow these rules:
${formatRules}

Also generate a short, descriptive title for this flashcard set and a 1-sentence description of what it covers.

Respond ONLY with a valid JSON object using this EXACT format (no markdown, no extra text):
{
  "title": "<concise descriptive title for the flashcard set>",
  "description": "<one sentence summarizing what these flashcards cover>",
  "cards": [
    { "front": "<question or prompt>", "back": "<answer>" }
  ]
}

Concepts to use:
${conceptList}`;

  const chatCompletion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const rawText = chatCompletion.choices[0]?.message?.content;
  if (!rawText) {
    throw new Error('Groq returned an empty response for flashcard generation.');
  }

  let parsed: FlashcardGenerationResult;
  try {
    parsed = JSON.parse(rawText) as FlashcardGenerationResult;
  } catch {
    throw new Error(`Failed to parse Groq JSON response: ${rawText.slice(0, 200)}`);
  }

  // Validate the parsed shape minimally
  if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    throw new Error('Groq response did not contain a valid cards array.');
  }

  return parsed;
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
