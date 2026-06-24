import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY is not set. AI features (embeddings, generation) will fail.');
}

const genai = new GoogleGenAI({ apiKey: apiKey ?? '' });

/**
 * Generates a 768-dimensional embedding vector for the given text.
 * Uses the `text-embedding-004` model — matches the vector(768) column in the concepts table.
 *
 * @param text - The text to embed
 * @returns A float array of 768 dimensions
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await genai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
  });

  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error('Failed to generate embedding: empty response from Gemini API');
  }
  return values;
}

/**
 * Generates text content using Gemini 2.0 Flash.
 *
 * @param prompt - The prompt to send to the model
 * @returns The generated text string
 */
export async function generateContent(prompt: string): Promise<string> {
  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate content: empty response from Gemini API');
  }
  return text;
}

/**
 * Generates structured JSON content using Gemini 2.0 Flash.
 * Configures the model to output valid JSON for parsing.
 *
 * @param prompt - The prompt (should instruct the model to return JSON)
 * @returns Parsed JavaScript object/array
 */
export async function generateJson<T = unknown>(prompt: string): Promise<T> {
  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate JSON content: empty response from Gemini API');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text}`);
  }
}

/**
 * Generates structured JSON content using Gemini 2.0 Flash from a document.
 * Configures the model to output valid JSON for parsing, passing the document as inlineData.
 *
 * @param prompt - The instructions for extraction.
 * @param mimeType - The mime type of the file (e.g. 'application/pdf').
 * @param base64Data - The raw file data encoded as a base64 string.
 * @returns Parsed JavaScript object/array
 */
export async function generateJsonFromDocument<T = unknown>(
  prompt: string,
  mimeType: string,
  base64Data: string
): Promise<T> {
  // @google/genai v1.x requires a single content object with a `parts` array
  // for multimodal requests (text instruction + inlineData file).
  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate JSON content: empty response from Gemini API');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text}`);
  }
}

export { genai };
