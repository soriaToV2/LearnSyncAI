# Streaks & Badges (As Built)

**Writer implemented 19 August 2026. Celebration modal added 20 August 2026.**

This is the full reference for `activity_logs`, `gamification_profiles`, `user_badges`, the badge
catalogue, and the badge-earned modal. `CLAUDE.md` carries the short "must not be broken" rules; this
carries the reasoning, the measurements and the debugging playbook behind them.

**Scope — this is NOT the whole PlayMe module.** "Gamification" in this project (ARCHITECTURE.md §9,
`schema.sql` §12) covers the three games as well, and those have their own artifact:

| Half | Artifact |
|---|---|
| Crossword / Term Matching / Timed Trivia, BKT difficulty calibration | `GAMES_CALIBRATION_IMPLEMENTATION.md` |
| **Activity logging, day streaks, badges, the earned modal** | **this file** |

They meet in exactly two places: finishing a game logs a `game` activity (§4.2, site 8), and that
activity can award `first_game` / `flawless_game` (§5.1). Nothing else is shared.

---

## 0. TL;DR for the next agent

| Question | Answer |
|---|---|
| What actually changed in the database schema? | **Nothing.** No new tables, columns or enum values. Every table already existed. |
| So what was missing? | **A writer.** Nothing had ever inserted into `activity_logs`, so the streak trigger had never once fired. |
| Where is the writer? | `server/lib/activity.ts` — `logActivity()`, 9 call sites |
| Where are the badge rules? | `server/lib/badges.ts` — `BADGES` catalogue + `evaluateBadges()` |
| Is there a `badges` table? | **No, deliberately.** The catalogue is a code constant. |
| How does the student find out? | A modal, driven by `src/context/BadgeContext.tsx`, which **diffs** rather than being told |
| ⚠️ Outstanding action | **Migration `20260819120023` is NOT applied.** See §10. |

---

## 1. Why this exists

The paper (p. 65) names four things for the student dashboard: mastery curves, study hours, daily
streaks and earned badges. Only the mastery curve had ever had data behind it.

**The database half had been complete and dormant since migration 0005 (23 July 2026).** All of this
existed, correct, and had never moved:

| Object | State before 19 Aug 2026 |
|---|---|
| `activity_logs` + Manila-day index | 30 rows, all from 0005's one-off backfill, newest `2026-07-17` |
| `gamification_profiles` | `day_streak` 0 for everyone except one stale row |
| `trigger_update_streak` | correct calendar-day logic, **never once fired** |
| `user_badges` | completely empty |
| `GET /api/gamification/profile` | served, always returned zeros |
| `GET /api/gamification/badges` | served, always returned `[]` |
| `GamesLayout.tsx` streak chip | rendered `0 Days Streak` since the day it was written |

`CLAUDE.md` had recorded the correct diagnosis for months:

> Streaks, badges and study hours are OUT, and must not be added back without a writer… the missing
> piece is a writer, not a widget.

**So this work is the writer, a badge catalogue, an evaluator, two dashboard cards and a modal.
It is not a streak system — that was already there.**

### What the paper asks for

| Page | Text | Status |
|---|---|---|
| p. 65 | dashboard shows "study hours, daily streaks and earned badges" | streaks ✅ badges ✅ **hours deliberately not displayed** (§7) |
| ARCHITECTURE §9 | "Day Streaks: Consecutive days a student has engaged with any study activity" | ✅ |
| ARCHITECTURE §9 | "Badges are awarded based on milestone achievements, evaluated by backend cron jobs **or trigger-based endpoint checks**" | ✅ the second option — synchronous, no cron |
| ARCHITECTURE §9 | example: "A student achieving a 5-day streak on flashcards earns a Flashcard Streak badge" | ✅ `streak_5` |

---

## 2. Invariants — break these and the feature is wrong

1. **`server/lib/activity.ts` is the ONLY writer for `activity_logs`.** Nothing else may insert.
2. **`logActivity()` NEVER THROWS.** It swallows and logs. A missing streak day must never cost a
   student a score.
3. **`user_badges.badge_name` IS THE IDENTITY. NEVER RENAME A BADGE.** See §5.3.
4. **There is no `badges` table and must not be one.** See §5.2.
5. **Badges are awarded off `longest_streak`, never `day_streak`.** See §5.4.
6. **`total_study_hours` is written but never displayed.** See §7.
7. **Mastery badges may only trigger on `flashcard` and `adaptive_test`** — the two modes paper p. 58
   permits to move mastery.
8. **The badge modal's baseline is seeded on mount and celebrates nothing.** See §8.2.
9. **Nothing here writes `bkt_mastery`.** Gamification reads mastery; it never moves it.

