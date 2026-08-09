# Games — BKT Difficulty Calibration (As Built)

**Implemented 9 August 2026.** Supersedes the "Not Yet Done" section of
`gamemodesAIgenerationImplementation.md`, which recorded the seam this work filled.

---

## 1. Why this exists

Games were the last feature the paper says consumes mastery, and the only one still ignoring it.
The paper names games four separate times:

| Page | What it says |
|---|---|
| **p. 58 (Scope)** | mastery estimates "dynamically adjust the **question selection and difficulty** of AI-generated educational games, including Crossword, Term Matching, and Timed Trivia" |
| **p. 58 (Limitations)** | games "utilize existing mastery estimates only to personalize question selection, generated content, and difficulty level **without modifying the learner's mastery state**" |
| **p. 67 (Architecture)** | "The Procedural Gamification Engine reads the BKT mastery score to calibrate game difficulty" |
| **p. 83 (Mechanism)** | "the system retrieves the current **M_doc** value from the database and applies it as a **baseline parameter to the generative AI prompt** … to restrict the **vocabulary complexity, clue difficulty, and trivia response timers**" |
| **p. 93 (DFD 5.0)** | "reads the document-level BKT mastery score (M_doc) from D2 to calibrate game difficulty" |
| **p. 98 / p. 99** | Difficulty Alignment is assessed on "educational game content" against **foundational (<0.50) / intermediate (0.50–0.85) / advanced (≥0.85)**; "educational game generation and **difficulty calibration**" is a named student-side black-box test case |

**Before this change none of it was true.** Every game ever generated was `'medium'`, because
`GamesLanding.tsx` omitted `difficulty` and Zod's `.default('medium')` fired. Concepts were picked by
a uniform Fisher-Yates shuffle whose own comment asked for this work. The trivia timer was hardcoded
at 15s. `game_content.mastery_snapshot` and `game_sessions.mastery_snapshot` existed in the schema
with explanatory `COMMENT`s and had never been written by any code.

**The four levers the paper names map to code as:**

| Paper's phrase | Where it lives |
|---|---|
| "question selection" (p. 58) | `pickConceptsByMastery()` |
| "vocabulary complexity" (p. 83) | `CROSSWORD_TIER_RULES.answer`, `MATCH_TIER_RULES.selection` |
| "clue difficulty" (p. 83) | the `clue` / `definition` / `question` + `options` fields |
| "trivia response timers" (p. 83) | `TRIVIA_QUESTION_MS` |

---

## 2. Invariants

1. **Games never write `bkt_mastery` or `bkt_update_logs`.** No `applyGameCompletion`, no import of
   `server/lib/bkt.ts` anywhere under the games path. `bkt_source` stays a two-value enum.
2. **Zero additional model calls.** The only new I/O is one `masteryRows()` read, which feeds both
   EQ(4) and the selection. Groq's 12k tok/min and 100k tok/day budget is untouched.
3. **The client never supplies a difficulty, tier, mastery number or timer.**
4. **`mastery_snapshot` is pre-generation and stays pre-generation.**

---

## 3. Flow

```
GamesLanding "Build & Launch"
  ├─ GET /api/spaces/:id/materials          ┐ one Promise.all, one loading flag
  └─ GET /api/practice/space/:id/mastery    ┘
       └─ preview: M_union = Σ(m_doc·n)/Σn over the SELECTED materials
          "Your mastery across these lessons is 53%, so this game will be
           built at intermediate level."     (only when assessed > 0)

POST /api/games/generate { space_id, material_ids, game_type }     ← no difficulty
   1. Zod                                                        -> 400
   2. requireOwnedSpace                                          -> 404
   3. rejectInaccessibleMaterials                                -> 403
   4. spaceMaterialIds — linked to THIS space                    -> 404
   5. concepts (id, term, definition)                     -> 500 / 422
   6. masterySnapshot() -> { snapshot, byConcept }               ← EQ(4)
   7. masteryTier(snapshot) -> foundational|intermediate|advanced
   8. pickConceptsByMastery(concepts, byConcept, SELECT_BUFFER)  ← p.58 selection
   9. Groq, prompt carrying the tier three ways                  -> 502
  10. INSERT game_content { difficulty: tier, mastery_snapshot: snapshot,
                            payload: { …, settings: { questionMs } } }
  11. 201 { id, payload, difficulty, mastery_snapshot }

Game page → GET /api/games/content/:id → GameCalibration { tier, masterySnapshot, questionMs }
   ├─ GameStage renders ONE tier chip (all three games)
   └─ TimedTriviaGame reads questionMs (20s / 15s / 10s)

Result screen → POST /api/gamification/session { content_id, accuracy, time_spent_ms, detail }
   └─ server copies space_id / material_id / game_type / mastery_snapshot from the content row
```

