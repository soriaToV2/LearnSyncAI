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

**Two Gemini text model strings are in play across five constants, and they do not share semantics.** Every constant lives in `server/lib/gemini.ts`; nowhere else may name a model string. **There is no default model anywhere** — `generateJson()` and `generateJsonFromDocument()` both require one, so a call site that forgets is a compile error rather than a 404 on a live student request.

| Constant | Model | Used by | Status |
|---|---|---|---|
| `GEMINI_EXTRACTION_MODEL` | `gemini-3.6-flash` | Educator concept extraction (`conceptExtraction.ts`) | ✅ working |
| `GEMINI_GRADING_MODEL` | `gemini-3.6-flash` | Feynman grading (`cognitive.routes.ts`) | ✅ working |
| `GEMINI_UTILITY_MODEL` | `gemini-3.5-flash-lite` | Free Recall extraction + coaching prose (`cognitive.routes.ts`) | ✅ working |
| `GEMINI_CONTENT_MODEL` | `gemini-3.6-flash` | Adaptive tests (`testGeneration.ts`), flashcard fronts (`questionGeneration.ts`), all three games (`gameContent.ts`) | ✅ working |
| `GEMINI_CHAT_MODEL` | `gemini-3.5-flash-lite` | RAG chatbot (`chat.routes.ts`) | ✅ working |

**Adaptive test generation came BACK to Gemini on 2026-08-18** — `GEMINI_CONTENT_MODEL` (`gemini-3.6-flash`) at `ThinkingLevel.MINIMAL`, in `server/lib/testGeneration.ts`. It had moved to Groq `llama-3.3-70b-versatile` on 2026-08-06 to dodge the per-model daily quota; Groq then **decommissioned that model on 17 June 2026** (verified against our own key: *"The model does not exist or you do not have access to it"*) and closed its paid tier to new signups, so the escape route no longer exists. The paper (p. 81) says only "the large language model", so nothing in the write-up depends on the provider. **Flashcard question generation followed on 2026-08-19** — same constant, same thinking level, in the new `server/lib/questionGeneration.ts` — and **all three game generators the same day**, in the new `server/lib/gameContent.ts`. **The RAG chatbot followed on 2026-08-19 too** — `GEMINI_CHAT_MODEL` at `ThinkingLevel.MINIMAL`, through the new `streamContent()` in `gemini.ts`, which is the only streaming call in the codebase. **Groq was removed entirely on 2026-08-19** — `server/lib/groq.ts`, the `groq-sdk` dependency and `GROQ_API_KEY` are all gone, and no code path names a non-Gemini provider. Every remaining mention of Groq in this codebase is a comment recording why something is shaped the way it is; none of it is live.

**Choosing a constant for a new call site — two questions, in order:** *(1) does the model’s own judgement become a number the student is shown?* Yes → `GEMINI_GRADING_MODEL`. *(2) if not, does the output become content a student reads as fact?* Yes → `GEMINI_CONTENT_MODEL`; no → `GEMINI_UTILITY_MODEL`. Free Recall is the instructive case for the first question: it looks like grading, but the model only enumerates what the student mentioned and the score is `coveredCount / totalConcepts` computed in code, so it belongs on the utility model. Feynman’s `accuracy_score` comes straight from the model, so it does not. **The second question exists because the first one alone is wrong for authoring** — test grading is deterministic (`testGrading.ts`), so no model judgement there ever becomes a score, which would send every question the model writes to the utility model. The Games section below records three measured failures from exactly that.

- **`gemini-2.5-flash` is already gone, not going.** Verified 2026-08-01 against our own API key: every call returns `HTTP 404 — "no longer available to new users"`. It is still returned by `ListModels`, which is why it looks alive from the outside. **`GEMINI_LEGACY_TEXT_MODEL` no longer exists** — it was deleted on 2026-08-19 along with `generateContent()`, its last namer, and `generateJson()`'s default that pointed at it. Nothing can reach the model by accident now. See `LearnSyncAI artifacts/GEMINI_MIGRATION_STATUS.md`.
- **⛔ DO NOT "UPGRADE" TO `gemini-3.7-flash`.** It looks like the obvious next step — launched 13 Aug 2026 with a headline *"50% introductory price cut"* — and it is a trap on three measured counts (verified 2026-08-18 against our own key). **It rejects `MINIMAL` thinking outright**: `HTTP 400 — "Thinking level MINIMAL is not supported for this model"`, floor is `LOW`. Since thinking tokens bill at the OUTPUT rate, that floor makes its cheapest possible call *dearer* than `gemini-3.6-flash` at MINIMAL. **It is not reliably available**: five consecutive requests at `LOW` gave four failures with *"This model is currently experiencing high demand"*, which is an unacceptable rate for a 50-student study. And **it is not cheaper today** — both are $0.75 / $3.75 per 1M through 31 Dec 2026; the advertised cut is measured against 3.7's own future price, not against 3.6's current one. Re-evaluate after the study if availability improves and MINIMAL lands. Not before.
- **Thinking level is the single largest cost and latency lever — measured, 17–18 Aug 2026, real keys, 120-word prompt.** Read the caveat before quoting any of it: Gemini latency varied wildly across repeated runs of an *identical* request, so treat one measurement as an anecdote.

  | Model | Thinking | Typical total | Notes |
  |---|---|---|---|
  | `gemini-3.5-flash-lite` | MINIMAL | **~1.9s** | 1.8 / 2.1 / 1.8 / 1.9 / 1.9s over five samples — the most consistent thing tested |
  | `gemini-3.6-flash` | MINIMAL | ~2.3s | but the same request an hour later ran 4.2–20.9s |
  | `gemini-3.6-flash` | LOW | ~5–7s | spiked to 32s |
  | `gemini-3.6-flash` | MEDIUM | ~8s+ | |

  The direction is certain even though the multiples are noisy, and **thinking tokens bill at the OUTPUT rate**, so this is a cost table as much as a latency one: across the 50-student study, leaving thinking at its default roughly doubles the bill (~$16 against ~$7) and multiplies latency by 10–27×. Which is why every call site sets `thinkingLevel` explicitly and the two that deliberately run at MEDIUM — Free Recall's feedback pass and Feynman grading — record their measured reason for it.
