# Free Recall — Implementation Reference

> **Status: built, working, verified end to end against real submissions.** Last updated 6 August 2026.
> This was originally a pre-build plan. It is now a description of what exists.
> Read alongside [feynmanImplementationPlan.md](./feynmanImplementationPlan.md) — the two tabs
> share a layout file and an endpoint, and several rules apply to both.
>
> **6 August 2026 was a large revision.** Scoring is unchanged, but the extraction step, the
> feedback shape, the verdict and several correctness bugs all moved. If you are reading a section
> that contradicts the code, check §15 (Change log) first — it lists what changed and why, with the
> measurements behind each decision.

---

## 1. What the feature does

A student picks **exactly one** educator-published material, types everything they remember without
looking, and submits. They get back:

- a **coverage score** (0–100%) with the plain count beside it — "20 of 29 ideas"
- a **progress line** comparing this attempt to their own previous attempt **on the same material**
- **one passage of written feedback**, ending with a concrete next step and the page it is on
- a **"Worth double-checking"** note when something they wrote contradicts the lesson — usually absent
- a **collapsed list** of concepts they did not mention
- their own answer, collapsed

**One material, not several.** `FreeRecallSchema` caps `material_ids` at 1 and the UI uses a
single-select control. A coverage ratio is only meaningful against one denominator.

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
1b. MEMO CHECK — identical resubmission? serve the stored result, skip steps 2-6 entirely
   findMemoisedAttempt()   ← keyed on text + materials + concept fingerprint
        ↓  (miss)
2. Extract the ideas the STUDENT wrote, from their raw text
   generateJson(extractionPrompt)   ← gemini-3.5-flash-lite, LOW thinking, 8192 tokens
   MUST BE GRANULAR — one item per idea, never one per paragraph. See §4a.
        ↓  (if it returns [] → the "nothing recognisable" path, see §7)
3. Embed every extracted point — IN PARALLEL, 8 at a time
   embedAll()   ← gemini-embedding-001, 3072 dims
        ↓
4. For each reference concept, find its highest cosine similarity against
   any student point.  Covered if >= 0.70, else Missed.
   Same pass records, for each STUDENT point, its 2 nearest concepts (§5b).
        ↓
5. similarity_score = coveredCount / totalConcepts        (a COVERAGE RATIO)
        ↓
6. Written feedback — generateRecallFeedback()   ← gemini-3.5-flash-lite, MEDIUM thinking, 6144
   Receives the lesson's own definitions and a concept→page index.
   Allowed to fail. Cannot take the score down with it. (Reuse happens at 1b now.)
        ↓
7. INSERT ONE ROW into cognitive_logs (student_id!, material_ids, mode 'free_recall')
        ↓
8. 201 { log_id, similarity_score, score_percent, covered_count, total_concepts,
         missed_concepts[], overall_verdict, written_feedback, feedback_unavailable, created_at }
