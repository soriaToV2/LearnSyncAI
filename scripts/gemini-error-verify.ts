/**
 * Verifies how upstream Gemini failures are CLASSIFIED, and what each audience is
 * told about them. Run: `npx tsx scripts/gemini-error-verify.ts`
 *
 * This exists because two production incidents came from the same few lines and
 * neither was catchable by reading the code:
 *
 *   1. A per-minute burst limit was graded as a spent daily allowance, so it took
 *      one retry instead of the full backoff and told a student to come back after
 *      the reset — on a PAID key, which has no daily embedding cap at all.
 *   2. The operator's text WAS the student's text, so a student read Google's own
 *      `https://` quota documentation link in the chat error bar.
 *
 * It drives the REAL `withRetry` path by stubbing `genai.models.embedContent` to
 * throw the exact upstream bodies observed in the Render logs — so
 * `parseUpstreamError`, `classifyFailure`, the retry budget and both message
 * builders are all under test together, rather than an exported internal that
 * could drift from what actually ships.
 *
 * No network, no API key, no quota consumed. It does sleep through the real
 * backoff, so a full run takes ~25s.
 */
import { readFileSync } from 'node:fs';
import {
  genai,
  generateEmbedding,
  GeminiUnavailableError,
  GeminiQuotaError,
} from '../server/lib/gemini';

let failures = 0;
let attempts = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Mimics the SDK's ApiError: HTTP code on `.status`, the whole JSON body in `.message`. */
function upstream(status: number, reason: string, message: string, details?: unknown[]): Error {
  const err = new Error(JSON.stringify({ error: { code: status, status: reason, message, details } }));
  (err as unknown as { status: number }).status = status;
  return err;
}

const quotaFailure = (quotaMetric: string, quotaId: string, quotaValue: string) => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaMetric, quotaId, quotaValue }],
});

async function run(name: string, err: Error): Promise<any> {
  attempts = 0;
  (genai.models as unknown as { embedContent: unknown }).embedContent = async () => {
    attempts++;
    throw err;
  };

  console.log('');
  console.log(name);

  try {
    await generateEmbedding('anything');
  } catch (caught) {
    return caught;
  }
  failures++;
  console.log('   FAIL  expected a rejection, got a value');
  return new Error('unreachable');
}

/**
 * Nothing a student reads may name the plumbing. `gemini` is on the list too —
 * the product name they know is "the study assistant".
 */
function assertStudentSafe(label: string, text: string): void {
  const banned = ['http', 'api key', 'billing', 'google cloud', 'quota', 'metric', 'aiplatform', 'gemini'];
  const hit = banned.find(word => text.toLowerCase().includes(word));
  check(`${label} names no plumbing`, hit ?? 'clean', 'clean');
  if (hit) console.log(`         leaked "${hit}" in: ${text}`);
}

