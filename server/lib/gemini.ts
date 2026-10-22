import {
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type SchemaUnion,
  type ThinkingLevel,
} from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY is not set. AI features (embeddings, generation) will fail.');
}

const genai = new GoogleGenAI({ apiKey: apiKey ?? '' });

/*
 * Choosing a model for a new call site:
 *  1. Does the model's own judgement become a number the student is shown? → GEMINI_GRADING_MODEL.
 *  2. Otherwise, does the output become content a student reads as fact? → GEMINI_CONTENT_MODEL,
 *     else GEMINI_UTILITY_MODEL.
 * See CLAUDE.md § AI Services.
 */

/** Educator concept extraction. */
export const GEMINI_EXTRACTION_MODEL = 'gemini-3.6-flash';

/** Calls whose output is a score the student sees (Feynman grading). */
export const GEMINI_GRADING_MODEL = 'gemini-3.6-flash';

/** Mechanical calls: extraction and coaching prose. Separate model = separate per-model quota bucket. */
export const GEMINI_UTILITY_MODEL = 'gemini-3.5-flash-lite';

/**
 * Content a student reads as fact: test questions, game content, flashcard fronts.
 * Do not switch to gemini-3.7-flash: it rejects MINIMAL thinking. See CLAUDE.md § AI Services.
 */
export const GEMINI_CONTENT_MODEL = 'gemini-3.6-flash';

/** The RAG study assistant. */
export const GEMINI_CHAT_MODEL = 'gemini-3.5-flash-lite';

/** Gemini 3 dropped temperature/top_p/top_k; they must not be sent. */
const isGemini3 = (model: string): boolean => /^gemini-3/.test(model);

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

/** Longest server-suggested retry delay worth waiting for. */
const MAX_HONOURED_RETRY_DELAY_MS = 30_000;

const QUOTA_MAX_ATTEMPTS = 2;

const truncate = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface UpstreamError {
  status?: number;
  /** google.rpc status name, e.g. RESOURCE_EXHAUSTED. */
  reason?: string;
  message: string;
  retryAfterMs?: number;
  quotaMetric?: string;
  /** Quota rule id. Kept separate from quotaMetric because only this one names the window. */
  quotaId?: string;
  quotaLimit?: string;
}

/** The SDK puts the whole JSON error body in `.message`; parse the useful parts back out. */
function parseUpstreamError(err: unknown): UpstreamError {
  const rawStatus = (err as { status?: number })?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const raw = (err as { message?: string })?.message ?? String(err);

  let reason: string | undefined;
  let message = raw;
  let retryAfterMs: number | undefined;
  let quotaMetric: string | undefined;
  let quotaId: string | undefined;
  let quotaLimit: string | undefined;

  try {
    const body = JSON.parse(raw)?.error;
    if (body) {
      if (typeof body.status === 'string') reason = body.status;
      if (typeof body.message === 'string') message = body.message;
      for (const detail of body.details ?? []) {
        const type = String(detail?.['@type'] ?? '');
        if (type.endsWith('RetryInfo') && typeof detail.retryDelay === 'string') {
          const seconds = Number.parseFloat(detail.retryDelay);
          if (Number.isFinite(seconds)) retryAfterMs = Math.ceil(seconds * 1000);
        }
        if (type.endsWith('QuotaFailure')) {
          const violation = detail.violations?.[0];
          quotaMetric ??= violation?.quotaMetric;
          quotaId ??= violation?.quotaId;
          quotaLimit ??= violation?.quotaValue;
        }
      }
    }
  } catch {
    // Not JSON; fall through to the prose probes.
  }

  retryAfterMs ??= (() => {
    const m = /retry in ([\d.]+)\s*s/i.exec(message);
    return m ? Math.ceil(Number.parseFloat(m[1]) * 1000) : undefined;
  })();
  // Two upstream wordings; the `metric:` label is optional.
  quotaMetric ??= /Quota exceeded for (?:metric:\s*)?(\S+?)[,\s]/i.exec(message)?.[1];
  quotaLimit ??= /\blimit:\s*(\d+)/i.exec(message)?.[1];

  return { status, reason, message, retryAfterMs, quotaMetric, quotaId, quotaLimit };
}