```

### Embeddings run in parallel — do not turn this back into a loop

`embedAll()` runs 8 concurrently. It was `for (const ec of extractedConcepts) { await … }`, which
made it **the slowest stage of the whole request**: measured on a real submission, 29 points took
**11.5s sequential against 1.5s parallel** — 75% of everything spent before the feedback call, for
calls that are entirely independent.

Bounded at 8 rather than an unbounded `Promise.all`: a long answer can extract 60+ points, and
firing all of them at once risks a rate-limit burst costing more than the serialisation saved.

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

Measured on that lesson: a solid four-sentence recall scored **9–13%**. A thorough one scored ~23%.

**Do not "fix" a 20% score.** It is correct. The answer to "that looks demoralising" is the plain
count beside it ("20 of 29 ideas"), not a different formula.

### ⚠️ The verdict bands were REMOVED on 6 August. Do not reintroduce them.

There used to be absolute bands — `strong ≥ 0.30`, `partial ≥ 0.15` — tuned against that
78-concept lesson. **The thresholds were fixed; the denominator is not.** Applied to a 29-concept
material they put these two attempts in the same "Strong" band:

| Material | Concepts | Result | Old label |
|---|---|---|---|
| 7 | 29 | 25 covered = **86%** | Strong |
| 6 | 28 | 10 covered = **36%**, *containing two factual errors* | Strong |

A document broken into 78 fine-grained concepts yields a far lower ratio than one broken into 28,
for identical recall. **Any fixed constant is wrong for the next material uploaded**, so no
constant replaced it.

`overall_verdict` is still computed and stored — the payload shape and `FreeRecallFeedback` are
unchanged and the distribution stays available for analysis — but **nothing displays it.**

### What replaced it: the student against their own earlier attempt

`progressLine()` in `FreeRecallTab.tsx`. Same student, same material, same denominator — the one
comparison that needs no calibration, and improvement across attempts is exactly what retrieval
practice is meant to produce.

- Matches on **`material_ids`**, which is why `GET /history` selects that column. A space can hold
  attempts against several materials and their denominators differ.
- Compares **`covered_count`, not percentages** — "18 → 25 ideas" is more concrete to a 14-year-old.
- **Refuses to compare when `total_concepts` differs.** An educator editing the material changes
  what the number is out of.
- Claims a direction only past a noise floor of `max(2, ceil(total × 0.1))`. Extraction is a
  sampling call: re-running the *same text* measured **14, 16 and 17** covered across three runs of
  one submission — a spread of 3 on 28 concepts. Below the floor it reads "About the same".
- A drop is **amber, never red.** A dip between attempts is ordinary.

### The score ring uses ONE FIXED tone

Emerald, always, regardless of value — and *fixed* is the requirement, not the particular colour.
A tone that varied with this percentage would reintroduce the bug one layer down: an attempt on a
coarsely-split material would outrank a better attempt on a granular one purely because of how the
document was divided. **Do not swap it for `scoreTone()`; its 80/60 cutoffs are absolute too.**
Meaning lives on the progress line and on `corrections`.

---

## 4a. ⚠️ Extraction must stay GRANULAR — the most load-bearing prompt in the feature

Step 2 turns the student's prose into discrete points. **Each point becomes one vector**, and a
point that summarises a whole paragraph embeds as an average of everything in it, so no individual
concept inside it clears 0.70.

Measured on a real six-paragraph submission:

| Prompt | Points extracted | False misses |
|---|---|---|
| Coarse (the original) | 8 | **5** |
| Granular (current) | 25 | **0** |

The five false misses included `Reduces Downtime` and `Saves Money and Resources` — from a sentence
that reads *"the benefits are that it minimises the damage, reduces downtime, protects data and
privacy, and saves money."* The student wrote the words verbatim and was told they had forgotten
them.

The rule that carries it: **if the student lists several things — steps, phases, benefits, types,
layers — return EACH as its own item, even in a single sentence.** Educator-side extraction stores
each item of an enumeration as its own concept (`Preparation`, `Containment`, `Reduces Downtime`),
so a student listing them must be split the same way or the two sides cannot line up.

This is also why the call runs at `ThinkingLevel.LOW` with `maxOutputTokens: 8192`. Thinking off
will not split a list, and a budget sized for coarse output truncates mid-array — which surfaces as
unparseable JSON, not a clean error.

**Naming a concept is not covering it.** The prompt records "they only named it without
elaborating" verbatim, which embeds far from a substantive definition. A student who lists "the
data link layer, the network layer and the transport layer" without saying what they do is
correctly marked missed on all three. Free Recall measures retrieval, not vocabulary.

---

## 5. Written feedback

`generateRecallFeedback()`. One extra `GEMINI_UTILITY_MODEL` call after scoring, before the insert.
Returns **`{ feedback, corrections }`** — one prose passage plus an accuracy note that is usually
empty.

### ⚠️ It is ONE prose field. Do not split it again.

The history is worth knowing, because the obvious instinct is to add fields back:

| Shape | Outcome |
|---|---|
| `strengths` / `gaps` / `next_steps` | **`next_steps` paraphrased `gaps` in 4 of 4 logged attempts** ("you left out injection" → "review injection"). A third of the output carried no information — which is why the feedback read thin. The sentence cap was never the problem. |
| `summary` / `next_steps` | Better, but the separate action field was kept on the theory that a concrete next step would be crowded out of a free passage. |
| `feedback` (current) | **That theory was measured and disproved.** Run on two stored submissions including a 28/28 attempt with no obvious gap to point at, the merged prompt still closed with "try reviewing Injection on page 24" and "review security headers on page 39". |

That is what forced structure does: the model must fill a slot, has nothing new, and repeats.
**A field per idea is not what makes feedback rich.**

The passage runs **four to five sentences** and must weave what landed with what did not. Do not
reinstate a praise half followed by a criticism half — the split is where the repetition bred.

### It must be about *their* submission

The prompt receives the raw text, the points extracted **from their words**, the concepts they
**covered**, the ones they **missed** with pages, a **concept→page index**, and — critically — the
lesson's own **definitions** matched to each point (§5b).

### It must NOT recite the missed list

Explicitly instructed. That list is generated against the whole document and is mostly trivia; the
model is told to pick the 2–3 ideas that actually matter and name those in plain language.

### The covered list decides what counted

Added 6 August after a real failure. A student pasted **material 6's content while material 7 was
selected** — scored 0/29, correctly — and the feedback replied *"You explained how cybersecurity
protects computer systems and networks, and you gave a clear definition of defense-in-depth."* It
was praising material 6's concepts while scoring zero on material 7.

The prompt receives two things that can disagree — the raw answer, and the covered list — and
nothing said which one decides. It now does: **never describe a point as recalled unless it appears
in the covered list.** When coverage is zero, an explicit block states that the content belongs to
a different material, that it will *look* correct, and that it must not be praised. The model reads
past a bare `COVERED (0)`; it does not read past that.

The framing matters: *"your answer is not wrong, it is simply not what we covered here today."*
Their cybersecurity was accurate. Telling a student they are wrong when they are not would be its
own failure.

### It must close with a page-anchored action

`concepts.source_pages` reaches the prompt twice — inline on the missed list, and as a full
concept→page index. **The index exists because of a measured gap:** pages were originally supplied
only for *missed* concepts, so two 100%-coverage attempts produced *"review the section on access
control in your lesson materials"* — the model correctly declining to invent a page it had not been
given. Pages may be cited **only** from that index.

Since no schema field guarantees the closing sentence any more, **check it survived** when changing
this prompt. Verified across three profiles (12/28, 28/28, 4/28): four to five sentences, page
cited, action in the final sentence, every time.

### It must address the student directly

`- ADDRESS THE STUDENT DIRECTLY as "you" and "your"...` Added 30 July after the Feynman tab was
found writing *"The student's explanation for..."*. Free Recall was only getting second person by
luck — its output rules said the right thing while its field descriptions said "what **they** got
right". Both now say "you".

### Reproducibility is guaranteed by REUSE, not by temperature

**This is the most important subtlety in the file** — and as of 2026-08-01 it is the *only*
mechanism, not a supplement to one.

Historically `temperature: 0` pinned the *score* while reuse pinned the *prose*. **Gemini 3 dropped
the sampling parameters**, so `temperature` is gone and reuse now carries both. That is deliberate:
it makes reproducibility a property of this code rather than of whichever model is configured, which
is exactly what made the model swap safe.

`findMemoisedAttempt()` (replacing `findPreviousFeedback()`) runs **before any AI call** and matches
on same student, same mode, same text, same materials, and the same **concept fingerprint**.

- **The fingerprint replaced score-matching.** The old code required the resulting *score* to match,
  which meant it had to run *after* scoring and needed a `1e-9` tolerance because `similarity_score`
  is a Postgres `NUMERIC` that round-trips as a string. `fingerprintConcepts()` answers the same
  question — *has the material changed underneath this?* — directly, earlier, and exactly.
- **Why a content hash and not a timestamp:** `concepts` has **no `updated_at` column**, so an
  educator editing a definition changes nothing observable. The hash covers id + term + definition.
- **A hit costs zero API calls** (previously 2 plus one embedding per student concept) and still
  writes a log row, so history is unchanged.
- Rows written before `concepts_fingerprint` existed are never reused — they cannot be proven current.

> **Testing consequence (unchanged, and now stronger):** resubmitting the same text returns the OLD
> result — and no longer even calls the model. If you change the prompt and want to see new wording,
> **use different text.** More than one person has been confused by this. **Feynman now memoises too**
> (it previously always regenerated), so the same applies there.

### A failed feedback call must never cost the score

`generateRecallFeedback()` catches its own errors and returns `null`. The call sits **outside** the
scoring `try` block and **before** the insert. So the row is written with score, verdict and missed
list intact, and the response carries `feedback_unavailable: true`. The tab shows a plain note.

Verified by temporarily forcing the call to throw: 10/10 checks passed — 201, score present, verdict
present, missed list present, `written_feedback: null` (not half-written), row saved.

**If you refactor this, keep the ordering.** Moving generation inside the scoring `try` reintroduces
the failure mode the design exists to prevent.

---

## 5b. `corrections` — coverage is not correctness (added 6 August 2026)

Cosine measures whether the student wrote *about* a concept, not whether they were **right**.
Measured against the real stored definitions:

| Statement | Score vs the concept it is wrong about | Result |
|---|---|---|
| "RA 10175 is the Data Privacy Act" | **0.7175** | **counted as covered** |
| "The physical layer is the top layer… it handles passwords" | **0.7474** | **counted as covered** |
| "The session layer is where the cables plug in" | 0.6982 | missed |
| "Injection is when a hacker plugs in a USB stick" | 0.6090 | missed |

So a confidently wrong answer either **scores points** or is reported as **forgetfulness** — and
either way the misconception is never surfaced. Worse, the feedback writer had **no definitions at
all**, so with a wrong statement in the covered list it could *praise the error back to the student*.

`corrections` fixes the prose half. **It never moves the score.** `similarity_score` stays a pure
cosine computation, which keeps it deterministic given the extraction and keeps this call on
`GEMINI_UTILITY_MODEL` — the rule in `CLAUDE.md` turns on whether the model's judgement becomes *a
number the student is shown*, and this one only ever becomes words.

### The pairing is a TERM LOOKUP FIRST, vectors only as fallback

For each student point the prompt needs the lesson text that could settle it. That comes from:

1. **`conceptIdxByAlias`** — the name the student used, resolved straight to the concept. Aliases
   come from extraction's own `foldKey`/`acronymOf` (exported for this), so a student typing
   "SSDLC" lands on `SECURE SOFTWARE DEVELOPMENT LIFE CYCLE (SSDLC)`. **Do not write a second copy
   of that rule here.**
2. **The top TWO nearest by cosine**, ignoring `COVERAGE_THRESHOLD`, for claims they described
   without naming.

**Vectors alone are not enough, and this was measured.** Nearest-only was tried first and missed
the USB/Injection error entirely, because being badly wrong about something *reorders its
neighbours*:

```
Student's USB sentence — nearest concepts in material 6:
  0.6592  Cross-Site Scripting (XSS)   ← the only definition that was sent
  0.6529  SQL Injection (SQLi)
  0.6316  File Inclusion Attacks
  0.6150  Software and Data Integrity Failures
  0.6131  CYBERSECURITY
  0.6128  Injection                    ← ranked SIXTH
