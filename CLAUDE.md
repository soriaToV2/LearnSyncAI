# LearnSyncAI — CLAUDE.md

This file provides essential context for AI coding assistants working on the LearnSyncAI project.

---

## Project Overview

**LearnSyncAI** is a full-stack, AI-powered personalized learning companion for Junior High School students at Pasig Christian Academy. It combines several evidence-based study techniques (spaced repetition, free recall, the Feynman technique, adaptive testing) with AI-powered feedback and gamification into a single platform, designed to complement the school's existing independent learning process.

The platform integrates **Bayesian Knowledge Tracing (BKT)** to estimate each student's knowledge mastery and **Generative Artificial Intelligence (GenAI)** to generate personalized learning support based exclusively on educator-uploaded instructional materials.

There are **three user roles**:
- **`admin`**: Manages user accounts (creating, editing, disabling accounts for educators and students). Does not interact with learning content or analytics.
- **`educator`**: Uploads and manages official learning materials, assigns grade-level access, and monitors student learning progress through a class-level analytics dashboard.
- **`student`**: Accesses educator-uploaded learning materials assigned to their grade level and engages with the platform's AI-assisted learning features.

---

## Tech Stack

### Frontend
- **Framework:** React 19 + TypeScript (Vite, port 3000)
- **Routing:** React Router DOM v7
- **Styling:** Tailwind CSS v4 — uses utility classes heavily. Design system tokens are defined in `src/index.css`.
- **HTTP Client:** a typed `fetch` wrapper in `src/lib/api.ts` that attaches the Supabase JWT and unwraps the `{ data }` envelope. Always use `api.get(...)` / `api.post(...)` etc., never raw `fetch` — the one permitted exception is `POST /api/chat`, which streams Server-Sent Events the JSON wrapper cannot represent.
- **UI Components:** Lucide React for icons, Motion for animations.

### Backend
- **Framework:** Express.js + TypeScript (tsx watch, port 5000)
- **Entry point:** `server/index.ts`
- **Validation:** Zod — all request bodies must be validated with a Zod schema defined in `server/types/api.ts` before any logic runs.
- **Auth middleware:** `server/middleware/auth.ts` — all protected routes must use `authenticate` then the appropriate `requireRole()` for the endpoint's intended user role (`'student'`, `'educator'`, or `'admin'`).

### Database
- **Provider:** Supabase (PostgreSQL + pgvector extension)
- **Client:** `server/lib/supabase.ts` — exports `supabaseAdmin` (service role, full access) for server-side use. Never use the anon client on the server.
- **Schema:** `schema.sql` — single source of truth for all table definitions.
- **Row-Level Security (RLS):** Enforces data isolation between students, restricts educators to mastery data within their selected grade level, and ensures students cannot access materials outside their assigned grade level.

### AI Services

> **IMPORTANT:** The embedding model **must always be `gemini-embedding-001`**. All concept vectors stored in the `concepts` table use 3072 dimensions from this model. Never switch embedding models — doing so would make all stored vectors incompatible. (Google lists it as supported until 2028-05-14, so there is no deadline pressure here.)

**Two Gemini text models are in play, and they do not share semantics.** Both constants live in `server/lib/gemini.ts`; nowhere else may name a model string.

| Constant | Model | Used by | Status |
|---|---|---|---|
| `GEMINI_EXTRACTION_MODEL` | `gemini-3.6-flash` | Educator concept extraction (`conceptExtraction.ts`) | ✅ working |
| `GEMINI_GRADING_MODEL` | `gemini-3.6-flash` | Feynman grading (`cognitive.routes.ts`) | ✅ working |
| `GEMINI_UTILITY_MODEL` | `gemini-3.5-flash-lite` | Free Recall extraction + coaching prose (`cognitive.routes.ts`) | ✅ working |
| `GEMINI_LEGACY_TEXT_MODEL` | `gemini-2.5-flash` | Adaptive tests (`practice.routes.ts`) | ❌ **404 — dead** |

