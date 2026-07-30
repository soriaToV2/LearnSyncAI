# Free Recall — Implementation Reference

> **Status: built, working, verified.** Last updated 30 July 2026.
> This was originally a pre-build plan. It is now a description of what exists.
> Read alongside [feynmanImplementationPlan.md](./feynmanImplementationPlan.md) — the two tabs
> share a layout file and an endpoint, and several rules apply to both.

---

## 1. What the feature does

A student picks one or more educator-published materials, types everything they remember without
looking, and submits. They get back:

- a **coverage score** (0–100%) and a verdict badge
- **three short pieces of written feedback** — what they recalled well, what to look at again, what to try next
- a **collapsed list** of concepts they did not mention
- their own answer, collapsed

**Free Recall never writes BKT mastery.** The paper's Scope section (p. 59) restricts mastery updates
to Adaptive Flashcards and Adaptive Test Mode. `bkt_mastery` has exactly one writer in the whole
codebase: `practice.routes.ts:130`. Do not add a second from `cognitive.routes.ts`.

---

## 2. ⚠️ Read this first — the bug that killed this feature for weeks

`cognitive_logs.student_id` is **`NOT NULL`**, has **no default**, and **no trigger fills it in**.

Until 30 July 2026 not one of the three inserts in `cognitive.routes.ts` supplied it. Every
submission ran the AI, waited, spent the tokens, and then died at the final insert. The live table
held **zero rows** — the feature had never once succeeded end to end.

**If you add any insert to `cognitive_logs`, set `student_id`.** It fails *after* the AI work is
already paid for, which makes it expensive and slow to discover.

---

## 3. The scoring pipeline

```
Student types recall → POST /api/cognitive/free-recall
                       { space_id, material_ids[], user_input }
        ↓
0. GUARDS  requireOwnedSpace() → 404 · rejectInaccessibleMaterials() → 403
        ↓
1. Fetch ALL concepts (id, term, definition, embedding) for the selected material_ids
   → 400 if none, or if none have embeddings yet
        ↓
2. Extract the concepts the STUDENT discussed, from their raw text
   generateJson(extractionPrompt, { temperature: 0 })    ← gemini-2.5-flash
        ↓  (if it returns [] → the "nothing recognisable" path, see §7)
3. Embed each extracted student concept individually
   generateEmbedding()   ← gemini-embedding-001, 3072 dims
        ↓
4. For each reference concept, find its highest cosine similarity against
   any student concept vector.  Covered if >= 0.70, else Missed.
        ↓
5. similarity_score = coveredCount / totalConcepts        (a COVERAGE RATIO)
        ↓
6. Written feedback — findPreviousFeedback() first, else generateRecallFeedback()
   Both are allowed to fail. Neither can take the score down with it.
        ↓
7. INSERT ONE ROW into cognitive_logs (student_id!, material_ids, mode 'free_recall')
        ↓
8. 201 { log_id, similarity_score, score_percent, covered_count, total_concepts,
         missed_concepts[], overall_verdict, written_feedback, feedback_unavailable, created_at }
```

### Cosine similarity is computed in JavaScript, not in the database

`cosineSimilarity()` at `cognitive.routes.ts:59`. **pgvector is used only to store the vectors.**

This contradicts the paper — see §11. Migration `0006` **deliberately dropped** the
`evaluate_recall(vector, uuid[])` function, which was the only thing that ever used the `<=>`
operator. Do not "restore" it thinking you are fixing something.

### pgvector returns strings, not arrays

Supabase hands back the `embedding` column as `"[-0.013,0.024,...]"`. Always pass it through
`parseVector()` before doing maths. `generateEmbedding()` returns a real `number[]` and needs no
parsing.

---

## 4. Why a coverage ratio, and why the bands are so low

Averaging raw cosine scores **inflates everything**. In 3072 dimensions two unrelated vectors still
score ~0.60–0.65 (the "hubness" problem), so an average would hover around 0.65 no matter what the
student wrote. The coverage ratio is honest: it counts concepts actually covered.

