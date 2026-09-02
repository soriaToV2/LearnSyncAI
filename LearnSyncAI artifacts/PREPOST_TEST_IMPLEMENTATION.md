# Pre-Test / Post-Test (As Built) — ⚠️ REMOVED

> # ⚠️ REMOVED 2026-09-02. HISTORICAL RECORD ONLY — DO NOT RE-IMPLEMENT FROM THIS DOCUMENT.
>
> Built 2026-08-21 (migration `20260821090024`), removed 2026-09-02 (migration
> `20260902090025_drop_material_assessments`). None of the code, tables or routes described
> below still exist: the seven feature files are deleted, the nine `PRE/POST GATE` call sites
> are reverted, the material lock is gone, and `material_assessments`, `assessment_attempts`
> and the `assessment_phase` enum are dropped.
>
> **Why.** This instrument served the paper's **RQ4 (p. 55)** — the pre-test/post-test score
> difference, which p. 103 named the *primary* evaluation instrument. It was withdrawn on
> advice: the actual student-usage window is **one week** (implementation runs 1–3 weeks — week
> 1 gathers materials and distributes accounts, week 2 is the usage, week 3 wraps up), and a
> pre/post delta over one week is not attributable to the platform.
>
> **What replaced it.** The BKT mastery the platform already tracks, exported per student from
> `GET /api/educator/materials/:materialId/mastery-evidence`. See
> [`MASTERY_EVIDENCE_EXPORT.md`](MASTERY_EVIDENCE_EXPORT.md) and the "Mastery-evidence export"
> section of `CLAUDE.md`.
>
> **The data.** Five attempt rows existed at removal, all on developer test accounts, archived
> to `prepost-attempts-archive-2026-09-02.csv` in this folder. No school-study data was ever
> collected through this feature.
>
> Everything below is preserved unchanged, as the record of what was built and why.

---

**Scope.** This document covers the pre-test / post-test feature *only* — the educator-generated,
per-material parallel test pair that serves the paper's RQ4, and the lock that makes a pre-test a
genuine baseline. It is **not** Adaptive Test Mode, which is a permanent study feature with its own
artifact:

| Feature | Artifact |
|---|---|
| Adaptive Test Mode — five formats, BKT-driven difficulty, writes mastery | `TEST_MODE_IMPLEMENTATION.md` |
| **Pre/post parallel tests, the study lock, the educator generate & release flow** | **this file** |

They share exactly one thing: `mentionsTerm()`, exported from `server/lib/testGeneration.ts` for
this feature's use. Nothing else is shared, and no adaptive-test code path was modified.

---

## 0 · TL;DR

An educator opens a material → **Pre / Post Test** tab → clicks **Generate**. One Gemini call (~36s)
writes up to 20 multiple-choice items, each with *two* wordings of the same question. The educator releases
the pre-test; every student in that grade must sit it before they can open the lesson at all. Weeks
later the educator releases the post-test — the same items, reworded, options reshuffled. The educator
downloads a CSV of pre score / post score / gain.

**Nothing here touches BKT, telemetry, streaks or badges.**

---

## 1 · Why it exists, and the one place it diverges from the paper

**RQ4, paper p. 55:** *"How significant is the difference between the students' standard pre-test
scores and their personalized post-test scores after using LearnSync AI?"*

**p. 103** names system-generated pre/post tests the **primary** evaluation instrument.
**p. 106** fixes the sequence: access the material → sit a pre-test → use the platform for 2–4 weeks →
sit a post-test. **p. 107** requires the system to record both scores.

Before this, a search for `pre.test|pretest|post.test|posttest` across `.ts`/`.tsx`/`.sql` returned
**zero hits**. Without it there is no RQ4.

### The divergence

The paper calls the post-test **"personalized"** / *"tailored to address their specific knowledge
gaps"* (pp. 103, 106). Built literally that means every student sits a different paper, drawn from
their own weak concepts.

**That destroys the measurement.** A student asked only about concepts they are weak on sits a
**harder** paper than their own pre-test was. A lower post-test score could then mean either that they
learned less or that the test got harder, and nothing in the data distinguishes the two. RQ4 asks for
the *difference* between two scores; the difference is only interpretable if the two instruments are
equivalent.

**Decided with the user: everyone sits the same post-test**, reworded from the pre-test. The paper
already uses the correct term for this on p. 103 — *"system-generated **parallel** pre-tests"* — and
the post-test wording should be brought into line with it ("parallel post-test form"). Nothing else
in the paper changes.

---

## 2 · Invariants — what must not break

1. **Pre and post ask about the same concepts, with the same answers and the same four options.**
   Only the sentence and the option ORDER differ. This is structural (one row, two stems), not a
   process that has to be maintained.
2. **The model never writes an option and never writes an answer.** Options are `concepts.term`
   values the server chose.