```

The model received XSS's definition and had nothing to contradict the claim with. Widening to top-3
would not have fixed it — two other phrasings put `Injection` 4th and 19th. The student had
*written the word "Injection"*; a string match finds it instantly.

Ignoring the threshold matters for the same reason: a badly wrong statement scores **below** 0.70
against the concept it is wrong about, so restricting this to covered concepts would miss exactly
the errors most worth catching.

### Silence is the default, and false alarms are the failure that matters

The rules bias hard toward saying nothing: flag only a **contradiction** of the supplied text;
incomplete is not incorrect; if the lesson does not settle it, stay silent; at most two; *"telling
a student they are wrong when they are right is far worse than missing an error."*

**Reversed mechanisms are named explicitly** because they are the easiest to read past — the
vocabulary matches the lesson perfectly and only the direction is wrong. This is also why the call
runs at `ThinkingLevel.MEDIUM`: at `LOW` the model found one injected error, stopped, and then
**praised the second one**. At MEDIUM it caught both.

**Measured recall: 5 of 6 planted errors.** It caught a reversed SSDLC mechanism, an RA 10173/10175
swap, an inverted Physical Layer, the USB/Injection misreading, and Data Subjects described as
organisations. It **missed** the National Privacy Commission being attributed to RA 10175, with the
contradicting definition sitting in the prompt — it stops early on a multi-error answer despite
being told not to.

That is acceptable, and **do not chase the sixth by loosening the rules.** Across every run it has
**never flagged a statement that was actually correct**, which is the failure that would matter. A
missed error leaves the student exactly where they were; a false accusation does not.

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
    "written_feedback": { "feedback": "...", "corrections": "" },
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
  "overall_verdict": "needs_review",   // stored for analysis, NOT displayed — see §4
  "written_feedback": { "feedback": "...", "corrections": "" } | null,
  "covered_count": 11,                 // optional — absent on rows written before 30 July
  "total_concepts": 78,                // optional
  "concepts_fingerprint": "sha256..."  // drives memo reuse; rows without it are never reused
}
```

