# Study Recommendations — Implementation Reference

> Built **2026-09-07**. No migration, no new table, no new endpoint, no Gemini call.
> Two new client modules, one additive server field, five surfaces.
>
> §2 is the non-negotiable list. §7 is what was deliberately not built. §8 is the acceptance
> evidence.

---

## 1 · Why it exists

The capstone adviser asked the question the platform could not answer:

> *"What happens if the student gained, for example, 30% learning mastery in a certain topic — does
> the application recommend or intervene with something the student should do to improve?"*

It did not. BKT was measuring and nothing was acting on the measurement. `bkt_mastery` had exactly
three readers — adaptive test difficulty (`testGeneration.ts`), game calibration
(`gameDifficulty.ts`) and the Analytics tab — and none of them turned a number into an instruction a
student could follow.

The nearest things that existed were **inert**:

| Surface | What it showed | What it offered |
|---|---|---|
| Analytics "Focus next" | the 3 weakest assessed concepts | nothing — plain rows |
| Dashboard `FocusCard` | the weakest 5, cross-space | a link to the space's **default tab** |
| `TestResultsView` "Concepts to revisit" | chips carrying a real `concept_id` | nothing consumed the id |

It also closes a **paper-versus-build gap**. Paper p. 58 says the games, Free Recall and Feynman all
"utilize existing mastery estimates" for personalisation. Only the games did —
`cognitive.routes.ts` contains neither the word `mastery` nor `bkt`. Ordering the Feynman and Free
Recall pickers by mastery makes the claim true, and does it as a **read**: `bkt_mastery` still has
exactly two writers.

---

## 2 · Non-negotiable rules

1. **No Gemini call, ever, anywhere in this feature.** Module-header rule in `recommend.ts`.
2. **Below 0.50 the lead step is READ, not Feynman.** §3 has the reasoning.
3. **`Step.movesMastery` is a field, not a comment.** §4.
4. **`Recommendation.honesty` renders once per card, never per row.**
5. **No threshold is declared in `recommend.ts`** — it imports `masteryTier()`.
6. **`conceptBand()` rounds before banding.**
7. **`rankOf()` is known-weak > unknown > known-strong.** §5. The single easiest thing to invert.
8. **In-route navigation is a callback, never a `<Link>`.** §6. The defect most likely to ship
   unnoticed.
9. **A `StudyIntent` is consumed, not held** — and consumed whether or not its ids resolved.
10. **`assessedBefore` must gate every "before" percentage.** §9.
11. **Gate on `assessed`, never on `mastery === 0.1`.**

---

## 3 · The ladder, and why this order

| Band | Steps, in order | Lead sentence |
|---|---|---|
| `unassessed` | Flashcards | *Nobody has asked you about X yet, so there is no score to show. A deck is the quickest way to start.* |
| `foundational` < 0.50 | **Read** → Flashcards → Feynman | *You are at 25% on X. Read pages 24 and 25 again first.* |
| `intermediate` 0.50–0.85 | **Feynman** → Flashcards | *You are at 65% on X. You know part of it, so explaining it in your own words will show you the part you are missing.* |
| `advanced` ≥ 0.85 | Test | *You are at 92% on X. A test is the strongest check that it stuck.* |

**The user's original proposal was "Feynman whenever mastery is low", and it was refined rather than
adopted.** Feynman works by finding holes in what you already partly know. A student at 20% asked to
explain a concept to a ten-year-old writes two vague sentences, is graded near zero on something they
were never able to do yet, and learns nothing. It is still recommended at low mastery — third, once
there is something to explain.

The **material ladder** is the same four bands with the lesson as the subject, and is the only place
`free_recall` appears: `FreeRecallSchema` caps a submission at exactly one **material** and scores a
coverage ratio over every concept in it, so it cannot be aimed at a concept. Feynman is the
concept-addressable tool (`explanations[].concept_id`).

**Page anchoring.** `pageHint()` renders `page 24` / `pages 24 and 25` / `pages 24, 25 and 26` /
`pages 24, 25 and more`, and returns **null** rather than `''` when `source_pages` is null — so a
caller must branch and cannot emit a dangling *"Read  again"*. The copy degrades to *"Read that part
of the lesson again first"*.

It also replaced the inline `` ` · page ${source_pages.join(', ')}` `` in `AnalyticsTab.ConceptRow`,
which printed **"page 24, 25"**.