type Failure = 'quota' | 'transient' | 'fatal';

const PER_MINUTE = /per[_-]?min/i;

/** A per-minute burst vs a spent allowance. No single field is reliable, so check all three. */
const isPerMinuteWindow = (e: UpstreamError): boolean =>
  PER_MINUTE.test(e.quotaId ?? '') ||
  PER_MINUTE.test(e.quotaMetric ?? '') ||
  PER_MINUTE.test(e.message);

/** Google sometimes reports capacity as a 429 with no quota metadata; that is transient. */
const OVERLOADED = /overload|high demand|experiencing[^.]{0,20}demand/i;

function classifyFailure(e: UpstreamError): Failure {
  if (e.status === 429 || e.reason === 'RESOURCE_EXHAUSTED') {
    if (OVERLOADED.test(e.message)) return 'transient';
    return isPerMinuteWindow(e) ? 'transient' : 'quota';
  }
  if (e.status !== undefined) return TRANSIENT_STATUSES.has(e.status) ? 'transient' : 'fatal';
  return /UNAVAILABLE|\b(500|502|503|504)\b/.test(e.message) ? 'transient' : 'fatal';
}

export class GeminiUnavailableError extends Error {
  readonly status: number;
  readonly upstream?: UpstreamError;
  /**
   * Text a student may read. `message` is operator detail and must never reach a student.
   * Must not name a key, project, billing, quota, metric, HTTP status or URL.
   */
  readonly userMessage: string;

  constructor(
    message = 'The AI service is temporarily unavailable. Please try again in a moment.',
    options: { status?: number; upstream?: UpstreamError; userMessage?: string } = {}
  ) {
    super(message);
    this.name = 'GeminiUnavailableError';
    this.status = options.status ?? 503;
    this.upstream = options.upstream;
    this.userMessage =
      options.userMessage ??
      'The study assistant is temporarily unavailable. Please try again in a moment.';
  }
}

/** Quota spent. Answers 429; retrying will not help. */
export class GeminiQuotaError extends GeminiUnavailableError {
  constructor(message: string, upstream?: UpstreamError, userMessage?: string) {
    super(message, { status: 429, upstream, userMessage });
    this.name = 'GeminiQuotaError';
  }
}

/** Operator text (logs, parse_error, educator pill). Never send to a student. */
function quotaMessage(e: UpstreamError): string {
  const metric = (e.quotaMetric ?? e.quotaId)?.split('/').pop();
  const detail = metric
    ? ` (${metric}${e.quotaLimit ? `, limit ${e.quotaLimit}` : ''})`
    : '';

  return isPerMinuteWindow(e)
    ? `Gemini refused the request: the per-minute rate limit for this key was exceeded${detail}. ` +
        'That window clears within a minute — it is a burst, not a spent allowance.'
    : `The Gemini API quota for this key is exhausted${detail}. ` +
        'Daily quotas reset on a 24-hour cycle — try again after the reset, or raise the ' +
        'limit on the Google Cloud project behind this API key.';
}

/** Student text for a failure: burst, outage, or spent for today. Derived from classifyFailure. */
function userFacingMessage(e: UpstreamError): string {
  if (classifyFailure(e) === 'quota') {
    return 'The study assistant has reached its limit for today. Trying again ' +
      'will not help right now — please tell your teacher.';
  }
  return isPerMinuteWindow(e)
    ? 'The study assistant is busy right now. Wait a few seconds and try again.'
    : 'The study assistant is having trouble right now. Please wait a moment and try again.';
}

