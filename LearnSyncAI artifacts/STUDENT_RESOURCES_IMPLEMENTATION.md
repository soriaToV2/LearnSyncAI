# Student Resources Tab — Implementation Reference

**Feature:** Student-facing distribution of educator-published learning materials
**Status:** Implemented and verified (47/47 automated checks passing, `tsc --noEmit` clean)
**Date:** 29 July 2026
**Migration applied:** `20260729090019_study_space_subject`

> **Read this first if you are an AI agent debugging or extending this feature.**
> Sections 1–4 are the mental model. Section 9 is the debugging playbook. Section 11
> lists known defects that were deliberately left alone — check it before "fixing"
> something that is already documented as broken.

---

## Table of Contents

1. [What this feature is](#1-what-this-feature-is)
2. [Rules from the capstone paper](#2-rules-from-the-capstone-paper)
3. [The data model](#3-the-data-model)
4. [The security model](#4-the-security-model)
5. [API surface](#5-api-surface)
6. [Step-by-step flows](#6-step-by-step-flows)
7. [Frontend](#7-frontend)
8. [What happens when an educator archives or deletes](#8-what-happens-when-an-educator-archives-or-deletes)
9. [Debugging playbook](#9-debugging-playbook)
10. [Design decisions and why](#10-design-decisions-and-why)
11. [Known issues deliberately NOT fixed](#11-known-issues-deliberately-not-fixed)
12. [Verification](#12-verification)
13. [What was removed](#13-what-was-removed)
14. [Glossary](#14-glossary)

---

## 1. What this feature is

### In one paragraph

A student creates a study space for **one subject**. The moment it is created, the
system fills it with every non-archived material their educators published for
**that subject at that student's grade level**. The Resources tab shows those
materials read-only — the student can open the PDF and chat with the AI assistant
about it, but cannot upload, delete, or remove anything. When an educator later
publishes something new that the space does not have, the tab shows a notice with
a count and a button; pressing the button pulls the new material in.

### Why it was rebuilt

The tab was the last part of the app still built on the pre-migration-0003 model
where **students uploaded their own PDFs**. Three concrete things were broken:

| Problem | Detail |
|---|---|
| `POST /api/spaces` was dead | It inserted `is_published` and `share_token`, columns migration 0003 dropped. **No student could create a study space at all.** |
| `GET /api/materials/space/:spaceId` was dead | It filtered on `materials.space_id`, also dropped by 0003. Failed for every caller. |
| No route enforced grade level | Nothing in `server/` read `profiles.grade_level`. Any signed-in user could pass any material ID and get another grade's content. |

`study_space_materials` had existed since migration 0003 and had **never been
written to**. This feature is what that table was created for.

### Files touched

**Created**
- `supabase/migrations/20260729090019_study_space_subject.sql`
- `server/lib/materialAccess.ts`

**Modified**
- `schema.sql` — mirrors the migration
- `server/routes/studyspaces.routes.ts` — the core of the feature
- `server/routes/materials.routes.ts` — access gates; dead route removed
- `server/routes/chat.routes.ts` — access gate; history scoped to caller
- `server/types/api.ts` — `CreateStudySpaceSchema` gains `subject`; `SyncSpaceMaterialsSchema` added
- `server/types/database.ts` — `StudySpace` updated; `SpaceMaterial` added
- `src/pages/student/studySpaceTabs/ResourcesTab.tsx` — rewritten
- `src/pages/student/StudySpacesList.tsx` — subject picker; CollabShare removed
- `src/pages/student/StudySpace.tsx` — new endpoint; CollabShare removed
- `src/pages/student/games/GamesLanding.tsx` — one-line endpoint swap
- `CLAUDE.md`

---

## 2. Rules from the capstone paper

**The paper is the source of truth.** If code or documentation contradicts it, the
paper wins. Direct quotations, with page numbers from `LearnSync AI version 4.docx.pdf`:

> "only authenticated educators are authorized to upload learning resources.
> Students are not permitted to upload instructional materials, and all AI-assisted
> functionalities depend entirely on the availability of educator-provided learning
> resources." — **p. 61**

> "The Material Ingestion and Distribution Core receives educator-uploaded materials
> and routes them according to source type… The Core then makes the processed content
> available to students **within the educator's selected grade level**." — **p. 66**

> "The Study Space Hub is where students access educator-uploaded materials…" — **p. 66**

> "These uploaded materials serve as the **exclusive knowledge base** for all
> AI-assisted functionalities." — **p. 57**

> "Row-Level Security (RLS) enforcing data isolation between students…" — **p. 67**

> "To ensure a manageable implementation, the learning activities will initially focus
> on **the subject** identified through the requirement analysis as the most difficult
> for students in each participating grade level." — **p. 59**
> *(This is the paper basis for scoping a study space to one subject.)*

### Non-negotiable invariants

1. Students never upload. The student UI must contain no upload control, no
   drag-and-drop, no file picker.
2. Students never delete or remove materials. Their only write is pulling in newly
   published ones, and even that does not choose *what* arrives.
3. A student sees only materials published to **their own grade level**.
4. Archived materials are invisible to students.
5. Nothing a student does changes what an educator sees or what another student sees.

---

## 3. The data model

### `study_spaces` (migration 0019 added `subject`)

```sql
CREATE TABLE study_spaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    subject     TEXT NOT NULL,          -- FK → subjects(code), added by 0019
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`subject` is fixed at creation and cannot be changed.** `UpdateStudySpaceSchema`
deliberately omits it. Rationale: a space's flashcard decks, practice tests, and
mastery are all built from its materials. Re-pointing the space at another subject
would either strand that work or require destroying it. Creating a second space is
cheap and lossless.

> **Note on `schema.sql` ordering:** `study_spaces` (section 4) is created *before*
> `subjects` (section 5), so the FK is declared as a separate `ALTER TABLE` right
> after the subjects seed. Do not move it inline or a from-scratch run will fail.

**Backfill note:** one dev-era space predated the column and was set to `'TLE'`,
the same convention migration 0014 used when `materials.subject` was introduced.

### `study_space_materials` (unchanged since 0003, now actually used)

```sql
CREATE TABLE study_space_materials (
    space_id    UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES materials(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, material_id)
);
```

The composite primary key is what makes `sync` idempotent — see §6.3.

### `materials` (unchanged, read-only from the student side)

Relevant columns: `subject` (FK → `subjects.code`), `grade_levels SMALLINT[]`,
`is_archived BOOLEAN`, `parsed_status`, `parse_error`, `is_scanned`,
`file_size_bytes`, `page_count`.

Index used by every student query: `idx_materials_grade_levels` (GIN on `grade_levels`).

### The central formula

```
space contents  = linked  ∩  published
available_count = | published − linked |

where published = materials WHERE subject     = space.subject
                              AND is_archived = false
                              AND grade_levels @> ARRAY[student.grade_level]
      linked    = study_space_materials WHERE space_id = space.id
```

**This is the whole feature in two lines.** Everything else is plumbing.

### Stored list, not a live query — and why it matters

The space's contents are **stored** in `study_space_materials`, not recomputed on
every page load. This is a deliberate architectural decision, and reversing it would
break the feature:

- You cannot say "2 new materials are available" if you have nothing to diff against.
  The notice *is* the difference between what is published and what the student holds.
- With a live query, new materials would silently appear, which the requirements
  explicitly forbid ("It should not quietly appear on its own").

**But reads still filter the stored list against the live rules.** `linked ∩ published`
means archiving a material hides it from every student instantly while the link row
survives. Un-archive and it returns on its own. See §8.

---

## 4. The security model

### The core problem

`server/lib/supabase.ts` exports `supabaseAdmin`, which uses the **service role key**.
That key bypasses Row-Level Security by design. Migration 0008 states it outright:

> "the Express API talks to Postgres with the service role key, which bypasses RLS by
> design. These policies are the defence-in-depth layer that protects direct anon-key
> access… **The API layer must still enforce role and ownership itself.**"

So the RLS policies in migration 0008 do **nothing** for a request that reaches
Express. Before this feature, that was harmless — students only ever saw their own
uploads. The moment the tab shows teacher-published materials, an unguarded route
becomes a way to read another grade's content by guessing or copying an ID.

### `server/lib/materialAccess.ts`

One file answers "may this caller read these materials?" for the entire codebase.

| Export | Purpose |
|---|---|
| `accessibleMaterialIds(userId, ids)` | Returns a `Set` of the IDs this user may read. One query regardless of how many IDs. |
| `canReadAllMaterials(userId, ids)` | Boolean convenience wrapper. Empty input is vacuously `true`. |
| `requireMaterialAccess(param = 'id')` | Express middleware for a material ID in the path. **Sends 404.** |
| `rejectInaccessibleMaterials(req, res, ids)` | For `material_ids` in a body. **Sends 403**, returns `false` — caller must `return` immediately. |
| `publishedMaterialIds(subject, gradeLevel)` | The `published` set from §3. Used by study space routes. |
| `isUuid(value)` | Guards against a malformed ID reaching Postgres as a 500. |

### The rule it implements

```
disabled account  → nothing (checked before role)
admin             → everything
educator          → materials WHERE educator_id = self  (archived or not)
student           → materials WHERE NOT is_archived
                                 AND grade_levels @> ARRAY[self.grade_level]
student, no grade → nothing
```

### Why 404 for path IDs and 403 for body IDs

**404 on `/materials/:id/…`** — a 403 would confirm that the ID names a real
material, which is itself a disclosure. From outside, an inaccessible material and
a non-existent one must be indistinguishable.

**403 on body arrays** — these routes are only ever reached with IDs the client
already listed from its own study space. A mismatch means the client is asking for
something it was never shown, so there is no ID to protect. A 403 is also more
actionable for a developer debugging a real integration.

### Where it is applied

| Route | Guard | Response |
|---|---|---|
| `GET /api/materials/:id/view` | `requireMaterialAccess()` | 404 |
| `GET /api/materials/:id/concepts` | `requireMaterialAccess()` | 404 |
| `GET /api/materials/:id/status` | `requireMaterialAccess()` | 404 |
| `POST /api/materials/concepts/batch` | `rejectInaccessibleMaterials` | 403 |
| `POST /api/materials/generate-flashcards` | `rejectInaccessibleMaterials` | 403 |
| `POST /api/chat` | `rejectInaccessibleMaterials` + space ownership | 403 / 404 |
| `GET /api/chat/history/:spaceId` | `.eq('student_id', req.user.id)` | empty array |
| `GET /api/spaces/:id` | owner check inline | 404 |
| `GET /api/spaces/:id/materials` | `loadOwnedSpace()` | 404 |
| `POST /api/spaces/:id/materials/sync` | `loadOwnedSpace()` | 404 |

**Every ID must pass.** One allowed ID cannot smuggle a forbidden one through in the
same batch — verified by test.

### ⚠️ If you add a new route that takes a material ID

You **must** gate it. This is not optional and RLS will not save you. Copy the
pattern from an existing route:

```ts
// Path parameter:
router.get('/:id/something', requireMaterialAccess(), async (req, res) => { … });

// Body array (AFTER Zod validation):
const { material_ids } = parsed.data;
if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;
```

---

## 5. API surface

All routes are under `/api`. All require `authenticate` (JWT in `Authorization: Bearer`).

### `POST /api/spaces` — create a study space

```jsonc
// Request
{ "title": "Science Quarter 2", "subject": "SCI", "description": null }

// 201
{ "data": { "id": "…", "title": "…", "subject": "SCI", "student_id": "…",
            "created_at": "…", "updated_at": "…", "material_count": 3 },
  "message": "Study space created" }
```

| Status | Cause |
|---|---|
| 400 | Missing/empty `title` or `subject` (Zod) |
| 400 | `subject` is not a row in `public.subjects` — `{ "error": "Unknown subject" }` |
| 400 | Caller's profile has no `grade_level` — `{ "error": "No grade level" }` |
| 403 | Caller is not an active student |
| 500 | Insert failed |

**Side effect:** immediately links every published material for `(subject, grade)`.
`material_count` in the response is how many were attached. If the pre-fill throws,
the space is still returned (the student can pull the same materials in from the
Resources tab) and the error is logged as `[Study Space] Pre-fill failed for space_id=…`.

### `GET /api/spaces/:id/materials` — the tab's only load call

```jsonc
// 200
{ "data": {
    "space": { "id": "…", "title": "Science Quarter 2", "subject": "SCI" },
    "materials": [
      { "id": "…", "title": "Forces and Motion", "description": null,
        "subject": "SCI", "file_size_bytes": 896, "page_count": 3,
        "is_scanned": false, "parsed_status": "completed", "parse_error": null,
        "concept_count": 4, "added_at": "2026-07-29T…" }
    ],
    "available_count": 2
} }
```

- Owner only. Anything else → **404**.
- `materials` is ordered oldest-linked first (`added_at`).
- `concept_count` comes from one grouped query — **no N+1**.
- Never returns `educator_id` or `storage_path` (see `SPACE_MATERIAL_COLUMNS`).
- Includes materials whose `parsed_status` is `failed` or `pending` — the UI shows
  them as unavailable with a reason. Only *archived* and *out-of-grade* are excluded.

### `POST /api/spaces/:id/materials/sync` — pull in new materials

```jsonc
// Request: {}  (empty, but still Zod-validated)
// 200
{ "data": { "space": {…}, "materials": […], "available_count": 0, "added_count": 2 },
  "message": "2 materials added" }
```

- **Idempotent.** Running it twice returns `added_count: 0` and creates no duplicates.
- The client cannot name which materials to attach — the set is derived server-side
  from `(space.subject, student's grade)`. There is nothing to tamper with.
- Owner only → 404 otherwise.

### `GET /api/spaces/:id` — one study space

Owner only, 404 otherwise. Previously allowed access to "published" spaces; that
concept no longer exists.

### `PUT /api/spaces/:id` — rename / edit description

`UpdateStudySpaceSchema` accepts `title` and `description` only. **`subject` is not
accepted by design.**

### Removed

`GET /api/materials/space/:spaceId` — **deleted.** It targeted the dropped
`materials.space_id` column. Its three callers were migrated to
`GET /api/spaces/:id/materials`.

---

## 6. Step-by-step flows

### 6.1 Student creates a study space

```
Browser: StudySpacesList.tsx — "Create New Space"
  ├─ title input (required)
  └─ subject <select> from SUBJECTS (src/data/mockEducator.ts) — required
        ↓ api.post('/spaces', { title, subject })
Server: studyspaces.routes.ts POST /
  1. authenticate            → req.user
  2. requireRole('student')  → profile is active + role student
  3. CreateStudySpaceSchema.safeParse(body)              → 400 on failure
  4. SELECT code FROM subjects WHERE code = subject      → 400 if unknown
  5. SELECT grade_level FROM profiles WHERE id = user    → 400 if null
  6. INSERT INTO study_spaces (title, description, student_id, subject)
  7. attachPublishedMaterials(space.id, subject, gradeLevel)
       ├─ publishedMaterialIds(subject, grade)  → the `published` set
       ├─ linkedMaterialIds(space.id)           → [] for a new space
       └─ upsert(missing, { onConflict: 'space_id,material_id',
                            ignoreDuplicates: true })
  8. 201 { data: { …space, material_count } }
        ↓
Browser: fetchSpaces() → card list refreshes, space shows its SubjectBadge
```

### 6.2 Student opens the Resources tab

```
Browser: StudySpace.tsx mounts
  ├─ api.get(`/spaces/${spaceId}`)            → space record (owner-checked)
  ├─ api.get(`/spaces/${spaceId}/materials`)  → availableResources
  │     (filtered to parsed_status === 'completed', passed to the 4 other tabs)
  └─ decks + flashcards

Browser: ResourcesTab.tsx mounts
  ├─ api.get(`/spaces/${spaceId}/materials`)  → materials + available_count
  └─ api.get(`/chat/history/${spaceId}`)      → past conversation

Server: GET /:id/materials
  1. loadOwnedSpace(spaceId, userId)
       ├─ space exists AND student_id === userId   → else null → 404
       └─ profile active, role student, grade_level not null → else null → 404
  2. buildSpaceMaterials(space)
       ├─ published  = publishedMaterialIds(subject, grade)
       ├─ linked     = linkedMaterialIds(spaceId)          (ordered by added_at)
       ├─ visibleIds = linked ∩ published                  ← hides archived/regraded
       ├─ available  = |published − linked|
       └─ 3 parallel queries: materials, concept counts, added_at
  3. 200 { data: { space, materials, available_count } }
```

**There is no polling.** The count arrives with the material list the tab already
fetches when it opens. Tradeoff: a student sitting on the page while their teacher
uploads will not see the notice until they revisit or refresh. That matches the
stated requirement ("Next time I open my Science space…") and costs one query
instead of a timer.

The old 5-second `parsed_status` poll was **removed**. It existed because students
waited on their own uploads. Educator materials finish extraction during the
educator's upload, long before a student sees them.

### 6.3 Student pulls in newly published materials

```
Educator uploads a SCI/Grade-8 material
        ↓
Student reopens the space
        ↓
GET /:id/materials → available_count: 1
        ↓
ResourcesTab renders the banner:
  "1 new Science material from your teacher."  [ Add to my space ]
        ↓ api.post(`/spaces/${spaceId}/materials/sync`, {})
Server: POST /:id/materials/sync
  1. SyncSpaceMaterialsSchema.safeParse(body ?? {})
  2. loadOwnedSpace()                                → 404 if not owner
  3. attachPublishedMaterials() → inserts the missing link rows
  4. buildSpaceMaterials()      → fresh payload
  5. 200 { data: { …, added_count } }
        ↓
Browser: applyPayload(res.data) → list re-renders, available_count is 0,
         banner disappears, transient "1 new material added." confirmation
```

**Idempotency:** `upsert` with `onConflict: 'space_id,material_id'` and
`ignoreDuplicates: true`. `attachPublishedMaterials` also short-circuits when
`missing.length === 0`, so a redundant press is a no-op that returns `added_count: 0`.

---

## 7. Frontend

### `ResourcesTab.tsx` — the read-only tab

Layout is unchanged from before: material list on the left, PDF viewer on the right,
chat drawer over the top. What changed is everything behind it.

| Removed | Reason |
|---|---|
| `UploadCloud` / `Trash2` imports | No upload, no delete |
| `fileInputRef`, `handleFileSelect` | No file picker |
| `deleteFile`, `confirmDeleteFile`, delete `Modal` | Students cannot delete |
| `isUploading`, `uploadError` | Nothing to upload |
| The 5-second status poll | Materials arrive already processed |
| Per-material `/concepts` fetch (N+1) | `concept_count` now arrives with the list |

| Added | Detail |
|---|---|
| `SubjectBadge` per row | Consistent with the educator portal |
| `formatFileSize()` | Real size from `file_size_bytes`, not "Unknown size" |
| `unavailableReason()` | Plain-language explanation for failed/scanned/pending |
| New-materials banner | Rendered **only** when `available_count > 0` |
| `handleSync()` | Calls the sync endpoint, re-renders from its response |

Key derived state:

```ts
const activeMaterial = materials.find(m => m.id === selectedId) ?? null;
// Only a completed material has concepts, and concepts are the only thing the
// assistant may answer from.
const chatMaterial = activeMaterial?.parsed_status === 'completed' ? activeMaterial : null;
const canChat = !!chatMaterial && !isStreaming;
```

Selecting a failed or scanned material still opens its PDF (the file exists in
storage) but leaves the chat disabled with the reason shown inline.

**Empty state** is subject- and grade-aware:
> "Your teacher hasn't shared any Science materials for your grade yet."

No upload prompt, no error styling.

#### ⚠️ Eight props are dead but intentionally retained

`courseConnected`, `handleConnectCourse`, `selectedDoc`, `setSelectedDoc`,
`setActiveTab`, `setIsGenerating`, `setSelectedSetContent`, `setFlashcardSets`.

None is referenced anywhere in the file. They were left in place at the project
owner's explicit instruction, pending a broader study-space container cleanup.
`tsconfig.json` has no `noUnusedLocals`, so they do not fail lint. **Do not remove
them without asking.**

#### The one permitted raw `fetch`

`CLAUDE.md` forbids raw `fetch`. `POST /api/chat` is the exception: it streams
Server-Sent Events, which the JSON `api` wrapper in `src/lib/api.ts` cannot
represent. The exception is documented at the call site and in `CLAUDE.md`.

### `StudySpacesList.tsx`

- Create modal gains a **required** subject `<select>`, sourced from `SUBJECTS` in
  `src/data/mockEducator.ts` — the same constant the educator upload modal uses.
  The server re-validates against the real `subjects` table, so drift produces a
  readable 400 rather than a crash.
- Submit stays disabled until both title and subject are set.
- Cards show `SubjectBadge` + subject name instead of the old "Cloned from" badge.

### `StudySpace.tsx`

- `availableResources` now comes from `GET /spaces/:id/materials`, filtered to
  `parsed_status === 'completed'`. **This is the single source for the other four
  tabs' material dropdowns.**
- Header shows the space's subject.
- `readOnly={false}` and `spaceIsPublic={false}` are passed to `FlashcardsTab` as
  literals so that component's interface did not have to change.

### `GamesLanding.tsx`

One-line endpoint swap. Would otherwise have broken when the old route was deleted.

---

## 8. What happens when an educator archives or deletes

**This is the most common source of confusion. Read it before filing a bug.**

### Archive (`is_archived = true`)

**Nothing is deleted. Not one row.** It is a boolean flip. Only visibility changes,
because `visibleIds = linked ∩ published` and `published` excludes archived materials.

- The material disappears from the student's Resources tab.
- It disappears from the material dropdown in **all four other tabs simultaneously**
  (they all read `availableResources` from `StudySpace.tsx`).
- `GET /materials/:id/view|concepts|status` return **404** for the student.
- The educator can still view it (educators see their own materials, archived or not).
- The `study_space_materials` link row **survives**.
- **Un-archiving restores it automatically** with nothing for the student to redo.
  Verified by test.
- `available_count` does **not** increase — an archived material is not "new".

### Delete

Real cascades fire. Verified against the live database:

| Table | Column | On delete of the material |
|---|---|---|
| `concepts` | `material_id` | **CASCADE** — all concepts destroyed |
| `study_space_materials` | `material_id` | **CASCADE** — link removed |
| `game_sessions` | `material_id` | **CASCADE** |
| `activity_logs` | `material_id` | SET NULL |
| `flashcards` | `source_material_id` | SET NULL |

And transitively, because the concepts are gone:

| Table | Column | Result |
|---|---|---|
| `bkt_mastery` | `concept_id` | **CASCADE — mastery destroyed** |
| `bkt_update_logs` | `concept_id` | **CASCADE** |
| `practice_telemetry` | `concept_id` | **CASCADE** |
| `cognitive_logs` | `concept_id` | CASCADE *(see note)* |
| `flashcards` | `concept_id` | SET NULL |
| `spaced_repetition_logs` | `concept_id` | SET NULL |

> **Note:** `cognitive_logs.concept_id` is `CASCADE` in the live database but
> `SET NULL` in `schema.sql`. This is real drift — see §11. It happens not to matter
> today because Free Recall and Feynman both write `concept_id: null`
> (`cognitive.routes.ts` lines 138, 209, 523), so the cascade never fires on them.

### Effect per tab

| Tab | Archive | Delete |
|---|---|---|
| **Resources** | Material hidden; PDF 404; chat blocked. Chat history intact. | Same, plus concepts gone. |
| **Free Recall** | Removed from dropdown. All past attempts, scores, missed-concept lists intact. | **Identical** — history stores concept names as plain text. |
| **Feynman** | Removed from dropdown. All past explanations, scores, feedback intact. | **Identical.** |
| **Adaptive Test** | Removed from dropdown. Past tests and mastery bars intact. | Past tests survive **but BKT mastery and telemetry are wiped permanently.** |
| **Flashcards** | No effect. | No effect — decks belong to the space, and no card ever stores a material link (§11). |

### Practical guidance for educators

**Archiving is safe and reversible. Deleting destroys student mastery.** To replace
a material with a corrected version: archive the old one and upload the new one.
Deleting resets every student's mastery for that content, and re-uploading the same
PDF does **not** restore it — extraction creates brand-new concepts with new IDs.

---

## 9. Debugging playbook

| Symptom | Likely cause | Where to look |
|---|---|---|
| New space is empty | No material matches `(subject, grade)`, or all matches are archived | Run the SQL in §9.1 |
| Space empty for every subject | Student's `profiles.grade_level` is `NULL` → `POST /spaces` returns 400 "No grade level" | `SELECT grade_level FROM profiles WHERE id = …` |
| `available_count` stuck above 0 | The extra materials are published but the student never pressed the button; **or** the count is right and the UI banner is hidden by a CSS/state bug | Compare §9.1 output with the API response |
| Material visible to the wrong grade | `materials.grade_levels` wrong at upload | `SELECT grade_levels FROM materials WHERE id = …` |
| Student gets 404 on their own material | It was archived, or grade levels changed, or their `grade_level` changed | `accessibleMaterialIds` in `server/lib/materialAccess.ts` |
| Educator gets 404 on their own material | `educator_id` mismatch — they are not the uploader | The `educator` branch of `accessibleMaterialIds` |
| `POST /api/spaces` 400 "Unknown subject" | Frontend `SUBJECTS` constant drifted from the `subjects` table | `src/data/mockEducator.ts` vs `SELECT code FROM subjects` |
| Chat says "not available to you" (403) | `material_ids` contains something outside the student's grade | `rejectInaccessibleMaterials` |
| Chat 404 "Study space not found" | `space_id` in the chat body is not the caller's space | `POST /api/chat` ownership check |
| Duplicate materials in a space | Should be impossible (composite PK + `ignoreDuplicates`). If seen, the PK is missing | `SELECT` in §9.2 |
| A tab's dropdown is empty but Resources shows materials | Those materials are not `parsed_status = 'completed'` — `StudySpace.tsx` filters to completed only | `StudySpace.tsx` `availableResources` |
| Concept count shows 0 on a completed material | Extraction produced nothing — an upload-pipeline issue, not this feature | `EXTRACTION_IMPLEMENTATION.md` |

### 9.1 What *should* a space contain?

```sql
-- Substitute the space id.
WITH s AS (
  SELECT ss.id, ss.subject, p.grade_level
    FROM study_spaces ss
    JOIN profiles p ON p.id = ss.student_id
   WHERE ss.id = '<SPACE_ID>'
)
SELECT m.id, m.title, m.subject, m.grade_levels, m.is_archived, m.parsed_status,
       (ssm.material_id IS NOT NULL) AS already_linked
  FROM s
  LEFT JOIN materials m
         ON m.subject = s.subject
        AND m.is_archived = false
        AND m.grade_levels @> ARRAY[s.grade_level]::smallint[]
  LEFT JOIN study_space_materials ssm
         ON ssm.space_id = s.id AND ssm.material_id = m.id;
```

Rows with `already_linked = false` are exactly what `available_count` counts.

### 9.2 Check for duplicate links (should always return zero rows)

```sql
SELECT space_id, material_id, count(*)
  FROM study_space_materials
 GROUP BY space_id, material_id
HAVING count(*) > 1;
```

### 9.3 Confirm the migration applied

```sql
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name = 'study_spaces' AND column_name = 'subject';
-- expect: subject | NO
```

### 9.4 Hidden-but-linked materials (the archive case)

```sql
SELECT m.title, m.is_archived, m.grade_levels
  FROM study_space_materials ssm
  JOIN materials m ON m.id = ssm.material_id
 WHERE ssm.space_id = '<SPACE_ID>'
   AND (m.is_archived OR NOT m.grade_levels @> ARRAY[<GRADE>]::smallint[]);
```

These rows exist in the database but are correctly invisible to the student.

---

## 10. Design decisions and why

| Decision | Alternative rejected | Reason |
|---|---|---|
| Space covers **one subject**, fixed at creation | Change subject later | Decks, tests, and mastery are built from the space's materials. Re-pointing strands or destroys that work. A second space is free. |
| **Stored** list in `study_space_materials` | Live query each load | You cannot diff against a set you recompute. The "new materials" notice requires stored state. Also prevents materials silently appearing. |
| Reads filter `linked ∩ published` | Delete link rows when inaccessible | Reversible. Un-archiving restores the material with no student action. Also avoids writing to the database during a GET. |
| `available_count` computed **on load** | Background polling | One query instead of a timer. Matches the stated requirement ("next time I open"). Tradeoff documented in §6.2. |
| **404** for path IDs, **403** for body arrays | 403 everywhere | A 403 on a path ID confirms the material exists. Body arrays contain IDs the client already had, so there is nothing to protect. |
| One shared `materialAccess.ts` | Inline check per route | Six copies of a security rule drift. One file is auditable and testable. |
| Sync derives its set server-side | Client sends material IDs to attach | Nothing for a student to tamper with. The endpoint cannot be made to attach another grade's material. |
| Subject list reused from `mockEducator.ts` | New `GET /api/subjects` endpoint | The constant already backs the educator upload modal. The server re-validates against the real table, so drift is a readable 400, not a crash. Avoided an endpoint nobody asked for. |
| Failed/scanned materials still listed | Filter them out | The student should know the material exists and why it cannot be used, rather than wondering where it went. |

---

## 11. Known issues deliberately NOT fixed

**Check this list before "fixing" anything here — these are known and were left
alone on purpose, either as out of scope or pending the owner's decision.**

### 11.1 `schema.sql` disagrees with the live database

`cognitive_logs.concept_id` is declared `ON DELETE SET NULL` in `schema.sql` but is
`ON DELETE CASCADE` in the live database. `schema.sql` is supposed to be the source
of truth and currently is not. Harmless today (that column is always `NULL` in
practice) but it should be reconciled.

### 11.2 Flashcards are never linked to concepts or materials

`flashcards.concept_id` and `flashcards.source_material_id` exist in the schema, and
`schema.sql` comments describe their purpose, but **no code ever populates them**.
Consequence: flashcards are entirely disconnected from materials.

### 11.3 Only Adaptive Test Mode writes BKT mastery

`bkt_mastery` is written in exactly one place: `server/routes/practice.routes.ts:129`.
`server/routes/flashcards.routes.ts:26` has a comment claiming it triggers a BKT
update, but there is no code behind it.

> ⚠️ **This contradicts the paper.** p. 57: mastery is estimated "based on their
> performance in **Adaptive Flashcards and Adaptive Test Mode**." Combined with
> §11.2, Adaptive Flashcards cannot currently move mastery at all. This is probably
> the highest-value defect in the codebase.

### 11.4 Adaptive Test mastery panel mislabels materials

`src/pages/student/studySpaceTabs/AdaptiveTestTab.tsx:700` groups concept mastery by
cycling through `availableResources` positionally (`idx % availableResources.length`)
instead of looking up which material each concept actually came from. Labels are
wrong whenever there is more than one material, and archiving changes the list length
so the labels shift. Pre-existing; not caused by this work.

### 11.5 Paper promises OCR; the code refuses scanned documents — RESOLVED 2026-09-19

p. 60 states the platform "supports image-based or scanned documents with a maximum
of 20 pages, which are processed using Optical Character Recognition (OCR)."
The upload pipeline used to detect scanned PDFs and mark them `failed` with
"Scanned documents are not supported yet… OCR for image-based PDFs is a later phase."

**Resolved.** Scanned PDFs and photographed pages (up to 20, assembled into one PDF)
are now read with OCR (`server/lib/ocr.ts`, Gemini) and go through the same concept
extraction as text PDFs. `unavailableReason()` consults `is_scanned` only when
processing failed, where the message tells the student the photos could not be read
clearly and to ask their teacher to retake them; a completed scan is simply "Ready".
See the OCR section of `CLAUDE.md`.

### 11.6 Three student routes still take material IDs without a gate

- `POST /api/cognitive/free-recall`
- `POST /api/cognitive/feynman`
- `POST /api/gamification/generate`

Same class of hole as the five that were fixed. Lower risk — they return evaluations
rather than raw content — but a student could still use them to confirm another
grade's material exists. **The guard already exists**; wiring it in is roughly six
lines per route:

```ts
if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;
```

### 11.7 Deck and flashcard sub-routes do not check space ownership

`GET /api/spaces/:id/decks`, `GET /api/spaces/:id/decks/:deckId/flashcards`, and
several others read by `space_id` without confirming the space belongs to the caller.
Same family as the study-space isolation requirement. Out of scope for this work.

### 11.8 `src/data/mockEducator.ts` is misnamed

It holds the real, production subject list that both the educator upload modal and
the student create modal depend on. Nothing about it is mock data.

---

## 12. Verification

### Automated

A 47-check end-to-end script was run against the live server and database and passed
completely. It is **not** committed (it creates and deletes real auth users). To
recreate it, cover:

**Setup:** one educator, one Grade 8 student, one Grade 9 student, and materials —
SCI/[8] (real upload through the pipeline), SCI/[8,9], SCI/[9], MATH/[8],
SCI/[8] archived, SCI/[8] failed+scanned.

**Creation**
- `POST /spaces` without `subject` → 400
- `POST /spaces` with `subject: 'NOPE'` → 400
- `POST /spaces` with a valid subject → 201, and `GET /:id/materials` is already non-empty

**Visibility (Grade 8, SCI space)**
- Contains SCI/[8] and SCI/[8,9]
- Excludes SCI/[9], MATH/[8], and the archived one
- Includes the failed/scanned one, with `parse_error` populated
- `file_size_bytes > 0`; `concept_count > 0`
- A subject with nothing published → empty list, `available_count: 0`, no error

**The notice**
- Baseline `available_count: 0`
- Publish a new SCI/[8] → `available_count: 1`, and it is *not* in `materials`
- `POST …/sync` → it appears, count returns to 0
- `POST …/sync` again → `added_count: 0`, no duplicate rows in the database

**Grade 9 student**
- Gets SCI/[8,9] and SCI/[9]; does **not** get SCI/[8]

**Security**
- Grade 8 token vs the SCI/[9] material ID:
  `/view`, `/concepts`, `/status` → **404**;
  `/concepts/batch`, `/generate-flashcards`, `POST /api/chat` → **403**
- One forbidden ID mixed into an otherwise valid batch → **403**
- Archived material by ID → **404** for the student, **200** for its educator
- Another student's space: `/spaces/:id`, `/spaces/:id/materials`, `…/sync` → **404**
- Another student's `/chat/history/:spaceId` → empty array
- Educator's own library and their own material's concepts → unchanged, 200

**Archive round-trip**
- Archive → disappears from the space; `available_count` stays 0; student 404;
  educator 200; **link row survives**
- Un-archive → reappears automatically

### Manual UI checklist

1. Create a Science space → Resources tab already populated.
2. No upload button, no drag-and-drop, no file picker, no trash icon, no delete dialog.
3. Educator publishes → reopen the space → banner with correct count → press → materials
   appear, banner gone.
4. Refresh → still there.
5. Click a material → PDF renders.
6. Chat answers about a processed material.
7. A failed/scanned material cannot be chatted with and shows its reason.
8. Each material shows a real file size and concept count.

### Commands

```bash
npm run lint      # tsc --noEmit — must be clean
npm run dev       # frontend :3000, backend :5000
```

**Dev accounts** (emails are literally these strings, not addresses):
`educ1` / `educ@12` · `admin` / `admin@12` · `student` (Grade 7)

> The database has only a Grade 7 student. Testing grade isolation requires creating
> Grade 8 and Grade 9 accounts. Remember to delete them afterwards.

---

## 13. What was removed

### CollabShare (peer study-space sharing)

Migration 0003 dropped `is_published`, `share_token`, `cloned_from_id`, and
`original_author_name` from `study_spaces`, with the stated reason:

> "CollabShare (peer-shared / cloned study spaces) appears nowhere in the version-4
> documentation and contradicts the stated guarantee that RLS isolates each student's
> data, so it is removed entirely."

The frontend still carried the whole UI, writing to columns that no longer existed —
so it was already throwing errors on every click. Removed in this work, with the
owner's explicit approval:

- `StudySpacesList.tsx` — clone-from-`?clone=` effect, `MOCK_PUBLIC_SPACES` import,
  clone toast, the four dead fields on `StudySpaceData`
- `StudySpace.tsx` — share modal, QR code, publicize/make-private toggle,
  visibility toast, `spaceIsPublic`, `isCloned`
- `studyspaces.routes.ts` — `generateShareToken()`, the deck/card cloning block,
  `is_published` reads in `GET /:id` and `PUT /:id`
- `api.ts` — `is_published` removed from `UpdateStudySpaceSchema`

> ⚠️ **Do not reintroduce any of this.** It contradicts the paper.
> `src/data/mockPublicSpaces.ts` and `StudySpacePreviewModal.tsx` still exist and are
> now unreferenced from these screens — left alone as out of scope.

### `GET /api/materials/space/:spaceId`

Deleted. A comment at its former location in `materials.routes.ts` points to the
replacement.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Material** | An educator-uploaded PDF. Row in `public.materials`. |
| **Concept** | A term + definition + 3072-d embedding extracted from a material. The exclusive knowledge base for every AI feature. |
| **Study space** | A student-owned workspace for **one subject**, hosting the five study tabs. |
| **Published** | Non-archived, and its `grade_levels` includes the student's grade. Not a database column — a derived condition. |
| **Linked** | A row exists in `study_space_materials` joining the space to the material. |
| **`available_count`** | `|published − linked|`. What the "new materials" notice displays. |
| **Archived** | `materials.is_archived = true`. Hidden from students, still visible to its educator, fully reversible. |
| **Service role** | The Supabase key the Express server uses. **Bypasses RLS**, which is why the API must enforce access itself. |
| **RLS** | Row-Level Security. Protects direct anon-key access from the browser. Does nothing for requests reaching Express. |
| **Grade levels** | `materials.grade_levels SMALLINT[]`, constrained to ⊆ {7,8,9,10}, at least one. |
| **`parsed_status`** | `pending` → `processing` → `completed` \| `failed`. Only `completed` materials have concepts. |
| **Subject code** | Three-to-five letter code from `public.subjects`: FIL, ENG, MATH, SCI, AP, ESP, TLE, MAPEH, CL. |

---

## Related documents

- `EXTRACTION_IMPLEMENTATION.md` — the educator upload → concept extraction pipeline
  that produces everything this feature distributes
- `databaseSchemaExplained.md` — full schema walkthrough
- `chatbotImplementation.md` — the RAG assistant in this tab
- `freeRecallImplementationPlan.md`, `feynmanImplementationPlan.md` — the tabs that
  consume `availableResources` from `StudySpace.tsx`
- `schema.sql` — database source of truth
- `CLAUDE.md` — project-wide conventions
