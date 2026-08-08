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
| `GEMINI_LEGACY_TEXT_MODEL` | `gemini-2.5-flash` | nothing — dead default of `generateJson()` | ⚠️ **remove the default** |

**Adaptive test generation is on Groq, not Gemini.** It was the last `GEMINI_LEGACY_TEXT_MODEL` caller and is now `llama-3.3-70b-versatile` in `server/lib/testGeneration.ts`. The reason is the quota line below: 20 requests/day *per model* is already spent by extraction, Free Recall and Feynman, and a 50-student study cannot add a fourth consumer to it. The paper (p. 81) says only "the large language model", so nothing in the write-up depends on the provider. `GEMINI_LEGACY_TEXT_MODEL` now has no callers and survives only as `generateJson()`'s default — that default is a trap for the next call site and should be removed.

**Choosing a constant for a new call site — one question:** *does the model's own judgement become a number the student is shown?* Yes → `GEMINI_GRADING_MODEL`; no → `GEMINI_UTILITY_MODEL`. Free Recall is the instructive case: it looks like grading, but the model only enumerates what the student mentioned and the score is `coveredCount / totalConcepts` computed in code, so it belongs on the utility model. Feynman's `accuracy_score` comes straight from the model, so it does not.

- **`gemini-2.5-flash` is already gone, not going.** Verified 2026-08-01 against our own API key: every call returns `HTTP 404 — "no longer available to new users"`. It is still returned by `ListModels`, which is why it looks alive from the outside. Its last caller (adaptive test generation) moved to Groq on 2026-08-06, so nothing reaches it now. See `LearnSyncAI artifacts/GEMINI_MIGRATION_STATUS.md`.
- **Never send `temperature` to a `gemini-3*` model.** Gemini 3 dropped the sampling parameters: `temperature`, `top_p` and `top_k` are ignored today and a future model generation returns HTTP 400 for them. `generateJson()` strips `temperature` on Gemini 3 and logs a warning; treat that warning as a bug to fix at the call site, not noise.
- **Gemini 3 thinks by default** (`medium` on 3.6-flash, `minimal` on Flash-Lite) and thinking tokens draw on `maxOutputTokens`. Set `thinkingLevel` and `maxOutputTokens` explicitly on any Gemini 3 call, or a tight budget truncates the response and surfaces as unparseable JSON.
- **Free-tier request quota is per model** (`GenerateRequestsPerDayPerProjectPerModel`, observed limit **20/day**). Using a distinct model for utility calls is therefore not only cheaper, it buys a separate daily bucket. Embeddings are metered separately again.
- **Cost is not the lever people assume.** Across the paper's 50-student study the entire spread between "3.6-flash everywhere" and "Flash-Lite everywhere" is roughly $14 vs $3. Never trade grading quality for that.

### BKT Implementation
- BKT is implemented **directly in the platform backend** — `server/lib/bkt.ts` — using the classical four-parameter update equations. ✅ **Implemented and verified.**
- The system does **NOT** use pyBKT. `bkt_service/` and `server/routes/bkt.routes.ts` were deleted when the engine landed; do not reintroduce either.
- Data-driven parameter estimation methods such as **Expectation Maximization (EM) are not used** because the platform has no pre-existing historical student interaction data.
- Parameters are **read from the `bkt_parameters` table**, never hardcoded at a call site:
  - `P(L₀) = 0.10` (initial knowledge state)
  - `P(T) = 0.20` (transition/learning rate)
  - `P(S) = 0.15` (slip probability)
  - `P(G)` = context-sensitive, varies by assessment mode and question format
- **Cite these values carefully.** Bulut et al. (2023) is the source of the four-parameter *framework*, and Šarić-Grgić et al. (2024) collects the *limits* the values must fall inside (Corbett & Anderson P(G) < 0.30; Beck & Chang P(G) + P(S) < 1; Baker et al. P(G) < 0.50). The paper is explicit on p. 71 that *"the knowledge tracing literature does not recommend specific numbers for these parameters"* and on p. 76 describes them as *"selected configuration values operating within published limits"*. Do not describe them as empirically derived from research.
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
│   │   │                          # (no bkt.routes.ts — BKT is not client-triggered)
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