---

## 3. Architecture — the whole chain

```
Student finishes something
   │
   ├─ route handler does its real work (rate a card, complete a test, …)
   │
   └─ logActivity({ studentId, type, spaceId, materialId, durationMs, outcome })
        │
        ├─ INSERT INTO activity_logs                      ← ONE row. This is the whole mechanism.
        │     │
        │     └─ trigger_update_streak (AFTER INSERT, SECURITY DEFINER, same txn)
        │           ├─ day_streak / longest_streak / last_active_on   (Asia/Manila calendar days)
        │           └─ total_study_hours += duration_ms / 3600000
        │
        └─ evaluateBadges({ studentId, type, outcome })
              ├─ SELECT badge_name FROM user_badges       ← 1 indexed read, ALWAYS
              ├─ filter: (not held) ∧ (triggered by this activity type)
              ├─ if empty → RETURN                        ← steady state, 0 further queries
              ├─ gather evidence (≤3 reads, only what survived)
              └─ INSERT … ON CONFLICT DO NOTHING → returns what landed

                                 ── later, client side ──

Client checkpoint (results screen, submit, game end, chat turn)
   └─ celebrate()  [src/context/BadgeContext.tsx]
        ├─ wait 600ms                                      ← lets a write land AND a screen settle
        ├─ GET /api/gamification/badges
        ├─ diff against the in-memory baseline
        └─ BadgeEarnedModal — confetti, medallion pop, halo
```

**The trigger has already run by the time the insert resolves** (`AFTER INSERT`, same transaction), so
reading `longest_streak` immediately afterwards is correct. It looks racy and is not. This is why
`evaluateBadges()` can be called on the line after the insert without a re-read.

---

## 4. The writer — `server/lib/activity.ts` (93 lines)

### 4.1 Why it never throws

This is **deliberately unlike** `applyFlashcardRating()` / `bktProblems()` sitting next to it, which
throw and are caught individually at each of their two call sites.

| | BKT engine | `logActivity()` |
|---|---|---|
| Call sites | 2 | **9** |
| Return value consumed? | Yes — `bktProblems()` is inspected | No — every caller ignores it |
| Diagnostic value of a failure | High | Low |
| Therefore | throws, caller catches | **swallows, logs to `console.error`** |

Nine chances to forget a `try/catch` is a larger risk than losing the ability to catch. The response
the student is waiting for is never affected.

### 4.2 The nine call sites

| # | File:line | Type | `durationMs` | `outcome` |
|---|---|---|---|---|
| 1 | `flashcards.routes.ts:106` | `flashcard` | 0 | — |
| 2 | `flashcards.routes.ts:220` | `flashcard` | 0 | — |
| 3 | `practice.routes.ts:924` | `adaptive_test` | `result.elapsed_ms` | `{ score }` |
| 4 | `cognitive.routes.ts:533` | `free_recall` | 0 | — |
| 5 | `cognitive.routes.ts:875` | `free_recall` | 0 | — |
| 6 | `cognitive.routes.ts:1266` | `feynman` | 0 | — |
| 7 | `cognitive.routes.ts:1464` | `feynman` | 0 | — |
| 8 | `gamification.routes.ts:131` | `game` | `time_spent_ms` | `{ accuracy }` |
| 9 | `chat.routes.ts:422` | `chat` | 0 | — |

**Sites 1 and 2 are both flashcards on purpose.** Site 1 is the **not-due practice branch**; site 2 is
the counted branch. Sites 4/6 are **memo-hit** paths; 5/7 are fresh evaluations.

### 4.3 ⚠️ The three exclusions — these matter more than the inclusions

| Path | Writes a log row? | Logs activity? | Why not |
|---|---|---|---|
| Flashcard **compare-and-swap loser** (`flashcards.routes.ts`, the `!rescheduled` branch) | no | **NO** | A duplicate request, not a second study event. A double-tap must count once. |
| **Off-topic chat refusal** (`chat.routes.ts:295`) | yes, `chatbot_logs` | **NO** | The assistant declined to answer. Nothing was studied. |
| `PUT /complete` that does not flip the status | no | **NO** | The existing compare-and-swap already makes completion idempotent. |

**Verified by test, not by reading:** the acceptance run drove an off-topic chat turn and watched the
chat activity count stay at 1 → 1, and drove a double-tapped rating and a second `PUT /complete`.

### 4.4 ⚠️ Two inclusions that look wrong and are not

**The not-due flashcard branch MUST log.** With 7-day Easy intervals, a student who cleared their deck
yesterday has *nothing due today*. If only counted ratings logged activity, that student would break
their streak **for using spaced repetition correctly** — the exact opposite of what a streak rewards.