---

## 4. Files

**New**
- `server/lib/gameDifficulty.ts` — selection, `TRIVIA_QUESTION_MS`, the nine tier cells, `SELECT_BUFFER`
- `server/lib/spaceAccess.ts` — `loadOwnedSpace` / `requireOwnedSpace` / `spaceMaterialIds`
- `supabase/migrations/20260809090020_game_difficulty_tiers.sql`

**Modified** — `server/lib/groq.ts` (the three game prompts), `server/routes/games.routes.ts`,
`server/routes/gamification.routes.ts`, `server/types/{api,database}.ts`, `schema.sql`,
`server/routes/{practice,studyspaces}.routes.ts` (migrated onto `spaceAccess`),
`src/pages/student/games/{gamesData.ts, gameUi.tsx, TimedTriviaGame.tsx, CrosswordGame.tsx,
TermMatchingGame.tsx, GamesLanding.tsx}`

---

## 5. Concept selection — paper p. 58

```ts
selectionWeight(m) = max(1 − (m ?? 0.50), 0.05)
pickConceptsByMastery = Efraimidis–Spirakis A-Res:  key = U^(1/w), take top n
```

### The 0.50 that is not P(L₀)

**An unassessed concept counts as 0.50 here and as P(L₀) = 0.10 inside `documentMastery()`.** The
disagreement is deliberate and is the single most important line in the file.

EQ(4) estimates *what the student knows*, so an unmeasured concept must enter it at the prior.
Selection asks *what is worth practising*, and there the prior is wrong twice over. The BKT
transition step floors every posterior at P(T) = 0.20, so:

| Concept | Stored | Means |
|---|---|---|
| Injection | 0.22 | asked, got it wrong — **genuinely weak** |
| Firewall | 0.10 | **never asked** — the default, not a measurement |

**0.10 < 0.22.** Ranking by raw mastery puts every never-asked concept *above* every concept the
student is measurably failing. On a 57-concept lesson with six assessed, all fourteen trivia slots
fill with never-seen concepts and mastery changes nothing at all. 0.50 is neutral — strictly below
any weak-assessed weight, strictly above any strong one — giving **known weak > unknown > known
strong**.

### Why sampling and not a sort

A deterministic weakest-first sort makes "Play Again" rebuild a byte-identical game from identical
concepts; replay variety is why the shuffle was there. Stratified quotas need a per-game table,
degrade when a stratum is empty, and fix the *composition* when variety is the point. Roulette with
removal has the same distribution but is O(n·N) and mutates.

`WEIGHT_FLOOR = 0.05` keeps a mastered concept reachable (1/16 of a weak one's pull rather than
1/8000) and bounds the exponent at 20 — `0.5^20 ≈ 9.5e-7`, far from denormal. **Raise the floor,
never the exponent.**

`pickConceptsByMastery` is **pure**: it takes the mastery map rather than fetching it, which is what
makes the distribution verifiable with no network and lets one read feed both EQ(4) and selection.

### Measured — 10,000 trials, n = 8 of 20

| Bucket | Weight | Picked |
|---|---|---|
| assessed 0.25 | 0.75 | **62.1%** |
| never assessed | 0.50 | **47.0%** |
| assessed 0.95 | 0.05 | **6.1%** |