**Step 1 must stay GRANULAR — one item per idea, never one per paragraph.** This is the single most load-bearing line in the pipeline and it is easy to undo by "tidying" the prompt. Each extracted item becomes one vector, and a point that summarises a paragraph embeds as an average of everything in it, so no individual concept inside matches above 0.70. Measured: a coarse prompt yielded **8 points** from a six-paragraph answer and produced **five false misses**; the granular rules took the same answer to **25 points and one**. Educator-side extraction stores each item of an enumeration as its own concept (`Preparation`, `Containment`, `Reduces Downtime`), so a student writing them in one sentence must be split the same way or the two sides cannot line up. This is also why the call runs at `ThinkingLevel.LOW` with `maxOutputTokens: 8192` — thinking off will not split a list, and a budget sized for coarse output truncates mid-array.

**Naming a concept is not covering it.** The prompt records "they only named it without elaborating" verbatim, which embeds far from a substantive definition. A student who lists "the data link layer, the network layer and the transport layer" without saying what they do is correctly marked missed on all three — Free Recall measures retrieval, not vocabulary.

**The written feedback may only name gaps that appear in the missed list.** It is prose the student reads as fact about their own answer, and the earlier coarse extraction let it tell a student "you did not mention how incident response helps reduce downtime" when their answer contained the words "reduces downtime". The prompt now forbids inferring a gap from the score, the answer's length, or a topic the model expected and did not see.

**Coverage is not correctness, and `written_feedback.corrections` is the only thing that says so.** Cosine measures whether the student wrote *about* a concept, not whether they were right: a sentence calling RA 10175 the Data Privacy Act scored **0.7175** and counted as covered, and calling the Physical Layer the top layer scored **0.7474**. Being wrong is never penalised — the worst case is being scored as if you said nothing. So the feedback prompt receives, for each student point, the lesson text that could settle it, and may add a short note quoting the contradiction.

**That pairing is a term lookup FIRST, with vectors only as the fallback — not the other way round.** A student explaining injection writes the word "Injection", and `conceptIdxByAlias` resolves that name straight to the concept. Vectors cannot be relied on here, because being badly wrong about something *reorders its neighbours*: measured on a real submission, "Injection is when a hacker plugs a USB stick into the server" ranked the actual `Injection` concept **sixth**, behind XSS, SQLi, File Inclusion, Integrity Failures and Cybersecurity — so a nearest-only pairing sent XSS's definition and the error went unflagged. The aliases come from extraction's own `foldKey`/`acronymOf`, exported for this, so a student typing "SSDLC" lands on `SECURE SOFTWARE DEVELOPMENT LIFE CYCLE (SSDLC)`; do not write a second copy of that rule here.

**The vector fallback takes the top TWO and ignores `COVERAGE_THRESHOLD`.** Two, because the reordering above also affects claims the student never named; ignoring the threshold, because a badly wrong statement scores *below* 0.70 against the concept it is wrong about (0.609 for that USB sentence), so restricting this to covered concepts would miss exactly the errors most worth catching.

**`corrections` is prose and must never move the score.** `similarity_score` stays a pure cosine computation, which keeps it deterministic given the extraction and keeps this call on `GEMINI_UTILITY_MODEL` — the rule is whether the model's judgement becomes *a number the student is shown*, and this one only ever becomes words. Letting it remove coverage credit would force the grading model and make "coverage ratio" an inaccurate description of the method.

**That call runs at `ThinkingLevel.MEDIUM`, and dropping it to LOW silently breaks it.** Comparing ~25 claims against ~20 definitions is the real work here. Measured on an answer with two deliberate errors: at LOW the model found the name swap, stopped, and then **praised the second error in `strengths`**; at MEDIUM it caught both and `strengths` narrowed to the parts that were genuinely right. The prompt names reversed mechanisms explicitly for the same reason — the vocabulary matches the lesson perfectly and only the direction is wrong, so it reads as correct.

**`written_feedback` is ONE prose field plus `corrections` — `feedback`. Do not split it.** It was `strengths` / `gaps` / `next_steps`, and across every logged attempt **`next_steps` was a paraphrase of `gaps`** ("you left out injection" → "review injection"). That is what forced structure does: the model must fill a slot, has nothing new, and repeats. Merging `strengths` and `gaps` fixed that; the remaining split was then kept on the theory that a concrete action is the hardest sentence to write and would be crowded out of a free passage. **That was measured and disproved** — run against two stored submissions including a 28/28 attempt with no obvious gap to point at, the merged prompt still closed with "try reviewing Injection on page 24" and "review security headers on page 39". A field per idea is not what makes feedback rich.