**Both cognitive memo-hit paths MUST log.** `findMemoisedAttempt()` answers a byte-identical
resubmission from the stored row, skipping the model calls. But `CLAUDE.md` is explicit that *"a memo
hit still writes a `cognitive_logs` row — a resubmission is a real attempt and must appear in the
student's history exactly as before."* Only the model calls are skipped, not the fact that the student
sat down and did the work.

### 4.5 `durationMs` and why 0 is the honest value

Only two activities carry a real duration:

- **Game** — `time_spent_ms`, reported by the client
- **Adaptive test** — `result.elapsed_ms`, the sum of per-question latencies

**⚠️ NOT `completed_at − created_at` for the test.** That would bill a test opened before dinner and
finished after it as three hours of study.

Flashcard ratings, both cognitive modes and chat **measure nothing**, and get 0. Inventing a plausible
figure for them would make `total_study_hours` a number that looks real and is not — which is exactly
the failure the frozen `day_streak` represented before this work.

`Math.max(0, Math.round(...))` guards the column's `CHECK (duration_ms >= 0)`: a negative delta from
clock skew would fail the write and take the streak day with it.

---

## 5. The badge catalogue — `server/lib/badges.ts` (413 lines)

### 5.1 The 14 badges

| `name` | Label | Rule | Family | Triggers |
|---|---|---|---|---|
| `streak_3` | Getting Started | `longest_streak ≥ 3` | streak | any |
| `streak_5` | On a Roll | `longest_streak ≥ 5` | streak | any |
| `streak_7` | Week Warrior | `longest_streak ≥ 7` | streak | any |
| `first_flashcard` | First Review | this activity happened | first | `flashcard` |
| `first_test` | First Test | " | first | `adaptive_test` |
| `first_recall` | First Recall | " | first | `free_recall` |
| `first_feynman` | First Explanation | " | first | `feynman` |
| `first_game` | First Game | " | first | `game` |
| `mastery_1` | First Mastery | `count(bkt_mastery ≥ 0.85) ≥ 1` | mastery | `flashcard`, `adaptive_test` |
| `mastery_10` | Ten Mastered | `… ≥ 10` | mastery | `flashcard`, `adaptive_test` |
| `mastery_25` | Twenty-Five Mastered | `… ≥ 25` | mastery | `flashcard`, `adaptive_test` |
| `perfect_test` | Perfect Score | `outcome.score === 1` | performance | `adaptive_test` |
| `flawless_game` | Flawless | `outcome.accuracy === 1` | performance | `game` |
| `cards_100` | Century | `count(activity_logs WHERE type='flashcard') ≥ 100` | performance | `flashcard` |

**`chat` deliberately has no first-time badge.** It counts toward a streak — the `activity_type` enum
committed to that, and a student whose only session that day was the chatbot should not lose their run
— but it is by far the cheapest activity to farm.

### 5.2 ⚠️ Why there is NO `badges` table

`user_badges.badge_name` is bare `TEXT` by deliberate schema choice. The catalogue is a code constant.

- A table nobody can edit is a constant with extra steps.
- Building an editor for it would repeat the **`educator_assignments` mistake** — built, then removed
  as going beyond the specification (`databaseSchemaExplained.md:309`).
- `UNIQUE (student_id, badge_name)` is what makes awarding idempotent, so the module never needs a
  read-then-write lock.

### 5.3 ⚠️ `name` IS THE DATABASE IDENTITY. NEVER RENAME ONE.

The string is written into `user_badges`. Renaming `streak_3` → `streak_three` does **not** migrate
anyone. It:

1. silently re-awards the badge, under a second name, to everyone who already held the first, and
2. orphans the old rows, which the client can no longer label.

`label` and `description` are free to change. `name` is not. This is the single most destructive
possible edit to this feature.

### 5.4 ⚠️ Why `longest_streak`, not `day_streak`

Thresholds **stack and are permanent**: reaching 7 days leaves all three held, and breaking a streak
never removes one.

Reading `day_streak` would be *behaviourally equivalent today* — badge rows are never deleted — but it
would let a student see "Week Warrior" beside a current streak of 1 with no way to tell which was
lying. `longest_streak` is the fact the badge actually asserts.

### 5.5 Thresholds are sized to the study

**3 / 5 / 7 days**, for a ~2-week study. **14 was considered and dropped**: within a fortnight it is
unreachable, and an unearnable badge renders as a permanently grey tile that reads as a broken
feature. `STREAK_THRESHOLDS` is the one edit if the study lengthens.

### 5.6 ⚠️ EVALUATION ORDER IS WHAT KEEPS THIS CHEAP