**Choosing a constant for a new call site — one question:** *does the model's own judgement become a number the student is shown?* Yes → `GEMINI_GRADING_MODEL`; no → `GEMINI_UTILITY_MODEL`. Free Recall is the instructive case: it looks like grading, but the model only enumerates what the student mentioned and the score is `coveredCount / totalConcepts` computed in code, so it belongs on the utility model. Feynman's `accuracy_score` comes straight from the model, so it does not.

- **`gemini-2.5-flash` is already gone, not going.** Verified 2026-08-01 against our own API key: every call returns `HTTP 404 — "no longer available to new users"`. It is still returned by `ListModels`, which is why it looks alive from the outside. The published 2026-10-16 shutdown date is irrelevant — **adaptive test generation is broken in the running app right now.** See `LearnSyncAI artifacts/GEMINI_MIGRATION_STATUS.md`.
- **Never send `temperature` to a `gemini-3*` model.** Gemini 3 dropped the sampling parameters: `temperature`, `top_p` and `top_k` are ignored today and a future model generation returns HTTP 400 for them. `generateJson()` strips `temperature` on Gemini 3 and logs a warning; treat that warning as a bug to fix at the call site, not noise.
- **Gemini 3 thinks by default** (`medium` on 3.6-flash, `minimal` on Flash-Lite) and thinking tokens draw on `maxOutputTokens`. Set `thinkingLevel` and `maxOutputTokens` explicitly on any Gemini 3 call, or a tight budget truncates the response and surfaces as unparseable JSON.
- **Free-tier request quota is per model** (`GenerateRequestsPerDayPerProjectPerModel`, observed limit **20/day**). Using a distinct model for utility calls is therefore not only cheaper, it buys a separate daily bucket. Embeddings are metered separately again.
- **Cost is not the lever people assume.** Across the paper's 50-student study the entire spread between "3.6-flash everywhere" and "Flash-Lite everywhere" is roughly $14 vs $3. Never trade grading quality for that.

### BKT Implementation
- BKT is implemented **directly in the platform backend** using the classical four-parameter update equations.
- The system does **NOT** use pyBKT.
- Data-driven parameter estimation methods such as **Expectation Maximization (EM) are not used** because the platform has no pre-existing historical student interaction data.
- Default parameters are initialized from established educational data mining research (Bulut et al., 2023):
  - `P(L₀) = 0.10` (initial knowledge state)
  - `P(T) = 0.20` (transition/learning rate)
  - `P(S) = 0.15` (slip probability)
  - `P(G)` = context-sensitive, varies by assessment mode and question format
- BKT mastery estimates are updated exclusively through **Adaptive Flashcards** and **Adaptive Test Mode**. AI-generated games, Feynman Technique, and Free Recall use mastery estimates for personalization but do NOT update them.

---

## Development Commands

```bash
# Run both frontend and backend concurrently (recommended)
npm run dev

# Run frontend only (port 3000)
npm run dev:client

# Run backend only (port 5000)
npm run dev:server

# TypeScript type-check (no emit) — run after every change
npm run lint
```

---

## Project Structure