**The passage must weave what landed with what did not, never split into a praise half and a criticism half.** The split is where the repetition bred. It describes coverage and must **never certify correctness** — coverage is cosine similarity, which measures whether the student wrote *about* a concept, not whether they were right (a sentence calling RA 10175 the Data Privacy Act scored 0.7175 and counted as covered). Contradictions belong in `corrections`, which is checked against the lesson's own definitions.

**Old rows are not migrated.** Attempts logged before the merge hold `summary` and `next_steps`; `feedbackText()` in `FreeRecallTab.tsx` joins them, so History renders one card throughout. `ai_feedback` keys are optional by convention — do not assume `feedback` exists on a stored row.

**The most useful sentence the passage can write is why a named concept still didn't count.** The raw answer and the missed list are both in the prompt, so "you listed injection among the risks but didn't say what it does, so it didn't count" is derivable — and that distinction is invisible from the score alone, so students otherwise read it as the app losing their work.

**The passage must CLOSE with a page-anchored action, and that is now prompt-enforced rather than schema-enforced.** `concepts.source_pages` reaches the prompt twice — inline on the missed list, and as a full concept→page index so a page can still be cited at 100% coverage, where there is no gap to point at. Two full-coverage attempts previously said "review the section on access control **in your lesson materials**" because only missed concepts carried pages. Pages may be taken **only** from that index; the model must never guess one. Since no schema field guarantees the closing sentence any more, check it survived when changing this prompt.

**`corrections` catches most planted errors but not all — measured 5 of 6.** Across the acceptance runs it caught a reversed SSDLC mechanism, an RA 10173/10175 name swap, an inverted Physical Layer, a USB-hardware misreading of Injection, and Data Subjects described as organisations. It **missed** the National Privacy Commission being attributed to RA 10175, with the contradicting definition sitting in the prompt. It stops early on a multi-error answer despite being told not to. Acceptable because the failure is silence: the note never moved a score, and across every run **it has never flagged a statement that was actually correct** — which is the failure that would matter. Do not chase the last error by loosening the rules; a false accusation costs far more than a missed one.

**Two known limits, both pre-existing.** Domain hubness still lets a few unrelated concepts clear 0.70 (`SQL Injection` scored 0.718 against an answer that never mentions it), and because extraction is a sampling step the same text re-submitted scores within roughly ±10 percentage points — `findMemoisedAttempt()` pins byte-identical resubmissions, nothing else. Do not "fix" either by raising the threshold without re-measuring false negatives; the two move in opposite directions.

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
- **Free Recall and Feynman must never write mastery.** The paper's Scope section (p. 58) limits BKT updates to Adaptive Flashcards and Adaptive Test Mode. `bkt_mastery` has exactly **two** writers, both going through `server/lib/bkt.ts`: `practice.routes.ts` (`PUT /:id/complete`) and `flashcards.routes.ts` (the `counted: true` branch of `POST /rate`). The `bkt_source` enum has exactly two values for the same reason. Do not add a third from `cognitive.routes.ts`, `games.routes.ts`, or anywhere else.
- **AI feedback that a student is scored on must be reproducible, and `findMemoisedAttempt()` is the only thing guaranteeing it.** `temperature: 0` used to be the mechanism; Gemini 3 dropped the sampling parameters, so there is no model-side knob left. Instead, an identical resubmission is answered from the row it produced last time — exact, and true whichever model is configured. **This is what makes the model a free variable rather than part of the guarantee**, so do not remove it when swapping models. It also means a resubmission costs zero API calls, which matters on a 20/day free tier.
- **The memo is keyed on a content fingerprint, not a timestamp.** `concepts` has **no `updated_at` column**, so an educator editing a definition changes nothing observable — `fingerprintConcepts()` hashes the concept id/term/definition set (plus the glossary, for Feynman) and stores it as `concepts_fingerprint` inside `ai_feedback`. An educator edit changes the hash and correctly forces a fresh evaluation. Rows written before the field existed have no fingerprint and are deliberately never reused.
- **A memo hit still writes a `cognitive_logs` row.** A resubmission is a real attempt and must appear in the student's history exactly as before; only the model calls are skipped.
- **A failed feedback call must never cost a student their score.** Generation is wrapped in its own `try/catch`, returns `null`, and sits outside the scoring block and before the insert. The row saves regardless and the response carries `feedback_unavailable`.