async function main(): Promise<void> {
  console.log('Gemini error classification — verification');
  console.log('='.repeat(68));

  // ── 1. The reported Render failure: paid key, aiplatform wording, no details ──
  {
    const e = await run(
      '1. Per-minute burst, aiplatform wording  (the reported bug)',
      upstream(
        429,
        'RESOURCE_EXHAUSTED',
        'Quota exceeded for aiplatform.googleapis.com/global_embed_content_requests_per_minute_per_base_model ' +
          'with base model: gemini-embedding. Please submit a quota increase request. ' +
          'https://cloud.google.com/vertex-ai/docs/generative-ai/quotas-genai.'
      )
    );
    check('NOT classified quota (was: quota)', e instanceof GeminiQuotaError, false);
    check('typed as an outage instead', e instanceof GeminiUnavailableError, true);
    check('gets the full 4-attempt backoff (was: 2)', attempts, 4);
    check('tells the student to wait seconds', e.userMessage.includes('Wait a few seconds'), true);
    assertStudentSafe('userMessage', e.userMessage);
  }

  // ── 2. generativelanguage wording, where only quotaId names the window ───────
  {
    const e = await run(
      '2. Per-minute burst, window stated only in quotaId',
      upstream(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).', [
        quotaFailure(
          'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
          '5'
        ),
      ])
    );
    check('NOT classified quota', e instanceof GeminiQuotaError, false);
    check('gets the full 4-attempt backoff', attempts, 4);
    check('tells the student to wait seconds', e.userMessage.includes('Wait a few seconds'), true);
    assertStudentSafe('userMessage', e.userMessage);
  }

  // ── 3. A genuinely spent day must still behave as a quota refusal ────────────
  {
    const e = await run(
      '3. Daily allowance genuinely spent',
      upstream(
        429,
        'RESOURCE_EXHAUSTED',
        'You exceeded your current quota, please check your plan and billing details.',
        [
          quotaFailure(
            'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            '20'
          ),
        ]
      )
    );
    check('classified quota', e instanceof GeminiQuotaError, true);
    check('answers HTTP 429', e.status, 429);
    check('one polite retry only', attempts, 2);
    check('tells the student NOT to keep retrying',
      e.userMessage.includes('will not help right now'), true);
    check('operator text keeps the metric', e.message.includes('generate_content_free_tier_requests'), true);
    check('operator text keeps the limit', e.message.includes('limit 20'), true);
    check('operator text no longer asserts "Free-tier"', e.message.includes('Free-tier'), false);
    assertStudentSafe('userMessage', e.userMessage);
  }

  // ── 4. Regression: the older `metric:` prose shape must still parse ──────────
  {
    const e = await run(
      '4. Legacy "Quota exceeded for metric: <name>" prose',
      upstream(
        429,
        'RESOURCE_EXHAUSTED',
        'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20'
      )
    );
    check('classified quota (no per-minute signal anywhere)', e instanceof GeminiQuotaError, true);
    check('metric still extracted by the widened regex',
      e.message.includes('generate_content_free_tier_requests'), true);
  }

  // ── 5. A bad key must still fail fast and be rethrown untouched ──────────────
  {
    const e = await run(
      '5. HTTP 401 — the mangled-key failure',
      upstream(
        401,
        'UNAUTHENTICATED',
        'Request had invalid authentication credentials. Expected OAuth 2 access token, ' +
          'login cookie or other valid authentication credential.'
      )
    );
    check('not dressed up as an outage', e instanceof GeminiUnavailableError, false);
    check('fails fast — one attempt, no retry', attempts, 1);
  }

  // ── 6. A real outage must still be transient ─────────────────────────────────
  {
    const e = await run(
      '6. HTTP 503 — genuine upstream outage',
      upstream(503, 'UNAVAILABLE', 'The service is currently unavailable.')
    );
    check('typed as an outage', e instanceof GeminiUnavailableError, true);
    check('not a quota error', e instanceof GeminiQuotaError, false);
    check('gets the full 4-attempt backoff', attempts, 4);
    assertStudentSafe('userMessage', e.userMessage);
  }

  // ── 6b. The three failure modes an operator actually asks about ─────────────
  //
  // Named scenarios, kept because each one calls for DIFFERENT advice and the
  // three used to collapse onto two sentences — a 30-second overload was telling
  // students to go and fetch their teacher.
  {
    const e = await run(
      '6b-i. Capacity: overload reported as 429 with NO quota metadata',
      upstream(429, 'RESOURCE_EXHAUSTED',
        'This model is currently experiencing high demand. Please try again later.')
    );
    check('treated as capacity, not a spent allowance', e instanceof GeminiQuotaError, false);
    check('gets the full 4-attempt backoff (was: 2)', attempts, 4);
    check('says wait a moment', e.userMessage.includes('wait a moment'), true);
    assertStudentSafe('userMessage', e.userMessage);
  }

  {
    const e = await run(
      '6b-ii. Tokens-per-minute quota, free-tier shape',
      upstream(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted.', [
        quotaFailure(
          'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count',
          'GenerateContentInputTokensPerModelPerMinute-FreeTier',
          '1000000'
        ),
      ])
    );
    check('per-minute window recognised', e instanceof GeminiQuotaError, false);
    check('gets the full 4-attempt backoff', attempts, 4);
    check('says wait a few seconds', e.userMessage.includes('Wait a few seconds'), true);
    assertStudentSafe('userMessage', e.userMessage);
  }

  {
    const e = await run(
      '6b-iii. Tokens-per-minute quota, aiplatform shape',
      upstream(429, 'RESOURCE_EXHAUSTED',
        'Quota exceeded for aiplatform.googleapis.com/online_prediction_input_tokens_per_minute_per_base_model ' +
          'with base model: gemini-3.6-flash.')
    );
    check('per-minute window recognised', e instanceof GeminiQuotaError, false);
    check('gets the full 4-attempt backoff', attempts, 4);
    check('says wait a few seconds', e.userMessage.includes('Wait a few seconds'), true);
    assertStudentSafe('userMessage', e.userMessage);
  }

  // The three sentences must stay three. If two ever collapse, one scenario is
  // being given advice written for a different one.
  {
    console.log('');
    console.log('6c. The three student sentences are distinct');
    const burst = await run('   (burst)',
      upstream(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for x/requests_per_minute_per_base_model with base model: y.'));
    const outage = await run('   (outage)',
      upstream(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.'));
    const spent = await run('   (spent)',
      upstream(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.', [
        quotaFailure('m', 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', '20'),
      ]));
    const distinct = new Set([burst.userMessage, outage.userMessage, spent.userMessage]);
    check('three scenarios, three sentences', distinct.size, 3);
  }

  // ── 7. Static: no student-facing route may forward `err.message` ────────────
  //
  // The runtime cases above prove `userMessage` says the right thing. This proves
  // every student route actually SENDS it — the leak was six routes forwarding
  // `err.message`, several of them carrying a comment promising they did not, so
  // a comment is not evidence and neither is one passing route.
  //
  // `assessments.routes.ts` is excluded on purpose: its generate route is
  // `requireRole('educator')`, and an educator is the reader who can act on the
  // quota metric. Same rule as `materials.parse_error`.
  console.log('');
  console.log('7. Static audit — no student route forwards err.message');
  {
    const studentRoutes = [
      'chat', 'cognitive', 'games', 'practice', 'studyspaces', 'flashcards', 'gamification',
    ];
    for (const name of studentRoutes) {
      const path = `server/routes/${name}.routes.ts`;
      let src: string;
      try {
        src = readFileSync(path, 'utf8');
      } catch {
        continue; // route file does not exist in this tree
      }
      if (!src.includes('GeminiUnavailableError')) continue;

      // Every line inside a Gemini branch that builds a response body.
      const leaks = src
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /message:\s*`?\$?{?err\.message/.test(line));

      check(`${name}.routes.ts sends no err.message`, leaks.length, 0);
      for (const l of leaks) console.log(`         line ${l.n}: ${l.line.trim()}`);
    }
  }

  console.log('');
  console.log('='.repeat(68));
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