---

## 3b · ⚠️ Corrected 2026-09-07 — the results screen is LESSON-scoped

Reported on first real use: a 34-concept test, everything wrong, and "What to do next" naming one
concept — `ADVANCED SYSTEM INTEGRATION` — above a list of 33 others.

**The choice was close to arbitrary, and the cause is arithmetic.** BKT's all-incorrect posterior
depends only on the question's FORMAT (`GUESS_KEY_BY_FORMAT`, five P(G) values), so a test the student
got wrong throughout produces **at most five distinct mastery values across every concept in it**. The
comparator then fell through to `a.term.localeCompare(b.term)` and promoted whichever term sorted
first alphabetically. It was not the student's worst topic; it was first in the alphabet.

Three changes followed, plus one that had to come with them.

| # | Change |
|---|---|
| 1 | `nextUp` calls `recommendMaterial()` on `result.test.material_id`, not `recommendConcept()` on one concept |
| 2 | `recommendMaterial()`'s two middle bands grew to four/three steps, matching the user's own shape: read → flashcards → free recall → Feynman |
| 3 | `StudyIntent.conceptId` → `conceptIds: string[]`, so the Feynman step hands over **every** missed concept |
| 4 | `FeynmanTab` submits `readyConcepts` — required, or #3 is a dead end |

**Extending the ladders was safe because only this screen renders one in full.** `AnalyticsTab` (Focus
rows, lesson lines) and the dashboard's `FocusRow` all read `steps[0]` alone — verified before the
change. **Re-verify before adding a fifth step: a new `steps[0]` would change all three.**

**`Recommendation.honesty` is now derived from the steps (`honestyFor()`).** It was five hand-picked
constants and the very first ladder extension desynced them — material `foundational` gained a Free
Recall step while its sentence still named only reading and explaining. Since that line is the
feature's whole credibility (§4), it must provably match the buttons above it.

**Nothing renders while the material row is stale.** `refreshList()` is fired un-awaited on finishing,
so for a beat the row can still read `assessed_concept_count === 0` — which `materialBand()` correctly
calls `unassessed`, producing *"Nothing in X has been measured yet"* immediately after a test measured
it. The card therefore requires `assessed_concept_count > 0`. Arriving a moment late beats being
briefly wrong, and there is no `mastery_changes` override available here the way there is per concept:
this needs a document mean, and `documentMastery()` on the server is the only place that may compute
one.

**The Feynman step carries `result.missed_concepts.map(c => c.concept_id)`** — exactly the chips
rendered above it — and its button states the count, because ticking 34 concepts opens 34 text boxes.
On a test with nothing missed (reachable: a first all-correct test still leaves a lesson
`foundational`) the label falls back to neutral wording and carries nothing.

### ⚠️ `conceptIds` — two encoding traps

- **`[]` is truthy.** A truthiness check appends a bare `?concept=` to every link ever built. Test
  the length.
- **`append` out, `getAll` back.** `params.get()` returns only the first value, so a mismatched pair
  silently drops every concept but one.

Only the dashboard builds a URL (one id per row). The results screen navigates in-route via
`onNavigate`, so its list travels in memory and is unbounded there.

### ⚠️ Feynman partial submission — required, not a nicety

`canEvaluate` required `incompleteConcepts.length === 0` and `handleEvaluate` posted every selected
concept. Preselecting a whole lesson therefore left Evaluate **permanently disabled** unless the
student wrote 34 explanations or unticked 30 by hand — worse than not preselecting at all.

It now filters to `readyConcepts` (those meeting `MIN_EXPLANATION_LENGTH`) and needs one. The helper
line inverts from a blocker — *"17 concepts still need an explanation"* — to a statement of fact:
*"Explaining 3 of 34 — the rest are skipped"*, and the button reads *"Evaluate 3 explanations"*.

- **Server-legal unchanged.** `FeynmanEvaluationSchema.explanations` is `.min(1)` with no `.max()`,
  unlike `material_ids` beside it — so the omission is considered, not an oversight.
- **It bounds a real failure.** Grading is one Gemini call at `maxOutputTokens: 16384` with roughly
  one result object per concept, and `generateJson()` throws outright on `finishReason: MAX_TOKENS`.
- It fixes a pre-existing papercut: ticking 5 and writing 4 blocked you entirely.