**But the denominator is every concept in the material, and extraction is granular.** One real
lesson (`6. Information Security.pdf`) produced **78 concepts**, including supporting detail like
"Radio waves", "Light pulses" and "Electrical signals" that no student writes out from memory.

Measured: a solid four-sentence recall scored **9–13%**. A thorough one scored ~23%.

| Verdict | Threshold | Was |
|---|---|---|
| `strong` | ≥ 0.30 | ~~0.75~~ |
| `partial` | ≥ 0.15 | ~~0.40~~ |
| `needs_review` | below that | — |

**The bands moved; the ratio did not.** This was a deliberate decision (user-approved, 30 July):
keep the number honest and calibrate the label to reality, rather than rescale the score into
looking better than it is.

> Three alternatives were considered and rejected: leaving the bands alone (every student sees
> "Needs Review" on good work), and capping the denominator at the top-N concepts (changes what the
> feature measures from "did you recall the lesson" to "did you recall this part").

**Do not "fix" a 20% score.** It is correct. If a stakeholder finds it demoralising, the answer is
the plain-English count in the banner ("You covered 11 of the 78 ideas in this material"), not a
different formula.

---

## 5. Written feedback (added 30 July 2026)

`generateRecallFeedback()` at `cognitive.routes.ts:153`. One extra `gemini-2.5-flash` call after
scoring, before the insert. Returns `{ strengths, gaps, next_steps }`.

### It must be about *their* submission

The prompt receives four things, which is what makes two same-scoring students get different prose:
the raw text, the concepts extracted **from their words**, the reference concepts they **covered**,
and the ones they **missed**.

### It must NOT recite the missed list

Explicitly instructed. That list is generated against the whole document and is mostly trivia; the
model is told to pick the 2–3 ideas that actually matter and name those in plain language. This is
the same problem §4 describes, solved at the presentation layer.

### It must address the student directly

`- ADDRESS THE STUDENT DIRECTLY as "you" and "your"...` Added 30 July after the Feynman tab was
found writing *"The student's explanation for..."*. Free Recall was only getting second person by
luck — its output rules said the right thing while its field descriptions said "what **they** got
right". Both now say "you".

### Reproducibility is guaranteed by REUSE, not by temperature

**This is the most important subtlety in the file.**

`temperature: 0` pins the *score*, because extraction returns a structured concept list and the 0.70
threshold quantises away whatever variation remains. It does **not** pin *prose*. Measured against
the live model: identical input reliably produced the same score while **rewording its paragraphs
every time**.

So `findPreviousFeedback()` (`cognitive.routes.ts:106`) looks for an earlier attempt by the same
student with the same text, the same materials **and the same resulting score**, and reuses its
prose verbatim.

- Requiring the **score** to match is what stops stale prose being served after an educator edits
  the material underneath it.
- `similarity_score` is a Postgres `NUMERIC` and round-trips as a string — compared with a `1e-9`
  tolerance, not by identity.

> **Testing consequence:** resubmitting the same text returns the OLD feedback. If you change the
> prompt and want to see the new wording, **use different text.** More than one person has been
> confused by this. Feynman has no reuse and always regenerates.

### A failed feedback call must never cost the score

`generateRecallFeedback()` catches its own errors and returns `null`. The call sits **outside** the
scoring `try` block and **before** the insert. So the row is written with score, verdict and missed
list intact, and the response carries `feedback_unavailable: true`. The tab shows a plain note.

Verified by temporarily forcing the call to throw: 10/10 checks passed — 201, score present, verdict
present, missed list present, `written_feedback: null` (not half-written), row saved.

**If you refactor this, keep the ordering.** Moving generation inside the scoring `try` reintroduces
the failure mode the design exists to prevent.

---

## 6. Security — every endpoint enforces it itself

`supabaseAdmin` uses the service-role key, which **bypasses RLS by design**. Migration `0008` says
it outright: *"The API layer must still enforce role and ownership itself."* `requireRole('student')`
only proves the caller is *a* student — nothing about *whose* space or *which* grade's materials.

