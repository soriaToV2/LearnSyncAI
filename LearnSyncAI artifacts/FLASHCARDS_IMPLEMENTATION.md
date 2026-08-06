# Flashcards Tab — Implementation Reference

**Feature:** Student flashcards — deck management, generation from vetted concepts, spaced repetition
**Status:** Implemented and verified (`tsc --noEmit` clean, `vite build` clean, verified against live data)
**Date:** 31 July 2026
**Migrations applied:** **none** — every column and constraint this feature needs already existed unused

> **Read this first if you are an AI agent debugging or extending this feature.**
> Section 2 is the non-negotiable rules — violating them breaks the capstone paper's claims,
> not just the code. Section 6 is the single rule the whole spaced repetition system rests on.
> Section 11 is the debugging playbook. Section 12 lists defects deliberately left alone —
> check it before "fixing" something already documented as broken.

---

## Table of Contents

1. [What this feature is](#1-what-this-feature-is)
2. [Non-negotiable rules](#2-non-negotiable-rules)
3. [What it was before, and why it was reworked](#3-what-it-was-before-and-why-it-was-reworked)
4. [The data model](#4-the-data-model)
5. [The security model](#5-the-security-model)
6. [Spaced repetition — the one rule](#6-spaced-repetition--the-one-rule)
7. [Card generation](#7-card-generation)
8. [API surface](#8-api-surface)
9. [Frontend structure](#9-frontend-structure)
10. [Design decisions and why](#10-design-decisions-and-why)
11. [Debugging playbook](#11-debugging-playbook)
12. [Known issues deliberately NOT fixed](#12-known-issues-deliberately-not-fixed)
13. [Verification evidence](#13-verification-evidence)
14. [What was removed](#14-what-was-removed)
15. [Handoff: wiring BKT](#15-handoff-wiring-bkt)
16. [Glossary](#16-glossary)

---

## 1. What this feature is

### In one paragraph

A student creates a **deck** — their own folder for organising a lesson. They open it, pick one of
their educator's materials, and the system fills the deck with one flashcard per vetted concept in
that material. They study the deck; each card they rate Easy / Medium / Hard is scheduled to reappear
in 7 / 3 / 1 days. When they come back, the deck offers only the cards that are actually due. Cards
that are not due can still be practised, but practising changes nothing — no reschedule, and (once
BKT lands) no mastery movement.

### The division of ownership, which is the heart of the design

| Thing | Who owns it | Why |
|---|---|---|
| **Decks** | The student | A deck is a folder. Naming, renaming and deleting it affects nobody else. |
| **Cards** | Nobody — they are derived | Every card is a `concepts` row an educator uploaded and vetted. A student-authored card has no concept to attach mastery to, or injects unvetted text into the knowledge base. |
| **Concepts** | The educator | They create, edit and delete them in the educator portal (`POST/PUT/DELETE /api/materials/:id/concepts`). |
| **Review schedule** | The system | Derived from the student's ratings, but only when a card was genuinely due. |

### Files touched

**Backend**
- `server/lib/reviewSchedule.ts` — **new.** Intervals, Manila day boundaries, `isDue()`.
- `server/routes/flashcards.routes.ts` — rewritten. Now contains only `POST /rate`.
- `server/routes/studyspaces.routes.ts` — deck CRUD restored with guards; card CRUD deleted; generation endpoint added.
- `server/routes/materials.routes.ts` — old generation route deleted.
- `server/lib/groq.ts` — old flashcard helper deleted; `generateQuestionsForConcepts()` added.
- `server/types/api.ts` — `CreateDeckSchema`, `UpdateDeckSchema`, `GenerateDeckCardsSchema`.
- `server/types/database.ts` — `Flashcard` and `SpacedRepetitionLog` brought in line with `schema.sql`.

**Frontend**
- `src/pages/student/studySpaceTabs/FlashcardsTab.tsx` — rebuilt.
- `src/pages/student/components/FlashcardStudyView.tsx` — rebuilt.
- `src/pages/student/StudySpace.tsx` — deck state simplified; carries `concept_count` and `next_review_at`.
- `src/pages/student/components/CreateFlashcardsModal.tsx` — **deleted.**

---

## 2. Non-negotiable rules

Each of these was violated by the pre-rework code. Breaking one does not merely regress a feature —
it invalidates something the capstone paper claims.

1. **Students never author flashcards.** No add / edit / delete card control, and **no such endpoint**.
   Hiding a button is not enough; the routes were deleted.
2. **The back of a card is always the educator's stored definition, verbatim.** A model may write the
   question. A model must never write the answer.
3. **Every card carries `concept_id`.** This is the only thing BKT can attach mastery to. A generation
   path that cannot produce it is the wrong path.
4. **A rating counts only if the card was due.** See section 6. This is the integrity property that
   stops a student inflating mastery by re-drilling.
5. **Free Recall and Feynman still must not write mastery.** Unchanged by this work, but the flashcard
   rating endpoint is now the *second* legitimate writer alongside `practice.routes.ts` — do not add a
   third.
6. **Do not add `source_material_id` to `flashcard_decks`.** A deck may gather several materials; a
   deck-level column would force one deck per material and destroy the organising ability.

---

## 3. What it was before, and why it was reworked

The tab was built for a different product. Concretely broken:

| Problem | Detail |
|---|---|
| Students authored cards | Create/edit/delete deck **and** card, plus a bulk editor that wiped and re-inserted every card in a deck. |
| No card was linked to a concept | `flashcards.concept_id` and `source_material_id` existed in the schema and were **never written by any code path**. BKT had nothing to attach to. |
| Ratings were never recorded | `FlashcardStudyView` guarded its POST with `if (studentId)` and `FlashcardsTab` never passed `studentId`. Easy/Medium/Hard updated an animation and nothing else. `spaced_repetition_logs` had 0 rows. |
| The schedule was decorative | `next_review_at` was written but **nothing read it**. Study Cards always served every card, so a student could rate 68 cards Easy and immediately do it again. |
| Public/Private deck toggle was fake | `flashcard_decks` has no `is_public` column. The PUT handler dropped the field, and the button was permanently `disabled` behind a hardcoded `spaceIsPublic={false}`. |
| `readOnly` / `courseConnected` were dead | Hardcoded `false` and `true` respectively. Every `!readOnly` branch always ran; every `readOnly ? …` string was unreachable. `courseConnected` gated a "connect a course" banner for a Courses feature that no longer exists. |
| Errors were invisible | Every failure path was `console.error` only. A student saw nothing and assumed success. |
| Easy interval contradicted itself | Docs, schema comment and the button label said **7 days**; the backend and results screen said **4**. The live CHECK constraint is `interval_days IN (1,3,7)` — 4 could never have been written. |
| No ownership checks | `POST /rate`, `POST /decks`, `GET /decks`, `GET …/flashcards` and `GET /due/:spaceId` checked only that the caller was logged in. |

The rework ran in four stages: **A** remove authoring, **B** build generation, **D** redesign,
then **spaced repetition**. (There was no stage C — a card-flagging feature was planned and dropped;
see section 10.)

---

## 4. The data model

### `flashcard_decks`
Student-owned folder. `id`, `space_id`, `title`, `description`, `created_at`. **No `is_public`.
No `source_material_id`** — deliberately, see rule 6.

### `flashcards`
| Column | Meaning |
|---|---|
| `term` | **The card FRONT.** Badly named — for question-format cards this holds a question, not a term. Renaming it was judged not worth a migration. |
| `definition` | The card BACK. Always the educator's vetted text, verbatim. |
| `concept_id` | The concept this card assesses. **What BKT hangs on.** |
| `source_material_id` | Which material generated it. Drives "already in this deck" and the deck summary line. |
| `is_ai_generated` | **True only where the model wrote the front.** False for term-format cards *and* for question-format cards that fell back to the term. Used to derive `current_format` on a 409. |
| `next_review_at` | Due when `<= now()`. **Defaults to `now()`, which is why a new card is born due.** |
| `ease_rating` | Last rating. Display only; the schedule lives in `next_review_at`. |

### `spaced_repetition_logs`
**One row per rating that COUNTED.** Practice ratings are deliberately absent — they are not
scheduled retrievals, so they are neither evidence nor schedule changes. Carries `concept_id`
denormalised from the card so BKT can join without a hop, plus `interval_days`
(`CHECK IN (1,3,7)`) and the resulting `next_review_at`.

### Relationships that matter

```
study_spaces ──< flashcard_decks ──< flashcards ──> concepts ──> materials
                                          │
                                          └──< spaced_repetition_logs   (ON DELETE CASCADE)
```

**`spaced_repetition_logs.flashcard_id` is `ON DELETE CASCADE`.** Deleting a card destroys its entire
rating history. This is why refresh reconciles instead of wiping — see section 7.

---

## 5. The security model

The service role key bypasses RLS, so **every route enforces ownership itself**. RLS does nothing for
a request that reaches Express.

The chain for anything touching a card:

```
card → flashcard_decks.space_id → study_spaces.student_id === req.user.id
```

**404, never 403**, on every miss — a 403 confirms the id names a real row.

**Every route below is owner-checked.** There is no read-only exemption.

| Route | Guard | Answer |
|---|---|---|
| `POST /api/flashcards/rate` | walks card → deck → space | 404 |
| `POST /api/spaces/:id/decks` | `loadOwnedSpace()` | 404 |
| `PUT /api/spaces/:id/decks/:deckId` | `loadOwnedSpace()` + deck in space | 404 |
| `DELETE /api/spaces/:id/decks/:deckId` | `loadOwnedSpace()` + deck in space | 404 |
| `POST …/decks/:deckId/generate` | `loadOwnedSpace()` → deck in space → `rejectInaccessibleMaterials()` → material linked to space | 404 / 403 |
| `GET /api/spaces/:id/decks` | `loadOwnedSpace()` | 404 |
| `GET /api/spaces/:id/decks/:deckId/flashcards` | `loadOwnedSpace()` + deck in space | 404 |

**Reads are guarded as tightly as writes, deliberately.** A space id is visible in the browser
address bar (`/student/space/:spaceId`), so a screenshot or a shared link is enough for another
student to hold one. What a deck exposes is not really its *content* — the cards come from educator
materials the classmate can likely read anyway — but its owner's `ease_rating` and `next_review_at`,
which together are a direct readout of the concepts that student is struggling with. Migration 0003
removed peer sharing to guarantee data isolation between students; an unguarded read contradicted
that guarantee in the most personal place available.

**Checking the space alone is not enough on the cards route.** The deck must also be confirmed to sit
*in* that space, or any deck id could be paired with a space the caller happens to own.

**The generation route's last check is not redundant.** `rejectInaccessibleMaterials()` proves the
student *may read* the material (right grade, not archived). It does **not** prove this space holds
it. Without the `study_space_materials` check a student could pull another subject's content into
this space's deck and corrupt the mastery picture the space represents.

---

## 6. Spaced repetition — the one rule

> **A rating reschedules the card if and only if the card was due when it was rated:
> `next_review_at <= now()`.**

That single check is the entire system. It needs no session id, no practice flag, and no new column,
because `flashcards.next_review_at` defaults to `now()` — a fresh card is born due, so the first
honest pass always counts.

| Situation | Counts? | Why |
|---|---|---|
| First time seeing a card | Yes | New cards default to due |
| Due today, or overdue by days | Yes | `<=`, not `===` a date |
| Re-drilled 30 seconds later | No | Already rated — now due in 1–7 days |
| "Practice all" before a test | No | Those cards are not due |
| Comes back next week | Yes | Due again |

**Do not special-case any of these.** They are all the same check.

### Why retries must not count

A student rates Hard, presses "Drill hard cards again", and rates the same card Easy thirty seconds
later — because they just read the answer. That is working memory, not knowledge. Counting it drives
mastery **up** on exactly the concepts the student is weakest at, and lets anyone farm mastery by
re-drilling one card. BKT assumes each observation is an independent test of latent knowledge; a
retry is not one. This is why ITS implementations built on BKT score the **first attempt** and treat
later ones as help-seeking.

### The client never decides

`FlashcardStudyView` posts **every** rating, including inside a practice round. A "Practice all"
session over a deck with 12 genuinely due cards must still schedule those 12 — skipping the request
would lose them. The server checks and returns `counted`; the UI reports what happened rather than
asserting it.

### Ratings save immediately, one request per card

`handleRate` fires its POST the moment a rating is tapped — there is no end-of-session batch write.
Rate 20 of 68 cards and close the tab, and those 20 are saved with their dates set. The request is
**not awaited**: the card advances after 380 ms regardless, so a slow network never stalls the
session. Consequences: the "Saving…" spinner is tied to that animation timer and is decorative; the
honest failure signal is the red banner, which may appear after the card has already moved on.

### Day boundaries, not 24-hour intervals

`nextReviewAt()` returns **midnight Asia/Manila** of the target day. A student who rates at 8pm Monday
and revises after school on Tuesday must find their cards waiting — with `now + N × 24h` they would
stay hidden until 8pm Tuesday and the deck would look broken.

Implementation: shift `now` by +8h into the Manila frame, truncate to the date, add the interval,
shift back. A fixed offset is correct — **the Philippines has observed no DST since 1978.** If the
platform ever spans timezones this becomes a per-profile setting, not a constant.

> **The trap:** a card rated 00:30 Monday Manila is *Sunday* in UTC. Scheduling off the UTC date
> lands a day early. This case is covered by the schedule tests.

### Sessions vs the card grid

Different jobs, opposite answers:

- **A session** opens with **due cards only**. If the schedule does not change what a session
  contains, computing it is theatre.
- **The card grid** inside a deck always shows **every** card, each marked `Due now` / `Due in 3 days`.
  It is for browsing a lesson; hiding 56 scheduled cards would make the deck look emptied.

---

## 7. Card generation

`POST /api/spaces/:id/decks/:deckId/generate` — generates **and saves in one request**, so closing the
tab cannot lose the work or leave a half-made deck.

### Two formats, one invariant

| `format` | Front | Back | Cost |
|---|---|---|---|
| `'term'` (default) | The concept's `term` | The definition, verbatim | Instant, no model |
| `'question'` | An AI-written question | The definition, **verbatim** | ~13 s for 68 concepts |

**The model never writes the answer.** That is what keeps the educator's vetting meaningful all the
way to the student's screen.

### How question generation stays safe

`generateQuestionsForConcepts()` in `server/lib/groq.ts`:

- **Batches at 20 concepts per call.** The deleted helper asked for one card per concept under
  `max_tokens: 4096`; a real material (68 concepts, avg definition 191 chars) truncates.
- **The model echoes each concept's number** (`{ n, question }`) and **every `n` is range-checked**
  before it is trusted. A card attached to the wrong concept is worse than a card with no question.
- **A skipped concept falls back to its term.** A card is never lost and never unlinked.
- **A Groq call that throws aborts the whole request with 502 before anything is written.** A deck
  half questions and half terms is worse than a clean retry.
- `temperature: 0.3` — flashcards are not graded so exact reproducibility is not required, but a
  Refresh should not reword every card gratuitously.

### Re-generating into the same deck

Detected by `deck_id` + `source_material_id`. Without `replace`, the endpoint answers **409** with the
existing count and `current_format`, and writes nothing. The UI turns that into a Refresh prompt — it
is a prompt, not an error.

`replace` **reconciles by `concept_id`; it does not wipe**:

| Case | Action |
|---|---|
| Concept still exists, has a card | **UPDATE** term/definition in place |
| Concept has no card (educator added one) | **INSERT** |
| Card whose concept is gone (educator deleted it) | **DELETE** |

> **This is load-bearing.** `spaced_repetition_logs.flashcard_id` is `ON DELETE CASCADE`, so
> delete-then-reinsert would destroy the student's entire rating history and reset every
> `next_review_at`. **Never rewrite this as a wipe.** `bkt_mastery` is keyed on
> (student, concept) and survives either way.

Known benign imperfection: reconcile is three statements (update, insert, delete), not atomic. If the
delete fails, a few cards for deleted concepts linger. They are still valid cards, and refreshing
again clears them.

---

## 8. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/spaces/:id/decks` | List decks in a space |
| `POST` | `/api/spaces/:id/decks` | Create an empty deck |
| `PUT` | `/api/spaces/:id/decks/:deckId` | Rename / re-describe |
| `DELETE` | `/api/spaces/:id/decks/:deckId` | Delete deck + its cards |
| `GET` | `/api/spaces/:id/decks/:deckId/flashcards` | List cards |
| `POST` | `/api/spaces/:id/decks/:deckId/generate` | Fill from a material |
| `POST` | `/api/flashcards/rate` | Rate a card |

**Deliberately absent** — do not re-add: card create / update / delete / bulk,
`POST /api/materials/generate-flashcards`, `GET /api/flashcards/due/:spaceId`.

### `POST /api/flashcards/rate` response

```jsonc
// due — schedule moved, log row written
{ "data": { "counted": true,  "interval_days": 7, "next_review_at": "2026-08-07T16:00:00.000Z" } }

// not due — nothing written
{ "data": { "counted": false, "next_review_at": "<unchanged>" },
  "message": "Practice rating — this card was not due, so its schedule is unchanged." }
```

---

## 9. Frontend structure

### Data flow

`StudySpace.tsx` is the fetcher. It loads decks and then **one request per deck** for its cards
(known N+1, section 12), maps them to camelCase, and passes them down. `FlashcardsTab` is presentation
plus mutations; it never fetches decks itself.

Card fields the tab needs: `sourceMaterialId` (deck summary, "already in this deck") and
`nextReviewAt` (all due logic).

### Three screens

**1. Deck list.** Tiles, three across on a laptop, one on a phone. **Study is on the tile** — opening
the tab and starting a session is one click. The deck view is not on the way.

| Deck state | Badge on icon | Summary line | Button |
|---|---|---|---|
| No cards | — | `Empty — no cards yet` | `Add Cards` |
| Cards due | **`12`** | `68 cards` | **`Review 12`** (primary) |
| None due | — | `68 cards · next review Tue 4 Aug` | `Practice all` (quiet) |

⚠️ **The due count appears exactly TWICE on a due tile — badge and button — and that is deliberate.**
`deckSummary()` used to append `· 12 due`; it no longer does. Three copies of one number on a small
tile read as noise rather than emphasis. The badge is for *scanning* a grid of decks, the button is
for *acting*; the summary line is facts. The not-due branch is untouched, because "next review Tue
4 Aug" is the useful thing to say when there is nothing to do.

### The due badge (added 6 August 2026)

Also on the **Flashcards tab itself**, desktop and mobile, showing the whole space's due count.

**It is derived, not fetched, and must stay that way.** `StudySpace.tsx` already loads every card
with its `next_review_at` and is the same component that renders the tab bar, so the count is
`flashcardSets.flatMap(s => s.cards).filter(c => isDue(c.nextReviewAt)).length` — no request, no
latency. `GET /api/flashcards/due/:spaceId` was deleted for returning any space's cards to any
logged-in user (section 14) and **does not need to come back for this.**

It refreshes itself: `exitStudy()` already calls `onRefresh()` → `fetchSpaceData`, so the badge drops
the moment a session ends.

`isDue()` moved from `FlashcardsTab` to **`src/lib/reviewSchedule.ts`**, mirroring the server file of
the same name, because `StudySpace` needs it too. One copy on the client; the server stays
authoritative. The tab badge and the tile badges must both use it or their numbers stop agreeing —
verified against live data: a space with two 29-card decks reads **58** on the tab and **29** on each
tile.

`DueBadge` (`src/components/ui/DueBadge.tsx`) renders nothing at zero, caps the label at `99+`, and
carries an `aria-label` because a bare numeral tells a screen reader nothing. Cyan, not red: a due
card is an invitation, not an error.

⚠️ **A brand-new deck shows as entirely due — 29 cards, badge of 29.** Correct by design
(`next_review_at` defaults to `now()`, so a fresh card is born due and its first pass is the one that
counts), but it reads as a backlog the student has fallen behind on. Separating "new" from "needs
revisiting" would change what the server treats as due, which is the single load-bearing check in
`POST /api/flashcards/rate` (section 6). **Considered and shipped as-is** — revisit only with a
reason, not on instinct.

**2. Deck detail.** For browsing cards and managing the deck — not a step to studying. Same primary
action, plus Add Cards / rename / delete, the source line, and an "all caught up" note when nothing
is due (so an absent Review button reads as success, not breakage).

**3. Study view.** Header (Exit / deck / counter), segmented progress bar, the card, then the rating
buttons. **The rating buttons are always rendered, disabled until the card is flipped** — they used to
be swapped in on flip, which moved the whole page on every single card. `handleRate` already refuses
when `!isFlipped`, so the guard is unchanged.

Card faces scroll internally (`flex-1 overflow-y-auto` between a fixed header and footer); definitions
run to ~300 chars and previously overflowed a fixed-height card with no way to read the rest.

On phones the three rating buttons **stay side by side**, dropping their "Review in N days" sublabel.
Stacking them full-width pushed the card off screen, forcing a scroll between flipping and rating on
every card.

### Wording rules

- The results ring says **"Session Score"**, never "Mastery". It is `(easy + medium × 0.5) / cards` —
  a tally of self-ratings for one session. BKT mastery is a per-concept probability in `bkt_mastery`.
  One word for both invites a reader to mistake this figure for the paper's.
- The results screen **reports** what was rescheduled from `counted` replies. It must never assert
  "your next review dates have been scheduled" — that was false after any practice round.
- A practice round says so **up front**, in a banner above the first card, not at the end.
- Every failure is rendered. `console.error`-only is a regression.

---

## 10. Design decisions and why

**Decks are the student's, cards are not.** The first pass removed deck authoring too. That was wrong:
a deck is organisational and affects nobody else. Only the *contents* must be derived.

**A deck may hold several materials.** This is why "already generated?" is a question about cards
(`flashcards.source_material_id` scoped to `deck_id`), not about decks — and why the planned
`flashcard_decks.source_material_id` migration was cancelled. It would have forced one deck per
material.

**Cards are concepts verbatim, not an AI rewrite.** The original helper had Groq rewrite every
definition, so students studied a paraphrase nobody approved — the educator's vetting stopped at the
concept. The AI option was reinstated later as *questions only*, preserving the invariant.

**Question generation echoes indices rather than returning loose pairs.** The deleted helper returned
`{front, back}` with no reference to the source concept, so `concept_id` was unrecoverable. That, not
prompt quality, is why it had to be replaced.

**Study moved onto the deck tile.** Deck list → deck detail → Study was three steps to study. The
middle screen did not earn its place as a gateway; it kept its place as a browse screen.

**Part C (flag a bad card) was dropped.** It assumed students would encounter wrong definitions. The
user's position: educators sanitise extracted concepts in their portal — that is their job in this
system — so the scenario does not arise. Do not reintroduce it without revisiting that premise.

**The student dashboard was left mock.** `StudentDashboard.tsx` shows a hardcoded `dueToday = 12`.
The whole page runs on `MOCK_STUDENTS[0]`; one real number among invented ones is harder to reason
about than none.

---

## 11. Debugging playbook

| Symptom | Likely cause |
|---|---|
| **"Study" shows nothing / deck seems empty after studying** | Working as designed. Everything was rated, so nothing is due. Check `select next_review_at from flashcards where deck_id = …`. |
| **Cards not coming back when expected** | Compare `next_review_at at time zone 'Asia/Manila'` — it should be exactly `00:00:00`. If it has a time component, something bypassed `nextReviewAt()`. |
| **Ratings not saving** | Check the response `counted` field. `false` is not a failure — the card was not due. For real failures the red banner shows the message; check the Network tab for a 404 (ownership) or 400 (validation). |
| **`interval_days` violates check constraint** | Something wrote a value other than 1/3/7. `REVIEW_INTERVALS` in `server/lib/reviewSchedule.ts` is the only legitimate source. |
| **Log rows with null `concept_id`** | Either pre-rework legacy rows (see section 13) or cards generated before `concept_id` was written. New rows should always carry it. |
| **"Already generated" when the deck looks empty** | Cards exist for that `source_material_id` but the material is no longer visible to the student (archived / regraded), so the tab does not render them. Check `materials.is_archived` and `grade_levels`. |
| **Question generation returns terms instead of questions** | Groq omitted or mis-numbered those indices; the fallback fired. Check the `fallback` count in the response. Not an error. |
| **502 from generate** | Groq unreachable. Nothing was written by design — retry, or use term format. |
| **Deck shows "0 cards" but cards exist** | `StudySpace.fetchSpaceData` failed on the per-deck cards request. Check the browser console; that loop is N+1 and each request is independent. |
| **`EADDRINUSE :::5000` on `npm run dev`** | An orphaned backend is still running (usually a terminal closed with ✕ instead of `Ctrl+C`). `Get-NetTCPConnection -LocalPort 5000 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`. Kill the `tsx watch` **parent**, or it respawns the child. |

### Useful queries

```sql
-- Is the schedule landing on Manila midnight?
select ease_rating, next_review_at at time zone 'Asia/Manila' as due_manila
from flashcards order by next_review_at;

-- Are logs complete? interval_days must match the rating (7/3/1)
select rating, interval_days, count(*),
       count(*) filter (where concept_id is null) as missing_concept
from spaced_repetition_logs group by rating, interval_days;

-- Did a practice round wrongly create rows? Should stay 1 per card per due cycle.
select flashcard_id, count(*) from spaced_repetition_logs
group by flashcard_id having count(*) > 1;
```

---

## 12. Known issues deliberately NOT fixed

1. **`StudySpace` loads cards with one request per deck.** Ten decks = eleven requests per tab open.
   The obvious fix is one batched request for all cards in a space.
2. **`StudentDashboard` shows a hardcoded `dueToday = 12`.** Whole page is mock data
   (`MOCK_STUDENTS[0]`), so wiring one real number in would make it harder to tell what is real.
3. **`AdaptiveTestTab` declares decks with a numeric `id` and an `isPublic` field.** Real decks have
   text ids and no such field. TypeScript does not flag it and nothing reads either, so it works by
   luck. Out of scope; will break if that tab starts using those fields.
4. **`courseConnected` is still hardcoded `true`** and passed to Test Mode and Resources, gating UI
   that can never appear. Removed from Flashcards only.
5. **`flashcards.term` holds a question in question-format decks.** Misleading column name; renaming
   was not worth a migration.
6. **Reconcile is not atomic** (section 7). Worst case leaves a few stale cards; refreshing clears them.
7. **One legacy row in `spaced_repetition_logs`** from before the rewrite: `medium` with
   `interval_days = 1` (the default), null `concept_id`, null `next_review_at`. Harmless test data —
   BKT will skip it for want of a concept. Delete it if you want a clean table.
8. **Only one student account exists in the live project**, so the cross-student 404 behaviour on the
   guarded read routes has not been exercised end to end. The guard is the same `loadOwnedSpace()`
   used by seven other routes; verify it with a second account when one exists.

---

## 13. Verification evidence

All checks run against the live project (`joxkrvmuyjppyydnaizt`) on 31 July 2026.

**Static:** `tsc --noEmit` clean; `vite build` clean.

**Route table** (inspected via the Express router stack, not by reading source): card authoring routes
and `/due/:spaceId` are genuinely unregistered; `/api/flashcards` exposes only `POST /rate`.

**Schedule maths — 12/12 pass**, including the UTC-date trap (00:30 Monday Manila = Sunday UTC),
month/year rollover, and `isDue` for null / overdue / exactly-now / future.

**Question generation against live Groq:** 68/68 concepts returned a question, 0 fell back, 13.1 s
across four batches.

**Live data after a real study session:**

| Check | Result |
|---|---|
| Cards generated | 68 |
| Cards with `concept_id` | **68 / 68** |
| Log rows (post-rework) | 68 — exactly one per card, no duplicates |
| Hard → `interval_days` 1 | 21 rows, due `2026-08-01 00:00:00` Manila |
| Medium → `interval_days` 3 | 19 rows, due `2026-08-03 00:00:00` Manila |
| Easy → `interval_days` 7 | 28 rows, due `2026-08-07 00:00:00` Manila |
| Logs missing `concept_id` | 1 — the pre-rework legacy row only |

Rated 31 July: Hard → 1 Aug, Medium → 3 Aug, Easy → 7 Aug, **all at exactly midnight Manila.**
Intervals, day boundaries and concept linkage confirmed end to end in production data.

---

## 14. What was removed

| Removed | Reason |
|---|---|
| `CreateFlashcardsModal.tsx` | The bulk card editor. Students do not author cards. |
| `POST/PUT/DELETE …/decks/:deckId/flashcards` and `…/flashcards/bulk` | Card authoring endpoints. Hiding the buttons would have left them callable. |
| `POST /api/materials/generate-flashcards` | Returned JSON to the browser to save, rewrote vetted definitions, truncated at 4096 tokens, and lost concept linkage. |
| `generateFlashcardsFromConcepts()`, `GeneratedFlashcard`, `FlashcardGenerationResult` | Only that route used them. `ConceptInput` **stays** — the game helpers use it. |
| `GET /api/flashcards/due/:spaceId` | Unused, and returned any space's cards to any logged-in user. |
| Public/Private deck toggle, `spaceIsPublic`, `onToggleDeckVisibility` | No such column exists; the field was silently dropped server-side and the button was permanently disabled. |
| `readOnly` prop, `courseConnected` prop (from this tab) | Hardcoded constants gating unreachable branches. |
| `CreateFlashcardSchema` | Card authoring validation. `CreateDeckSchema` and `UpdateDeckSchema` remain — decks are still student-owned. |

---

## 15. Handoff: wiring BKT

The rating endpoint is now the right place. Everything BKT needs is in place:

- **Ownership is enforced** — mastery cannot be written against another student's concepts.
- **`concept_id` is on both the card and the log row** — no extra join.
- **The due check already gates what counts** — hook BKT inside the `counted: true` branch of
  `POST /api/flashcards/rate` and retries, practice and cramming are excluded for free.

Settled inputs, already seeded in `bkt_params`:

| Rating | Observation | P(G) |
|---|---|---|
| Easy | 1 (correct) | `g_easy = 0.05` |
| Medium | 1 (correct) | `g_medium = 0.25` |
| Hard | 0 (incorrect) | `g_hard = 0.10` |

Plus `p_l0 = 0.10`, `p_t = 0.20`, `p_s = 0.15`. `bkt_update_logs` already carries a `flashcard_id`
column and a `'flashcard'` value in the `bkt_source` enum, waiting.

**Do not** add a second mastery writer elsewhere, and **do not** relax the due check to "log every
rating" — that is the whole protection.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **Concept** | An educator-vetted term + definition extracted from a material. The unit of mastery. |
| **Deck** | A student's folder. Organisational only; holds cards from one or more materials. |
| **Due** | `next_review_at <= now()`. The only condition under which a rating counts. |
| **Practice round** | A session over cards that are not due. Ratings are sent, the server ignores them. |
| **Counted** | Server's answer for whether a rating actually moved the schedule. |
| **Session Score** | `(easy + medium × 0.5) / cards` for one session. **Not** BKT mastery. |
| **Reconcile** | Refresh strategy that updates/inserts/deletes by `concept_id` instead of wiping, to preserve rating history. |
| **Fallback** | A question-format card that shows the term because the model skipped that concept. |