**⚠️ NO STEP IS ACCENTED. The first one used to be, and that was a progress marker for progress
nothing tracks.** Nothing records whether a student actually read the lesson or wrote an explanation,
so on a revisit the accent would still sit on step one however much they had done — the same class of
mistake as showing "Mastery updated" on a past test. The ORDER is the recommendation, and the sentence
above the buttons already says which comes first. Do not reintroduce an active state without a writer
that observes it.

### "1 of 1 wrong"

Rendered now only when `asked > 1` — today, never. One question per concept is guaranteed four ways:
`orderedFormats()` de-duplicates formats, the per-format counts provably sum to ≤ `conceptCount`, and
the dealing cursor in `testGeneration.ts` **never rewinds**, so the five slices are disjoint
sub-ranges. A concept *is* reused across formats as a matching **decoy**, but a decoy emits no
question and no telemetry row. Kept conditional rather than deleted: one comparison, and correct if
the allocator ever changes.

**Deliberately still inert: the "Concepts to revisit" chips.** They are the obvious second home for a
multi-concept Feynman jump, but the step below already does exactly that, and 34 clickable chips
beside it would be a competing affordance for one action.

---

## 3c · "Review its deck" — finishing the one step that was a dead end

Reported on use: pressing **Review its deck** opened the Flashcards tab and did nothing else.

**Cause: `FlashcardsTab` was the only intent target never handed `preselect`.** `TestResultsView`
already fired `onNavigate({ tab: 'flashcards', materialId, conceptIds })` and `StudySpace` already set
`pending` and switched tabs — the tab simply never received it, so `materialId` was silently dropped
and `pending` was never consumed. The other four tabs all had the plumbing.

**What it does now:** lands on the deck holding that lesson, floats the cards for the missed concepts
to the top, marks them amber, and offers to drill just those. If no deck holds the lesson, it offers
to build one in a click.

**Almost all of it already existed.** `StudyIntent.conceptIds` carries the missed set (Feynman was its
first consumer); `setSelectedSetContent` is already a prop, so the parent can land the tab on a deck;
the material→deck lookup is a filter over cards already in memory. **No server change, no endpoint, no
migration.**

| Decision | Why |
|---|---|
| `concept_id` added to the client card mapping | The server always sent it (`select('*')`); the mapping dropped it, so nothing client-side could match a card to a concept. **Nullable** — `ON DELETE SET NULL` after a re-upload. |
| `deckHolding()` picks most-cards-then-earliest | **More than one deck can hold the same material.** No material column on `flashcard_decks`, and the 409 guard is scoped to one `deck_id`. "The deck" is not a thing; a deterministic tiebreak beats a modal. |
| Marked-first is a **partition**, not a fifth `OrderKey` | The file's rule is one piece of order state. A `'missed'` key would also hit the `Dropdown` hazard where an unrecognised value renders the first option. Partitioning composes with Hardest/Easiest via the stable sort. |
| The marking carries its own `deckId` | Landing on a deck fires the reset effect that clears `order`/flip. Rather than sequencing two effects, the value states which deck it belongs to and is ignored elsewhere — so the reset needs no knowledge of it. |
| `studyMode: 'marked'` | A card filter, not a new rule. Ratings are still posted; the server still decides `counted`. |
| `isPractice` moved to the session's own cards | It asked whether anything *anywhere in the deck* was due — wrong for a filtered session, and it would have suppressed the "ratings won't count" banner. |
| Auto-generate uses `format: 'term'` | No model in that path: instant and free. `'question'` is a Gemini call against a bucket one test already takes five of. |

### ⚠️ The due-check tension — named, not papered over

Flashcards move mastery **only for cards that are due**. `POST /flashcards/rate` returns early
otherwise and writes no schedule, no `spaced_repetition_logs` row and **no BKT update**; the route
header says *"Do not relax it."*

So a student who cleared this deck yesterday, then missed five concepts in a test, can arrive here via
a button carrying a **moves mastery** chip, drill all five, and change nothing.

**Resolved by disclosure, not by loosening the rule:**

- The banner states the split before they start — *"12 cards from your last test are marked below.
  **8 are due** — reviewing those updates your mastery."*
- The drill button reads **Review these N** when some are due, **Practice these N** when none are,
  matching the existing deck-tile vocabulary.
- Concepts the test flagged that this deck has no card for are counted in the same banner rather than
  quietly showing fewer cards.