```
LearnSyncAI/
├── server/                        # Express backend
│   ├── index.ts                   # App entry point, route mounting
│   ├── lib/
│   │   ├── gemini.ts              # Gemini AI helpers (embedding, generation, JSON)
│   │   ├── groq.ts                # Groq AI helpers (chat streaming, flashcard gen)
│   │   ├── materialAccess.ts      # Who may read which material (grade/ownership gate)
│   │   └── supabase.ts            # Supabase admin client
│   ├── middleware/
│   │   ├── auth.ts                # JWT authentication middleware
│   │   └── requireRole.ts         # Role-based access control (student, educator, admin)
│   ├── routes/
│   │   ├── auth.routes.ts         # /api/auth
│   │   ├── materials.routes.ts    # /api/materials (upload, parse, embed)
│   │   ├── studyspaces.routes.ts  # /api/spaces (CRUD)
│   │   ├── flashcards.routes.ts   # /api/flashcards (decks, cards, spaced rep)
│   │   ├── cognitive.routes.ts    # /api/cognitive (free recall, Feynman)
│   │   ├── practice.routes.ts     # /api/practice (adaptive tests)
│   │   ├── gamification.routes.ts # /api/gamification (games, XP, badges)
│   │   ├── bkt.routes.ts          # /api/bkt (mastery recalculation)
│   │   ├── chat.routes.ts         # /api/chat (RAG-based study assistant)
│   │   └── educator.routes.ts     # /api/educator (material management, analytics)
│   └── types/
│       ├── api.ts                 # All Zod validation schemas + inferred types
│       └── database.ts            # TypeScript types mirroring DB table shapes
│
├── src/                           # React frontend
│   ├── lib/api.ts                 # Axios instance — always import this for API calls
│   ├── context/                   # React context providers (Auth, etc.)
│   ├── components/                # Shared reusable UI components
│   ├── pages/
│   │   ├── auth/                  # Login, Register pages
│   │   ├── admin/                 # Admin account management pages
│   │   ├── educator/              # Educator Portal pages
│   │   │   ├── EducatorDashboard.tsx   # Material upload + student analytics
│   │   │   └── ...
│   │   └── student/
│   │       ├── StudySpace.tsx     # Main container — hosts all 5 study tabs
│   │       ├── StudentDashboard.tsx
│   │       ├── StudySpacesList.tsx
│   │       └── studySpaceTabs/
│   │           ├── ResourcesTab.tsx    # Document view + AI chatbot
│   │           ├── FlashcardsTab.tsx   # Flashcards + spaced repetition
│   │           ├── FreeRecallTab.tsx   # Free recall + AI evaluation
│   │           ├── FeynmanTab.tsx      # Feynman technique
│   │           ├── cognitiveShared.tsx # Layout shared by the two tabs above
│   │           └── AdaptiveTestTab.tsx # Adaptive practice tests
│   └── index.css                  # Tailwind config + design system tokens
│
├── schema.sql                     # Supabase DB schema (source of truth)
├── ARCHITECTURE.md                # High-level feature logic and data flow
└── CLAUDE.md                      # This file
```

---

## Key Architecture Patterns

### Dual-Portal Architecture
The platform follows a **dual-portal, three-tier model**:
- **Educator Portal**: Material upload, grade-level access control, and student mastery monitoring.
- **Student Portal**: Independent study, adaptive assessment, and gamified review.
- **System Tiers**: Presentation (browser UI), Application (Express backend + AI services), Data (Supabase PostgreSQL).

### Adding a New API Endpoint
1. Define a Zod schema in `server/types/api.ts`.
2. Add the route handler to the appropriate file in `server/routes/`.
3. Use `supabaseAdmin` for all DB operations — never the anon client.
4. All routes must start with the appropriate auth middleware: `router.use(authenticate, requireRole('student'))` for student routes, `requireRole('educator')` for educator routes, `requireRole('admin')` for admin routes.
5. Always `safeParse()` the request body and return a 400 if validation fails.
6. **If the route accepts a material ID, gate it** — see below.

### Material Access — Every Route Must Enforce It Itself
The service role key bypasses Row-Level Security by design, so RLS policies do **nothing** for a request that reaches Express. Migration 0008 states this outright: "The API layer must still enforce role and ownership itself."

`server/lib/materialAccess.ts` is the single answer to "may this caller read these materials?":
- **student** → not archived, and `grade_levels` contains their `grade_level`
- **educator** → their own uploads, archived or not
- **admin** → all; **disabled account** → none

Use it two ways:
- `requireMaterialAccess()` — route guard for a material ID in the path (`/:id/view`, `/:id/concepts`, `/:id/status`). Answers **404, not 403**, because a 403 confirms the ID names a real material.
- `rejectInaccessibleMaterials(req, res, ids)` — for `material_ids` in a body (`/concepts/batch`, `/generate-flashcards`, `POST /api/chat`). Returns `false` after sending a 403; the handler must return immediately. Every ID must pass, so one allowed ID cannot smuggle a forbidden one through in the same batch.