**This runs after every single flashcard rating — thirty per deck in a normal session.**

```
1. SELECT badge_name FROM user_badges WHERE student_id = X    ← 1 indexed read, always
2. candidates = BADGES.filter(not held ∧ triggered by this type)
3. if candidates.length === 0 → RETURN                        ← ZERO further queries
4. gather evidence — at most 3 reads, only what step 2 left needing
5. INSERT … ON CONFLICT DO NOTHING, .select() what landed
```

Step 3 is the steady state. Once a student holds the badges reachable from an activity, that activity
costs **exactly one indexed lookup forever after**, and every COUNT-based rule stops running the moment
its badge is earned.

**Measured: ~260ms per saturated activity** (five consecutive chat activities in 1311ms).

**⚠️ DO NOT ADD A RULE THAT QUERIES BEFORE THE HELD-SET FILTER.** That would turn a free steady state
into a per-rating cost.

### 5.7 `cards_100` counts `activity_logs`, not `spaced_repetition_logs`

`spaced_repetition_logs` gets **no row** for a practice rating on an un-due card, so the two tables
disagree about what "reviewed" means — and the streak the student is looking at is built from
`activity_logs`. One uniform source for every "N times" rule.

### 5.8 The one gameable badge

**`flawless_game` reads `accuracy` from the request body.** The game runs in the browser, so the
browser reports the score; `CreateGameSessionSchema` accepts it. A determined student could POST
`accuracy: 1`.

Every other badge is computed server-side from data the client cannot touch (`perfect_test` uses
`buildResult()`'s own `correct / total`; mastery badges read `bkt_mastery`; streaks read the trigger's
output). **Recorded, not fixed** — it is a badge, not a grade, and the alternative is server-side game
state, which no game currently has.

---

## 6. The celebration modal (added 20 August 2026)

### 6.1 ⚠️ The client DIFFS; it is not told

`src/context/BadgeContext.tsx` re-reads `GET /api/gamification/badges` and compares against what the
session has already seen.

**The obvious alternative — each write endpoint returning the badges its action awarded — was designed
and rejected.** Two things in this codebase rule it out:

1. **`FlashcardStudyView` does not await the rating.** It posts and advances the card immediately, by
   design, so a slow network never stalls a session. A badge arriving on that response would open a
   modal over whatever card the student had already moved on to.
2. **`chat.routes.ts` calls `logActivity()` AFTER `res.end()`.** The SSE stream is already closed, so
   it has nowhere to put the answer. A student keeping a streak alive through the chatbot would be the
   one person the feature silently skipped.

Diffing also meant **zero changes to the nine write paths** already verified by the acceptance harness.

**Cost:** one small indexed query per checkpoint, ~6 per session, never per flashcard.

### 6.2 ⚠️ The baseline is seeded on mount and celebrates NOTHING

The provider's mount effect fetches once and records what the student already holds, **without opening
the modal**. Without this, every student holding badges already is ambushed on their next login.

**In-memory, not `localStorage`, deliberately.** A reload re-seeds, so nothing is ever celebrated
twice. The gap that leaves — a badge earned by the very last action before the tab closes is never
popped — is accepted: it is still on the dashboard. Persisting to `localStorage` would close that gap
and open a worse one: **clearing site data would replay every badge the student has ever earned.**

### 6.3 The 600ms delay is BEFORE the fetch, and does two jobs

1. Lets a results screen finish its own entrance rather than being covered as it renders.
2. **Gives an in-flight write time to land.** Because the flashcard rating POST is not awaited, at the
   instant a session ends the last rating — the one most likely to have crossed a threshold — may
   still be on the wire. Fetching immediately would read the badge list from *before* the badge
   existed.

**Not made into a guarantee.** A poll loop would cost every student requests on every session to catch
a case whose failure mode is "the badge appears on the dashboard instead".

### 6.4 The six checkpoints

| File:line | Fires when |
|---|---|
| `FlashcardStudyView.tsx:214` | `isFinished` flips true (a `useEffect`, so Restart re-arms it) |
| `AdaptiveTestTab.tsx:239` | inside `onFinish` |
| `FreeRecallTab.tsx:280` | after a successful submission |
| `FeynmanTab.tsx:292` | after a successful submission |
| `gameUi.tsx:714` | after `POST /gamification/session` **resolves** |
| `ResourcesTab.tsx:370` | after a chat turn streams successfully (NOT in `finally`) |

**⚠️ `AdaptiveTestTab` fires in `onFinish`, NOT on the results screen.** `openSummary()` also reaches
that screen when a student opens a **past** test, and re-celebrating a badge every time they review an
old score would be nonsense. `onFinish` also runs only after `PUT /complete` resolved, which is the
point the badge has certainly been written.