⚠️ **Treat every key inside `ai_feedback` as optional.** The payload has gained and changed fields
repeatedly. `parseFeedback()` in the tab defaults `written_feedback` to `null` and the UI checks
`covered_count !== undefined` before using it. Keep that discipline.

**`written_feedback` has had four shapes and rows of every shape still exist:**

| Written | Keys |
|---|---|
| before 30 Jul 2026 | absent entirely |
| 30 Jul – 5 Aug | `strengths`, `gaps`, `next_steps` |
| 5–6 Aug | `summary`, `next_steps`, `corrections` |
| current | `feedback`, `corrections` |

**No migration was run and none is needed.** `feedbackText()` in `FreeRecallTab.tsx` resolves them:
`wf.feedback ?? [wf.summary, wf.next_steps].filter(Boolean).join(' ')`. Old attempts then render as
the single passage newer ones already are. If a fifth shape ever appears, extend that one function.

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

Result order: banner → **"How you did"** → **"Worth double-checking"** (only when non-empty) →
**collapsed** missed list → **collapsed** own answer. The missed list is collapsed because it runs
past 60 entries and buried the feedback worth reading.

**"How you did" is deliberately not emerald.** That one passage carries both what landed and what
did not, so a success colour would misrepresent half of it. `corrections` sits *after* it — a
14-year-old should read what they managed before what they got wrong — and carries a quiet line
saying it does not change the score, because the tally above still counts the concept as covered.