### Study Spaces — One Subject, Auto-Filled
A study space covers exactly one subject (`study_spaces.subject`, FK → `subjects.code`), chosen at creation and **immutable** afterwards — its decks, tests and mastery are all built from its materials, so re-pointing it would strand that work.

A space's contents live in `study_space_materials`. It is a **stored list, not a live query**, which is what makes "N new materials available" possible — the count is a set subtraction:

```
available_count = (published to space.subject + student's grade, not archived) − (already linked)
```

- `POST /api/spaces` creates the space and immediately links every published material for that subject + grade. A new space is never empty.
- `GET /api/spaces/:id/materials` returns `{ space, materials[], available_count }`. Owner only, 404 otherwise. Each material carries `concept_count`.
- `POST /api/spaces/:id/materials/sync` links whatever is missing. Idempotent via `ignoreDuplicates` on the composite PK — re-running never duplicates.

**Reads filter the stored list against the live rules** (not archived, still in the student's grade, still this space's subject). So an educator archiving a material hides it from every student's space instantly while the link row survives — un-archive and it returns on its own. There is no polling; `available_count` arrives with the material list the tab already fetches on open.

Students cannot upload, delete, or remove materials. Pulling in newly published ones is their only write, and even that does not choose *what* arrives — the set is derived server-side.

### pgvector — Critical Notes
- The `embedding` column in the `concepts` table is a PostgreSQL `vector(3072)` type.
- **Supabase returns this column as a plain string** (e.g., `"[-0.013, 0.024, ...]"`), NOT as a JavaScript `number[]`.
- Always pass any embedding from the DB through the `parseVector()` helper in `cognitive.routes.ts` before using it in math.
- `generateEmbedding()` returns a proper `number[]` directly — no parsing needed for freshly generated embeddings.

### Free Recall Scoring — Coverage Ratio
The Free Recall evaluation pipeline works as follows:
1. **Extract:** Gemini extracts discrete concepts the student discussed from their raw text.
2. **Embed:** Each extracted concept is embedded individually (not the whole essay).
3. **Compare:** Each reference concept from the DB is compared against all student concept vectors via cosine similarity. The highest score is taken as the best match.
4. **Grade:** A reference concept is "Covered" if its best match score ≥ 0.70; otherwise "Missed".
5. **Score:** `similarity_score = coveredCount / totalConcepts` (coverage ratio, NOT average of raw scores).

> **Why coverage ratio?** Averaging raw cosine scores inflates results because even unrelated vectors score ~0.60–0.65 in a 3072-dimensional space ("hubness" problem). The coverage ratio makes scores honest and proportional to actual content discussed.

### Chat (RAG) vs. Full Context
The AI chatbot in ResourcesTab supports two modes (set via the `mode` field):
- `rag`: Performs semantic similarity search against stored concept embeddings, retrieves the top-N relevant concepts, and uses those as context for the LLM. Best for specific questions.
- `full`: Fetches all concepts for the selected material(s) and injects them all as context. Best for summaries. **Only one material is allowed** in this mode to avoid token limits (> 6000 tokens triggers a 413 error from Groq).

---

## Database

