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
 * ── Choosing a model for a new call site ──────────────────────────────────
 *
 * Two questions, in this order:
 *
 *  1. Does the MODEL'S OWN JUDGEMENT become a number the student is shown?
 *
 *     yes → GEMINI_GRADING_MODEL. A plausible-but-wrong score is invisible;
 *           nobody can eyeball it the way they can spot a bad trivia question.
 *
 *     Free Recall is the instructive case: it *looks* like grading, but the model
 *     only lists what the student mentioned. The score is coveredCount/totalConcepts,
 *     computed here from cosine similarity against a fixed threshold — so it is a
 *     "no". Feynman genuinely grades, so it is a "yes".
 *
 *  2. If no — does the output become CONTENT A STUDENT READS AS FACT?
 *
 *     yes → GEMINI_CONTENT_MODEL. Test questions, game content, flashcard fronts.
 *           Nothing scores them, so a wrong one ships.
 *     no  → GEMINI_UTILITY_MODEL. Extraction, classification and coaching prose,
 *           where the model enumerates and CODE does any scoring.
 *
 * The second question exists because question 1 alone sends every authoring call
 * to the utility model — test grading is deterministic (`testGrading.ts`), so no
 * model judgement there ever becomes a score. That would be the wrong call: see
 * GEMINI_CONTENT_MODEL for the measured reason.
 *
 * Gemini 3 semantics differ from 2.5 across all of these — see `isGemini3` below.
 */

/** Educator document concept extraction. Feeds the entire knowledge base. */
export const GEMINI_EXTRACTION_MODEL = 'gemini-3.6-flash';

/**
 * Calls whose output IS a score the student is shown. Feynman grading only.
 *
 * Worth the stronger model: Feynman is the hardest prompt in the codebase — two
 * anti-correlated scores, a restraint rule, analogy classification and
 * glossary-grounded jargon — and Gemini has already been recorded failing to keep
 * the two axes apart on it.
 */
export const GEMINI_GRADING_MODEL = 'gemini-3.6-flash';

/**
 * Mechanical calls: extraction and coaching prose. ~5x cheaper input and ~3x
 * cheaper output than the grading model, and Google positions Flash-Lite for
 * exactly this — extraction and classification where reasoning depth is not
 * critical.
 *
 * Free-tier request quota is per-model (`GenerateRequestsPerDayPerProjectPerModel`),
 * so using a distinct model here also buys a separate daily bucket rather than
 * sharing one with extraction and grading.
 */
export const GEMINI_UTILITY_MODEL = 'gemini-3.5-flash-lite';

/**
 * Calls that AUTHOR CONTENT A STUDENT READS AS FACT: adaptive test questions
 * (`testGeneration.ts`), game content, flashcard fronts.
 *
 * By the "does a model judgement become a score?" rule alone these would all sit
 * on the utility model, because test grading is deterministic (`testGrading.ts`)
 * and the server owns every decision that affects a mark. That would be wrong,
 * and it has been measured: CLAUDE.md's Games section records three separate
 * attempts to push authoring down, which produced invented facts ("What does
 * Cross-Site Scripting *prevent*?" — XSS causes it), ungrammatical fragments and
 * subjectless stems naming no concept at all. A bad score is invisible; a bad
 * question is visible but nothing is checking, so it ships either way.
 *
 * ⛔ NOT `gemini-3.7-flash`, however attractive its "50% introductory cut" looks.
 * Verified 2026-08-18 against our own key: it rejects `MINIMAL` thinking outright
 * (HTTP 400, floor is LOW), and four of five requests failed with "This model is
 * currently experiencing high demand". Since thinking tokens bill at the OUTPUT
 * rate, a forced LOW floor makes its cheapest call dearer than 3.6-flash at
 * MINIMAL — and the discount is measured against 3.7's own future price, not
 * against what 3.6 costs today. Re-evaluate after the study, not before.
 */
export const GEMINI_CONTENT_MODEL = 'gemini-3.6-flash';

/**
 * The RAG study assistant (`chat.routes.ts`). Conversational rather than
 * authoritative: a student can push back on an answer mid-conversation, which is
 * exactly what they cannot do with a test question, so the faster and cheaper
 * model is the right trade here even though this is also student-facing prose.
 *
 * Flash-Lite at MINIMAL was the most consistent thing measured across the whole
 * migration — 1.8 / 2.1 / 1.8 / 1.9 / 1.9s over five samples, where 3.6-flash
 * ranged 2s to 20s on identical requests. Time-to-first-token is what a chat UI
 * is judged on.
 */
export const GEMINI_CHAT_MODEL = 'gemini-3.5-flash-lite';

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