---

## Flashcards Tab — Layout

**Study is on the deck tile, not behind the deck view.** Opening the tab and starting a session is one click. The deck view still exists — for browsing cards, adding another lesson, renaming and deleting — but it is no longer a step you pass *through* to reach studying. A tile shows exactly one action: **Study** when it has cards, **Add Cards** when it does not.

**A deck's summary line is derived, not stored.** `deckSummary()` reads the distinct `sourceMaterialId`s of the deck's cards and resolves them against `availableResources`, giving "68 cards · from 6. Information Security" or "· from 2 lessons". Nothing on `flashcard_decks` records this — see the rule above about not adding `source_material_id` to the deck.

**The due-card badge is DERIVED from cards already loaded — do not add an endpoint for it.** `StudySpace.tsx` already fetches every deck with every card including `next_review_at`, and it is the same component that renders the tab bar, so the count is a filter over data in memory: `flashcardSets.flatMap(s => s.cards).filter(c => isDue(c.nextReviewAt))`. `GET /api/flashcards/due/:spaceId` was deleted for returning any space's cards to any logged-in user and **is not needed back**. It also self-refreshes: `exitStudy()` calls `onRefresh()` → `fetchSpaceData`, so finishing a session drops the badge with no extra wiring.

**`isDue()` lives in `src/lib/reviewSchedule.ts`, mirroring the server file of the same name.** It moved out of `FlashcardsTab` when `StudySpace` needed it — a tab exporting a utility up to its own parent is backwards, and two copies of a scheduling rule drift. The server stays authoritative; this only decides what to *show* and which cards a session opens with. The tab badge and the per-deck badges must both use it, or their numbers stop agreeing.

**A due deck's tile states the count exactly twice — badge and "Review N" button — and `deckSummary()` deliberately stops appending "· N due".** Three copies on one small tile read as noise. The not-due branch is unchanged, because "68 cards · next review Tue 4 Aug" is the useful thing to say when there is nothing to do.

**A brand-new deck shows as entirely due, and that is correct.** `flashcards.next_review_at` defaults to `now()`, so a freshly generated 29-card deck puts **29** on the badge. It reads like a backlog when the student made the deck a minute ago, but separating "new" from "needs revisiting" would change what the server counts as due — which is the single load-bearing check in `POST /api/flashcards/rate`. Shipped as-is deliberately.

**The rating buttons in the study view are always rendered, disabled until the card is flipped.** They used to be swapped in on flip, which moved the page on every single card. Disabled-not-absent keeps the layout still. `handleRate()` already refuses when `!isFlipped`, so the guard is unchanged and Easy/Medium/Hard record exactly what they always did.

**Card faces scroll internally** (`flex-1 overflow-y-auto` between a fixed header and footer), and are centred with **`my-auto` on the text — never `items-center` on the scroll container.** That distinction is not cosmetic. A centred flex item taller than its box overflows *both* edges, and the overflow past the top edge sits outside the scrollable region, so nothing reaches it: a 643-character definition opened mid-sentence with its scrollbar already at the top, and the first ~100 characters could not be read at all. An auto margin centres identically when the text fits and collapses to 0 when it does not. All four faces — both in `FlashcardStudyView` and both in the deck grid — had the bug; do not put `items-center` back on any of them.

**A face's type size is derived from its length**, via `faceTypeClass()` in `FlashcardStudyView.tsx`. The back is the educator's definition **verbatim** and is never truncated or summarised, so the card adapts to the text instead: the concepts table runs to a 162-character median but a term explained on two pages folds into one row and reaches 643. Past ~260 characters the back also switches from centred to left-aligned — centred text is comfortable for two or three lines and hard to read past that. On current data 44 of 57 definitions are unchanged, 6 short ones gain a size and 7 long ones lose one.