The full schema (all tables, columns, constraints, indexes, and RLS policies) is defined in [`schema.sql`](file:///d:/projects/LearnSyncAI/schema.sql) at the project root. This is the single source of truth — always update it when making database changes.

---

## Environment Variables (`.env`)

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
PORT=5000
APP_URL=http://localhost:3000
```

---

## Important Rules & Conventions

- **Never skip Zod validation.** Every POST/PATCH endpoint must validate its body. Zod is a TypeScript library that checks whether the incoming request body has the correct fields and types before any logic runs. All schemas are defined in `server/types/api.ts`. If validation fails, return a `400` immediately.
- **Never use raw `fetch`.** The frontend always uses the `api` instance from `src/lib/api.ts`.
- **Never use the Supabase anon client on the server.** Only `supabaseAdmin` is used server-side. Supabase has two keys: the *anon key* (public, for the browser, respects Row-Level Security restrictions) and the *service role key* (private, for the server, bypasses RLS). Server-side code must always use `supabaseAdmin` (service role), otherwise RLS policies will block most database queries.
- **Never change the embedding model.** `gemini-embedding-001` is fixed. Changing it invalidates all stored vectors.
- **A term appears at most ONCE per material — an invariant, not a tendency.** `conceptExtraction.ts` folds matching candidates *before* any embedding, joining their definitions in page order and unioning `source_pages`. Every downstream reader depends on it: the Feynman concept picker, Free Recall's coverage denominator, flashcard generation. **Never reintroduce a similarity threshold for same-term concepts** — the old 0.90 gate is exactly what let three rows named "SECURE SOFTWARE DEVELOPMENT" reach the database, where only the first was reachable.
- **`foldKey()` matches exactly, plus one mechanical convention: a trailing ALL-CAPS acronym is ignored.** `… Life Cycle (SSDLC)`, `… Life Cycle` and a bare `SSDLC` are one concept; the label carrying the acronym is the one kept. It is narrow on purpose — a *lowercase* parenthetical is a disambiguator, so `Bank (river)` and `Bank (financial)` must stay two rows. **The dividing line for any new rule: code settles mechanical patterns, educators settle judgement calls.** `Firewall`/`Firewalls` and genuine polysemy are judgement — they belong in the Concepts tab via `POST /api/materials/:id/concepts`, not in the fold.
- **Embed after merging, never before.** The stored `concepts.embedding` must describe the stored `definition`. An earlier version swapped in a longer definition during the merge but kept the original's vector, so Free Recall (0.70 threshold), chatbot RAG (0.60) and cross-term dedup all read a vector for text that no longer existed.
- **Always run `npm run lint` after changes.** The project uses `tsc --noEmit` as its linting step.
- **Three user roles exist: `student`, `educator`, and `admin`.** Use the appropriate `requireRole()` middleware for each endpoint. Admin manages accounts only. Educators manage materials and view analytics. Students access learning features.
- **BKT is implemented directly in the backend.** Do NOT use pyBKT or any external BKT library. Do NOT implement Expectation Maximization (EM) parameter fitting. Use the default parameters specified in ARCHITECTURE.md.
- **Only educators upload materials.** Students access materials uploaded by their educators. Students cannot upload instructional materials, and the student UI must contain no upload control, no file picker, and no delete control.
- **Every flashcard route is owner-checked, reads included.** All of `GET/POST/PUT/DELETE /api/spaces/:id/decks*` and `POST /api/flashcards/rate` resolve to the caller's own space via `loadOwnedSpace()` (or card → deck → space) and answer **404** otherwise. Reads are guarded as tightly as writes on purpose: a space id is visible in the address bar (`/student/space/:spaceId`), and a deck carries its owner's `ease_rating` and `next_review_at` — a direct readout of the concepts they are struggling with. Migration 0003 removed peer sharing to guarantee data isolation between students; an unguarded read contradicts that.
- **Students own decks but not cards.** A deck is the student's own folder for organising lessons: create, rename and delete are all theirs (`POST/PUT/DELETE /api/spaces/:id/decks`). The **cards inside are not** — there is no add/edit/delete card control and no such endpoint. Every card assesses a `concepts` row an educator uploaded and vetted (educators curate concepts via `POST/PUT/DELETE /api/materials/:id/concepts`), so a hand-written card would have no concept to attach mastery to, or would inject unvetted text into the knowledge base that also feeds Free Recall scoring, Feynman grading, the chatbot and adaptive tests. **Cards enter a deck by generation against a selected material and by no other route.** A new deck is empty by design.
- **A deck may gather several materials.** Decks are organisational, so "have I already generated this material?" is a question about cards, not decks: it is `flashcards.source_material_id` scoped to a `deck_id`. Do not add a `source_material_id` to `flashcard_decks` — it would force one deck per material and defeat the point.
- **The back of a flashcard is always the educator's definition, verbatim.** `POST /api/spaces/:id/decks/:deckId/generate` writes `definition` → back, plus `concept_id` and `source_material_id`, whatever the format. **A model never writes an answer** — the deleted helper did, which put unvetted text in front of students. Only the front varies, via `format`:
  - `'term'` (default) — front is the concept's `term`. No model in the path; instant.
  - `'question'` — `generateQuestionsForConcepts()` writes a question whose answer *is* that definition. ~13s for 68 concepts.
- **Question generation batches and echoes indices — do not "simplify" either.** `QUESTION_BATCH_SIZE = 20`: the old helper asked for one card per concept under `max_tokens: 4096` and truncates on a real material. The model returns `{ n, question }` and every `n` is range-checked before it is trusted, because a card whose `concept_id` is wrong is worse than one with no question. A concept the model skips **falls back to its term**, so a card is never lost and never unlinked. A Groq call that throws aborts the request with a 502 before anything is written — a deck half questions and half terms is worse than a clean retry.
- **`flashcards.is_ai_generated` means "the model wrote this front".** True only for cards whose question came back from Groq — false for term cards *and* for question-format cards that fell back. The 409 response derives `current_format` from it so a Refresh rebuilds a deck in the style it already has.
- **Re-generating a material into a deck reconciles, it does not wipe.** Matched by `concept_id`: existing cards are updated in place, new concepts inserted, cards whose concept is gone deleted. Never delete-then-reinsert — `spaced_repetition_logs.flashcard_id` is `ON DELETE CASCADE`, so wiping the cards destroys the student's rating history and resets every `next_review_at`. Without `replace: true` the endpoint answers **409** with the existing count and writes nothing.
- **Generation gates in order:** `requireRole('student')` → `loadOwnedSpace()` (404) → deck is in that space (404) → `rejectInaccessibleMaterials()` (403) → material is both published to (subject, grade) *and* linked in `study_space_materials` (404). The last check is not redundant: passing the grade rule only proves the student may read the material, not that this space holds it.
- **Every student-reachable route that takes a material ID must gate it** through `server/lib/materialAccess.ts`. RLS does not protect these routes — the service role bypasses it. Path IDs 404; body ID arrays 403.
- **A study space's subject is fixed at creation.** `UpdateStudySpaceSchema` deliberately omits it.
- **Peer sharing (CollabShare) is gone.** Migration 0003 removed it as contradicting the paper's data-isolation guarantee. Do not reintroduce `is_published`, `share_token`, `cloned_from_id`, or space cloning.
- **`schema.sql` is the DB source of truth.** When DB changes are made, update `schema.sql` to reflect them.
- **The `ai_feedback` column in `cognitive_logs` stores a JSON string.** Parse it with `JSON.parse()` before using it on the frontend. Treat every key inside it as optional — payloads have gained fields over time (`written_feedback`, `covered_count`, `analogy_used`), and older rows do not carry them.
- **`cognitive_logs.student_id` is `NOT NULL`.** Set it on every insert. It is not defaulted and no trigger fills it in; omitting it fails the write *after* the AI work is already done and paid for.
- **Free Recall and Feynman must never write mastery.** The paper's Scope section limits BKT updates to Adaptive Flashcards and Adaptive Test Mode. `bkt_mastery` has exactly one writer in the codebase: `practice.routes.ts`. Do not add a second from `cognitive.routes.ts`.
- **AI feedback that a student is scored on must be reproducible, and `findMemoisedAttempt()` is the only thing guaranteeing it.** `temperature: 0` used to be the mechanism; Gemini 3 dropped the sampling parameters, so there is no model-side knob left. Instead, an identical resubmission is answered from the row it produced last time — exact, and true whichever model is configured. **This is what makes the model a free variable rather than part of the guarantee**, so do not remove it when swapping models. It also means a resubmission costs zero API calls, which matters on a 20/day free tier.
- **The memo is keyed on a content fingerprint, not a timestamp.** `concepts` has **no `updated_at` column**, so an educator editing a definition changes nothing observable — `fingerprintConcepts()` hashes the concept id/term/definition set (plus the glossary, for Feynman) and stores it as `concepts_fingerprint` inside `ai_feedback`. An educator edit changes the hash and correctly forces a fresh evaluation. Rows written before the field existed have no fingerprint and are deliberately never reused.
- **A memo hit still writes a `cognitive_logs` row.** A resubmission is a real attempt and must appear in the student's history exactly as before; only the model calls are skipped.
- **A failed feedback call must never cost a student their score.** Generation is wrapped in its own `try/catch`, returns `null`, and sits outside the scoring block and before the insert. The row saves regardless and the response carries `feedback_unavailable`.

---

## Flashcards Tab — Layout

**Study is on the deck tile, not behind the deck view.** Opening the tab and starting a session is one click. The deck view still exists — for browsing cards, adding another lesson, renaming and deleting — but it is no longer a step you pass *through* to reach studying. A tile shows exactly one action: **Study** when it has cards, **Add Cards** when it does not.

**A deck's summary line is derived, not stored.** `deckSummary()` reads the distinct `sourceMaterialId`s of the deck's cards and resolves them against `availableResources`, giving "68 cards · from 6. Information Security" or "· from 2 lessons". Nothing on `flashcard_decks` records this — see the rule above about not adding `source_material_id` to the deck.

**The rating buttons in the study view are always rendered, disabled until the card is flipped.** They used to be swapped in on flip, which moved the page on every single card. Disabled-not-absent keeps the layout still. `handleRate()` already refuses when `!isFlipped`, so the guard is unchanged and Easy/Medium/Hard record exactly what they always did.

**Card faces scroll internally** (`flex-1 overflow-y-auto` between a fixed header and footer). Definitions run to ~300 characters and previously overflowed a fixed-height card with no way to read the rest.

**The results ring says "Session Score", never "Mastery".** It is `(easy + medium × 0.5) / cards` — a tally of self-ratings for one session. BKT mastery is a per-concept probability in `bkt_mastery` owned by the backend. Using one word for both invites a reader to mistake this figure for the paper's.

**On phones the three rating buttons stay side by side**, losing their "Review in N days" sublabel rather than stacking. Stacked full-width buttons pushed the card off screen, which would mean scrolling between flipping and rating on every card.

## Flashcards — Spaced Repetition

**One rule governs everything: a rating counts only if the card was due.** `next_review_at` moves — and, when BKT lands, mastery updates — if and only if `next_review_at <= now()` at the moment the student rates. Every other rating is practice: nothing is written, and `POST /api/flashcards/rate` answers `counted: false`. No column was needed for this; `flashcards.next_review_at` defaults to `now()`, so a fresh card is born due and the first honest pass always counts.

That single check covers retries, "Restart Entire Set", cramming before a test, and studying the same deck three times in a day. **Do not special-case any of them, and do not add a session id or a practice flag** — a card rated moments ago is not due, which is the whole mechanism.

**Why retries must not count.** A student rates Hard, presses "Drill hard cards again", and rates the same card Easy thirty seconds later — because they just read the answer. That is working memory, not knowledge. Counting it drives mastery *up* on exactly the concepts the student is weakest at, and lets anyone farm mastery by re-drilling one card. BKT assumes each observation is an independent test of latent knowledge; a retry is not one, which is why ITS implementations score the **first attempt** and treat later ones as help-seeking.

**The client never decides this.** `FlashcardStudyView` posts every rating, including in a practice round — a "Practice all" session over a deck with 12 genuinely due cards must still schedule those 12. The server checks and returns `counted`; the UI reports what actually happened rather than asserting it.

**`server/lib/reviewSchedule.ts` is the only place intervals and due-ness are defined.** `REVIEW_INTERVALS` is Easy 7 / Medium 3 / Hard 1, matching `CHECK (interval_days IN (1, 3, 7))`. Four separate places used to disagree about Easy (7 vs 4) and the database would have rejected 4 outright. `FlashcardsTab` has a small `isDue()` mirroring the server's, for display and session composition only.

**Due dates land on midnight Asia/Manila, not `now + N × 24h`.** A student who rates at 8pm Monday and revises after school on Tuesday must find their cards waiting; exact 24-hour intervals would hide them until 8pm and the deck would look broken. `nextReviewAt()` shifts into the Manila frame, truncates to the date, adds the interval and shifts back. A fixed +8 offset is correct — the Philippines has observed no DST since 1978. If the platform ever spans timezones this becomes a per-profile setting.

**Sessions are due-only; the card grid always shows everything.** Different jobs. A deck tile reads `68 cards · 12 due` with a *Review 12* button, falling back to `next review Tue 4 Aug` and a quiet *Practice all* when nothing is due. The grid inside a deck is for browsing a lesson, so scheduled cards are marked `Due in 3 days` — never hidden, or the deck would look emptied.

**The results screen reports what was rescheduled, never asserts it.** It counts `counted` responses: "12 cards rescheduled" or "Nothing was rescheduled — these weren't due yet." The old unconditional "Your next review dates have been scheduled" was false after any practice round.

**`POST /api/flashcards/rate` walks card → deck → space and 404s unless the space is the caller's.** It previously took any card UUID from any student. Once BKT hangs here, that would have written mastery against a stranger's concepts.

`GET /api/flashcards/due/:spaceId` was deleted — unused, and it returned any space's cards to any logged-in user. Due-ness is derived from cards the tab already loads. It can return, properly guarded, when the dashboard becomes real.

### BKT on top of this (still NOT implemented)

The rating endpoint is now the right place to hang it: ownership is enforced, `concept_id` is on both the card and the log row, and the due check already gates what counts. **The observation mapping is settled in `bkt_params`:** `g_easy = 0.05`, `g_medium = 0.25`, `g_hard = 0.10`; Easy and Medium are correct observations (obs = 1), Hard is incorrect (obs = 0). `bkt_update_logs` already carries a `flashcard_id` column and a `'flashcard'` value in the `bkt_source` enum.

`StudentDashboard.tsx` still shows a hardcoded `dueToday = 12`; the whole page runs on `MOCK_STUDENTS[0]` and is a separate job.

## Cognitive Tabs — Free Recall & Feynman

Both tabs have a Study / History toggle in the header. **Submitting keeps you in Study** — the result replaces the composer where the student is already looking, rather than moving them into History. History is a view they choose: an always-visible attempts list beside the selected attempt (stacked on mobile).

Each tab therefore tracks two selections, `resultLogId` (shown in Study after submitting) and `historyLogId` (clicked in the list). One shared variable would make the two views fight over it.

Everything a student reads after submitting — the verdict banner, the feedback cards, the collapsible detail, the attempts list — comes from `src/pages/student/studySpaceTabs/cognitiveShared.tsx`, and both views render the result through the same `resultView()` helper, so there is one result layout rather than two. That file is used by those two tabs only; it is not part of the global design system.

**Free Recall scoring is a coverage ratio against every concept in the material.** Extraction is granular — one lesson yielded 78 concepts, including supporting detail like "radio waves" that nobody recalls from memory — so good recall lands near 20–30%, not 75%. The verdict bands are calibrated to that (Strong ≥ 0.30, Partial ≥ 0.15); the ratio itself is left honest. The written feedback is explicitly instructed **not** to recite the missed list for the same reason, and the UI collapses it.

**Feynman grades two independent axes.** `accuracy_score` (against the stored definition) drives the verdict and the ring; `simplicity_score` (against the audience rubric) is shown as a secondary bar. The verdict is derived in the backend from accuracy — asked for one directly, the model leaks the simplicity axis into it. The audience is fixed at a 10-year-old; `FEYNMAN_AUDIENCES` is a single-value enum so adding one later is a rubric, not a migration.

**Every cognitive endpoint enforces ownership itself.** `requireOwnedSpace()` (404) then `rejectInaccessibleMaterials()` (403). `requireRole('student')` only proves the caller is *a* student — it says nothing about *whose* space or *which* grade's materials.
