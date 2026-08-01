import {
  FinishReason,
  GoogleGenAI,
  type GenerateContentResponse,
  type SchemaUnion,
  type ThinkingLevel,
} from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY is not set. AI features (embeddings, generation) will fail.');
}

const genai = new GoogleGenAI({ apiKey: apiKey ?? '' });

/**
 * Educator concept extraction. Google's listed replacement for gemini-2.5-flash.
 * Gemini 3 semantics differ — see `isGemini3` below.
 */
export const GEMINI_EXTRACTION_MODEL = 'gemini-3.6-flash';

/**
 * Adaptive test generation, Free Recall and Feynman grading.
 *
 * ⚠️ ALREADY DEAD. Verified 2026-08-01 against our own key: every call returns
 * HTTP 404 "no longer available to new users". It is still listed by ListModels,
 * which is why it looks alive. The published 2026-10-16 shutdown date is moot —
 * the four call sites naming this constant are broken NOW, not in October.
 *
 * They were left on it deliberately, not by oversight: they pass `temperature: 0`
 * for score reproducibility and Gemini 3 ignores that parameter, so migrating
 * them is a design decision rather than a model swap. See
 * `LearnSyncAI artifacts/GEMINI_MIGRATION_STATUS.md` for what each one needs.
 */
const GEMINI_LEGACY_TEXT_MODEL = 'gemini-2.5-flash';

/**
 * Gemini 3.x deprecated the sampling parameters. `temperature`, `top_p` and
 * `top_k` are ignored today and a future model generation returns HTTP 400 for
 * them, so they must not be sent at all.
 */
const isGemini3 = (model: string): boolean => /^gemini-3/.test(model);

/** Upstream statuses Google documents as transient — genuinely worth retrying. */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

/**
 * Longest server-suggested delay we will sit and wait for. Past this the request
 * is not slow, it is refused for the rest of the quota window, and blocking a
 * background job on it helps nobody.
 */
const MAX_HONOURED_RETRY_DELAY_MS = 30_000;

/** A quota refusal gets one polite retry, not four. See `classifyFailure`. */
const QUOTA_MAX_ATTEMPTS = 2;

/** Keeps a multi-kilobyte error body from flooding the terminal. */
const truncate = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What the upstream actually said, dug out of whatever shape the SDK threw. */
interface UpstreamError {
  status?: number;
  /** google.rpc status name — RESOURCE_EXHAUSTED, UNAVAILABLE, … */
  reason?: string;
  message: string;
  /** From google.rpc.RetryInfo. When Google says when to come back, believe it. */
  retryAfterMs?: number;
  /** Exhausted quota metric, e.g. `…/generate_content_free_tier_requests`. */
  quotaMetric?: string;
  quotaLimit?: string;
}

/**
 * Pulls the real cause out of an SDK error.
 *
 * The SDK's `ApiError` carries the HTTP code on `.status` and stuffs the entire
 * JSON error body into `.message`, so the useful parts — which quota was hit, how
 * long Google wants us to wait — are only reachable by parsing it back out. The
 * regex fallbacks cover payloads that state it in prose instead of `details`.
 */
function parseUpstreamError(err: unknown): UpstreamError {
  const rawStatus = (err as { status?: number })?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const raw = (err as { message?: string })?.message ?? String(err);

  let reason: string | undefined;
  let message = raw;
  let retryAfterMs: number | undefined;
  let quotaMetric: string | undefined;
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
          quotaMetric ??= violation?.quotaMetric ?? violation?.quotaId;
          quotaLimit ??= violation?.quotaValue;
        }
      }
    }
  } catch {
    // Not a JSON body — the prose probes below are the only source.
  }

  retryAfterMs ??= (() => {
    const m = /retry in ([\d.]+)\s*s/i.exec(message);
    return m ? Math.ceil(Number.parseFloat(m[1]) * 1000) : undefined;
  })();
  quotaMetric ??= /Quota exceeded for metric:\s*(\S+?)[,\s]/i.exec(message)?.[1];
  quotaLimit ??= /\blimit:\s*(\d+)/i.exec(message)?.[1];

  return { status, reason, message, retryAfterMs, quotaMetric, quotaLimit };
}