3. **`norm(pre_stem) !== norm(post_stem)` on every shipped item.** A duplicated stem turns the
   post-test into a recognition exercise and is the likeliest generation failure.
4. **A completed PRE-test result carries no items.** Pre and post share every answer.
5. **No BKT write, no `practice_telemetry` row, no `activity_logs` row, ever.**
6. **The lock gates on the LATEST released phase**, never "any released phase".
7. **The lock fails OPEN.** A broken lookup must never lock a class out of the platform.
8. **One attempt per phase**, and starting an attempt is idempotent.

---

## 3 · The item shape — the decision everything follows from

An adaptive-test MCQ (`writeChoice()`, `testGeneration.ts:320`) **names the term** and offers four
**generated definitions**. This item is the inverse: it **describes the concept without naming it**
and offers four **term names**.

```
This phase of incident response removes the threat from the system
after it has been contained.

  A  Containment      B  Eradication      C  Preparation      D  Recovery
```

Three consequences, all of which the study depends on:

| | Why it matters |
|---|---|
| **The model writes only sentences** | Every option is an educator-vetted `concepts.term`. There is no hallucination surface on the answer key at all — unlike `writeChoice`, where three options in four are model prose. |
| **Parallel-form is structural** | Pre and post are the *same row*. Same concept, same `answer`, same four options. Two separate generations could drift apart on the answer; this cannot. |
| **Grading is a string compare** | Safe *only* because a term appears at most once per material (`conceptExtraction.ts` folds before it embeds). **Do not import `testGrading.ts`'s alias ladder** — that exists for text a student typed; here they pick from four literal strings the server wrote. |

### Generation

**One Gemini call per material.** Per concept the model returns `{ n, pre_stem, post_stem }` — two
descriptions of the same concept, written together so they are provably about the same thing.

- `GEMINI_CONTENT_MODEL` (`gemini-3.6-flash`) at `ThinkingLevel.MINIMAL`.
- `maxOutputTokens: 8192`. 20 items × 2 stems exceeds any single-format ceiling in
  `testGeneration.ts` (identification is 6144), and a truncation throws away the whole generation
  rather than one item.
- `responseSchema` in the `itemsSchema()` shape; the `n` echo is **range-checked** exactly as
  `askBatch()` does. The model never sees a concept UUID.
- Chosen by `CLAUDE.md`'s two questions: the model's judgement never becomes a score (the server owns
  the key), but the stems are content a student reads as fact → `GEMINI_CONTENT_MODEL`.

**Cost: one request per material**, against the adaptive test's five, on a 20/day free-tier bucket.

### No difficulty tier, deliberately

A *standard* pre-test must not adapt. Nothing here reads `bkt_mastery`, there is no `difficulty_tier`
column, and no tier machinery is imported. The guidance is a fixed constant in
`assessmentGeneration.ts`, written in the register of
`FORMAT_TIER_GUIDANCE.matching_type.foundational`.

### Validation replaces fallback

`generateTestQuestions()` handles a skipped item with a deterministic template built from the
definition. **There is no template that can invent a second, differently-worded stem** — a fallback
here would either repeat the pre wording (destroying the instrument) or paste the definition (naming
the term it is asking for).

So an item is kept only if:

- both stems are non-empty and pass `looksClean()` (no leaked item number),
- neither stem names its own term (`mentionsTerm`, both stems),
- **`norm(pre) !== norm(post)`**.

The third test is the one that earns its place. At MINIMAL thinking on a one-line definition the
likeliest failure is not a malformed response — it is the **same sentence twice**, or a near-copy with
one synonym swapped. That ships silently and reads fine in the preview at a glance.

A rejected concept is **dropped and refilled** from a spare pool (`SPARE = 6`) requested in the same
call, then the survivors are **re-spread** by stride so a fussy back half of the lesson does not bias
the test toward the front. Under `ASSESSMENT_MIN_ITEMS` (5) the whole generation fails and writes
nothing.

### Concept selection

`min(20, conceptCount)` concepts at an **even stride over document order**. A test built from the
first 20 rows of a 57-concept lesson measures the first few pages.

### ⚠️ Distractors come from the answer's document neighbourhood

`NEIGHBOUR_WINDOW = 6`, widening to the whole material only if the window starves.

**Measured.** Drawing from the whole material produced:

```
"This web application of a larger markup standard uses a predefined set of
 tags focused entirely on displaying data."
    HTML  ·  wind_gust_mph  ·  XSL  ·  dewpoint_c
```

`wind_gust_mph` and `dewpoint_c` are field names lifted from the lesson's own worked XML example. They
are real `concepts` rows, so nothing was *wrong* — but a student eliminates both without knowing
anything, turning a 4-option item into a 2-option one. On a **pre**-test that inflates the baseline
toward 50% and shrinks the gain RQ4 measures, so it is a measurement defect, not a cosmetic one.