**`faceTypeClass()` takes a `kind` because the two faces need different curves.** A back is a passage; a front is a prompt — a term (23 characters on average, 96 at the longest) or a one-sentence generated question. Running the front down the back's curve would shrink an ordinary question to passage size in a card with room to spare.

**A face fades its bottom edge only while text remains below the fold** (`useMoreBelow()`). It follows scrolling rather than just measuring overflow once: a fade that stayed on at the end would wash out the last line of the answer. It measures rather than guessing from `.length`, because whether the same 300 characters overflow depends on viewport width and on the size `faceTypeClass()` chose.

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

### BKT on top of this ✅ implemented

`applyFlashcardRating()` runs inside the `counted: true` branch, so the due-check gates mastery exactly as it gates the schedule. Easy and Medium are correct observations (obs = 1) at `g_easy = 0.05` and `g_medium = 0.25`; **Hard is an incorrect observation** (obs = 0) at `g_hard = 0.10` — a low guess rate is what makes the drop steep, so Hard is not a weak pass.

**The schedule UPDATE is a compare-and-swap** (`.or('next_review_at.is.null,next_review_at.lte.<now>')` plus `.select('id')`), because the `isDue()` test reads a row fetched a moment earlier and a double-tap would otherwise apply the rating twice. It must be `.or(...)`, not `.lte(...)`: `isDue()` treats a NULL schedule as due, and `next_review_at = NULL` never satisfies `<=`, so a plain `.lte` would make such a card permanently unratable.

**Two Easy ratings put a concept at 0.98** (0.10 → 0.7231 → 0.9824), which clears the `advanced` threshold — far faster than the test path (two correct MCQs reach 0.7685). That is what P(G) = 0.05 means and the paper specifies it; the brake is the due-check pushing the card seven days out. Do not "fix" it.

`StudentDashboard.tsx` still shows a hardcoded `dueToday = 12`; the whole page runs on `MOCK_STUDENTS[0]` and is a separate job.

## BKT Engine

> **Full reference: `LearnSyncAI artifacts/BKT_IMPLEMENTATION.md`.** Read it before changing anything
> here — it carries the equations with their page citations, the measurements behind every rule, the
> debugging playbook with verified SQL, and §4's three behaviours that look exactly like bugs and are
> not. What follows is only what must not be broken by accident.

**`server/lib/bkt.ts` is the only implementation.** Two-phase update per observation — evidence (EQ 1/2) then transition (EQ 3) — with the post-transition value persisted as `latent_mastery`. Parameters come from the `bkt_parameters` table via a process-lifetime cache, warmed at boot in `server/index.ts` so a bad row shows up in the boot log rather than mid-assessment.

**`npx tsx scripts/bkt-verify.ts` is the paper's evidence, not a test script.** The study reports an *Implementation Correctness Rate* (EQ 6, p. 96): hand-compute a value, compare against the system, pass within ±0.01. The harness prints an appendix-ready table and exits non-zero below 100%. `--live` adds sections that drive the real HTTP endpoints; it builds a throwaway student and deletes it, so it is safe to re-run. `--live-test` also sits a full generated test and **burns one of ~11 daily Groq generations**.

**Its non-circularity rules are the point of it, and are easy to destroy.** §2 imports `bktStep` and nothing else — every P(G) is a literal, because looking one up through `GUESS_KEY_BY_FORMAT` would let a wrong mapping pass on both sides. §3 checks the engine against an independent **odds-ratio derivation** of the same equations. §5 checks convergence against closed-form roots solved by hand. If you add cases, keep the rule.

**Three behaviours that look like bugs and are not:**
- **Getting everything wrong RAISES mastery.** `posterior = e + (1−e)·P(T)` bottoms out at 0.20, above the 0.10 prior. Twelve wrong MCQs run 0.10 → 0.2174 → … → 0.2500, the root of `4L² − 5L + 1 = 0`. Every such limit is below the 0.50 tier threshold, so failure can never buy a harder test. **Consecutive-incorrect ICR literals therefore go up** — do not "correct" them downward.
- **Mastery is clamped to `[1e-9, 1 − 1e-9]`, not `[0, 1]`.** At exactly 1.0 an incorrect answer computes `evidence = P(S)/P(S) = 1`, so the concept can never be marked not-known again — and 13 consecutive Easy ratings reach exactly 1.0 in floating point. Continuous BKT asymptotes but never arrives, so the absorbing state is a float artifact, not the model.
- **A missing `bkt_mastery` row means P(L₀) = 0.10, not 0**, applied at read time. Rows are never pre-seeded.