Two identical calls return different lists. A short lesson returns everything, but **ordered** — a
behaviour change from the old `pickConcepts`, which early-returned unsorted when `length <= n`. That
matters because the buffers (8 / 14 / 18) deliberately exceed each game's output, so the model makes
the final cut and reading order is the last lever.

---

## 6. The timer — p. 83's third lever

```ts
TRIVIA_QUESTION_MS = { foundational: 20_000, intermediate: 15_000, advanced: 10_000 }
```

15s is the intermediate value because it is what the game shipped with, and because the paper's
worked example is a student at exactly 50% — the bottom of the intermediate band.

**Stored in `game_content.payload.settings`, not derived client-side.** The difficulty of a timed
game *is* its timer, so a client-side derivation would be a client-chosen difficulty. Storing it also
means a stored game replays with the clock its questions were written for — change these numbers
later and old games keep their own timing, where a derived timer would silently re-time them all.
`practice_tests.questions_payload` sets the same precedent.

There is deliberately **no `src/lib/` mirror**. `reviewSchedule.ts` and `testMode.ts` are mirrored
because a *setup screen* must preview a value before the server has spoken; by the time a trivia game
mounts, it has.

Crossword and term-matcher payloads carry **no `settings` key** — a `questionMs` on an untimed game
would be a stored lie.

`isUrgent` is `questionMs / 3`, not a fixed 5000ms: at the advanced 10s clock a flat threshold paints
the ring red for half of every question, which stops reading as urgency.

---

## 7. The nine tier cells — and the four prompt failures behind them

`server/lib/gameDifficulty.ts` holds `CROSSWORD_TIER_RULES`, `MATCH_TIER_RULES` and
`TRIVIA_TIER_RULES`. Each cell names a concrete change of **task**, never an adjective, and each is
injected three ways (paper framing paragraph → game-specific `focus` paragraph → operative fields
spliced onto the bullets) because `testDifficulty.ts` records that a tier sitting only in a shared
header produced **byte-identical output across all three tiers**.

### 7.1 What worked

- **`TIER_GUIDANCE` is imported and reused** — it is the paper's own p. 81 framing of what a tier
  means, and it is as true of a crossword as of a test.
- **`MATCH_TIER_RULES.definition` is paralleled to `FORMAT_TIER_GUIDANCE.matching_type`** rather than
  imported, because the game needs a second clause the test must not have: *which terms go on the
  board*. A test has no such choice — `allocateConcepts()` emits one question per concept.
- **`TRIVIA_TIER_RULES` cannot reuse `FORMAT_TIER_GUIDANCE.multiple_choice`.** Its `advanced` cell
  says "Open with a one-sentence scenario"; advanced trivia runs on a 10-second clock, and a 20-word
  scenario + 12-word question + four 5-word options ≈ 52 words ≈ **13 seconds of reading before one
  second of thinking**. That is the exact "cognitive frustration" p. 83 says this prevents.

### 7.2 ⚠️ The four failures, in order — do not re-walk this path

**Attempt 1 — length ceilings as the difficulty lever.** "at most 15 words", "each option at most 8
words". The model optimised the one thing it could check and **collapsed advanced to the easiest
output of the three tiers**: 2.5-word questions like `"What is XSS?"` with 2.1-word options, against
foundational's 7.4-word options. Option length ran **7.4 → 3.7 → 2.1** in the wrong direction.

**Attempt 2 — a two-sided reading budget.** Reframing "you have N seconds" as "aim for ~N×4 words"
helped the framing but not the output: `"Security Logging and Monitoring Failures cause"` — a
**sentence fragment**, because "ask what the term CAUSES" was read as a fill-in-the-blank stem.

**Attempt 3 — four verbs plus a definition prohibition.** The model turned CAUSES / PREVENTS / COSTS
/ "fails to cover" into a **template applied to all ten items**, and forcing a verb onto a concept
that cannot carry it produced **falsehoods**:

> *"What does Cross-Site Scripting **prevent**?" → "Malicious script execution"* — which XSS *causes*.
> *"What does Physical Layer **cost**?" → "Data transmission"* — meaningless.

That fails the paper's **Factual Correctness** criterion (p. 98), which no amount of difficulty buys
back. Meanwhile the distractors came back as `Network congestion`, `Hardware replacement` — generic
strings from outside the lesson that a student eliminates without knowing anything.

**Attempt 4 — difficulty moved into the options, question rule left elaborate.** The distractor rule
took hold, but the questions degraded to **subjectless stems**: `"Ensures reliable data transfer?"`
naming no concept at all.

### 7.3 What shipped

**The question is ordinary and names its concept; the options carry the entire tier.** The
option-source constraint is checkable by the model against the concept list it was given, which is
why it holds where "reason about consequences" did not.

| Tier | Question | Options |
|---|---|---|
| foundational | what the term MEANS, ≤ 12 words | definitions of **clearly different** things |
| intermediate | which SITUATION / what it is FOR, 8–15 words | **neighbouring** ideas from the same lesson, 3–10 words |
| advanced | NAME the concept, ask what it does/allows/protects against, 6–12 words | each a role or effect belonging to a **DIFFERENT concept in this lesson**, 3–8 words; no invented filler |

**Accepted limit, measured: about two items in ten still come back definitional** (`"What is a
WEBSITE?"`), because some concepts genuinely carry nothing but a definition. That is the ceiling
`FORMAT_TIER_GUIDANCE` already documents — most of this corpus is OWASP risk names and OSI layers
defined in a line. **Every attempt to forbid it produced invented facts instead. Do not chase the
last two.**

### 7.4 Crossword — both levers are needed

A hard clue pointing at the concept's own name is still an easy crossword: the grid gives away the
length and the interlocks give away the letters. So `answer` (the "vocabulary complexity" lever)
moves the answer word itself:

| Tier | Answer taken from | Clue |
|---|---|---|
| foundational | the concept's **name** | plain restatement of the definition |
| intermediate | inside the **definition** — what it acts on, uses, produces, protects | what that thing is FOR |
| advanced | the **effect or failure** it concerns | the situation where that effect matters; never names the concept |

Nothing in `FORMAT_TIER_GUIDANCE` corresponds — a test never asks for a single word under a
letter-count constraint.

⚠️ **Keep `A–Z only, 3–10 letters` and `NEVER abbreviate` tier-independent and immediately after the
tier'd `"answer"` line.** Advanced answers name consequences and are the longest; `groq.ts` filters
that range, `buildCrossword` needs ≥2 survivors, and the route throws on an empty layout. This is
where a 502 would come from.

---

## 8. Database

**No column the feature writes was new** — `game_content.mastery_snapshot`,
`game_sessions.mastery_snapshot` and `game_sessions.space_id` all existed and were unused. The
migration closes failure modes rather than enabling function.

`supabase/migrations/20260809090020_game_difficulty_tiers.sql` — **applied and verified**:

1. Maps the 2 legacy rows `easy|medium|hard` → tier names. Those rows keep
   `mastery_snapshot IS NULL`, and **that NULL, not the mapped value, is what the audit filters on**.
2. `ALTER COLUMN difficulty DROP DEFAULT` + `CHECK (difficulty IN ('foundational','intermediate','advanced'))`.
   Dropping the default is the point: `NOT NULL DEFAULT 'medium'` meant an insert that forgot the
   column wrote a plausible value instead of failing — the same shape as the `practice_telemetry`
   insert that **never once succeeded** while looking fine.
3. `game_sessions.content_id UUID REFERENCES game_content(id) ON DELETE SET NULL` + index. Without
   it, a session and its content are related only by timestamp, so *"prove this session played the
   foundational crossword"* — the p. 99 test case — is unanswerable. `SET NULL`, not `CASCADE`:
   deleting generated content must not erase play history.