**⚠️ `ResourcesTab` fires on the success path only, never in `finally`.** A failed turn writes no
`chatbot_logs` row and logs no activity.

**⚠️ The flashcard check is at the END of the session, not per rating.** Per-card would be thirty
requests to answer a question that only changes at the end — and would pop a modal mid-session.

### 6.5 UI decisions

| Decision | Choice | Why |
|---|---|---|
| Several badges at once | **ONE modal listing all** | Finishing a game on a 3-day streak awards three; a queue of dialogs turns a reward into a chore, and a fast-clicking student never reads the third. |
| Sound | **Silent** | `play('victory')` and a mute toggle exist in `gameAudio.ts` and are unused here. This modal appears anywhere in the portal; an unexpected fanfare in a classroom is startling. The games are opt-in and self-contained. |
| Dismissal | **Manual only** — button, Escape, backdrop | The student earned it; they decide when they are done looking. All three routes are one `onClose`, free from `Modal`. |
| Unearned badges | **Never shown** | A greyed rail needs criteria text beside each, and on a two-week study a wall of locked tiles reads as a list of things you failed to do. |

### 6.6 `ConfettiBurst` moved, and why

Lifted from `games/gameUi.tsx` to **`src/components/ui/ConfettiBurst.tsx`**; `gameUi.tsx` re-exports
it so its three usages are unchanged.

**It could not stay there: `gameUi.tsx` imports `MOCK_COURSES`**, so a globally mounted consumer would
drag the last mock data in the tree into the student portal bundle. Same lift `surfaces.ts` got out of
`cognitiveShared.tsx` and `reviewSchedule.ts` got out of `FlashcardsTab`.

**⚠️ A re-export does not bind the name locally.** `gameUi.tsx` must `import` it as well as
`export { ConfettiBurst }`, or its own line 403 usage fails to compile. This was hit during the build.

**⚠️ `gameUi.tsx` already had a `celebrate`** — a boolean prop gating the game's own confetti — so the
hook is aliased there to `celebrateBadges`. The scopes do not overlap and it compiles either way; two
unrelated meanings under one name in one module is the hazard.

### 6.7 Animations

Both in `src/index.css`, beside the existing game animations:

| Class | Effect |
|---|---|
| `.animate-badge-pop` | Medallion scales from 0.4 with overshoot to 1.12 and settles; rotation unwinds on the same curve. `both` fill is required — staggered medallions would otherwise render full-size before their turn and jump. |
| `.animate-badge-glow` | Radial halo, scale 0.6 → 1.8, two pulses then rest. Colour from `--badge-glow`, set inline from `badgeStyle().glow`, so it is never hardcoded per family. |

**⚠️ BOTH ARE IN THE `prefers-reduced-motion` BLOCK.** A celebration is exactly the motion that block
exists for. The modal still opens and still names the badge; the halo is `display: none` there rather
than un-animated, because a static halo is a coloured smudge.

---

## 7. ⚠️ Study hours: written, deliberately NOT displayed

`total_study_hours` accumulates correctly. **No screen prints it, and none should until something
measures time.**

Only games and adaptive tests contribute a real duration. Flashcards, both cognitive modes and chat
report 0. So the figure is a **partial sum that would read as a total** — the same failure as the
frozen `day_streak` that kept streaks off the dashboard for months.

- `GET /api/dashboard` deliberately does not serialise it.
- `GET /api/gamification/profile` returns it (the column exists and that is the profile endpoint) but
  no client reads it.

**The missing piece is real timing, not a widget.** Adding it means instrumenting five study surfaces
client-side, and self-reported client time is gameable — a tab left open overnight becomes 8 hours.

**Also deliberately absent:** no weekly activity chart, no heatmap. Both became buildable the moment
`activity_logs` gained a writer, and both stay rejected — over a two-week study with a handful of
attempts, an honest heatmap renders as an accusation.

---

## 8. Data model reference

### 8.1 `activity_logs` (schema 0005, unchanged)

```sql
id            UUID PK
student_id    UUID NOT NULL → profiles(id) ON DELETE CASCADE
activity_type activity_type NOT NULL     -- flashcard|free_recall|feynman|adaptive_test|game|chat
space_id      UUID → study_spaces(id) ON DELETE SET NULL
material_id   UUID → materials(id)     ON DELETE SET NULL
duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0)
occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()

INDEX (student_id, ((occurred_at AT TIME ZONE 'Asia/Manila')::date))
```