After the change, the same item reads:

```
    HTML  ·  SGML  ·  XSL --- Extensible Stylesheet Language  ·  Linkability -- XLink and XPointer
```

This is the same finding `CLAUDE.md` already records for the games: what works is *"options drawn from
the lesson's own neighbouring concepts"*. Concepts are stored in extraction (document) order, so a
window around the answer is the same lesson section.

**Two further rejections, both correctness:**

- A candidate whose `foldKey` is a **substring or superstring** of the answer or another option.
  `Injection` inside `SQL Injection` would give the item two defensible answers — the ambiguity
  `distinctPool()` exists to prevent on the adaptive-test option side, and the reason `CLAUDE.md`
  forbids substring matching in the grader.
- A candidate the **stem names**. That is a giveaway in reverse: the student picks the word they can
  see in the sentence, and it is the wrong answer.

---

## 4 · The lock

**The rule, in one line:** a material is locked for a student when its assessment's **latest released
phase** has no completed attempt by that student.

```
gatePhase = post_released_at ? 'post' : pre_released_at ? 'pre' : null
locked    = gatePhase !== null && no completed attempt for (student, gatePhase)
```

### ⚠️ Latest, not "any released phase"

The obvious reading — *any released phase with no attempt* — locks a student out **permanently**. An
educator who releases the post-test while some students still owe the pre-test would leave those
students gated on `pre`, a phase the Post-Test tab no longer offers, with no route to either test.

Three things enforce the ordering:

1. `material_assessments_release_order` CHECK — `post_released_at IS NULL OR pre_released_at IS NOT NULL`.
2. `PATCH /release` refuses post-first with a sentence rather than a constraint violation.
3. **Un-releasing** (`pre_released: false`) is the escape hatch for a student who will not sit the
   test. It destroys no attempts — the same property archiving and re-grading rely on.

### Why it covers the PDF and the chatbot

A pre-test is a **baseline**. A student who reads the lesson and then sits the "pre"-test has an
inflated baseline and a shrunken measured gain, which is exactly what RQ4 measures. Leaving reading
open would make the instrument measure reading speed.

### The nine server call sites

Each is one line **immediately below** the existing access check, never above.

| File:line (at build time) | Site |
|---|---|
| `games.routes.ts` | game generation |
| `studyspaces.routes.ts` | flashcard deck generation |
| `chat.routes.ts` | RAG chatbot |
| `cognitive.routes.ts` ×2 | Free Recall, Feynman |
| `practice.routes.ts` | adaptive test creation |
| `materials.routes.ts` | `POST /concepts/batch` |
| `materials.routes.ts` | `GET /:id/view` — `requireUnlockedMaterial()` as a second middleware |
| `materials.routes.ts` | `GET /:id/concepts` — same |

`GET /:id/status` stays open: it returns a parse status and no content.

**⚠️ ORDER IS LOAD-BEARING.** Running after `rejectInaccessibleMaterials()` /
`requireMaterialAccess()` is what makes archiving and re-grading self-healing —
`accessibleMaterialIds()` has already dropped the material and answered, so the gate never has to know
about `is_archived` or `grade_level`. It also means a material the caller may not read at all still
answers **404** rather than revealing that a test exists for it.

### ⚠️ The gate is student-only

Checked inside `lockedMaterials()` — after the assessment lookup, before the attempt lookup — rather
than at each guard. Two of the nine sites (`/:id/view`, `/:id/concepts`) are reachable by the
uploading **educator** and by an **admin**, neither of whom can ever hold an attempt row. A role-blind
rule would lock an educator out of their own PDF the moment they released its pre-test.

Placing the role read *after* the assessment lookup means the overwhelmingly common case — nothing
released for these materials — still costs exactly one query.

### It fails OPEN

`accessibleMaterialIds()` returns an empty set on error and denies everything. This does the opposite,
deliberately: that function guards **data isolation between students**, where the safe failure is
refusal. This guards a **research measurement**, where a broken lookup silently locking fifty students
out of the entire platform is far worse than a handful of contaminated baselines. Every failure is
`console.error`'d.

**Verified:** with migration 0024 unapplied, `lockedMaterials()` logs the missing table and returns
zero locks, and `GET /assessments/space/:id` returns `{ materials: [] }`. The app runs exactly as it
did before.

### ⚠️ The post-test requires a completed pre-test — and the lock does NOT enforce that

Found on a real account during acceptance: a student with **no pre-test row at all** was able to open
the post-test.

The cause is that **ordering the instruments and gating the material are two different jobs**, and the
lock only does the second. The gate points at the LATEST released phase, so the moment the post-test
is released a student who never sat the pre-test is gated on `post` — which they can satisfy by taking
the post-test. Nothing stopped them.