**`bkt_update_logs` is evidence, not a debug log.** Every row carries the prior, all three applied parameters, and *both* phases (`p_l_evidence` = EQ 1/2, `p_l_posterior` = EQ 3) so the ICR comparison is one query. `p_slip`/`p_transit` are written explicitly rather than left to the column DEFAULTs — the trail must record what was applied, not what the schema assumed. `created_at` is staggered a millisecond per row in chain order, because Postgres `now()` is transaction-start time and a batch insert would otherwise give every row an identical timestamp and scramble `ORDER BY created_at`.

**Write order is mastery first, then logs, and a failed upsert writes no logs at all.** `bkt_mastery` is the state everything reads; the audit trail has no runtime reader. Mastery-written-log-missing is reconstructable from telemetry; log-written-mastery-missing leaves the next row's `p_l_prior` contradicting this row's `p_l_posterior`, which is permanent corruption of the thing the paper rests on.

**A BKT failure must never cost a student their score.** Both call sites await it inside their own `try/catch` and log through `bktProblems()`. Not fire-and-forget: Express 4 does not forward async rejections and there is no `unhandledRejection` handler.

**`opportunity_count` is reporting metadata and must never enter the arithmetic.** The paper uses "learning opportunity" only as the time index `t`.

## Analytics Tab — showing mastery to students

> **Full reference: `LearnSyncAI artifacts/ANALYTICS_IMPLEMENTATION.md`.**

**A concept with no `bkt_mastery` row must never be shown a percentage.** It sits at P(L₀) = 0.10, which is an assumption, not a measurement — a 29-concept lesson where six questions were answered leaves 23 concepts reading 0.10. Gate on `assessed` (per concept) or `assessed_concept_count` (per material), **never on `mastery === 0.1`**. Assessed concepts get a bar and a percentage; untested ones get their name and nothing else.

**The sharper reason, which makes this correctness rather than kindness:** the transition step floors every posterior at P(T) = 0.20, so *any* assessed concept is ≥ 0.20 and an unassessed one at 0.10 would rank **below every genuinely struggling concept**. A weakest-first list including them would fill with concepts the student has never seen.

**Two read endpoints, both read-only forever.** `GET /api/practice/space/:spaceId/mastery` is the summary and Test Mode's hot path — do not widen it. `GET /api/practice/space/:spaceId/mastery/concepts` adds every concept, in one request (~190 bytes each; 10.7 KB measured for 57 concepts). Both go through `requireOwnedSpace()` and compute EQ(4) with `documentMastery()`, which is **the only place the mean and its 4dp rounding live**.

**`src/lib/mastery.ts` owns the client side** — types, `TIER_TONE`/`TIER_LABEL`, `masteryCaption()` and both API calls. Not `testMode.ts`: mastery is fed by flashcards as well as tests. `foundational` renders `neutral`, never `poor` — everyone starts there.

**Do not add a client cache.** `<main key={activeTab}>` remounts the tab on entry, so data is fresh by construction — including on return from Test Mode having just moved the number, which is exactly when a cache would be stale.

## Adaptive Test Mode

> **Full reference: `LearnSyncAI artifacts/TEST_MODE_IMPLEMENTATION.md`.** Read it before changing anything here — it carries the measurements behind each rule, the debugging playbook, and the list of defects deliberately left open. What follows is only what must not be broken by accident.

**Rebuilt from scratch on 6–7 August 2026** (frontend, then backend). The version replaced made zero network calls and generated questions in the browser from hardcoded neuroscience mock data; its three endpoints had zero callers and six defects, including a `practice_telemetry` insert that omitted `question_type NOT NULL` and had therefore **never once succeeded**. No migration was needed — every column already existed unused.

**Generation is Groq `llama-3.3-70b-versatile`, not Gemini.** The paper (p. 81) says only "the large language model"; the Gemini claim was ours, in `ARCHITECTURE.md`, and has been corrected. The reason is the per-model 20/day Gemini quota that extraction, Free Recall and Feynman already spend. **⚠️ Groq's free tier is 12,000 tokens/minute and 100,000 tokens/day — about 11 tests/day for the whole account, which does not support a 50-student study.** Unresolved; needs a paid tier or Gemini billing.

