# Analytics Tab — Implementation Reference

**Feature:** The student-facing view of BKT mastery — per-lesson progress bars (the paper's EQ(4)) and per-concept detail, inside the study space.
**Status:** ✅ **Implemented and verified.** 42 endpoint checks across two runs, all passing. Lint and build clean. BKT unaffected (ICR still 219/219).
**Date:** 8 August 2026
**Migrations applied:** **none.** It reads `bkt_mastery` and `concepts`; it writes nothing.
**Files:** `src/pages/student/studySpaceTabs/AnalyticsTab.tsx` (417 lines, new) · `src/lib/mastery.ts` (179, new) · `src/components/ui/MeterBar.tsx` (64, new) · one new route + one rewritten loop in `practice.routes.ts` · two new helpers in `testDifficulty.ts` · seven edits in `StudySpace.tsx`.

> **Read this first if you are an AI agent debugging or extending this tab.**
> **§4 is the rule the entire feature is built around — a percentage shown for a concept nobody has
> been asked about is a lie, and §4.2 explains why it is also actively harmful to the ordering.**
> §2 is the non-negotiable list. §11 is the debugging playbook. §12 is what was deliberately left
> open. §9 records the decisions that look arbitrary and are not.

---

## Table of contents

1. [What this feature is](#1-what-this-feature-is)
2. [Non-negotiable rules](#2-non-negotiable-rules)
3. [Why it exists — what the paper promises](#3-why-it-exists--what-the-paper-promises)
4. [The rule that governs everything](#4-the-rule-that-governs-everything)
5. [The data path](#5-the-data-path)
6. [The N+1 collapse](#6-the-n1-collapse)
7. [Frontend structure](#7-frontend-structure)
8. [Layout, section by section](#8-layout-section-by-section)
9. [Design decisions and why](#9-design-decisions-and-why)
10. [Security](#10-security)
11. [Debugging playbook](#11-debugging-playbook)
12. [Known issues deliberately NOT fixed](#12-known-issues-deliberately-not-fixed)
13. [Verification evidence](#13-verification-evidence)
14. [Future work](#14-future-work)
15. [Glossary](#15-glossary)

---

## 1. What this feature is

### In one paragraph

A sixth tab in the student study space, labelled **Analytics**. It shows how much of each lesson the
student has mastered — a progress bar per material, from EQ(4) — and lets them expand a lesson to see
every concept in it. Concepts the student has actually been assessed on get a bar and a percentage;
concepts that have never come up are listed by name only, because the number the system holds for
them is an assumption rather than a measurement. A "Focus next" card names the three weakest
*assessed* concepts across the whole space. It is entirely read-only.

### The division of ownership

| Concern | Owner | Why there |
|---|---|---|
| EQ(4) arithmetic | `documentMastery()` in `server/lib/testDifficulty.ts` | One implementation, shared by the tier picker and both read routes |
| Reading `bkt_mastery` | `masteryRows()`, same file | One place that chunks the `.in()` and coerces the NUMERIC strings |
| Which materials a space shows | `spaceMaterialIds()` in `practice.routes.ts` | The published ∩ linked filter, shared by both mastery routes |
| Types, tier colours, API calls | `src/lib/mastery.ts` | Mastery is fed by flashcards *and* tests, so it belongs to neither |
| The bar | `src/components/ui/MeterBar.tsx` | Five hand-rolled copies existed; this is the shared one |
| Layout and wording | `AnalyticsTab.tsx` | Presentation only — it computes no mastery |

### Status of each piece

| Piece | State |
|---|---|
| Per-material progress bars (EQ 4) | ✅ the paper's p. 81 deliverable |
| Per-concept detail, expandable | ✅ assessed rows + untested name chips |
| "Focus next" weakest three | ✅ assessed only, cross-material |
| Assessed vs untested separation | ✅ enforced server-side and client-side |
| Tab wired into desktop + mobile nav | ✅ seven edits in `StudySpace.tsx` |
| Mastery-over-time chart | ❌ deliberately not built — see §9 |
| `StudentDashboard.tsx` | ❌ still `MOCK_STUDENTS[0]`; deferred by the user |

---

## 2. Non-negotiable rules

1. **A concept with no `bkt_mastery` row must never be shown a percentage.** See §4. Gate on
   `assessed` (per concept) or `assessed_concept_count` (per material) — **never** on
   `mastery === 0.1`, which a genuinely-assessed concept could also equal.
2. **This tab is read-only, permanently.** Paper p. 58 and the `bkt_source` enum allow exactly two
   mastery writers: test completion and the flashcard rating route. Nothing served from
   `/mastery/concepts` may ever write `bkt_mastery` or `bkt_update_logs`.
3. **EQ(4) is computed in exactly one place** — `documentMastery()`. If the Analytics figure and the
   Test Mode figure ever disagree, something has grown a second implementation.
4. **The server supplies the material `title`.** Do not join client-side against the materials list;
   it filters on `parsed_status` while these routes filter on published ∩ linked, so the join can
   miss. See §12.3.
5. **`/mastery` stays lean.** Test Mode refetches it on mount and after every submission. Per-concept
   data belongs on `/mastery/concepts` and must not be merged in.
6. **Do not add a client-side cache.** `<main key={activeTab}>` remounts the tab on every entry, so
   the data is fresh by construction — including on return from Test Mode having just moved the
   number, which is precisely when a cache would be stale.
7. **`foundational` renders `neutral`, never `poor`.** Everyone starts foundational; red would mark
   every new student as failing at something they have not attempted.

---

## 3. Why it exists — what the paper promises

Three places, and the third is the one that makes it non-optional.

**p. 81, in EQ(4) itself:**

> "To render a high-readability overview on the student's dashboard, the application layer
> dynamically aggregates these independent probabilities using an arithmetic mean… `M_doc` represents
> the overall document mastery percentage **displayed as a progress bar on the user dashboard**"

**p. 66, the architecture:**

> "The Bayesian Knowledge Tracing (BKT) Core… feeds aggregated mastery data back to the **Educator &
> Student Dashboard**"

**p. 98, the black-box test plan — student-side test cases:**

> "…**BKT mastery tracking and dashboard visualization**… and **learning analytics display**"

A panel can ask to see this. `StudentDashboard.tsx` is the page the paper literally names, but it is
315 lines of `MOCK_STUDENTS[0]` with a hardcoded `dueToday = 12`, and the user deferred it. So this
tab carries the p. 81 progress-bar claim on its own — coherent, because `M_doc` is **per-document**
and materials live inside study spaces.

**Label:** "Analytics", chosen by the user over "Progress" precisely to match the paper's own
*"learning analytics display"* and keep the paper→app mapping unambiguous.

---

## 4. The rule that governs everything

### 4.1 The prior is not a measurement

Every concept with no `bkt_mastery` row sits at **P(L₀) = 0.10**. In a 29-concept lesson where the
student has answered six questions, **twenty-three concepts read 0.10** — and rendering those as
"10%" tells a student they know a tenth of something nobody has ever asked them about.

The endpoint therefore returns an explicit `assessed: boolean` per concept, and
`assessed_concept_count` per material. Those flags — not the value — decide what is rendered.

### 4.2 The sharper reason: unassessed would outrank struggling

This is the argument that makes §4.1 a correctness rule rather than a kindness.

In `bkt.ts`, `posterior = evidence + (1 − evidence)·P(T)` with `P(T) = 0.20`, so the transition step
**floors every posterior at 0.20**. Any concept with even one observation therefore lands at 0.20 or
above; the all-wrong limits are 0.25 for multiple choice and 2/7 for true/false.

So an unassessed concept at 0.10 would rank **below every genuinely struggling assessed concept**. A
weakest-first "focus next" list that included them would fill entirely with concepts the student has
never seen — the exact opposite of useful. Excluding them is not cosmetic; it is what makes the
ordering mean anything.

**Corollary: no assessed concept can ever display below 20%.** Do not design a "0–20% critical" band;
it will always be empty. And expect a visible cluster at **20–25%**, which means "got everything
wrong", not "barely started" — the "Focus next" heading is what carries that meaning, since the
percentage alone does not.

### 4.3 How it is presented

| | Assessed | Not assessed |
|---|---|---|
| Bar | ✅ tier-coloured | ❌ none |
| Percentage | ✅ | ❌ none |
| Attempts count | ✅ | ❌ |
| Layout | full row | a name chip |
| Sort position | first, weakest ascending | after, alphabetical |

The user chose this presentation over two alternatives: one flat list with dashes (23 empty rows
reads as broken rendering) and showing 10% on everything (which §4.2 rules out).

---

## 5. The data path

```
bkt_mastery ──┐
              ├─→ masteryRows()      one chunked read, NUMERIC → number
concepts ─────┘         │
                        ├─→ documentMastery()   EQ(4), the only mean in the codebase
                        │
     GET /space/:id/mastery            → SpaceMastery         (Test Mode's hot path)
     GET /space/:id/mastery/concepts   → SpaceMasteryDetail    (this tab)
                        │
                 src/lib/mastery.ts   types + masteryApi
                        │
                 AnalyticsTab.tsx     presentation only
```

### `server/lib/testDifficulty.ts` — two new helpers

```ts
export interface ConceptMasteryRow {
  mastery: number;           // latent_mastery, Number()-coerced
  opportunityCount: number;
  lastUpdated: string | null;
}

/** Every bkt_mastery row for these concepts. Chunks its .in() at 200. */
export async function masteryRows(studentId: string, conceptIds: string[]): Promise<Map<string, ConceptMasteryRow>>;

/** EQ(4) from values already in hand. THE ONLY PLACE the mean and its 4dp rounding live. */
export function documentMastery(conceptIds: readonly string[], byConcept: ReadonlyMap<string, number>): number;
```

**Why `masteryRows` chunks.** Supabase serialises `.in()` into the query string. Four hundred
concept ids at 37 characters each is roughly **15 KB of URL**, past the default header buffer on
common gateways. `IN_CHUNK = 200` closes the class permanently. *(This was a latent bug in the
pre-existing `/mastery` route, which passed every concept in the space in one go.)*

**Concepts with no row are simply absent from the map.** That absence *is* the assessed/unassessed
distinction — every caller depends on being able to tell them apart, so do not default them in.

`masterySnapshot()` keeps its exact signature and is now implemented over these two. Its behaviour is
unchanged — verified in §13.

### `GET /api/practice/space/:spaceId/mastery/concepts`

Everything `/mastery` returns, **plus** every concept of every material, in one request.

```ts
interface ConceptMasteryDto {
  concept_id: string;
  term: string;
  mastery: number;            // exactly P(L₀) when assessed is false — a PRIOR
  assessed: boolean;          // false = no bkt_mastery row
  opportunity_count: number;
  last_updated: string | null;
  source_pages: number[] | null;
}

interface MaterialMasteryDetailDto {
  material_id: string;
  title: string;              // server-supplied, see §12.3
  m_doc: number;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  last_updated: string | null;
  concepts: ConceptMasteryDto[];   // assessed first, weakest ascending; unassessed after, by term
}
```

**Server sorts, client does not.** Weakest-first is what makes the list actionable without a second
widget, and it is the ordering `testDifficulty.ts` anticipated before BKT existed. Unassessed always
sort last regardless of their 0.10 — they have no position on a scale they were never measured on.

**The path segment is the literal `concepts`, not `:materialId`**, so it can never swallow an id.

---

## 6. The N+1 collapse

The pre-existing `/mastery` handler called `masterySnapshot()` **once per material in a loop**, then
ran a separate query for `last_updated`:

```
requireOwnedSpace (study_spaces + profiles)   2
publishedMaterialIds                          1
study_space_materials                         1
concepts                                      1
masterySnapshot(all concepts)                 1
masterySnapshot(per material)                 N   ← the loop
bkt_mastery last_updated                      1
                                          ──────
                                        6 + N     (17 at N = 10)
```

Every one of those N+1 queries **re-fetched rows the previous line already had**. EQ(4) is an
arithmetic mean, and `masterySnapshot(studentId, subsetIds)` hits the same table with the same
`student_id` over a subset of ids the full call already fetched — so its `byConcept` is provably the
restriction of the full map, and `last_updated` is just the maximum over rows already returned.

Rewritten as `documentMastery(ids, byConcept)` with `latestUpdate(rows, idSet)`, it is now **7 flat**,
independent of material count. The new route costs the same constant, so the pattern is gone from
both routes rather than doubled.

This was a **simplification, not a trade** — fewer lines, no behaviour change (§13 proves it).

---

## 7. Frontend structure

### `src/lib/mastery.ts` — the shared module

Its own module rather than part of `testMode.ts` because mastery is fed by Adaptive Flashcards **and**
Adaptive Test Mode, and read by Test Mode, this tab and eventually the dashboard. Filing it under one
of its two writers would have been arbitrary.

Received `SpaceMastery` and the mastery API call from `testMode.ts` (which had exactly one consumer,
three lines in `AdaptiveTestTab`), and `TIER_TONE` / `TIER_LABEL` from `AdaptiveTestTab.tsx`.

| Export | Purpose |
|---|---|
| `masteryTier(0–1)` | Client mirror of the server function and `mastery_tier()` in schema.sql |
| `masteryPercent(0–1)` | The only rounding the UI does |
| `TIER_TONE` / `TIER_LABEL` | Tier presentation, shared by two tabs |
| `masteryCaption()` | The one sentence printed under a mastery figure — shared, so it cannot drift into two phrasings |
| `relativeTime()` | "2 days ago". Coarse on purpose; mastery moves in sessions |
| `SpaceMastery`, `ConceptMastery`, `MaterialMasteryDetail`, `SpaceMasteryDetail` | The wire types |
| `masteryApi.space()` / `.detail()` | The two reads |

`DifficultyTier` is **re-exported, not moved** — it is `practice_tests.difficulty_tier`'s CHECK as
much as a mastery threshold, and moving it would touch every importer.

> ⚠️ **`masteryTier` must be fed the value you are about to DISPLAY.** A concept at 0.849 renders as
> "85%" but tiers as `intermediate` on the raw value, so the number and its colour would contradict
> each other on screen. `ConceptRow` passes `masteryPercent(m) / 100` for exactly this reason.
> Material-level tier comes from the server on the unrounded `m_doc`, so the two can differ only
> inside a razor-thin band, and only between a concept row and its parent lesson.

### `src/components/ui/MeterBar.tsx`

The shared progress meter, and **`toneBg`'s first ever consumer** — it had been exported and unused,
while five hand-rolled bars agreed on `h-1.5 rounded-full bg-white/5` and diverged on colour.

```ts
value: number | null;   // null renders an empty track with NO meter semantics
tone?: Tone;
label: string;          // accessible name
```

`value === null` drops `role="meter"` and sets `aria-hidden`: a meter without `aria-valuenow` is
invalid, and announcing "0" would be a lie. The adjacent "Not started" text carries the meaning.
**Never pass 0 to mean "not assessed"** — 0 asserts a measurement of zero, a different claim.

`components/educator/MasteryBar.tsx` was deliberately **not** reused: it imports `masteryTier` from
`src/data/mockEducator.ts` (a mock module) and a palette whose `foundational` is rose `#fb7185`,
contradicting the student side's deliberate neutral.

### `AnalyticsTab.tsx`

Props identical to the other three tabs — `{ spaceId, availableResources }`. `availableResources` is
used **only** for the "no lessons in this space" branch, so a failed fetch stays distinguishable from
an empty space.

State: `detail`, `isLoading`, `error`, `expanded: Set<string>`. One effect on `[spaceId]`, with a
`cancelled` flag so a fast tab switch cannot set state on an unmounted component.

Module-private components: `Stat`, `ConceptRow`, `LessonCard`.

### `StudySpace.tsx` — seven edits

1. `ChartColumn` added to the lucide import
2. `import AnalyticsTab from './studySpaceTabs/AnalyticsTab'`
3. `activeTab` union gains `| 'analytics'`
4. Desktop tab `<button>` (no `hidden sm:inline` split — "Analytics" is one short word)
5. Mobile collapsed-button label line
6. Mobile dropdown array entry
7. Render block in `<main>`

> **Use `ChartColumn`, not `BarChart3`.** Verified in `lucide-react@0.546.0`: the `.d.ts` reads
> `ChartColumn as BarChart3, ChartColumn as BarChart3Icon` — `BarChart3` is a deprecated alias that
> compiles today and will not survive the next lucide major.

---

## 8. Layout, section by section

**Header** — house shape: icon chip, `font-display text-xl` title, subtitle *"How much of each lesson
you have mastered, tracked from your flashcard reviews and tests."* **No refresh button**, because
the remount makes the data fresh by construction and a button would advertise staleness that does not
exist.

**Summary strip** — three tiles.

| Tile | Cold start | With data |
|---|---|---|
| Overall mastery | `—` | `34%`, tier-coloured |
| Level | `—` | `Intermediate`, tier-coloured |
| Concepts tracked | `0 / 57` | `18 / 57` |

*"Level" dashes out at cold start for the same reason "Mastery" does: `foundational` with no evidence
behind it is the default the system starts everyone at, not something it has found out.*

Caption below comes from `masteryCaption()` — shared with Test Mode — plus `· Updated 2 days ago`.

**Nothing measured yet** — when materials exist but nothing is assessed, a banner appears *above* the
lesson list rather than replacing it with an empty card. **This is a deliberate deviation from the
house two-branch empty-state convention**, and it is commented in the file: the lesson list is itself
the information ("these are the lessons being tracked"), so hiding it would remove the one thing the
student can act on.

**Focus next** — the three weakest *assessed* concepts, across all lessons. Subtitle reads *"Ranked
from the N concepts you have been tested on."* — the honesty guard that pre-empts "why isn't X here",
and is always accurate. Not rendered at all when nothing is assessed. Replaced by a single sentence
when the weakest is already ≥ 0.85.

**By lesson** — always visible, never behind a click, because this is the p. 81 deliverable. Each
lesson is an expandable card:

- *Collapsed:* title, percentage in tier colour, full-width `MeterBar`, and
  *"18 of 28 concepts assessed · Intermediate"*. When nothing is assessed: no percentage, no tier,
  the right side reads **"Not started"** and the bar is an empty track.
- *Expanded:* **Tested so far (n)** — rows with bar, percentage, *"4 attempts"* and page numbers.
  Then **Not yet tested (n)** — one muted sentence and the terms as chips.

The word is **"attempts"**, never "questions": `opportunity_count` mixes flashcard ratings and test
items, and `bkt.ts` calls it reporting metadata only.

---

## 9. Design decisions and why

**One request, not expand-on-demand.** Measured **10.7 KB for 57 concepts across 2 materials**
(~190 bytes/concept), so a 10-material space lands near 75 KB uncompressed / ~10 KB gzipped — smaller
than a single flashcard deck, and `fetchSpaceData` already pulls every card's full front and back on
mount. Expand-on-demand would need a per-material cache, loading state and in-flight dedupe, would
put a spinner behind a click that should be instant, and `<main key={activeTab}>` discards the cache
on every tab switch so it never amortises. Decisively: it makes a **cross-material** "Focus next"
impossible without N requests.

**A separate route, not a flag on `/mastery`.** Test Mode refetches `/mastery` on mount and after
every submission; it must not start carrying a payload it discards on a hot path.

**Kept on `practice.routes.ts`, not `studyspaces.routes.ts`.** `masterySnapshot`/`masteryTier` are
already imported there, and the existing route's doc comment argues the student-facing figure must be
computed by the same function the test generator uses. A second mastery source elsewhere is the
duplication that comment exists to prevent.

**Not built on `v_student_material_mastery`.** That view **double-counts**: a material linked to two
of the same student's spaces joins twice, inflating `concept_count` and `mastered_concept_count` (the
average survives). It is unused everywhere else and was left alone.

**No mastery-over-time chart.** The weak argument is "no chart library" — this codebase hand-rolls
five bars and two SVG rings, so 40 lines of inline SVG would do it. The real argument is
architectural: `bkt_update_logs` **has no runtime reader**, and `applyBktObservations` treats
`logWriteError` as **non-fatal by deliberate design** (mastery is written first; a failed audit
insert does not fail the request). Giving the student UI a read on that table would turn every
tolerated log failure into a visibly wrong chart, forcing `logWriteError` to become fatal and
inverting a documented failure-ordering decision. Use `last_updated` and `opportunity_count` for
recency and effort instead — a time series belongs in a script that produces a paper figure.

**`flashcardSets` is not passed down**, though `StudySpace` already holds it. Two reasons, the second
decisive: a card carries no review count (only `nextReviewAt`, which defaults to `now()`, so any
derived "cards reviewed" figure is wrong on day one), and `opportunity_count` is already the
writer-of-record's own count across **both** sources. Two contradictory effort numbers on one screen
is worse than one.

---

## 10. Security

- **Both routes go through `requireOwnedSpace()`**, which 404s (never 403 — a 403 would confirm the
  id names a real space, and space ids are visible in the address bar). It also re-checks the
  profile is an active student with a grade level, so a disabled account reads nothing.
- **The material filter is published ∩ linked**, so an educator archiving a material removes it from
  every student's Analytics tab instantly.
- **The payload carries no `definition` and no `embedding`** — grepped in §13. Concept *terms* are
  already student-visible through `POST /api/materials/concepts/batch`.
- **Nothing here writes.** Rule 2 in §2, restated in the route's own JSDoc.
- RLS does not protect these routes — the service role bypasses it — so the route gates are the whole
  defence. That is the project-wide rule for every student-reachable route.

---

## 11. Debugging playbook

### "The percentages are wrong / disagree with Test Mode"

They come from the same function, so a disagreement means something has grown a second
implementation. Check in this order:

1. Compare the two endpoints directly — they must be byte-identical on `overall`, `tier`,
   `concepts_total`, `concepts_assessed` and each `by_material[].m_doc`:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/practice/space/$SPACE/mastery
   curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/practice/space/$SPACE/mastery/concepts
   ```
2. Confirm nothing calls `masterySnapshot()` in a loop again — it should appear only in
   `POST /api/practice`.
3. Hand-check EQ(4): `(sum of assessed + 0.10 × unassessed) / total`, rounded to 4dp.

### "Everything shows 10%" / "everything says Not started"

That is the correct rendering for a student with no `bkt_mastery` rows. Confirm with:

```sql
SELECT count(*) FROM bkt_mastery WHERE student_id = '<uuid>';
```

Zero rows is a cold start, not a bug. To populate:
`npx tsx scripts/set-test-mastery.ts intermediate` (⚠️ competes with the live engine — `reset` after).

### "A lesson is missing from the tab"

The filter is **published ∩ linked**. Check both halves:

```sql
-- published to this space's subject + the student's grade, not archived?
SELECT id, title, subject, grade_levels, is_archived FROM materials WHERE id = '<uuid>';
-- linked to the space?
SELECT * FROM study_space_materials WHERE space_id = '<uuid>';
```

A material with **zero concepts** is skipped by design — there is nothing to average.

### "A lesson shows as `Untitled lesson`"

The `materials` row was not readable when the route ran. That fallback exists because the concepts
survived but the title lookup did not; see §12.3.

### Symptom → cause

| Symptom | Likely cause |
|---|---|
| `NaN%` anywhere | A NUMERIC arrived as a string and skipped `Number()`. Check any new `bkt_mastery` read. |
| Concept percentage and colour disagree | `masteryTier` fed the raw value instead of `masteryPercent(m)/100`. |
| Untested concepts showing a bar | A gate is reading `mastery === 0.1` instead of `assessed`. |
| Focus list full of concepts never studied | Same — unassessed leaked into the assessed filter (§4.2). |
| Tab blank with no error | The fetch threw and `error` did not render; check the browser console. |
| Counts disagree between tiles | `availableResources[].concept_count` mixed with `concepts_total`. Never mix them (§12.5). |
| 404 on a space that exists | Not the caller's space, or the profile is disabled / has no grade level. |

---

## 12. Known issues deliberately NOT fixed

1. **No deep link from a lesson to "take a test on it".** The expanded card says it in prose instead.
   Adding it means exporting the tab-id union from `StudySpace.tsx` and passing a typed setter — the
   existing `setActiveTab as any` pattern should not be extended.
2. **`expanded` resets on every tab switch**, because `<main key={activeTab}>` remounts the tab. That
   is the same mechanism that keeps the data fresh, and is commented as intentional.
3. **`Untitled lesson` fallback is reachable but not expected.** The materials read and the concepts
   read are separate queries; if the first returns nothing for an id the second covered, the title is
   missing. Server-supplied title already fixes the *common* version of this — the client-side join
   would have failed whenever `parsed_status !== 'completed'` during a re-upload while the concepts
   were still present.
4. **`v_student_material_mastery` still double-counts** (§9). Unused by any code; left alone.
5. **`availableResources[].concept_count` and `concepts_total` come from different queries with
   different filters** and can disagree. This tab uses the mastery payload's counts exclusively; if
   you add anything, keep doing that.
6. **No pagination on the expanded list.** A 200-concept lesson would render 200 rows. Realistic
   materials are 28–29 concepts, and the student chose to open it, so no cap was added.
7. **`StudentDashboard.tsx` is still entirely mock.** It is the page the paper names for the
   progress bar; this tab covers the claim in the meantime.

---

## 13. Verification evidence

All checks run against the live project on **8 August 2026**, using throwaway students created and
deleted inside a `finally` — zero rows left behind.

**Static:** `npm run lint` (`tsc --noEmit`) and `npx vite build` both clean.

**EQ(4) rewrite is behaviour-preserving** — the old inline formula against the new
`documentMastery()` across **3000 random concept sets** (1–60 concepts, ~50% assessed):
**worst difference 0.00e+0**. Includes the `14×0.90 + 14×0.10` float case the rounding comment names
(both give exactly `0.5`) and the empty set (both give `P_L0`).

**Endpoint run 1 — single material, 30 checks, all passing:**

- *Cold start:* HTTP 200; `overall` is `null` **not** `0.1`; `concepts_assessed` 0; `concepts_total`
  29; title server-supplied; every concept `assessed: false`; **every unassessed `mastery` exactly
  `0.1`**; every concept carries a term.
- *Partial (3 concepts forced to 0.22 / 0.91 / 0.55):* EQ(4) `0.1476` matches hand computation;
  `concepts_assessed` 3; assessed sort **first**; weakest-first ordering `0.22, 0.55, 0.91`;
  unassessed all after; `opportunity_count` is a **number** (4), not a PostgREST string;
  `last_updated` present on assessed and `null` on unassessed.
- *Agreement:* `/mastery` and `/mastery/concepts` identical on `overall`, `tier`, `concepts_total`,
  `concepts_assessed`, per-material `m_doc` and `last_updated`.
- *Ownership:* another student's space → **404**; no token → **401**.
- *Hygiene:* no `definition`, no `embedding` in the payload. **5.6 KB for 29 concepts.**

**Endpoint run 2 — two materials, 12 checks, all passing.** Specifically exercises the per-material
`last_updated` narrowing: mastery forced on **one** material only, and the other must report
`last_updated: null` while the space-level value is non-null and equals the touched material's.
Per-material `m_doc` agrees between both routes for every material. **10.7 KB for 57 concepts.**

**BKT unaffected:** `npm run bkt:verify -- --live` → **219 / 219 = 100.0%** after the
`masterySnapshot` rewrite.

---

## 14. Future work

1. **`StudentDashboard.tsx`.** The paper names it for the progress bar. `masteryApi.space()` already
   returns everything a cross-space roll-up needs.
2. **Educator analytics.** `v_grade_level_mastery` exists and now has real data behind it — fix the
   double-count first (§12.4).
3. **A mastery-over-time paper figure**, as a script over `bkt_update_logs`. Explicitly not live UI
   (§9).
4. **A "practise this lesson" deep link** from the expanded card (§12.1).
5. **Promote `Stat`** to `src/components/ui/` — there are now three near-identical local copies
   (`AdaptiveTestTab`, `TestResultsView`, `AnalyticsTab`), which is exactly the trigger
   `surfaces.ts`'s own header comment describes.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Assessed** | The student has a `bkt_mastery` row for that concept. The flag that makes a percentage meaningful. |
| **EQ(4) / `M_doc`** | Document mastery — the arithmetic mean of per-concept probabilities over every concept in one material. |
| **P(L₀)** | 0.10, the prior for a concept never assessed. **An assumption, not a measurement.** |
| **Tier** | `foundational` < 0.50, `intermediate` 0.50–0.85, `advanced` ≥ 0.85. |
| **Attempt** | One `opportunity_count` increment — a flashcard rating **or** a test item. Never called a "question". |
| **Focus next** | The three weakest *assessed* concepts across the space. Never includes unassessed ones. |
| **Not started** | A material where `assessed_concept_count === 0`. Renders an empty track, no number. |

---

## Related documents

| Document | What it covers |
|---|---|
| **`LearnSyncAI artifacts/BKT_IMPLEMENTATION.md`** | **The engine producing every number here. §4 there explains the 0.20 floor this tab's ordering depends on.** |
| `LearnSyncAI artifacts/TEST_MODE_IMPLEMENTATION.md` | One of the two mastery writers, and the other consumer of `masteryApi.space()` |
| `LearnSyncAI artifacts/FLASHCARDS_IMPLEMENTATION.md` | The other mastery writer |
| `ARCHITECTURE.md` §8 | The BKT equations of record |
| `CLAUDE.md` | Project-wide rules |
| `LearnSync AI version 4.docx.pdf` | The paper. **p. 81** EQ(4) and the progress bar, **p. 66** architecture, **p. 98** the black-box test list |
