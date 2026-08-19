import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, GeminiUnavailableError, GEMINI_CONTENT_MODEL } from './gemini';

/**
 * Writing the QUESTION side of study flashcards.
 *
 * THE MODEL WRITES THE FRONT AND ONLY THE FRONT. The back of every card is the
 * educator's stored definition, verbatim — an earlier helper had the model
 * rewrite that too, which put text nobody vetted in front of students. Here the
 * definition is handed over as a fixed answer and the model writes a prompt for
 * it, so the AI adds pedagogy without touching the facts.
 *
 * THE MODEL NEVER SEES OR RETURNS A CONCEPT ID. It echoes the item's number
 * within its batch, and that number is range-checked before it is trusted. The
 * shape this replaced returned bare {front, back} pairs with no route back to a
 * `concept_id`, which is exactly what BKT needs — and a mis-attached id is the
 * worst failure available here, because the card still looks valid and nothing
 * downstream can detect it.
 *
 * A concept the model skips is simply absent from the returned map. That is not
 * an error: the caller falls back to the concept's term, so a card is never lost
 * and never left unlinked.
 *
 * Lived in `groq.ts` until 2026-08-19, on the decommissioned
 * `llama-3.3-70b-versatile`. It moved out rather than merely off Groq because
 * `groq.ts` is deleted at the end of this migration.
 */

/** A concept to write a question for. `id` is the concepts row id. */
export interface ConceptForQuestion {
  id: string;
  term: string;
  definition: string;
}

/**
 * Concepts per model call.
 *
 * TWENTY, MEASURED — do not raise it to fit a whole material in one call. That
 * is what the original helper did, under a 4096-token ceiling, and it truncated
 * on any real material: live data averages 33 concepts and reaches 42, so this
 * is 2–3 batches. Truncation surfaces as unparseable JSON, which aborts the
 * whole deck.
 */
const QUESTION_BATCH_SIZE = 20;

/**
 * Nothing here reasons. The model rephrases a definition it has been given into
 * a question — the facts are fixed, the answer is fixed, and no judgement of its
 * becomes a number a student is shown. Measured, `gemini-3.6-flash` runs ~2s at
 * MINIMAL against 5–20s at LOW, and thinking tokens bill at the OUTPUT rate.
 */
const THINKING = ThinkingLevel.MINIMAL;

/**
 * Output ceiling per batch of up to `QUESTION_BATCH_SIZE` questions.
 *
 * DOUBLED from Groq's 2048 rather than ported across. MINIMAL thinking is not
 * *no* thinking, and Gemini 3 thinking tokens draw on `maxOutputTokens` — a
 * budget sized for the visible output alone comes back with
 * `finishReason=MAX_TOKENS` and no text at all, which `generateJson()` throws on
 * and the route turns into a failed deck. A ceiling is not a reservation, so
 * headroom that goes unused is free.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Pins the response shape. STRUCTURE ONLY, and the distinction is load-bearing:
 * a schema cannot express "n is inside this batch", so the range check below
 * stays exactly as it was written for Groq, which had no schema at all. Pinning
 * the shape removes a failure mode; it removes no validation.
 */
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
 * Writes one question per concept, keyed by concept id.
 *
 * A concept missing from the result is not an error — the caller uses its term
 * as the card front instead. Throws only when the model call itself fails, which
 * the route treats as "write nothing and let them retry" rather than saving a
 * deck of mixed quality.
 *
 * NO `temperature`. Gemini 3 dropped the sampling parameters and `generateJson()`
 * strips one loudly if passed. The 0.3 that used to sit here was justified as
 * keeping a Refresh from "rewording every card gratuitously" — be plain about the
 * fact that this guarantee is gone: two generations over the same concept will
 * phrase its question differently, and there is no knob left to prevent it. That
 * costs the student nothing, because a Refresh reconciles by `concept_id` and
 * updates cards in place: the front's wording changes, while `next_review_at`,
 * the rating history and the card's link to its concept all survive.
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

    // Definitions go in WHOLE — deliberately uncapped, unlike testGeneration.ts.
    // There the model writes *about* a concept; here it must write a question
    // whose answer is this exact text, which the student then reads verbatim on
    // the back of the card. A truncated definition yields a question that only
    // part of the answer answers.
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
      // A typed Gemini failure passes through UNTOUCHED, so the route can tell a
      // spent daily quota (429) from an outage (503). Wrapping it in a plain
      // Error collapses both into "could not be reached — please try again",
      // which is simply false once the day's allowance is gone.
      if (err instanceof GeminiUnavailableError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Flashcard question generation failed on batch ${batchCount}: ${reason}`);
    }

    for (const item of parsed?.questions ?? []) {
      const n = Number(item?.n);
      // Range-checked: a hallucinated or out-of-range number is dropped rather
      // than attaching a question to the wrong concept.
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
