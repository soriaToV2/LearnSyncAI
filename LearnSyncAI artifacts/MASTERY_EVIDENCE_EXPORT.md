# Mastery-Evidence Export (As Built)

> Built 2026-09-02, alongside the removal of the pre-test / post-test instrument
> ([`PREPOST_TEST_IMPLEMENTATION.md`](PREPOST_TEST_IMPLEMENTATION.md), marked REMOVED).
> No migration — it reads `bkt_mastery` and `bkt_update_logs`, both of which already existed.

**Scope.** One route, one helper, one button, and the reasoning behind the two numbers the file
carries. It is *not* the BKT engine ([`BKT_IMPLEMENTATION.md`](BKT_IMPLEMENTATION.md)), the student
Analytics tab ([`ANALYTICS_IMPLEMENTATION.md`](ANALYTICS_IMPLEMENTATION.md)) or the educator Class
Performance screen, all of which are permanent product features. This is a research export.

---

## 1 · Why it exists

The paper's **RQ4 (p. 55)** asked for the significance of the difference between a student's standard
pre-test score and their post-test score, and p. 103 named that the *primary* evaluation instrument.
An implementation of exactly that shipped on 2026-08-21 and was withdrawn on 2026-09-02 on advice.

The reason is the study calendar, not the implementation. The programme runs **1–3 weeks**: week 1
gathers learning materials, creates the student accounts and distributes them; **week 2 is the only
week students actually use the application**; week 3 is wrap-up. A pre/post difference measured
across one week of usage cannot be attributed to the platform — too much of it is test-retest
familiarity, and there is no plausible control for the rest.

What the platform *does* have across that week is a per-concept probability that a student knows a
concept, updated on real evidence, with a complete audit trail: **Bayesian Knowledge Tracing**. The
adviser's recommendation was to use that as the progress evidence, which is what this export makes
available in a form a statistics package can read.

---

## 2 · ⚠️ The before/after pair — the load-bearing decision

Over `S(student)` = this material's concepts that have a `bkt_mastery` row ("assessed"):

```
start_mastery = mean over S of  p_l_posterior of that concept's OLDEST bkt_update_logs row
end_mastery   = mean over S of  bkt_mastery.latent_mastery
growth        = round4(round4(end) − round4(start))
```

### The three "before" candidates that are wrong

Every obvious reading of "mastery before they studied" is **exactly P(L₀) = 0.10**:

| Candidate | Value | Why it is not a measurement |
|---|---|---|
| `p_l_prior` of the oldest log row | 0.10 | Verified across 28 concepts / 56 rows: every concept's oldest row has `p_l_prior = 0.10`. It is the engine's initialisation constant. |
| EQ(4) at t = 0 | 0.10 | `documentMastery()` fills an unassessed concept with P(L₀), and at t = 0 every concept is unassessed. |
| Backward reconstruction to the window's start | 0.10 | `buildCurve()` walks back to exactly the above. Same tautology, more machinery. |

Printing any of them would print an assumption as a finding, which is the rule the whole analytics
surface is built around — see "Never print P(L₀)" in `CLAUDE.md`.

### Why this pair is defensible

- **Both ends are real evidence.** `start` is EQ(3) applied to a real answer; `end` is the
  authoritative stored state.
- **Identical denominator.** Both are means over the *same* `S`, so `growth` is a **paired**
  per-student difference — the shape a paired t-test or a Wilcoxon signed-rank test needs. A mean
  over two different sets would silently destroy that.
- **Unassessed concepts are excluded by construction**, not filtered afterwards: no mastery row ⇒ no
  log row ⇒ no key in either map.

### ⚠️ The bias, stated rather than hidden

`start_mastery` includes the outcome of the student's first answer on each concept. A first correct
MCQ lands at **0.3271**; a first wrong one at **0.2174**. So the honest label is **"after the first
opportunity"** — never "baseline", "pre-test", or "before studying". Three consequences:

1. A student assessed **exactly once** per concept has `start == end` and `growth == 0`. That is
   correct, not a bug, and it is why `opportunities` is a column.
2. `growth` slightly **under**-states total learning, because the first opportunity's gain is already
   spent inside `start`. Under-stating is the safe direction for a claim about one's own platform.
3. The write-up must use the same phrase. The rule is repeated on `FirstObservation` in
   `server/lib/testDifficulty.ts`, on the route in `server/routes/educator.routes.ts`, and on
   `EvidenceStudent` in `src/lib/educatorAnalytics.ts`.

`m_doc` ships beside them: EQ(4) over **every** concept in the lesson, via `documentMastery()`, which
is the same number Class Performance prints. It is the coverage-sensitive figure next to the
coverage-free pair, and it makes the file reconcile with the screen.

---

## 3 · The route

`GET /api/educator/materials/:materialId/mastery-evidence` — appended to
`server/routes/educator.routes.ts`, which already carries
`router.use(authenticate, requireRole('educator'))`.

- **No Zod.** A path parameter only, matching the file's other three routes. `requireOwnedMaterial()`
  answers **404** (never 403) for a material the caller does not own.