### Verified offline — 13 assertions

`deckHolding` (more-cards wins; only-holder; none → null; no decks → null; tie → earliest) and
`markingFor` (exact matches; `missing` counts uncovered concepts; unmatched ids mark nothing; empty
input marks nothing; **null `conceptId` matches nothing and counts as missing**), plus the partition
preserving the chosen order inside each group.

**Deliberately still inert: the "Concepts to revisit" chips.** They are the obvious second home for a
multi-concept jump, but the step below already does it, and 34 clickable chips beside it would be a
competing affordance for one action.

---

## 4 · ⚠️ The credibility problem, and how it is solved structurally

`bkt_mastery` has exactly two writers — `flashcards.routes.ts` (the `counted: true` branch) and
`practice.routes.ts` (`PUT /:id/complete`) — and paper p. 58 fixes it at two. So **reading,
explaining and recalling change nothing measurable.**

That is a trap for a recommender. Say *"do Feynman to improve your 30%"*, the student does it, the
number does not move, and they stop trusting every number on the screen — including the ones that are
working.

Three options were considered:

| Option | Verdict |
|---|---|
| Only ever recommend flashcards and tests | Throws away Feynman and Free Recall — the opposite of the request |
| Make Feynman/Free Recall write mastery | **Forbidden.** Paper p. 58; `bkt_source` is a two-value enum |
| Say which activities move the number | **Chosen** |

The mechanism is a **field**, `Step.movesMastery`, true only for `flashcards` and `test`. Two rules
follow from it and are the actual copy policy:

- A `why` string on a `movesMastery: false` step describes what the activity **finds**, never what it
  **moves**.
- Every card renders `Recommendation.honesty` **once** — *"Only flashcards and tests change this
  number. Reading and explaining do not — they show you what to fix."*

The `advanced` band's honesty states it as a benefit rather than a caveat, and it is true: *"A test
moves this number in both directions, so it is a real check."*

---

## 5 · ⚠️ The ranking hazard

```ts
export const NEUTRAL_MASTERY = 0.5;              // client mirror of gameDifficulty.ts
export function rankOf(assessed, mastery) {
  return assessed ? clamp(mastery, 0, 1) : NEUTRAL_MASTERY;
}
```

BKT's transition step floors every **assessed** posterior at P(T) = 0.20, while a concept nobody has
ever asked about sits at P(L₀) = **0.10**. So a plain mastery-ascending sort puts **every untouched
concept above every concept the student is measurably failing**. On a 57-concept lesson with six
assessed — the measured shape from the analytics acceptance run — the Feynman picker would open
entirely on concepts the student has never seen.

Measured, from the acceptance harness:

```
correct  (rankOf):  Weak > Middling > AlsoNew > NeverSeen > Decent > Strong
inverted (naive) :  NeverSeen > AlsoNew > Weak > Middling > Decent > Strong
```

`Weak` 0.24 · `Middling` 0.45 · `Decent` 0.60 · `Strong` 0.92 · the two `New` unassessed.

**This 0.5 is not the `intermediate` tier threshold.** They coincide numerically and mean different
things — one is a paper threshold (p. 81 / p. 98), the other a selection-neutral point. Do not unify
them. `gameDifficulty.ts:42-59` documents the same hazard at length; this reproduces its conclusion
rather than re-deriving it.

**Deterministic, not `pickConceptsByMastery()`'s A-Res sampling.** That exists so "Play Again" cannot
rebuild a byte-identical game; a recommendation list that reshuffled on every render reads as broken.

**Used only by the two pickers where unassessed concepts are eligible** — the Feynman concept
dropdown and the Free Recall material dropdown. "Focus next" and the dashboard `focus` are
assessed-only by documented rule, where `rankOf` degenerates to plain ascending mastery.

**The picker and the recommender are allowed to disagree, and this is written down because a future
reader will try to "fix" it.** A foundational concept sorts to the top of the Feynman picker while the
ladder says Feynman should not *lead* at that band. The `hint` beside each option (`31%` / `new`) plus
the caption is what reconciles them for the student. Do not change the sort.

---

## 6 · ⚠️ The dead same-route link

`AnalyticsTab` and `TestResultsView` render **inside** `StudySpace`. A
`<Link to={`/student/space/${id}?tab=feynman`}>` from either is a **same-route** navigation:

