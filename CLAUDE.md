# LearnSyncAI — CLAUDE.md

This file provides essential context for AI coding assistants working on the LearnSyncAI project.

---

## Project Overview

**LearnSyncAI** is a full-stack, AI-powered learning platform for students. It combines several evidence-based study techniques (spaced repetition, free recall, the Feynman technique, adaptive testing) with AI-powered feedback and gamification into a single application.

There is **only one user role: `student`**. There is no instructor or admin role.

---

## Tech Stack

### Frontend
- **Framework:** React 19 + TypeScript (Vite, port 3000)
- **Routing:** React Router DOM v7
- **Styling:** Tailwind CSS v4 — uses utility classes heavily. Design system tokens are defined in `src/index.css`.
- **HTTP Client:** `axios` — wrapped in `src/lib/api.ts`. Always use `api.get(...)` / `api.post(...)` etc., never raw `fetch`.
- **UI Components:** Lucide React for icons, Motion for animations.

### Backend
- **Framework:** Express.js + TypeScript (tsx watch, port 5000)
- **Entry point:** `server/index.ts`
- **Validation:** Zod — all request bodies must be validated with a Zod schema defined in `server/types/api.ts` before any logic runs.
- **Auth middleware:** `server/middleware/auth.ts` — all protected routes must use `authenticate` then `requireRole('student')`.

### Database
- **Provider:** Supabase (PostgreSQL + pgvector extension)
- **Client:** `server/lib/supabase.ts` — exports `supabaseAdmin` (service role, full access) for server-side use. Never use the anon client on the server.
- **Schema:** `schema.sql` — single source of truth for all table definitions.

### AI Services
| Purpose | Model | Location |
|---|---|---|
| Concept extraction from documents | `gemini-2.5-flash` | `server/lib/gemini.ts` → `generateJsonFromDocument()` |
| JSON structured responses (extraction, analysis) | `gemini-2.5-flash` | `server/lib/gemini.ts` → `generateJson()` |
| Free-text generation (feedback, coaching) | `gemini-2.5-flash` | `server/lib/gemini.ts` → `generateContent()` |
| Embeddings (semantic similarity) | `gemini-embedding-001` (3072 dims) | `server/lib/gemini.ts` → `generateEmbedding()` |
| Chat / streaming responses (AI Study Assistant) | `llama-3.1-8b-instant` via Groq | `server/lib/groq.ts` |
| Flashcard generation | `llama-3.3-70b-versatile` via Groq | `server/lib/groq.ts` |

> **IMPORTANT:** The embedding model **must always be `gemini-embedding-001`**. All concept vectors stored in the `concepts` table use 3072 dimensions from this model. Never switch embedding models — doing so would make all stored vectors incompatible.

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
│   │   └── supabase.ts            # Supabase admin client
│   ├── middleware/
│   │   ├── auth.ts                # JWT authentication middleware
│   │   └── requireRole.ts         # Role-based access control
│   ├── routes/
│   │   ├── auth.routes.ts         # /api/auth
│   │   ├── materials.routes.ts    # /api/materials (upload, parse, embed)
│   │   ├── studyspaces.routes.ts  # /api/spaces (CRUD, sharing)
│   │   ├── flashcards.routes.ts   # /api/flashcards (decks, cards, spaced rep)
│   │   ├── cognitive.routes.ts    # /api/cognitive (free recall, Feynman)
│   │   ├── practice.routes.ts     # /api/practice (adaptive tests)
│   │   ├── gamification.routes.ts # /api/gamification (games, XP, badges)
│   │   ├── bkt.routes.ts          # /api/bkt (mastery recalculation)
│   │   └── chat.routes.ts         # /api/chat (RAG-based study assistant)
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
│   │   └── student/
│   │       ├── StudySpace.tsx     # Main container — hosts all 5 study tabs
│   │       ├── StudentDashboard.tsx
│   │       ├── StudySpacesList.tsx
│   │       └── studySpaceTabs/
│   │           ├── ResourcesTab.tsx    # Document upload + AI chatbot
│   │           ├── FlashcardsTab.tsx   # Flashcards + spaced repetition
│   │           ├── FreeRecallTab.tsx   # Free recall + AI evaluation
│   │           ├── FeynmanTab.tsx      # Feynman technique
│   │           └── AdaptiveTestTab.tsx # Adaptive practice tests
│   └── index.css                  # Tailwind config + design system tokens
│
├── schema.sql                     # Supabase DB schema (source of truth)
├── ARCHITECTURE.md                # High-level feature logic and data flow
└── CLAUDE.md                      # This file
```

---

## Key Architecture Patterns

### Adding a New API Endpoint
1. Define a Zod schema in `server/types/api.ts`.
2. Add the route handler to the appropriate file in `server/routes/`.
3. Use `supabaseAdmin` for all DB operations — never the anon client.
4. All routes must start with `router.use(authenticate, requireRole('student'))`.
5. Always `safeParse()` the request body and return a 400 if validation fails.

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
- **Always run `npm run lint` after changes.** The project uses `tsc --noEmit` as its linting step.
- **No instructor or admin role exists.** Do not add role checks for anything other than `'student'`.
- **`schema.sql` is the DB source of truth.** When DB changes are made, update `schema.sql` to reflect them.
- **The `ai_feedback` column in `cognitive_logs` stores a JSON string.** Parse it with `JSON.parse()` before using it on the frontend.