- **Read-only, permanently.** Educators read mastery and never move it (paper p. 58). Nothing on this
  path imports `server/lib/bkt.ts`; `bkt_source` stays a two-value enum.
- **Four round trips:** material → (concepts ‖ roster) → (`classMasteryRows()` ‖
  `classFirstObservations()`).
- **Archive-blind**, unlike `GET /overview`. `requireOwnedMaterial()` deliberately returns archived
  materials to their owner, and an educator archiving a lesson at the end of the study must still be
  able to export its evidence. `GET /overview`'s live-only filter exists so an out-of-hands lesson is
  not averaged into "how are my classes doing", which this is not. `is_archived` ships for provenance.
- **Roster order, not weakest-first.** The partition-then-sort rule the other three routes follow is
  for *ranked UI lists*; this is a table for a stats package, where a stable name order joins against
  a class list — and keeping it sidesteps the null-in-a-numeric-comparator NaN hazard entirely.

### The integrity assert

While folding log rows the route keeps each key's newest `p_l_posterior` and `console.error`s when it
differs from the stored `latent_mastery` by more than `1e-9`. Same idiom as `warnOnLogGaps()` in
`dashboard.routes.ts`: an operator line, never a response field, never a dropped row. It costs no
extra query and directly re-verifies the property the paper rests on. Expected output on current
data: silence.

---

## 4 · `classFirstObservations()`

`server/lib/testDifficulty.ts`, immediately after `classMasteryRows()`. That file already owns
`classKey()`, `IN_CHUNK`, `P_L0` and `documentMastery()`, and the codebase's only
two-`.in()`-lists-in-one-URL rule.

- Both id lists chunked at `IN_CHUNK = 200`, exactly as `classMasteryRows()` chunks them.
- **Each chunk pair is additionally PAGED** with `.range()`, up to `EVIDENCE_ROW_CAP = 5000`.
  PostgREST's default `db.max_rows` is 1000 and nothing in this project raises it; 50 students × 2
  tests × 20 items is 2,000 rows for a single material.
- **⚠️ Ascending order is load-bearing.** The cap then drops only the *newest* rows, which this
  reader does not need — the "after" side is anchored to `bkt_mastery`, never to the log.
  `buildCurve()` gets the same property from ordering the other way, because it is anchored at the
  other end.

### ✅ Fixed 2026-09-10 — was "known, not fixed here"

`classMasteryRows()` carried the same 1000-row hazard **unguarded**: 200 × 200 chunks can request up
to 40,000 rows, and 50 students × 57 fully-assessed concepts is 2,850. The request succeeds and
returns the first 1000, so Class Performance, the educator dashboard and this export all silently
under-reported with no error to notice. It now pages exactly as `classFirstObservations()` does,
ordered by `(student_id, concept_id)` — a cap without an order caps an arbitrary subset.

It was fixed as a prerequisite of the .xlsx export (§5): that file puts the per-concept rows on their
own sheet, so the truncation would have become visible as missing rows under a formula.

---

## 5 · The file

> **⚠️ SUPERSEDED 2026-09-10 — this is now an .xlsx, not a CSV.** `EVIDENCE_HEADER` and
> `evidenceRows()` are deleted. The column reasoning below still holds and is what the workbook's
> `Summary` sheet renders; what changed is that each column is now a live Excel formula over a new
> `ConceptDetail` sheet carrying the per-concept rows, with the server's own value beside it and a
> `check` column comparing the two. See `src/lib/masteryWorkbook.ts` and the .xlsx section of
> `CLAUDE.md`. Anything below describing comma quoting or `csvCell()` applies to the account-import
> CSV only.

`EVIDENCE_HEADER` and `evidenceRows()` live in `src/lib/educatorAnalytics.ts`, beside their own
types, exactly as `CREDENTIAL_HEADER` / `credentialRows()` live beside theirs in `csvAccounts.ts`.
Only `toCsv` and `downloadCsvFile` are imported from there.