/**
 * Boot-time check that GEMINI_API_KEY works. Uses the free models.list() call.
 * Keep it a live call, not a prefix/length check: two valid key formats are in use.
 */
export async function verifyGeminiCredential(): Promise<void> {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  try {
    await genai.models.list();
  } catch (err) {
    const e = parseUpstreamError(err);
    throw new Error(
      `HTTP ${e.status ?? '?'} ${e.reason ?? ''} — ${truncate(e.message, 200)}`.replace(/\s+/g, ' ')
    );
  }
}

/** What a student is told when an AI call fails. Student routes must send this, never `err.message`. */
export function studentFacingError(err: unknown): string {
  return err instanceof GeminiUnavailableError
    ? err.userMessage
    : 'The study assistant ran into a problem. Please try again in a moment.';
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries transient upstream failures, honouring the server's retry hint.
 * fatal → rethrown at once; quota → one retry then GeminiQuotaError;
 * transient → full backoff then GeminiUnavailableError.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  let lastParsed: UpstreamError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const parsed = parseUpstreamError(err);
      lastParsed = parsed;
      const kind = classifyFailure(parsed);

      console.warn(
        `[Gemini] ${label} attempt ${attempt}/${maxAttempts} failed — ` +
          `HTTP ${parsed.status ?? '?'} ${parsed.reason ?? ''} [${kind}]: ${truncate(parsed.message)}`
      );

      if (kind === 'fatal') break;

      const attemptCap = kind === 'quota' ? Math.min(QUOTA_MAX_ATTEMPTS, maxAttempts) : maxAttempts;
      if (attempt >= attemptCap) break;

      // Prefer Google's RetryInfo; otherwise exponential backoff with jitter.
      const suggested = parsed.retryAfterMs;
      const useSuggested = suggested !== undefined && suggested <= MAX_HONOURED_RETRY_DELAY_MS;
      const wait = useSuggested ? suggested! : 1000 * 2 ** (attempt - 1) + Math.random() * 250;

      console.warn(
        `[Gemini] ${label} retrying in ${Math.round(wait)}ms` +
          (useSuggested ? ' (server-suggested)' : '')
      );
      await sleep(wait);
    }
  }

  if (!lastParsed) throw lastError;

  switch (classifyFailure(lastParsed)) {
    case 'quota':
      throw new GeminiQuotaError(
        quotaMessage(lastParsed),
        lastParsed,
        userFacingMessage(lastParsed)
      );
    case 'transient':
      throw new GeminiUnavailableError(
        `The AI service is temporarily unavailable (HTTP ${lastParsed.status ?? '5xx'}). ` +
          'Please try again in a moment.',
        { upstream: lastParsed, userMessage: userFacingMessage(lastParsed) }
      );
    default:
      throw lastError;
  }
}

/** Why a call returned no text. Thinking tokens count against maxOutputTokens, so MAX_TOKENS is common. */
function describeEmptyResponse(response: GenerateContentResponse): string {
  const finishReason = response.candidates?.[0]?.finishReason;
  const blockReason = response.promptFeedback?.blockReason;

  if (finishReason === FinishReason.MAX_TOKENS) {
    return 'the model hit its output token limit before finishing (finishReason=MAX_TOKENS). ' +
      'On a thinking model, raise maxOutputTokens or lower thinkingLevel.';
  }
  if (blockReason) return `the prompt was blocked (blockReason=${blockReason})`;
  if (finishReason) return `empty response from Gemini API (finishReason=${finishReason})`;
  return 'empty response from Gemini API';
}

/** 3072-dim embedding. Never change the model: every stored vector depends on it. */
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

export interface GenerateJsonOptions {
  /** Required; there is no default model. */
  model: string;
  /** Not sent to Gemini 3 models (logs a warning instead). */
  temperature?: number;
  /** Gemini 3 thinks by default and thinking tokens count against maxOutputTokens. */
  thinkingLevel?: ThinkingLevel;
  /** Constrains structure only; validate values in the caller. */
  responseSchema?: SchemaUnion;
  maxOutputTokens?: number;
}

