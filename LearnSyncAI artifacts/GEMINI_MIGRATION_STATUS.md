# Gemini Model Migration — Status & Remaining Work

**Last verified:** 2026-08-01, against this project's own `GEMINI_API_KEY`.

---

## The finding that matters

`gemini-2.5-flash` **is not "shutting down in October". It is already gone.**

```
POST /v1beta/models/gemini-2.5-flash:generateContent
→ HTTP 404
  "This model models/gemini-2.5-flash is no longer available to new users.
   Please update your code to use a newer model."
```

It still appears in `ListModels`, which is why nothing looked broken. The published
shutdown date of **2026-10-16** is the date it disappears for *existing* users; keys that
had not already used it — including this project's — lost access earlier.

**Three student-facing features are therefore broken in the running app right now.**

---

## Status by call site

| # | Feature | Call site | Model | Status |
|---|---------|-----------|-------|--------|
| 1 | Educator concept extraction | `lib/conceptExtraction.ts:~170` | `gemini-3.6-flash` | ✅ migrated & verified |
| 2 | Adaptive test generation | `routes/practice.routes.ts:101` | `gemini-2.5-flash` | ❌ **404 — down** |
| 3 | Free Recall — concept extraction | `routes/cognitive.routes.ts:305` | `gemini-2.5-flash` | ❌ **404 — down** |
| 4 | Free Recall — written feedback | `routes/cognitive.routes.ts:196` | `gemini-2.5-flash` | ❌ **404 — down** |
| 5 | Feynman — grading | `routes/cognitive.routes.ts:840` | `gemini-2.5-flash` | ❌ **404 — down** |
| — | All embeddings | `lib/gemini.ts` `generateEmbedding()` | `gemini-embedding-001` | ✅ fine until 2028-05-14 |

Dead code that also names the legacy model, harmless but should be deleted or migrated:
`generateContent()` (no callers at all) and `generateJsonFromDocument()` (called only by
`server/test-gemini.ts`, a scratch script).

---

## The plumbing is already in place

`generateJson()` in `server/lib/gemini.ts` now takes:

```ts
{
  model?: string;              // defaults to GEMINI_LEGACY_TEXT_MODEL
  temperature?: number;        // silently correct: STRIPPED on gemini-3*, with a warning
  thinkingLevel?: ThinkingLevel;
  responseSchema?: SchemaUnion;
  maxOutputTokens?: number;
}
```

So each migration below is a small, local edit. **Nothing structural is missing.**

---

## What each remaining site needs

### 2. Adaptive test generation — `practice.routes.ts:101`

The easy one. It passes **no** `temperature`, so there is no reproducibility question at
all — a practice test is generated once and stored.

```ts
const questionsPayload = await generateJson<{ questions: unknown[] }>(prompt, {
  model: GEMINI_EXTRACTION_MODEL,
  thinkingLevel: ThinkingLevel.LOW,
  maxOutputTokens: 16384,
});
```

Add a `responseSchema` if you want the `{ questions: [...] }` envelope pinned. The one
thing to re-test by hand: the prompt ends with *"Use the actual concept_id UUIDs provided
above"*, and a wrong `concept_id` silently corrupts BKT. Verify the returned UUIDs against
the ones sent, exactly as the flashcard generator range-checks its indices.

### 3 & 4. Free Recall — `cognitive.routes.ts:305` and `:196`

**Read `cognitive.routes.ts:91-105` before touching this.** That comment already
establishes what the guarantee actually rests on, and it is *not* `temperature` alone:

- **The score** is pinned by structured extraction plus the **0.70 coverage threshold**,
  which quantises away residual variation. A `responseSchema` on the extraction call at
  `:305` strengthens exactly this — it is a closer fit to the real guarantee than
  `temperature: 0` ever was.
- **The prose** is pinned by **`findPreviousFeedback()`** (`:106`), which reuses a previous
  identical attempt's feedback rather than asking the model to reproduce it. The code
  comment is explicit that temperature never pinned prose: *"the same input reliably
  produced the same score but reworded paragraphs."*

So the migration is defensible on the mechanism the code already documents:

```ts
// :305 — the scoring-critical call
const extractedConcepts = await generateJson<ExtractedConcept[]>(extractionPrompt, {
  model: GEMINI_EXTRACTION_MODEL,
  thinkingLevel: ThinkingLevel.LOW,
  responseSchema: /* array of { term, explanation } */,
  maxOutputTokens: 16384,
});
```

Drop `temperature: 0` and **rewrite the comment at `:301-304`** — it currently claims
temperature is what makes scoring reproducible, which stops being true.

`:196` is written feedback (prose), guarded by `findPreviousFeedback()`. No schema needed;
just the model swap.

**Before/after check worth running:** submit the same Free Recall text 3× and confirm the
coverage ratio lands on the same value each time. If it does, the quantisation is doing
its job and the paper's reproducibility claim holds on its real terms.

### 5. Feynman — `cognitive.routes.ts:840`

The one that needs actual thought. Feynman returns **two continuous scores**
(`accuracy_score`, `simplicity_score`) and the verdict is derived in the backend from
accuracy. Unlike Free Recall's coverage ratio, **there may be no quantisation step** to
absorb model variation — check whether the verdict bands are wide enough that a small
score wobble cannot flip a student between verdicts.

- If the bands absorb it → migrate like the others, with a `responseSchema` pinning
  `{ accuracy_score, simplicity_score, ... }`.
- If they do not → the honest fix is to quantise the score before storing it (round to a
  band), or extend `findPreviousFeedback()`-style reuse to Feynman.

---

## Operational note: the daily quota is 20, not 1500

Public docs and third-party summaries quote generous free-tier limits. **This key's actual
cap, observed:**

```
429 — Quota exceeded for metric: generate_content_free_tier_requests,
      limit: 20, model: gemini-3.6-flash
```

**20 requests per day.** Concept extraction makes one call per window, so a 100-page module
(~12–15 windows) consumes most of a day's budget in a single upload. Plan testing around
this, or enable billing before a defence demo. Embeddings are metered separately.

---

## Reference

- Deprecations: <https://ai.google.dev/gemini-api/docs/deprecations>
- Gemini 3 migration: <https://ai.google.dev/gemini-api/docs/generate-content/latest-model>
- `EXTRACTION_IMPLEMENTATION.md` — the migrated pipeline, in full
- `CLAUDE.md` § AI Services — the rules that bind new Gemini work