Before 30 July, all four cognitive endpoints had **no ownership check whatsoever**:

| Hole | What it leaked |
|---|---|
| `GET /history/:spaceId` | **Any student could read any other student's written submissions, scores and feedback** by passing their space id |
| `POST /free-recall` | Returns `missed_concepts[]` — submit gibberish against any material id and every concept comes back "missed", dumping another grade's full concept list |
| `POST /feynman` | Concept terms + AI feedback paraphrasing stored definitions, for any material |
| `POST /recall` (legacy) | Any concept's full `definition` by uuid, no scoping at all — **now deleted** |

Current pattern, applied to all three surviving routes:

```ts
const studentId = await requireOwnedSpace(space_id, req, res);  // 404
if (!studentId) return;
if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;  // 403
```

**404 for the space, 403 for the materials.** A 403 on the space would confirm the id names a real
space; the client already had the material ids it sent.

`GET /history/:spaceId` additionally filters `.eq('student_id', studentId)` — owning the space is
not the same as owning the rows.

⚠️ **Any new route here that accepts a `space_id` or `material_ids` must do both.** There is no
framework enforcing it.

---

## 7. Edge cases

**Nothing recognisable in the submission.** If extraction returns `[]`, the route scores 0, marks
every concept missed, and uses a **fixed in-code message** rather than an AI call — there is nothing
personal to say, it costs nothing, and it cannot fail. `feedback_unavailable` stays `false`, because
the student *did* get feedback.

**Too-short input.** `FreeRecallSchema` requires `user_input` ≥ 10 characters → 400. The frontend
also disables the button.

**Gemini overloaded.** `GeminiUnavailableError` → **503** with a readable message. This was missing
until 30 July; the route returned a raw 500 while Feynman already handled it.

---

## 8. API contract

### `POST /api/cognitive/free-recall`

```jsonc
// request — FreeRecallSchema
{ "space_id": "uuid", "material_ids": ["uuid"], "user_input": "at least 10 chars" }
```

```jsonc
// 201
{ "data": {
    "log_id": "uuid",
    "similarity_score": 0.14,        // 0–1, what goes in the DB
    "score_percent": 14,             // what the ring shows
    "covered_count": 11,             // added 30 July, for the banner sentence
    "total_concepts": 78,
    "missed_concepts": ["Radio waves", "..."],
    "overall_verdict": "needs_review",
    "written_feedback": { "strengths": "...", "gaps": "...", "next_steps": "..." },
    "feedback_unavailable": false,
    "created_at": "..."
} }
```

| Status | Cause |
|---|---|
| 400 | Zod failure; no concepts for the materials; embeddings not ready |
| 401 | Not authenticated |
| 403 | A material id the caller may not read |
| 404 | Space not found **or not owned by the caller** |
| 503 | Gemini overloaded after retries |
| 500 | DB insert or unexpected failure |

### `GET /api/cognitive/history/:spaceId?mode=free_recall|feynman`

Last 20 rows, newest first, **scoped to the caller**. `mode` defaults to `free_recall`. Invalid mode → 400.

---

## 9. Storage — no migration needed

Everything lives in `cognitive_logs`. `ai_feedback` is a **JSON string**, not `jsonb` — `JSON.parse()`
it on the frontend.

```jsonc
// ai_feedback for a free_recall row — see FreeRecallFeedback in server/types/api.ts
{
  "missed_concepts": ["..."],
  "overall_verdict": "needs_review",
  "written_feedback": { "strengths": "...", "gaps": "...", "next_steps": "..." } | null,
  "covered_count": 11,      // optional — absent on rows written before 30 July
  "total_concepts": 78      // optional
}
```

⚠️ **Treat every key inside `ai_feedback` as optional.** The payload has gained fields three times.
`parseFeedback()` in the tab defaults `written_feedback` to `null` and the UI checks
`covered_count !== undefined` before using it. Keep that discipline.

