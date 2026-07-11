# Game Modes — AI Content Generation (As Built)

## Context

The three study games (Crossword, Term Matching, Timed Trivia) generate their content from a
student's uploaded materials, sourced from the `concepts` table (term/definition pairs already
extracted + embedded per material). Generated content is persisted in a new `game_content` table and
fetched by the game pages.

The mock `COURSE_DATABASE` in `src/pages/student/games/gamesData.ts` remains **only as a dev/demo
fallback** — used when a game route is opened without a `?contentId=` param.

**BKT/mastery difficulty calibration is not wired yet.** Per the capstone paper (v4 PDF, lines
808–810, 538) mastery is only a *prompt parameter* that games read without writing back. The seam is
in place — a `difficulty` field flows end-to-end, and concept selection happens in code (the natural
place to later order by mastery) — but `bkt_mastery` is not queried.

Key decisions (as implemented):
- **Models (Groq):** Term Matching → `llama-3.1-8b-instant`; Timed Trivia → `llama-3.3-70b-versatile`; Crossword words/clues → `llama-3.3-70b-versatile`.
- **Persistence:** `game_content` table (JSONB payload), mirroring `practice_tests.questions_payload`.
- **Crossword:** the LLM emits candidate words+clues only; a deterministic **backtracking grid builder** in code lays them out.
- **Concept selection is code-side:** the backend samples a bounded subset of concepts and hands only those to the LLM (token efficiency + coverage control + BKT seam).

---

## End-to-End Flow

```
GamesLanding "Build & Launch"
   ├─ loads real study spaces      GET /api/spaces
   ├─ loads real materials         GET /api/materials/space/:spaceId   (only parsed_status='completed')
   └─ POST /api/games/generate { space_id, material_ids, game_type, difficulty? }
        1. authenticate + requireRole('student')
        2. Zod validate (GenerateGameContentSchema)
        3. fetch concepts (.in('material_id', material_ids))   → 422 if none
        4. fetch study space title                              → payload.courseName
        5. pickConcepts(concepts, buffer)   ← CODE-SIDE SELECTION (per-game buffer)
        6. per game_type → LLM helper (+ buildCrossword for crossword)   → 502 on LLM failure
        7. INSERT game_content { student_id, space_id, material_ids, game_type, difficulty, payload }
        8. 201 { data: { id, payload } }
   └─ navigate(`/student/games/${type}?contentId=${id}`)

Game page (Crossword / TermMatching / TimedTrivia)
   └─ useGameContent()
        GET /api/games/content/:id → { payload, space_id, material_ids, game_type, difficulty }
        render payload (CourseGameData shape)
   └─ Result screen buttons:
        Close       → back to games
        Retry       → replay the SAME content locally (no LLM call)
        Play Again  → regenerate() → POST /api/games/generate with the stored source params → new content
```

The payload always conforms to the frontend `CourseGameData` contract, so a game only reads the one
field it needs (`terms` / `trivia` / `crossword` + `crosswordClues`); the others stay empty.

---

## Per-Game Generation Flow (the core)

All three share the same route entry (`POST /api/games/generate`) and differ only in the selection
buffer + LLM helper. Code-side selection lives in `buildPayload()` /
`pickConcepts()` in `server/routes/games.routes.ts`; the LLM helpers live in `server/lib/groq.ts`.

`pickConcepts(concepts, n)` randomly shuffles and takes `n` — so a large material never floods the
prompt, and each play/regenerate covers a different subset. **This is where BKT ordering plugs in
later** (swap the shuffle for a mastery-weighted sort).

Selection buffers (`SELECT_BUFFER`) are deliberately larger than each game's output so the model
still has a little room to choose the best items:

| Game | Buffer (concepts → LLM) | LLM (model) | Output |
|---|---|---|---|
| Term Matching | **8** | `generateTermMatches` (`llama-3.1-8b-instant`) | 4 term/definition pairs |
| Timed Trivia | **14** | `generateTrivia` (`llama-3.3-70b-versatile`) | 10 unique MCQs |
| Crossword | **18** | `generateCrosswordWords` (`llama-3.3-70b-versatile`) → `buildCrossword` | up to 10 placed words |