**The Manila index is why the timezone is baked in.** A bare `occurred_at::date` depends on the session
`TimeZone`, making it only `STABLE` and therefore unindexable — and under UTC an early-morning session
in the Philippines lands on the previous day.

### 8.2 `trigger_update_streak` — the streak logic in full

```
v_day := (NEW.occurred_at AT TIME ZONE 'Asia/Manila')::date

IF last_active_on IS NULL OR v_day > last_active_on THEN
    day_streak := (last_active_on IS NOT NULL AND v_day = last_active_on + 1)
                    ? day_streak + 1     -- consecutive day, extend
                    : 1                  -- gap or first ever, restart
    longest_streak := greatest(longest_streak, day_streak)
    last_active_on := v_day
END IF
-- repeat activity on a day already counted changes nothing

total_study_hours += NEW.duration_ms / 3600000.0    -- unconditional
```

**⚠️ IT IS CALENDAR-DAY SUCCESSION, NOT A 48-HOUR CLOCK.** `ARCHITECTURE.md` claimed the 48-hour rule
until 20 Aug 2026 and was **wrong**; migration 0005 replaced that logic and `schema.sql:682` has said
so on the column comment ever since. **The doc was corrected, not the code.**

### 8.3 `gamification_profiles` / `user_badges`

```sql
gamification_profiles (
  student_id PK → profiles ON DELETE CASCADE,
  day_streak INT NOT NULL DEFAULT 0,
  longest_streak INT NOT NULL DEFAULT 0,
  total_study_hours NUMERIC NOT NULL DEFAULT 0,
  last_active_on DATE                       -- Asia/Manila calendar date
)

user_badges (
  id PK, student_id → profiles ON DELETE CASCADE,
  badge_name TEXT NOT NULL,                 -- catalogue key, see §5.3
  awarded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, badge_name)           -- makes awarding idempotent
)
```

`handle_new_user()` creates a `gamification_profiles` row for every student, so the trigger's
defensive `INSERT … ON CONFLICT DO NOTHING` is belt-and-braces.

### 8.4 API shapes

```
GET /api/dashboard  →  data.gamification = {
  day_streak, longest_streak, last_active_on, badges: [{ name, awarded_at }]
}                                             ← NO total_study_hours

GET /api/gamification/badges  →  data = [{ name, awarded_at }]
GET /api/gamification/profile →  data = { student_id, day_streak, longest_streak,
                                          total_study_hours, last_active_on }
```

**`GET /badges` was normalised on 20 Aug** from `select('*')` (which returned `badge_name`) to
`{ name, awarded_at }`, matching the dashboard. It had zero consumers at the time, so nothing broke.

**`GET /profile` no longer INSERTs on a GET.** It used to create the row when missing. A GET that
writes is a trap for the next caller, and `GET /api/dashboard` is now a second reader of the same
table under a documented read-only-permanently rule.

**The dashboard's two SELECTs are hoisted into the step-1 batch**, alongside identity and spaces —
**not** with the other history reads. That is load-bearing: it makes them survive **both** early
returns, so a student whose educator archived every material still sees the streak they earned instead
of a zero.

---

## 9. Security

### 9.1 ⚠️ Migration 0023 drops the `activity_logs` student INSERT policy

`schema.sql` states, eleven lines above the policies:

> Mastery is deliberately read-only for students: `bkt_mastery`, `bkt_update_logs`,
> `gamification_profiles` and `user_badges` have no student INSERT/UPDATE policy, so a student holding
> an anon key cannot inflate their own scores.

**`activity_logs` had `INSERT WITH CHECK (student_id = auth.uid())`, contradicting it.** Because
`update_study_streak()` is `SECURITY DEFINER` and fires on any insert, an anon-key insert moved
`day_streak`, `longest_streak` **and** `total_study_hours` directly.

Harmless while nothing read those numbers. **A live fabrication route the moment a dashboard printed
them.** Express writes with the service role, which bypasses RLS entirely, so dropping the policy costs
the application nothing.

**DO NOT ADD IT BACK.**

### 9.2 What is client-supplied and what is not

| Value | Source | Trustworthy? |
|---|---|---|
| `activity_type`, `student_id`, `space_id`, `material_id` | server, from the owner-checked row | ✅ |
| `score` (perfect_test) | `buildResult()` — `correct / total` | ✅ |
| mastery counts | `bkt_mastery` | ✅ |
| streak | DB trigger | ✅ |
| `time_spent_ms` (game) | **client** | ⚠️ only feeds undisplayed hours |
| `accuracy` (flawless_game) | **client** | ⚠️ see §5.8 |

---

## 10. ⚠️ OUTSTANDING: the migration is NOT applied