| Column | Value | Note |
|---|---|---|
| `student_id` | the caller | **NOT NULL. See §2.** |
| `space_id` | the space | NOT NULL |
| `material_ids` | what was graded | Was never populated before 30 July |
| `concept_id` | `null` | Correct — a submission spans many concepts |
| `similarity_score` | coverage ratio 0–1 | CHECK constraint enforces 0–1 |
| `mode` | `'free_recall'` | `cognitive_mode` enum |

---

## 10. Frontend

`src/pages/student/studySpaceTabs/FreeRecallTab.tsx` (412 lines), drawing its layout from
`cognitiveShared.tsx`. See §5 of the Feynman doc for the shared-layout contract — it is the same file
and the same rules.

**Study / History toggle in the header. Submitting keeps you in Study** — the result replaces the
composer where the student is already looking. History is a view they choose: an always-visible
attempts list beside the selected attempt (stacked on mobile).

Two selections are tracked deliberately:

| State | Meaning |
|---|---|
| `resultLogId` | the attempt just submitted, shown in Study |
| `historyLogId` | whatever was clicked in the History list |

One shared variable made the two views fight over it. Keep them separate.

Both places render through the same `resultView(log, feedback, showWriteAnother)` helper, so a past
attempt and a fresh one are visually identical. **A slide-over "Past attempts" panel was built and
then removed at the user's request (30 July) — do not reintroduce it.**

Result order: verdict banner → feedback cards → **collapsed** missed list → **collapsed** own answer.
The missed list is collapsed because it runs past 60 entries and buried the feedback worth reading.

Errors: `err instanceof Error ? err.message : ...`. `src/lib/api.ts` is a **`fetch` wrapper** that
throws a plain `Error` — there is no `err.response.data`. An axios-era line was removed on 30 July.

---

## 11. ⚠️ Paper vs code — the paper is wrong here

The capstone paper (pp. 83–84, EQ 5) makes **five claims about Free Recall, and the code contradicts
all five.** This was audited on 30 July and **the recommendation is to rewrite the paper, not the
code.**

| Paper says | Reality |
|---|---|
| Cosine similarity "calculated natively inside the database using pgvector" | Computed in JavaScript. pgvector only stores. |
| "removes the need for complex mathematical scripts in the backend" | The exact opposite. |
| `Cosine Similarity = 1 − (A <=> B)` | `<=>` is never used. Migration 0006 dropped the only function that did. |
| "below a set quality threshold (such as 0.75), a gap exists" | 0.70 is a *per-concept* cutoff; 0.75 was a verdict boundary and is now 0.30. No single "a gap exists" test. |
| "compares the student's typed text directly against the lesson's key glossary terms to spot missing keywords" | No keyword matching anywhere. Missed concepts come from vector comparison. |

**Why the code is better:** the paper describes embedding the whole essay as one vector against one
lesson vector — the context-dilution failure this design was built to avoid — and keyword matching is
strictly weaker than semantic matching (a student who writes "the tiny power plants inside cells" gets
no credit for "mitochondria").

`ARCHITECTURE.md` §5 was corrected on 30 July; it previously contradicted its own §11.

The paper (p. 84) *does* promise feedback "so they know what to review", which the code lacked until
30 July. **There the paper was right and the code was behind.** Now closed.

---

## 12. Known issues NOT fixed — check here before "finding a bug"

1. **Embeddings are generated one at a time.** `for (const ec of extractedConcepts) { await generateEmbedding(...) }`
   at ~line 361. A student raising 10 concepts triggers **10 sequential round trips**. `Promise.all`
   would collapse them into roughly one. **This is very likely the largest single chunk of the wait**
   and is the first thing to fix if latency is the complaint.

2. **`gemini-2.5-flash` is a reasoning model and thinking is on by default.** No thinking budget is
   set anywhere. For "extract the concepts this student mentioned" — a mechanical task — that is
   latency paid for nothing.

3. **All 78 embeddings are fetched from Supabase on every submission.** `select('id, term, definition, embedding')`
   pulls 78 × 3072 floats as strings before any AI call starts.

