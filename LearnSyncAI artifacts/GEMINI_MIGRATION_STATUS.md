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
| 1 | Educator concept extraction | `lib/conceptExtraction.ts` | `gemini-3.6-flash` | ✅ migrated & verified |
| 2 | Free Recall — concept extraction | `routes/cognitive.routes.ts` | `gemini-3.5-flash-lite` | ✅ migrated & verified |
| 3 | Free Recall — written feedback | `routes/cognitive.routes.ts` | `gemini-3.5-flash-lite` | ✅ migrated & verified |
| 4 | Feynman — grading | `routes/cognitive.routes.ts` | `gemini-3.6-flash` | ✅ migrated & verified |
| 5 | **Adaptive test generation** | `routes/practice.routes.ts:101` | `gemini-2.5-flash` | ❌ **404 — still down** |
| — | All embeddings | `lib/gemini.ts` `generateEmbedding()` | `gemini-embedding-001` | ✅ fine until 2028-05-14 |

**Adaptive test generation is now the only remaining dead call site.** It is the easy one — it passes no `temperature`, so there is no reproducibility question. The one care point: its prompt asks the model to echo `concept_id` UUIDs back, and a wrong id silently corrupts BKT, so the returned ids must be range-checked against the ids sent (the flashcard generator's index echo is the pattern to copy).

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

## How Free Recall and Feynman were migrated (2026-08-01)

The blocker was never the plumbing. It was that **`temperature: 0` was the stated mechanism
for score reproducibility, and Gemini 3 has no equivalent**. Two halves, in this order:

### Half 1 — make reproducibility independent of the model

`findPreviousFeedback()` was replaced by **`findMemoisedAttempt()`**, which runs *before* any
AI call in both endpoints. An identical resubmission is answered from the row it produced
last time — exact, and true whichever model is configured. **That is what turned the model
into a free variable**; without it, every future model change would re-open this same question.

Keyed on `student_id` + `mode` + `user_input` + `material_ids` + a **content fingerprint**.

The fingerprint exists because **`concepts` has no `updated_at` column** — an educator
editing a definition changes no timestamp anywhere, so a time-based key would happily serve a
score for a lesson that no longer exists. `fingerprintConcepts()` hashes the concept
id/term/definition set, plus the glossary for Feynman (it drives jargon detection). Stored as
`concepts_fingerprint` inside the existing `ai_feedback` JSON — **no migration needed**.

Two properties worth preserving if this is ever reworked:

- **A hit still INSERTs a log row.** A resubmission is a real attempt and must appear in the
  student's history exactly as before. Only the model calls are skipped.
- **Rows predating the field are never reused.** No fingerprint means it cannot be proven
  current.

Side benefit: an identical resubmission now costs **zero** API calls instead of 2 (Free
Recall) or 1 (Feynman) — material on a 20/day budget.

### Half 2 — the model split

| Call site | Model | Thinking | Why |
|---|---|---|---|
| Free Recall extraction | `GEMINI_UTILITY_MODEL` | `MINIMAL` | Model only *enumerates*; the score is cosine + threshold in code |
| Free Recall prose | `GEMINI_UTILITY_MODEL` | `LOW` | `LOW` not `MINIMAL` — the prompt has a restraint rule a zero-thinking pass ignores |
| Feynman grading | `GEMINI_GRADING_MODEL` | `MEDIUM` | The one call where the model's judgement *is* the student's score |

**The rule for a new call site:** *does the model's own judgement become a number the student
is shown?* Free Recall looks like grading but fails that test — the model never scores
anything. Feynman passes it.

**Cost was deliberately not the deciding factor.** Across the paper's 50-student study the
entire spread is ~$14 (3.6-flash everywhere) vs ~$3 (Flash-Lite everywhere). The real lever
is that free-tier quota is **per model**, so the split buys separate daily buckets.

**Verified on the live API, 2026-08-01** — the `feynmanImplementationPlan.md` §2 acceptance
table re-run against the new config:

| Case | Required | Result |
|---|---|---|
| jargon-heavy but correct | large accuracy/simplicity gap | 95 / 10 → **+85** |
| simple but wrong | gap inverted | 10 / 70 → **−60** |
| circular / hollow | 30–50, not near 0 | **40** |
| in-domain pseudo-analogy | `analogy_used: false` | **false** |

> **The Feynman coercion layer was kept in full.** A `responseSchema` pins *structure*, never
> *correctness*. `clampScore()`, the `concept_id` echo match, `stripSelfReferentialJargon()`,
> `analogyUsesLessonVocabulary()` and `deriveVerdict()` all still earn their place — the
> analogy backstop exists because the prompt alone once failed, and it must keep holding
> whichever model grades. Do not delete it on the grounds that "we have a schema now."

### Still to do — adaptive test generation (`practice.routes.ts:101`)

```ts
const questionsPayload = await generateJson<{ questions: unknown[] }>(prompt, {
  model: GEMINI_UTILITY_MODEL,
  thinkingLevel: ThinkingLevel.LOW,
  maxOutputTokens: 16384,
});
```

No `temperature`, so no reproducibility question. The one care point: the prompt ends with
*"Use the actual concept_id UUIDs provided above"*, and a wrong `concept_id` silently
corrupts BKT. Validate the returned UUIDs against the ones sent, exactly as the flashcard
generator range-checks its indices.

---

## Operational note: the daily quota is 20, not 1500

Public docs and third-party summaries quote generous free-tier limits. **This key's actual
cap, observed:**

```
429 — Quota exceeded for metric: generate_content_free_tier_requests,
      limit: 20, model: gemini-3.6-flash
```

**20 requests per day** — and note `PerModel` in the quota id. Concept extraction makes one
call per window, so a 100-page module (~12–15 windows) consumes most of a day's budget in a
single upload. Plan testing around this, or enable billing before a defence demo. Embeddings
are metered separately.

**The per-model split multiplies effective headroom.** Because the quota is keyed
`…PerProjectPerModel`, each configured model carries its own 20/day allowance:

| Model | Consumed by | Per submission |
|---|---|---|
| `gemini-3.6-flash` | document extraction, Feynman grading | 1 per Feynman submission |
| `gemini-3.5-flash-lite` | Free Recall extraction + prose | 2 per Free Recall submission |

Free Recall no longer competes with document uploads for the same bucket. And a memoised
resubmission costs **nothing** from either.

---

## Reference

- Deprecations: <https://ai.google.dev/gemini-api/docs/deprecations>
- Gemini 3 migration: <https://ai.google.dev/gemini-api/docs/generate-content/latest-model>
- `EXTRACTION_IMPLEMENTATION.md` — the migrated pipeline, in full
- `CLAUDE.md` § AI Services — the rules that bind new Gemini work