- **Never send `temperature` to a `gemini-3*` model.** Gemini 3 dropped the sampling parameters: `temperature`, `top_p` and `top_k` are ignored today and a future model generation returns HTTP 400 for them. `generateJson()` strips `temperature` on Gemini 3 and logs a warning; treat that warning as a bug to fix at the call site, not noise.
- **Gemini 3 thinks by default** (`medium` on 3.6-flash, `minimal` on Flash-Lite) and thinking tokens draw on `maxOutputTokens`. Set `thinkingLevel` and `maxOutputTokens` explicitly on any Gemini 3 call, or a tight budget truncates the response and surfaces as unparseable JSON.
- **Free-tier request quota is per model, and it bites in TWO windows — 5 per MINUTE and 20 per day.** Both are `…PerProjectPerModel`, so using a distinct model for utility calls buys a separate bucket of each; embeddings are metered separately again. **⚠️ One adaptive test is FIVE calls** — `testGeneration.ts` runs one per question format *in parallel*, which is the whole per-minute allowance in one request — all on `gemini-3.6-flash`, sharing both buckets with concept extraction, Feynman grading, flashcard fronts and games (one call each). That is roughly **four tests a day on a free key**, and it is the concrete reason the 50-student study needs the paid one.
- **✅ A PER-MINUTE REFUSAL USED TO BE REPORTED TO THE STUDENT AS THE DAILY ALLOWANCE BEING SPENT — fixed 2026-09-01.** Seen twice. Measured 2026-08-19: six game generations succeeded in ~36s, the seventh returned `HTTP 429 RESOURCE_EXHAUSTED … limit 5`, and a 90-second wait cleared it entirely. Seen again on Render on a **paid** key, which has no daily embedding cap at all: `Quota exceeded for aiplatform.googleapis.com/global_embed_content_requests_per_minute_per_base_model`. **`classifyFailure()` tested `quotaMetric` alone, and no single field is reliable** — `quotaMetric` (`…/generate_content_free_tier_requests`) names no window, `quotaId` (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`) does, and the aiplatform shape states it only in the prose. Worse, `parseUpstreamError()` collapsed `quotaId` into `quotaMetric` with `??`, so the one field that named the window was discarded whenever the one that did not was present. The prose fallback also required a literal `metric:` that the aiplatform wording does not write. **Now:** `quotaId` is its own field, the prose regex accepts both shapes, and `isPerMinuteWindow()` tests all three — so a burst gets the full transient backoff instead of `QUOTA_MAX_ATTEMPTS`. `quotaMessage()` no longer asserts "Free-tier … daily". **Regression-tested by `npx tsx scripts/gemini-error-verify.ts`** (no network, no key, no quota), which drives the real `withRetry` path with the exact upstream bodies from both incidents.
- **⚠️ A STUDENT MUST NEVER BE SHOWN `err.message` FROM A GEMINI FAILURE. `GeminiUnavailableError.userMessage` is their half.** `message` is operator detail and belongs in server logs, `materials.parse_error` and the educator’s Failed pill. They were one string until 2026-09-01, and two paths put it on a student’s screen verbatim: `chat.routes.ts` sent `message: err.message` (which `ResourcesTab` renders unmodified), and `ResourcesTab`’s `unavailableReason()` printed `parse_error` directly. Students were shown *“enable billing on the Google Cloud project behind this API key”* and, when a failure classified `fatal` and `withRetry` rethrew the SDK error untouched, **the raw Google JSON body including its `https://` documentation link**. Both routes now go through `studentFacingError()`, and the context-retrieval branch stopped hardcoding `500` over a typed 429. Nothing in a `userMessage` may name a key, a project, billing, a quota, a metric, an HTTP status or a URL — `gemini-error-verify.ts` asserts that.
- **`verifyGeminiCredential()` runs at boot, and it is a LIVE call, never a shape check.** `gemini.ts` only ever warned when `GEMINI_API_KEY` was *absent*, so a key that was present but unusable stayed silent until an educator uploaded a PDF and extraction 401’d several layers down — which is exactly what happened when one stray character was appended during a rotation paste. `server/index.ts` calls it beside `loadBktParameters()`, non-blocking, so a slow Google never delays startup and the check can never take the API down (verified: the server still serves `/api/health` with a rejected key). It uses `genai.models.list()` — free metadata, **not** `generateContent`, so it costs no generation quota. **Do not replace it with a prefix or length test:** both `AIza…` (39 char) and `AQ.…` (53 char) keys are valid and in rotation on this project, and a check written against the older format would reject four working keys.
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
- BKT mastery estimates are updated exclusively through **Adaptive Flashcards** and **Adaptive Test Mode**. AI-generated games, Feynman Technique, and Free Recall never update them.
  - ⚠️ **On the READ side the build differs from the paper, and this bullet used to hide it.** Paper p. 58 says all three "utilize existing mastery estimates" for personalisation. **Only the games actually do** (`server/lib/gameDifficulty.ts` — tier selection, the timer table, concept weighting). `server/routes/cognitive.routes.ts` contains neither the word `mastery` nor `bkt`: **Free Recall and Feynman neither read nor write mastery.** Their personalisation is the material's concept set, not the student's mastery of it. Do not repeat the old phrasing in UI copy — it was on the educator Class Performance tab and was wrong there.

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
│   │   ├── activity.ts            # THE only writer for activity_logs (streaks)
│   │   ├── badges.ts              # Badge catalogue + evaluator (no `badges` table)
│   │   ├── gemini.ts              # Gemini AI helpers (embedding, generation, JSON)
│   │   ├── gameContent.ts         # Trivia / crossword / term matching (Gemini)
│   │   ├── questionGeneration.ts  # Flashcard question fronts (Gemini)
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
│   │   ├── gamification.routes.ts # /api/gamification (game sessions, streak, badges)
│   │   │                          # (no bkt.routes.ts — BKT is not client-triggered)
│   │   ├── chat.routes.ts         # /api/chat (RAG-based study assistant)
│   │   ├── dashboard.routes.ts    # /api/dashboard (the one global student read)
│   │   ├── educator.routes.ts     # /api/educator (class-level mastery analytics)
│   │   │                          # educators UPLOAD via materials.routes.ts, not here
│   │   └── admin.routes.ts        # /api/admin (accounts; touches NO learning table)
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
│   │   ├── admin/                 # Admin Portal — accounts only
│   │   │   ├── AdminDashboard.tsx      # account counts + the attention list
│   │   │   ├── AccountsList.tsx        # search/filter; filters live in the URL
│   │   │   ├── AccountDetail.tsx       # details · password reset · disable/enable
│   │   │   ├── AdminProfile.tsx        # ProfileCard + AccountForms, unchanged
│   │   │   └── components/
│   │   │       ├── CreateAccountModal.tsx   # one account
│   │   │       └── ImportAccountsModal.tsx  # CSV → preview → commit → credentials
│   │   ├── educator/              # Educator Portal pages
│   │   │   ├── EducatorDashboard.tsx   # across every material — the one global educator read
│   │   │   ├── MaterialsLibrary.tsx    # Upload + list
│   │   │   ├── MaterialDetail.tsx      # Concepts tab + Class Performance tab
│   │   │   └── components/ClassPerformance.tsx  # per-material class analytics
│   │   │   # (no StudentsRoster / StudentMasteryDetail — removed, see below)
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
- `full`: Fetches all concepts for the selected material(s) and injects them all as context. Best for summaries. The client sends exactly one material (`ResourcesTab.tsx` passes `[chatMaterial.id]`), which is what kept this inside Groq's limits historically.

**⚠️ THE OLD "> 6000 tokens triggers a 413 from Groq" RULE WAS PROSE, NOT CODE, AND IT IS NOW OBSOLETE ANYWAY.** Nothing enforced it — the limit was Groq refusing, and it was cited as a reason for `MAX_MERGED_DEFINITION_CHARS` in `conceptExtraction.ts`. Since 2026-08-19 the chatbot runs on `gemini-3.5-flash-lite`, whose input window is ~1M tokens, so the figure means nothing. **`MAX_CONTEXT_CHARS = 32,000` in `chat.routes.ts` is the real guard now** (~8,000 tokens, ~5× what Groq accepted). It is a runaway guard rather than a working constraint: measured on live data, the largest material renders to **6,136 characters for 28 concepts**, and the theoretical worst case is ~33,600 (42 concepts × the 800-char definition cap). `fitContext()` drops WHOLE concepts from the end — never mid-definition — and trims the concept list itself, so `source_concept_ids` records what actually grounded the answer. **If it ever starts firing, that is the signal that full mode is being pointed at more than one material.**

**The reply streams through `streamContent()` in `gemini.ts` — the codebase's only streaming call — and the stream is opened BEFORE the SSE headers are flushed.** That ordering is load-bearing: the helper awaits the upstream request, so a refusal (a spent daily quota above all) arrives while a real HTTP status is still sendable. The route used to flush first, which made its own `!res.headersSent` branch unreachable and turned every failure, whatever the cause, into the client's generic "something went wrong". **`withRetry()` wraps the initiation only** — a mid-stream failure must never be retried, because the student is already reading half an answer and a second attempt would splice itself into the middle of a sentence.

**Gemini writes in larger pieces than llama did** — often a sentence at a time. Measured on the real route: a short RAG answer arrives in **4 chunks**, a full-mode summary in **16**, a whole-document summary in **35**. A brief reply landing in two or three writes is the transport being different, not streaming having broken.

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
- **⚠️ THE SUBJECT LIST COMES FROM `public.subjects`, AND NO CLIENT FILE MAY NAME A SUBJECT AGAIN.** `SUBJECTS` in `src/data/mockEducator.ts` was a hand-kept copy of the seeded rows, and it drifted the first time anyone edited the table: Christian Living was deleted in Supabase on 2026-08-28 and **both pickers went on offering it** — the student's create-space dropdown and the educator's upload form — because nothing on the client had ever read the table. The comment above it had anticipated exactly this (*"the server re-validates the code on upload, so drift is a readable 400 rather than a crash"*), which describes the symptom rather than preventing it. `GET /api/subjects` (`server/routes/subjects.routes.ts`) and `src/context/SubjectsContext.tsx` replaced it; editing the table in the Supabase dashboard is now the whole workflow, with no code change and no redeploy. **Do not reintroduce a constant, and do not add a fallback list for the failure case** — a silent fallback is the drift itself, so a failed fetch surfaces an error and disables submit. The two server-side validators (`materials.routes.ts`, `studyspaces.routes.ts`) were always correct and remain the guarantee; the dropdown is only a convenience.
  - **`SubjectsProvider` is mounted on `StudentLayout` and `EducatorLayout` only, inside `RequireRole`** — the admin portal renders no subject, and the route's `requireRole('student', 'educator')` would 403 it. Inside the guard for the same reason as `BadgeProvider`: the request must never fire for a signed-out, un-activated or wrong-role visitor. **Not folded into `AuthContext`**, which states the rule it would break.
  - **`useSubjectName()` keeps the `?? code` fallback.** It covers the window before the fetch resolves *and* a code the catalogue no longer holds. The second cannot arise through ordinary use — both `materials.subject` and `study_spaces.subject` are `ON DELETE RESTRICT`, so Postgres refuses to delete a subject anything still references — but a label degrading to `CL` is readable where a blank looks like missing data.
  - **`SUBJECT_COLOR` in `SubjectBadge.tsx` stays hardcoded and is not the same thing.** Colour is presentation, `subjects` has no colour column, and it is a keyed lookup with a `#94a3b8` fallback that is never enumerated to build a list — so it cannot put a deleted subject in front of anyone.
- **Always run `npm run lint` after changes.** The project uses `tsc --noEmit` as its linting step.
- **Three user roles exist: `student`, `educator`, and `admin`.** Use the appropriate `requireRole()` middleware for each endpoint. Admin manages accounts only. Educators manage materials and view analytics. Students access learning features.
- **BKT is implemented directly in the backend.** Do NOT use pyBKT or any external BKT library. Do NOT implement Expectation Maximization (EM) parameter fitting. Use the default parameters specified in ARCHITECTURE.md.
- **Only educators upload materials.** Students access materials uploaded by their educators. Students cannot upload instructional materials, and the student UI must contain no upload control, no file picker, and no delete control.
- **A material is published to EXACTLY ONE grade level**, enforced in three places that must agree: `materials_grade_levels_valid` (`array_length(grade_levels, 1) = 1`), `GradeLevelsField` in `server/types/api.ts` (`.length(1)`), and a single-select `Dropdown` in the two educator forms. **`grade_levels` stays `SMALLINT[]`** — a scalar column would be a cleaner model but would rewrite every grade-access path (`@>` in `materialAccess.ts`, `= ANY` in five RLS policies and `v_grade_level_mastery`, `unnest()` in `private.auth_assigned_grades()`, the GIN index). The CHECK enforces the rule just as hard; the array is an implementation detail, so **do not "simplify" a caller by assuming a scalar**.
- **`PATCH /api/materials/:id` is the ONLY writer for `is_archived` and `grade_levels`, and it accepts nothing else.** Before it existed both controls were local `useState` toggles that looked functional and persisted nothing. `UpdateMaterialSchema` deliberately omits `subject` (a study space is built from its subject plus the materials published to it — re-pointing one would strand it in every space holding it, the mirror of `UpdateStudySpaceSchema`), `parsed_status`/`parse_error`/`is_scanned` (owned by the ingest pipeline; accepting them lets an educator mark a failed material Ready and push a concept-less material into student spaces), and `title`/`description` (no UI asks, and this must not become a general row editor). It sets `updated_at` explicitly — the column is `NOT NULL DEFAULT now()` with **no trigger**.
- **Archiving and re-grading need no cascade, and must not have one.** Both work purely because reads filter live: `accessibleMaterialIds()`/`publishedMaterialIds()` drop archived material for students (the educator branch is archive-blind on purpose), and `spaceMaterialIds()` intersects the stored `study_space_materials` list against the live published set. So the **link rows and every `bkt_mastery` row survive untouched**, and un-archiving or moving the grade back restores exactly what was there. Verified: archive → restore and grade 9 → 8 → 9 both return the identical `m_doc`. Deleting link rows here would destroy that property. **Delete is the destructive one** (it cascades concepts → mastery), which is what the delete-modal copy already says.
- **`materials.parsed_status` is `NOT NULL`.** It was nullable-with-a-default while `ParseStatusPill` indexed its style table directly and would have thrown on a null. The column, `server/types/database.ts` and the pill now all agree; do not reintroduce a nullable typing "for safety".
- **On the EDUCATOR side a parse status is labelled with its enum value, title-cased** — Pending / Processing / Completed / Failed, in both `ParseStatusPill` and the materials-library filter. It used to read Queued / Processing / Ready / Failed, which meant an educator reporting a problem and a developer reading `materials.parsed_status` had two vocabularies for four states. A new enum value's label is its name. **The STUDENT side deliberately does not follow this** — `ResourcesTab` says "Being prepared" / "Ready" / "Not available", because "Failed" tells a student something alarming they cannot act on.
- **The materials-library status filter is `all` plus exactly those four values. "Archived" does not belong in it** — `is_archived` is an orthogonal boolean with its own toggle, and an archived material still has a real parse status, so folding them into one control would make both ambiguous.
- **Every flashcard route is owner-checked, reads included.** All of `GET/POST/PUT/DELETE /api/spaces/:id/decks*` and `POST /api/flashcards/rate` resolve to the caller's own space via `loadOwnedSpace()` (or card → deck → space) and answer **404** otherwise. Reads are guarded as tightly as writes on purpose: a space id is visible in the address bar (`/student/space/:spaceId`), and a deck carries its owner's `ease_rating` and `next_review_at` — a direct readout of the concepts they are struggling with. Migration 0003 removed peer sharing to guarantee data isolation between students; an unguarded read contradicts that.
- **Students own decks but not cards.** A deck is the student's own folder for organising lessons: create, rename and delete are all theirs (`POST/PUT/DELETE /api/spaces/:id/decks`). The **cards inside are not** — there is no add/edit/delete card control and no such endpoint. Every card assesses a `concepts` row an educator uploaded and vetted (educators curate concepts via `POST/PUT/DELETE /api/materials/:id/concepts`), so a hand-written card would have no concept to attach mastery to, or would inject unvetted text into the knowledge base that also feeds Free Recall scoring, Feynman grading, the chatbot and adaptive tests. **Cards enter a deck by generation against a selected material and by no other route.** A new deck is empty by design.
- **A deck may gather several materials.** Decks are organisational, so "have I already generated this material?" is a question about cards, not decks: it is `flashcards.source_material_id` scoped to a `deck_id`. Do not add a `source_material_id` to `flashcard_decks` — it would force one deck per material and defeat the point.
- **The back of a flashcard is always the educator's definition, verbatim.** `POST /api/spaces/:id/decks/:deckId/generate` writes `definition` → back, plus `concept_id` and `source_material_id`, whatever the format. **A model never writes an answer** — the deleted helper did, which put unvetted text in front of students. Only the front varies, via `format`:
  - `'term'` (default) — front is the concept's `term`. No model in the path; instant.
  - `'question'` — `generateQuestionsForConcepts()` writes a question whose answer *is* that definition. ~13s for 68 concepts.
- **Question generation batches and echoes indices — do not "simplify" either.** `QUESTION_BATCH_SIZE = 20`: the old helper asked for one card per concept under `max_tokens: 4096` and truncates on a real material. The model returns `{ n, question }` and every `n` is range-checked before it is trusted, because a card whose `concept_id` is wrong is worse than one with no question. A concept the model skips **falls back to its term**, so a card is never lost and never unlinked. A model call that throws aborts the request **before anything is written** — a deck half questions and half terms is worse than a clean retry. The status carries the reason: a `GeminiUnavailableError` answers with its own **429** (daily quota spent) or **503** (outage), everything else **502**. Only the write-nothing half is load-bearing; a flat 502 told a student "please try again" on a day when retrying could not work.
- **`flashcards.is_ai_generated` means "the model wrote this front".** True only for cards whose question came back from the model — false for term cards *and* for question-format cards that fell back. The 409 response derives `current_format` from it so a Refresh rebuilds a deck in the style it already has.
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

**The IN-SPACE due-card badge is DERIVED from cards already loaded — do not add a per-space endpoint for it.** `StudySpace.tsx` already fetches every deck with every card including `next_review_at`, and it is the same component that renders the tab bar, so the count is a filter over data in memory: `flashcardSets.flatMap(s => s.cards).filter(c => isDue(c.nextReviewAt))`. `GET /api/flashcards/due/:spaceId` was deleted for returning any space's cards to any logged-in user and **is not needed back**. It also self-refreshes: `exitStudy()` calls `onRefresh()` → `fetchSpaceData`, so finishing a session drops the badge with no extra wiring. (The **dashboard** is the documented exception: it is global, loads no cards, and gets its counts inside `GET /api/dashboard` — see the Student Dashboard section.)

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

`GET /api/flashcards/due/:spaceId` was deleted — unused, and it returned any space's cards to any logged-in user. Due-ness is derived from cards the tab already loads. **It did not come back for the dashboard**: that page counts due cards itself inside `GET /api/dashboard`, joining `flashcards → flashcard_decks → study_spaces` on the caller's own id, so no space id ever crosses the wire.

### BKT on top of this ✅ implemented

`applyFlashcardRating()` runs inside the `counted: true` branch, so the due-check gates mastery exactly as it gates the schedule. Easy and Medium are correct observations (obs = 1) at `g_easy = 0.05` and `g_medium = 0.25`; **Hard is an incorrect observation** (obs = 0) at `g_hard = 0.10` — a low guess rate is what makes the drop steep, so Hard is not a weak pass.

**The schedule UPDATE is a compare-and-swap** (`.or('next_review_at.is.null,next_review_at.lte.<now>')` plus `.select('id')`), because the `isDue()` test reads a row fetched a moment earlier and a double-tap would otherwise apply the rating twice. It must be `.or(...)`, not `.lte(...)`: `isDue()` treats a NULL schedule as due, and `next_review_at = NULL` never satisfies `<=`, so a plain `.lte` would make such a card permanently unratable.

**Two Easy ratings put a concept at 0.98** (0.10 → 0.7231 → 0.9824), which clears the `advanced` threshold — far faster than the test path (two correct MCQs reach 0.7685). That is what P(G) = 0.05 means and the paper specifies it; the brake is the due-check pushing the card seven days out. Do not "fix" it.

`StudentDashboard.tsx` now shows the real global due count from `GET /api/dashboard`, computed with the same `next_review_at <= now()` rule.

## BKT Engine

> **Full reference: `LearnSyncAI artifacts/BKT_IMPLEMENTATION.md`.** Read it before changing anything
> here — it carries the equations with their page citations, the measurements behind every rule, the
> debugging playbook with verified SQL, and §4's three behaviours that look exactly like bugs and are
> not. What follows is only what must not be broken by accident.

**`server/lib/bkt.ts` is the only implementation.** Two-phase update per observation — evidence (EQ 1/2) then transition (EQ 3) — with the post-transition value persisted as `latent_mastery`. Parameters come from the `bkt_parameters` table via a process-lifetime cache, warmed at boot in `server/index.ts` so a bad row shows up in the boot log rather than mid-assessment.

**`npx tsx scripts/bkt-verify.ts` is the paper's evidence, not a test script.** The study reports an *Implementation Correctness Rate* (EQ 6, p. 96): hand-compute a value, compare against the system, pass within ±0.01. The harness prints an appendix-ready table and exits non-zero below 100%. `--live` adds sections that drive the real HTTP endpoints; it builds a throwaway student and deletes it, so it is safe to re-run. `--live-test` also sits a full generated test and **spends five of the ~20 daily `gemini-3.6-flash` requests**.

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

## Student Dashboard — the one global read

**`GET /api/dashboard` is the ONLY global student endpoint, and it is the documented exception to the per-space rule** recorded in `server/index.ts`. Everything else a student reads is scoped to one owned space; a dashboard is by definition about all of them, and a client-side fan-out would cost 1 + N requests with each per-space mastery call being ~6 DB round trips on its own.

**It accepts NOTHING — no body, no query, no path parameter.** Every set is derived from `req.user!.id`, so it has zero IDOR surface: it cannot be pointed at another student's space, deck, test or concept because there is nothing to point with. That is a stronger guarantee than `requireOwnedSpace()` gives, and it is why there is no Zod schema — there is no input to validate. **Any future global read must meet the same bar.**

**Read-only, permanently.** In particular it must never call `GET /api/gamification/profile`, which INSERTs a row on a GET.

**One endpoint, not several, because of the anchor.** The curve's last point must equal the headline mastery number, and that is only *enforceable* inside a single request — split across two calls, a test completing between them leaves the chart ending somewhere other than the number beside it. The route asserts it (`console.error` on a >1e-9 mismatch), which is the same idiom as `bktProblems()`.

**`allMasteryRows()` is the architectural payoff.** `masteryRows()` chunks a concept-id list into the query string at 200/query; globally there is no id list at all, because `bkt_mastery` carries `student_id` directly. One query whatever the library size. **Callers must intersect the result with their own concept set** — mastery rows survive their material being archived or unlinked, and counting those would quietly inflate every denominator on the page.

**The visibility filter must reproduce `spaceMaterialIds()` exactly** — linked **and** published to (subject, grade) **and** `material.subject === space.subject`. Drop the third clause and a stray cross-subject link row makes the dashboard disagree with the Analytics tab for the same space. Every mean goes through `documentMastery()`, which is what makes the two screens show *the same number* rather than two computations that happen to agree.

**Per-space rows do NOT average to the global figure, and that is correct.** The global set is the union over materials (deduplicated), so a material in two spaces contributes its concepts once; each per-space set is its own, where it contributes to both. Mastery is per (student, concept). It will look like a bug to the next reader — the DTO says so.

### The mastery curve

**Reconstructed BACKWARD from `bkt_mastery`, never forward from P(L₀).** `bkt_update_logs` stores both phases per row, so walking newest→oldest and stepping each concept back to its `p_l_prior` starts *at* the authoritative value. **The last point equals `overall` by construction — there is no reconciliation branch, so there is no branch to get wrong.**

**This is what makes reading `bkt_update_logs` safe at all.** The Analytics work rejected it because `applyBktObservations()` treats a failed log write as non-fatal by design, and a UI reader threatened to turn a tolerated failure into a visibly wrong chart — forcing the error fatal and inverting a documented failure-ordering decision. Backward reconstruction dissolves that: the chart never sources the current number, and a dropped row leaves one concept reading slightly too-new in one window (at most 1/N of one BKT step) instead of stale through the end. **`logWriteError` stays non-fatal. Do not promote it because this reader exists.**

**Verified on real data:** every concept's oldest log row has `p_l_prior = 0.10` and every newest row's `p_l_posterior` equals its stored `latent_mastery`, zero exceptions across 28 concepts / 56 rows — so backward and forward provably agree today, and backward stays correct when they stop agreeing.

**The X axis is a learning-opportunity index, not wall clock.** Every update in one session shares a timestamp to the millisecond, so a time axis renders a real study day as a **vertical line**. And BKT has no forgetting term, so a two-week gap is a perfectly flat segment that reads as "you stalled" when the model cannot move without evidence. The paper's own time index is `t`. Points still carry `at` for date context.

**The Y axis is fixed 0–100 and must stay that way.** Auto-scaling a 10%→55% series to fill the box makes it read as mastery of everything. Fixed bounds are also what make the 50/85 tier lines mean anything.

**Downsampling never interpolates.** Every emitted point is a real reconstructed mean at a real event boundary. The usual objection (hidden extrema) does not apply: one event moves one concept, so the mean moves by at most ~1/N, making single-event spikes structurally impossible — which is also why a moving average would be *worse*.

**The denominator is fixed at "now"** — the current visible concept set. Log rows for concepts outside it are dropped, so `total_updates` can be below the student's row count. Expected, not a bug.

### What is deliberately absent

**Streaks and badges now have a writer and ARE displayed — see the Gamification section below. STUDY HOURS STILL DOES NOT AND STAYS OUT.** `total_study_hours` is written, but only a game reports a real duration and only a test can derive one; flashcards, both cognitive modes and chat measure nothing, so the figure is a partial sum that would read as a total. That is the same failure as the frozen `day_streak` that kept all three off this page until 2026-08-19. `GET /api/dashboard` deliberately does not serialise it. The missing piece is real timing, not a widget.

**Free Recall's coverage ratio never appears here.** Its denominator is however finely that document happened to be split, so it means nothing stripped of context — and a dashboard is exactly the context that strips context. Printing "31%" beside a test's "80%" invites the cross-metric comparison the Cognitive Tabs section forbids. Recall and Feynman rows in the activity feed carry a sentence and a timestamp, no number.

**No activity heatmap and no weekly activity chart.** Both are buildable from `activity_logs` now that something writes it, and both stay rejected: with 6 tests and 17 cognitive attempts *ever*, and a two-week study, an honest heatmap renders as an accusation.

**No refresh button.** Fresh on mount like every other screen; a button would advertise a staleness the mount already handles.

### Identity

**`GET /api/auth/me` was broken and nothing noticed** — it embedded `institutions(name)` against a table that has never existed, so every call 404'd. No client code called it until this page needed a real name. It now selects explicit columns.

**`src/context/AuthContext.tsx` is mounted inside `StudentLayout`, not at the App root.** At the root it would fire `/auth/me` on `/login` and 401 on every cold page load. It holds identity and nothing else — a context that accumulates "things several screens need" becomes a second, invisible data layer with its own staleness rules.

**`profiles` has no avatar, no email and no institution.** The sidebar renders an initials monogram tinted by the theme accent; the line under the name is `Grade {n}`, a real column. Do not invent any of the three — the layout used to render an Unsplash URL and "MIT" from mock data.

**`src/data/mockStudents.ts` is GONE**, along with its last two readers. It survived the dashboard rebuild only because `Settings.tsx` and `StudentProfile.tsx` still rendered it; both were deleted in the sidebar rework below, and `mockPublicSpaces.ts` and `StudySpacePreviewModal.tsx` went with them. **`src/data/mockCourses.ts` is the only mock data left in the tree** — `games/gameUi.tsx` still reads it.

## Gamification — streaks & badges

> **Full reference: `LearnSyncAI artifacts/STREAKS_BADGES_IMPLEMENTATION.md`.** Read it before
> changing anything here — it carries the data model, the nine call sites with their three
> exclusions, the badge catalogue with the reasoning behind each threshold, the debugging
> playbook with verified SQL, and the acceptance evidence. What follows is only what must not
> be broken by accident.
>
> Writer built 2026-08-19, celebration modal 2026-08-20. Every table involved had existed since
> migration 0005 and none had ever moved, because nothing inserted into `activity_logs`. The DB
> half needed no changes; what landed is the writer, a badge catalogue and evaluator, two
> dashboard cards and a modal.
>
> ⚠️ **Migration `20260819120023` is written but NOT YET APPLIED** — verified against the live
> database 2026-08-20. It drops the `activity_logs` student INSERT policy (see below). The
> feature works without it; the migration closes a security hole.

**`server/lib/activity.ts` is the ONLY writer for `activity_logs`, and `logActivity()` NEVER THROWS.** That is deliberately unlike `applyFlashcardRating()` / `bktProblems()`, which throw and are caught at each of their two call sites: a BKT failure is diagnostically important and its return value is consumed, whereas this has **nine call sites** and no consumer that can act on a failure. Nine chances to forget a `try/catch` is the larger risk. A missing streak day must never cost anyone a score.

**One insert is the whole streak mechanism.** `trigger_update_streak` is `AFTER INSERT ON activity_logs` and maintains `day_streak`, `longest_streak` and `total_study_hours` itself. It has **already run by the time the insert resolves** (same transaction), so reading `longest_streak` immediately afterwards is correct — it looks racy and is not. **A day is an Asia/Manila calendar day**, never a 48-hour clock; `ARCHITECTURE.md` claimed the latter for months and was wrong.

**The nine call sites, and the three exclusions that matter more:**

| Logs | Where |
|---|---|
| `flashcard` ×2 | `flashcards.routes.ts` — the counted path **and** the not-due practice branch |
| `adaptive_test` | `practice.routes.ts` `PUT /:id/complete`, after `applyTestCompletion` |
| `free_recall` ×2 | `cognitive.routes.ts` — fresh **and** memo-hit |
| `feynman` ×2 | `cognitive.routes.ts` — fresh **and** memo-hit |
| `game` | `gamification.routes.ts`, after the `game_sessions` insert |
| `chat` | `chat.routes.ts`, after the normal-turn `chatbot_logs` insert |

- **The not-due flashcard branch MUST log.** With 7-day Easy intervals a student who cleared their deck yesterday has nothing due today; logging only the counted path would break their streak for using spaced repetition correctly.
- **Both cognitive memo paths MUST log.** A resubmission is a real attempt and writes a real `cognitive_logs` row; only the model calls are skipped.
- **The compare-and-swap loser must NOT log** (`flashcards.routes.ts`) — a duplicate request, not a second study event. Nor must the **off-topic chat refusal** (`chat.routes.ts`), which writes a `chatbot_logs` row for a question the assistant declined. Nor a `PUT /complete` that does not flip the status.

**`durationMs` is 0 wherever time is not measured, and 0 is the honest value.** Only a game reports one (`time_spent_ms`) and only a test derives one — from `result.elapsed_ms`, the sum of per-question latencies, **not** `completed_at − created_at`, which would bill a test left open over dinner as three hours of study.

**⚠️ `user_badges.badge_name` IS THE IDENTITY. NEVER RENAME A BADGE.** The string is in the database; renaming `streak_3` re-awards it under a second name to everyone who held the first, and orphans rows the client can no longer label. `label` and `description` are free to change.

**There is deliberately NO `badges` table.** The catalogue is `BADGES` in `server/lib/badges.ts`; a table nobody can edit is a constant with extra steps, and building an editor for it would repeat the `educator_assignments` mistake. `UNIQUE (student_id, badge_name)` is what makes awarding idempotent — the insert is `ON CONFLICT DO NOTHING` and needs no read-then-write lock, which is what makes a concurrent double-submit safe.

**Badges are awarded off `longest_streak`, not `day_streak`.** Thresholds stack and are permanent: reaching 7 days leaves all three held, and breaking a streak never removes one. Using `day_streak` would be equivalent today (rows are never deleted) but would let a student see "Week Warrior" beside a current streak of 1 with no way to tell which was lying.

**Thresholds are 3 / 5 / 7, sized to the ~2-week study.** 14 was considered and dropped — an unreachable badge renders as a permanently grey tile that reads as broken. `STREAK_THRESHOLDS` is the one edit if the study lengthens.

**⚠️ EVALUATION ORDER IS WHAT KEEPS THIS CHEAP, AND IT RUNS AFTER EVERY SINGLE FLASHCARD RATING.** One indexed read of the badges already held → narrow the catalogue to (not held) ∧ (triggered by this activity type) → **if nothing survives, return with zero further queries.** That is the steady state, so a saturated activity costs exactly one lookup forever after, and every COUNT-based rule stops running the moment its badge is earned. Measured: ~260ms per saturated activity. **Do not add a rule that queries before the held-set filter.**

**`cards_100` counts `activity_logs`, not `spaced_repetition_logs`** — the latter gets no row for a practice rating on an un-due card, so the two tables disagree about what "reviewed" means. One uniform source for every "N times" rule.

**Mastery badges trigger only on `flashcard` and `adaptive_test`** — the two modes permitted to move mastery (p. 58). A game or chat turn cannot change the count, so checking after one would be a query guaranteed to find nothing.

**`chat` counts toward a streak but has no first-time badge.** The `activity_type` enum committed to it, and a student whose only session that day was the chatbot should not lose their run. It is also the cheapest activity to farm — recorded, not designed around.

**`GET /api/dashboard` reads `gamification_profiles` and `user_badges` with two plain SELECTs, hoisted into the step-1 batch — never `GET /api/gamification/profile`.** That route used to INSERT on a GET; it no longer does, because a GET that writes is a trap for the next caller and the dashboard is read-only permanently. The fetch is in step 1 rather than beside the other history reads so it **survives both early returns**: a student whose educator archived every material still holds their streak, and zeroing it on an otherwise-empty dashboard would look like the app forgetting their work.

**⚠️ Migration 0023 DROPPED the student INSERT policy on `activity_logs`.** It contradicted the rule stated eleven lines above it in `schema.sql` — mastery and gamification are read-only for students precisely so an anon key cannot inflate a score — and `update_study_streak()` is `SECURITY DEFINER`, so an anon-key insert moved all three columns directly. Harmless while nothing read them; a live fabrication route the moment a dashboard printed them. Express writes with the service role, which bypasses RLS, so dropping it cost nothing. **Do not add it back.**

**`src/lib/badges.ts` owns presentation and nothing else.** The server decides which badges exist and who holds one. `badgeStyle()` **falls back rather than indexing blind**, so the server can award a new badge before the client knows its name — never replace it with `BADGE_STYLES[name]`.

**The dashboard CARD shows earned badges only; `BadgeGalleryModal` is the opt-in exception.** The old rule was "only earned badges are ever rendered", because a permanent greyed-out rail on a two-week study reads as a list of things you failed to do. That still governs the card, which is on screen every visit. The gallery is the counter-case — a student opens it having asked what is left to earn — and the other half of the old objection ("it would need criteria text") is answered by `criteria` on each `BADGE_CATALOGUE` entry, imperative where `description` is past tense. **The card no longer returns `null` when empty**: it did, so a brand-new account rendered no badges section and had nothing to click, leaving discovery to earning one by accident. **The one nudge on the card is a single "Next:" row, gated on `current > 0`** — "5 of 7 days" motivates, an untouched "0 / 100" is the accusation the rule exists to prevent.

**⚠️ `COUNTABLE` in `server/lib/badges.ts` IS THE ONE HOME FOR EVERY "REACH N" THRESHOLD.** `satisfied()` (is it earned?) and `badgeProgress()` (how far off?) both read it, so a bar can never disagree with the rule beside it. Membership also decides whether the gallery draws a bar at all — `first_*`, `perfect_test` and `flawless_game` have no partial state and get criteria text alone. **`badgeProgress()` reads the EVALUATOR's sources via `gatherEvidence()`, never the dashboard's**: `mastery_*` counts every `bkt_mastery` row ≥ 0.85 including archived and unlinked materials, so it will legitimately differ from the dashboard's own "Concepts mastered" stat. Substituting that figure would show "8 / 10" beside a badge the rule already considers satisfied at 12. It inherits the evaluator's early exit — an account holding all seven countable badges issues zero queries — and never throws, like everything else on this path.

**`src/pages/student/games/gamesData.ts` no longer exports `BADGES`** — four hardcoded tiles, three of them `earned: true` for every student, with zero consumers.

### The badge-earned modal

**`src/context/BadgeContext.tsx` DIFFS, it is not told.** `celebrate()` re-reads
`GET /api/gamification/badges` and compares against what this session has already seen. The obvious
alternative — each write endpoint returning the badges its action awarded — is ruled out by two
things: **`FlashcardStudyView` does not await the rating** (it posts and advances the card, so a badge
on that response would open a modal over a card the student had moved on to), and **`chat.routes.ts`
calls `logActivity()` after `res.end()`**, so the SSE stream has nowhere to put the answer. Diffing
also means the nine write paths verified by the acceptance harness are untouched.

**⚠️ THE BASELINE IS SEEDED ON MOUNT AND CELEBRATES NOTHING.** Without that, every student holding
badges already is ambushed on their next login. It is **in-memory on purpose**: a reload re-seeds, so
nothing is ever celebrated twice. Persisting to `localStorage` would close the one gap (a badge earned
by the last action before the tab closes) and open a worse one — clearing site data would replay every
badge the student has ever earned.

**`celebrate()` waits BEFORE it fetches, and the delay does two jobs.** It lets a results screen finish
its own entrance, *and* it gives the un-awaited flashcard rating time to land — fetching immediately
would read the badge list from before the badge was written. Not made into a guarantee: a poll loop
would cost every student requests on every session to catch a case whose failure mode is "the badge
appears on the dashboard instead".

**Six checkpoints, all at "you just finished something" moments** — the flashcard results screen (on
`isFinished`, so Restart re-arms it), `onFinish` in `AdaptiveTestTab` (**not** the results screen
itself, which `openSummary` also reaches when browsing a PAST test), both cognitive submits, after the
game session POST resolves, and after a chat turn streams successfully. Never per flashcard: that
would be thirty requests to answer a question that only changes at the end.

**ONE modal listing every badge that action earned, never a queue.** Finishing a game on a three-day
streak awards three at once; three dialogs in a row turn a reward into a chore, and a student clicking
fast would never read the third.

**It is SILENT, deliberately.** `play('victory')` and a mute toggle already exist in `gameAudio.ts`
and are not used here: this modal can appear anywhere in the portal, and an unexpected fanfare in a
classroom is startling. The games are opt-in and self-contained, which is why they may have sound and
this may not.

**`ConfettiBurst` moved to `src/components/ui/`** and `gameUi.tsx` re-exports it. It could not stay
there: `gameUi.tsx` imports `MOCK_COURSES`, so a globally mounted consumer would drag the last mock
data in the tree into the student portal bundle. Same lift `surfaces.ts` and `reviewSchedule.ts` got.
**A re-export does not bind the name locally** — `gameUi.tsx` must import it too, for its own usage.

**`.animate-badge-pop` and `.animate-badge-glow` are in the `prefers-reduced-motion` block.** A
celebration is exactly the motion that block exists for; the modal still opens and still names the
badge. The halo is `display: none` there rather than un-animated, because a static halo is a smudge.

**`gameUi.tsx` already had a `celebrate` — a boolean prop gating the game's own confetti** — so the
hook is aliased to `celebrateBadges` there. The scopes do not overlap and it compiles either way; two
unrelated meanings under one name in one module is the hazard.

## Sidebar & Profile — both portals

**🔐 `supabase.auth.signOut()` HAD NO CALLER, AND BOTH PORTALS SHIPPED A LOGOUT THAT DID NOT LOG OUT.** Each sidebar rendered `<NavLink to="/login">`, which changes the URL and nothing else: the session stayed in localStorage, `api.ts` kept attaching a valid JWT, and typing `/student/dashboard` in the address bar put you straight back into the account — on a shared school computer, as the previous student. **`src/lib/signOut.ts` is the single implementation and both layouts must call it**; a sign-out copied into two layout files fails silently in whichever copy drifts.

**The redirect is `navigate('/login', { replace: true })`, and it happens even if `signOut()` throws.** Without `replace` the Back button returns to the portal shell, which is exactly the "still signed in" impression the fix exists to remove. Being stranded inside the account on a network blip is the worse of the two failures, so the redirect is in a `finally`.

**Profile is a nav item, not a footer item.** It sits with Dashboard / Spaces / Games (student) and Dashboard / Materials (educator), because it is a destination like they are. **The footer holds Logout and the identity card and nothing else** — one control that ends the session, above the account it ends.

**Logout is ALWAYS rendered.** It used to appear only after clicking the identity card, which nothing indicated was a toggle. That toggle was the card's only job, so **the card is now a plain `<div>`** — a hover affordance on a dead element is worse than none. `showLogout` is gone from both layouts.

**`components/common/ProfileCard.tsx` is the shared read-only identity card**, taking the portal's accent and its facts as props. `components/common/AccountForms.tsx` is the editable half — see the Accounts section below.

**⚠️ `profiles` still has no avatar and no institution column, and neither may be invented.** Profile photos were considered and deliberately dropped: no Storage bucket, no `avatar_url`, monogram everywhere. Email is the one exception and it is a narrow one — `auth.users.email` is genuine, so it may be shown; the "no email anywhere" rule was against the **fabricated** `liza.mendoza@pca.edu.ph` that `mockEducator.EDUCATOR` printed to every educator.

**⚠️ THERE IS NO THEME PICKER, AND `ThemeContext` IS PINNED TO `THEMES[0]`.** It lived only inside the two deleted Settings pages. Removing the UI alone would not have been enough — the provider also *read* `localStorage`, so anyone who had previously chosen a theme would have been locked into it permanently with no way back. The read, the write, both storage keys, `setTheme` and `getAuthTheme()` are all gone; `ACTIVE_THEME` is exported for the two auth pages. **Six of the seven `THEMES` entries are now unreachable and are a deliberate keep** — the palettes are the design system `applyThemeToElement()` writes into the CSS custom properties every screen reads, so a future picker is a revert rather than a rewrite. Do not "clean up" the array.

## Accounts — username login, and what a user may change about themselves

**⚠️ THE LOGIN IDENTIFIER IS `profiles.username`. `auth.users.email` IS NOT.** Before migration 0021 they were the same thing: sign-in ran straight on `auth.users.email`, which on this project held `student`, `educ1` and `admin` — usernames squatting in the email column, which is why the old "Email or Username" label looked truthful. The migration split them and **backfilled each account's login string into `username`, so no credential changed**. `email` is now contact information the user owns and can change; it is never a credential.

**`POST /api/auth/login` resolves username → email SERVER-SIDE, and that placement is the whole reason the route exists.** The alternative — a public endpoint the browser calls to turn a username into an email — needs no password, so anyone could work through plausible usernames and harvest the real addresses of 12-to-16-year-olds at one named school. **Do not add a username-lookup endpoint.** Be precise about the guarantee, though: a *successful* response necessarily carries the caller's own address, since a Supabase session embeds `user.email` and the access token is a JWT with an `email` claim — stripping it would be theatre. What must never leak is anything to a caller who has not proven the password, and every failure returns one identical `LOGIN_FAILED` message with no `data` at all.

**⚠️ `PATCH /api/auth/me` ACCEPTS THREE FIELDS AND `UpdateProfileSchema` IS THE ONLY THING ENFORCING THAT.** `enforce_profile_immutables()` in `schema.sql` looks like it guards `role`/`status`/`grade_level`, but its first branch is `IF auth.uid() IS NULL … RETURN NEW` and **`auth.uid()` is NULL for the service role, which is what Express holds** — the trigger is inert for every request that reaches the API. `grade_level` is the load-bearing one: `materialAccess.ts` gates every student read on it, so a student who could PATCH their own grade would read another year's materials. The schema is `.strict()`, so an unknown key is a 400 rather than a silent drop — a client sending `grade_level` must be told it was refused. **Verify refusals by re-reading the row, never by the response code.**

**Both credential changes re-verify the current password, because Supabase does not.** `updateUser({ password })` accepts any live session, so on a shared school computer a walked-away session is a permanent account takeover. `server/lib/authClient.ts` owns that check.

**⚠️ NEVER SIGN IN ON `supabaseAdmin` OR THE EXPORTED `supabaseAnon`.** Both are process-wide singletons and a successful `signInWithPassword` stores the session on the instance — on `supabaseAdmin` that means later `.from()` calls could run as that user instead of the service role, intermittently reinstating RLS on queries written to bypass it. `authClient.ts` builds a throwaway client per call. **This is the documented exception to "never use the anon client on the server"**: that rule is about DB access under RLS, and this module issues no queries. Do not add a `.from()` to it.

**`admin.signOut(jwt, scope)` takes the caller's JWT, not a user id** — hence `req.accessToken`, attached by `authenticate` for this one consumer. Passing the id returns an error nobody is obliged to read; the acceptance harness caught it and a human would not have. **Revoke `'others'` BEFORE changing the password**, or the change invalidates the token the revocation needs and it fails exactly when it is most wanted.

**`POST /api/auth/change-email` IS TWO STEPS AND PROVES THE NEW ADDRESS BEFORE APPLYING IT.** Step 1 verifies the current password and mails a 6-digit code to the **new** address; `POST /auth/change-email/confirm` redeems it via `verifyOtp({ type: 'email_change' })`, and Supabase applies the change as part of redeeming — so there is no window where one half succeeds alone. **The two proofs answer different questions and neither substitutes for the other:** the password proves the caller owns the *account* (Supabase's `updateUser` accepts any live session, so a walked-away session on a shared school computer would otherwise be enough), the code proves they own the *destination*. It applied immediately until 2026-08-26, which was tolerable only while nothing was ever mailed anywhere; the moment a reset code can be, an unproven address is a takeover route — type in someone else's, then "recover" their password into your own inbox. **Nothing is stored between the two calls** — the client re-sends the address, and Supabase is the authority since the code was minted against it.

**⚠️ IT NEEDS `sessionClientForPassword()`, NOT `supabaseAdmin` — AND NOT A BEARER HEADER EITHER.** `admin.updateUserById({ email })` is precisely the call that applies an address with no confirmation; the user-scoped `updateUser` is what mails the code. But **an `Authorization` header is not a session**: the first build passed `req.accessToken` in `global.headers` and every call died with *"Auth session missing!"*, because `updateUser` reads the session off the client instance via `_useSession()` rather than reading the header. Measured against this project — header-only **fails**, same-client-after-sign-in **works**, explicit `setSession()` **works**. Since the route must sign in anyway to verify the current password, it reuses that client: one sign-in that both proves the password and carries the session. It is a throwaway client obeying `authClient.ts`'s rule unchanged — built per call, never a singleton, no `.from()`.

**⚠️ IT ALSO NEEDS "Secure email change" TURNED OFF in the Supabase dashboard.** Left on, Supabase demands confirmation from the **old** address as well — and the old address is `@pca.invalid` or a bare word for exactly the accounts that need this most, so the change could never complete for them.

**`AuthContext` gained `refresh()` and that is not a retreat from its "no refetch" rule.** That rule rules out background revalidation; this fires only after a write the page just performed, because the sidebar renders `fullName(user)` and would otherwise contradict a form that had just reported success.

**Three forms, not one, on the Profile page.** They hit three endpoints with three authorisations. Merged into a single Save, a rejected password would roll back a valid name change, and the user would be asked for their password to fix a typo in their surname.

**⚠️ Supabase rate-limits auth by source IP, and every login now shares the server's IP.** The default token-endpoint limit (~30 per 5 min) is one whole-class login rush. Raise it in Supabase → Auth → Rate Limits before the 50-student study — a dashboard setting, not code.

**`handle_new_user()` takes a username from `user_metadata` and degrades every failure to NULL.** Malformed or already-taken both become NULL rather than raising, because an exception in that trigger aborts the `auth.users` INSERT and surfaces as an opaque Supabase Auth failure. **An account with a NULL username cannot sign in** — a loud, admin-fixable failure rather than a silent duplicate. **The Admin Portal is now that fix** (Accounts → the account → set a username). `POST /api/auth/register` still sets no username, so an account created through it cannot log in; nothing calls it (`CreateAccount.tsx` is a stub) and self-registration stays out of scope, since an open sign-up choosing its own `grade_level` would hand out another year's materials.

## Password recovery — two tiers, and the floor never moves

**`POST /api/auth/forgot-password` + `POST /api/auth/reset-password` are Tier 1. `POST /api/admin/accounts/:userId/password` is Tier 2 and is the guarantee.** Tier 1 covers an account with a deliverable address: username → 6-digit code → new password. Tier 2 covers everybody else — no address, a `@pca.invalid` placeholder (CSV import leaves the column optional), or one of the bare words migration 0021 left in `auth.users.email`. **Tier 2 must never be removed on the grounds that Tier 1 exists**; after a bulk import most accounts are Tier 2.

**`canReceiveMail()` in `placeholderEmail.ts` is the predicate the whole feature keys off, and it is DELIBERATELY WIDER THAN `isPlaceholderEmail()`.** That function tests one thing, the `@pca.invalid` suffix — so it returns **false** for `admin` and `educ1`, whose `auth.users.email` still holds those literal words. Keying recovery or the banner off the narrow flag would silently exclude the administrator, the one account whose lockout has no path above it. **Every screen that prints an address must use `email_can_receive` too**: `AccountForms.tsx` tested the narrow flag and showed the admin the word `admin` as their own contact address.

**⚠️ `/forgot-password` ALWAYS ANSWERS `200 { sent: true }`.** Unknown username, disabled account, undeliverable address, throttled caller and a real send are byte-identical — including a **malformed** username, which gets the same 200 rather than a validation dump. Same doctrine as `LOGIN_FAILED`, sharper reason: these usernames belong to identifiable minors at one named school, so anything that separates the cases is an oracle for which children attend it. `/reset-password` *does* report failure, and that is not an inconsistency — reaching it means holding a code, which is proof of inbox access rather than a guess.

**⚠️ THE ADDRESS IS NEVER ECHOED, NOT EVEN MASKED.** `m•••@gmail.com` is ordinary practice and wrong here: a domain plus a first letter is a partial disclosure about a child to whoever typed the username. **The page copy is what replaces it** — *"Nothing arriving? Your account may not have an email saved. Ask your teacher or the school administrator."* That strands nobody while disclosing nothing, which is the trade masking fails to make. `recoverableEmailFor()` never reaches a response body or a log line.

**A self-service reset CLEARS `must_change_password`; an admin reset RE-ARMS it.** The rule is who has seen the password. The holder chose this one through their own inbox, so the activation gate is satisfied; an admin has seen the one they set, and after a bulk import so has everyone who saw the credentials table.

**Both revoke sessions BEFORE changing the password**, the ordering `POST /change-password` already documents — changing it first can invalidate the token the revocation needs. Reset uses `'global'` rather than `'others'` because the OTP session is discarded anyway, and because someone resetting their password may be doing it precisely to end somebody else's session.

**⚠️ THE OTP SESSION NEVER REACHES THE BROWSER.** `verifyOtp` returns one and the route drops it; the client is sent to `/login`. A session derived from an emailed code is weaker proof than one derived from a password, and the user has a password now — same reasoning as `verifyPassword()` throwing away the session it creates.

**`server/lib/otpThrottle.ts` is keyed by USERNAME, not IP** — every request shares the server's address, which is the same hazard already flagged for Supabase's own IP limits. 60s cooldown, 5 sends/hour, 5 verify attempts. It is per-process (a Render spin-down clears it, worst case one extra mail) and **is not a security boundary** — Supabase mints, hashes, expires and single-uses the codes. It bounds its own maps, because they are keyed by attacker-supplied strings.

**`EmailRecoveryBanner` is the ONLY thing that moves an account from Tier 2 to Tier 1**, since nothing else in the product ever asks for an address. Shown to all three roles, gated on `email_can_receive`, dismissible **per session only** — `localStorage` would strand an account in Tier 2 with no reminder it was ever offered a way out.

**⚠️ EMAIL TEMPLATES MUST USE `{{ .Token }}`, NOT `{{ .ConfirmationURL }}`** — both Reset Password and Change Email Address. Supabase mints both; the defaults send a link and these flows read a typed code. The body must name **neither the account nor the student**, so a code arriving at a mistyped address tells its recipient nothing.

## Admin Portal — accounts, and deliberately nothing else

**The scope is narrow because four independent sources say so** — `ARCHITECTURE.md:14`, `README.md:182-191`, `CLAUDE.md:14`, `schema.sql:13` all give the same three verbs (create, edit, disable), the same object (accounts for educators and students), and the same exclusion: *"does not interact with learning content, study activities, or analytics"*. **Nothing under `/api/admin` reads `materials`, `concepts`, `bkt_mastery` or any other learning table** — only `profiles` and, through the Supabase admin API, `auth.users`. There is precedent for holding this line: `educator_assignments` (admin assigns teachers subjects/grades) was built and then **removed** as going *"beyond the specification"* (`databaseSchemaExplained.md:309`).

**Before this existed the admin could not use the application at all.** `Login.tsx` sent `role === 'admin'` to `/educator/dashboard`, where `requireRole('educator')` 403s every data call. Three promises elsewhere in the app also had no implementation: "Only an administrator can change this" on the student Profile page (`grade_level`), "an admin fixes" a NULL username, and password recovery — there is **no SMTP**, so `POST /accounts/:userId/password` is the *only* password-recovery path in the product and the "Forgot password?" link stays inert.

**⚠️ THERE IS NO DELETE ROUTE AND NO DELETE CONTROL. Do not add one casually.** Thirteen tables CASCADE from `profiles` — `study_spaces`, `bkt_mastery`, `bkt_update_logs`, `practice_tests`, `practice_telemetry`, `cognitive_logs`, `chatbot_logs`, `spaced_repetition_logs`, `gamification_profiles`, `game_content`, `game_sessions`, `user_badges`, and `activity_logs` — so deleting one student destroys their entire measured history, which for a 50-student study is the research data. `schema.sql` states the intended idiom on the column: *"Set to disabled by an admin to revoke access without deleting."* Disable is already honoured by `requireRole`, `POST /api/auth/login`, `private.auth_role()` and `rosterForGrades()`, and is fully reversible. Deletion is also the one operation the schema fights — `materials.educator_id` is `ON DELETE RESTRICT`, the only non-CASCADE FK, so deleting a publishing educator fails as an opaque Supabase Auth error.

**⚠️ `handle_new_user()` REPORTS SUCCESS FOR AN ACCOUNT THAT CANNOT SIGN IN**, which is why `createAccount()` in `admin.routes.ts` is a function rather than three lines. A malformed or taken username degrades to NULL, so the naive implementation says "Account created" and nobody can log in. The sequence is: pre-check `lower(username)` → **409**, nothing written → `auth.admin.createUser` with `user_metadata` (the trigger writes `profiles` *and* `gamification_profiles`) → **re-read the row and confirm the username stuck** → on NULL, one targeted UPDATE whose `23505` is authoritative → on collision, delete the auth user and 409. **Build the response from the re-read row, never the request body** — the body is what was asked for, the row is what happened. Verified: a case-differing duplicate 409s and leaves no orphan.

**⚠️ A STUDENT CREATED WITHOUT A GRADE SILENTLY BECOMES GRADE 7.** `handle_new_user()` does `IF v_role = 'student' AND v_grade IS NULL THEN v_grade := 7`, and that value decides which year's materials the account can open for life. `CreateAccountSchema.superRefine` requires it, the create modal ships **no pre-selected grade**, and the CSV importer rejects a blank one. Never let the trigger choose it.

**Role and grade move together, and Zod cannot see the whole rule.** `profiles_student_needs_grade` is `CHECK (role <> 'student' OR grade_level IS NOT NULL)`. A partial PATCH does not know the resulting role without reading the row, so the schema validates what it can and the route re-checks `role ?? current.role` against `grade_level ?? current.grade_level`; student→educator clears the grade. **A role change is fully reversible** — nothing cascades, so flipping back restores every study space and mastery row, the same property archiving relies on. The UI says so, because an admin otherwise reasonably assumes it is destructive.

**⚠️ `UpdateAccountSchema` IS LOAD-BEARING SECURITY, NOT VALIDATION.** It is the deliberate inverse of `UpdateProfileSchema`: it *does* accept `role` and `grade_level`, because assigning them is the role's entire job. `enforce_profile_immutables()` does not back it up — `auth.uid()` is NULL for the service role, so the trigger returns early for every request that reaches Express. **Assignable roles are `student` and `educator` only, never `admin`** (README:188); further admins come from the Supabase dashboard, as the current one did.

**Two self-lockout guards, both 400, both on `req.user!.id`: you cannot change your own role, and you cannot change your own status.** There is exactly one admin account — either one would lock every administrator out permanently, including out of the request that would undo it. `status` has its own route rather than being a field in PATCH so that guard has one home. The UI omits both controls rather than letting them fail.

**✅ An admin password reset DOES revoke the target's open sessions — measured, not assumed.** After `updateUserById({ password })` an access token issued moments earlier answers 401 and its refresh token is rejected outright. **That depends on `authenticate` calling `supabaseAdmin.auth.getUser(token)`**, a round trip to the auth server rather than a local signature check — verifying the JWT locally is the obvious way to save a hop and would silently turn every open session into one that survives a reset. `admin.signOut(jwt, scope)` is unusable here regardless: it identifies sessions by JWT and we hold the admin's, not the target's.

**`profiles` has no email column, so the LIST deliberately fetches none** — an N+1 `getUserById` across 50+ accounts to render a list whose identifier is the username anyway. The detail route fetches exactly one. `GET /overview` is the sole exception: "never signed in" needs `last_sign_in_at`, so it pages `listUsers()` (50/page, bounded loop) and reports **null rather than 0** when that read fails.

**⚠️ EMAIL IS REQUIRED BY THE CREATE FORM AND OPTIONAL FOR A CSV ROW — the asymmetry is deliberate.** An admin entering one account has the address in front of them; a class of fifty may be imported before anyone has collected fifty addresses, and blocking that would kill the feature exactly when it is needed. So `CreateAccountSchema.email` is required while `ImportAccountRowSchema.email` is not, and **`lib/placeholderEmail.ts` is now reachable only from import.**

**Placeholder addresses use `<username>@pca.invalid`** — RFC 2606's reserved TLD, because Supabase requires an identity on every account. **Every screen that prints an email must call `isPlaceholderEmail()`**: the rule the invented `liza.mendoza@pca.edu.ph` broke was about displaying a fabricated address as genuine, and printing a placeholder is the same mistake with better intentions. The admin page always checked; **`AccountForms.tsx` did not, and showed students `juan.delacruz@pca.invalid` as their own contact address** — which is why `GET /api/auth/me` now returns `email_is_placeholder` beside `email`. **Not `email = username`** — that is exactly the squatting migration 0021 untangled.

**Supabase enforces a UNIQUE index on `auth.users.email` (`users_email_partial_key`)**, so two accounts can never share an address — siblings cannot both use a parent's Gmail. That constraint is why requiring a real email on every path was not viable for the 50-student import.

**`GET /api/admin/overview` accepts NOTHING** — no body, no query, no path parameter — so it has zero IDOR surface and no Zod schema, the same bar as `GET /api/dashboard` and `GET /api/educator/overview`. Every figure on it is a **count of accounts**; a dashboard is the easiest place in an app to cross the scope line by accident.

**A user id in `/admin/accounts/:userId` is correct and is NOT the pattern the two global reads avoid.** Those derive everything from `req.user!.id` because a *student's* id in a URL is an IDOR surface on a student-facing route. Administering every account is what this role is, and `requireRole('admin')` is the authorisation.

**`RequireRole` is the app's FIRST route guard, and only `AdminLayout` uses it.** Everywhere else a wrong-portal URL renders a shell whose calls 403 — untidy, not dangerous. A portal that lists every account in the school should not render its frame for a student. It sits **inside** `AuthProvider` and **outside** the shell, and its `isLoading` branch is load-bearing: `user` is null on first render, so redirecting on a falsy `user` alone would bounce a legitimate admin to `/login` on every cold load. Wiring the other two layouts is a one-line change each and belongs to its own review.

**Bulk import validates the whole file before writing anything**, including within-file duplicate usernames (case-insensitive, matching `ux_profiles_username_lower`) — the failure most likely to leave half a class created. Creation is **sequential, never `Promise.all`**: Supabase rate-limits the auth admin API by source IP and every call shares the server's. Rows are still reported individually, because a genuine race for a username can survive validation. **The results table is the only time the generated passwords exist in readable form** and the copy says so.

**Import is a modal on Accounts, and that move cost it two protections a page got for free.** It was `/admin/import` — a fourth nav item and a page of its own, justified as "a multi-step flow that needs the page to itself". Both halves of that argument had to be answered rather than dropped:

- **⚠️ `Modal` HAS NO MAX-HEIGHT AND ITS PANEL IS `overflow-hidden`, inside a wrapper that centres with `items-center`.** A fifty-row table therefore overflows **both** edges — the top rows unreachable, the Create button below the fold with nothing to scroll. This is the flashcard-face bug in a different component. `ImportAccountsModal` caps its own content at `calc(85vh - 11rem)` and scrolls it, with the **action row as a sibling of the scroll box** so the buttons stay pinned. Sized against the chrome rather than as a flat `vh` fraction: the chrome is a constant pixel height, so a fraction that fits 1080px overflows a 600px laptop. **Do not "fix" this by giving `Modal.tsx` a max-height** — twelve other call sites depend on its current sizing.
- **⚠️ A PAGE CANNOT VANISH BY ACCIDENT; A MODAL CLOSES ON ESCAPE, ON THE BACKDROP AND ON THE X — all three wired to one `onClose`.** Losing the results screen means resetting every account individually, so `requestClose()` is the only thing passed to `Modal`. It refuses **outright** while `busy` (creation is sequential over up to fifty accounts — unmounting mid-flight loses every password while the server carries on), and asks for confirmation on the results screen until the credentials have been copied **or** saved to a file. **"Import more" goes through the same guard** (`requestRestart()`): it clears `results` just as thoroughly as closing does, and an admin reaching for the next class has not necessarily saved the last one.

**The confirmation renders IN PLACE, replacing the action row — never as a nested `Modal`.** Two portals both binding Escape and both writing `document.body.style.overflow` fight over the teardown.

**⚠️ UPLOAD IS THE ONLY WAY IN. THE PASTE BOX WAS REMOVED BECAUSE IT COULD NOT WORK THE WAY ANYONE WOULD TRY TO USE IT.** Copying cells out of Excel or Google Sheets puts them on the clipboard **tab-separated**, and `splitLine()` in `csvAccounts.ts` splits on commas only — so a spreadsheet paste arrived as one giant column and failed with *"The header row is missing: role, first_name, …"*, which reads as a problem with the admin's data rather than with the input method. The only clipboard content it ever accepted was raw CSV text: a file already saved, opened in Notepad and copied, which is a stranger route than uploading it. **Do not reintroduce paste without teaching the parser about tabs first.** A drag-and-drop zone replaced it, and a file now parses on arrival and advances to the preview itself — which is why the input phase has no action row and no "Review rows" button.

**The drop zone's contents are `pointer-events-none`.** Without it `dragleave` fires whenever the cursor crosses onto a child element, so the highlight flickers off while the file is still over the target.

**A non-`.csv`/`.txt` file is rejected by NAME, before the parser sees it.** Excel saves `.xlsx` by default, so dropping a workbook is the most likely mistake here; a binary file reaches `parseAccountsCsv()` as mojibake and comes back as "the header row is missing", sending the admin to look at their columns instead of at File → Save As.

**`downloadCredentials()` and `copyAll()` both filter to `r.ok` rows.** A failed row carries no password, and a blank cell in a credentials file reads as an account whose password is empty rather than one that was never created.

**⚠️ THE TEMPLATE HAS NO `username` AND NO `password` COLUMN.** `CSV_COLUMNS` is `role, first_name, last_name, grade_level, email` — only what the school actually knows about a person. Both credentials are generated server-side and handed back in the download at the end, so asking the admin to supply them is asking for work whose output is discarded, and hand-writing fifty usernames is the exact chore `suggestUsername()` exists to remove. **`REQUIRED_COLUMNS` is now just `role, first_name, last_name`** — `username` left that list with the template, and a file of educators legitimately has no `grade_level` column at all.

**⚠️ THE PARSER STILL ACCEPTS BOTH COLUMNS WHEN PRESENT, AND THAT IS NOT A LEFTOVER.** Not offering something and refusing it are different things: a file built from the older template must keep working, and an educator occasionally warrants a chosen username (`a.santos`). Every rule that guarded a supplied value still fires — format, within-file duplicates, the existing-account precheck. Verified end to end. **The preview renders a blank username as an italic "generated", never `—`**: blank is now the healthy case on every row, and a dash would read as missing data across an entire good file.

**⚠️ THE CREDENTIALS FILE CARRIES THE NAME, AND THAT IS NOT DECORATION — `first_name,last_name,username,password`.** It is handed out to up to fifty children, so a file of usernames and passwords alone cannot be distributed at all: nothing on it says whose line is whose. Generated usernames only *look* self-explanatory until two students share a name and become `maria.santos` and `maria.santos2`. **The names come from the server's result rows** — `POST /accounts/import` now returns them, taken from the re-read profile on success (the same "row, not request body" rule `createAccount()` follows) and from the input on failure. **Never re-derive them by matching index against the rows that were sent**: a row can drop out of the results (a name yielding no username is reported and `continue`s), which would shift every later name by one and hand children each other's passwords.

**⚠️ `csvCell()` IS A CORRECTNESS GUARD, NOT TIDINESS, AND IT ARRIVED WITH THE NAME COLUMNS.** A surname entered as `Dela Cruz, Jr.` splits into two cells unquoted and pushes the password one column across; measured, the control case parses the username as `tan lj`. A password typed into the import file can contain a comma for the same reason — the rule on it is only "eight characters, one of them not a letter or digit". `csvCell()` must stay the exact inverse of `splitLine()`, which is why both live in `csvAccounts.ts`: that module now owns reading *and* writing the format. The clipboard form (`toTsv`) is deliberately unquoted — tabs are what a spreadsheet expects on paste, and no cell can contain one, having come from a comma-split file.

**`/admin/import` redirects rather than being deleted.** There is **no catch-all route**: an unmatched path inside `AdminLayout` renders the shell with an empty `<Outlet />` — a blank page, not a 404 — which is what a bookmark of the old address would land on.

**⚠️ `csvAccounts.ts` CATCHES DUPLICATES WITHIN THE FILE, NOT AGAINST THE DATABASE — `POST /api/admin/import/precheck` is the half that was missing.** Without it the review screen could say "50 accounts ready to create" and then fail on row 34 because that username already existed, leaving 33 accounts created and a class half imported. The most likely way to hit it is the ordinary one: import a class, notice two students were missed, re-upload the corrected *full* file. The modal now annotates the offending rows before Create is ever enabled.

**It checks BOTH usernames and emails, in one call.** They are needed at the same instant for the same decision, and two round trips would let one half succeed while the other failed. The email half has its own realistic route in — siblings handed the same parent's address, which `users_email_partial_key` refuses — and it was the surviving partial-import hole after the username half landed. Within-file duplicate emails are caught too, in `csvAccounts.ts` *and* `ImportAccountsSchema.superRefine`, mirroring how usernames are handled on both sides.

**It is a COURTESY, NOT THE GUARANTEE, and must never be treated as one.** Two admins importing overlapping files can both pass it, and an account can appear in the seconds between the check and the import. `usernameTaken()` inside `createAccount()`, `ux_profiles_username_lower` and `users_email_partial_key` remain the arbiters, and the per-row 409 stays reachable. **The client failure is deliberately non-fatal** — an unavailable check costs the early warning and nothing else, and blocking a whole import over it would be the worse trade.

**It is the same enumeration oracle as `/username-suggestion` and is safe for the same reason and only that reason: `requireRole('admin')`.** A username-availability check a stranger could reach lets them work through plausible names and learn which children attend one named school; the email half is worse still, since it confirms a real address for a named child. **Do not expose it to sign-up and do not move it out from behind the admin role.** Only *supplied, well-formed* values are sent — a blank username is the server's to generate (it checks the database while doing so), and a malformed entry would 400 the whole array under `ImportPrecheckSchema` while already carrying its own format error. `EMAIL_SHAPE` is exported from `csvAccounts.ts` so the modal filters by exactly the test that produced those errors.

**⚠️ THE EMAIL HALF IS THE ONE PLACE THAT STILL SWEEPS `auth.users`, AND IT HAS TO.** Addresses are not on `profiles`, PostgREST does not expose the `auth` schema, and the admin SDK has no `getUserByEmail` — paging `listUsers()` and intersecting in memory is the only route to the fact. This does **not** contradict `GET /overview` dropping its sweep: that one ran on every dashboard load to answer a question a plain column read answered better, whereas this runs once, on an explicit file upload, to get something otherwise unobtainable. At `perPage: 1000` a school is one request; `AUTH_MAX_PAGES` is a runaway guard, not an expected limit.

**`src/components/common/formKit.tsx` holds `Field`/`Section`/`SaveButton`/`StatusLine`/`messageOf`/`useSubmitLatch`**, lifted out of `AccountForms.tsx` when the admin editors needed them. `useSubmitLatch` is a correctness guard, not styling — a second copy would drift, and the admin forms change passwords and account status.

**Deliberately absent:** an admin action log (defensible, but a new table and a new writer, in no scope statement); `subjects` and `bkt_parameters` screens (RLS grants both, no prose assigns them — and `bkt.ts` caches parameters for the process lifetime, so a live edit would desync a running session's audit trail from the ICR evidence); and anything from a learning table.

## First-login activation — the account gate

**An account created by an admin is born un-activated** (`profiles.must_change_password`), and
`requireRole` refuses every route until its holder replaces the password. The reason is concrete: the
admin chose or read that password, and after a bulk import fifty of them sit in a table that gets
copied into a spreadsheet and printed — so until the student re-keys it, their teacher can sign in as
them.

**⚠️ `account_status` STAYS A TWO-VALUE ENUM. The "Not activated" state is DERIVED, not stored.**
`accountState()` in `src/lib/adminAccounts.ts` combines the two columns (disabled wins). Two reasons,
both load-bearing: they are **independent facts** — an account can be disabled *and* never activated,
which one column cannot express and could not restore on re-enable — and `status` is the access gate
read in ~19 places (`requireRole`, `POST /auth/login`, `materialAccess.loadCaller`,
`spaceAccess.loadOwnedSpace`, `educatorScope`, plus `private.auth_role()` / `auth_grade_level()` /
`auth_assigned_grades()`, which every RLS policy inherits). A third enum value means re-auditing all
of them, where the failure modes are "legitimate user locked out" and "un-activated user let through".

**⚠️ THE GATE LIVES IN `requireRole` BECAUSE IT IS THE ONLY MIDDLEWARE THAT READS `profiles` — so a
route mounting `authenticate` alone was a hole, and four were.** Closing them was a necessary part of
this change, not scope creep:

| Route | Was | Now |
|---|---|---|
| both of `chat.routes.ts` | `authenticate` only — `requireRole` was never imported, so an educator could drive the student chatbot | `requireRole('student')` |
| `GET /api/spaces/:id` | the one space route without a role check | `requireRole('student')` |
| `POST /api/materials/concepts/batch` | bare | `requireRole('student')` — its only caller is `FeynmanTab.tsx` |
| `PATCH /auth/me`, `POST /auth/change-email` | bare, by design | gated for all three roles |

**⚠️ `GET /api/auth/me` AND `POST /api/auth/change-password` MUST STAY UNGATED.** They are the way
out. Gating either makes a newly created account permanently unusable with no recovery short of the
database.

**`POST /auth/change-password` is the ONLY place an account becomes activated, and it did not touch
`profiles` at all before this.** It clears the flag *after* the password change succeeds — clearing
first and then failing would open the account up while it still holds the administrator's password.
Unconditional rather than `.eq('must_change_password', true)`, so a routine change by an activated
user is a harmless no-op. **`POST /api/admin/accounts/:userId/password` re-arms it** — the admin just
chose that password too, so the same rule applies; that is the second of exactly two call sites (the
other being creation, via `user_metadata` so the row is born with it).

**`/set-password` is mounted OUTSIDE every layout, beside `/login`.** Inside a guarded layout,
`RequireRole`'s redirect would fire again on arrival and loop forever. It carries its own
`AuthProvider`. `RequireRole` checks activation **before** the role check, because a student, educator
and admin created this way are all equally un-activated.

**`RequireRole` is now wired into all three layouts.** It was admin-only and deferred as "its own
review"; the gate made it necessary, since an un-activated account would otherwise render a full
portal shell and 403 on every request with nothing on screen explaining why.

**⚠️ `ACCOUNT_COLUMNS` in `admin.routes.ts` MUST CARRY EVERY COLUMN A SCREEN RENDERS.** `must_change_password` was missing from it, so the list, the detail view and the create response all returned the field as `undefined`; `accountState()` read that as false and **every account displayed "Active" no matter how freshly created**, while the dashboard — which selects the column in its own query — counted them correctly. Two screens quietly disagreeing is the signature. A harness that checks the database row and the login payload does **not** catch this; assert the admin read as well.

**One password rule, `PasswordField` in `server/types/api.ts`: 8 characters and at least one non-alphanumeric.** It governs every path that SETS a password — first-login activation, self-service change, admin reset, an admin-typed password on create, and the CSV `password` column. `passwordProblem()`/`isPasswordValid()` in `src/lib/account.ts` are the client mirror, used by all three forms so they cannot disagree about a rejection. "Not a letter or a digit" rather than a symbol list: it is the simplest rule to state to a child, and it means `brave-otter-93` satisfies the rule its holder will be held to. **It applies to passwords entered, never to stored ones** — the live accounts predate it. NIST SP 800-63B advises *against* composition rules (they mostly yield `Password1!`); this one was requested deliberately, so implement it faithfully but **do not stack more on top** — a common-password blocklist and a longer floor are what would actually help.

**Initial passwords are memorable, not random — `brave-otter-93`.** The 10-character random string it
replaced (`xK7mPq2Rtv`) cannot be read aloud to a Grade 7 class, which is what made "just use the
username as the password" tempting — and that would mean anyone who knows a student's *name* can sign
in as them, since usernames are generated from names. **The entropy trade is deliberate and
conditional: ~1.5 million combinations against ~2.5 × 10¹⁷, acceptable ONLY because the password is
single-use (this gate forces replacement) and Supabase rate-limits sign-in by IP. If the forced change
is ever removed, revert the generator with it.**

**`POST /api/admin/username-suggestion` is the enumeration oracle this codebase deliberately does not
have — and is safe only behind `requireRole('admin')`.** A public username-availability check lets a
stranger work through plausible names and learn which children attend one named school; that is why
`POST /auth/login` returns one identical message for every failure. An admin already sees the whole
account list. **Do not move it out from behind the admin role, and do not reuse it for sign-up.**
`server/lib/usernameSuggest.ts` folds `ñ` via `normalize('NFD')` (Filipino names carry it routinely,
and dropping the letter gives a username the student will not recognise), strips hyphens and
apostrophes, fits 30 characters leaving room for a suffix, and appends `2`, `3`… against the database.
It **returns null rather than inventing `user1234`** — a username carrying no trace of the person is
one nobody can match to a class list.

**A blank `username` column in a CSV is filled from the name**, deduplicated within the file *and*
against the database — `ImportAccountRowSchema` exists solely to make `username` optional there, and
the route passes a `claimed` set so two students called Maria Santos cannot both be handed
`maria.santos`. The client must **omit the key entirely** rather than sending `''`, which
`UsernameField.optional()` rejects.

**`GET /api/admin/overview` no longer touches `auth.users` at all.** `not_activated` replaced
`never_signed_in`, which needed a paged `listUsers()` sweep to answer a weaker question — opening the
app is not the same as taking ownership of the account, and the new figure is a plain column read.
`last_sign_in_at` survives on the account detail page, where it is one `getUserById` for one account.

## Educator Class Performance — the only cross-student read

**The educator "Students" tab is GONE and must not come back as a roster.** `StudentsRoster.tsx` and `StudentMasteryDetail.tsx` were 571 lines with **no `lib/api` import between them** — eighteen invented students from `mockEducator.ts`. Student performance now lives in `MaterialDetail.tsx` → Class Performance, where it is scoped to a material the educator actually uploaded. The one thing genuinely lost is a student *across* materials; that belongs to the `EducatorDashboard.tsx` rebuild, not to a per-material tab.

**`/api/educator` is the third endpoint shape and the only one that reads ACROSS students.** Per-space (`requireOwnedSpace`) is the default; `GET /api/dashboard` is the global student exception; this is scoped by a material the caller uploaded. `requireOwnedMaterial()` 404s on anyone else's material, and the one route naming a student in its path re-derives that student through `rosterStudent()` rather than trusting the id — it is the only user id an educator can put in a URL anywhere in the app.

**Educators READ mastery and never write it**, exactly as games do. Nothing under `/api/educator` imports `server/lib/bkt.ts`; `bkt_source` stays a two-value enum.

**`v_grade_level_mastery` is NOT used, and its arithmetic is not the reason.** The view is correct (verified: `m_doc` 0.5477 / 28 assessed / 5 mastered matches this route and the student dashboard exactly — the old "it double-counts" claim in `BKT_IMPLEMENTATION.md` was stale and has been corrected). It is unused because it is `WITH (security_invoker = on)` and **Express holds the service role, which bypasses RLS entirely** — selected from here it returns every educator's rows and `auth.uid()` is NULL — and because it has **no `p.status = 'active'` filter**, so a disabled student appears in it.

**"The class" = active students whose `grade_level ∈ material.grade_levels`**, via `rosterFor()` in `server/lib/educatorScope.ts` (the educator counterpart of `spaceAccess.ts`; `ownedMaterial()` moved there out of `materials.routes.ts`). Students who never opened the material are **included and reported as not started** — "nineteen of twenty have not touched this" is the finding, and filtering them out would hide it.

**⚠️ THE THREE MEANS ON THIS SCREEN ARE NOT THE SAME COMPUTATION.** Only `students[].m_doc` is EQ(4) — a mean over CONCEPTS for one student, where an unassessed concept correctly enters at P(L₀) — and only that one goes through `documentMastery()`. `class.m_doc` and `concepts[].avg_mastery` are means over **STUDENTS**, and filling an absent student with P(L₀) there would invent a measurement for someone who never opened the lesson. They use `meanOrNull()` with the same 4dp rounding.

**The class average covers STARTED students only, and its caption must always name that denominator.** `classCaption()` renders "Averaged across the 3 of 20 students who have started". Including the other seventeen would drag the figure toward the prior in proportion to how many have not begun.

**Never print P(L₀), enforced three ways.** `students[].m_doc` is null when `assessed_concept_count === 0`; `concepts[].avg_mastery` is null when `assessed_students === 0`; `class.m_doc` is null when `started === 0`. The UI renders `—` with `<MeterBar value={null} />`, which draws an empty track rather than a short bar. Gate on the counts, **never on `m_doc === 0.1`**.

**Students are partitioned before sorting, not sorted as one list.** A null `m_doc` in a numeric comparator yields NaN and a comparator returning NaN gives an arbitrary order. It also matters semantically: the P(T) floor puts every assessed concept at ≥ 0.20, so ranking a not-started student at 0.10 would place everyone who has done nothing **above** everyone measurably struggling. Same rule for concepts.

**Three routes: a summary plus BOTH drill-downs of one matrix.** `/performance` carries the class summary, per-student rows and the per-concept breakdown. `/students/:id/concepts` expands a **row** (this student's concepts); `/concepts/:id/students` expands a **column** (this concept's students) — the transpose, and the reason the second one exists: "3 struggling" is not actionable without names, and getting them otherwise meant expanding every student and reading down. Both are fetched on expansion because shipping the full matrix inline is ~256 KB at 50 students × 57 concepts against ~5 KB per expansion. That is what makes this differ from `GET /api/practice/space/:spaceId/mastery/concepts`, where there is only ever one student and so no matrix.

**`/concepts/:conceptId/students` must check the concept belongs to the material.** `requireOwnedMaterial()` only proves the caller owns the material named in the path; a concept id pasted beside it could name a row in another educator's lesson. Mismatch is **404**.

**"Struggling" = ASSESSED and below 0.50** — the foundational band, per concept, per student. The `assessed` gate is the load-bearing half: a student nobody has asked about a concept sits at P(L₀) = 0.10, which is below 0.50 and means nothing. That gate is also what lets `TIER_STYLE.foundational` be slate (a cold start is not a failure) while a struggling count is still flagged amber. `STRUGGLING_BELOW` in `educatorAnalytics.ts` mirrors the server's `STRUGGLING`; any client-side use must reproduce the `assessed` check too.

**`classMasteryRows()` chunks BOTH id lists.** It is the first reader in the codebase with two `.in()` lists in one URL. The student filter leads because `idx_bkt_student_concept` is `(student_id, concept_id)` — a concept-only filter cannot use it and would drag in other grades' rows to discard.

**No client cache.** The tab is rendered only while active, so entering it remounts and refetches — the same freshness-by-construction `<main key={activeTab}>` gives the student tabs. It is deliberately **not** wired into `MaterialDetail`'s 3s parse poll.

**`TIER_STYLE.foundational` is slate, not rose.** It was `#fb7185`, which `MeterBar`'s JSDoc cited by name as its reason for refusing to reuse `MasteryBar`, and which contradicted `TIER_TONE.foundational = 'neutral'`. Everyone starts foundational — it is the P(L₀) cold start — so red marks every new student as failing at something nobody has asked them.

## Educator Dashboard — the global educator read

**`GET /api/educator/overview` is the educator counterpart of `GET /api/dashboard`, and it accepts NOTHING** — no body, no query, no path parameter. Every set is derived from `req.user!.id`, so it has zero IDOR surface and no Zod schema, because there is no input to validate. Same bar as the student global read; any future one must meet it too.

**Four round trips whatever the library size:** materials → concepts (chunked) ‖ roster → `classMasteryRows()`. **`rosterFor()` must never be called in a loop** — `rosterForGrades()` in `educatorScope.ts` fetches the union of grades in one query and the per-material class is partitioned in memory. `rosterFor(material)` is now a thin call through to it, so the role/status/grade triple keeps one home.

**⚠️ FIVE FIGURES, TWO COMPUTATIONS — only one kind is EQ(4).** Over CONCEPTS via `documentMastery()`, where an unassessed concept correctly enters at P(L₀): `students[].m_doc` (one student, the union of concepts they can see) and `students[].by_material[].m_doc`. Over STUDENTS via `meanOrNull()`, where an absent student must never be filled with the prior: `materials[].m_doc`, `concepts[].avg_mastery`, `class.m_doc`, `grades[].m_doc`. `students[].m_doc` is the *same computation the student's own dashboard performs on themselves*, narrowed to this educator's materials — so it differs from what the student sees whenever another educator publishes to them, and the caption says so.

**THE CONSISTENCY INVARIANT: `materials[].m_doc` here is the same expression over the same population as `class.m_doc` on that material's Class Performance tab.** The two screens show one number, not two computations that happen to agree. Verified end to end; if they ever differ, the roster or the started-filter has drifted.

**Live materials only.** Archived materials are excluded from every figure and surface only as a count. `bkt_mastery` rows **survive archiving and re-grading**, so counting them would inflate every denominator — the same intersection rule `allMasteryRows()` states. Class Performance stays archive-blind, which is not a contradiction: an archived material simply is not on this page. Verified: a mastery row on an archived material, and one belonging to a student no longer in the material's grade, are both correctly ignored.

**`attention` is the operational signal and the most valuable thing on the page** — one reason per material, chosen server-side by blocking-ness: `parse_failed` → `parse_pending` → `no_concepts` → `no_students` → `nobody_started`. A failed parse also leaves zero concepts, so reporting both would say one thing twice. **Rendered only when non-empty** — a green "all clear" card would be a permanent widget reporting nothing.

**`students[].by_material` is inline and carries STARTED materials only.** ~45 KB at 50 students × 10 materials, well under the ~256 KB that made the per-concept matrix a separate route — and it means **no student id ever appears in a URL** on this page, so the route keeps its zero-IDOR property. Per-concept detail still belongs to `/materials/:id/students/:id/concepts`.

**`concepts` is capped at the weakest 20 ASSESSED.** Unassessed are excluded by construction, not filtered after: they sit at P(L₀), below every genuinely struggling concept, so including them would fill the list with concepts nobody has been asked about. `counts.concepts_assessed` is the real total behind the list.

**Deliberately absent — a class mastery curve over time.** The student curve anchors its last point to `bkt_mastery` by construction; a class mean cannot, because its denominator changes as students start. Fix it at "started now" and every student who had not yet begun contributes an all-P(L₀) EQ(4), which is printing the prior; let it move and **the class average drops when a new student begins**, reading as "the class got worse" because someone joined. Both are wrong. Revisit only with a count, never a mean. Streaks, study hours, badges, per-student activity feeds and Free Recall percentages are out for the same reasons they are out of the student dashboard.

**Measured float boundary, recorded not fixed:** `meanOrNull([0.6, 0.1333])` gives **0.3666**, not the 0.3667 exact decimal arithmetic implies — IEEE754 puts `0.6 + 0.1333` at `0.7332999999999999`, just below the 4dp rounding boundary. Both routes go through the same `meanOrNull`, so the two screens still agree, and it is the fourth decimal of a figure that renders as "37%" either way.

**`src/data/mockEducator.ts` no longer contains any invented data.** `EDUCATOR`, `STUDENTS`, `MATERIALS`, `CONCEPTS`, `CONCEPT_MASTERY` and `GRADE_LEVEL_MASTERY` are gone, along with every helper deriving from them; what remains is `ALL_GRADE_LEVELS`, the formatters and two types, all real. **`SUBJECTS` and `subjectName()` left on 2026-08-28** — they were the last thing in the file copying the database instead of reading it; see the subject-catalogue rule above. **The file is misnamed now** and a rename is a handful of mechanical import edits, deliberately not bundled. `components/educator/MasteryBar.tsx` was deleted with its last consumer — it took a bare `number` and so could not express "not assessed", which is the common case on real data.

**🐛 `formatRelativeTime()` measured against a FROZEN `NOW` of 2026-07-23**, correct while every caller passed mock timestamps and wrong the moment `MaterialsLibrary` started passing real ones: a material uploaded after that date gave a negative difference and printed **"Just now" forever, for every material**. It uses `Date.now()` now.

**Identity is real in the educator portal, and there is no email anywhere in it.** `AuthProvider` is mounted on `EducatorLayout` (its `StudentLayout` counterpart already said it could be adopted unchanged), so the sidebar, the dashboard greeting and Settings all read `GET /api/auth/me`. **`profiles` has no email column** — Settings used to print `liza.mendoza@pca.edu.ph` to every educator; that field is deleted, not repointed.

**`MaterialDetail` seeds its tab from `?tab=`**, read once as the initial value. The dashboard's material, student-breakdown and concept rows are all about performance, so they link with `?tab=performance`; Recent uploads does not, because that link is about the upload. The tab bar owns the state after mount — mirroring it back into the URL would add a history entry per toggle.

**`materials.educator_id` is `ON DELETE RESTRICT`.** An educator's materials must be deleted before the account, or the auth delete fails silently and leaves the whole fixture behind. This bit a verification harness; anything that creates a throwaway educator must tear down in that order.

## Adaptive Test Mode

> **Full reference: `LearnSyncAI artifacts/TEST_MODE_IMPLEMENTATION.md`.** Read it before changing anything here — it carries the measurements behind each rule, the debugging playbook, and the list of defects deliberately left open. What follows is only what must not be broken by accident.

**Rebuilt from scratch on 6–7 August 2026** (frontend, then backend). The version replaced made zero network calls and generated questions in the browser from hardcoded neuroscience mock data; its three endpoints had zero callers and six defects, including a `practice_telemetry` insert that omitted `question_type NOT NULL` and had therefore **never once succeeded**. No migration was needed — every column already existed unused.

**Generation is Gemini `GEMINI_CONTENT_MODEL` (`gemini-3.6-flash`) at `ThinkingLevel.MINIMAL`, as of 2026-08-18.** The paper (p. 81) says only "the large language model", so nothing in the write-up depends on the provider. It ran on Groq `llama-3.3-70b-versatile` from 2026-08-06 until Groq decommissioned the model. **MINIMAL is not a tuning preference — measured, `gemini-3.6-flash` runs ~2s at MINIMAL against 5–20s at LOW, and thinking tokens bill at the OUTPUT rate.** Nothing in generation reasons: the server owns the true/false verdict, the correct option’s position and the matching blocks, and grading is deterministic in `testGrading.ts`. **⚠️ One test is five model calls** (one per format, in parallel) against a 20/day free-tier bucket shared with extraction and Feynman — about four tests a day. The study needs the paid key.

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

## Games — BKT difficulty calibration

> **Full reference: `LearnSyncAI artifacts/GAMES_CALIBRATION_IMPLEMENTATION.md`.** It carries the
> nine tier cells with the measurements behind each, the prompt failures that shaped them, and the
> acceptance evidence. What follows is only what must not be broken by accident.

**Games READ mastery and never write it.** Paper p. 58 permits games to "utilize existing mastery estimates only ... without modifying the learner's mastery state". Nothing under the games path imports `server/lib/bkt.ts`; there is no `applyGameCompletion`; `bkt_source` stays a two-value enum. Free Recall and Feynman obey the same *no-write* rule — but they do not read it either, so **games are the only reader outside Test Mode, the dashboard and the educator analytics.**

**The tier vocabulary is `foundational | intermediate | advanced`, not `easy | medium | hard`.** Paper p. 98's Difficulty Alignment criterion is stated in exactly those words and is applied to "educational game content", so `game_content.difficulty` must be readable against it directly. The old vocabulary is gone and CHECK-constrained out.

**`GenerateGameContentSchema` deliberately has NO `difficulty` field.** The server derives it from M_doc over the selected materials — a client-supplied difficulty is a client-chosen difficulty, the same reasoning as `testAllocation.ts` re-deriving test length. A stale client still sending one has it silently stripped by Zod, so **verify by reading the stored row, not the response code.**

**`server/lib/gameDifficulty.ts` owns everything games-specific** — selection, the timer table, the nine tier cells, `SELECT_BUFFER`. It imports from `testDifficulty.ts`; nothing game-shaped goes back the other way. `TIER_GUIDANCE` is reused because it is the paper's own p. 81 framing.

**An unassessed concept counts as 0.50 in the SELECTION weight and P(L₀) = 0.10 inside `documentMastery()`, and that disagreement is deliberate.** EQ(4) estimates what a student knows, so an unmeasured concept must enter it at the prior. Selection asks what is worth *practising*, and there the prior is wrong twice over: the P(T) floor puts every assessed concept at ≥ 0.20, so ranking by raw mastery would put every concept nobody has asked about **above** every concept the student is measurably failing. On a 57-concept lesson with six assessed, all fourteen trivia slots would go to never-seen concepts and mastery would change nothing. 0.50 gives *known weak > unknown > known strong*. **Do not "fix" it to `P_L0`.**

**Selection is weighted sampling (Efraimidis–Spirakis A-Res), not a sort.** A deterministic weakest-first sort makes "Play Again" rebuild a byte-identical game; the shuffle it replaced existed for that variety. `WEIGHT_FLOOR = 0.05` keeps a mastered concept reachable and bounds the exponent at 20 — **raise the floor, never the exponent.** Measured over 10,000 trials at n=8 of 20: weak 62%, unknown 47%, mastered 6%.

**The trivia timer is server-authoritative and stored in the payload**, not derived client-side from the tier. `TRIVIA_QUESTION_MS` is 20s / 15s / 10s (paper p. 83 names "trivia response timers" explicitly). Storing it means a stored game replays with the clock its questions were written for. `isUrgent` is `questionMs / 3`, never a fixed 5s — at the advanced 10s clock that would paint the ring red for half of every question.

**⚠️ TRIVIA'S ANSWER POSITION IS ASSIGNED SERVER-SIDE BY `placeAnswers()`, AND THE MODEL'S ORDERING IS DISCARDED.** Measured across every trivia game this project had stored — 130 questions, 13 games — the correct option sat at **A 90 times (69%)**, against 32.5 expected, and at `advanced` it was **44 of 50 (88%)**. A student who never read a question and always tapped the first option scored 69%, worst at the tier with the 10-second clock. That is a Difficulty Alignment defect (p. 98), not just unfairness: the measured difficulty of an advanced game was not what the calibration claimed. The cause is structural and not fixable in the prompt — `TRIVIA_SCHEMA` pins `propertyOrdering: ['question', 'options', 'correct']`, so the model writes the option list *before* the key and the key merely copies a choice already made in slot 0. Adaptive Test Mode never had the bug because `testGeneration.ts` never lets the model express an order at all (20/20/17/11 over 68 stored questions). One prompt bullet remains, for the milder length tell — correct answers ran 79.8 characters against 76.4 — and it is the ONLY prompt line this change touched; `rules.question`, `rules.options` and `rules.focus` are the tier calibration and stay byte-identical.

**Placement is BALANCED, not independently random, and the answer is spliced out BY INDEX.** Both halves are load-bearing. With plain per-question randomness and 10 questions, roughly **1 game in 13** still lands five or more answers on A, which a student who has just been told this was fixed reads as unfixed — an even multiset gives every position 2 or 3 of the 10, always. The slots are then Fisher–Yates shuffled **end-to-end, never dealt one-of-each per block of four**, which would let a student who tracked three questions know the fourth by elimination; and the starting `offset` is random because 10 does not divide by 4, so a fixed start would hand the surplus to A and B in every game — a smaller version of the same bug. **Never replace the splice with `filter(o => o !== correct)`**: nothing validates that the four options are distinct, so a duplicated answer would lose both copies and leave a three-option question. It uses `Math.random()`, not the `seededShuffle`/`hash` idiom from `testGeneration.ts` — a test must be reproducible, a game must not be, or "Play Again" rebuilds a byte-identical one.

**⚠️ Do NOT add a prompt line telling the model not to order the options.** It was tried alongside the SHAPE bullet and the generation came back with **9 questions where every stored game had returned 10**; removing it restored 10. One sample does not prove causation, but the instruction is incoherent — the model *must* emit an ordered array to satisfy the schema — and buys nothing when the order is discarded anyway.

**The mock `COURSE_DATABASE` in `gamesData.ts` was 23 of 24 at position A and is now 6/6/6/6.** It is hand-written demo data reachable only at `/student/games/trivia` with **no `?contentId=`**, which `GamesLanding` never produces — so it matters for *verification*, not for students: testing the fix on that URL would have shown all-A and read as a failed fix. **Verify through "Play Game" from the Games landing page.**

**There is no per-question difficulty badge, and it must not come back.** Difficulty is one tier per session (p. 81, "session-based adaptation"); a "HARD" chip inside a Foundational game contradicts the calibration on screen. The tier is stated once, on `GameStage`, for all three games.

**The build-modal preview is gated on `assessed > 0`,** matching `AdaptiveTestTab` — at a cold start every student is foundational, which says nothing, and P(L₀) must never print as a score. It reconstructs EQ(4) over the union as `Σ(m_doc·n) / Σn` from `by_material`, **filtered to the selected ids — never `overall`**, which is the whole space. The 4dp rounding makes it differ from the server by ≤ 1e-4.

**⚠️ THE DIFFICULTY LIVES IN THE DISTRACTORS, AND EVERY ATTEMPT TO PUT IT IN THE QUESTION FAILED — measured, three times.** Asking the model to make advanced questions harder produced, in order: a four-verb template applied to all ten items that **invented facts** ("What does Cross-Site Scripting *prevent*?" → "Malicious script execution", which XSS *causes*); then ungrammatical fragments; then subjectless stems ("Ensures reliable data transfer?") naming no concept at all. The ceiling `FORMAT_TIER_GUIDANCE` documents is the cause — most of this corpus is OWASP names and OSI layers defined in one line, and a one-line definition cannot support a consequence question. What works is an ordinary question plus **options drawn from the lesson's own neighbouring concepts**, which the model can check against the list it was given. About two items in ten still come back definitional; that is the ceiling, and chasing it is what produced the falsehoods.

**Trivia's reading budget must stay two-sided.** Stated only as "the student has N seconds, anything they cannot finish reading measures nothing", the model optimised the one thing it could check and collapsed advanced to 2.5-word questions like "What is XSS?" — the *easiest* output of the three tiers. It is now a word target to aim for, not a ceiling to duck under.

**Trivia cannot reuse `FORMAT_TIER_GUIDANCE.multiple_choice`, and the reason is arithmetic.** Its `advanced` cell says "Open with a one-sentence scenario"; advanced trivia runs on a 10-second clock, and ~52 words at ~4 words/sec is thirteen seconds of reading before one second of thinking.

**Keep the crossword's `A–Z, 3–10 letters` and `NEVER abbreviate` bullets tier-independent and adjacent to the tier'd `"answer"` line.** Advanced answers name consequences and are the longest; `gameContent.ts` filters that range, `crossword.ts` needs ≥2 survivors, and the route throws on an empty layout, so this is where a 502 would come from.

**`POST /api/gamification/session` takes only `content_id` plus the outcome.** `space_id`, `material_id`, `game_type` and `mastery_snapshot` are read from the owner-checked `game_content` row — the snapshot is the evidence p. 98 reads, so a client-supplied one would be a client-chosen finding. The insert **lists its fields explicitly**: it used to be `{ ...parsed.data }`, which binds the request shape to the table's columns, and `recordSession()` swallows every error, so a mismatch would stop session logging entirely with no visible symptom.

**`POST /api/games/generate` gate order is `requireOwnedSpace` (404) → `rejectInaccessibleMaterials` (403) → linked-to-this-space (404).** Gates 2–4 were all missing before calibration landed. Gate 4 is not redundant with gate 3: passing the grade rule proves the student may *read* the material, not that this space holds it, and the route stores a `mastery_snapshot` attributed to `space_id`.

**`regenerate()` must refresh the calibration from the POST response.** It never called `setSource`, which was harmless while the source params were identical across generations — but tier and timer now vary per generation, so "Play Again" would show the previous game's chip and clock.

**`server/lib/spaceAccess.ts` is the single home for space ownership.** `loadOwnedSpace`/`requireOwnedSpace`/`spaceMaterialIds` had three private copies plus a fourth inlined in `practice.routes.ts`; games would have been the fifth. The active/role/grade checks are the part that must not drift.

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

## Mastery-evidence export — the study's learning-progress measurement

> **⚠️ THIS REPLACED THE PRE-TEST / POST-TEST INSTRUMENT, removed 2026-09-02.** That feature
> (migration 0024, built 2026-08-21) served the paper's **RQ4 (p. 55)** — the pre-test/post-test
> score difference — which p. 103 named the *primary* evaluation instrument. It was withdrawn on
> advice: the actual student-usage window is **one week** (implementation runs 1–3 weeks — week 1
> gathers materials and distributes accounts, week 2 is the usage, week 3 wraps up), and a pre/post
> delta over one week is not attributable to the platform. Migration `0025` dropped
> `material_assessments`, `assessment_attempts` and the `assessment_phase` enum; the seven feature
> files, the nine `PRE/POST GATE` call sites and the material lock are all gone.
> `LearnSyncAI artifacts/PREPOST_TEST_IMPLEMENTATION.md` survives as a historical record, marked
> REMOVED. **Do not re-implement from it.**

**`GET /api/educator/materials/:materialId/mastery-evidence` is the replacement, and it is one route
plus one button.** Educator-scoped, per material, read-only, no Zod (path parameter only, like the
file's other three routes), 404 via `requireOwnedMaterial()`. The button lives in the class-summary
header of `ClassPerformance.tsx` — **not a new tab**, because a third tab is exactly the surface the
pre/post instrument occupied and that was deliberately removed. It fetches **lazily on click**: it
reads the BKT audit trail, and a research export must not cost every educator that on every tab entry.

**⚠️ THE PAIR, AND WHY IT IS THIS PAIR.** Over `S(student)` = this material's concepts that have a
`bkt_mastery` row:

```
start_mastery = mean over S of p_l_posterior of that concept's OLDEST bkt_update_logs row
end_mastery   = mean over S of bkt_mastery.latent_mastery
growth        = end − start
```

Three obvious "before" values are **all exactly P(L₀) = 0.10** and therefore forbidden: `p_l_prior` of
the oldest log row, EQ(4) at t = 0, and a backward reconstruction to the start of the window. All
three are the model's initialisation, identical for every student, and printing one would print an
assumption as a measurement. Both ends here are real evidence, and both are means over the **same
set** — which is what makes `growth` a paired per-student difference rather than two populations
compared. Unassessed concepts are excluded **by construction** (no mastery row ⇒ no log row ⇒ no key
in either map), never filtered afterwards.

**⚠️ `start_mastery` IS "AFTER THE FIRST OPPORTUNITY" AND MUST NEVER BE LABELLED "BASELINE",
"PRE-TEST" OR "BEFORE STUDYING".** EQ(3) is applied to the student's first answer, so that answer's
outcome is already inside the number (a first correct MCQ lands at 0.3271, a first wrong one at
0.2174). A student assessed exactly once per concept therefore has `start == end` and `growth == 0` —
correct, not a bug, which is why `opportunity_count` ships beside it. The rule is stated on
`FirstObservation` in `testDifficulty.ts`, on the route, and on `EvidenceStudent` in
`educatorAnalytics.ts`; it is the fact most likely to be misread later.

**`classFirstObservations()` in `server/lib/testDifficulty.ts` is the only reader of
`bkt_update_logs` outside the dashboard curve.** It chunks both id lists exactly as
`classMasteryRows()` does, and additionally **pages each chunk pair** — PostgREST's default cap is
1000 rows and one material can legitimately want 2,000 (50 students × 2 tests × 20 items).
**Ascending order is load-bearing**: the row cap then drops only the NEWEST rows, which this reader
does not need, because the "after" side is anchored to `bkt_mastery` and never to the log. (The same
1000-row hazard exists unguarded in `classMasteryRows()` — 200 × 200 chunks, and 50 students × 57
concepts is 2,850 rows. Verify and fix that in its own change.)

**A mastery row with no surviving log row is dropped from BOTH sides** and counted in
`concepts_without_trail`. Filling the start with P(L₀) would invent a measurement; dropping it only
from the start would break the pairing and inflate `growth`. **`logWriteError` in `bkt.ts` stays
non-fatal — do not promote it because this reader exists**, exactly as the dashboard curve's rule
says.

**Never print P(L₀), three gates:** `start`/`end`/`growth`/`m_doc` are null when
`assessed_concept_count === 0`; class figures use `meanOrNull()` over **started** students only. Gate
on the counts, never on `=== 0.1`. Not-started students are **listed, not filtered** — "nineteen of
twenty never opened this" is a finding, and a blank cell is the honest rendering of it. `growth` is
`round4(round4(end) − round4(start))`, so a reviewer recomputing the column from the two beside it
gets the same digits.

**Ordering is the roster's, not weakest-first.** The partition-then-sort rule everywhere else in
`educator.routes.ts` is for *ranked UI lists*; this is a table destined for a statistics package,
where a stable name order is what joins against a class list — and keeping it sidesteps the
null-in-a-numeric-comparator NaN hazard rather than defending against it.

**It stays archive-blind**, unlike `GET /overview`. `requireOwnedMaterial()` deliberately returns
archived materials to their owner, and an educator archiving a lesson at the end of the study must
still be able to export its evidence. `is_archived` ships so the file's provenance is visible.

**Operational, not code:** a student moved to another grade or a disabled account drops out of
`rosterFor()` and vanishes from the export, so **export before any account cleanup**. And re-uploading
a material cascade-deletes its concepts → `bkt_mastery` → `bkt_update_logs`, destroying the evidence
irrecoverably.

**`downloadCsvFile()` moved into `src/lib/csvAccounts.ts`**, beside `toCsv()`/`csvCell()`, which now
owns the whole write-a-CSV-file job. Two call sites — `ImportAccountsModal` and this export. All
writing goes through `csvCell()`: a surname like `Dela Cruz, Jr.` unquoted splits into two cells and
shifts every number one column across, which is the measured failure that put it there.

**Deliberately not built:** no class-level before/after chart (the denominator moves as students
start, so the line drops when a new student begins — the same reason the educator dashboard has no
class mastery curve); no t-test, p-value or effect size in the app (the statistics belong in the
stats package, not in a second unreviewable implementation); no date-range parameters (clipping the
window makes "the first observation" ambiguous); no per-concept evidence CSV (the drill-downs already
exist on screen); and **no new table and no snapshot job** — the audit trail already holds it.