### The submit handler holds a `useRef` latch, and it is NOT redundant

`disabled` and `canEvaluate` read React state, which does not re-render until the handler yields,
so a double-click enters the handler twice with `isEvaluating` still `false` and fires two
submissions. Observed on Feynman: one answer graded **0.95 and then 0.90** three seconds apart from
byte-identical input, because both requests ran their memo lookup before either had written its
row. The latch is set synchronously before the first `await` and cleared in `finally`. Both tabs
have it.

> **It is per page load.** Reloading during a slow request leaves the first running server-side
> while the second starts blind — observed once, both missing the memo. Rare; a server-side lock
> would be the fix if it ever matters.

### The material picker is single-select

`SingleSelectDropdown`, keyed on **id** rather than label, so two materials sharing a title stay
distinguishable.

⚠️ **Both dropdown panels are `left-0 w-full`. Do not set `right-0` with a fixed width again.** The
panel was `right-0 w-64` under a `w-56` button — 32px wider than its trigger and anchored to the
trigger's right edge, so it overhung its own left edge. Wherever the control sits flush against a
container edge (this composer aligns it left), that overhang was clipped and took the first
characters of every label with it: `6. Information Security` rendered as `Information Security`.
Fixed 6 August in both `SingleSelectDropdown` and `MultiSelectDropdown`.

