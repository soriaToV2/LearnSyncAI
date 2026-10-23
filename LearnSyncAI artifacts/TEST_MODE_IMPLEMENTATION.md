# Adaptive Test Mode — Implementation Reference

**Feature:** AI-generated practice tests built from one material's concepts, graded server-side, producing the telemetry BKT consumes.
**Status:** Frontend and backend implemented and verified against live data. **BKT is now implemented too** — the engine landed on 7 August 2026; see `BKT_IMPLEMENTATION.md` for it, and §15 here for what changed on the Test Mode side.
**Date:** 7 August 2026. **Revised 18 August 2026** — generation moved from Groq back to Gemini (§7); nothing else about the feature changed.
**Migrations applied:** **none.** Every column this feature writes already existed unused — `difficulty_tier`, `mastery_snapshot` and `question_types` were added by migration `20260723090004_bkt_engine.sql` §7 for exactly this purpose and had never been populated.
**Commits:** Phase 1 (frontend) is `7a258aa "Test mode frontend revision"`. Phase 2 (backend) is the commit this document ships with.

> **Read this first if you are an AI agent debugging or extending this feature.**
> §2 is the non-negotiable rules — breaking one does not regress a feature, it invalidates
> something the capstone paper claims. §4 is the one rule the whole test-length design rests on.
> §13 is the debugging playbook. **§14 lists defects deliberately left open — check it before
> "finding a bug".** §15 is the BKT handoff.

---

## Table of contents