type Failure = 'quota' | 'transient' | 'fatal';

/**
 * Quota exhaustion and service overload both arrive as retryable-looking errors,
 * but only one of them recovers on its own.
 *
 * This distinction used to be missing, and both were reported to the educator as
 * "temporarily overloaded — try again in a moment". On a free-tier key that
 * sentence is simply untrue: the daily allowance is spent, and no amount of
 * retrying inside one upload will change that.
 */
function classifyFailure(e: UpstreamError): Failure {
  if (e.status === 429 || e.reason === 'RESOURCE_EXHAUSTED') {
    // Google names the window in the metric. A per-minute burst limit clears by
    // itself; a per-day allowance does not.
    return /per[_-]?min/i.test(e.quotaMetric ?? '') ? 'transient' : 'quota';
  }
  if (e.status !== undefined) return TRANSIENT_STATUSES.has(e.status) ? 'transient' : 'fatal';
  // No status on the error object: fall back to sniffing the message.
  return /UNAVAILABLE|\b(500|502|503|504)\b/.test(e.message) ? 'transient' : 'fatal';
}

export class GeminiUnavailableError extends Error {
  readonly status: number;
  /** The upstream failure this was derived from, for logging and diagnosis. */
  readonly upstream?: UpstreamError;

  constructor(
    message = 'The AI service is temporarily unavailable. Please try again in a moment.',
    options: { status?: number; upstream?: UpstreamError } = {}
  ) {
    super(message);
    this.name = 'GeminiUnavailableError';
    this.status = options.status ?? 503;
    this.upstream = options.upstream;
  }
}

/**
 * The API key's quota is spent. Extends GeminiUnavailableError so existing
 * `instanceof` handlers keep working, but answers 429 and says so plainly —
 * retrying this upload will not help.
 */
export class GeminiQuotaError extends GeminiUnavailableError {
  constructor(message: string, upstream?: UpstreamError) {
    super(message, { status: 429, upstream });
    this.name = 'GeminiQuotaError';
  }
}

/** Educator- and student-facing text. Lands verbatim in `materials.parse_error`. */
function quotaMessage(e: UpstreamError): string {
  const metric = e.quotaMetric?.split('/').pop();
  const detail = metric
    ? ` (${metric}${e.quotaLimit ? `, limit ${e.quotaLimit}` : ''})`
    : '';
  return (
    `The Gemini API quota for this key is exhausted${detail}. ` +
    'Free-tier quotas reset on a daily cycle — try again after the reset, or enable ' +
    'billing on the Google Cloud project behind this API key.'
  );
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries a Gemini call on genuinely transient upstream failures, honouring the
 * server's own retry hint when it gives one.
 *
 * Three outcomes, deliberately distinct:
 *   fatal      bad key, bad model, malformed request — rethrown untouched, at once
 *   quota      the key's allowance is spent — one retry, then GeminiQuotaError
 *   transient  overload or 5xx — full backoff, then GeminiUnavailableError
 *
 * Every attempt logs the actual HTTP status and upstream message. Without that,
 * a quota refusal and a real outage are indistinguishable in the terminal, which
 * is exactly the hole that made a failed upload impossible to diagnose.
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

      // Prefer Google's own RetryInfo; fall back to 1s, 2s, 4s … plus jitter.
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
      throw new GeminiQuotaError(quotaMessage(lastParsed), lastParsed);
    case 'transient':
      throw new GeminiUnavailableError(
        `The AI service is temporarily unavailable (HTTP ${lastParsed.status ?? '5xx'}). ` +
          'Please try again in a moment.',
        { upstream: lastParsed }
      );
    default:
      throw lastError;
  }
}