**Verified against the live database on 20 Aug 2026** — `pg_policies` still returns
`Students append to their own activity log`.

```
supabase/migrations/20260819120023_gamification_writers.sql   ← written, NOT run
```

It does two things:

1. `DROP POLICY "Students append to their own activity log" ON activity_logs` — §9.1
2. Re-syncs `gamification_profiles` from `activity_logs` via 0005's gaps-and-islands query. **Verified
   a no-op on current data** — the 0005 backfill already computed it correctly. A safety net.

**Apply it by pasting into the Supabase SQL editor.** There is no migration runner in this repo, and
PostgREST cannot execute DDL.

**The feature works correctly without it.** The migration closes a security hole; it does not enable
anything.

---

## 11. Verification evidence

### 11.1 Acceptance harnesses (19 Aug 2026) — 80 checks, 0 failures

All against throwaway students, deleted afterwards; all 13 tables CASCADE from `profiles`, and
teardown was confirmed by comparing table counts to a pre-run baseline. **The real student's data was
byte-identical before and after** (`activity_logs` 30 → 30, `user_badges` 0 → 0, profile unchanged).

| Harness | Checks | Covers |
|---|---|---|
| Part A — direct, no API calls | 30 | streak succession via backdated `occurred_at`, same-day no-op, threshold crossing, idempotency, mastery counting at 0.85, negative-duration guard, steady-state cost |
| Part B — real HTTP | 30 | both flashcard branches, chat, game, dashboard, auth gates, **the off-topic exclusion (1 → 1)**, double-tap counting once |
| Part C — real HTTP + Gemini | 20 | both Free Recall paths, both Feynman paths, test completion + re-completion idempotency |

Selected results worth keeping:

```
PASS  same day again does NOT extend — 3 -> 3
PASS  streak_5 lands once the run reaches 5 — longest=5
PASS  streak_3 still held after the run grows
PASS  PRACTICE rating also logs activity — 1 -> 2
PASS  CAS-loser branch contains no logActivity call
PASS  MEMO path also logs activity — 1 -> 2
PASS  re-completion logs NOTHING (compare-and-swap holds) — 1 -> 1
PASS  GET /api/dashboard wrote nothing
PASS  total_study_hours is NOT serialised
      five chat activities in 1311ms (all reachable badges held)
```

### 11.2 Modal round-trip (20 Aug 2026) — 8 checks, 0 failures

```
PASS  a fresh student baselines to an empty set
PASS  the diff finds exactly one new badge — first_flashcard
PASS  no badge is celebrated twice — 1 held, 0 new
PASS  three new badges arrive in one diff — streak_3, first_game, flawless_game
```

Endpoint shape confirmed: `{"name":"first_recall","awarded_at":"…"}` — no `badge_name`.

### 11.3 ✅ Live on the real account (20 Aug 2026)

`angelo.soria`, grade 9 — real use, not a harness:

```
activity_logs:   flashcard × 28  (duration 0)
                 game      ×  2  (33,289 ms)
gamification:    day_streak 1, longest_streak 1, last_active_on 2026-08-20
                 total_study_hours 0.0092
badges:          first_flashcard  01:24:03
                 first_game       01:25:11
                 flawless_game    01:26:41
```

Two things this confirms that no harness did:

- **Duration arithmetic is exact.** 33,289 ms ÷ 3,600,000 = 0.009247 h → **0.0092** stored. Only the
  two games contributed; 28 flashcard rows added zero.
- **The "already held" path works in the real UI.** `flawless_game` landed 90 seconds after
  `first_game`, i.e. on a *second* game played at 100% — and that modal correctly showed only
  `flawless_game`, because `first_game` was already held.

### 11.4 Regression

`npm run lint` (`tsc --noEmit`) ✅ · `npx vite build` ✅ · `npx tsx scripts/bkt-verify.ts` →
**ICR 165/165 = 100.0%** ✅ · 11 `router.use(...)` auth gates unchanged ✅

---

## 12. Debugging playbook

### "The streak is not moving"

```sql
-- 1. Is anything being written at all?
SELECT activity_type, count(*), max(occurred_at)
FROM activity_logs WHERE student_id = '<uuid>' GROUP BY 1;

-- 2. What does the trigger think?
SELECT day_streak, longest_streak, last_active_on, total_study_hours
FROM gamification_profiles WHERE student_id = '<uuid>';

-- 3. Which Manila days are actually covered?
SELECT DISTINCT (occurred_at AT TIME ZONE 'Asia/Manila')::date AS manila_day
FROM activity_logs WHERE student_id = '<uuid>' ORDER BY 1;

-- 4. Is the trigger even attached?
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'activity_logs'::regclass;
```