| # | Column | Why |
|---|---|---|
| 1 | `material_title` | Ten materials concatenate into one sheet; filenames get renamed. |
| 2–3 | `last_name`, `first_name` | A row of numbers that cannot be checked against a class list is unusable. `profiles` has no email and one must not be invented. |
| 4 | `grade_level` | A material's class can span grades; a plausible covariate. |
| 5 | `concept_count` | The lesson's size — the denominator of `m_doc`. |
| 6 | `assessed_concepts` | **The denominator of columns 10–12**, and a coverage measure in its own right. Without it those three cannot be interpreted at all. |
| 7 | `opportunities` | Σ `bkt_mastery.opportunity_count` — how much evidence sits behind the row (the paper's time index `t`). Reporting metadata; it never enters a mean. |
| 8–9 | `flashcard_obs`, `test_obs` | The two permitted BKT writers, split. Lets the write-up say which modality drove the growth. Free, since the log rows are already in hand. |
| 10 | `start_mastery` | §2 — "after the first opportunity". |
| 11 | `end_mastery` | Same set, current `latent_mastery`. |
| 12 | `growth` | The paired difference that replaces RQ4's delta. |
| 13 | `m_doc` | EQ(4) over every concept — reconciles the file with the screen. |
| 14–15 | `first_observed_at`, `last_observed_at` | The student's actual usage window — the per-student evidence for the study's "one week" claim. |

Rules:

- **A blank cell means not started. Never `0`, never `0.1`.** But not-started students are **listed,
  not filtered** — "nineteen of twenty never opened this" is a finding, and filtering would hide it.
  (This is the one place it differs from `credentialRows()`, which drops failed rows because a blank
  password cell reads as an empty password.)
- **The server's 4dp values, verbatim.** No client re-rounding, no ×100. `masteryPercent()` is for
  the screen; a second precision would let the paper's numbers disagree with what the educator saw.
- **ISO 8601 UTC timestamps.** `relativeTime()` is for the screen; a browser-localised date in a CSV
  is unparseable months later, and the study runs in Asia/Manila.
- **Everything goes through `csvCell()`.** A surname entered as `Dela Cruz, Jr.` unquoted splits into
  two cells and pushes every number one column across — the measured failure that put `csvCell()` in
  the codebase.

`downloadCsvFile()` was lifted into `csvAccounts.ts` beside `toCsv()`; that module now owns reading
*and* writing the format, and the blob-and-click block exists once for its two call sites.

---

## 6 · The button

`src/pages/educator/components/ClassPerformance.tsx`, in the class-summary panel header.

- **Not a new tab.** A third tab is exactly the surface the pre/post instrument occupied, and
  re-adding one for a research export would undo half the point of removing it. The button belongs
  where the numbers it exports are already visible.
- **Fetched lazily on click.** The route reads the BKT audit trail; the tab's job is the screen, and
  this is a once-per-study action. Paying for it on every tab entry would be the wrong trade.
- **Still enabled when `started === 0`.** A file proving nobody started is a legitimate artifact.

---

## 7 · Correctness traps

1. **A mastery row with no surviving log row** (a tolerated `logWriteError`) is dropped from **both**
   sides and counted in `concepts_without_trail`. Filling the start with P(L₀) invents a measurement;
   dropping it only from the start breaks the pairing and inflates `growth`.
   **⚠️ `logWriteError` in `bkt.ts` stays non-fatal — do not promote it because this reader exists.**
   That is the same rule the dashboard curve states, for the same reason.
2. **`growth` uses rounded operands** — `round4(round4(end) − round4(start))` — so a reviewer
   recomputing column 12 from columns 10 and 11 gets the same digits. Recorded float boundary:
   `meanOrNull([0.6, 0.1333])` is **0.3666**, not 0.3667.
3. **Never print P(L₀), three gates:** `start`/`end`/`growth`/`m_doc` null when
   `assessed_concept_count === 0`; class figures via `meanOrNull()` over started students only. Gate
   on the counts, **never on `=== 0.1`**.
4. **`source` comes from the log rows, never inferred** — one concept can be moved by both writers.
5. **Operational, not code:** a student moved to another grade or a disabled account drops out of
   `rosterFor()` and vanishes from the export, so **export before any account cleanup**. And
   re-uploading a material cascade-deletes its concepts → `bkt_mastery` → `bkt_update_logs`,
   destroying the evidence irrecoverably.

---

## 8 · Deliberately not built

- **A class-level before/after chart.** The denominator moves as students start, so the line drops
  when a new student begins — reading as "the class got worse because someone joined". Same reason
  the educator dashboard has no class mastery curve. A table of paired per-student numbers is the
  correct artifact.
- **A t-test, p-value or effect size in the app.** The export exists so the statistics happen in a
  statistics package. A significance test computed in Express is an unreviewable second
  implementation of the paper's own analysis.
- **Date-range query parameters.** It would be the first educator route with query input, and
  clipping the window makes "the first observation" ambiguous. The window is reported, not chosen.
- **A per-concept evidence CSV** (student × concept × start/end). ~2,850 rows at study scale, and the
  drill-downs already exist on screen. A second button if the paper asks; not speculatively.
- **A new table, a snapshot job, or a `mastery_snapshots`.** The audit trail already holds it, and a
  nightly snapshotter would be a third thing writing BKT-adjacent state.
- **Adding the log read to `GET /materials/:id/performance`.** That is a hot screen read.

---

## 9 · Verification

```bash
npm run lint          # tsc --noEmit
npx vite build
npx tsx scripts/bkt-verify.ts   # must stay 100% — the engine was not touched
```

Manual, on a material with real mastery data:

1. `class.m_doc` from `/mastery-evidence` **equals** `class.m_doc` from
   `GET /api/educator/materials/:id/performance` for the same material — the same consistency
   invariant `GET /overview` already asserts.
2. Each row's `m_doc × 100` rounded equals the percentage the Class Performance tab prints for that
   student.
3. A student assessed on exactly one concept once → `start == end`, `growth == 0`.
4. A not-started student → blank `start`/`end`/`growth`/`m_doc`, `assessed_concepts = 0`, and the row
   is still present.
5. `concepts_without_trail` is 0 and the posterior-mismatch `console.error` is silent.
6. Open the CSV in Excel with a comma-containing surname present — every number stays in its column.