### 1. Term Matching — `term_matcher`
`pickConcepts(concepts, 8)` → `generateTermMatches(selected, 4)`.
- The model condenses each concept into a concise, game-friendly `term` (1–4 words) + one-sentence
  `definition`, and picks the 4 best, distinct pairs (distinct enough that each maps to exactly one
  term).
- Output shape: `{ terms: { term, definition }[] }`. Validation drops malformed entries; throws if
  fewer than 2 valid pairs survive.

### 2. Timed Trivia — `timed_trivia`
`pickConcepts(concepts, 14)` → `generateTrivia(selected, 10)`.
- Generates **10 unique** questions (the game plays 10; generating 10 avoids the earlier bug where a
  6-question pool repeated within a run).
- Each question: **exactly 4 options**, `correct` copied verbatim from an option, `difficulty` ∈
  `easy|medium|hard` with a spread of tiers, plausible distractors, self-contained wording.
- Output shape: `{ trivia: { question, options[4], correct, difficulty }[] }`. Validation enforces the
  4-option / correct-in-options / valid-difficulty invariants and drops any item that fails.

### 3. Crossword — `crossword` (LLM writes words, code builds the grid)
`pickConcepts(concepts, 18)` → `generateCrosswordWords(selected)` → `buildCrossword(words)`.

The crossword gets the **widest buffer (18)** because the layout needs interlocking candidates to
choose from — this is the mitigation for handing the model fewer concepts.

- **`generateCrosswordWords`** returns `{ words: { answer, clue }[] }`, ~8–12 entries. Each `answer`
  is a **single, complete, real word**, A–Z only, **3–10 letters**. The prompt explicitly forbids
  abbreviating/truncating to fit a length (e.g. never shorten "VULNERABLE" → "VULNER") — if a key word
  exceeds 10 letters the model picks a different word the clue can point to. **The LLM never assigns
  coordinates.**
- **`buildCrossword(words, { size = 13, maxWords = 10 })`** (`server/lib/crossword.ts`) is a pure,
  deterministic backtracking layout:
  - dedupe by answer, sort longest-first, anchor the first word across at the origin;
  - place each remaining word on its best intersection with an already-placed word, validating no
    letter conflicts, no illegal end-to-end abutment, and no unintended parallel adjacency;
  - **scoring = most intersections first, then most compact** (smallest resulting bounding box) so the
    grid interlocks tightly instead of sprawling;
  - **the whole grid is capped at `size` (13) in both dimensions** so it renders cleanly (not just each
    word's span);
  - emit **only filled cells** as `CrosswordCell[]` (`{ r, c, correctLetter, label? }`, sparse),
    normalized to a (0,0) top-left anchor, with standard crossword numbering on start cells;
  - emit `crosswordClues: { number, direction, clue }[]`, where each clue text is suffixed with
    `(N letters)` and **N always equals the cell count of that word** (stress-tested: 2,000 random
    layouts, zero mismatches).

---

## Backend Components

### DB: `game_content` table (`schema.sql`)
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
- Written server-side with `supabaseAdmin`; like the other gamification tables it is **not** RLS-enabled — access is scoped in the handler by `student_id = req.user!.id`. Migration `add_game_content_table` applied to Supabase.
- TS mirror: `GameContent` in `server/types/database.ts`.

### Zod: `GenerateGameContentSchema` (`server/types/api.ts`)
```ts
export const GenerateGameContentSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), // BKT seam; prompt-only for now
});
```

### Groq helpers (`server/lib/groq.ts`)
`generateTermMatches`, `generateTrivia`, `generateCrosswordWords` — each builds a numbered concept
list, prompts with `response_format: { type: 'json_object' }`, parses via a shared `parseGroqJson`
(consistent `Failed to parse Groq JSON response` error), and applies per-function shape guards so a
malformed model response surfaces as a clean 502 rather than a broken game. `difficulty` tunes the
prompt via `DIFFICULTY_GUIDANCE`.

### Route (`server/routes/games.routes.ts`)
- `router.use(authenticate, requireRole('student'))`.
- **`POST /generate`** — validate → fetch concepts (422 if none) → fetch space title for
  `courseName` → `pickConcepts` (per-game buffer) → LLM helper (+ `buildCrossword`) wrapped in
  try/catch → **502** on failure → INSERT `game_content` → **201** `{ data: { id, payload } }`.
- **`GET /content/:id`** — scoped to the owner; returns
  `{ payload, space_id, material_ids, game_type, difficulty }` (the source params let the client
  "Play Again"); **404** if not found/owned.
- Mounted at `/api/games` in `server/index.ts`.

---

## Frontend Components

### `useGameContent()` hook (`src/pages/student/games/gameUi.tsx`)
- Reads `?contentId=` (real content) or `?course=` (mock fallback).
- Fetches `GET /games/content/:id`, stores `payload` + the `source` params.
- Exposes `regenerate()` — POSTs `/games/generate` with the stored source params, swaps in the new
  payload, and updates the URL's `contentId` **without** a redundant refetch (guarded by a `loadedId`
  ref). Returns `regenerating` for button state. `regenerate` is `undefined` in mock mode.