Why that is unacceptable rather than untidy:

- **A post score with no baseline is unusable, not merely weaker.** RQ4 measures a *difference*, and
  there is nothing to subtract from. `gain` is correctly null, so the student contributes nothing.
- **It is not repairable by re-testing.** They have now seen the item set, so a "pre"-test taken
  afterwards measures recall of the post-test rather than prior knowledge.

`POST /:assessmentId/attempts` now refuses `phase = 'post'` with **409** unless a completed `pre`
attempt exists, and the Post-Test tab renders the row greyed with *"Take the pre-test for this lesson
first"* so a student reads an instruction rather than an error.

**⚠️ THIS CANNOT STRAND ANYONE, AND THE REASON IS THE CHECK CONSTRAINT, NOT THE GUARD.**
`material_assessments_release_order` forbids the post-test being released while the pre-test is not,
so whenever the post-test is offered the pre-test is offered too and the requirement is always
satisfiable. **Do not relax that constraint without revisiting this guard.**

It runs **before** the existing-attempt lookup, so an orphaned `in_progress` post row created before
this guard existed cannot be resumed either. Such a row needs no cleanup: once the student completes
the pre-test, the idempotent resume hands them back that same empty row.

### The lock is forward-looking

It does **not** revoke past work. An adaptive test already in progress can be finished; an
already-generated game replays; Free Recall and chat history still quote the material.

That is a decision, not a gap. Before the **pre**-test the student has never been able to open the
material, so no such work can exist. By the **post**-test they have studied it for weeks, so there is
nothing left to protect. Hardening those paths would buy nothing and would mean touching four verified
read routes.

### Client behaviour

**`availableResources` is passed UNFILTERED, plus a `lockedIds: Set<string>`.** Each tab filters only
its **picker** — four one-line edits (`FlashcardsTab`, `FreeRecallTab`, `FeynmanTab`,
`AdaptiveTestTab`).

Filtering the list itself was rejected on two concrete grounds:

- `AnalyticsTab` treats an empty list as *"No lessons in this study space yet"*. A student with real
  mastery whose only lesson is briefly locked would be shown an empty-state lie. It receives no
  `lockedIds` at all.
- `materialLabel()` in the two cognitive tabs and `deckSummary()` in `FlashcardsTab` use the same list
  to **title historical attempts**. A locked material's past attempts would lose their labels.

**⚠️ The lock map is the one piece of `StudySpace` state `<main key={activeTab}>` does not refresh.**
Every path that can change a lock therefore calls `refreshLocks` explicitly:

- finishing a test (`AssessmentTab` → `onLocksChanged`), and
- `ResourcesTab`'s materials sync, which can pull in an **already-locked** material the parent's map
  was fetched before.

Same idiom as `onRefresh` on `FlashcardsTab`.

**`GamesLanding` builds its own material list** (it is outside the study-space tabs) and so does its
own lock lookup. Without it a locked lesson is offered, ticked, and answered with a 403 the student
cannot act on.

**`ResourcesTab` is the one place a locked material stays visible** — lock badge, "Take the test
first" status, PDF and chatbot disabled, and a sentence telling them where to go. A lesson that simply
vanished from the library reads as the app losing the teacher's work.

---

## 5 · Answer-key handling — the part most worth reading twice

### `stripAssessmentKey(item, phase)`

The only function that serialises an item to a browser. It **allow-lists** three fields
(`index`, `prompt`, `options`) rather than deleting `answer`, so a field added to
`StoredAssessmentItem` later cannot leak by omission — the same doctrine as `stripKey()`.

It is a *second* serialiser in a codebase whose stated rule is *"`stripKey()` is the only one"*. The
rule is not broken: `stripKey()` remains the sole serialiser for `StoredTestQuestion`, and this one
never touches that type. **Both carry a cross-reference. Do not merge them, and do not add a third.**

**⚠️ The `phase` parameter is load-bearing twice:**

1. **Both wordings sit on one row.** A phase-blind serialiser shows a student *every post-test
   question while they sit the pre-test* — the entire test they have not taken.
2. **The option order differs per phase by design** (different shuffle seeds). Emitting the wrong
   array grades correctly but lets a student who noted "the answer was C" carry it across.

### ⚠️ A completed pre-test returns a score and NO items

`studentResult()` returns `{ score, correct_count, total }` for `pre`, and adds `review` only for
`post`.

The obvious mirror of `GET /api/practice/:id/result` returns the full review on completion. Here that
is the worst leak available: pre and post share every answer, so a student who opens DevTools on their
pre-test result holds the post-test key three weeks early, and their measured "learning gain" becomes
a measure of how carefully they read a JSON response.

The post-test has nothing left to protect and returns the full review, which is also where it does the
most good.