- **One question per concept, and the student cannot choose the length.** `allocateConcepts()` in `server/lib/testAllocation.ts` derives it. A length picker meant cycling concepts to fill it, so a 40-item test on a 29-concept lesson asked about some concepts three or four times in one sitting — which BKT would read as four independent observations. `src/lib/testMode.ts` holds a **mirror** for the setup preview; the server is authoritative. Change one, change the other.
- **A matching block is exactly 4 terms against 6 definitions** (paper p. 75). The **six options** are the BKT rule — P(G_match) = 1/6 — and the **four terms** are a fidelity rule, since "applied per matched item" means the term count never enters the formula. If they ever conflict with something that affects scoring, bend the term count, never the option count. One block emits **four** telemetry rows.
- **The answer key never reaches the browser during a test.** `stripKey()` in `practice.routes.ts` is the only function that serialises a question to a client, and it allow-lists fields. Do not add a second serialiser.
- **`is_correct` is computed server-side, always.** `SubmitAnswerSchema` deliberately has no `is_correct` and no `concept_id` — accepting them let a student post arbitrary mastery evidence.
- **The model echoes an INDEX, never a `concept_id`,** and every echo is range-checked against its batch. A wrong id attaches mastery to the wrong concept and nothing downstream can detect it.
- **Difficulty is one tier per TEST, not per question** — paper p. 81 calls it "session-based adaptation", and `difficulty_tier`/`mastery_snapshot` are single columns. Thresholds are **0.50 / 0.85**, matching `mastery_tier()` in `schema.sql`. Both values are stored at generation because the paper's Difficulty Alignment check (p. 98) verifies exactly that.
- **A concept with no `bkt_mastery` row is at P(L₀) = 0.10, not 0,** applied at read time. Rows are deliberately not pre-seeded. Treating a missing row as zero would pin every test to `foundational` invisibly, since that is also the correct answer today.
- **Grading is deterministic — no model call.** `server/lib/testGrading.ts` reuses `foldKey()`/`acronymOf()` from `conceptExtraction.ts` so the "what counts as naming this concept" rule exists once. **Never add substring matching**: "Injection" is contained in "SQL Injection", and both are entries in the same lesson.
- **Telemetry is written ONCE, at completion,** one row per question — not per answer, because the UI lets a student revise and a per-answer write would double the observation. Completion is idempotent.
- **Test Mode writes `bkt_mastery` and `bkt_update_logs` at completion**, via `applyTestCompletion()` in `PUT /:id/complete`. It is fed the *same* `telemetry` array that was inserted, never a re-derivation from `questions_payload`, so the observations and the telemetry cannot disagree — and `count(bkt_update_logs) == count(practice_telemetry)` stays a valid reconciliation. A matching block already emits four telemetry rows, one per matched term, which is exactly p. 75's "applied per matched item"; it needs no special handling.
- **The completion UPDATE is a compare-and-swap** (`.eq('status', 'in_progress').select('id')`). The status check above it reads a row fetched moments earlier, so two racing requests both fall through — which before BKT duplicated telemetry and now would double every observation in the test.
- **An unanswered question is still an observation.** `buildResult` already grades a skip as incorrect and the score already divides by total, so mastery must agree. Abandoning a test therefore nudges mastery *up* slightly, per the P(T) floor — the abuse vector is inverted and weak.
- **`mastery_snapshot` is pre-test and must stay pre-test.** After completion writes mastery, the value on that row is still the one its tier was chosen from, which is exactly what the Difficulty Alignment check (p. 98) needs. Do not "refresh" it.
- **Concept ordering in `POST /` is document order and should stay that way.** Weakest-first would change nothing — `allocateConcepts()` emits one question per concept for *every* concept — and its sign is wrong anyway, since `orderedFormats()` would hand the least-known concepts the highest P(G).
- **`npx tsx scripts/set-test-mastery.ts <tier|reset>`** forces mastery to check the tiers directly. It now *competes* with the live engine — real answers overwrite whatever it sets — so `reset` before a genuine run.

## Cognitive Tabs — Free Recall & Feynman

