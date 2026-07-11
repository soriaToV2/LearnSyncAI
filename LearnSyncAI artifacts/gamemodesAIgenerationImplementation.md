# Games Content Generation — Backend Implementation Plan

## Context

The three study games (Crossword, Term Matching, Timed Trivia) currently run **entirely on
frontend mock data** — `COURSE_DATABASE` in `src/pages/student/games/gamesData.ts`, keyed by four
hardcoded course topics. There is no backend that generates game content, and no table that stores
it. The gamification tables (`game_sessions`, `gamification_profiles`, `user_badges`) only record
*results* after a game is played (via an existing `POST /api/gamification/session` + a streak/XP DB
trigger).

This session builds the **AI content-generation** half: real games generated from a student's
uploaded materials, sourced from the `concepts` table (term/definition pairs already extracted +
embedded per material). **BKT/mastery difficulty calibration is explicitly out of scope** — per the
capstone paper (v4 PDF, lines 808–810, 538) mastery is only a *prompt parameter* that games read
without writing back. We wire that seam (an optional `difficulty` input, default `medium`) but do
not query `bkt_mastery` yet.

Decisions locked with the user:
- **Models (Balanced):** Term Matching → `llama-3.1-8b-instant`; Timed Trivia → `llama-3.3-70b-versatile`; Crossword words/clues → `llama-3.3-70b-versatile`. All on Groq.
- **Persistence:** new `game_content` table (JSONB payload), mirroring `practice_tests.questions_payload`.
- **Crossword:** LLM emits candidate words+clues only; a deterministic **backtracking grid builder** in backend code lays them out. Frontend clue contract generalized from 3 fixed keys to a clue array.
- **Scope:** backend + wire the 3 game components and `GamesLanding` to call it end-to-end.

---

## Architecture Overview

```
GamesLanding "Build & Launch"
   └─ POST /api/games/generate { space_id, material_ids, game_type, difficulty? }
        1. authenticate + requireRole('student')
        2. Zod validate (GenerateGameContentSchema)
        3. fetch concepts (.in('material_id', material_ids))  → 422 if none
        4. per game_type:
             term_matcher  → groq helper (8b)     → terms[]
             timed_trivia  → groq helper (70b)     → trivia[] (MCQ, difficulty tiers)
             crossword     → groq helper (70b) words+clues → buildCrossword() [code] → cells + clues
        5. INSERT game_content { space_id, material_ids, game_type, payload, difficulty }
        6. 201 { data: { id, payload } }
   └─ navigate(`/student/games/${type}?contentId=${id}`)

Game component (Crossword/TermMatching/TimedTrivia)
   └─ GET /api/games/content/:id  → payload (CourseGameData shape) → render
```

Content payload always conforms to the frontend `CourseGameData` contract so the game components
render unchanged apart from swapping their data source.

---

## Backend Changes

### 1. DB: new `game_content` table — `schema.sql`
Add after the gamification tables (~`schema.sql:234`). Follow the `practice_tests` JSONB precedent.

```sql
CREATE TABLE game_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    material_ids UUID[] NOT NULL,
    game_type game_type NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'medium',
    payload JSONB NOT NULL,          -- full CourseGameData for this game_type
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_game_content_student ON game_content(student_id);
```
- Written server-side with `supabaseAdmin` (service role); like the other gamification tables it is **not** RLS-enabled (consistent with `game_sessions` etc. at `schema.sql:241-248`). Note this in the plan; if RLS is desired later, add a `student_id = auth.uid()` SELECT policy.
- Apply via the Supabase MCP `apply_migration` (or run the SQL in the Supabase SQL editor). `schema.sql` is the source of truth — update it in the same change.

### 2. Types: `server/types/database.ts`
Add a `GameContent` interface mirroring the table (`payload: Record<string, unknown>`, following the `PracticeTest` JSONB convention at `database.ts:106-119`).

### 3. Zod: `server/types/api.ts`
Add near the gamification schemas (~`api.ts:199`):
```ts
export const GenerateGameContentSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), // BKT seam; unused-by-mastery for now
});
export type GenerateGameContentInput = z.infer<typeof GenerateGameContentSchema>;
```

### 4. Groq helpers: `server/lib/groq.ts`
Add three exported functions mirroring the structure of `generateFlashcardsFromConcepts`
(`groq.ts:40-105`): numbered concept list → strict-JSON prompt → `response_format:{type:'json_object'}`
→ `JSON.parse` with the same `Failed to parse Groq JSON response` catch → minimal shape validation.
Reuse the existing `ConceptInput` interface (`groq.ts:12-15`).

