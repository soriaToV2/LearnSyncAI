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