### RLS — deliberately unlike `practice_tests`

`practice_tests` is `FOR ALL USING (student_id = auth.uid())`, which **already** lets a student read
their own `questions_payload` — answer key included — with the anon key. Copying that shape here would
be far worse, because one row serves a whole grade.

| Table | Student policy | Educator policy |
|---|---|---|
| `material_assessments` | **NONE** | `FOR ALL` where they own the material |
| `assessment_attempts` | `FOR SELECT` on own rows only | `FOR SELECT` for their assigned grades |

`material_assessments` carries no `student_id`, so any *"students read assessments for their grade"*
policy would hand the whole key to every student in the grade, permanently, **before either test**.
Express reads it with the service role, so students lose nothing.

`assessment_attempts` has **no INSERT and no UPDATE policy**, following the `activity_logs` /
`gamification_profiles` precedent: `answers` and `score` *are* the study's measurement and must not be
student-writable.

---

## 6 · Data model

```
material_assessments                      assessment_attempts
├─ material_id  UNIQUE → materials        ├─ assessment_id → material_assessments
├─ created_by         → profiles          ├─ student_id    → profiles
├─ items      JSONB  ⚠ ANSWER KEY         ├─ phase         assessment_phase
├─ item_count SMALLINT  CHECK 5..20       ├─ answers       JSONB
├─ pre_released_at                        ├─ score / correct_count
└─ post_released_at                       ├─ status        practice_status (reused)
   CHECK post ⇒ pre                       └─ UNIQUE (assessment_id, student_id, phase)
```

**One new enum only** — `assessment_phase`. `practice_status` is reused.

**No `assessment_status`.** Generation is synchronous, so a row exists only on success. A status
column would record a state no reader can observe, and would strand rows on `processing` when the
server restarts mid-job — the known defect in `materials.parsed_status`, which nothing reaps.

**No `space_id` on an attempt.** The assessment measures the *material*, and a student may hold two
study spaces of the same subject; keying the attempt on a space would make "have they sat the
pre-test?" depend on where they happened to sit it.

**`UNIQUE (assessment_id, student_id, phase)` — one attempt per phase, no retakes.** Which is exactly
why `POST /:assessmentId/attempts` **must be idempotent**: on a 409 a student who closed the tab
mid-test would hold an `in_progress` row they can never complete and a lesson locked forever.

**`assessment_attempts` is the fourteenth table cascading from `profiles`.** Deleting a student
destroys their pre/post scores along with everything else — which is the research data.

---

## 7 · Routes

`server/routes/assessments.routes.ts`, mounted at `/api/assessments`. `router.use(authenticate)` with
a **per-route `requireRole`**, following `materials.routes.ts`'s mixed-role precedent.

**⚠️ EVERY ROUTE CARRIES ITS OWN `requireRole`, and that is a security requirement.** `requireRole` is
the only middleware that reads `profiles`, so it is also the only thing enforcing the disabled-account
check and the first-login activation gate. Four routes elsewhere in this codebase were holes for
exactly this reason. A route added here without one is a fifth.

| Role | Route |
|---|---|
| educator | `GET /overview` — library-wide coverage; accepts nothing, no answer key |
| educator | `GET /materials/:materialId` — full view, items included |
| educator | `POST /materials/:materialId/generate` |
| educator | `PATCH /materials/:materialId/release` |
| educator | `GET /materials/:materialId/results` |
| student | `GET /space/:spaceId` |
| student | `POST /:assessmentId/attempts` |
| student | `PUT /attempts/:attemptId/answer` |
| student | `PUT /attempts/:attemptId/complete` |

**`POST /generate` is synchronous.** One Gemini call — **measured 36.1s** for 20 items on a
30-concept material, not the ~2–3s a single MINIMAL call suggests. Forty sentences is a lot of output
and output is the bottleneck.

It stays synchronous for two reasons. The cost is **bounded**: the request writes at most
`ASSESSMENT_MAX_ITEMS + SPARE` = 26 items however large the material, so ~36s is near the ceiling
rather than the start of a curve. And it is a **once-per-material educator action performed before the
study**, never on a student's path. `processMaterialAsync` is fire-and-forget because concept
extraction is many calls over many windows; this is one, and going async would buy a status column, a
client poll, and the stranded-`processing` defect.

**The UI copy must stay honest about it.** "Takes a few seconds" was the estimate and was wrong by an
order of magnitude — an educator who thinks it has hung reloads the page and pays for a second
generation on a 20/day quota. It now says "about half a minute" and, while running, "do not close this
page".

**Regeneration is refused once any attempt exists** — a server-side count returning 409, not a
disabled button. Rewriting a question after a student has answered it destroys the comparison the
study rests on; verify by reading the stored row, never by the response code.