/**
 * Explains why a call came back with no text.
 *
 * Worth the detour because thinking models fail in a way 2.5 rarely did: thinking
 * tokens draw on `maxOutputTokens`, so a budget that is merely tight returns
 * `MAX_TOKENS` and no text at all. A bare "empty response" sends the reader
 * hunting an outage instead of raising a ceiling.
 */
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
 * Generates plain text content.
 *
 * NOTE: currently unreferenced. Kept on the legacy model — migrate or delete it
 * before the 2026-10-16 shutdown rather than leaving a dead 2.5 call behind.
 *
 * @param prompt - The prompt to send to the model
 * @returns The generated text string
 */
export async function generateContent(prompt: string): Promise<string> {
  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model: GEMINI_LEGACY_TEXT_MODEL,
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
   * Which model to call. Defaults to `gemini-2.5-flash` so callers that predate
   * the Gemini 3 migration are unaffected. Pass `GEMINI_EXTRACTION_MODEL` to opt in.
   */
  model?: string;
  /**
   * Sampling temperature. Omit to use Gemini's default (some variation between
   * identical calls). Pass 0 for reproducible output — required when the result
   * is a score a student sees, so an identical submission can't be graded
   * differently on a resubmit.
   *
   * **Ignored on Gemini 3.x models**, which dropped the sampling parameters. It
   * is not sent there, and passing it logs a warning rather than failing quietly.
   */
  temperature?: number;
  /**
   * Gemini 3.x only — replaces 2.5's `thinkingBudget`. Thinking is ON by default
   * (`medium` on gemini-3.6-flash) and its tokens draw on `maxOutputTokens`, so
   * a task that is enumeration rather than reasoning should turn this down.
   */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pins the JSON shape the model must return. Constrains structure only — value
   * rules (lengths, ranges) still belong in the caller's own validation.
   */
  responseSchema?: SchemaUnion;
  /** Output token ceiling. Worth setting explicitly whenever thinking is on. */
  maxOutputTokens?: number;
}

/**
 * Generates structured JSON content.
 *
 * Defaults to `gemini-2.5-flash`; pass `model` to target another. Gemini 3
 * parameter semantics are applied automatically — see `isGemini3`.
 *
 * @param prompt - The prompt (should instruct the model to return JSON)
 * @param options - Model, sampling and output controls. Defaults preserve prior behaviour.
 * @returns Parsed JavaScript object/array
 */
export async function generateJson<T = unknown>(
  prompt: string,
  options: GenerateJsonOptions = {}
): Promise<T> {
  const model = options.model ?? GEMINI_LEGACY_TEXT_MODEL;

  // Drop `temperature` loudly on Gemini 3, never silently: a caller that still
  // believes `temperature: 0` pins its output would be relying on a guarantee it
  // no longer has, and on this codebase that guarantee backs student-facing scores.
  if (options.temperature !== undefined && isGemini3(model)) {
    console.warn(
      `[Gemini] temperature is ignored by ${model} and was not sent. Use responseSchema ` +
        'to pin output shape; wording will vary between otherwise identical calls.'
    );
  }
  const sendTemperature = options.temperature !== undefined && !isGemini3(model);

  const response = await withRetry(
    () =>
      genai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          // Each of these is sent only when the caller asked for it, so existing
          // callers keep Gemini's defaults untouched.
          ...(sendTemperature && { temperature: options.temperature }),
          ...(options.responseSchema !== undefined && { responseSchema: options.responseSchema }),
          ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
          ...(options.thinkingLevel !== undefined && {
            thinkingConfig: { thinkingLevel: options.thinkingLevel },
          }),
        },
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

/**
 * Generates structured JSON content from a document passed as inlineData.
 *
 * NOTE: referenced only by `server/test-gemini.ts`, a scratch script. Kept on the
 * legacy model — migrate or delete it before the 2026-10-16 shutdown.
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
        model: GEMINI_LEGACY_TEXT_MODEL,
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