- **Rows exist but streak is 0** → the trigger is missing or disabled (query 4).
- **Streak is 1 and will not grow** → check query 3. Days must be *consecutive*; a gap restarts at 1.
  This is correct behaviour, not a bug.
- **No rows at all** → the route is not calling `logActivity()`, or it is failing silently. Grep the
  server log for `[Activity]`.

### "A badge did not appear"

```sql
SELECT badge_name, awarded_at FROM user_badges WHERE student_id = '<uuid>' ORDER BY awarded_at;
SELECT count(*) FROM bkt_mastery WHERE student_id = '<uuid>' AND latent_mastery >= 0.85;
SELECT count(*) FROM activity_logs WHERE student_id = '<uuid>' AND activity_type = 'flashcard';
```

Check in order:
1. **Is the row in `user_badges`?** If yes, the server worked and this is a UI problem → §6.
2. **Does the activity type trigger that badge?** A game cannot award `mastery_*`. See §5.1.
3. **Is the threshold actually met?** Streaks read `longest_streak`, not `day_streak`.
4. Grep the server log for `[Badges]`.

### "The modal did not pop but the badge exists"

1. **Was the badge earned before the page loaded?** The baseline is seeded on mount — by design, a
   badge already held when the portal opened is never celebrated. Reload and earn a new one.
2. **Did a checkpoint fire?** Only the six in §6.4. Chat fires only on a *successful* turn.
3. **Was it the last action before the tab closed?** Known, accepted gap — §6.2.
4. `GET /api/gamification/badges` in the network tab: does it return `{ name, … }`?

### Forcing a state for testing

```sql
-- Fake a 7-day streak (badges read longest_streak)
UPDATE gamification_profiles SET longest_streak = 7 WHERE student_id = '<uuid>';
-- …then perform any activity; streak_3/5/7 all land at once.

-- Re-arm a badge so the modal can be seen again
DELETE FROM user_badges WHERE student_id = '<uuid>' AND badge_name = 'first_game';

-- Backdate activity to build a real multi-day streak
INSERT INTO activity_logs (student_id, activity_type, occurred_at)
VALUES ('<uuid>', 'flashcard', (now() - interval '2 days')::date + time '04:00');
```

⚠️ Backdated rows drive the trigger in **insertion order**, not date order — insert oldest first.

---

## 13. File map

**New (server):**

| File | Lines | Role |
|---|---|---|
| `server/lib/activity.ts` | 93 | the only `activity_logs` writer |
| `server/lib/badges.ts` | 413 | catalogue + evaluator |

**New (client):**

| File | Lines | Role |
|---|---|---|
| `src/lib/badges.ts` | 185 | presentation only — label, description, icon, colours, glow |
| `src/context/BadgeContext.tsx` | 148 | diff provider + `celebrate()` |
| `src/components/student/BadgeEarnedModal.tsx` | 131 | the modal |
| `src/components/ui/ConfettiBurst.tsx` | 66 | lifted from `gameUi.tsx` |

**New (db):** `supabase/migrations/20260819120023_gamification_writers.sql` (86) — **not yet applied**

**Edited:** `schema.sql` · six route files · `src/lib/dashboard.ts` · `StudentDashboard.tsx` ·
`StudentLayout.tsx` · `src/index.css` · five checkpoint components · `gamesData.ts` (mock `BADGES`
deleted — four hardcoded tiles, three `earned: true` for everyone, zero consumers)

**Untouched:** `server/lib/bkt.ts` and all BKT arithmetic · every auth gate · the educator and admin
portals · `GamesLayout.tsx` (its streak chip started working with no change)

---

## 14. Deliberately not built

| Not built | Why |
|---|---|
| **Study hours display** | §7 — no honest source |
| **Weekly chart / heatmap** | §7 — reads as an accusation on a 2-week study |
| **A `badges` table with admin CRUD** | §5.2 — the `educator_assignments` mistake |
| **A cron badge evaluator** | ARCHITECTURE permits either; synchronous is immediate and idempotent via `UNIQUE` |
| **Badge sound** | §6.5 — the modal appears anywhere; games are opt-in |
| **Auto-dismiss / corner toast** | §6.5 — manual chosen |
| **A dedicated badges page** | A fourth nav item for 14 items |
| **Unearned-badge display** | §6.5 |
| **Notification history** | The dashboard lists every badge held; a read/unread flag needs a new column and a writer |
| **Educator visibility into streaks** | A streak is a motivational signal aimed at its owner; showing a teacher "who studied on the fewest days" turns it into an attendance register |
| **XP / points / levels** | In no scope statement. `gamification_profiles` has no XP column and must not gain one casually |