Both tabs have a Study / History toggle in the header. **Submitting keeps you in Study** — the result replaces the composer where the student is already looking, rather than moving them into History. History is a view they choose: an always-visible attempts list beside the selected attempt (stacked on mobile).

Each tab therefore tracks two selections, `resultLogId` (shown in Study after submitting) and `historyLogId` (clicked in the list). One shared variable would make the two views fight over it.

Everything a student reads after submitting — the verdict banner, the feedback cards, the collapsible detail, the attempts list — comes from `src/pages/student/studySpaceTabs/cognitiveShared.tsx`, and both views render the result through the same `resultView()` helper, so there is one result layout rather than two. That file is used by those two tabs only; it is not part of the global design system.

**Free Recall scoring is a coverage ratio against every concept in the material.** Extraction is granular — one lesson yielded 78 concepts, including supporting detail like "radio waves" that nobody recalls from memory — so good recall on *that* lesson lands near 20–30%, not 75%. The ratio itself is left honest. The written feedback is explicitly instructed **not** to recite the missed list for the same reason, and the UI collapses it.

**A Free Recall percentage means nothing on its own, and the UI must never imply otherwise.** The denominator is whichever material the student picked, so the same standard of recall reads very differently depending only on how finely that document was broken up. There used to be absolute verdict bands (Strong ≥ 0.30, Partial ≥ 0.15) tuned against the 78-concept lesson above; applied to a 29-concept one they put an **86% answer and a 36% answer containing two factual errors** in the same "Strong" band. **Do not reintroduce a fixed threshold on this ratio** — any constant is wrong for the next material uploaded.

**What replaced it is the one comparison that holds: the same student, same material, versus their own earlier attempt.** `progressLine()` in `FreeRecallTab.tsx` matches on `material_ids` — which is why `GET /api/cognitive/history` selects that column — and compares `covered_count`, not percentages, since the denominator is held still. It refuses to compare when `total_concepts` differs, because an educator editing the material changes what the number is out of.

**A direction is only claimed past a noise floor of `max(2, ceil(total × 0.1))`.** Extraction is a sampling call, so re-running the *same text* moves the result: measured 14, 16 and 17 covered across three runs of one submission — a spread of 3 on 28 concepts. Below that, the line reads "about the same"; reporting a 1-concept wobble as improvement would be feeding noise back to the student as progress. A drop is amber, never red — a dip between attempts is ordinary in retrieval practice.

**`overall_verdict` is still computed and stored, and is deliberately not displayed.** Keeping it leaves the payload shape and `FreeRecallFeedback` unchanged and preserves the distribution for analysis.

**The score ring and the attempts list use one FIXED tone, and what matters is that it never varies.** A colour that moved with this percentage would reintroduce the bug one layer down — an attempt on a coarsely-split material would outrank a better attempt on a granular one purely because of how the document was divided. **Do not swap the fixed tone for `scoreTone()`; its 80/60 cutoffs are absolute too.** Meaning lives on the progress line, which compares like with like, and on `corrections`, which compares against the lesson's own definitions.

**Feynman grades two independent axes.** `accuracy_score` (against the stored definition) drives the verdict and the ring; `simplicity_score` (against the audience rubric) is shown as a secondary bar. The verdict is derived in the backend from accuracy — asked for one directly, the model leaks the simplicity axis into it. The audience is fixed at a 10-year-old; `FEYNMAN_AUDIENCES` is a single-value enum so adding one later is a rubric, not a migration.

**Every cognitive endpoint enforces ownership itself.** `requireOwnedSpace()` (404) then `rejectInaccessibleMaterials()` (403). `requireRole('student')` only proves the caller is *a* student — it says nothing about *whose* space or *which* grade's materials.

**Both submit handlers hold a `useRef` latch, and it is not redundant with the button's `disabled`.** `disabled` and `canEvaluate` read React state, which does not re-render until the handler yields, so a double-click enters the handler twice with `isEvaluating` still `false` and fires two submissions. Observed: one Feynman answer graded **0.95 and then 0.90** three seconds apart from byte-identical input, because both requests ran their memo lookup before either had written its row — so both missed it, both spent model calls, and the same explanation earned two different marks. The latch is set synchronously before the first `await` and cleared in `finally`.