`schema.sql` matches, with `game_content` moved **above** `game_sessions` for the new FK.

**There is no `game_sessions.difficulty` column and one must not be added** — the tier is recoverable
as `mastery_tier(mastery_snapshot)`, which is precisely why that SQL function's `COMMENT` names games.

---

## 9. Security — three gaps closed

`POST /api/games/generate` previously had **no material-access gate and no space ownership check**.
Any signed-in student could generate a game from any grade's materials into any space id. That was
already a CLAUDE.md violation; once the route began reading per-student mastery over those concepts
and storing a `mastery_snapshot` attributed to `space_id`, it became the same defect CLAUDE.md
records for `POST /api/flashcards/rate`.

Gate 4 is **not** redundant with gate 3: passing the grade rule proves the student may *read* the
material, not that *this space* holds it, and a snapshot filed against the wrong space corrupts that
space's picture.

`POST /api/gamification/session` took a bare, ungated `material_id` from the client. It now takes
only `content_id` plus the outcome.

⚠️ **The insert lists its fields explicitly.** It was `{ ...parsed.data, student_id }`, which binds
the request shape to the table's columns — add a field to the schema and the next insert fails with
`PGRST204`. Because `recordSession()` swallows every error, session logging would have stopped
entirely with no visible symptom. A `console.warn` now sits in that catch.

---

## 10. Frontend

**`GameCalibration { tier, masterySnapshot, questionMs? }`** replaces `GameSource.difficulty`. Null
in mock mode → no chip, default timer. Never a guessed `foundational`, which would assert a
calibration that never ran.

**One tier chip on `GameStage`, all three games**, beside the subtitle rather than in `hud` (which is
per-game stats and already tight on mobile). Uses `TIER_LABEL` / `TIER_TONE` / `toneText`;
`foundational` stays `neutral`, never `poor`.

**The per-question difficulty badge is deleted** — `Question.difficulty`,
`GeneratedTrivia.difficulty`, its validator clause, `DIFFICULTY_STYLES`, the render, and 24 mock
literals. Difficulty is one tier per session (p. 81); a "HARD" chip inside a Foundational game
contradicted the calibration on screen. `SessionDetail`'s trivia items never carried the field, so
stored `game_sessions.detail` rows need no tolerance handling; stored `game_content.payload` rows
that still carry it need none either, since TypeScript excess-checks only literals.

⚠️ **`regenerate()` must refresh the calibration from the POST response.** It never called
`setSource`, which was harmless while the source params were identical across generations — but tier
and timer now vary, so "Play Again" would show the previous game's chip and clock. This is why
`POST /generate` returns `difficulty` and `mastery_snapshot`.

**`recordSession()` reads `loadedId.current`, not `source`** — the ref is what `regenerate` updates,
so a session played after "Play Again" is logged against the content actually played.

**The build-modal preview is gated on `assessed > 0`,** matching `AdaptiveTestTab.tsx`'s own comment:
at a cold start every student is foundational, which says nothing, and P(L₀) must never print as a
score. Observability for p. 99 is carried by the unconditional chip on `GameStage`.
⚠️ **It filters `by_material` to the selected ids — never `overall`**, which is the whole space and is
the likeliest way to make the preview disagree with the row it predicts. The 4dp rounding in
`documentMastery()` bounds the drift at ≤ 1e-4, which can only flip a tier inside a ~2e-4 band around
0.50 or 0.85.

---

## 11. Acceptance evidence

| Check | Result |
|---|---|
| `tsc --noEmit`, `vite build` | clean |
| `npm run bkt:verify` | **ICR 165 / 165 = 100.0%** |
| Selection distribution, 10,000 trials | weak **62.1%** > unknown **47.0%** > mastered **6.1%**; replays differ |
| Route gates + session route | **17 / 17** — see below |
| End-to-end, three tiers × trivia | **32 / 32** |
| Advanced crossword | 8 words placed, 59 cells, no 502 |
| Advanced term matching | 4 pairs, technical/confusable terms selected |