**Release timestamps survive a regenerate.** An educator regenerating a released-but-unattempted test
keeps it released, which is what "regenerate" means to them.

**`PUT /complete` is a compare-and-swap** (`.eq('status','in_progress').select('id')`), not the status
check above it. That check reads a row fetched a moment earlier, so two racing submits both fall
through — and this row *is* the measurement. Losing the race is logged as a warning and answered
successfully, because the other request recorded the identical score from the identical answers.

**`PUT /answer` never returns correctness.** Telling a student whether each answer was right as they
go would turn the pre-test into a study session on the exact 20 concepts the post-test asks about.

**`GET /space/:spaceId` goes through `requireOwnedSpace()` → `spaceMaterialIds()`**, which is what
gives it the live archive / grade / subject filter for free.

**`loadSittableAssessment()` answers 404 for everything** — a wrong id, an unreleased phase, someone
else's material, a material outside the caller's grade. A 403 would confirm that a test exists for a
material the student cannot reach.

---

## 8 · What the educator does, in order

1. Upload the material and wait for **Completed**. *(If the lesson is already visible to students,
   **Archive** it while you set this up — see the warning below.)*
2. Material → **Pre / Post Test** → **Generate pre-test & post-test**. About half a minute — one
   model call, and it is the slowest thing in the feature.
3. Read the preview. Each item shows the answer, the other three options, and both wordings. Check
   that the two wordings are genuinely different sentences.
4. **Open the pre-test.** From this moment students in that grade cannot open the lesson — no PDF, no
   chatbot, no flashcards, no games — until they sit it.
5. Un-archive if you archived in step 1. Tell the class the lesson is available.
6. Two to four weeks later, **open the post-test**.
7. **Download CSV** → `last_name, first_name, grade_level, pre_score, post_score, gain, total_items`.

**⚠️ The one real hole in the lock, and the copy that closes it.** A material is visible to students
the moment it is uploaded. An educator who uploads at 9:00 and releases the pre-test at 9:10 has ten
minutes in which a student could read the lesson, which contaminates their baseline. The tab says so
and offers Archive as the way to stage it. This is operational, not enforceable in code — the
alternative would be an upload flow that publishes nothing until a test exists, which is a much larger
change to a permanent feature for a temporary one.

### The results table

Every **active** student in the material's grade via `rosterFor()`, **including those who have taken
neither test** — "nineteen of twenty have not sat the pre-test" is the finding an educator needs
before releasing the post-test, and filtering them out would hide it. Same reasoning as the Class
Performance roster.

`gain` is `post − pre`, and is **null unless both exist**. A gain computed against a missing pre-test
is not a gain.

The CSV goes through `csvCell()`/`toCsv()` from `src/lib/csvAccounts.ts` rather than a `join(',')`: a
surname like `Dela Cruz, Jr.` would otherwise split into two columns and shift every score one cell
across — the same defect that once parsed a username as `tan lj` in the account importer.

---

## 9 · Student experience

Two tabs, **Pre-Test** and **Post-Test**, which **appear only once their phase is released** — so the
tab bar is six tabs before the study starts and six again after it ends. One component,
`phase`-flipped: the only real difference is what the *server* returns afterwards.

The lock banner sits **outside `<main>`**, so it stays on screen as the student moves between tabs
looking for the lesson that vanished from their pickers.

**The results screen mirrors `TestResultsView`** — exit link, score ring, stat row, then the review.
It is a takeover, replacing the list rather than sitting above it, so a student is never reading their
score with a *Start* button for the same test still on screen.

**The pre-test shows a score and no per-question review** — enforced by the server, which simply does
not send `review` for that phase. The copy is deliberately unalarming: *"This is your starting point,
not a grade — you had not studied the lesson yet."* A pre-test score of 4/20 is the expected result of
a baseline, and a student who reads it as a failure is being told something untrue about themselves.

**⚠️ THE PRE-TEST RING IS A FIXED NEUTRAL TONE, never `scoreTone()`.** Test Mode colours by score
because there a score is an achievement. A baseline taken before studying is not, and a red ring on it
is a judgement the number cannot support. The ring reads **Starting Point** rather than a score label
for the same reason. The post-test is a genuine attainment measure and colours normally. Same
reasoning that keeps Free Recall's ring on one fixed tone.

### The runner

`src/pages/student/components/AssessmentRunner.tsx` — a **new, self-contained component**, not
`TestSessionView`.

`TestSessionView` is 879 lines covering five question formats, matching blocks and section navigation,
and it calls `testApi.saveAnswer`/`testApi.complete` **directly** rather than through props. Reusing
it would mean threading an api adapter through the verified adaptive-test path for a screen that
renders twenty multiple-choice questions. This feature is removed after the study; a self-contained
file deletes in one pass and cannot regress Test Mode on the way out.