1. React Router updates `location.search`.
2. `StudySpace` does **not** unmount.
3. `activeTab` was seeded from the URL **once**, at mount.
4. → the URL changes and **nothing else happens.**

It reviews as correct and is dead the moment a student presses it. So:

- **Cross-route** (dashboard → a space): a real `<Link to={studySpaceLink(...)}>`.
- **In-route**: `onNavigate(intent)`, implemented in `StudySpace` as
  `setPending(intent); setActiveTab(intent.tab);` — React 19 batches both, so the target tab mounts
  once with its preselection already in place.

### The intent is consumed, not held

`<main key={activeTab}>` remounts every tab on entry. A preselection kept as ordinary state would be
**re-applied every time the student came back to the tab**, silently replacing a lesson or concept
they had since picked by hand. `pending` is parent state; each tab calls `onPreselectConsumed()`
**whether or not the ids resolved** — an un-consumed intent is one `StudySpace` still holds.

Cleared in an **effect**, never during render: React 19 StrictMode double-invokes render, so a
`take()` called in render would return the intent on pass one and `null` on pass two.

### Validation is correctness, not politeness

`SingleSelectDropdown.tsx:48` resolves with `options.find(o => o.value === selectedValue) ?? null`.
An id the list does not carry therefore renders the **placeholder** while the state says something is
selected and Submit is live — the student would submit against a lesson the picker is not showing.
In Feynman, `selectedConcepts` resolves the same way, so an unknown concept renders **zero
textareas** under a button reading "1 concept selected".

| Param | Bad value | Behaviour |
|---|---|---|
| `tab` | unknown | default tab, silently — a stale bookmark |
| `material` | archived / not in space | dropped; the picker's own empty state explains itself |
| `concept` | deleted | dropped, **plus one muted note** — it is the specific thing the student pressed, and a re-upload cascade-deletes concepts |

### Feynman's timing

The concept is applied **inside the material effect's fetch** (`FeynmanTab.tsx`), after
`setAvailableConcepts(...)`. That effect clears `selectedConceptIds` on every material change, so a
separate effect would race it and lose.

`preselectRef` is held out of that effect's deps — reading the live prop there would refetch every
concept in the lesson the instant the intent is consumed — and **is cleared the moment it is acted
on**, or it becomes a stale second source that re-selects its concept the next time the student picks
that same lesson by hand.

---

## 7 · Deliberately not built

- **No Gemini.** Fixed sentences are instant, free, reproducible, and statable as one paragraph in
  the paper. A model call is none of those, on a bucket one adaptive test already takes five of.
- **No recommendation endpoint, table or snapshot job.** Every input already reaches the client.
- **No mastery write from Feynman or Free Recall.**
- **No dismiss / snooze / "done" state.** Needs a table, a writer and a staleness rule; a two-week
  study never accumulates enough for it to pay.
- **No change to "Focus next"'s population** — assessed-only, keeping its honesty sentence true.
- **No one-click generate from the `advanced` band.** The link lands on the Test tab. One test is
  five `gemini-3.6-flash` calls against a ~20/day free-tier bucket shared with extraction, Feynman
  grading, flashcard fronts and games. **A recommender is a quota amplifier by construction** — this
  is another concrete reason the 50-student study needs the paid key.
- **No `?page=` deep link into the PDF.** `PdfViewer` has no page API; the copy names the page.
- **No educator-side recommendation.** `attention` on `GET /api/educator/overview` owns that surface.
- **No fix for `dashboard.routes.ts`'s stray `MASTERED_AT = 0.85`.** It is a genuine fourth copy of
  the threshold and should become `masteryTier(m) === 'advanced'` — but it feeds `concepts_mastered`,
  which a dashboard tile and a badge rule both read, so it is its own change with its own
  verification.
- **No uptake logging.** Recording that a recommendation was shown or followed would let the paper
  report a conversion rate, but it needs an `activity_type` enum value (a migration) and a second
  writer. Out of scope; revisit only if the study lengthens.

---

## 8 · Acceptance evidence — 2026-09-07

**Static**

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | clean |
| `npx vite build` | clean (the >500 kB chunk warning is pre-existing) |
| `npm run bkt:verify` | **EQ(6) ICR = 165 / 165 = 100.0%** — the `assessedBefore` field is additive and touches no equation |
| `=== 0.1` in `recommend.ts` / student pages | 3 hits, **all comments forbidding it** |
| `0.85` in `recommend.ts` | 2 hits, **both comments** pointing at `masteryTier()` |
| `item.id as any` in `StudySpace.tsx` | 1 hit, **the comment recording its removal** |