**Gates (zero Groq cost — all fail before the model call):** missing field → 400 · another student's
space → 404 · another grade's material → 403 · readable-but-not-in-this-space → 404 · no token → 401
· missing `content_id` → 400 · random `content_id` → 404 · another student's content → 404 · own
content → 201 with `space_id` / `material_id` / `game_type` / `mastery_snapshot` all copied server-side
and `accuracy` the only client value that landed · `difficulty: 'medium'` rejected by CHECK · omitting
`difficulty` now fails.

**A stale client sending `difficulty: 'hard'` → 201 with the *derived* tier stored.** Zod strips it;
verify by reading the row, not the response code.

**Never-writes invariant:** the throwaway student ends with **0** `bkt_update_logs` rows and the table
is unchanged table-wide (56 → 56) after generating and playing all three games.

### The measured gradient (material: *6. Information Security*, 28 concepts)

| Tier | Timer | Question | Options | Sample |
|---|---|---|---|---|
| foundational | **20s** | 5.1 w | **9.3 w** | *"What is Network Layer?"* → full-sentence definitions, clearly different |
| intermediate | **15s** | 6.3 w | **3.1 w** | *"What is Presentation Layer for?"* → `[Translating data formats \| Routing between networks \| …]` |
| advanced | **10s** | 5.1 w | **2.7 w** | *"What does Broken Access Control allow?"* → `[Proper authentication \| Secure data encryption \| Unauthorized resource access \| Network layer security]` |

All ten advanced answers verified factually correct. Crossword clue gradient: foundational *"A
collection of related web pages"* (the term's own definition) vs advanced *"Consequence of a
successful cyber attack"* (an effect, never naming the term).

### The p. 98 Difficulty Alignment evidence, as one number

```sql
SELECT count(*) FROM game_content
 WHERE mastery_snapshot IS NOT NULL
   AND difficulty <> mastery_tier(mastery_snapshot);   -- must be 0
```

```sql
-- Per-row readout
SELECT id, game_type, difficulty, mastery_snapshot,
       mastery_tier(mastery_snapshot)     AS tier_from_db,
       payload->'settings'->>'questionMs' AS question_ms, created_at
  FROM game_content WHERE student_id = '<student>' ORDER BY created_at DESC;

-- Sessions carry the snapshot their prompt was built from
SELECT gs.game_type, gs.accuracy, gs.mastery_snapshot,
       mastery_tier(gs.mastery_snapshot) AS session_tier, gc.difficulty AS content_tier
  FROM game_sessions gs LEFT JOIN game_content gc ON gc.id = gs.content_id
 WHERE gs.student_id = '<student>' ORDER BY gs.completed_at DESC LIMIT 10;
```

### How a tester demonstrates p. 99 end to end

Open the build modal → the sentence names the mastery and the tier **before** anything is generated.
Generate → the chip on the game stage matches it. For trivia the ring starts at 20 / 15 / 10. One
`game_content` row shows `mastery_snapshot`, `difficulty` and `questionMs` agreeing, and
`bkt_mastery` is untouched. Four screenshots and two queries.

Force a tier with `npx tsx scripts/set-test-mastery.ts <tier>`, then `reset` — it competes with the
live engine.

---

## 12. Known limits and deliberate non-goals

- **~2 of 10 advanced trivia items are still definitional.** Section 7.3 — the ceiling, not a bug.
- **Term-matcher advanced definitions stay fairly literal** on this corpus, for the same reason: the
  stored definitions are literally *"A security vulnerability that occurs when …"*. The *selection*
  half of that rule does work — it picks technical, confusable terms.
- **Groq's free tier is ~11 test generations/day account-wide** and games now draw on the same
  budget. Unresolved; needs a paid tier for a 50-student study.
- **Streaks and badges remain dead.** `trigger_update_streak` fires on `activity_logs` and nothing in
  `server/` ever inserts one, so `day_streak` is 0 for every student and `user_badges` is empty.
  Untouched here; the false comment claiming this route updates the streak has been removed.