It is nonetheless **shaped like** `TestSessionView` — same in-flow root, exit link, per-question
progress bar, question card, Previous / Next / Finish footer, `lg:` navigator rail with a `Modal`
fallback below it, and the same A–D / arrow-key shortcuts. Two screens that do the same job should not
teach different habits.

**⚠️ IT MUST NEVER BE `fixed inset-0`.** The first version was, and the study-space header won the
z-order fight: the runner's own header disappeared, the question was clipped at the top of the scroll
box with no way to reach it, and only the footer was visible. `TestSessionView` renders inside
`<main>` for exactly this reason — and keeping the tab bar visible is right anyway, since a student
sitting a pre-test should still see where they are.

What it shares beyond layout is the important part: answers are the option **text**, latency
accumulates per question, a save failure is a strip and never a block, and the server owns
correctness. It reuses only leaf utilities (`surfaces.ts`, `Modal`, `scorePercent`).

**One deliberate divergence: it confirms before submitting, and Test Mode does not.** The asymmetry is
real — an adaptive test can be regenerated whenever the student likes, whereas
`UNIQUE (assessment_id, student_id, phase)` means this is the only sitting they will ever get.

**Leaving mid-test is safe and the copy says so** — answers save as they are chosen and the attempt
resumes. Submitting is final and the confirmation says the unanswered count out loud, because there is
one attempt per phase.

---

## 10 · Acceptance evidence (2026-08-21)

**Regression — the feature must be invisible to the platform.**

| Check | Result |
|---|---|
| `npx tsx scripts/bkt-verify.ts` | **ICR 165 / 165 = 100.0%** |
| `npm run lint` (`tsc --noEmit`) | clean |
| `npx vite build` | clean |
| Server boots, `/api/health` | 200 |
| `GET /api/assessments/space/:id` unauthenticated | 401 |
| `lockedMaterials()` with migration 0024 **unapplied** | logs the missing table, returns **0 locks** — fails open |

**Generation, run against a real 30-concept material.** Every item asserted:

- 4 options, all distinct, all real `concepts.term` values
- `answer` present in **both** option arrays and equal to `concept_term`
- the two option **sets** identical between phases, and the **order** different on 20/20
- `norm(pre_stem) !== norm(post_stem)` on 20/20
- neither stem names its own answer, and no stem names one of its own distractors
- 20 distinct concepts

Result: **`items=20  rejected=1  reshuffled=20/20  distinctConcepts=20` — ALL ASSERTIONS PASS.**
`rejected=1` exercised the drop-and-refill path.

Sample pair:

```
[3] ANSWER: XHTML
  PRE : This concept represents a complete reformulation of the standard HTML 4
        format inside the XML 1.0 framework.
        XPointer, XLink | Linkability -- XLink and XPointer | Inline Reusabiliy | XHTML
  POST: This standard is created by taking HTML 4 and rewriting its specifications
        directly within XML 1.0.
        XPointer, XLink | Linkability -- XLink and XPointer | XHTML | Inline Reusabiliy
```

`gatePhaseOf()` verified across all three states: `(none) → null`, `(pre) → 'pre'`,
`(pre+post) → 'post'`.

### ⚠️ Still to verify once migration 0024 is applied

Everything above is generation- and gate-logic evidence. The end-to-end HTTP flow could not be
exercised because there is no DDL path from the repo (no `pg` driver, no `DATABASE_URL`, PostgREST
cannot run DDL). After applying the migration, run:

1. Generate for a material → row in `material_assessments`, `item_count` correct.
2. Release the pre-test → all nine gated routes answer 403/404 for a student; `GET /:id/status` still
   200; an **educator** can still open the same PDF.
3. Sit the pre-test → **read the raw network response**: `pre_stem` only, **no `answer`, no
   `post_stem`**. After submitting, the result carries `{ score, correct_count, total }` and **no
   items array**.
4. The pickers update **without a page reload** (the `onLocksChanged` path).
5. Release the post-test → locked again; its result **does** carry the full review.
6. Un-release both → unlocked, and the attempt rows survive.
7. Start a test, close the tab, reopen → the same attempt resumes, no duplicate row.
8. Double-submit `PUT /complete` → one `completed` row, one score.
9. `POST /generate` after an attempt exists → **409**, items unchanged.
10. With a student's **anon key**, `SELECT * FROM material_assessments` → **zero rows**.
11. `count(bkt_update_logs)`, `count(practice_telemetry)`, `count(activity_logs)` identical before and
    after a full pre-test.

---

## 11 · ⚠️ REMOVAL CHECKLIST

Run this after the study. Every edit outside the feature's own files carries a `PRE/POST GATE` marker
comment, so step 3 is a grep.

```bash
grep -rn "PRE/POST GATE" server/ src/ --include=*.ts --include=*.tsx
```