⚠️ **The scroll panes carry `px-2`, and it is load-bearing — not spacing.** Both study and history
panes are `overflow-y-auto`, and **CSS makes `overflow-x` compute to `auto` whenever `overflow-y`
is not `visible`** — a box cannot scroll one axis and overflow visibly on the other. So those panes
clip horizontally at their content edge even though nothing asks them to scroll sideways. With no
horizontal padding the dropdown sat flush at x=0 and its border, ring and shadow were sliced flat.
This was the *second half* of the same bug: fixing the panel's width and anchor stopped the labels
being cut, but left the edge shaved. **If you remove `px-2`, the shaving comes back.**

> Residual, accepted: a popover inside a scroll container is still clipped at the pane's top and
> bottom if the student scrolls while it is open. The proper fix is rendering the panel in a
> portal; the padding is the proportionate one. Same applies to Feynman.

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

1. ~~**Embeddings are generated one at a time.**~~ **FIXED 2026-08-06.** The diagnosis was right —
   it *was* the largest single chunk of the wait. `embedAll()` now runs 8 concurrently: measured
   **11.5s → 1.5s** for 29 points, which was 75% of everything before the feedback call. Bounded
   rather than unbounded, see §3.

2. ~~**`gemini-2.5-flash` is a reasoning model and thinking is on by default.** No thinking budget is
   set anywhere. For "extract the concepts this student mentioned" — a mechanical task — that is
   latency paid for nothing.~~
   **FIXED 2026-08-01.** Both calls moved to `GEMINI_UTILITY_MODEL` (`gemini-3.5-flash-lite`) with
   an explicit thinking level: extraction runs at `MINIMAL` (measured: **0 thinking tokens**),
   written feedback at `LOW` — `LOW` rather than `MINIMAL` because the prompt carries a real
   restraint rule ("do NOT recite the missed list, choose only the 2-3 important ideas") that a
   zero-thinking pass tends to ignore. This diagnosis was correct: it *was* latency paid for nothing.

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

   **Partly eased 2026-08-01, not solved.** Free Recall's 2 requests now hit
   `gemini-3.5-flash-lite`, and the quota id is `…PerProjectPerModel`, so those 2 no longer compete
   with document uploads or Feynman for the same 20/day bucket. An identical resubmission is
   memoised and costs **zero** requests. Still ~10 *distinct* submissions per day though — the
   advice to enable billing before student testing stands.

6. **Latency vs Groq.** Groq's inference is much faster, and Free Recall's *extraction* is the
   mechanical call best suited to a fast model. But it feeds the score, so swapping it risks the
   determinism in §5. Note also that **Groq calls have no retry wrapper at all** — a Groq 429 throws
   raw, unlike Gemini. Adding one would need to come first.

7. **`similarity_score` is a reasonable name here** (unlike Feynman, where it is a misnomer).

