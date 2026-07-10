# Feynman Technique — Backend Implementation Plan

## Overview

The Feynman Technique tab lets a student pick a learning material, choose one or more concepts from it, and explain each concept **in their own words** to a chosen audience. The AI then grades every explanation and returns structured coaching feedback.

Before this work, [FeynmanTab.tsx](file:///d:/projects/LearnSyncAI/src/pages/student/studySpaceTabs/FeynmanTab.tsx) was entirely mocked — a `setTimeout` with a hardcoded neurobiology jargon list. The legacy `POST /api/cognitive/recall` endpoint existed but did not fit: it graded exactly **one** `concept_id` via cosine similarity and wrote raw prose into `ai_feedback`. The tab needed **many concepts per submission** and **structured** feedback fields.

This document records what was built, why, and what was learned from testing.

---

## The Central Design Decision: Two Independent Scores

The Feynman Technique asks a student to explain something simply. But *simple* and *correct* are independent properties:

- An explanation can be **beautifully simple and completely wrong**.
- An explanation can be **technically flawless and useless to its audience**.

If these are averaged into one number, both failures hide behind a mediocre score. So every concept is graded on **two independent 0–100 axes**:

| Axis | Question it answers | Graded against |
|---|---|---|
| `accuracy_score` | Is what the student asserted **true**? | The concept's stored `definition` in the DB |
| `simplicity_score` | Does it **suit the chosen audience**? | The audience rubric |

The prompt explicitly instructs the model not to let one score drag the other. This was verified in testing (see [Testing Results](#testing-results)).

---

## Why NOT Embeddings

Free Recall uses `gemini-embedding-001` and cosine similarity because its question is *"did you cover the material?"* — a **coverage** measurement.

Feynman asks a different question, and **cosine similarity cannot answer it**:

- A student who **parrots the textbook definition verbatim** scores ~0.95 similarity while completely failing the Feynman exercise.
- Cosine similarity is **blind to jargon** — it cannot tell whether a 10-year-old could follow the text.
- Cosine similarity is **blind to misconceptions** — a fluent, confidently wrong explanation sits close to the correct one in vector space.

Because this endpoint never touches the `embedding` column, none of the `parseVector()` / 3072-dim / hubness caveats from Free Recall apply here.

Instead, we **ground the LLM** by injecting each concept's authoritative `definition` from the `concepts` table directly into the prompt as ground truth. This is what makes the accuracy score trustworthy rather than a reflection of the model's own recollection of the topic.

---

## AI Model Decisions

| Concern | Choice | Reason |
|---|---|---|
| **Grading (accuracy, simplicity, jargon, feedback, analogy)** | `gemini-2.5-flash` via `generateJson()` | Already in `gemini.ts`. Native `responseMimeType: 'application/json'` guarantees parseable structured output with per-concept nesting. One call per submission. |
| **Determinism** | `temperature: 0` | A student resubmitting identical text must receive an identical score. See [Determinism](#determinism-temperature-0). |
| **Embeddings** | **Not used** | See [Why NOT Embeddings](#why-not-embeddings). |
| **Groq (`llama-3.1-8b-instant` / `llama-3.3-70b-versatile`)** | **Not used** | Groq's streaming model serves the chat assistant, where latency is felt keystroke-by-keystroke. Feynman is a one-shot request behind a spinner. It needs reliable nested JSON more than it needs speed. |

---

## Workflow

```
Student selects material → GET concepts → picks N concepts → writes an explanation for each
                                    ↓
                    POST /api/cognitive/feynman
                    { space_id, material_ids[], audience, explanations: [{concept_id, explanation}] }
                                    ↓
1. Zod validation (FeynmanEvaluationSchema) → 400 on failure
                                    ↓
2. Reject duplicate concept_ids in one submission → 400
                                    ↓
3. Look up authoritative `term` + `definition` from the concepts table,
   scoped by .in('material_id', material_ids)
   → 400 if any submitted concept is not found in the selected materials
                                    ↓
4. Build ONE grounded prompt: audience rubric + anchored accuracy bands
   + [{term, true_definition, student_explanation}] for every concept
                                    ↓
5. generateJson(prompt, { temperature: 0 })   ← gemini-2.5-flash
   (auto-retries on transient 429/5xx with exponential backoff)
                                    ↓
6. Coerce the model output — never trust it to hold its schema:
   - clamp scores to 0–100 integers
   - DERIVE verdict from accuracy (do not accept the model's verdict)
   - strip self-referential jargon
   - match results on echoed concept_id, fall back to positional order
                                    ↓
7. Insert ONE row into cognitive_logs (mode: 'feynman', concept_id: null)
   similarity_score = mean accuracy as 0–1
   ai_feedback = JSON.stringify(payload)
                                    ↓
8. Return 201 { log_id, created_at, ...feedbackPayload }
```

---

## Security: Server-Side Grounding

The client sends **only `concept_id`** — never the term or the definition.

The server looks both up from the `concepts` table, scoped by `.in('material_id', material_ids)`. This means:

- A client **cannot** grade itself against a definition it invented.
- A client **cannot** reach a concept belonging to a material it did not select.
- Any mismatch between the number of requested and found concepts returns a `400`.

---

## Audience Rubrics

The audience swaps the **rubric**, never the output schema. Defined as `AUDIENCE_RUBRICS` in `cognitive.routes.ts`.

### `10yr_old`
- Every technical term used without being unpacked in plain words is **jargon**. Flag it.
- Reward concrete, everyday analogies (dominoes, mailboxes, cargo ships).
- A textbook-accurate explanation a child could not follow scores **LOW on simplicity**, no matter how correct.
- Always supply an `analogy_idea` a child would grasp.

### `self`
- Technical terms are **ALLOWED and expected**. Only flag a term as jargon if the student leans on it as a **substitute** for explaining the mechanism (name-dropping).
- Score simplicity on **mechanistic clarity**: did they explain *why* and *how*, step by step, or recite memorised terminology?
- Reward causal chains. Penalise circular definitions and restated textbook phrasing.
- `analogy_idea` becomes a **probing question** — a level of mechanism they should push into.

> The `self` rubric is what makes this feature more than a readability checker. It targets the exact failure the Feynman technique exists to expose: fluent recitation without understanding.

---

## The Accuracy Scale (Anchored Bands)

The first version told the model to *"penalise misconceptions, reversed cause and effect, and missing essential steps"* with **no scale anchors**. The model improvised its own cut points, and the result was incoherent:

- A **circular but true** CSRF explanation scored **0**.
- A **true but mechanism-free** File Inclusion explanation scored **90**.

Vacuousness was punished at 0 in one case and rewarded at 90 in another. Worse, a hollow answer scored **identically to a confidently false one** — a student could not tell whether they had said *nothing* or said something *wrong*. Those demand opposite remedies.

The prompt now anchors the bands explicitly:

| Band | Meaning |
|---|---|
| **0–20** | The explanation **ASSERTS something FALSE**. Describes a different concept, reverses cause and effect, or contradicts the definition. |
| **30–50** | Everything asserted is **TRUE, but hollow** — restates the term, defines it circularly, names it without explaining any mechanism. |
| **55–75** | Everything asserted is **TRUE with real mechanism**, but an essential step or condition is missing. |
| **80–100** | **Accurate AND covers the essential mechanism.** |

> **CRITICAL instruction in the prompt:** *"An explanation that says too little is NOT the same as an explanation that says something wrong. Never score below 30 unless you can quote the specific false statement the student made. Vagueness, circularity, and omission are capped at 50 — they are not zeros."*

Emptiness is relocated to the **simplicity** axis, where it belongs — that is the axis the `self` rubric already scores on mechanistic clarity.

---

## Verdict Is Derived, Never Requested

`verdict` is computed in TypeScript from `accuracy_score` by `deriveVerdict()`:

| Accuracy | Verdict |
|---|---|
| ≥ 80 | `correct` |
| 30 – 79 | `needs_improvement` |
| < 30 | `incorrect` |

**Why derived?** When we asked the model for a verdict directly, it **leaked the simplicity axis into it**. A jargon-heavy but flawless Physical Layer explanation returned `needs_improvement` on an accuracy of **100**, which rendered an amber badge above a perfect score.

`coerceVerdict()` did not catch it because `needs_improvement` is a *syntactically valid* verdict — the fallback only fired on garbage. The lesson: **never ask a model for a value you can compute deterministically from a number it already gave you.** The prompt no longer requests the field at all.

---

## Defensive Coercion

Model output is treated as untrusted. In `cognitive.routes.ts`:

| Helper | Purpose |
|---|---|
| `clampScore()` | Coerce to a 0–100 integer. Non-finite → 0. |
| `deriveVerdict()` | Compute verdict from accuracy. Never reads the model's verdict. |
| `coerceStringArray()` | Filter `jargon_found` to non-empty strings. |
| `stripSelfReferentialJargon()` | Remove the concept's own name, its parenthetical-stripped form, and its acronym. |
| `mean()` | Aggregate per-concept scores into submission-level scores. |

Per-concept results are matched on the **echoed `concept_id`**, with **positional order as fallback**. This matters: in testing the model returned concepts in a different order than the prompt listed them, and ID-matching absorbed it silently.

### `stripSelfReferentialJargon()`

When an explanation is circular, the model flags the concept's own name as jargon. But the student was *asked* to explain that term — naming it cannot be jargon. CSRF's list came back as `["Cross-Site Request Forgery", "CSRF"]`.

The prompt forbids this **and** the code enforces it. For `"Cross-Site Request Forgery (CSRF)"` it forbids:
- `cross-site request forgery (csrf)` — the full term
- `cross-site request forgery` — parenthetical stripped
- `csrf` — the parenthetical contents

It correctly **keeps** `"OSI reference model"` on a Physical Layer explanation, because that is the student's own phrasing, not the concept's title (`"Physical Layer (OSI Model)"`).

---

## Reliability: Retry on Transient Failures

Gemini returns `503 UNAVAILABLE` when `gemini-2.5-flash` is over capacity — common on the free tier. Originally `generateJson()` made **one** attempt, threw, and the route passed Google's raw JSON straight to the browser, where the student saw:

```
{"error":{"code":503,"message":"This model is currently experiencing high demand..."}}
```

### `withRetry()` in [gemini.ts](file:///d:/projects/LearnSyncAI/server/lib/gemini.ts)

Wraps **all four** helpers — `generateEmbedding`, `generateContent`, `generateJson`, `generateJsonFromDocument`. Every feature (Free Recall, concept extraction, chatbot, practice tests) inherits it.

- Retries up to **4 attempts** on transient statuses: `429, 500, 502, 503, 504`.
- **Exponential backoff with jitter**: ~1s, 2s, 4s, plus up to 250ms random. Jitter prevents concurrent requests from retrying on the same tick and re-hammering a struggling endpoint.
- Non-transient errors (bad API key, malformed prompt) **rethrow immediately** — retrying those only wastes the user's time.
- On exhaustion, throws a typed **`GeminiUnavailableError`**.

The Feynman route maps `GeminiUnavailableError` → **HTTP 503** with a human message. The frontend additionally refuses to render any error string that begins with `{`, as a second line of defence against leaking upstream payloads.

---

## Determinism (`temperature: 0`)

Identical submissions were receiving different scores. File Inclusion Attacks scored **70** on one run and **85** on the next — the same text, the same audience. That 15-point drift **crosses the 80 band boundary**, flipping the badge between "Needs Improvement" and "Correct."

This is ordinary LLM sampling variance, not a logic error. But a grade that changes on resubmit is indefensible.

`generateJson()` now accepts an optional second argument:

```ts
export interface GenerateJsonOptions {
  temperature?: number;
}

export async function generateJson<T>(prompt: string, options: GenerateJsonOptions = {}): Promise<T>
```

The Feynman route opts in:

```ts
const raw = await generateJson<RawFeynmanResponse>(prompt, { temperature: 0 });
```

### Why opt-in rather than a global default

`generateJson()` has three callers:

| Caller | Temperature | Rationale |
|---|---|---|
| Feynman grading | `0` | A grade must be reproducible. |
| Free Recall concept extraction | *default* | Unchanged. |
| Adaptive test question generation | *default* | Regenerating a test should produce **fresh** questions. Variance is a feature. |

Implemented with a **conditional spread**, so the key is omitted entirely when unset rather than sent as `temperature: undefined`:

```ts
...(options.temperature !== undefined && { temperature: options.temperature }),
```

This also ensures `temperature: 0` survives — a naive truthiness check would swallow it as falsy.

> **Flashcard generation is unaffected.** It runs on `llama-3.3-70b-versatile` via [groq.ts](file:///d:/projects/LearnSyncAI/server/lib/groq.ts) and never calls `generateJson()`.

---

## API Contract

### `POST /api/cognitive/feynman`

**Request** — validated by `FeynmanEvaluationSchema` in [api.ts](file:///d:/projects/LearnSyncAI/server/types/api.ts):

```json
{
  "space_id": "uuid",
  "material_ids": ["uuid"],
  "audience": "10yr_old",
  "explanations": [
    { "concept_id": "uuid", "explanation": "at least 10 characters" }
  ]
}
```

**Response** — `201`:

```json
{
  "data": {
    "log_id": "uuid",
    "created_at": "2026-07-10T06:41:16.158Z",
    "audience": "10yr_old",
    "accuracy_score": 73,
    "simplicity_score": 75,
    "overall_feedback": "Your explanations show a strong ability to use analogies...",
    "jargon_found": ["OSI reference model", "voltage levels"],
    "concepts": [
      {
        "concept_id": "uuid",
        "term": "Physical Layer (OSI Model)",
        "accuracy_score": 90,
        "simplicity_score": 0,
        "verdict": "correct",
        "jargon_found": ["unstructured raw bitstreams", "modulation scheme employed"],
        "feedback": "Your explanation is highly accurate... but reads like a textbook definition.",
        "analogy_idea": "Imagine two friends talking using cups and a string..."
      }
    ]
  },
  "message": "Feynman explanation evaluated successfully"
}
```

**Error responses:**

| Status | Cause |
|---|---|
| `400` | Zod validation failed / duplicate `concept_id` / concept not in selected materials |
| `401` | Not authenticated (`router.use(authenticate, requireRole('student'))`) |
| `503` | Gemini overloaded after all retries (`GeminiUnavailableError`) |
| `500` | Any other failure (DB insert, unexpected error) |

### `GET /api/cognitive/history/:spaceId?mode=feynman`

Previously **hardcoded** to `.eq('mode', 'free_recall')` — Feynman logs would have been written and then never displayed. Now accepts a `mode` query param, **defaulting to `free_recall`** so `FreeRecallTab` keeps working untouched. Invalid modes return `400`.

---

## Database

**No migration required.**

| Column | Value for Feynman | Note |
|---|---|---|
| `mode` | `'feynman'` | Free-text `TEXT` column — already permitted |
| `concept_id` | `null` | Already nullable. A submission spans several concepts; the per-concept breakdown lives inside `ai_feedback`. |
| `similarity_score` | mean accuracy as `0–1` | Matches the convention Free Recall uses for this column. **The column name is a Free Recall inheritance and is a misnomer here** — nothing is compared by similarity. |
| `ai_feedback` | `JSON.stringify(FeynmanFeedback)` | Must be `JSON.parse()`d on the frontend, per the rule in `CLAUDE.md`. |

One row is written per **submission**, not per concept.

---

## Frontend

### [MODIFY] [StudySpace.tsx](file:///d:/projects/LearnSyncAI/src/pages/student/StudySpace.tsx)

Pass `spaceId={spaceId!}` to `<FeynmanTab />`. Without it there is no way to write a `cognitive_logs` row.

### [MODIFY] [FeynmanTab.tsx](file:///d:/projects/LearnSyncAI/src/pages/student/studySpaceTabs/FeynmanTab.tsx)

| Change | Detail |
|---|---|
| Removed the mock | The `setTimeout` evaluator and its hardcoded jargon list are gone. |
| Re-keyed state | `explanations` is keyed by **`concept_id`**, not display term. This is what enables server-side grounding. |
| Concept selection required | The `__general__` free-write textarea path was removed. With no concepts selected, an empty state distinguishes three cases: no material chosen, material still processing, or concepts loaded but none picked. |
| Client-side gating | Evaluate stays disabled until **every** selected concept has ≥ 10 characters, matching the Zod `min(10)`. Shows an inline *"N concepts still need an explanation"* hint rather than provoking a 400. |
| Real history | Loads `GET /cognitive/history/:spaceId?mode=feynman` on mount, `JSON.parse`s `ai_feedback` defensively (returns `null` on malformed JSON, rendering a fallback panel). |
| Two score rings | `ScoreRing` renders Accuracy and Simplicity side by side. |
| Per-concept cards | Each concept gets a colour-coded verdict badge, both scores, feedback, its own jargon chips, and its analogy idea. |
| Safe errors | Any error message starting with `{` is replaced with a generic retry prompt. |

**Data flow note:** `src/lib/api.ts` is a `fetch` wrapper (not axios, despite `CLAUDE.md`) that unwraps the `{ data }` envelope. So `res.data` is already the payload.

---

## Testing Results

Tested against material `6. Information Security.pdf` with explanations deliberately engineered to probe distinct failure modes.

### Axis independence — confirmed

| Concept | Audience | Accuracy | Simplicity | Verdict | What it proves |
|---|---|---|---|---|---|
| Physical Layer | `10yr_old` | **90** | **0** | correct | Correct but incomprehensible → axes do not collapse |
| Transport Layer | `10yr_old` | **0** | **85** | incorrect | Fluent, simple, and **false** → grounding works |
| SQL Injection | `self` | **95** | **90** | correct | Dense jargon **not penalised** under `self` |
| Network Layer | `self` | **0** | **85** | incorrect | Accuracy is **audience-independent** |

The Transport Layer feedback named the specific error unprompted: *"your explanation describes the jobs of other layers (like the Physical and Network Layers)."* Nothing told the model which layers were conflated — that is grounding against the stored `definition`, not pattern-matching on tone.

### The anchored-bands fix — confirmed

| Concept | Before | After |
|---|---|---|
| **CSRF** (true but hollow) | acc `0` | acc **`40`**, `needs_improvement` |
| **Network Layer** (asserts false) | acc `0` | acc **`0`**, `incorrect` |
| **File Inclusion** (missing mechanism) | acc `90` | acc **`70`→`85`**, drifted (see below) |

CSRF and Network Layer both sat at `0` before and are now **40 points apart**. Hollow and false are finally distinguishable. CSRF scored exactly `40` on two consecutive runs — reproducible, not a fluke of one sampling.

### The derived-verdict fix — confirmed

All **ten** concepts across both runs now have verdicts that agree with their accuracy bands. Physical Layer's accuracy `90` correctly yields a green **Correct** badge beside its `0` simplicity — the intended diagnosis: *factually flawless, useless to a child.*

---

## Known Limitations

1. **`space_id` ownership is not verified.** Any authenticated student could write a log into another student's space. `supabaseAdmin` bypasses RLS. **The existing `/free-recall` handler has the identical gap** — this was matched rather than silently fixed. Worth a follow-up across both routes.

2. **`similarity_score` is a misnomer** for Feynman rows. It stores mean accuracy, and nothing is compared by similarity.

3. **`stripSelfReferentialJargon()` over-strips slightly.** For `"Physical Layer (OSI Model)"` it removes a literal `"OSI Model"` chip, which arguably *is* jargon to a 10-year-old. Accepted trade: the parenthetical is a disambiguator, not a claim the student made.

4. **Defense-in-Depth scored 50–65 across runs** — arguably hollow name-dropping belonging in the 30–50 band. Left alone: the student *did* assert the true core claim (that it layers multiple measures), and its simplicity score of 20–30 already punishes the buzzword-stuffing. Tightening further risks pushing genuinely partial answers into "wrong" territory.

5. **Legacy `POST /api/cognitive/recall` is now dead code** for this tab. Retained only in case an older client calls it.

---

## Verification Plan

1. Upload a PDF and wait for concept extraction to finish.
2. Open the Feynman tab, select that material — concepts should populate the picker.
3. Select **zero** concepts → confirm the empty state, and that Evaluate is disabled.
4. Select 2+ concepts, leave one explanation under 10 characters → confirm Evaluate stays disabled and the *"N concepts still need an explanation"* hint appears.
5. Fill all explanations, set audience to **10-Year-Old**, click Evaluate.
6. Submit a **jargon-heavy but correct** explanation → expect high accuracy, low simplicity, many jargon chips, green **Correct** badge.
7. Submit a **simple but factually wrong** explanation → expect low accuracy, high simplicity, red **Incorrect** badge.
8. Re-run the **same text** with audience **Myself** → simplicity on the jargon-heavy answer should rise sharply; accuracy on the wrong answer must **not** move.
9. Resubmit an identical explanation twice → scores must be **identical** (`temperature: 0`).
10. Reload the page → the sessions appear in the History panel with both score rings intact.