4. **Nothing writes `activity_logs`.** The table and its streak trigger exist and were backfilled once
   by migration 0005, but **no server route inserts into it**. So no study session of any kind counts
   toward day streaks or total study hours. Affects all five tabs, not just this one. Probably the
   highest-value unfixed item in the codebase.

5. **Free-tier Gemini quota is fatal for real testing.** Measured: `gemini-2.5-flash` free tier is
   **5 RPM / 250k TPM / 20 RPD**. Free Recall costs **2 Flash requests per submission** (extraction +
   feedback), so 20 RPD is **10 submissions per day for the entire school**. The paper plans 50
   students over 2–4 weeks. **Enable billing before any student testing.** Embeddings run on
   `gemini-embedding-001`, a separate model with its own quota.

6. **Latency vs Groq.** Groq's inference is much faster, and Free Recall's *extraction* is the
   mechanical call best suited to a fast model. But it feeds the score, so swapping it risks the
   determinism in §5. Note also that **Groq calls have no retry wrapper at all** — a Groq 429 throws
   raw, unlike Gemini. Adding one would need to come first.

7. **`similarity_score` is a reasonable name here** (unlike Feynman, where it is a misnomer).

---

## 13. Verification

There is **no test suite** in this project. `npm run lint` is `tsc --noEmit`; there is no `npm test`.
Verification has been done with throwaway scripts against the live database, deleted afterwards.

**Rebuilding a harness:** create students with `supabase.auth.admin.createUser`, then upsert
`profiles` — ⚠️ `first_name` and `last_name` are `NOT NULL` with no default, and omitting them makes
the upsert **fail silently**, leaving `grade_level` null, which makes the student invisible to every
material and produces a confusing 403. This cost an hour once.

Test material: `6. Information Security.pdf`, subject `FIL`, grade 9, 78 concepts, all embedded.

What passed on 30 July 2026:

- **28/28** Phase B (security + the `student_id` fix): rows saved and attributed; cross-student
  history → 404; cross-grade material → 403; unowned space → 404; legacy route gone; `bkt_mastery`
  untouched; identical text scored identically.
- **21/21** Phase C (written feedback): three real sentences; grounded in the student's own topics; no
  scoring mechanics leaked into the prose; two different answers got different prose; identical text
  got identical prose; gibberish handled; survives a history round trip.
- **10/10** Phase C fallback, with the feedback call forced to throw.

Manual checks worth repeating:

1. Submit, then `select count(*), student_id from cognitive_logs group by student_id` — must be
   non-zero and attributed.
2. Student A's token against student B's space id → `[]` or 404, never B's text.
3. A Grade-9-only material id from a Grade-8 account → 403, with no concept terms in the body.
4. Same text twice → identical score **and** identical prose.
5. Dashboard mastery before and after → unchanged.

⚠️ **Two traps that cost real time during verification:**
- **Port 5000 held by a stale server.** `npm run dev:server` fails with `EADDRINUSE` but the *test*
  still passes against the OLD process, producing baffling results. Check
  `netstat -ano | grep :5000` and kill the PID before trusting a run.
- **Quota exhaustion looks like a code bug.** Three "failures" turned out to be 429/503 from Google.
  Probe directly before debugging: a one-line `generateContent` call reveals `429 ... limit: 20`.

---

## 14. Related documents

- [feynmanImplementationPlan.md](./feynmanImplementationPlan.md) — the sibling tab; shares
  `cognitive.routes.ts`, `cognitiveShared.tsx` and the history endpoint
- [STUDENT_RESOURCES_IMPLEMENTATION.md](./STUDENT_RESOURCES_IMPLEMENTATION.md) — where
  `materialAccess.ts` came from and the full access-control model
- `ARCHITECTURE.md` §5 and §11 — the algorithm of record
- `CLAUDE.md` — the "Cognitive Tabs" section and the non-negotiable rules
- `supabase/migrations/20260723090006_cognitive_chat_games.sql` — added `student_id NOT NULL`, dropped `evaluate_recall()`