export interface GenerateJsonOptions {
  /**
   * Which model to call. REQUIRED — there is deliberately no default.
   *
   * It defaulted to `gemini-2.5-flash` until 2026-08-19, so that callers
   * predating the Gemini 3 migration kept working. That model had already been
   * returning HTTP 404 for months by then (verified 2026-08-01, "no longer
   * available to new users"), so the default had stopped sparing anyone and
   * become a trap: a call site that forgot `model` failed at runtime, on a live
   * student request, instead of at compile time. Every caller already passed one
   * explicitly, so requiring it cost nothing and closed the hole.
   */
  model: string;
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
 * The request config shared by `generateJson()` and `generateJsonFromDocument()`.
 *
 * ONE copy on purpose. The `temperature` rule below backs student-facing scores,
 * and a second copy of it is exactly the kind of thing that drifts — the version
 * that quietly kept sending `temperature` would leave its caller believing in a
 * reproducibility guarantee Gemini 3 no longer offers.
 */
function jsonRequestConfig(model: string, options: GenerateJsonOptions) {
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

  return {
    responseMimeType: 'application/json',
    // Each of these is sent only when the caller asked for it, so a caller that
    // omits one keeps Gemini's own default rather than one of ours.
    ...(sendTemperature && { temperature: options.temperature }),
    ...(options.responseSchema !== undefined && { responseSchema: options.responseSchema }),
    ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
    ...(options.thinkingLevel !== undefined && {
      thinkingConfig: { thinkingLevel: options.thinkingLevel },
    }),
  };
}

/**
 * Generates structured JSON content.
 *
 * `options.model` is required — see the note on it. Gemini 3 parameter semantics
 * are applied automatically; see `isGemini3`.
 *
 * @param prompt - The prompt (should instruct the model to return JSON)
 * @param options - Model (required), sampling and output controls
 * @returns Parsed JavaScript object/array
 */
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
  /** Which model to call. No default: a chat turn has no "legacy caller" to preserve. */
  model: string;
  /**
   * The grounding prompt. Goes in `config.systemInstruction` — Gemini has NO
   * system role inside `contents`, so a caller that ports an OpenAI-shaped
   * `[{ role: 'system' }, …]` array through the message list loses it silently.
   */
  systemInstruction: string;
  /** Prior turns, oldest first. Empty on the first message of a conversation. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** The message being answered now. Kept separate so the caller cannot forget it. */
  message: string;
  /** Gemini 3.x. Thinking is ON by default and its tokens draw on `maxOutputTokens`. */
  thinkingLevel?: ThinkingLevel;
  /** Output ceiling. Worth setting explicitly whenever thinking is on. */
  maxOutputTokens?: number;
}

/**
 * Streams a chat reply, yielding text as it arrives.
 *
 * The only streaming call in the codebase. `generateJson()` waits for a whole
 * response, which is right for authoring work and wrong for a chat UI, where
 * time-to-first-token is what the student actually experiences.
 *
 * ⚠️ IT AWAITS THE STREAM'S INITIATION AND RETURNS AN ITERABLE — it is
 * deliberately NOT an `async function*`. `generateContentStream()` issues the
 * HTTP request itself and its promise REJECTS on the initial failure (429, 400,
 * 5xx) before any chunk exists. Written as a generator, that rejection would be
 * deferred to the caller's first `for await` — which in `chat.routes.ts` happens
 * after `res.flushHeaders()`, so a spent daily quota would reach the student as
 * an SSE error blob rendered "something went wrong" instead of a real HTTP 429
 * carrying `quotaMessage()`. Awaiting initiation is what keeps the typed error
 * reachable.
 *
 * ⚠️ `withRetry()` WRAPS THE INITIATION ONLY, and that is a correctness rule
 * rather than an oversight. Retrying is safe here precisely because nothing has
 * been yielded yet. A failure *during* iteration must never be retried: the
 * client already holds half an answer and there is no way to replay it, so a
 * retry would splice a second attempt into the middle of a sentence. Those
 * errors propagate untouched to the caller, which is what the route's
 * `res.headersSent` branch exists to handle.
 *
 * NO `temperature`, and no reproducibility guarantee to lose. Gemini 3 dropped
 * the sampling parameters; nothing here is scored, so unlike Free Recall and
 * Feynman there is no memoisation to compensate.
 */
export async function streamContent(options: StreamContentOptions): Promise<AsyncIterable<string>> {
  const { model, systemInstruction, history = [], message, thinkingLevel, maxOutputTokens } = options;

  // 'assistant' is the OpenAI name; Gemini calls the same turn 'model'.
  const turns: Content[] = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // A conversation must open on a user turn. Callers trim history to a fixed
  // window (the chat route keeps the last 4 messages), and such a window can
  // legitimately begin mid-exchange on a model reply.
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
      // `.text` already skips parts flagged `thought` and returns undefined for a
      // chunk carrying none, so thinking output can never leak into the answer.
      const text = chunk.text;
      if (text) yield text;
    }

    // `describeEmptyResponse()` cannot see this one: a truncated STREAM throws
    // nothing and returns no empty response — the reply simply stops mid-sentence
    // and the only symptom is a student saying the assistant cut off.
    if (finishReason === FinishReason.MAX_TOKENS) {
      console.warn(
        `[Gemini] streamContent hit its output limit (finishReason=MAX_TOKENS) — the reply was ` +
          `truncated. Raise maxOutputTokens (currently ${maxOutputTokens ?? 'unset'}) or lower thinkingLevel.`
      );
    }
  })();
}

/**
 * Generates structured JSON content from a document passed as inlineData —
 * the file itself goes to the model, with no text-extraction step in front.
 *
 * NO PRODUCTION CALLER TODAY; `server/test-gemini.ts` is the only one. It is
 * kept because it is the natural route for SCANNED materials, which the ingest
 * pipeline already detects and records (`materials.is_scanned`) without yet
 * doing anything about — a scanned PDF yields no extractable text, so
 * `conceptExtraction.ts` has nothing to work from and this is the way in.
 *
 * `options.model` is required for the same reason `generateJson()`'s is: this
 * function used to hardcode `gemini-2.5-flash`, which has returned HTTP 404
 * since before it was last touched. Anything reaching it was broken.
 *
 * @param prompt - The instructions for extraction.
 * @param mimeType - The mime type of the file (e.g. 'application/pdf').
 * @param base64Data - The raw file data encoded as a base64 string.
 * @param options - Model (required), sampling and output controls.
 * @returns Parsed JavaScript object/array
 */
export async function generateJsonFromDocument<T = unknown>(
  prompt: string,
  mimeType: string,
  base64Data: string,
  options: GenerateJsonOptions
): Promise<T> {
  // @google/genai v1.x requires a single content object with a `parts` array
  // for multimodal requests (text instruction + inlineData file).
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