8. **Domain hubness still produces false positives at the threshold.** `SQL Injection` scored
   **0.718** against an answer that never mentions it — security prose broadly matches security
   definitions. Related: a student who *lists* seven OWASP risks without explaining any of them had
   **five counted and two missed**, which from their side is arbitrary. Fixing this means revisiting
   0.70 with real student data; raising it trades these for false negatives, and the two move in
   opposite directions. **Do not adjust it without re-measuring both.**

9. **The same text re-submitted scores within roughly ±10 percentage points.** Extraction is a
   sampling step and Gemini 3 has no `temperature`. `findMemoisedAttempt()` pins byte-identical
   resubmissions exactly; nothing pins a reworded one. This is why the progress line has a noise
   floor (§4).

10. **`corrections` catches ~5 of 6 planted errors.** See §5b. Silence is the failure mode and it
    has never produced a false alarm — deliberately left alone.

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

## 14. Change log — 6 August 2026

A single session, driven by testing against real submissions. Every item below was measured, not
reasoned about; the measurements are in the sections named.

| # | Change | Why | §  |
|---|---|---|---|
| 1 | Extraction made **granular**, `MINIMAL`→`LOW`, 4096→8192 | Coarse extraction produced 8 points from six paragraphs and **5 false misses** — students told they forgot words they had written | §4a |
| 2 | Feedback merged to **one `feedback` field** | `next_steps` paraphrased `gaps` in 4 of 4 attempts; the later "action gets crowded out" theory was tested and disproved | §5 |
| 3 | **`corrections`** added | A wrong statement either scored points (0.7175) or read as forgetfulness; the writer had no definitions and could praise the error | §5b |
| 4 | Pairing changed to **term lookup first**, top-2 vectors as fallback | Nearest-only ranked the right concept **sixth** for a badly wrong claim and missed the error | §5b |
| 5 | **Page anchoring** via `source_pages` + a full concept→page index | "Review injection" → "Injection is on page 24"; the index because full-coverage attempts had no pages to cite | §5 |
| 6 | Verdict bands **removed**, replaced by counts + progress line | 86% and 36%-with-two-errors both read "Strong" | §4 |
| 7 | Score ring given **one fixed tone** | A varying colour re-asserts the cross-material judgement the bands got wrong | §4 |
| 8 | **Covered list is the authority**; wrong-material block | Material 6's text against material 7 scored 0/29 and was praised | §5 |
| 9 | Embeddings **parallelised** (8 at a time) | 11.5s → 1.5s, 75% of pre-feedback time | §3 |
| 10 | **`useRef` submit latch** in both tabs | Double-click graded one Feynman answer 0.95 then 0.90 | §10 |
| 11 | `material_ids` added to `GET /history` | The progress line must compare like with like | §4 |
| 12 | Dropdown panels **`left-0 w-full`** | `right-0 w-64` under a `w-56` button clipped the start of every label | §10 |
| 13 | **`px-2`** on all four scroll panes | `overflow-y-auto` forces `overflow-x: auto`, so the panes clipped the dropdown's border and shadow flat — the second half of #12 | §10 |

**Not changed, deliberately:** `similarity_score`, the 0.70 threshold, the coverage formula, and
the BKT prohibition. The paper's figures are unaffected by everything above.

---

## 15. Related documents

- [feynmanImplementationPlan.md](./feynmanImplementationPlan.md) — the sibling tab; shares
  `cognitive.routes.ts`, `cognitiveShared.tsx` and the history endpoint
- [STUDENT_RESOURCES_IMPLEMENTATION.md](./STUDENT_RESOURCES_IMPLEMENTATION.md) — where
  `materialAccess.ts` came from and the full access-control model
- `ARCHITECTURE.md` §5 and §11 — the algorithm of record
- `CLAUDE.md` — the "Cognitive Tabs" section and the non-negotiable rules
- `supabase/migrations/20260723090006_cognitive_chat_games.sql` — added `student_id NOT NULL`, dropped `evaluate_recall()`
