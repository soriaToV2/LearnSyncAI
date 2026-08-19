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
