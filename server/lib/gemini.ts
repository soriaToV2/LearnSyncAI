import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY is not set. AI features (embeddings, generation) will fail.');
}

const genai = new GoogleGenAI({ apiKey: apiKey ?? '' });

/** Upstream statuses Google documents as transient — worth retrying. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class GeminiUnavailableError extends Error {
  readonly status = 503;
  constructor(message = 'The AI service is temporarily overloaded. Please try again in a moment.') {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') return RETRYABLE_STATUSES.has(status);
  // Some SDK errors only carry the status inside the message payload.
  const message = (err as { message?: string })?.message ?? '';
  return /\b(429|500|502|503|504)\b/.test(message) || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries a Gemini call on transient upstream failures (503 overloaded, 429 rate
 * limited, 5xx). Uses exponential backoff with jitter to avoid a thundering herd.
 *
 * Non-transient errors (bad API key, malformed prompt) are rethrown immediately —
 * retrying those just wastes the user's time.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;

      // 1s, 2s, 4s ... plus up to 250ms of jitter
      const backoff = 1000 * 2 ** (attempt - 1) + Math.random() * 250;
      console.warn(
        `[Gemini] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(backoff)}ms`
      );
      await sleep(backoff);
    }
  }

  if (isRetryable(lastError)) throw new GeminiUnavailableError();
  throw lastError;
}

/**
 * Generates an embedding vector for the given text.
 * Uses the `gemini-embedding-001` model (3072 dimensions) — matches the
 * vector(3072) column in the concepts table. Do not change the model: all stored
 * vectors depend on it.
 *
 * @param text - The text to embed
 * @returns A float array of 3072 dimensions
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await withRetry(
    () =>
      genai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      }),
    'generateEmbedding'
  );

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
  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      }),
    'generateContent'
  );

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate content: empty response from Gemini API');
  }
  return text;
}

export interface GenerateJsonOptions {
  /**
   * Sampling temperature. Omit to use Gemini's default (some variation between
   * identical calls). Pass 0 for reproducible output — required when the result
   * is a score a student sees, so an identical submission can't be graded
   * differently on a resubmit.
   */
  temperature?: number;
}

/**
 * Generates structured JSON content using Gemini 2.5 Flash.
 * Configures the model to output valid JSON for parsing.
 *
 * @param prompt - The prompt (should instruct the model to return JSON)
 * @param options - Optional sampling controls. Defaults preserve prior behaviour.
 * @returns Parsed JavaScript object/array
 */
export async function generateJson<T = unknown>(
  prompt: string,
  options: GenerateJsonOptions = {}
): Promise<T> {
  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          // Only send `temperature` when the caller asked for it, so existing
          // callers keep Gemini's default sampling untouched.
          ...(options.temperature !== undefined && { temperature: options.temperature }),
        },
      }),
    'generateJson'
  );

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
  const response = await withRetry(
    () =>
      genai.models.generateContent({
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
      }),
    'generateJsonFromDocument'
  );

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
