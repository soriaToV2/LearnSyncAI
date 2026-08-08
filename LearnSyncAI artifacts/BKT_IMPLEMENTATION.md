# Bayesian Knowledge Tracing — Implementation Reference

**Feature:** The classical four-parameter BKT engine that estimates, per student per concept, the probability that the concept is known. It is the core algorithmic claim of the capstone paper.
**Status:** ✅ **Implemented and verified.** ICR = 235 / 235 = 100%, offline and against the live application.
**Date:** 7 August 2026
**Migrations applied:** **none.** Every table and column already existed, created by `20260723090004_bkt_engine.sql` and never written to. `bkt_mastery` and `bkt_update_logs` both had zero rows before this work.
**Files:** `server/lib/bkt.ts` (670 lines, new) · `scripts/bkt-verify.ts` (556, new) · `scripts/bkt-verify-live.ts` (567, new) · seams in `practice.routes.ts` and `flashcards.routes.ts`.
**Deleted:** `bkt_service/` (pyBKT FastAPI service), `server/routes/bkt.routes.ts`, the `axios` dependency.

> **Read this first if you are an AI agent debugging or extending BKT.**
> §2 is the non-negotiable rules — breaking one does not regress a feature, it invalidates something
> the paper claims. **§4 is the section that will save you the most time: three behaviours that look
> exactly like bugs and are not.** §13 is the debugging playbook. §14 lists what is deliberately left
> open — check it before "finding a bug". §8 explains why the verification harness is built the way
> it is; if you weaken it, the paper's headline number stops meaning anything.

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Non-negotiable rules](#2-non-negotiable-rules)
3. [The mathematics](#3-the-mathematics)
4. [Three behaviours that look like bugs and are not](#4-three-behaviours-that-look-like-bugs-and-are-not)
5. [The engine — `server/lib/bkt.ts`](#5-the-engine--serverlibbktts)
6. [The two writers](#6-the-two-writers)
7. [Data model](#7-data-model)
8. [The ICR harness](#8-the-icr-harness)
9. [Frontend surface](#9-frontend-surface)
10. [Security](#10-security)
11. [Decisions, and why](#11-decisions-and-why)
12. [What was deleted, and why](#12-what-was-deleted-and-why)
13. [Debugging playbook](#13-debugging-playbook)
14. [Known issues deliberately NOT fixed](#14-known-issues-deliberately-not-fixed)
15. [Verification evidence](#15-verification-evidence)
16. [Future work](#16-future-work)
17. [Glossary](#17-glossary)

---

## 1. What this is

### In one paragraph

Every concept an educator uploads gets, for every student, a number between 0 and 1: the probability
that the student knows it. It starts at 0.10 and moves every time the student produces evidence —
answering a question in Adaptive Test Mode, or rating a due flashcard. The update is Bayesian and
runs in two phases: first revise the estimate given what just happened, then add the chance the
student learned something from the attempt itself. Mastery drives the difficulty tier of the next
generated test, and is shown to the student in Test Mode. Nothing else may change it.

### Where it runs

**In the Express backend, in-process.** Paper p. 68: *"Within LearnSync AI, the four-parameter update
equations are implemented directly in the platform backend."* There is no Python service, no pyBKT,
no external library, no training step, and no HTTP hop.

### The division of ownership, which is the heart of the design

| Concern | Owner | Why there |
|---|---|---|
| The equations | `bktStep()`, pure and synchronous | So the ICR harness can verify them with no database |
| The parameters | the `bkt_parameters` table | One place to read; the paper's numbers are data, not code |
| Which P(G) applies | `GUESS_KEY_BY_FORMAT` / `GUESS_KEY_BY_RATING` | Exhaustive `Record`s, so `tsc` fails if a format is added |
| Chaining and persistence | `applyBktObservations()` | One code path for both writers, so clamping cannot drift |
| When an observation exists | the two routes | Test completion and the due-check already decide this |
| Proof of correctness | `scripts/bkt-verify.ts` | The paper reports its number |

### Status of each piece

| Piece | State |
|---|---|
| Two-phase update, EQ(1)/(2)/(3) | ✅ verified against the paper's own worked example |
| Per-format and per-rating P(G) | ✅ all eight, verified live through the database |
| `bkt_mastery` writes | ✅ both writers |
| `bkt_update_logs` audit trail | ✅ every update, both phases stored |
| `opportunity_count` | ✅ incremented (was never written by anything before) |
| EQ(4) document mastery | ✅ via `masterySnapshot()`, drives the tier and the UI |
| ICR harness | ✅ 235 cases, offline + live |
| Educator analytics views | ⚠️ exist in `schema.sql`, still unused by any code |
| `StudentDashboard.tsx` | ❌ still `MOCK_STUDENTS[0]` and a hardcoded `dueToday = 12` |

---

## 2. Non-negotiable rules

Each of these is load-bearing for a claim in the paper, not a style preference.

1. **Exactly two writers, forever.** `practice.routes.ts` (`PUT /:id/complete`) and
   `flashcards.routes.ts` (the `counted: true` branch of `POST /rate`). The `bkt_source` enum has
   exactly two values to enforce it at the database level. Paper p. 58: *"Student mastery estimates
   are updated exclusively through their performance in Adaptive Flashcards and Adaptive Test Mode."*
   Games, Free Recall and Feynman **read** mastery and must never write it.
2. **No pyBKT, no external BKT library, no Expectation Maximization.** Paper p. 70 rules EM out
   explicitly: the platform has no historical interaction data to fit against.
3. **Parameters are read from `bkt_parameters`, never hardcoded at a call site.** The literals in
   `BKT_FALLBACK_PARAMETERS` exist only for the case where the table cannot be read, and using one is
   always logged at error level.
4. **A concept with no `bkt_mastery` row is at P(L₀) = 0.10, not 0.** Applied at read time. Rows are
   deliberately never pre-seeded. Treating a missing row as zero would drag every snapshot toward 0
   and pin every test to `foundational` — invisibly, because that is also the correct answer for a
   new student.
5. **Mastery is clamped to `[1e-9, 1 − 1e-9]`, not `[0, 1]`.** See §4.2. This is not defensive
   padding; without it the model develops an absorbing state.
6. **`bkt_update_logs` is evidence, not a debug log.** Every row carries the prior, all three applied
   parameters, and *both* phases. It is what the Implementation Correctness Rate is measured from.
7. **`p_slip` and `p_transit` are written explicitly**, never left to the column DEFAULTs. The trail
   must record what was *applied*, not what the schema author assumed.
8. **`opportunity_count` never enters the arithmetic.** The paper uses "learning opportunity" only as
   the time index `t`. The column is reporting metadata.
9. **A BKT failure must never cost a student their score.** Both call sites `await` inside their own
   `try/catch`. Not fire-and-forget — Express 4 does not forward async rejections and there is no
   `unhandledRejection` handler, so a detached rejected promise takes the process down.
10. **Do not relax the flashcard due-check.** It is the only thing stopping a student farming mastery
    by re-drilling one card, and BKT's independence assumption depends on it.
11. **`applyTestCompletion()` is fed the `telemetry` array that was inserted**, never a
    re-derivation from `questions_payload`. One source means the two can never disagree, and
    `count(bkt_update_logs) == count(practice_telemetry)` stays a valid reconciliation.
12. **Do not weaken the harness's non-circularity rules.** See §8. A harness that computes its own
    expectations proves nothing, and the paper's headline number comes from this file.

---

## 3. The mathematics

### The equations (paper p. 69, EQ 1/2/3)

An observation `obs_t` is binary: 1 for correct, 0 for incorrect. Each observation triggers a
two-phase update.

**Evidence phase** — revise the estimate given what just happened.

```
correct     P(L_t | obs=1) = P(L_t)(1 - P(S))  /  [ P(L_t)(1 - P(S)) + (1 - P(L_t))·P(G) ]

incorrect   P(L_t | obs=0) = P(L_t)·P(S)       /  [ P(L_t)·P(S)      + (1 - P(L_t))(1 - P(G)) ]
```

**Transition phase** — add the chance the attempt itself taught them something.

```
P(L_t+1) = P(L_t | obs) + (1 - P(L_t | obs))·P(T)
```

**The value persisted as `latent_mastery` is the POST-TRANSITION one.** Paper p. 81: *"The active
value referenced in this aggregation is the most recently computed and saved P(L t+1)."* The
evidence-phase value is stored separately in `bkt_update_logs.p_l_evidence` for the audit, and is
never the running state.

### EQ(4) — document mastery (paper p. 81)

```
M_doc = Σ P(L_current, i) / N
```

The arithmetic mean over **every** concept in the material, with an unassessed concept counting as
P(L₀) = 0.10. Implemented in `masterySnapshot()` in `server/lib/testDifficulty.ts`, mirrored in SQL by
`document_mastery()` in `schema.sql`. It drives the difficulty tier and the UI figure.

### The parameters

All eleven live in the `bkt_parameters` table and are read at boot.

| Key | Value | Applies to |
|---|---|---|
| `p_l0` | 0.10 | Prior for an unassessed concept |
| `p_t` | 0.20 | Learning rate, every opportunity |
| `p_s` | 0.15 | Slip — knows it, answers wrong |
| `g_mc` | 0.25 | Multiple choice, 4 options → 1/4 |
| `g_tf` | 0.50 | True/false, binary → 1/2 |
| `g_id` | 0.05 | Identification — open-ended |
| `g_fib` | 0.05 | Fill in the blank — free recall |
| `g_match` | 0.17 | Matching, 1 of 6 definitions, **"applied per matched item"** |
| `g_easy` | 0.05 | Flashcard Easy → **obs = 1** |
| `g_medium` | 0.25 | Flashcard Medium → **obs = 1** |
| `g_hard` | 0.10 | Flashcard Hard → **obs = 0** |

**Hard is not a weak pass.** It records an *incorrect* answer, and the low guess value is precisely
what makes the drop steep — P(G) appears as `(1 − P(G))` in the incorrect denominator, so a smaller
P(G) means a bigger denominator and a larger fall. Paper p. 73 says this outright.

**Matching needs no special handling.** Test Mode already emits one telemetry row per matched term —
four rows per block, each with its own `concept_id` — which is exactly "applied per matched item".
Do not try to aggregate a block into one observation.

### ⚠️ How to cite these values

The paper is careful here and repo docs previously were not. **Do not describe these numbers as
empirically derived from research.**

- **Bulut et al. (2023)** is the source of the four-parameter *framework*, and of the statement that
  EM needs data the platform does not have.
- **Šarić-Grgić et al. (2024)** collects the *limits* the values must fall inside: Corbett &
  Anderson's `P(G) < 0.30` and `P(S) < 0.10`; Beck & Chang's `P(G) + P(S) < 1`; Baker, Corbett &
  Aleven's `P(G) < 0.50` and `P(S) < 0.50`.
- Paper p. 71: *"The knowledge tracing literature does not recommend specific numbers for these
  parameters, since published values are calculated from each study's own data."*
- Paper p. 76: they are *"selected configuration values operating within published limits."*

`loadBktParameters()` checks Beck & Chang's rule at boot and logs an error if any P(G) + P(S) ≥ 1.
Every current combination passes; true/false is the loosest at 0.65.

### The paper's worked example (p. 77) — the anchor case

Three multiple-choice attempts from 0.10: correct, correct, incorrect.

| Attempt | Result | After evidence | After transition |
|---|---|---|---|
| 1 | Correct | 0.27 | **0.42** |
| 2 | Correct | 0.71 | **0.77** |
| 3 | Incorrect | 0.40 | **0.52** |

Full precision, chained without rounding: 0.2742 → **0.4194**, 0.7106 → **0.7685**, 0.3990 →
**0.5192**. Maximum deviation from the printed values is 0.0015, well inside the ±0.01 tolerance.
**Store full precision; round only for display.**

### Single-step reference table, all from P(L₀) = 0.10

Useful when eyeballing a `bkt_update_logs` row.

| Context | P(G) | Correct → | Incorrect → |
|---|---|---|---|
| Multiple choice | 0.25 | 0.4194 | 0.2174 |
| True/false | 0.50 | 0.3271 | 0.2258 |
| Identification | 0.05 | 0.7231 | 0.2138 |
| Fill in the blank | 0.05 | 0.7231 | 0.2138 |
| Matching | 0.17 | 0.4857 | 0.2157 |
| Flashcard Easy | 0.05 | 0.7231 | — |
| Flashcard Medium | 0.25 | 0.4194 | — |
| Flashcard Hard | 0.10 | — | 0.2145 |

---

## 4. Three behaviours that look like bugs and are not

**This section exists because all three will be reported as defects.** Read it before changing
anything in `bktStep()`.

### 4.1 Getting every question wrong RAISES mastery

`posterior = e + (1 − e)·P(T)` is increasing in `e` and bottoms out at exactly **P(T) = 0.20** when
`e = 0` — which is *above* the 0.10 unassessed prior.

Twelve consecutive wrong multiple-choice answers, measured:

```
0.10 → 0.2174 → 0.2421 → 0.2480 → 0.2495 → 0.2499 → 0.2500 → 0.2500 → …
```

That limit is not empirical. Setting `L = e(L) + (1 − e(L))·P(T)` and clearing denominators gives a
quadratic; for multiple choice it reduces to **`4L² − 5L + 1 = 0`**, whose non-trivial root is
**exactly 0.25**. For true/false it is **`7L² − 9L + 2 = 0`** → **2/7 ≈ 0.2857**. Identification and
fill-in-the-blank settle at 0.2375, matching at 0.2441.

**Why this is correct.** A non-zero learning rate says the student had a learning opportunity, so
P(knows) rises a little even on weak evidence. That is what P(T) *means*.

**Why it is safe.** Every limit sits below the 0.50 `intermediate` threshold, so no amount of failing
can unlock a harder test.

**The trap for you:** the consecutive-incorrect cases in the ICR harness have *rising* expected
values. If you assume they should fall and "fix" the literals, you will break a correct engine.

### 4.2 Mastery is clamped below 1, and this is not cosmetic

At exactly `L = 1.0` the incorrect-answer update computes:

```
denominator = 1·P(S) + 0·(1 − P(G)) = P(S)
evidence    = 1·P(S) / P(S) = 1
posterior   = 1
```

**The state becomes absorbing: no evidence, ever, can lower it again.** And it is reachable — measured
saturation to exactly 1.0 in floating point after **13 consecutive Easy flashcard ratings** (28 for
multiple choice, 52 for true/false).

Continuous BKT approaches 1 asymptotically and never arrives, so the absorbing state is a
floating-point artifact, not a property of the model. `MASTERY_CEILING = 1 − 1e-9` restores the
"never certain" behaviour. 1e-9 is nine orders of magnitude below the paper's ±0.01 tolerance and
below the 4 decimal places the UI rounds to, so it cannot affect any hand-computed test case.

*(This is also how it was found: the odds-ratio cross-check in the harness returns NaN at saturation,
because `L/(1−L)` diverges.)*

### 4.3 Flashcards move mastery far faster than tests, and it is self-reported

With `g_easy = 0.05`, two Easy ratings run **0.10 → 0.7231 → 0.9824** — past the 0.85 `advanced`
threshold. Compare two correct multiple-choice answers (0.7685) or one correct true/false (0.3271).

That is what a 0.05 guess rate means, and paper p. 72 specifies it. **Do not change it.** The brake
already exists: Easy pushes the card seven days out, so a deck cannot be farmed in an afternoon, and
a not-due rating produces no observation at all.

Expect the first live run to show a study space jumping to `advanced` after one thorough deck review.
It is not broken.

---

## 5. The engine — `server/lib/bkt.ts`

### Exported surface

```ts
// Parameters
export type GuessKey = 'g_mc'|'g_tf'|'g_id'|'g_fib'|'g_match'|'g_easy'|'g_medium'|'g_hard';
export interface BktParameters { pL0: number; pT: number; pS: number;
                                 guess: Readonly<Record<GuessKey, number>>; }
export const BKT_FALLBACK_PARAMETERS: Readonly<BktParameters>;
export async function loadBktParameters(opts?: { force?: boolean }): Promise<BktParameters>;

// The pure core — the only thing the ICR harness's correctness sections touch
export function bktStep(input: BktStepInput): BktStep;

// Context → P(G). Exhaustive Records, so tsc fails if a format is ever added.
export const GUESS_KEY_BY_FORMAT:   Readonly<Record<QuestionFormat, GuessKey>>;
export const GUESS_KEY_BY_RATING:   Readonly<Record<EaseRating, GuessKey>>;
export const OBSERVATION_BY_RATING: Readonly<Record<EaseRating, 0 | 1>>;

// Orchestration
export type BktObservation = /* discriminated union, see below */;
export async function applyBktObservations(studentId, observations, opts?): Promise<BktApplyResult>;
export async function applyTestCompletion(args): Promise<BktApplyResult>;   // adapter
export async function applyFlashcardRating(args): Promise<BktApplyResult>;  // adapter
export function bktProblems(result: BktApplyResult): string[];
```

### `bktStep()` — the whole algorithm

Pure, synchronous, no I/O. Returns the **entire** step rather than a bare number, so a
`bkt_update_logs` row is a spread and the harness can print both phases the way the paper does.

```ts
interface BktStep {
  prior: number;       // P(L_t), after clamping
  observation: 0 | 1;
  pGuess: number; pSlip: number; pTransit: number;
  evidence: number;    // EQ(1) or EQ(2)
  posterior: number;   // EQ(3) — this is what gets persisted
}
```

**Division-by-zero guard:** `if (!(denominator > 0)) evidence = prior`. Both denominators are sums of
non-negative products and both are reachably zero (P(G) = 0 with L = 0 passes the CHECK constraints).
A zero denominator means the model assigns zero likelihood to the observation under *both*
hypotheses, so the observation carries no information and the Bayesian answer is to keep the prior.
The `!(x > 0)` form also catches NaN.

**Clamping is applied inside `bktStep()`** — to `prior`, `evidence` and `posterior` — so no caller can
forget. This matters: every one of `latent_mastery`, `p_l_prior`, `p_guess`, `p_slip`, `p_transit`,
`p_l_evidence`, `p_l_posterior` carries a `>= 0 AND <= 1` CHECK, and **one out-of-range value rejects
the entire batch upsert**, losing mastery for every concept in the test.

### The parameter cache

Module-level, **process lifetime, no TTL**, with an in-flight promise so concurrent first requests
collapse into one query. Paper p. 75: *"The four parameters … never change … and remain constant for
as long as the system runs."* A mid-session refresh would let one student's audit trail be internally
inconsistent — half computed under one P(S), half under another.

Warmed at boot from `server/index.ts`, which prints the resolved set. A bad row therefore shows up in
the boot log rather than mid-assessment.

**Per-key fallback with a loud log**, never a throw. A missing reference row must not stop knowledge
tracing for a live student, but a *changed* row is a legitimate admin action while a *missing* one is
corruption — the log line is what separates them.

> **Trap.** Never write `Number(v) || FALLBACK`. The CHECK on `bkt_parameters.value` is inclusive of
> 0, so an admin may legitimately set a guess probability to exactly 0, and `||` would silently
> replace it. Validation is `Number()` → `Number.isFinite` → range, explicitly.

### `BktObservation` — a discriminated union, deliberately

```ts
export type BktObservation =
  | { source: 'adaptive_test'; conceptId: string | null; questionType: QuestionFormat;
      isCorrect: boolean; practiceTestId: string; questionIndex: number }
  | { source: 'flashcard';     conceptId: string | null; rating: EaseRating; flashcardId: string };
```

**The flashcard arm carries no `isCorrect`** — it is derived from `OBSERVATION_BY_RATING`, so
`{ rating: 'hard', isCorrect: true }` is unrepresentable. The same split guarantees each log row sets
exactly one of `question_type` / `rating`; a flashcard row carrying a question type would be nonsense.

### `applyBktObservations()` — the orchestrator

One orchestrator, two thin adapters. The flashcard case is literally
`applyBktObservations(id, [obs])`. Two orchestrators would mean two places for clamping, upsert shape
and `last_updated` to drift — and drift between the two writers is exactly what the ICR would catch
embarrassingly late.

Steps, in order:

1. **Filter null `conceptId`** into `skipped` (`reason: 'no_concept'`). `flashcards.concept_id` is
   nullable for hand-written cards; both BKT columns are NOT NULL.
2. **Existence-check every concept** against the `concepts` table. Not padding — see §13.
3. **Read priors** in one query. `Number()` every `latent_mastery` (NUMERIC arrives as a string over
   PostgREST). Missing row → `params.pL0`, `opportunityCount: 0`.
4. **Group by concept**, preserving first-seen order for deterministic log ordering.
5. **Chain**: `posterior` of observation *k* becomes the `prior` of *k+1*, per concept.
6. **Write mastery, then logs.**

**It never rejects for a data reason.** Failures come back as `masteryWriteError` / `logWriteError`.
It can still throw on a programming error, which is why the call sites keep their own `try/catch`.

### `created_at` is staggered one millisecond per row

Postgres `now()` is **transaction-start** time, so every row of a batch insert gets a *byte-identical*
timestamp, and `ORDER BY created_at` on `idx_bkt_update_logs_student_concept` returns the chain
scrambled — which would make the ICR audit query unreadable.

Today one concept never repeats inside one batch (`allocateConcepts()` gives one question per
concept; flashcards are N = 1), so the ties are all *between* independent chains and this is insurance
rather than a fix. **Keep it anyway** — the invariant lives upstream and could change.

The same instant is used for `bkt_mastery.last_updated`, so a state row can be joined to its audit
rows by timestamp. **That column has no trigger and must be set explicitly on every write.**

### Write order: mastery first, then logs

`bkt_mastery` is the state the rest of the system reads — the difficulty tier, EQ(4), both analytics
views. `bkt_update_logs` has no runtime reader. If only one write can survive, it must be the state.

The failure modes are asymmetric:

- **Mastery written, log missing** → a documented hole, and the observation still exists in
  `practice_telemetry` / `spaced_repetition_logs`, so the row is reconstructable.
- **Log written, mastery missing** → the *next* observation chains from a stale prior, and that next
  row's `p_l_prior` contradicts this row's `p_l_posterior`. Permanent corruption of the audit trail,
  which for a paper about implementation correctness is much worse.

So **a failed mastery upsert writes no logs at all.**

**Why no Postgres RPC.** It would buy atomicity between two writes whose failure modes are already
ranked and survivable, and it does *not* fix the read-modify-write race unless the arithmetic also
moves into plpgsql — a second implementation of the equations that the ICR does not verify. Two
implementations that can disagree is strictly worse here than one with a documented non-atomic write.

---

## 6. The two writers

### Adaptive Test Mode — `practice.routes.ts`, `PUT /:id/complete`

```
requireOwnedTest (404)
  → fast-path return if already completed
  → buildResult()  (pure grading)
  → UPDATE practice_tests … .eq('status','in_progress').select('id')   ← compare-and-swap
  → zero rows?  return the stored result, write nothing
  → INSERT practice_telemetry  (one row per question)
  → applyTestCompletion()  ← BKT, awaited, in try/catch
  → res.json()
```

**The compare-and-swap is what actually makes completion idempotent.** The status check above it
reads a row fetched moments earlier, so two racing requests — a double-tap on Submit, or a retry after
a slow response — both saw `in_progress` and both fell through. Before BKT that duplicated a
telemetry batch; with BKT attached it would apply every observation twice and inflate mastery for the
whole test. Postgres serialises the two updates, so exactly one gets a row back.

**BKT runs even if the telemetry insert failed.** Mastery is the student's actual knowledge state and
outranks the audit trail's completeness; the divergence is logged.

**Unanswered questions become observations.** `buildResult()` already grades a skip as incorrect and
the score already divides by total, so mastery must agree — and
`count(bkt_update_logs) == count(practice_telemetry)` stays valid. Per §4.1 this *raises* mastery
slightly, so the abuse vector is inverted and weak.

### Adaptive Flashcards — `flashcards.routes.ts`, `POST /rate`

```
Zod parse (400)
  → card → deck → space ownership walk (404 on every miss)
  → isDue(card.next_review_at)?   not due → { counted: false }, write nothing
  → UPDATE flashcards … .or('next_review_at.is.null,next_review_at.lte.<now>').select('id')
  → zero rows?  → { counted: false }   (a concurrent request already claimed it)
  → INSERT spaced_repetition_logs
  → applyFlashcardRating()  ← BKT, awaited, in try/catch
  → res.json({ counted: true })
```

**The due-check is the whole protection**, and it now guards mastery as well as the schedule. A card
re-drilled thirty seconds after being rated is not due, so it produces no observation. Without that,
mastery would climb fastest on exactly the concepts a student re-drills *because* they are
struggling — and BKT's assumption that each observation independently tests latent knowledge would be
false.

> **It must be `.or(...)`, not `.lte(...)`.** `isDue()` returns **true for null**, and
> `next_review_at = NULL` never satisfies `<=`. A plain `.lte` would make a card that lost its
> schedule permanently unratable.

**A hand-written card has no `concept_id`** and is skipped rather than failing the request.

---

## 7. Data model

No migration was written. All four tables predate this work.

### `bkt_mastery` — the state

```sql
student_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
concept_id        UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE
latent_mastery    NUMERIC NOT NULL DEFAULT 0.10  CHECK (>= 0 AND <= 1)
opportunity_count INTEGER NOT NULL DEFAULT 0
last_updated      TIMESTAMPTZ DEFAULT now()      -- nullable, NO TRIGGER
UNIQUE (student_id, concept_id)                  -- the upsert conflict target
```

Written with `.upsert(rows, { onConflict: 'student_id,concept_id' })`.

### `bkt_update_logs` — the evidence

Append-only. `p_l_evidence` is EQ(1)/(2); `p_l_posterior` is EQ(3). `flashcard_id` /
`practice_test_id` and `rating` / `question_type` are paired by convention (the union type enforces
it), not by constraint. **No unique constraint** — idempotency is the routes' job.

### `practice_telemetry` — the test-side input

One row per question of a completed test, written once at completion. `question_type` selects the
P(G); it is NOT NULL since migration 0011, and its omission is what silently broke this table for
months before Test Mode was rebuilt.

### `bkt_parameters` — the eleven values

`key TEXT PRIMARY KEY, value NUMERIC CHECK (>= 0 AND <= 1), description TEXT`.

### RLS

All four tables have RLS enabled. Students get **SELECT only** on `bkt_mastery` and
`bkt_update_logs`; there is **no INSERT/UPDATE policy for anyone**. Every write therefore goes through
`supabaseAdmin` (service role), which bypasses RLS — so the API layer must enforce ownership itself,
which is what the two gate chains in §6 do.

### TypeScript mirrors

`server/types/database.ts` now carries `BktMastery`, `BktUpdateLog`, `BktParameter`,
`PracticeTelemetry`, plus the `QuestionType` and `BktSource` enums. These are documentation — no route
imports them; each declares its own inline shapes.

---

## 8. The ICR harness

### What it is for

Paper pp. 94–96. There is no accuracy metric, because the parameters are selected rather than
learned. Instead:

> *"The BKT module is evaluated through deterministic algorithm verification, confirming whether the
> system's programmatic implementation produces mastery estimates that are mathematically identical
> to hand-computed expected values… These test cases cover consecutive correct responses, consecutive
> incorrect responses, alternating responses, and mixed sequences across Adaptive Flashcard ratings
> (Easy, Medium, Hard) and Adaptive Test Mode question types… Each test case is executed in the live
> application."*
>
> **EQ(6):** `ICR = (passed / total) × 100`, passing at `|actual − expected| ≤ 0.01`.

### Running it

```bash
npm run bkt:verify                              # offline — the arithmetic
npm run bkt:verify -- --live                    # + the real flashcard endpoint
npm run bkt:verify -- --live --live-test        # + generate and sit a real test
npm run bkt:verify -- --live --keep             # leave the throwaway student behind
```

`--live` needs `npm run dev:server` running. It **builds its own throwaway student** — profile, study
space, deck, four flashcards on real concepts — exercises the endpoints, and deletes the account in a
`finally`. Everything cascades from `profiles.id`, so nothing is left behind and it is safe to re-run.

⚠️ **`--live-test` burns one of the ~11 daily Groq generations the whole account has.**

⚠️ **Do not edit files while `--live` is running.** The dev server is `tsx watch`; a restart kills the
in-flight request and produces failures that look like engine defects. This happened once during
development and cost about twenty minutes — 18 checks failed, which is exactly one rating's 15 checks
plus the 3 direction comparisons that depend on it.

### The three non-circularity rules — the point of the whole file

A harness that computes its expected answers with the code under test proves nothing.

**Rule 1 — §2 states every parameter as a LITERAL and never looks one up.** It imports `bktStep` and
nothing else. If it fetched P(G) through `GUESS_KEY_BY_FORMAT`, a mapping bug (true/false wired to
`g_mc`) would **pass**, because both sides would use the same wrong number. §1 tests those maps
separately, against literals from the paper.

**Rule 2 — §3's expectations come from an independent derivation: the odds-ratio form.**

```
odds(L) = L / (1 - L)
correct     odds(L | obs=1) = odds(L) · (1 - P(S)) / P(G)
incorrect   odds(L | obs=0) = odds(L) · P(S) / (1 - P(G))
transition  P(L_t+1)        = 1 - (1 - e)(1 - P(T))
```

Algebraically identical to EQ(1)/(2)/(3) — divide numerator and denominator of EQ(1) by
`(1−L)·P(G)` to see it — but no shared arithmetic whatsoever. Required to agree to **1e-12**, far
tighter than the paper's ±0.01, because two exact derivations of one expression should agree to
machine precision and anything looser would hide a real discrepancy inside the display tolerance.

**Rule 3 — chained cases restate their prior as a literal**, so one slip is one failure rather than a
cascade. §4 exists to close the gap that leaves: it runs the chain for real and checks only the final
value.

**§5 depends on no arithmetic at all** — the closed-form fixed points from §4.1, solved with the
quadratic formula on paper.

### Sections

| § | What | Expectations derived from | n |
|---|---|---|---|
| 1 | All 11 parameter values; the 5 format and 3 rating mappings; Hard → obs 0 | literals quoted from the paper | 22 |
| 2 | The paper's p.77 worked example, plus one correct and one incorrect step at every P(G) | published / hand arithmetic, printed in full | 32 |
| 3 | 5 formats × 4 patterns, plus 4 flashcard rating sequences | independent odds-ratio derivation | 84 |
| 4 | Multi-observation chains, final value only | hand arithmetic | 23 |
| 5 | All-incorrect convergence | closed-form quadratic roots | 4 |
| 6 | Live `POST /api/flashcards/rate` | the §2 literals, prior forced to cold start | 54 |
| 7 | Live full adaptive test | every row re-derived from its own recorded prior | 16 |

The report is fixed-width and pastes straight into an appendix. **Exit code is non-zero below 100%**,
so it can gate a commit.

### What `--live` proves that offline cannot

Offline checks could all pass while the engine is never actually called — precisely the class of
defect that hid in the telemetry insert for months. Live mode signs in through Supabase and sends a
normal Bearer token, so the run traverses `authenticate` and `requireRole('student')` exactly as the
browser does. It deliberately does **not** mint a service-role JWT, which would skip the middleware
it is meant to exercise.

**It forces the prior to a known value** (a brand-new student has no `bkt_mastery` rows, so every
prior is a true cold-start 0.10). Without that, live mode could only show a row is self-consistent —
an integration claim wearing a correctness claim's clothes.

The test leg reads `questions_payload` with the service role to obtain the answer key, because
`stripKey()` correctly refuses to put it on the wire. **That is a deliberate dev-tool privilege the
browser never has, not a hole.**

---

## 9. Frontend surface

Two read endpoints, both gated by `requireOwnedSpace()` (404, never 403), both computing EQ(4) with
`documentMastery()` — **the same function that picks a test's difficulty tier** — so every figure a
student sees is provably the figure the generator used. Types live in **`src/lib/mastery.ts`**, not
`testMode.ts`: mastery is fed by flashcards as well as tests, so filing it under one of its two
writers would have been arbitrary.

### `GET /api/practice/space/:spaceId/mastery` — summary

Test Mode's hot path; refetched on mount and after every submission, so it deliberately carries no
per-concept data.

```ts
interface SpaceMastery {
  overall: number | null;        // null when NOTHING has been assessed
  tier: DifficultyTier;
  concepts_total: number;
  concepts_assessed: number;
  last_updated: string | null;
  by_material: { material_id: string; m_doc: number; tier: DifficultyTier;
                 concept_count: number; assessed_concept_count: number }[];
}
```

### `GET /api/practice/space/:spaceId/mastery/concepts` — summary + every concept

Powers the Analytics tab. Same shape, but each `by_material` entry also carries a server-supplied
`title` and a `concepts: ConceptMastery[]` array sorted **assessed-first, weakest ascending**, with
unassessed after. Measured at **5.6 KB for 29 concepts**, so the whole space arrives in one request
rather than expanding per material.

Each concept carries `assessed` — the flag that separates "no evidence" from "low mastery". When it
is false, `mastery` is exactly P(L₀) and **must not be displayed**.

`title` is sent by the server rather than joined client-side because the obvious join target,
`GET /spaces/:id/materials`, filters on `parsed_status = 'completed'` while these routes filter on
published ∩ linked — so during a re-upload a material can appear here with its concepts intact and no
title on the other side.

> **Neither uses `v_student_material_mastery`.** That view double-counts: a material linked to two of
> the same student's spaces joins twice, inflating `concept_count` and `mastered_concept_count` (the
> average survives). The view is unused elsewhere and was left alone.

> **Both are read-only, permanently.** Paper p. 58 and the `bkt_source` enum allow exactly two mastery
> writers. Nothing served from either route may ever write `bkt_mastery` or `bkt_update_logs`.

### The one rule that makes the panel honest

**When `concepts_assessed === 0`, render a dash and "not assessed yet" — never "10%".** Every
unassessed concept counts as the prior inside EQ(4), so a student who has done nothing still averages
0.10, and printing that as a percentage tells them they know a tenth of a lesson they have never
opened. `concepts_assessed` is the field that separates the two cases. **If it is ever dropped from
the payload, drop the panel.**

This is the same objection that kept a mastery panel out of Test Mode before BKT existed. The answer
is not "now we have numbers" but "now we can tell which numbers are evidence."

### What changed in `AdaptiveTestTab.tsx`

1. A **Mastery** tile, fourth in the overview stat grid (now `grid-cols-2 sm:grid-cols-4`), with a
   caption reading either *"No concepts assessed yet…"* or *"Estimated from 12 of 29 concepts
   answered so far."*
2. The subtitle is now *"…set to what you have already mastered"* — **past tense**, because
   difficulty is chosen once when the test is built. An older version claimed it adapted mid-session,
   which it never did.
3. **The useful one:** a line under the lesson dropdown on setup step 1 — *"Your mastery here is 42%,
   so this test will be built at intermediate level."* This is the only place adaptivity is visible
   to a human, and it is exactly what the p. 98 Difficulty Alignment check is about. Shown only once
   `assessed_concept_count > 0`; at a cold start the tier is foundational for everyone and says
   nothing.
4. Mastery is fetched inside `refreshList()`, so it reloads everywhere the list does — including
   immediately after submitting a test, which is the one moment the number has just changed and the
   student is looking at it. Its failure has a separate `catch` so it cannot blank the past-tests list.

### `TIER_TONE` — `foundational` is neutral, never red

The tiers are *where a student is*, not how well they did. Everyone starts foundational, so painting
it red marks every new student as failing at something they have not attempted. `scoreTone()` is not
reused for the same reason: its 80/60 cut-offs describe a test score, and the thresholds that mean
anything here are 0.50 and 0.85.

---

## 10. Security

BKT introduces no new trust surface, because it never accepts client input. What matters:

- **Neither writer takes an observation from the request body.** Test observations are built from
  `questions_payload` server-side; flashcard observations are derived from `rating` through
  `OBSERVATION_BY_RATING`. `SubmitAnswerSchema` still has no `is_correct` and no `concept_id`, and
  that must not change.
- **Ownership is enforced before any write.** Test: `requireOwnedTest()` → 404. Flashcards: card →
  deck → space → caller, 404 on every miss. Without that walk, a student could write mastery against
  a stranger's concepts.
- **The mastery read is space-scoped and owner-checked.** The deleted `GET /api/bkt/mastery` returned
  every mastery row a student had, in one unscoped call; the replacement is one owned space.
- **All writes use `supabaseAdmin`** because there is no INSERT/UPDATE RLS policy on the BKT tables
  for any role. RLS therefore protects nothing here — the route gates are the whole defence.
- **There is no `POST /recalculate` and there must not be one.** BKT is a consequence of an
  assessment, not something a client asks for; an endpoint would be a third writer.

---

## 11. Decisions, and why

### Retakes DO write mastery

Paper p. 81 describes a student generating a new test on the same topic and the system querying
*"this historical BKT mastery probability"* to scale it — a continuing chain is the documented
behaviour. Completion idempotency stops one test counting twice; a *retake* is a new test with freshly
generated questions. Natural brakes: the ~11 tests/day Groq cap, and rising mastery escalating the
tier against the student.

### No backfill of pre-existing telemetry

At implementation time the database held **143 telemetry rows across 5 completed tests, all from one
QA account**, with identification **0 correct out of 24** (clicking through) and mastery force-set by
`scripts/set-test-mastery.ts` between runs to exercise the tiers.

Decisive: **57 concepts spanned more than one test, and 29 were touched by *both*
`practice_telemetry` and `spaced_repetition_logs`.** A faithful replay would have to interleave two
sources chronologically, and BKT is order-dependent. Backfilled `bkt_update_logs.created_at` would
also all be `now()`, corrupting the very chronology the audit reads.

The rows were **left in place** — nothing replays them, and they are the evidence
`TEST_MODE_IMPLEMENTATION.md` §16 cites.

### The update runs inline, awaited, in try/catch

Not fire-and-forget: `server/index.ts` has no `unhandledRejection` handler and Express 4's error
middleware cannot see an async throw, so a detached rejected promise takes the process down. Not
fatal either: a BKT failure must not cost a student the score they are waiting for — the same rule
that governs Free Recall's feedback call.

### Lowest-mastery concept ordering: NOT implemented, deliberately

An older comment in `POST /api/practice` proposed re-ordering concepts by ascending mastery once BKT
existed. **It should not be done, and the comment has been rewritten to say so.**

It would achieve nothing: `allocateConcepts()` emits one question per concept for **every** concept —
there is no length cap — so ordering cannot change *which* concepts are asked about, only which format
each lands in. (The lone exception is a matching-only test, where coverage is a multiple of four and
one to three concepts fall off the end.)

And the sign is wrong anyway: `orderedFormats()` puts `multiple_choice` first, so weakest-first would
hand the least-known concepts the format with the **highest** guess probability, P(G) = 0.25 — the
least informative evidence for precisely the concepts most in need of measurement.

### `P_L0` stays a compile-time constant in `testDifficulty.ts`

A code comment there previously said Phase 3 should read it from `bkt_parameters`. It should not —
that would put the difficulty tier behind a network read whose failure changes the tier. Instead
`loadBktParameters()` **asserts** the two agree and logs loudly on mismatch.

---

## 12. What was deleted, and why

| Deleted | Why |
|---|---|
| `bkt_service/main.py` + `requirements.txt` | A FastAPI service using `slip 0.1` (paper says 0.15) and a **single flat `guess 0.2`** instead of the eight context-sensitive values. It read only `practice_telemetry`, so flashcard observations never entered the sequence, and it wrote no `bkt_update_logs` and never set `opportunity_count`. Its docstring claimed pyBKT, which `CLAUDE.md` forbids outright. |
| `server/routes/bkt.routes.ts` | Its proxy. Two endpoints, **zero callers anywhere including the frontend**. `POST /recalculate` would have been a third mastery writer. |
| `axios` (dependency) | `bkt.routes.ts` was its only importer in the entire repo. |
| `BktRecalculateSchema` in `types/api.ts` | Only used by the deleted route. |
| `BKT_SERVICE_URL` in `.env`, four `bkt_service/` lines in `.gitignore` | Orphaned config. |

---

## 13. Debugging playbook

### "Mastery isn't changing"

Work down this list; it is ordered by how often each is the cause.

1. **Was the flashcard actually due?** A not-due rating writes nothing by design and returns
   `counted: false`. Check `flashcards.next_review_at` against `now()`.
2. **Does the card have a `concept_id`?** A hand-written card has none and is skipped.
3. **Was the test already completed?** The compare-and-swap means a second completion writes nothing.
4. **Look for the log line.** Every problem is reported with a `[BKT]` prefix naming the student and
   the test or card:
   ```
   [BKT] test=<id> student=<id>: mastery upsert failed: <message>
   [BKT] card=<id> student=<id>: skipped 3 observation(s): 3 concept_missing
   ```
5. **Check the parameters loaded.** The boot log prints them. If it printed an error, the engine is
   running on `BKT_FALLBACK_PARAMETERS`.

### "The numbers look wrong"

**First, read §4.** Three correct-looking complaints live there: failing raises mastery, mastery never
quite reaches 1, and flashcards move much faster than tests.

Then re-derive the row by hand. Every `bkt_update_logs` row is self-contained:

```sql
SELECT concept_id, source, observation,
       p_l_prior, p_guess, p_slip, p_transit, p_l_evidence, p_l_posterior, created_at
FROM bkt_update_logs
WHERE student_id = '<uuid>' AND concept_id = '<uuid>'
ORDER BY created_at;
```

Feed `p_l_prior`, `observation`, `p_guess`, `p_slip`, `p_transit` back into EQ(1)/(2) and EQ(3) and
compare. `npm run bkt:verify -- --live --live-test` does exactly this for every row of a fresh test.

### Reconciliation queries

All four were run against the live project and return what they should.

> ⚠️ **The first query needs the date filter.** Five QA tests completed *before* BKT existed (the
> newest at `2026-08-07 07:40 UTC`; the engine landed at roughly `11:15 UTC` the same day). They have
> telemetry and, correctly, no audit rows — see §11 on why they were not backfilled. Without the
> filter they show up as five permanent false positives.

```sql
-- Every completed test must have as many audit rows as telemetry rows.
SELECT t.practice_test_id,
       count(*)                                        AS telemetry,
       (SELECT count(*) FROM bkt_update_logs l
         WHERE l.practice_test_id = t.practice_test_id) AS audit
FROM practice_telemetry t
JOIN practice_tests pt ON pt.id = t.practice_test_id
WHERE pt.completed_at > '2026-08-07 08:00:00+00'   -- exclude the pre-BKT QA tests
GROUP BY t.practice_test_id
HAVING count(*) <> (SELECT count(*) FROM bkt_update_logs l
                     WHERE l.practice_test_id = t.practice_test_id);

-- The chain must be continuous: each row's prior equals the previous posterior.
SELECT concept_id, created_at, p_l_prior, p_l_posterior,
       lag(p_l_posterior) OVER w AS previous_posterior
FROM bkt_update_logs
WHERE student_id = '<uuid>'
WINDOW w AS (PARTITION BY concept_id ORDER BY created_at)
ORDER BY concept_id, created_at;

-- Stored mastery must equal the most recent posterior.
SELECT m.concept_id, m.latent_mastery, m.opportunity_count, l.p_l_posterior
FROM bkt_mastery m
JOIN LATERAL (
  SELECT p_l_posterior FROM bkt_update_logs
   WHERE student_id = m.student_id AND concept_id = m.concept_id
   ORDER BY created_at DESC LIMIT 1
) l ON TRUE
WHERE m.student_id = '<uuid>' AND abs(m.latent_mastery - l.p_l_posterior) > 0.0001;

-- Only the two permitted sources may appear.
SELECT source, count(*) FROM bkt_update_logs GROUP BY source;
```

### Forcing a mastery value

```bash
npx tsx scripts/set-test-mastery.ts intermediate    # 0.65 across "7. Information Security"
npx tsx scripts/set-test-mastery.ts advanced        # 0.92
npx tsx scripts/set-test-mastery.ts 0.72            # any value
npx tsx scripts/set-test-mastery.ts reset           # delete the rows → back to P(L0)
```

⚠️ **It now competes with the live engine** — real answers overwrite whatever it sets. Run `reset`
before a genuine verification run. `reset` deletes rows rather than zeroing them, which is the correct
"no evidence" state.

⚠️ **The tier is baked in when a test is generated.** Changing mastery does not re-tier an existing
test; generate a new one.

### Symptom → cause

| Symptom | Likely cause |
|---|---|
| `counted: false` on every rating | Cards are not due. Check `next_review_at`. |
| Mastery rises after a wholly wrong test | Correct — §4.1. |
| A concept stuck at a high value | Check for saturation; should be impossible since the clamp, but verify `latent_mastery < 1`. |
| Whole batch missing, one bad concept | A deleted concept failed the FK. The existence check should have caught it — look for `concept_missing` in the logs. |
| `bkt_update_logs` rows out of order | Something changed the `created_at` staggering. |
| Audit rows exist, mastery does not | Impossible via the engine (mastery writes first). Suspect a manual DB edit. |
| Boot log shows fallback parameters | `bkt_parameters` is unreachable or a key is missing/out of range. |
| ICR < 100% right after editing a file | The dev server restarted mid-run. Re-run without editing. |

---

## 14. Known issues deliberately NOT fixed

1. **A concurrent flashcard rating and test completion touching the same concept can lose one
   update.** Both read the prior, both write; last one wins. There is no transaction available
   through supabase-js, and the fix would require moving the arithmetic into plpgsql — a second
   implementation the ICR does not verify. The window is one student's two devices submitting within
   milliseconds. A lost `opportunity_count` increment is acceptable because it is reporting metadata.
   *If this ever matters, the right shape is a `bkt_apply_batch(uuid, jsonb)` RPC that is a **pure
   writer** — taking already-computed values from TypeScript, not recomputing them.*
2. **`v_student_material_mastery` and `v_grade_level_mastery` double-count** a material linked to two
   of the same student's spaces (`concept_count` and `mastered_concept_count` inflate; the average is
   fine). Both views are unused by any code. The new mastery endpoint sidesteps them entirely. Left
   alone rather than migrated.
3. **`StudentDashboard.tsx` still runs on `MOCK_STUDENTS[0]`** with a hardcoded `dueToday = 12`. It is
   where mastery would naturally surface next, and it is a separate job.
4. **Groq's free tier is ~11 test generations per day for the whole account.** Unchanged by this work
   and no code fixes it; a 50-student study needs a paid tier. Also caps how often `--live-test` can
   run.
5. **The educator analytics path is untouched.** Mastery now exists for the views to read, but nothing
   queries them yet.
6. **`opportunity_count` counts observations, not sessions.** A 29-question test increments 29
   different concepts by 1 each, not one counter by 29. That is the intended reading of "learning
   opportunity" (paper p. 71: *"a flashcard review or a single test item"*), but the column name
   invites the other interpretation.

---

## 15. Verification evidence

All checks run against the live project on **7 August 2026**.

**Static:** `npm run lint` (`tsc --noEmit`) and `npx vite build` both clean.

**ICR — `npm run bkt:verify -- --live --live-test`:**

```
  §1  Parameter fidelity                                               22 / 22
  §2  Hand-computed anchors                                            32 / 32
  §3  Full response matrix, direct form vs odds-ratio form             84 / 84
  §4  Sequence correctness — posterior fed forward as the next prior   23 / 23
  §5  Analytic convergence of an all-incorrect run                      4 / 4
  §6  Live application — POST /api/flashcards/rate                     54 / 54
  §7  Live application — a full adaptive test                          16 / 16
────────────────────────────────────────────────────────────────────────────
  EQ(6)   ICR = 235 / 235 × 100 = 100.0%
```

**Cross-implementation:** 227 chained steps compared between the direct probability form and the
odds-ratio form; worst disagreement **1.67e-16**. (Diverges to NaN only at saturation, which is how
§4.2 was discovered.)

**The paper's worked example reproduced exactly:** 0.2742 / **0.4194**, 0.7106 / **0.7685**, 0.3990 /
**0.5192** — rounding to the published 0.42 / 0.77 / 0.52.

**Analytic limits confirmed by iteration:** multiple choice → 0.2500 (root of `4L² − 5L + 1 = 0`);
true/false → 0.2857 (`7L² − 9L + 2 = 0`, i.e. 2/7); identification → 0.2375; matching → 0.2441.

**Live flashcard leg, 54 checks:** all three ratings produced exactly the hand-computed posterior
(Easy 0.7231, Medium 0.4194, Hard 0.2145) with `p_l_prior` 0.1000, the correct P(G), `p_slip` 0.1500,
`p_transit` 0.2000, matching `p_l_evidence`, `question_type` NULL, `rating` set, and
`opportunity_count` 1. Direction checks passed: Easy > Medium, Hard < Medium. A **not-due** rating
wrote nothing at all — no mastery row, no audit row. **Re-drilling a just-rated card** returned
`counted: false` and left both mastery and `opportunity_count` unchanged.

**Live adaptive test leg, 16 checks:** a 29-question test across all five formats produced **29 audit
rows for 29 telemetry rows**; all 29 re-derived from their own recorded prior; every format used its
correct P(G) (mc 0.25, tf 0.50, id 0.05, fib 0.05, match 0.17); mastery matched the final posterior
for all 29 concepts; no test row carried a `rating`. **Re-completing wrote no further rows** of
either kind.

**Cross-feature evidence:** the test's stored `mastery_snapshot` came back as **0.1364**, not 0.10 —
because the flashcard leg had already moved three of that material's 29 concepts. That is EQ(4)
computed correctly *and* proof that flashcard ratings reach the test generator's difficulty decision,
which neither feature demonstrates alone. After the test, EQ(4) stood at **0.4056**.

**Cleanliness:** after every run, `bkt_mastery` = 0 rows, `bkt_update_logs` = 0 rows, throwaway
students = 0. The pre-existing QA data (143 telemetry rows, 5 completed tests, 29 spaced-repetition
logs) was deliberately preserved and is untouched.

**Pre-flight checks before shipping the two compare-and-swaps:** `practice_tests` with NULL `status` =
0, `flashcards` with NULL `next_review_at` = 0 — so neither CAS can strand an existing row.

---

## 16. Future work

Ordered by how much they matter.

1. **Educator analytics.** `v_grade_level_mastery` exists and now has real data behind it. Fix the
   double-count first (§14.2).
2. **`StudentDashboard.tsx`.** Replace `MOCK_STUDENTS[0]` and the hardcoded `dueToday`. EQ(4) is the
   natural progress bar — paper p. 81 describes exactly that.
3. **A mastery-over-time figure for the paper.** `bkt_update_logs` is a complete per-concept
   time series. This belongs in a script producing a chart, not in the tab.
4. **Games reading mastery.** Paper pp. 82–83 has `M_doc` calibrating game difficulty; games
   currently ignore it. Read-only, so it does not touch the two-writer rule.
5. **Post-deployment parameter fitting.** Paper p. 76 names this as future work explicitly: once real
   interaction data exists, the selected values could be re-derived. That would be a genuine research
   contribution and is out of scope for the capstone.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **P(L₀)** | Prior probability a student already knows a concept before any evidence. 0.10. |
| **P(T)** | Learning rate — chance of moving from not-knowing to knowing at each opportunity. 0.20. |
| **P(S)** | Slip — chance of answering wrong despite knowing. 0.15. |
| **P(G)** | Guess — chance of answering right without knowing. Context-sensitive, eight values. |
| **Observation** | One binary piece of evidence: `obs = 1` correct, `obs = 0` incorrect. |
| **Learning opportunity** | One flashcard review or one test item (paper p. 71). The time index `t`. |
| **Evidence phase** | EQ(1)/(2) — revising the estimate given the observation. |
| **Transition phase** | EQ(3) — adding the chance the attempt itself taught them something. |
| **Posterior** | The post-transition value. What is persisted as `latent_mastery`. |
| **M_doc** | EQ(4) — mean mastery over every concept in one material. Drives the tier. |
| **Tier** | `foundational` < 0.50, `intermediate` 0.50–0.85, `advanced` ≥ 0.85. Chosen once, at generation. |
| **ICR** | Implementation Correctness Rate, EQ(6). Passed cases ÷ total × 100, at ±0.01. |
| **Absorbing state** | A value no evidence can move away from. Why mastery is clamped below 1. |
| **Degenerate parameters** | A set that behaves illogically, e.g. lowering mastery after a correct answer. Beck & Chang's `P(G) + P(S) < 1` prevents it. |
| **CAS** | Compare-and-swap — an UPDATE that re-asserts the precondition, so concurrent requests serialise. |

---

## Related documents

| Document | What it covers |
|---|---|
| **`LearnSyncAI artifacts/ANALYTICS_IMPLEMENTATION.md`** | **The student-facing view of these numbers. Read it before changing anything about how mastery is displayed — its §4 depends on the 0.20 floor described in §4.1 here.** |
| `CLAUDE.md` § "BKT Engine" | The condensed rules, always in an agent's context |
| `ARCHITECTURE.md` §8 | The equations of record and the parameter provenance |
| `LearnSyncAI artifacts/TEST_MODE_IMPLEMENTATION.md` | Where test observations come from; §15 records this work from the test side |
| `LearnSyncAI artifacts/FLASHCARDS_IMPLEMENTATION.md` | Where flashcard observations come from; §15 records this work from the card side |
| `LearnSyncAI artifacts/databaseSchemaExplained.md` Parts 11–12 | The BKT tables in plain language |
| `schema.sql` | The source of truth for every table, view and function named here |
| `LearnSync AI version 4.docx.pdf` | The paper. pp. 68–82 algorithm, pp. 94–96 evaluation |
