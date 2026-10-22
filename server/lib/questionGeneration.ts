import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';

/**
 * Writes flashcard fronts (questions). The model never writes the back: that is the educator's
 * definition, verbatim. It echoes an item number (range-checked), never a concept id.
 * A skipped concept is simply absent; the caller falls back to its term.
 */

/** `id` is the concepts row id. */
export interface ConceptForQuestion {
  id: string;
  term: string;
  definition: string;
}

/** Don't raise this to fit a whole material in one call; large batches truncate. */
const QUESTION_BATCH_SIZE = 20;

/** Rephrasing, not reasoning, so MINIMAL. */
const THINKING = ThinkingLevel.MINIMAL;

/** Generous because thinking tokens count against it. */
const MAX_OUTPUT_TOKENS = 4096;

/** Structure only; `n` is range-checked below. */
const QUESTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER },
          question: { type: Type.STRING },
        },
        required: ['n', 'question'],
        propertyOrdering: ['n', 'question'],
      },
    },
  },
  required: ['questions'],
};

interface QuestionEcho {
  n?: unknown;
  question?: unknown;
}

/**
 * One question per concept, keyed by concept id. Throws only when a model call fails, so the
 * route writes nothing rather than a mixed deck.
 */
export async function generateQuestionsForConcepts(
  concepts: ConceptForQuestion[]
): Promise<Map<string, string>> {
  const startedAt = Date.now();
  const questions = new Map<string, string>();
  let batchCount = 0;

  for (let start = 0; start < concepts.length; start += QUESTION_BATCH_SIZE) {
    const batch = concepts.slice(start, start + QUESTION_BATCH_SIZE);
    batchCount++;

    // Definitions go in whole: the question must be answered by the exact text on the card's back.
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

    let parsed: { questions?: QuestionEcho[] };
    try {
      parsed = await generateJson<{ questions?: QuestionEcho[] }>(prompt, {
        model: GEMINI_CONTENT_MODEL,
        thinkingLevel: THINKING,
        responseSchema: QUESTION_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (err) {
      // Rethrow typed failures unwrapped so the route can answer 429 vs 503.
      if (err instanceof GeminiUnavailableError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Flashcard question generation failed on batch ${batchCount}: ${reason}`);
    }

    for (const item of parsed?.questions ?? []) {
      const n = Number(item?.n);
      // Drop out-of-range echoes rather than attach a question to the wrong concept.
      if (!Number.isInteger(n) || n < 1 || n > batch.length) continue;
      const text = typeof item?.question === 'string' ? item.question.trim() : '';
      if (!text) continue;
      questions.set(batch[n - 1].id, text);
    }
  }

  console.log(
    `[Questions] ${questions.size} written for ${concepts.length} concepts in ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s (${batchCount} batch${batchCount === 1 ? '' : 'es'})`
  );

  return questions;
}