/** Request config shared by generateJson() and generateJsonFromDocument(). */
function jsonRequestConfig(model: string, options: GenerateJsonOptions) {
  if (options.temperature !== undefined && isGemini3(model)) {
    console.warn(
      `[Gemini] temperature is ignored by ${model} and was not sent. Use responseSchema ` +
        'to pin output shape; wording will vary between otherwise identical calls.'
    );
  }
  const sendTemperature = options.temperature !== undefined && !isGemini3(model);

  return {
    responseMimeType: 'application/json',
    ...(sendTemperature && { temperature: options.temperature }),
    ...(options.responseSchema !== undefined && { responseSchema: options.responseSchema }),
    ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
    ...(options.thinkingLevel !== undefined && {
      thinkingConfig: { thinkingLevel: options.thinkingLevel },
    }),
  };
}

export async function generateJson<T = unknown>(
  prompt: string,
  options: GenerateJsonOptions
): Promise<T> {
  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model: options.model,
        contents: prompt,
        config: jsonRequestConfig(options.model, options),
      }),
    'generateJson'
  );

  const text = response.text;
  if (!text) {
    throw new Error(`Failed to generate JSON content: ${describeEmptyResponse(response)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text}`);
  }
}

export interface StreamContentOptions {
  model: string;
  /** Sent as config.systemInstruction; Gemini has no system role inside `contents`. */
  systemInstruction: string;
  /** Prior turns, oldest first. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
}

/**
 * Streams a chat reply. Not an async generator on purpose: awaiting initiation lets an
 * initial failure (e.g. 429) reject before the route flushes headers.
 * withRetry wraps initiation only; a mid-stream failure must never be retried.
 */
export async function streamContent(options: StreamContentOptions): Promise<AsyncIterable<string>> {
  const { model, systemInstruction, history = [], message, thinkingLevel, maxOutputTokens } = options;

  const turns: Content[] = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // A trimmed history window may start on a model reply; Gemini requires a user turn first.
  while (turns.length > 0 && turns[0].role === 'model') turns.shift();

  turns.push({ role: 'user', parts: [{ text: message }] });

  const stream = await withRetry(
    () =>
      genai.models.generateContentStream({
        model,
        contents: turns,
        config: {
          systemInstruction,
          ...(maxOutputTokens !== undefined && { maxOutputTokens }),
          ...(thinkingLevel !== undefined && { thinkingConfig: { thinkingLevel } }),
        },
      }),
    'streamContent'
  );

  return (async function* () {
    let finishReason: FinishReason | undefined;

    for await (const chunk of stream) {
      finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      // `.text` skips thought parts.
      const text = chunk.text;
      if (text) yield text;
    }

    // A truncated stream throws nothing, so log it.
    if (finishReason === FinishReason.MAX_TOKENS) {
      console.warn(
        `[Gemini] streamContent hit its output limit (finishReason=MAX_TOKENS) — the reply was ` +
          `truncated. Raise maxOutputTokens (currently ${maxOutputTokens ?? 'unset'}) or lower thinkingLevel.`
      );
    }
  })();
}

/**
 * Structured JSON from a document sent as inlineData (used by OCR).
 * A MAX_TOKENS finish is an error even when text came back.
 */
export async function generateJsonFromDocument<T = unknown>(
  prompt: string,
  mimeType: string,
  base64Data: string,
  options: GenerateJsonOptions
): Promise<T> {
  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model: options.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
        config: jsonRequestConfig(options.model, options),
      }),
    'generateJsonFromDocument'
  );

  if (response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
    throw new Error(`Failed to generate JSON content: ${describeEmptyResponse(response)}`);
  }

  const text = response.text;
  if (!text) {
    throw new Error(`Failed to generate JSON content: ${describeEmptyResponse(response)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text}`);
  }
}

export { genai };