**1 · Migration `0025`** — drop in this order (the attempts table references the assessments table):

```sql
DROP TABLE IF EXISTS assessment_attempts;
DROP TABLE IF EXISTS material_assessments;
DROP TYPE  IF EXISTS assessment_phase;
```

Then delete **§17 of `schema.sql`** — one contiguous block at the end of the file, which is why it was
put there rather than filed into §§1/10/15. No section is renumbered.

**2 · Delete these files outright** (nothing else imports them once step 3 is done):

| |
|---|
| `server/lib/assessmentGeneration.ts` |
| `server/lib/assessmentGate.ts` |
| `server/routes/assessments.routes.ts` |
| `src/lib/assessments.ts` |
| `src/pages/student/components/AssessmentRunner.tsx` |
| `src/pages/student/studySpaceTabs/AssessmentTab.tsx` |
| `src/pages/educator/components/AssessmentTab.tsx` |
| `supabase/migrations/20260821090024_material_assessments.sql` *(keep for history; do not re-run)* |

**3 · Revert the marked edits:**

| File | What to remove |
|---|---|
| `server/lib/testGeneration.ts` | **one `export` keyword** on `mentionsTerm`, and its marker comment |
| `server/index.ts` | the import and the `app.use('/api/assessments', …)` block |
| `server/routes/{games,chat,practice,studyspaces}.routes.ts` | one import + one `rejectLockedMaterials` line each |
| `server/routes/cognitive.routes.ts` | one import + **two** `rejectLockedMaterials` lines |
| `server/routes/materials.routes.ts` | one import, one `rejectLockedMaterials` line, and **two** `requireUnlockedMaterial()` middlewares |
| `server/types/api.ts` | the `Pre-Test / Post-Test` block (constants, `StoredAssessment*`, three schemas) |
| `server/types/database.ts` | the `PRE-TEST / POST-TEST` block |
| `src/pages/student/StudySpace.tsx` | imports, `assessments` state + `refreshLocks` + `lockedIds` + `hasPre`/`hasPost` + `lockedNotice`, the tab union values, **three** tab-bar lists, the banner, the two render branches, and the `lockedIds`/`onLocksChanged` props |
| `src/pages/student/studySpaceTabs/{FlashcardsTab,FreeRecallTab,FeynmanTab,AdaptiveTestTab}.tsx` | the `lockedIds` prop and its one picker filter each |
| `src/pages/student/studySpaceTabs/ResourcesTab.tsx` | two props, the `locked` derivation, the lock icon/status/reason branches, and the `onLocksChanged?.()` call |
| `src/pages/student/games/GamesLanding.tsx` | the import, `lockedCount` state, the third `Promise.all` entry and its filter, the empty-state branch |
| `src/pages/educator/MaterialDetail.tsx` | the import, `'assessment'` in the `Tab` union, the `?tab=` branch, the tab-bar entry, the render branch |
| `src/pages/educator/MaterialsLibrary.tsx` | the import, `assessments` state, the `load()` fetch, the pill, and the `AssessmentPill` component |
| `CLAUDE.md` | the `Pre-Test / Post-Test` section; revert "Fourteen tables CASCADE" to "Thirteen" and drop `assessment_attempts` from the list |
| `ARCHITECTURE.md` | the pre/post note |

**4 · Confirm:**

```bash
grep -rn "PRE/POST GATE\|assessment" server/ src/ --include=*.ts --include=*.tsx
npm run lint && npx vite build && npx tsx scripts/bkt-verify.ts
```

**⚠️ Export the CSV for every material BEFORE dropping the tables.** `assessment_attempts` holds the
study's primary measurement and nothing else does — no BKT row, no telemetry row and no activity row
was ever written from this feature, by design.

---

## 12 · Deliberately not built

- **A per-student personalized post-test.** See §1 — it makes RQ4 uninterpretable.
- **Any BKT integration.** `bkt_source` stays a two-value enum; paper p. 58 permits exactly two
  mastery writers.
- **A streak/badge hook.** `activity_type` gains no value. A pre-test does not extend a streak, and
  that cost is stated rather than hidden.
- **Pre/post scores on the student dashboard or Analytics tab.** A pre-test percentage printed beside
  a mastery percentage invites the cross-metric comparison the Cognitive Tabs section forbids.
- **Editing an individual question.** Regenerate or leave it. A per-item editor on a temporary
  instrument is a permanent maintenance surface, and any edit after an attempt exists is refused
  anyway.
- **A timer.** Not in the spec, and a timed baseline measures something else.
- **Retakes.** `UNIQUE (assessment_id, student_id, phase)`. A second sitting of the same paper is not
  a second measurement.
- **Blocking an in-progress adaptive test from completing.** See §4 — the lock is forward-looking.