**Rule harness** — 41 assertions, all passing, run against the real module (bundled with esbuild
because `recommend.ts` reaches `import.meta.env` through `mastery.ts`):

- bands, including `0.849 → advanced` (the round-before-band rule)
- lead action per band: `unassessed→flashcards`, `<50%→read`, `50-85%→feynman`, `≥85%→test`
- foundational ladder order is exactly `read,flashcards,feynman`
- page anchoring, and clean degradation on `sourcePages: null`
- `movesMastery` true for exactly `flashcards` and `test`, across all four bands
- `free_recall` in the material ladder only
- `pageHint` for 0/1/2/3/4+ pages, unsorted input, duplicates
- the ranking order above, plus *evidence at exactly 0.50 outranks a placeholder at the same key*

**Still to verify in the browser** (not performed here): the §6 in-route navigation actually changing
tabs; `Not measured before → N%` on a first test after `scripts/set-test-mastery.ts reset`; a replayed
`PUT /complete` carrying no `mastery_changes`; the Feynman picker's ordering on a real 57-concept
lesson; and — since the §9 correction — that reopening a past test shows **"What to do next" but not
"Mastery updated"**, with the advice reflecting mastery as it stands now rather than as that test left
it.

---

## 9 · `mastery_changes` — the before/after pair

```
start:  applyTestCompletion() → BktApplyResult.updated[]
        { conceptId, priorBefore, mastery, observations, opportunityCount, assessedBefore }
was:    console.error(bktProblems(bkt)) — everything else discarded
now:    mapped to MasteryChangeDto[] and spread onto the response
```

**No new query.** `assessedBefore` is `priors.has(conceptId)` — the same Map the prior itself came
from, built at `bkt.ts:474-482` from the query that reads it.

**⚠️ `assessedBefore` is what stops the screen printing P(L₀) as a score.** A concept whose first
evidence is this test has `priorBefore = 0.10`; rendering **"10% → 33%"** states the engine's
initialisation constant as a measurement, which is the one thing the whole analytics surface exists to
prevent. The row reads **"Not measured before"** instead — the common case on a first test.

Stated explicitly rather than derived from `opportunityCount - observations > 0`, which is exact only
because rows are never pre-seeded — a different invariant, held elsewhere, that the flag would
silently inherit. Same reasoning as writing `p_slip`/`p_transit` into the audit rows rather than
leaning on the column DEFAULTs.

**Optional, and its absence is meaningful.** Present only on the request that actually flipped the
status:

| Case | `mastery_changes` |
|---|---|
| the request that completed the test | the rows |
| BKT ran and moved nothing | `[]` |
| BKT threw, or `masteryWriteError` | **absent** |
| idempotent fast path (`:797-800`) | **absent** |
| compare-and-swap loser (`:834-839`) | **absent** |
| `GET /:id/result` (a past test) | **absent** |

Neither replay path may guess. Reconstructing the pair from `bkt_update_logs` would make this route
the audit trail's **second UI reader**, which is exactly what `logWriteError` staying non-fatal
depends on nobody doing — the same argument the dashboard curve settles by reconstructing backward.

**`buildResult()` is untouched** — pure, re-runnable, shared by four call sites including the one that
grades a past test. The field is spread on at the single call site that earned it.

The mastery BLOCK additionally gates on `justFinished`, because a double-submit also reaches
`complete()` and gets nothing back: the gate states the rule rather than relying on the field being
missing.

### ⚠️ The advice is NOT gated the same way — corrected 2026-09-07

Both blocks shipped gated on `justFinished`, so reopening a past test showed the score and nothing
else. Reported immediately, and the reporter was right: bundling them was a convenience, not a reason.

| Block | Gated on `justFinished`? | Why |
|---|---|---|
| **Mastery updated** | **yes** | A fact about ONE submission. The pair exists only on that response; the sole other copy is `bkt_update_logs`, and making the UI its second reader is exactly what `logWriteError` staying non-fatal depends on nobody doing. It genuinely cannot be rebuilt. |
| **What to do next** | **no** | Advice about a concept. Just as true a week later, and a student reopening a result is usually reviewing — the moment advice is most wanted. |