- `generateTermMatches(concepts, count=4, difficulty)` → model `llama-3.1-8b-instant`, returns `{ terms: TermItem[] }`. Polishes each concept into a concise game-friendly term + short definition; picks the `count` best pairs.
- `generateTrivia(concepts, count=6, difficulty)` → model `llama-3.3-70b-versatile`. Returns `{ trivia: Question[] }` — MCQ with **exactly 4 options**, `correct` **must equal one option verbatim**, `difficulty` ∈ `easy|medium|hard`, aim for a spread of tiers. Emphasize plausible-but-wrong distractors. (Contract from `gamesData.ts:3-8`.)
- `generateCrosswordWords(concepts, difficulty)` → model `llama-3.3-70b-versatile`. Returns `{ words: { answer, clue }[] }` where each `answer` is a single uppercase A–Z token (no spaces/punctuation), length 3–8, ~8–12 candidates. **No coordinates** — the LLM never places the grid.

Add per-function shape guards that throw on missing arrays / malformed items (e.g. a trivia item whose `correct` isn't in `options`), so the route can 502 cleanly rather than emit a broken game.

### 5. Crossword builder (deterministic): `server/lib/crossword.ts` (new)
Pure function `buildCrossword(words, { size?=11, maxWords?=8 })` → `{ crossword: CrosswordCell[], crosswordClues: CrosswordClue[] }`.
- Standard **backtracking placement**: sort candidates by length desc; place the first word; for each
  subsequent word try every existing placed letter as an intersection (opposite orientation), validate
  no adjacent-cell conflicts / no illegal parallel adjacency, keep the first valid placement; skip words
  that don't fit. This is the algorithm named in the paper (line 853).
- Emit **only filled cells** as `CrosswordCell[]` (`{r,c,correctLetter,label?}`) — sparse, matching the
  contract at `gamesData.ts:15-20`. Assign `label` (clue number) to each word's start cell in
  standard crossword numbering (scan cells top-left→bottom-right; a cell starts a number if it begins
  an across and/or down run).
- Emit `crosswordClues: { number, direction, clue }[]` (the generalized contract — see frontend change).
- Normalize coordinates so the grid is top-left anchored; drop the fixed 5×5 assumption (builder is
  N×N, default 11). The frontend grid renders from `max(r,c)+1`, so it must not hardcode 5 either
  (see change 8).

### 6. Route: `server/routes/games.routes.ts` (new)
Mirror `practice.routes.ts` structure exactly.
- `const router = Router(); router.use(authenticate, requireRole('student'));`
- `POST /generate`: `GenerateGameContentSchema.safeParse` → 400; `const studentId = req.user!.id`;
  fetch concepts `.from('concepts').select('id, term, definition').in('material_id', material_ids)`
  → **422** `{ error: 'No concepts found for the selected materials' }` if empty (matches
  `materials.routes.ts` generate-flashcards precedent); branch on `game_type` to the right Groq
  helper (+ `buildCrossword` for crossword); wrap LLM calls in try/catch → **502**
  `{ error, message }` (Groq has no internal retry, unlike Gemini); assemble a `CourseGameData`-shaped
  `payload` (include `courseName` from the study space title); `INSERT` into `game_content`
  `.select().single()` → 500 on error; `res.status(201).json({ data: { id, payload } })`.
- `GET /content/:id`: fetch `game_content` by id **scoped to `student_id = req.user!.id`**; 404 if
  missing; `res.json({ data: row.payload })`.

### 7. Mount: `server/index.ts`
Add `import gamesRoutes from './routes/games.routes.js'` and `app.use('/api/games', gamesRoutes)`
alongside the other mounts (`index.ts:42-50`).

---

## Frontend Changes

### 8. Generalize the crossword clue contract — `gamesData.ts` + `CrosswordGame.tsx`
- `gamesData.ts`: replace `crosswordClues: { across1; across2; down1 }` (`gamesData.ts:27-31`) with
  `crosswordClues: CrosswordClue[]` where `CrosswordClue = { number: number; direction: 'across'|'down'; clue: string }`.
  Update the four mock entries to the new array shape (keeps mock fallback compiling).
- `CrosswordGame.tsx`: rewrite only the `clues` useMemo (`CrosswordGame.tsx:117-128`). Instead of
  reading `.across1/.across2/.down1`, map each derived `Word` (from the already-generic `words`,
  `acrossWords`, `downWords`) to its clue by matching **(start-cell label number, direction)** against
  the `crosswordClues` array. All the grid-walking logic (`collectWord`, `words`, `activeWord`,
  `activeClue`) stays as-is.

### 9. Async data loading in the 3 game components
Replace the synchronous mock lookup — the single line
`const targetData = COURSE_DATABASE[targetInfo.gameKey];` (`CrosswordGame.tsx:47`,
`TermMatchingGame.tsx:~28`, `TimedTriviaGame.tsx:~41`) — with:
- read `contentId` from `useSearchParams()` (new param) instead of / in addition to `course`;
- `const [targetData, setTargetData] = useState<CourseGameData | null>(null)` + `loading`/`error`;
- `useEffect` → `api.get<CourseGameData>(\`/games/content/\${contentId}\`)` (uses the existing fetch
  wrapper + Bearer injection, `src/lib/api.ts:36-67`); on load `setTargetData(res.data)`;
- guard render with a lightweight loading state (reuse the game's existing `glass-card`/stage shell)
  and an error state with a Back-to-Games action; keep the current mock as a fallback only if
  `contentId` is absent (so dev/demo still works).
- Grid render must derive size from the payload (`Math.max(...cells r,c)+1`) rather than the
  `GRID_SIZE = 5` constant (`CrosswordGame.tsx:19`).

### 10. Launch flow — `GamesLanding.tsx`
`handleBuildAndLaunchGame` (`GamesLanding.tsx:28-32`) currently just navigates with `?course=`.
Change to: `POST /api/games/generate { space_id, material_ids, game_type }` using the modal's
already-collected `modalSelectedCourse` + `selectedResources`, show an inline generating state on the
Build button, then `navigate(\`/student/games/\${type}?contentId=\${data.id}\`)`. Map the UI game-type
label (`'matching'|'crossword'|'trivia'`) to the API enum (`'term_matcher'|'crossword'|'timed_trivia'`).
- **Caveat / dependency:** the modal presently lists **mock** courses (`MOCK_COURSES`) and **mock**
  resource filenames (`getCourseResources`), not real `study_spaces`/`materials` UUIDs. For the
  endpoint to return real content, the selectors must supply real `space_id` + `material_ids`. If the
  student's DB has materials with extracted concepts, switch the modal to fetch real spaces/materials
  (`/api/spaces`, `/api/materials`). This is the one place the "mock course" system meets real data —
  called out as the integration risk to confirm against the live DB during verification.

---

## Model Rationale (per user's request to discuss)
- **Term Matching → `llama-3.1-8b-instant`:** the concepts table already holds term+definition, so the
  task is light rewriting/selection. Fast + cheap fits.
- **Timed Trivia → `llama-3.3-70b-versatile`:** MCQ quality lives in the *distractors*; weak models
  produce obviously-wrong options. 70b (already the repo's flashcard model) gives plausible distractors
  and reliable JSON mode.
- **Crossword words/clues → `llama-3.3-70b-versatile`:** the semantic work is concise clue writing with
  accurate answer tokens; the hard constraint-satisfaction (grid layout) is offloaded to
  `buildCrossword`, so no reasoning-heavy model is needed. (`openai/gpt-oss-120b` is the drop-in upgrade
  if clue/distractor quality proves lacking — a one-line model swap per helper.)

---

## Verification

1. **Type-check + build:** `npm run lint` (tsc --noEmit) and `npx vite build` — both must stay clean.
2. **DB migration:** confirm `game_content` exists (Supabase MCP `list_tables`) and `schema.sql`
   matches.
3. **Endpoint smoke test** (server running via `npm run dev:server`, with a valid student JWT):
   - `POST /api/games/generate` for each `game_type` against a real `space_id` + `material_ids` that
     have concepts. Assert 201 + payload shape: trivia items have 4 options with `correct` ∈ options
     and valid `difficulty`; term list non-empty; crossword cells are a **connected, conflict-free**
     grid and every `crosswordClues` entry maps to a placed word.
   - `POST` with materials that have no concepts → **422**.
   - Force a Groq failure (bad key) → **502**, not a crash.
   - `GET /api/games/content/:id` returns the payload; a different student's id → **404**.
4. **Crossword builder unit sanity:** call `buildCrossword` on a fixed word list and assert no two
   words overlap incorrectly, all intersections share letters, and labels/clue-numbers line up. This is
   the highest-risk component — test it in isolation before trusting LLM-fed input.
5. **End-to-end (use the `run` skill / browser):** from `GamesLanding`, Build & Launch each game;
   confirm it generates, navigates with `contentId`, loads, and plays through victory — including the
   correct/wrong effects and the crossword's arrow-key navigation on a **non-5×5** generated grid.

## Out of Scope (future)
- BKT mastery calibration (querying `bkt_mastery` to set difficulty) — only the `difficulty` input seam is added now.
- Recording game results (already exists: `POST /api/gamification/session` + streak trigger).
- Replacing the mock `MOCK_COURSES`/`getCourseResources` system wholesale (only wired far enough to pass real ids).