1. [What this feature is](#1-what-this-feature-is)
2. [Non-negotiable rules](#2-non-negotiable-rules)
3. [What it was before, and why it was rebuilt](#3-what-it-was-before-and-why-it-was-rebuilt)
4. [Test length — one question per concept](#4-test-length--one-question-per-concept)
5. [Matching type — 4 terms against 6 definitions](#5-matching-type--4-terms-against-6-definitions)
6. [Difficulty tiers](#6-difficulty-tiers)
7. [Which AI model, and why](#7-which-ai-model-and-why)
8. [Question generation](#8-question-generation)
9. [Grading](#9-grading)
10. [Telemetry](#10-telemetry)
11. [Security model](#11-security-model)
12. [Frontend structure](#12-frontend-structure)
13. [Debugging playbook](#13-debugging-playbook)
14. [Known issues deliberately NOT fixed](#14-known-issues-deliberately-not-fixed)
15. [Handoff: BKT (Phase 3)](#15-handoff-bkt-phase-3)
16. [Verification evidence](#16-verification-evidence)
17. [Glossary](#17-glossary)

---

## 1. What this feature is

A student picks one lesson and which question formats they want. The server counts that
material's concepts, writes **one question per concept** across the chosen sections, and serves
them **without the answer key**. The student works through one question per screen, can jump
around and revise, and submits. The server grades against the key it kept, returns a result, and
writes one `practice_telemetry` row per question — which is what Phase 3's BKT engine will turn
into mastery observations.

### The division of ownership, which is the heart of the design

| Decided by | What |
|---|---|
| **The student** | Which lesson. Which of the five formats. Their answers. |
| **The server** | How many questions. Which concept goes to which section. The true/false verdict. Where the correct option sits. Which concepts form a matching block. Whether an answer is right. |
| **The model** | Prose only — the wording of questions, distractors, clues and glosses. |

The model never sees a UUID, never decides a grade, and never chooses a position. Everything that
could corrupt a mastery estimate is code.

### Files

**Backend**
- `server/lib/testAllocation.ts` — **new.** Which concept goes to which section; the authoritative copy of the length rule.
- `server/lib/testDifficulty.ts` — **new.** Mastery snapshot, tier thresholds, and the per-format tier prompt fragments.
- `server/lib/testGeneration.ts` — **new.** Five per-format writers, validation, deterministic fallbacks.
- `server/lib/testGrading.ts` — **new.** The deterministic answer-matching ladder.
- `server/routes/practice.routes.ts` — **rewritten.** Six endpoints, gates, telemetry.
- `server/types/api.ts` — reshaped `CreatePracticeTestSchema` and `SubmitAnswerSchema`; added the stored-payload interfaces.
- `server/lib/gemini.ts` — **18 Aug 2026.** Added `GEMINI_CONTENT_MODEL`; extended the model-choice rule at the top of the file with the third branch this feature needs (§7).
- ~~`server/lib/groq.ts`~~ — *no longer part of this feature.* It gained `GroqUnavailableError`, `GroqRateLimitError`, `withGroq()` and a startup key fingerprint for the 6 Aug Groq build; generation left it on 18 Aug and `practice.routes.ts` no longer imports it. Still serves games, flashcards and chat until Prompts 2–4 of the migration move them.

**Frontend**
- `src/lib/testMode.ts` — the contract, the client mirror of the allocation rule, and the `api`-backed `testApi`.
- `src/lib/testModeFixtures.ts` — **deleted.** Phase 1's stand-in backend.
- `src/pages/student/studySpaceTabs/AdaptiveTestTab.tsx` — **rewritten**, 1,596 → 607 lines.
- `src/pages/student/components/TestSessionView.tsx` — **new.** Taking a test.
- `src/pages/student/components/TestResultsView.tsx` — **new.** Reviewing one.
- `src/components/ui/surfaces.ts` — **new.** Style tokens promoted out of `cognitiveShared.tsx`, which re-exports them.

**Tooling**
- `scripts/set-test-mastery.ts` — **new.** Forces mastery so the tiers can be verified before BKT exists.
- `package.json` — `dev:server` now watches `.env` (see §13).

---

## 2. Non-negotiable rules

1. **The answer key never reaches the browser during a test.** `TestQuestion` in `src/lib/testMode.ts`
   has no `correct_answer` field, and `stripKey()` in `practice.routes.ts` is the **only** function
   that serialises a question toward a client. It allow-lists fields rather than deleting the key, so
   a field added later cannot leak by omission. **Do not add a second serialiser.**
2. **`is_correct` is computed server-side, always.** The old endpoint accepted it in the request body,
   which let a student post arbitrary BKT evidence — the exact write RLS makes impossible from a
   browser, handed over by the API instead. `SubmitAnswerSchema` deliberately has no `is_correct` and
   no `concept_id`; both are derived from `questions_payload[question_index]`.
3. **One question per concept.** See §4. This is what makes each test exactly one BKT observation per
   concept.
4. **A matching block is exactly 4 terms against 6 definitions.** See §5.
5. **The model echoes an INDEX, never a `concept_id`.** Every echoed `n` is range-checked against its
   batch. A hallucinated UUID attaches a student's mastery to the wrong concept, and nothing
   downstream can detect it.
6. **Difficulty thresholds are 0.50 and 0.85**, matching paper p. 81/p. 98 and `mastery_tier()` in
   `schema.sql`. The dead prompt this replaced used 30%/70%, which matched nothing.
7. **A concept with no `bkt_mastery` row is at P(L₀) = 0.10, not 0.** Treating a missing row as zero
   would pin every test to `foundational` forever — invisibly, because `foundational` is also the
   correct answer today.
8. **Test Mode does not write `bkt_mastery` or `bkt_update_logs`.** It reads mastery to pick a tier and
   writes telemetry. Phase 3 owns the rest.
9. **No pyBKT, ever.** The route that was replaced fired at a Python FastAPI service running pyBKT.
   `CLAUDE.md` and `ARCHITECTURE.md` both forbid it; the engine must be in the Express backend.

---

## 3. What it was before, and why it was rebuilt

The old `AdaptiveTestTab.tsx` (1,596 lines) made **zero network calls.** Questions were generated in
the browser from a hardcoded array of eight neuroscience concepts ("Presynaptic Calcium Influx").
True/false was `Math.random() > 0.5`. History lived in `localStorage`, shared across every study
space on the machine. BKT was faked client-side as `p + (1-p)*0.35`.

The three backend endpoints had **zero callers** and six defects:

| # | Defect | Consequence |
|---|---|---|
| 1 | `practice_telemetry` INSERT omitted `question_type`, which migration 0011 made `NOT NULL` | **Every** telemetry write failed; the error was discarded; the endpoint returned 200. BKT could never have received an observation. |
| 2 | `generateJson(prompt)` with no options → the dead `gemini-2.5-flash` default | HTTP 404 on this key, and no try/catch, so it rejected unhandled under Express 4 |
| 3 | No ownership check, no material-access check | Any student could generate a test from another grade's material and read its concepts back |
| 4 | `is_correct` and `concept_id` client-supplied and trusted | Arbitrary mastery evidence |
| 5 | Model-echoed `concept_id` UUIDs never validated | Silent mastery corruption |
| 6 | `PUT /:id/complete` called a pyBKT FastAPI service | Forbidden by `CLAUDE.md` |

There was nothing to preserve. The rebuild ran in three phases: **frontend** (against a fixture
backend so the UI could be judged before any server work), **backend**, and **BKT** (not started).

---

## 4. Test length — one question per concept

**The student does not choose how long a test is.** `allocateConcepts()` in
`server/lib/testAllocation.ts` derives it: every concept in the material gets exactly one question,
distributed across the chosen sections.

**This is a BKT rule, not a simplicity rule.** The old UI let the student pick a total, and concepts
were cycled to fill it — so a 40-item test on a 29-concept lesson asked about some concepts three or
four times in one sitting. Four back-to-back answers on one concept are not four independent
observations, which is precisely what BKT assumes. It is the same trap the flashcard due-check
exists to avoid (`CLAUDE.md`: *"a retry is not one"*). One question per concept means one observation
per concept per test, and it makes `document_mastery()` — the mean over every concept — meaningful
after a single test rather than mostly seed values.

**The paper does not specify a test length** (checked pp. 55–90), so nothing is contradicted.

### The allocation rule

```
others    = chosen formats minus matching_type
maxBlocks = n < 6 ? 0 : floor((n - others.length) / 4)   // ≥1 concept left for every other section
blocks    = clamp(round(n / formats.length / 4), 1, maxBlocks)
matching  = blocks * 4
rest      = n - matching, split evenly across `others`, remainder to earlier sections
```

| N | Formats | Result |
|---|---|---|
| 29 | MCQ only | MCQ 29 |
| 29 | MCQ + Matching | MCQ 13, Matching 16 (4 blocks) |
| 29 | all five | MCQ 7, T/F 6, ID 6, FIB 6, Matching 4 |
| 19 | all five | MCQ 4, T/F 4, ID 4, FIB 3, Matching 4 |
| 29 | Matching only | Matching 28 — **1 concept untested**, reported via `covered` |
| 5 | MCQ + Matching | MCQ 5, **matching dropped** (fewer than 6 concepts) |

Verified by sweep: **1,860 combinations (N = 1…60 × all 31 format subsets), zero violations.**

**`src/lib/testMode.ts` holds a MIRROR of this function.** The server is authoritative — it counts
concepts itself and re-derives the allocation, because a client-supplied length is a client-chosen
test. The client copy only drives the setup preview. Same arrangement as
`server/lib/reviewSchedule.ts` ↔ `src/lib/reviewSchedule.ts`. **Change one, change the other.**

### Consequences to leave alone

- **Matching is under-weighted when all five formats are chosen** (4 items where an even split wants 6).
  Forced: the count must be a multiple of 4 and one block is the floor.
- **Matching-only rounds down.** The leftover concepts become the blocks' distractors, but they get no
  question. The setup screen says so.

---

## 5. Matching type — 4 terms against 6 definitions

Paper **p. 75**, quoted:

> *Matching Type (4 terms, 6 definitions): P(G_match) = 0.17. For any individual term, the
> probability of selecting the correct definition from the pool of six through random guessing is
> 1/6 ≈ 0.17, **applied per matched item**.*

**Two rules, load-bearing for different reasons — do not conflate them:**

- **SIX OPTIONS is the BKT rule.** 1/6 is the guess probability the update applies. Any other pool
  size makes the arithmetic wrong.
- **FOUR TERMS is a fidelity rule.** *"Applied per matched item"* means the term count never enters
  the formula — a 2-term block would compute correctly. It is enforced because the paper and the
  `schema.sql` seed comment both state it, and code that quietly does otherwise misleads whoever
  reads the spec next. **If these two ever conflict with something that genuinely affects scoring,
  bend the term count, never the option count.**

`allocateConcepts()` guarantees matching receives a multiple of 4, so a short trailing block cannot
be produced. **One block emits four telemetry rows, not one.**

---

## 6. Difficulty tiers

Paper **p. 81** calls this *"session-based adaptation"* — **one tier per test, not per question.**
`practice_tests.difficulty_tier` and `mastery_snapshot` are single columns for that reason.

```
mastery_snapshot = mean over EVERY concept in the material of
                   (bkt_mastery.latent_mastery, or 0.10 when no row exists)

>= 0.85 → advanced      "analytical scenarios, synthesis, edge cases"
>= 0.50 → intermediate  "conceptual comparisons, multi-concept recall, practical applications"
 < 0.50 → foundational  "direct definitions, basic conceptual associations"
```

Both values are **stored at generation**, because the paper's *Difficulty Alignment* check (p. 98) is
literally *"confirms that the adaptive calibration pipeline correctly passes the mastery parameter to
the generative AI prompt"* — and that cannot be run against data nobody saved.

### Two things that are easy to get wrong

**The 0.10 default is applied at READ TIME, not stored.** `bkt_mastery` is empty and rows are
deliberately not pre-seeded — 50 students × 57 concepts of rows all saying the same thing tells you
nothing the default does not. The old route upserted rows at `0.0`, re-breaking what migration 0004
§3 fixed. Mirrors `document_mastery()` in `schema.sql`, which is
`COALESCE(avg(COALESCE(bm.latent_mastery, 0.10)), 0.10)`.

**The snapshot is rounded inside `masterySnapshot()`, and that rounding is load-bearing.** Fourteen
concepts at 0.90 and fourteen at 0.10 is exactly 0.5 on paper but accumulates to
`0.49999999999999994`, which reads as `foundational` — a tier boundary decided by summation order.
Rounding happens in the function so no caller can skip it.

### Per-format tier prompts

`FORMAT_TIER_GUIDANCE` in `testDifficulty.ts` gives each format its own instruction per tier, and
true/false additionally has `TF_TIER_RULES`.

**A single shared paragraph did not work, and this was measured.** With the tier instruction only in
the prompt header, the true/false writer produced **byte-identical output at all three tiers** — even
for SSDLC, the richest concept in the corpus at 643 characters. The cause was structural: the
operative line was *"VERDICT: TRUE — write a statement the definition supports"*, and restating the
definition is always the safest way to satisfy it. A tier hint fifteen lines above loses to the rule
on the line the model is answering. The fix was to make the tier rule **replace** that line.

---

## 7. Which AI model, and why

**Gemini `GEMINI_CONTENT_MODEL` (`gemini-3.6-flash`) at `ThinkingLevel.MINIMAL`**, since
18 August 2026.

**The paper does not require either provider.** p. 81 says only *"the generation prompt instructions
sent to **the large language model**"*, so nothing in the write-up depends on this choice. That is
what made the round trip below possible without touching the study's claims.

### The round trip, because the reasoning matters more than the destination

| Date | Model | Why it moved |
|---|---|---|
| before 6 Aug | `gemini-2.5-flash` | `generateJson()`'s default; already returning HTTP 404 |
| 6 Aug | Groq `llama-3.3-70b-versatile` | Gemini's 20 requests/day *per model* was already spent by extraction, Free Recall and Feynman; Groq was markedly faster and the batch-and-echo shape was proven by `generateQuestionsForConcepts()` |
| **18 Aug** | **`gemini-3.6-flash`** | **Groq decommissioned the model on 17 June 2026** and closed its paid tier to new signups |

The 6 Aug reasoning was sound and is not disowned here — it was overtaken. Verified against our own
key on 17 Aug 2026, `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` both return *"The model does
not exist or you do not have access to it."* With the paid tier closed, there was no version of Groq
that reaches a 50-student study, so the quota argument that sent generation away from Gemini stopped
being a choice between two working options.

### Why the CONTENT model and not the utility model

`gemini.ts` used to decide this with one question — *does the model's own judgement become a number
the student is shown?* Test grading is deterministic (`testGrading.ts`), so the answer here is **no**,
and that rule alone would put every generated question on the cheap utility model.

That is the wrong answer, and the Games work measured why: pushing authoring down produced **invented
facts** (*"What does Cross-Site Scripting prevent?"* — XSS causes it), ungrammatical fragments, and
subjectless stems naming no concept. A bad score is invisible; a bad question is visible but nothing
is checking it, so both ship. `gemini.ts` now asks a **second** question — *does the output become
content a student reads as fact?* — and this feature is the reason it exists.

### MINIMAL thinking is not a tuning preference

Gemini 3 thinks by default and **thinking tokens bill at the OUTPUT rate** while drawing on the same
`maxOutputTokens` budget. Measured on a small prompt: `gemini-3.6-flash` ~2 s at MINIMAL against
5–20 s at LOW and 8 s+ at MEDIUM.

Nothing in generation reasons. The server owns the true/false verdict, the correct option's position,
which concepts form a matching block, and the entire grade. The model writes prose. Turning thinking
up buys nothing here and costs on both axes.

### ⛔ Not `gemini-3.7-flash`

It launched 13 Aug 2026 with a headline "50% introductory price cut" and a future session will be
tempted. Verified 18 Aug 2026 against our own key:

1. **It rejects `MINIMAL` outright** — `HTTP 400: "Thinking level MINIMAL is not supported for this
   model."` Its floor is `LOW`, so its cheapest possible call is dearer than 3.6-flash at MINIMAL.
2. **Four of five requests failed** with *"This model is currently experiencing high demand."*
3. Both models are $0.75 / $3.75 per 1M under introductory pricing today. The advertised cut is
   measured against 3.7's own future standard price, not against what 3.6 costs now.

### ⚠️ Free-tier capacity is STILL a real blocker for the study — the units just changed

| Limit | Free tier | One test |
|---|---|---|
| **Requests per day, per model** | **20** | **5** (one per format, in parallel) |

**That is roughly four tests a day for the entire account** — not per student — and the same 20 is
shared with concept extraction and Feynman grading, which also run on `gemini-3.6-flash`. Confirmed
live on 18 Aug 2026: after verification runs, a real student's test attempt was refused with
*"The Gemini API quota for this key is exhausted (generate_content_free_tier_requests, limit 20)."*

The 50-student study needs **~1,500 requests over the fortnight** for tests alone. **Enable billing.**
No code change creates capacity, and the cost is small — see the estimate in
`MIGRATION_PROMPTS_GEMINI.md`.

`classifyFailure()` in `gemini.ts` splits the two windows the way `withGroq()` used to split TPM from
TPD, and it matters for the same reason: **a per-minute burst limit clears by itself and is retried;
a per-day allowance does not and fails immediately** with an honest message. Retrying a daily
exhaustion spends four attempts to fail anyway and tells the student "try again in a moment" when the
truth is "not today".

---

## 8. Question generation

`server/lib/testGeneration.ts`. One exported entry point, `generateTestQuestions()`; five private
writers, run in parallel; batches within a format stay sequential at `BATCH = 20`.

**`askBatch()` is the only function that talks to the model.** The five writers call it and know
nothing about the provider, which is what made the 18 Aug migration a change to one function rather
than to five. It sets, per call: `GEMINI_CONTENT_MODEL`, `thinkingLevel: MINIMAL`, a `responseSchema`,
and an explicit `maxOutputTokens`.

**A typed Gemini failure is re-thrown untouched.** `askBatch()` wraps other errors with the format
label for diagnosis, but `GeminiUnavailableError` passes straight through, because
`failGeneration()` in `practice.routes.ts` branches on it to answer 429-with-`Retry-After` versus 503.
Wrapping it collapses both into a generic 502 and tells a student to retry at once when the quota is
spent for the day.

**`responseSchema` pins STRUCTURE ONLY, and every validator stayed.** It cannot express "n is inside
this batch", "the distractors differ from the correct answer" or "the clue does not contain its own
answer" — so the range check and the per-format validation below are exactly what they were with no
schema at all. **Pinning the shape removed a failure mode; it removed no validation.**

**⚠️ Token budgets were DOUBLED, not ported** — 8192 for multiple choice, 6144 for true/false,
identification and fill-in-the-blank, 4096 for matching glosses, against Groq's 4096 / 3072 / 2048.
MINIMAL thinking is not *no* thinking, and Gemini 3 thinking tokens draw on `maxOutputTokens`: a
budget sized for the visible output alone returns `finishReason=MAX_TOKENS` with no text, which
surfaces as a 502 that costs the whole test. A ceiling is not a reservation, so unused headroom is
free.

**⚠️ No `temperature`, and the old 0.2 must not be reintroduced.** Gemini 3 dropped the sampling
parameters; `generateJson()` strips one loudly if passed. The 0.2 was justified by the paper's
Content Consistency check (p. 98), so be precise about what delivers that now the knob is gone:
**shape** by `responseSchema`; **factual content** by the prompt's *"use only what each definition
states"* rule, enforced afterwards by `mentionsTerm()`, `looksClean()` and the distinctness checks;
**difficulty** by `TIER_GUIDANCE`, chosen server-side from BKT rather than by the model. What was
never guaranteed — and is slightly less true now — is that two generations phrase a question
identically. p. 98 does not ask for that.

| Format | Model returns | Server owns | Validation → fallback |
|---|---|---|---|
| `multiple_choice` | `{ n, question, correct, distractors[3] }` | **Places the correct option itself**, balanced across A–D and shuffled per test (`balancedSlots`, `answerPlacement.ts`). Until 2026-10-23 this was "deterministic by index" and ran A,B,C,D… in every test | 3 distinct non-empty distractors, none equal to `correct` → else definition-as-correct + 3 other concepts' definitions |
| `true_or_false` | `{ n, statement }` | **Decides the verdict itself**, half True and half False in random order (until 2026-10-23: alternating by index) | non-empty and clean → else `"{term} means: {another concept's definition}"`, reliably false |
| `identification` | `{ n, clue }` | key = the concept's `term` | clean **and must not contain the term** → else the raw definition with the term blanked |
| `fill_in_the_blank` | `{ n, sentence }` with one `____` | key = the concept's `term` | exactly one `____`, term absent elsewhere → else a template |
| `matching_type` | `{ n, gloss }` ≤90 chars | Assembles blocks, picks distractors, shuffles, **dedupes the pool** | clean, term absent → else the truncated definition |

**Every format has a deterministic fallback.** A model that skips an item must not shorten the test —
the length is "one question per concept" and a short test silently breaks that invariant along with
the BKT coverage it buys.

**`explanation` is the concept's own definition, verbatim** (`"{term} — {definition}"`). No model call,
so the paper's Factual Correctness criterion (p. 98) holds by construction.

**Matching needs a gloss and the other formats do not** because definitions run to a **643-character
max (median 162)**. Six of those as options is unreadable at any layout.

### Two bugs found in live output and fixed

**The model leaked its own item number into the prose.** Observed twice in one run: *"…aim to mitigate
through various security measures **n1**."* and *"…which is part of **n**."* `ORPHAN_INDEX` now rejects
such items. **Rejected, not repaired** — stripping the token leaves *"…which is part of."*, which is
still wreckage reaching the student, whereas a fallback is always a complete sentence. Only a
*trailing* orphan is matched, so a legitimate "n" mid-sentence is untouched.

**Two concepts produced identical glosses.** Asked for a ≤90-character gloss, both `XSS` and
`SQL Injection` returned "Cyberattack risk", and a block rendered with the same text at A and C. That
is not cosmetic: an answer is stored as the option's **text**, so two identical options are one slot
to both the grader and the exclusive-slot UI, and the correct answer becomes ambiguous.
`distinctPool()` now falls back to the concept's own definition, which is unique per row.

---

## 9. Grading

`server/lib/testGrading.ts`. **Deterministic, with no model call.**

- `multiple_choice` / `true_or_false` / `matching_type` — exact match after normalisation.
- `identification` / `fill_in_the_blank` — `matchesTerm()`, which compares the answer against a set of
  **mechanically derived aliases** of the expected term.

### Why no model adjudication

- A score a student is shown must be reproducible. Same principle as `findMemoisedAttempt()` in Free
  Recall; here it comes free.
- `P(G_id) = 0.05` (p. 75) asserts identification is near-impossible to guess. Lenient grading
  falsifies that number and the BKT update built on it.
- It costs no quota.

### The alias ladder, and the line it must not cross

`termAliases()` derives alternatives by **mechanical pattern only** — never by substring:

- `foldKey()` — trailing parenthetical acronym removed (`… Life Cycle (SSDLC)` ≡ `… Life Cycle`)
- `acronymOf()` — the abbreviation the term introduces
- statute prefix removed (`RA 10173 – Data Privacy Act of 2012` → `Data Privacy Act of 2012`)
- trailing year removed (`… of 2012` → `Data Privacy Act`)
- the statute code alone (`RA 10173`)
- leading article and trailing-s tolerance

`foldKey` and `acronymOf` are imported from `conceptExtraction.ts`, where they are exported precisely
so this rule exists once — Free Recall resolves student-typed terms through the same pair.

**⚠️ NEVER add substring or containment matching.** It reads as generous and is wrong: `"Injection"`
is contained in `"SQL Injection"`, and `"Access Control"` in `"Broken Access Control"` — different
entries in the same lesson. Leniency here is a false positive fed into a mastery estimate.

Measured, 15 cases, all passing:

```
"ssdlc"                    vs "… LIFE CYCLE (SSDLC)"                  ✓
"the firewall" / "FIREWALL." / "firewalls"  vs "Firewall"             ✓
"Data Privacy Act"         vs "RA 10173 – Data Privacy Act of 2012"   ✓
"RA 10173"                 vs "RA 10173 – Data Privacy Act of 2012"   ✓
"Injection"                vs "SQL Injection"                         ✗ (correctly)
"Access Control"           vs "Broken Access Control"                 ✗ (correctly)
"Privacy"                  vs "Data Privacy Act of 2012"              ✗ (correctly)
""                         vs anything                                ✗
```

**An unanswered question is wrong, not excluded** — which is also why the score divides by the total,
never by the number answered.

---

## 10. Telemetry

**One `practice_telemetry` row per question, written ONCE, at completion**, as a single batch insert
in `PUT /:id/complete`.

**Not per answer, despite paper p. 80's "during active testing".** The UI lets a student jump back and
change an answer. A per-answer write would produce two rows for one question — two BKT observations
for one piece of evidence — and a real-time BKT update cannot be un-applied when the answer changes.
Writing from the final answers satisfies what the paper actually requires (*"graded as a binary value
… on a per-question basis"*, each with its own P(G)) while staying coherent with a revisable test.
`student_answers` JSONB holds `{ answer, latency_ms }` per index in the meantime, which is what that
column is for.

**Completion is idempotent.** A second call on a `completed` test returns the stored result and writes
nothing — otherwise a retried request doubles every observation.

**Telemetry is a record of what happened; it is not yet a BKT observation.** Every completed test
writes rows. Whether a *retake* should move mastery is Phase 3's decision (§15).

A failed telemetry insert is logged loudly but does **not** fail the request — the student's score is
already saved and showing it is what they are waiting for.

---

## 11. Security model

`router.use(authenticate, requireRole('student'))`, then per route:

```
1. Zod safeParse                                    → 400
2. requireOwnedSpace()                              → 404  (never 403)
3. rejectInaccessibleMaterials([material_id])       → 403
4. published to (space.subject, space.gradeLevel)
   AND linked in study_space_materials              → 404
```

**404 not 403 for ownership**, because a 403 confirms the id names a real space, and space ids are
visible in the address bar. Gate 4 is not redundant: passing the grade rule only proves the student
may *read* the material, not that this space holds it.

`/:id` routes load the row with `.eq('student_id', req.user!.id)` and 404 otherwise — **including the
reads.** A practice test carries its own answer key and the student's answers; an unguarded read
hands over both.

The service role key bypasses RLS, so none of this is optional (migration 0008: *"The API layer must
still enforce role and ownership itself"*).

---

## 12. Frontend structure

Five screens, one union: `overview | setup | generating | session | results`. Session and results
take over the tab by **early return**, the same way `FlashcardsTab` hands off to `FlashcardStudyView`
— not a portal, not `position: fixed`.

**Setup is three steps, and step 3 is read-only** — it states the derived question count and the
section split. There is deliberately no length control (§4) and no per-format weighting, which is a
length control wearing a different hat.

**The session is one question per screen**, except matching, where the block of four shares one screen
because the six definitions are a single pool. `ARCHITECTURE.md` §7 has the frontend record
`latency_ms` as the student answers, which only means anything one question at a time.

**The question navigator** is a numbered grid, rendered twice from one definition: a persistent rail
at `lg:` and up, and the same grid inside a `Modal` below that, opened by tapping the `4 / 29` counter.
A matching block contributes four cells that all jump to one screen — each term is separately
answerable, so four cells is the truthful count.

**Matching is drag-and-drop, and the TERM is what moves.** Measured over the live `concepts` table:
terms median 18 characters (p90 40), definitions median 162 (p90 267, max 643). A two-column
"draw a line across" layout needs both sides short. So the short thing became a draggable chip and the
long thing became a full-width drop target. **Tap-a-chip-then-tap-a-definition is not a fallback for
neatness** — dragging fails whenever chip and target are not on screen together, which on a phone is
most of the time, and it is the only path a keyboard can take. Slots are exclusive; the two
definitions left empty at the end are exactly the two distractors.

**The results ring says "Test Score", never "Mastery".** Mastery is the per-concept probability in
`bkt_mastery`. Unlike Free Recall's coverage ratio, this percentage *is* comparable across materials —
it is correct-out-of-asked — so `scoreTone()`'s absolute thresholds are appropriate here.

**There is deliberately NO mastery panel.** Until Phase 3 every `latent_mastery` is the 0.10 seed. The
version replaced filled that gap with a hardcoded neuroscience array and a concept→material mapping
invented by `idx % availableResources.length`. What is shown instead is real test outcomes.

### Gotcha: this project has no `@types/react`

React ships no types of its own and `@types/react` is not installed, so a locally-declared component's
props are enforced exactly and **`key` is rejected on it**. Nothing in the codebase keys a local
component. Two lists here key a wrapping `<Fragment>` instead. Do not "fix" this by adding `key` to a
props interface — that would be a lying type.

---

## 13. Debugging playbook

### Force a difficulty tier (the p. 98 Difficulty Alignment check)

```bash
npx tsx scripts/set-test-mastery.ts intermediate     # 0.65
npx tsx scripts/set-test-mastery.ts advanced         # 0.92
npx tsx scripts/set-test-mastery.ts foundational     # 0.25
npx tsx scripts/set-test-mastery.ts 0.72             # any value
npx tsx scripts/set-test-mastery.ts reset            # delete rows → P(L₀) 0.10
npx tsx scripts/set-test-mastery.ts advanced "6."    # a different material
```

The script reads the value back through `masterySnapshot()` and `masteryTier()` — the same functions
the generator calls — so it verifies rather than asserts.

**`reset` is the truest foundational test.** Deleting the rows exercises the path a real student hits
on day one (no rows, default applied at read time); writing 0.25 tests a state that will never occur.

**⚠️ The tier is baked in at generation. Changing mastery does not re-tier an existing test.**

### Audit what was generated

```sql
SELECT title, difficulty_tier, mastery_snapshot, status, score,
       jsonb_array_length(questions_payload->'questions') AS questions,
       questions_payload->>'fallback_count' AS fallbacks, created_at
FROM practice_tests ORDER BY created_at DESC;
```

```sql
-- One row per question, question_type always set, P(G) resolvable
SELECT t.difficulty_tier, pt.question_type, count(*), sum(pt.is_correct::int) AS correct
FROM practice_telemetry pt JOIN practice_tests t ON t.id = pt.practice_test_id
GROUP BY 1, 2 ORDER BY 1, 2;
```

```sql
-- Telemetry must exist only for completed tests, exactly once per question
SELECT t.id, t.status, jsonb_array_length(t.questions_payload->'questions') AS questions,
       count(pt.id) AS telemetry_rows
FROM practice_tests t LEFT JOIN practice_telemetry pt ON pt.practice_test_id = t.id
GROUP BY t.id, t.status, t.questions_payload;
```

### "My new Gemini key doesn't work"

`server/lib/gemini.ts` reads `GEMINI_API_KEY` **once, at module load**. Editing `.env` used to be a
silent no-op because `.env` is not imported by anything, so `tsx watch` never restarted; `dev:server`
now runs `tsx watch --include .env`.

⚠️ **Unlike `groq.ts`, `gemini.ts` logs no key fingerprint**, so there is no startup line to check the
swap against. The observable confirmation is the quota message itself changing — a paid key stops
producing `generate_content_free_tier_requests`.

**Gemini quotas are per Google Cloud project, not per key.** A second key issued from the same project
shares the same exhausted allowance, exactly as Groq's were per organisation. Enabling billing is a
change to the *project* behind the key.

⚠️ **The live site reads its own copy.** Swapping `.env` locally does nothing to Render — that is a
separate `GEMINI_API_KEY` in the service's Environment settings.

### "Generation is slow"

Expected, and measured on 18 Aug 2026: **47 s and 102 s** for a 42-concept material, against the ~2 s
a single small call takes. The five calls run in parallel, so the total is whatever the slowest one
takes — in practice the multiple-choice batch, which writes the most text. Output speed is the
bottleneck, not thinking, and not the token ceiling.

`generateTestQuestions()` logs one line per test so this stays measurable:

```
[TestGen] 42 questions from 42 concepts in 47.3s (1 fallbacks, tier foundational)
```

An `HTTP 503 "This model is currently experiencing high demand"` in the log is a **capacity** signal,
not a quota one; `withRetry()` handles it and the request usually succeeds on the retry. It is
distinct from the 429 quota refusal above.

### Symptom → cause

| Symptom | Look at |
|---|---|
| Every test is `foundational` | Correct until Phase 3. Confirm with `set-test-mastery.ts`. |
| "quota for this key is exhausted … limit 20" | Requests-per-day, per model. Not retryable — §7. One test is 5 requests. |
| "currently experiencing high demand" (503) | Capacity, not quota. Retried automatically; §13. |
| Generation takes 45–100 s | Expected. §13, "Generation is slow". |
| Test has fewer questions than concepts | Matching-only rounds down (§4), or the material gained concepts after the preview |
| A question looks like a template | `fallback_count` in `questions_payload` — the model skipped it or failed validation |
| Answer marked wrong that looks right | §9. Add a *mechanical* alias; never containment. |
| Duplicate options in a block | `distinctPool()` regressed |

---

## 14. Known issues deliberately NOT fixed

1. ~~**`latency_ms` is ~0 on almost every telemetry row.**~~ *(FIXED, 7 August 2026.)* `goTo()` called
   `queueFlush()`, which chained `flush` onto a microtask, then **synchronously** reset
   `enteredAtRef.current` — so `flush` read the already-reset ref and elapsed came out ≈ 0. Introduced
   when navigation went from awaited to queued, to remove a 140 ms lag on *Next*. Fixed by having
   `queueFlush` read **and** reset the ref in the same synchronous breath and bank the dwell into a
   per-index map, which also survives a failed write. Simulated against a student spending
   1200/800/1500/600 ms: the old code recorded `0, 0, 0, 605`, the new records `1215, 805, 1507, 608`.
   BKT never depended on this — the four-parameter update has no timing term.
2. **A gloss collision can produce an option that names its own term.** When `distinctPool()` falls
   back to the definition, and that definition spells out its own expansion (`XSS` →
   *"An abbreviation for Cross-Site Scripting…"*), the option gives itself away. `withoutTerm()` strips
   the term but not its expansion. Harmless when the concept is a distractor, a giveaway when it is one
   of the four terms. Narrow trigger, left open.
3. **Advanced tier is limited by the source material, not the prompt.** A concept whose definition is
   130 characters (`XSS`) cannot support an edge-case question; one at 643 (`SSDLC`) separates cleanly.
   **This is worth stating in the write-up rather than claiming a separation the output does not show.**
   True/false has the narrowest gap of the five formats.
4. **Free-tier capacity does not support a 50-student study — unchanged by the provider move, only
   restated in different units.** Gemini's free tier is 20 requests/day *per model* and one test is
   5 requests, so ~4 tests/day for the whole account, shared with concept extraction and Feynman.
   (Groq's equivalent was ~11 tests/day on tokens.) §7. **Needs billing enabled; no code change
   helps.** Hit for real on 18 Aug 2026.
5. **`GEMINI_LEGACY_TEXT_MODEL` still exists** as `generateJson()`'s default with no callers on any
   live path. It is a trap for the next call site and should be removed — but that is a `gemini.ts`
   change, not this feature's. **Prompt 5 of `MIGRATION_PROMPTS_GEMINI.md` owns it.** This feature
   stopped being its caller on 6 Aug and does not name it now.
6. **Some extracted concepts make poor identification answers** — outcome phrases like
   *"Protects Data and Privacy"* are hard to type exactly. That is a concept-extraction quality issue.

---

## 15. BKT (Phase 3) — ✅ DONE, 7 August 2026

The engine is `server/lib/bkt.ts`. This section is now a record of what was built, not a handoff.
**`CLAUDE.md` § "BKT Engine" carries the rules that must not be broken.**

**What landed here.** `applyTestCompletion()` runs at the old `PHASE 3 SEAM` in `PUT /:id/complete`,
fed the **same `telemetry` array that was just inserted** — not a re-derivation from
`questions_payload` — so the observations and the telemetry can never disagree, and
`count(bkt_update_logs) == count(practice_telemetry)` stays a valid reconciliation. A matching block
already emitted four telemetry rows, one per matched term, so p. 75's "applied per matched item"
needed no code at all.

**The completion UPDATE became a compare-and-swap** (`.eq('status', 'in_progress').select('id')`).
The pre-existing status check reads a row fetched moments earlier, so two racing requests both fell
through it. That used to mean a duplicate telemetry batch; with BKT attached it would have doubled
every observation in the test.

**The three decisions the old handoff asked for:**

1. **Retakes DO write mastery.** Paper p. 81 describes generating a new test on the same topic and
   querying "this historical BKT mastery probability" to scale it — a continuing chain is the
   documented behaviour. Idempotency stops one test counting twice; a *retake* is a new test with
   freshly generated questions, and rising mastery escalates the tier against the student.
2. **No backfill of the pre-existing telemetry.** At the time: 143 rows / 5 tests / one QA account,
   with identification 0-correct out of 24 and mastery force-set by `set-test-mastery.ts` between
   runs. 57 concepts spanned more than one test and 29 were touched by *both* `practice_telemetry`
   and `spaced_repetition_logs`, so a faithful replay would need those two sources interleaved
   chronologically — and BKT is order-dependent. The rows were left in place; they are still the
   evidence §16 cites.
3. **The update runs inline, awaited, in its own `try/catch`**, before `res.json`. Not
   fire-and-forget: Express 4 does not forward async rejections and there is no
   `unhandledRejection` handler, so a detached promise that rejects takes the process down. Never
   fatal, either — a BKT failure must not cost a student the score they are waiting for.

**Deleted:** `bkt_service/` (FastAPI, `slip 0.1`, a single flat `guess 0.2`) and
`server/routes/bkt.routes.ts` (its proxy, zero callers). `axios` went with them — it had no other
importer. `BKT_SERVICE_URL` and the `bkt_service/` `.gitignore` entries are gone too.

**Turned on:** a Mastery tile on the overview, a past-tense subtitle, and — the useful one — a line
under the lesson dropdown on setup step 1 reading *"Your mastery here is 42%, so this test will be
built at intermediate level."* That is the only place the adaptivity is visible to a human, and it is
exactly what the p. 98 Difficulty Alignment check is about. All three read
`GET /api/practice/space/:spaceId/mastery`, which is `requireOwnedSpace`-gated and built from
`masterySnapshot()` — the same function that picks the tier, so the number shown is provably the
number used.

**Not built, and why:** lowest-mastery concept ordering. `allocateConcepts()` emits one question per
concept for *every* concept, so ordering cannot change which concepts appear — only which format each
lands in. And the sign is wrong: `orderedFormats()` puts `multiple_choice` first, so weakest-first
would give the least-known concepts the *highest* guess probability. The stale TODO at
`practice.routes.ts:342` was rewritten to record this.

**Verification:** `npm run bkt:verify` — 165 offline cases at ICR 100%, plus 70 more through the live
HTTP endpoints with `--live --live-test`. See §16.

---

## 16. Verification evidence

All checks run against the live project on 7 August 2026.

**Static:** `npm run lint` (`tsc --noEmit`) and `npx vite build` clean.

**Allocation:** 1,860 combinations (N = 1…60 × 31 format subsets), **0 violations** — no matching
count that is not a multiple of 4, no section with zero items, no over-count.

**Grading:** 15 alias cases, **0 unexpected** (§9).

**Live HTTP integration** (two throwaway accounts, deleted afterwards, 0 rows left behind) — **41
checks, all passing:** 201 on generate; no `answer`/`explanation` anywhere in the wire payload for
either generate or resume; `is_correct` in a request body ignored; score divides by total; skipped
question wrong; 28 telemetry rows with every `question_type` set; idempotent completion; another
student 404s on all five `/:id` routes; unknown material 403; no token 401.

**Full-test generation (Groq, 7 Aug):** 29 concepts, all five sections — **1.6 s**, 29 questions,
0 fallbacks, 29/29 distinct concepts, every matching block 4×6, MCQ answer always among its options.
*(Earlier readings of 17–21 s were Groq rate-limit backoff, not generation.)*

**Four real tests audited end to end** (`practice_tests` + `practice_telemetry`, 115 rows):

```
FOUNDATIONAL  snapshot 0.1   6. Information Security  28 q  0 fallbacks  54%
INTERMEDIATE  snapshot 0.65  7. Information Security  29 q  0 fallbacks  52%
ADVANCED      snapshot 0.92  7. Information Security  29 q  0 fallbacks  45%
FOUNDATIONAL  snapshot 0.1   7. Information Security  29 q  0 fallbacks  55%
```

Every answer **re-graded from the stored key and compared to the stored `is_correct` — zero
disagreements across all 115 rows**; each stored score matches what its telemetry implies; no
duplicate `question_index`; no repeated concept; no duplicate options; no orphan `n` leaks; every
block 4×6.

### Re-verified on Gemini — 18 August 2026

The provider change was verified end to end rather than by type-check, because the risks it carries
are content risks that `tsc` cannot see.

**`npx tsx scripts/bkt-verify.ts --live --live-test` → 235 / 235, ICR 100.0%** (165 offline + 70
live). Its §7 drove `POST /api/practice` → `PUT /:id/answer` → `PUT /:id/complete` against a throwaway
student on a 42-concept material and confirmed:

- 42 questions for 42 concepts; `mastery_snapshot` **0.1252**, equal to EQ(4) over the material to
  four decimals, and correctly tiered `foundational`
- **42 `bkt_update_logs` rows = 42 `practice_telemetry` rows** — the reconciliation invariant holds
- every applied P(G) correct per format: MCQ 0.25, T/F 0.50, ID 0.05, FIB 0.05, **matching 0.17**
- re-completing wrote no further rows (the compare-and-swap still holds)

**A full generated test was then read by hand**, which is the only check that catches the documented
failure mode. On a 42-concept material at `intermediate`: **1 fallback in 42 (2.4%)**, and

- multiple-choice distractors drawn from the lesson's own neighbouring concepts, **no invented facts**
- true/false verdicts as the server dictated (alternating at the time — a predictable cycle, replaced 2026-10-23 by a balanced shuffle), every FALSE built by substituting another
  concept's definition rather than by inserting "not"
- **no identification clue contained its own answer**; no matching gloss named its term
- two matching blocks, each 4 terms against 6 distinct options, correct answer present
- one grammatical slip (*"a advanced"*)

**No `temperature` warning was logged**, confirming the parameter is gone rather than being stripped
at the call site.

**Tier separation, same concept across tiers:**

```
MULTIPLE CHOICE — SSDLC
  foundational  What does Secure Software Development Life Cycle (SSDLC) mean?
  intermediate  What situation is an example of the SSDLC?
  advanced      In a scenario where a company is developing new software, what applies
                when using the SSDLC?

FILL IN THE BLANK — RA 10173 – Data Privacy Act of 2012
  foundational  The ____ is a law in the Philippines that protects personal information…
  intermediate  The company must comply with ____ when handling customer information…
  advanced      If the company failed to comply with the ____, it could face severe penalties…
```

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Tier** | `foundational` / `intermediate` / `advanced`. One per test, chosen from `mastery_snapshot`. |
| **`mastery_snapshot`** | Mean `latent_mastery` over every concept in the material, missing rows counting as P(L₀) = 0.10. EQ(4). |
| **P(L₀)** | 0.10. Prior probability a student already knows a concept with no evidence. |
| **P(G)** | Guess probability, per question format. MCQ 0.25, T/F 0.50, ID 0.05, FIB 0.05, Matching 0.17. |
| **Block** | One matching screen: 4 terms, 6 definitions. Emits 4 telemetry rows. |
| **Allocation** | Which concept goes to which section. `allocateConcepts()`. |
| **Fallback** | A template question used when the model skipped an item or failed validation. Counted in `fallback_count`. |
| **Orphan index** | The model's `n` field leaked into the question prose. Rejected. |
| **`stripKey()`** | The only function permitted to serialise a question toward a browser. |
| **Telemetry** | `practice_telemetry` — one row per question, written at completion. Not yet a BKT observation. |
| **RPD** | Gemini's requests-per-day quota — **20, counted per model**, shared across every feature using that model. One test spends 5. |
| **Thinking level** | Gemini 3's reasoning-depth control. `MINIMAL` here; its tokens bill at the OUTPUT rate and draw on `maxOutputTokens`. |
| ~~**TPM / TPD**~~ | *Historical.* Groq's tokens-per-minute (12,000) and tokens-per-day (100,000) limits, which governed this feature 6–18 Aug 2026. |

---

## Related documents

- **`LearnSyncAI artifacts/BKT_IMPLEMENTATION.md` — the BKT engine this feature feeds. Read it before touching anything that produces telemetry.**
- `LearnSyncAI artifacts/ANALYTICS_IMPLEMENTATION.md` — the Analytics tab, which shares `masteryApi.space()` and `src/lib/mastery.ts` with this tab. The mastery tile and setup-screen tier line here must agree with it exactly.
- `ARCHITECTURE.md` §7 (Test Mode) and §8 (the BKT equations — the algorithm of record)
- `LearnSyncAI artifacts/FLASHCARDS_IMPLEMENTATION.md` §15 — the other BKT writer
- `LearnSyncAI artifacts/databaseSchemaExplained.md` Parts 11–12 — `practice_tests`, `practice_telemetry`, the BKT tables and the worked example
- **`LearnSyncAI artifacts/MIGRATION_PROMPTS_GEMINI.md` — the Groq → Gemini migration this feature was step 1 of. Prompts 2–5 move flashcards, games and chat, then delete `groq.ts`.**
- `LearnSyncAI artifacts/GEMINI_MIGRATION_STATUS.md` — why `gemini-2.5-flash` is dead
- `CLAUDE.md` — the rules that apply across the whole codebase
- The paper: **p. 75** (P(G) per format), **p. 80–81** (adaptive test algorithm), **p. 98** (the four AI verification criteria)