Ungating it required changing what the advice is keyed on. It was derived from `mastery_changes[0]`,
which does not exist on a revisit. It is now derived from **current** mastery of the concepts this
test asked about:

- `AdaptiveTestTab` calls `masteryApi.detail()` instead of `.space()` and passes a
  `Map<concept_id, ConceptMastery>` down. This does **not** violate "`/mastery` is Test Mode's hot
  path — do not widen it": that rule protects the *endpoint's* shape for its other callers, and
  switching which endpoint this caller uses leaves the lean one lean. `SpaceMasteryDetail` is a
  superset of `SpaceMastery`, so the setup screen's tier sentence is untouched.
- **`mastery_changes` overrides the live map where present.** `refreshList()` is fired
  **un-awaited** when a test finishes, so on the first render after submitting the live map can still
  hold **pre-test** values — the advice would be computed from a number the block directly above it
  has already superseded. They agree once the fetch lands.
- Candidates are **every concept the test asked about**, deduped from `result.results`, not just
  `missed_concepts` — a concept answered correctly by luck can still sit at 25%.
- **Assessed only**, so P(L₀) can never drive a recommendation. Plain ascending mastery is correct
  here for the same reason as on "Focus next": every candidate is a real measurement.
- A side benefit: only the live read carries `source_pages`, so the advice can now say
  *"Read pages 24 and 25 again first"* where the completion payload alone could only manage
  *"that part of the lesson"*.

**The results screen keeps "Test Score" and "Mastery updated" visually separate.** They are different
quantities and the old rule against conflating them still holds; what changed is that mastery appears
at all. A **drop** renders `mid`/amber, never `poor`/red — mastery falling after a wrong answer is the
model working, and red would read as a punishment for taking the test.

---

## 10 · Files

**New**

| File | Contents |
|---|---|
| `src/lib/recommend.ts` | bands, ladders, copy, `pageHint`, `NEUTRAL_MASTERY`, `rankOf`, both comparators |
| `src/lib/studySpace.ts` | `StudyTab`, `STUDY_TABS`, `StudyIntent`, `readStudyIntent`, `studySpaceLink` |

**Server**

| File | Change |
|---|---|
| `server/lib/bkt.ts` | `+ assessedBefore` on `BktUpdateOutcome` and its push. Nothing else. |
| `server/routes/practice.routes.ts` | `MasteryChangeDto`; `masteryChanges` built in the existing `try`; spread onto the response. Replay paths untouched. |

**Client**

| File | Change |
|---|---|
| `src/lib/testMode.ts` | `MasteryChange` + optional `mastery_changes` on `TestResult` |
| `StudySpace.tsx` | `useSearchParams` seeding, `pending`/`consume`/`navigateWithin`, typed `MOBILE_TABS`, the new props |
| `TestResultsView.tsx` | **Mastery updated** + **What to do next** blocks, `MasteryRow` |
| `AdaptiveTestTab.tsx` | forwards `onNavigate`; preselect calls the existing `openSetup(materialId)` |
| `AnalyticsTab.tsx` | actionable Focus rows, `honesty` once, a per-lesson line, `pageHint()` |
| `StudentDashboard.tsx` | `FocusRow` links via `studySpaceLink()` with tab + lesson + concept; `cta` line; `honesty` once |
| `FeynmanTab.tsx` | mastery-ordered concept + material pickers with hints, preselection, the missing-concept note |
| `FreeRecallTab.tsx` | mastery-ordered material picker, preselection, `conceptId` ignored by design |
| `ResourcesTab.tsx` | `setActiveTab` widened to `StudyTab`; opens on a preselected lesson |

---

## Related documents

- [`ANALYTICS_IMPLEMENTATION.md`](ANALYTICS_IMPLEMENTATION.md) — §4's never-print-P(L₀) rule, and
  §12.1, the deferred deep link this delivers
- [`BKT_IMPLEMENTATION.md`](BKT_IMPLEMENTATION.md) — the engine, and §4's three behaviours that look
  like bugs
- [`GAMES_CALIBRATION_IMPLEMENTATION.md`](GAMES_CALIBRATION_IMPLEMENTATION.md) — the selection-weight
  hazard `rankOf()` mirrors
- [`TEST_MODE_IMPLEMENTATION.md`](TEST_MODE_IMPLEMENTATION.md) — the completion path
  `mastery_changes` rides on