- `GameStatusScreen` renders the loading / error stage while content resolves.

### Result screen buttons (`ResultScreen`)
- **Close** → back to games. **Retry** (`onReplay`) → replays the same content locally. **Play Again**
  (`onRegenerate`) → `regenerate()` with a "Generating…" spinner. Mock mode shows Close · Retry only.

### Game pages
Each game calls `useGameContent()` instead of the old synchronous mock lookup, guards render on
`loading`/`error`/`!data`, and passes `onRegenerate`/`regenerating` into its `ResultScreen`.
`CrosswordGame` derives grid size dynamically (`max(r,c)+1`, no fixed 5×5), maps clues by
`(label number, direction)` against the `CrosswordClue[]` contract, and its cell `<input>` carries
`maxLength={1}`.

### Crossword clue contract (`gamesData.ts`)
`CourseGameData.crosswordClues` is `CrosswordClue[]` (`{ number, direction, clue }`) — generalized
from the old fixed `{ across1, across2, down1 }` so any generated layout works. The four mock entries
were converted to the array shape.

### Launch flow (`GamesLanding.tsx`)
The Build modal loads **real** study spaces (`GET /api/spaces`) and their **completed** materials
(`GET /api/materials/space/:spaceId`), then POSTs `/api/games/generate` with real `space_id` +
`material_ids`, shows a generating state, and navigates with `?contentId=`. UI game labels
(`matching`/`crossword`/`trivia`) map to the API enum (`term_matcher`/`crossword`/`timed_trivia`).

---

## Model Rationale
- **Term Matching → `llama-3.1-8b-instant`:** light rewriting/selection over already-structured concepts — fast + cheap.
- **Timed Trivia → `llama-3.3-70b-versatile`:** MCQ quality lives in the distractors; the 70b model produces plausible ones and reliable JSON.
- **Crossword words/clues → `llama-3.3-70b-versatile`:** semantic clue writing only; the hard constraint-satisfaction (grid layout) is offloaded to `buildCrossword`. (`openai/gpt-oss-120b` is a one-line drop-in upgrade if quality lags.)

---

## Verification (done)
- `npm run lint` (tsc --noEmit) and `npx vite build` — clean.
- `game_content` migration applied.
- Crossword builder: stress-tested (2,000 random layouts) — clue "(N letters)" always equals the cell
  count (always solvable); compactness change lifted density and tightened grids to 13×13; the 3–10
  letter fix places full words like "VULNERABLE".

## Not Yet Done / Out of Scope
- **BKT mastery calibration** — only the `difficulty` input + code-side selection seam exist; `bkt_mastery` is not queried.
- **Recording game results** — already handled elsewhere (`POST /api/gamification/session` + streak trigger).
- **Live end-to-end run** — needs the stack running with valid `GROQ_API_KEY`/Supabase creds and a material whose `parsed_status='completed'` (has concepts).
- **Optional:** dropping the LLM from Term Matching entirely (it could read `concepts` directly) — kept for uniform, future BKT-driven difficulty calibration.
