# PDF Upload & Concept Extraction — Implementation Guide

**Document Version:** 1.0  
**Last Updated:** 2026-07-28  
**Feature Scope:** Educator PDF upload → automatic concept extraction → curated knowledge base

This document provides complete technical and architectural context for the PDF upload and concept extraction pipeline. It is intended for AI agents, developers, and auditors who need to understand, debug, or extend this feature.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [High-Level Data Flow](#high-level-data-flow)
3. [Step-by-Step Execution Flow](#step-by-step-execution-flow)
4. [Technical Architecture](#technical-architecture)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [Key Libraries & Dependencies](#key-libraries--dependencies)
8. [Error Handling & Edge Cases](#error-handling--edge-cases)
9. [Design Decisions & Rationale](#design-decisions--rationale)
10. [Concept Curation (Manual Editing)](#concept-curation-manual-editing)
11. [Testing & Verification](#testing--verification)

---

## Feature Overview

### What It Does

The extraction pipeline enables educators to:
1. Upload a PDF containing instructional material
2. Have the system automatically extract key concepts (terms + definitions) from the text
3. Review and curate those concepts (edit, delete, or add missing ones)
4. Make the concepts available to students via study features (flashcards, adaptive tests, Free Recall, chatbot RAG)

### Why It Matters (From the Paper)

- **Scope & Limitations (pp. 56–61):** "The platform's learning content is built exclusively from educator-uploaded materials. All AI-assisted features (spaced repetition, adaptive assessment, Free Recall, chatbot) operate on a carefully curated, educator-owned knowledge base."
- **Material Ingestion & Distribution (pp. 65–67):** "Materials are uploaded by educators, stored by grade level, and automatically processed to extract a concept-level knowledge representation. Concepts serve as the atomic unit of learning and assessment."

### Key Constraints

- **Plain-text PDFs only** — scanned / image-based PDFs are detected and rejected at upload time
- **20 MB file size limit** — enforced before any processing
- **Grades 7–10 only** — educators select which grades can access each material
- **Educators only** — students cannot upload materials
- **Single ownership** — each material belongs to one educator; RLS enforces this
- **Embedding model fixed** — `gemini-embedding-001` (3072 dimensions) for all concepts; changing this would invalidate all stored vectors

---

## High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ EDUCATOR UPLOADS PDF                                                    │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                    [UploadMaterialModal.tsx]
                    (React form validation)
                           │
                    ✓ File is PDF
                    ✓ Size ≤ 20 MB
                    ✓ Grades selected
                    │
                    └──→ POST /api/materials (FormData)
                         │
                         │ [Express backend: materials.routes.ts]
                         │ ├─ Zod validation (title, subject, grades)
                         │ ├─ Subject exists? (query DB)
                         │ ├─ Save file to Supabase Storage
                         │ ├─ Extract PDF text (pdfText.ts)
                         │ ├─ Detect scanned? (text-layer density check)
                         │ └─ Insert material row
                         │
                    ┌────┴────┐
           SCANNED? │         │ TEXT?
                    ▼         ▼
             ✗ Failed     ✓ Pending
             + Error        │
             + is_scanned    └──→ processMaterialAsync()
                                  │
                                  ├─ Set status = "processing"
                                  ├─ Split document into windows (8k chars / 6 pages)
                                  ├─ For each window:
                                  │  ├─ Call Gemini (temp=0)
                                  │  └─ Extract {term, definition, page}[]
                                  ├─ Embed each concept
                                  ├─ Deduplicate by meaning (cosine similarity)
                                  ├─ Batch insert concepts with source_pages
                                  └─ Set status = "completed" (or "failed" on error)
                                     │
                                     └──→ [MaterialsLibrary.tsx polls every 3s]
                                          Status updates appear in real-time
```

---

## Step-by-Step Execution Flow

### Phase 1: Upload (UI → Backend)

**File:** [src/pages/educator/components/UploadMaterialModal.tsx](src/pages/educator/components/UploadMaterialModal.tsx)

1. **Educator fills form:**
   - Selects PDF file
   - Enters title, optional description
   - Selects subject (dropdown, validated against `subjects` table)
   - Ticks grade levels (checkboxes, 1–4 grades from 7–10)

2. **Client-side validation (React):**
   - File must be a PDF (MIME type `application/pdf`)
   - File must be ≤ 20 MB
   - Title must be non-empty
   - Subject must be non-empty
   - At least 1 grade selected

3. **Form submission:**
   ```javascript
   const formData = new FormData();
   formData.append('file', file);
   formData.append('title', title.trim());
   formData.append('subject', subject.trim());
   formData.append('description', description.trim() || '');
   formData.append('grade_levels', JSON.stringify(gradeValues));
   
   await api.post('/materials', formData);
   // Returns: { data: { id, title, subject, grade_levels, parsed_status: 'pending', ... } }
   ```

4. **Calls:** `POST /api/materials` (FormData, educator token required)

---

### Phase 2: Server-Side Intake ([server/routes/materials.routes.ts](server/routes/materials.routes.ts))

**Handler:** `router.post('/', requireRole('educator'), multer.single('file'), ...)`

1. **Authentication & Authorization:**
   - `authenticate` middleware (JWT token) → sets `req.user` to authenticated user
   - `requireRole('educator')` → returns 403 if not an educator or account is disabled
   - Fetches `profiles` table to verify `role = 'educator'` AND `status = 'active'`

2. **Zod Validation ([server/types/api.ts](server/types/api.ts)):**
   ```typescript
   CreateMaterialSchema.safeParse(req.body)
   ```
   - Validates: `title`, `subject`, `description` (optional), `grade_levels`
   - `grade_levels` arrives as a JSON string (multipart FormData), so it's preprocessed: `JSON.parse(value)`
   - Grade array must have ≥1 and ≤4 elements, all in range [7, 10]
   - **Returns 400 if validation fails** (early exit, no file written)

3. **Subject Validation:**
   ```typescript
   const { data: subjectExists } = await supabaseAdmin
     .from('subjects')
     .select('id')
     .eq('code', subject)
     .maybeSingle();
   if (!subjectExists) return res.status(400).json({ error: 'Unknown subject' });
   ```
   - Looks up the subject in the `subjects` table
   - **Returns 400 if unknown** (before any file operations)

4. **File Type & Size Check:**
   ```typescript
   if (!req.file || req.file.mimetype !== 'application/pdf') {
     return res.status(400).json({ error: 'Only PDF files are allowed' });
   }
   if (req.file.size > 20 * 1024 * 1024) {
     return res.status(400).json({ error: 'File exceeds 20 MB limit' });
   }
   ```

5. **PDF Text Extraction (Scan Detection):**
   ```typescript
   const pages = await extractPdfPages(req.file.buffer);
   // Returns: { pageCount: number, pages: PdfPage[], isScanned: boolean }
   ```
   - **File:** [server/lib/pdfText.ts](server/lib/pdfText.ts)
   - Reads the PDF using `pdfjs-dist` (legacy Node.js build)
   - For each page, counts text items (MIN_TEXT_ITEM_PER_PAGE = 5)
   - If `totalTextItems < 5 * pageCount`, marks `isScanned = true`
   - **Rationale:** Scanned PDFs have no text layer; a proper text PDF has ≥5 text items per page on average
   - Returns `pages` array with page-by-page text (line breaks detected via Y-position tolerance)

6. **Material Row Insertion:**
   ```typescript
   const { data: material } = await supabaseAdmin
     .from('materials')
     .insert({
       educator_id: req.user.id,
       title,
       subject,
       description,
       grade_levels,
       file_size_bytes: req.file.size,
       page_count: pages.pageCount,
       is_scanned: isScanned,
       parsed_status: isScanned ? 'failed' : 'pending',
       parse_error: isScanned ? 'Scanned documents are not supported yet.' : null,
       is_archived: false,
     })
     .select()
     .single();
   ```
   - Sets `parsed_status` to `'failed'` if scanned, else `'pending'`
   - If scanned, sets `parse_error` message
   - **Returns 201** with the new material row

7. **File Upload to Storage:**
   ```typescript
   const bucket = supabaseAdmin.storage.from('materials');
   await bucket.upload(`${material.id}.pdf`, req.file.buffer, {
     contentType: 'application/pdf',
   });
   ```
   - Only happens if `!isScanned`
   - File stored at: `gs://your-bucket/materials/{material_id}.pdf`

8. **Async Processing Trigger:**
   ```typescript
   if (!isScanned) {
     processMaterialAsync(material.id, pages).catch((e) => console.error(e));
   }
   ```
   - Fire-and-forget async task
   - Does **NOT** await (endpoint returns 201 immediately)
   - Frontend polls for status updates every 3 seconds

---

### Phase 3: Async Concept Extraction ([server/routes/materials.routes.ts](server/routes/materials.routes.ts))

**Function:** `async function processMaterialAsync(materialId, pages)`

#### 3.1 Status Update → "processing"

```typescript
await supabaseAdmin
  .from('materials')
  .update({ parsed_status: 'processing' })
  .eq('id', materialId);
```

#### 3.2 Document Windowing & Extraction

**File:** [server/lib/conceptExtraction.ts](server/lib/conceptExtraction.ts)

**Why windowing?** 
- Gemini has a token budget (~30k tokens for the `/embed` and text generation)
- Processing the entire document at once risks hitting token limits or losing tail-end concepts
- Windowing ensures **full-document coverage** and consistent, reproducible results

**Window Size Strategy:**
```typescript
const MAX_WINDOW_CHARS = 8000;    // ~2k tokens
const MAX_WINDOW_PAGES = 6;       // Safety limit on page clustering
```

**Algorithm:**
```
1. Collect consecutive pages until:
   - Combined character count ≥ MAX_WINDOW_CHARS, OR
   - Reached MAX_WINDOW_PAGES, OR
   - Reached end of document
2. Extract concepts from that window (Gemini, temp=0)
3. Repeat until all pages processed
```

**Rationale for temp=0:**
- Ensures reproducibility — same PDF → same concepts
- Prevents hallucination or creative rewording on repeated runs
- Gemini still varies slightly, but within acceptable bounds

#### 3.3 Gemini Concept Extraction (Per Window)

**Function:** `extractConcepts(pages: PdfPage[])`

For each window, call Gemini with a prompt like:
```
Extract all key concepts from this educational material. 
For each concept, provide:
- term: A 1–3 word name (e.g., "Photosynthesis")
- definition: A 12+ character, self-contained explanation
- page: The page number where this concept appears (1-indexed)

Return a JSON array: [{ term, definition, page }, ...]
```

**Gemini Response Format:**
```json
[
  { "term": "Photosynthesis", "definition": "The process by which green plants convert sunlight, water, and carbon dioxide into glucose and oxygen.", "page": 1 },
  { "term": "Chlorophyll", "definition": "The green pigment found in chloroplasts that absorbs light energy for photosynthesis.", "page": 1 },
  ...
]
```

**Validation (on raw Gemini response):**
```typescript
// Each extracted concept must:
if (!term || !definition) throw new Error('Missing term or definition');
if (definition.length < 12) throw new Error('Definition too short');
if (term.toLowerCase() === definition.toLowerCase()) throw new Error('Term = definition (no-op)');
if (page < 1 || page > pages.length) throw new Error(`Page ${page} out of range`);
```

#### 3.4 Embedding

**Function:** `generateEmbedding(definition: string): Promise<number[]>`  
**File:** [server/lib/gemini.ts](server/lib/gemini.ts)

```typescript
const embedding = await generateEmbedding(definition);
// Returns: number[] of length 3072 (gemini-embedding-001 dimensions)
```

**Critical Note:** The embedding model **must always be `gemini-embedding-001`**. Changing it would invalidate all stored concept vectors and break similarity search downstream (Free Recall, chatbot RAG, etc.).

#### 3.5 Deduplication (Embedding-Based)

**Purpose:** Remove or merge concepts that the extractor produces in duplicate or near-duplicate forms.

**Algorithm:**
```typescript
for (const candidate of extracted) {
  let merged = false;

  for (const existing of deduplicated) {
    const similarity = cosineSimilarity(candidate.embedding, existing.embedding);

    // Case 1: Same term + high similarity (≥0.90)
    if (candidate.term.toLowerCase() === existing.term.toLowerCase() && similarity >= 0.90) {
      // Merge: union source_pages, keep one row
      existing.source_pages = [...new Set([...existing.source_pages, ...candidate.source_pages])].sort((a, b) => a - b);
      merged = true;
      break;
    }

    // Case 2: Same term + low similarity (<0.90)
    // → Keep as separate rows (different meanings of the same word)
    if (candidate.term.toLowerCase() === existing.term.toLowerCase() && similarity < 0.90) {
      // Do nothing; let candidate be added as-is
      continue;
    }

    // Case 3: Different terms + high similarity (≥0.93)
    // → Drop candidate as a reworded duplicate
    if (similarity >= 0.93) {
      merged = true; // Mark as subsumed, don't add
      break;
    }
  }

  if (!merged) {
    deduplicated.push(candidate);
  }
}
```

**Thresholds (tuned for 3072-dimensional space):**
- **0.90** for same-term merging: Catches high-confidence rewording
- **0.93** for cross-term deduplication: Avoids losing genuinely different terms

**Why these thresholds?**
- In 3072-dimensional space, even unrelated vectors score ~0.60–0.65 (hubness problem)
- 0.93 means truly near-identical semantic content
- This avoids over-aggressive deduplication while still catching duplicates

#### 3.6 Batch Insert Concepts

```typescript
const chunks = [];
for (let i = 0; i < allConcepts.length; i += 25) {
  chunks.push(allConcepts.slice(i, i + 25));
}

for (const chunk of chunks) {
  const { error } = await supabaseAdmin
    .from('concepts')
    .insert(chunk.map((c) => ({
      material_id: materialId,
      term: c.term,
      definition: c.definition,
      embedding: `[${c.embedding.join(',')}]`, // Stored as JSON string
      source_pages: c.source_pages,
      parent_concept_id: null,
      created_at: new Date().toISOString(),
    })));

  if (error) throw error;
}
```

**Batching:** Inserts are chunked into groups of 25 to avoid overwhelming the database.

**Embedding storage:** The vector is stringified (`"[-0.013, 0.024, ...]"`) because Supabase's pgvector type is returned as a string to the JS client.

#### 3.7 Status Update → "completed" (or "failed")

```typescript
try {
  // ... extraction logic ...
  await supabaseAdmin
    .from('materials')
    .update({
      parsed_status: 'completed',
      parse_error: null,
    })
    .eq('id', materialId);
} catch (err) {
  const errorMsg = (err.message || String(err)).slice(0, 500); // Truncate for DB storage
  await supabaseAdmin
    .from('materials')
    .update({
      parsed_status: 'failed',
      parse_error: errorMsg,
    })
    .eq('id', materialId);
  throw err;
}
```

---

## Technical Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend UI** | React 19 + TypeScript | Educator upload form, polling, concept curation UI |
| **HTTP Client** | Axios (`src/lib/api.ts`) | All API calls (never raw `fetch`) |
| **Backend Framework** | Express.js + TypeScript | REST API server |
| **File Upload** | Multer | Single PDF file handling |
| **PDF Processing** | `pdfjs-dist` (legacy Node build) | Extract text & detect scanned |
| **Database** | Supabase PostgreSQL + pgvector | Store materials, concepts, embeddings |
| **Storage** | Supabase Storage (Google Cloud) | Store PDF files |
| **AI Services** | Google Generative AI (Gemini) | Text extraction, embeddings |
| **Validation** | Zod | Request body validation |

### Key Files & Their Responsibilities

#### Frontend

| File | Responsibility |
|------|-----------------|
| [UploadMaterialModal.tsx](src/pages/educator/components/UploadMaterialModal.tsx) | PDF selection, form validation, upload submission |
| [MaterialsLibrary.tsx](src/pages/educator/MaterialsLibrary.tsx) | List materials, polling for status, delete, filter by subject/grade/status |
| [MaterialDetail.tsx](src/pages/educator/MaterialDetail.tsx) | Display material, extracted concepts, manual concept curation (add/edit/delete), View PDF button |

#### Backend

| File | Responsibility |
|------|-----------------|
| [materials.routes.ts](server/routes/materials.routes.ts) | Main upload handler, async extraction trigger, concept CRUD endpoints |
| [pdfText.ts](server/lib/pdfText.ts) | PDF text extraction via pdfjs-dist, scanned detection |
| [conceptExtraction.ts](server/lib/conceptExtraction.ts) | Windowed extraction, Gemini prompting, embedding, deduplication |
| [gemini.ts](server/lib/gemini.ts) | Gemini API wrappers (`generateEmbedding`, `generateText`) |
| [api.ts](server/types/api.ts) | Zod validation schemas for all request bodies |
| [database.ts](server/types/database.ts) | TypeScript types mirroring DB table shapes |
| [requireRole.ts](server/middleware/requireRole.ts) | Role-based access control (educator-only check) |

#### Database

| File | Responsibility |
|------|-----------------|
| [schema.sql](schema.sql) | All table definitions (source of truth) |

---

## Database Schema

### Materials Table

```sql
CREATE TABLE public.materials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  educator_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  subject            TEXT NOT NULL,
  description        TEXT,
  grade_levels       SMALLINT[] NOT NULL,  -- {7,8,9,10} subset
  file_size_bytes    INTEGER,
  page_count         SMALLINT,
  is_scanned         BOOLEAN DEFAULT FALSE,
  parsed_status      TEXT CHECK (parsed_status IN ('pending', 'processing', 'completed', 'failed')),
  parse_error        TEXT,
  is_archived        BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_grades CHECK (grade_levels <@ ARRAY[7,8,9,10]::SMALLINT[]),
  CONSTRAINT at_least_one_grade CHECK (array_length(grade_levels, 1) >= 1),
);

CREATE INDEX idx_materials_educator_id ON materials(educator_id);
CREATE INDEX idx_materials_subject ON materials(subject);
CREATE INDEX idx_materials_parsed_status ON materials(parsed_status);
```

**Key Fields:**
- `educator_id` — Enforces single ownership (RLS filters by this)
- `grade_levels` — Array of grades [7–10] that can access this material
- `is_scanned` — TRUE if scanned/image-based (no text layer)
- `parsed_status` — Lifecycle: pending → processing → completed/failed
- `parse_error` — Human-readable error message (max 500 chars) if extraction failed

### Concepts Table

```sql
CREATE TABLE public.concepts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id          UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  term                 TEXT NOT NULL,
  definition           TEXT NOT NULL,
  embedding            VECTOR(3072) NOT NULL,  -- gemini-embedding-001
  parent_concept_id    UUID REFERENCES concepts(id),
  source_pages         SMALLINT[] NOT NULL,    -- [1, 2, 5] = pages 1, 2, 5
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_definition_length CHECK (char_length(definition) >= 12),
  CONSTRAINT term_not_empty CHECK (char_length(term) >= 1),
);

CREATE INDEX idx_concepts_material_id ON concepts(material_id);
CREATE INDEX idx_concepts_embedding ON concepts USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Key Fields:**
- `embedding` — 3072-dimensional vector from gemini-embedding-001 (stored as `VECTOR(3072)`)
- `source_pages` — SMALLINT array indicating which pages this concept came from (e.g., `{1,2,3}`)
- Parent-child relationship support (for hierarchical concepts, currently unused)

**Important:** Supabase returns the `embedding` column as a **string** (e.g., `"[-0.013, 0.024, ...]"`), NOT as a JavaScript array. Any code using embeddings must parse this string first.

### Row-Level Security (RLS)

**Materials:**
```sql
-- Educators see only their own materials
CREATE POLICY "educators_own_materials"
  ON materials
  FOR SELECT
  USING (educator_id = auth.uid());

-- Educators can upload materials
CREATE POLICY "educators_can_upload"
  ON materials
  FOR INSERT
  WITH CHECK (educator_id = auth.uid() AND auth.role() = 'authenticated');

-- Educators can update/delete only their own
CREATE POLICY "educators_update_own"
  ON materials
  FOR UPDATE
  USING (educator_id = auth.uid());

CREATE POLICY "educators_delete_own"
  ON materials
  FOR DELETE
  USING (educator_id = auth.uid());
```

**Concepts:**
```sql
-- Anyone can select concepts (via JOIN through materials)
CREATE POLICY "concepts_visible_if_material_accessible"
  ON concepts
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM materials m WHERE m.id = concepts.material_id AND can_access_material(m)));
```

---

## API Endpoints

### Upload Material

**Endpoint:** `POST /api/materials`  
**Auth:** `requireRole('educator')`  
**Content-Type:** `multipart/form-data`

**Request Body:**
```
file: <binary PDF>
title: "Cell Structure and Function"
subject: "SCI"
description: "An introductory module on plant and animal cells"
grade_levels: "[7,8]"   (JSON string)
```

**Response (201):**
```json
{
  "data": {
    "id": "5d024075-fcfd-414d-ac14-d4061c8a973f",
    "educator_id": "1e20c99b-96fa-4581-930f-19f30bb49ae3",
    "title": "Cell Structure and Function",
    "subject": "SCI",
    "grade_levels": [7, 8],
    "file_size_bytes": 3400000,
    "page_count": 24,
    "is_scanned": false,
    "parsed_status": "pending",
    "parse_error": null,
    "created_at": "2026-07-28T05:30:12.123456+00:00"
  }
}
```

**Error Responses:**
- `400` — validation error (title/subject/grades missing), unknown subject, non-PDF, oversize, or scanned
- `401` — no token
- `403` — not an educator or account disabled

---

### Get Material

**Endpoint:** `GET /api/materials/:id`  
**Auth:** `requireRole('educator')`

**Response (200):**
```json
{
  "data": {
    "id": "5d024075-fcfd-414d-ac14-d4061c8a973f",
    ...full material row...,
    "concept_count": 24
  }
}
```

**Error Responses:**
- `404` — material not found or not owned by educator
- `403` — not an educator

---

### List Materials

**Endpoint:** `GET /api/materials`  
**Auth:** `requireRole('educator')`

**Response (200):**
```json
{
  "data": [
    { id, title, subject, grade_levels, parsed_status, page_count, concept_count, created_at, ... },
    ...
  ]
}
```

Returns only materials owned by the authenticated educator, with concept counts.

---

### Get Concepts

**Endpoint:** `GET /api/materials/:id/concepts`  
**Auth:** `requireRole('educator')`

**Response (200):**
```json
{
  "data": [
    {
      "id": "abc-123",
      "term": "Photosynthesis",
      "definition": "The process by which green plants...",
      "source_pages": [1, 2],
      "created_at": "2026-07-28T..."
    },
    ...
  ]
}
```

---

### Add Concept (Manual Curation)

**Endpoint:** `POST /api/materials/:id/concepts`  
**Auth:** `requireRole('educator')`  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "term": "Cell Wall",
  "definition": "A rigid outer layer found in plant cells that gives the cell shape and support.",
  "source_pages": [1]
}
```

**Response (201):**
```json
{
  "data": {
    "id": "xyz-789",
    "term": "Cell Wall",
    "definition": "A rigid outer layer...",
    "source_pages": [1],
    "created_at": "2026-07-28T..."
  }
}
```

**Flow:**
1. Validate input (term & definition required, ≥1 char each)
2. Check educator owns the material
3. Embed the definition via Gemini
4. Insert into concepts table with the 3072-d embedding
5. Return the new row

**Error Responses:**
- `400` — validation error (empty term/definition)
- `404` — material not found
- `502` — embedding API failed

---

### Edit Concept (Manual Curation)

**Endpoint:** `PUT /api/materials/:materialId/concepts/:conceptId`  
**Auth:** `requireRole('educator')`  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "term": "Cell Wall (plant)",
  "definition": "The tough outer boundary of a plant cell, made mostly of cellulose..."
}
```

**Flow:**
1. Validate input (at least one field must be provided)
2. Check educator owns the material
3. **If definition changed:** Re-embed via Gemini (critical for downstream features)
4. Update the concept row
5. Return updated row

**Error Responses:**
- `400` — validation error
- `404` — concept or material not found
- `502` — embedding API failed

---

### Delete Concept (Manual Curation)

**Endpoint:** `DELETE /api/materials/:materialId/concepts/:conceptId`  
**Auth:** `requireRole('educator')`

**Response (200):**
```json
{ "message": "Concept deleted" }
```

**Flow:**
1. Check educator owns the material
2. Delete the concept row
3. Concept_count on the material is **NOT** updated (frontend handles this optimistically)

---

### Get Material Status (Polling)

**Endpoint:** `GET /api/materials/:id/status`  
**Auth:** `requireRole('educator')`

**Response (200):**
```json
{
  "data": {
    "parsed_status": "completed",
    "parse_error": null
  }
}
```

Used by [MaterialsLibrary.tsx](src/pages/educator/MaterialsLibrary.tsx) to poll every 3 seconds until extraction is done.

---

### Get PDF Signed URL (for new tab viewer)

**Endpoint:** `GET /api/materials/:id/view`  
**Auth:** `requireRole('educator')` (or student, depending on grade access)

**Response (200):**
```json
{
  "data": {
    "url": "https://storage.googleapis.com/...?X-Goog-Signature=...&X-Goog-Expires=3600"
  }
}
```

Returns a signed URL (1-hour expiry) to access the PDF in Supabase Storage. Opens in a new tab via the "View PDF" button.

---

## Key Libraries & Dependencies

### Backend

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.x | HTTP server framework |
| `typescript` | ^5.x | Type safety |
| `multer` | ^1.x | File upload handling |
| `zod` | ^3.x | Request validation |
| `pdfjs-dist` | ^4.x | PDF text extraction (legacy Node.js build) |
| `@google/generative-ai` | ^0.11.x | Gemini API client |
| `@supabase/supabase-js` | ^2.x | Database + storage client |

### Frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.x | UI framework |
| `react-router-dom` | ^7.x | Client routing |
| `axios` | ^1.x | HTTP client |
| `tailwindcss` | ^4.x | Styling |
| `lucide-react` | ^latest | Icons |

### Critical: pdfjs-dist Setup

The project uses the **legacy Node.js build** of `pdfjs-dist`:
```typescript
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
```

This is necessary because:
1. The standard browser build doesn't work in Node.js
2. The `legacy` build is deprecated but stable for text extraction
3. Avoids complex worker setup in a backend environment

---

## Error Handling & Edge Cases

### Scanned PDFs

**Detection:**
```typescript
const MIN_TEXT_ITEM_PER_PAGE = 5;
const isScanned = totalTextItems / pageCount < MIN_TEXT_ITEM_PER_PAGE;
```

**Handling:**
- Mark material `is_scanned = true`
- Set `parsed_status = 'failed'`
- Set `parse_error = 'Scanned documents are not supported yet.'`
- Do NOT upload file to storage
- Do NOT attempt extraction

**Why?** Scanned PDFs have no text layer; Gemini cannot extract concepts from the images. OCR is deferred as a future phase.

### Empty PDFs

If a PDF has zero pages:
- `pageCount = 0`
- Extraction returns empty concept array
- Material is marked `completed` with `concept_count = 0`
- Educator can manually add concepts

### Gemini API Failures

If `generateEmbedding()` fails:
```typescript
catch (err) {
  await supabaseAdmin
    .from('materials')
    .update({
      parsed_status: 'failed',
      parse_error: `Embedding failed: ${err.message.slice(0, 500)}`
    })
    .eq('id', materialId);
}
```

- Material marked `failed` with error message
- Educator can retry by re-uploading

### Large Documents

A 100-page document with 8k-char windows:
- ~12–15 windows (depending on page lengths)
- Each window calls Gemini once (temp=0)
- Concepts extracted independently per window, then deduplicated
- Total processing time: 2–5 minutes (mostly Gemini latency)

### Duplicate Concepts

**Same term, different meanings:**
```
"Bank" → financial institution
"Bank" → river bank
```
These are **kept as separate rows** if cosine similarity < 0.90.

**Different terms, identical meaning:**
```
"Photosynthesis" (term 1)
"The process by which plants convert sunlight..." (definition 1)

"Photosynthetic Process" (term 2)
"The mechanism of converting solar radiation..." (definition 2)
```
Similarity ≥0.93 → **Candidate is dropped** as a reworded duplicate.

---

## Design Decisions & Rationale

### Why Async Processing?

The upload endpoint returns immediately (`201 pending`), while extraction happens in the background. 

**Rationale:**
- Concept extraction can take 2–5 minutes for large documents
- Blocking the request would timeout
- Frontend polls every 3 seconds to show real-time progress
- Better UX: educator gets feedback instantly, not a spinning loader

**Alternative considered:** Webhooks. But webhooks add operational complexity (must be reliably delivered, idempotent, etc.). Polling is simpler and works well for a small number of concurrent uploads.

### Why Windowing with Temperature 0?

**Windowing:**
- Ensures full-document coverage (extraction doesn't miss tail-end concepts)
- Keeps token budgets reasonable (~2k tokens per window)
- Reproducible: same PDF → same window splits → same concepts

**Temperature 0:**
- Gemini's default behavior includes some randomness (temp ~0.7)
- Setting temp=0 locks output to the most deterministic response
- Same PDF uploaded twice should produce identical concept lists (for auditing/debugging)

### Why Embedding-Based Deduplication?

**Alternatives considered:**
1. **Exact string match** — misses near-duplicates, prone to typos
2. **Levenshtein distance** — good for typos, but misses semantic duplicates ("photosynthesis" vs "photosynthetic process")
3. **Cosine similarity** (chosen) — captures semantic meaning, robust to paraphrasing

**Rationale:**
- Educators curate concepts for learning; semantic duplicates are harmful (waste time, dilute spaced rep)
- Cosine similarity on 3072-d embeddings is a proven, reliable deduplication signal

### Why Fixed Embedding Model?

Once you embed a concept with `gemini-embedding-001`, **all downstream features depend on that model:**
- Free Recall evaluates student responses by comparing cosine similarity to stored embeddings
- The chatbot (RAG) ranks relevant concepts via cosine similarity
- Flashcard / test generation uses similarity to select related concepts

**Switching models** would invalidate all stored vectors. A migration would be massive (re-embed all ~1M concepts in production). Hence, the model is locked in code with a clear comment.

### Why Source Pages?

**Purpose:**
- Educator traceability: "This concept came from page 3"
- Proof-of-work: Gemini didn't hallucinate, it extracted real content
- Future feature: ability to highlight or zoom to the source in the viewer

**Storage:** `SMALLINT[]` — compact, efficient, and easy to range-check.

### Why Manual Concept Curation?

The extractor is powerful but imperfect:
- May miss niche or subtle concepts
- May over-segment or under-segment
- May extract fragments instead of complete thoughts

**Allowing educators to edit/add/delete concepts ensures:**
- Concepts reflect what the educator actually teaches
- Quality control before students see them
- Personalization (different educators, different priorities)

---

## Concept Curation (Manual Editing)

### UI Overview

**File:** [MaterialDetail.tsx](src/pages/educator/MaterialDetail.tsx)

#### Concepts Tab

- **Read mode:** List of extracted concepts with term, page badge, definition
- **Edit mode:** Inline form to modify term/definition/source_pages
- **Delete mode:** Two-step inline confirm
- **Add mode:** Inline form at top of list

#### State Machine

```
List view
    ↓ (click Edit)
Edit mode [editingId != null]
    ├─ Save → PUT endpoint → List view
    └─ Cancel → List view

List view
    ↓ (click Delete)
Delete confirm [deletingId != null]
    ├─ Confirm delete → DELETE endpoint → List view
    └─ Cancel → List view

List view
    ↓ (click Add concept)
Add mode [addingNew = true]
    ├─ Save → POST endpoint → List view
    └─ Cancel → List view
```

#### Busy State Management

```typescript
// Pause the auto-polling while an edit is in progress
const busyRef = useRef(false);
busyRef.current = addingNew || editingId !== null || saving;

// In the poll effect:
if (inFlight) {
  setInterval(() => {
    if (!busyRef.current) void load();  // Skip if editing
  }, 3000);
}
```

This prevents a background refresh from interrupting an in-progress form submission.

#### Optimistic Updates

When the user adds/edits/deletes a concept:
```typescript
// Immediately update the local list
setConcepts((prev) => [...prev, newConcept]);
bumpCount(1);

// Then call the API
const { data } = await api.post(...);

// If API fails, the error message appears
// (In a real app, we'd revert the optimistic update)
```

**Rationale:** Better perceived performance; the list updates instantly, not after a network round trip.

### API Contract

**POST /api/materials/:id/concepts**

```json
Request:
{
  "term": "Mitochondria",
  "definition": "The organelle responsible for producing energy in the cell.",
  "source_pages": [2, 3]
}

Response (201):
{
  "data": {
    "id": "uuid",
    "term": "Mitochondria",
    "definition": "The organelle responsible for producing energy in the cell.",
    "source_pages": [2, 3],
    "created_at": "2026-07-28T..."
  }
}
```

**Server logic:**
1. Validate input (Zod)
2. Check educator owns material
3. Generate embedding for definition (Gemini)
4. Insert with embedding
5. Return row

**Critical:** The embedding is generated server-side. Without it, the concept is invisible to:
- Free Recall similarity search
- Chatbot RAG ranking
- Flashcard generation (if it uses concept embeddings)

---

## Testing & Verification

### Manual Testing Checklist

#### Upload Path
- [ ] Upload a 2-page text PDF (no errors)
- [ ] Verify material is created with `parsed_status = 'pending'`
- [ ] Verify file is uploaded to Supabase Storage
- [ ] Wait 2–3 minutes; verify status → `'processing'` → `'completed'`
- [ ] Verify concepts extracted (≥1)
- [ ] Verify all concepts have `source_pages` populated
- [ ] Verify `page_count` and `file_size_bytes` are correct

#### Scanned PDF Detection
- [ ] Upload a scanned/image PDF
- [ ] Verify `is_scanned = true`, `parsed_status = 'failed'`
- [ ] Verify `parse_error` contains "not supported"
- [ ] Verify file is NOT uploaded to Storage
- [ ] Verify no concepts are extracted

#### Auth & Authorization
- [ ] Upload without token → `401`
- [ ] Upload with student token → `403`
- [ ] Upload with educator token → `201`

#### Validation
- [ ] Upload without file → `400`
- [ ] Upload non-PDF → `400`
- [ ] Upload file >20 MB → `400`
- [ ] Upload with no grades → `400`
- [ ] Upload with unknown subject → `400` (before file ops)

#### Concept CRUD
- [ ] Add concept → appears in list + 3072-d embedding
- [ ] Edit term only → 200, no re-embedding
- [ ] Edit definition only → 200, re-embedding
- [ ] Edit term + definition → 200, re-embedding
- [ ] Delete concept → 200, gone from list
- [ ] Add concept with invalid data → `400`
- [ ] Edit non-existent concept → `404`
- [ ] Delete as non-educator → `403`

### Automated Testing (E2E Script)

**File:** `e2e-concepts.mjs` (provided)

Covers:
- Material extraction (text PDF)
- Concept add/edit/delete
- Embedding validation (3072-d)
- Authorization checks
- Database cleanup

Run:
```bash
node e2e-concepts.mjs
```

Expected output:
```
==== 13 passed, 0 failed ====
```

### Debugging Tips

#### "Parsing failed" / Status stuck in "processing"

1. Check server logs:
   ```bash
   # If running locally:
   npm run dev:server
   # Look for errors in the processMaterialAsync task
   ```

2. Check Supabase logs:
   ```bash
   supabase logs --project-ref <ref>
   ```

3. Manually check material row:
   ```sql
   SELECT id, parsed_status, parse_error, is_scanned 
   FROM materials 
   WHERE id = '...'
   LIMIT 1;
   ```

#### Concepts not appearing in downstream features

1. **Verify embedding was created:**
   ```sql
   SELECT id, term, array_length(embedding::text::float8[], 1) as embedding_dims
   FROM concepts
   WHERE material_id = '...'
   LIMIT 1;
   ```
   Should return `3072` for dims.

2. **Verify embedding is a number array (not NULL):**
   ```sql
   SELECT id, embedding IS NOT NULL as has_embedding
   FROM concepts
   WHERE material_id = '...'
   LIMIT 5;
   ```

3. **Test cosine similarity:**
   ```sql
   SELECT 
     c1.term, c2.term,
     (c1.embedding <=> c2.embedding) as cosine_distance
   FROM concepts c1
   JOIN concepts c2 ON c1.material_id = c2.material_id AND c1.id < c2.id
   WHERE c1.material_id = '...'
   ORDER BY cosine_distance ASC
   LIMIT 5;
   ```

#### Deduplication overly aggressive / not aggressive enough

Edit thresholds in [conceptExtraction.ts](server/lib/conceptExtraction.ts):
```typescript
// Line ~170
const MERGE_THRESHOLD = 0.90;        // Same-term merge
const DUPLICATE_THRESHOLD = 0.93;    // Cross-term drop
```

Lower values → more aggressive deduplication. Higher values → keep more distinct rows.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Concept** | A term (e.g., "Photosynthesis") + definition (e.g., "The process by which plants...") + embedding vector. The atomic unit of the knowledge base. |
| **Embedding** | A 3072-dimensional vector representation of a text (definition). Used for semantic similarity search. |
| **Cosine Similarity** | A distance metric between two embedding vectors (range 0–1, where 1 = identical). |
| **Deduplication** | Removing or merging duplicate/near-duplicate concepts extracted by Gemini. |
| **Windowing** | Splitting a multi-page PDF into chunks (~8k chars / 6 pages) and extracting concepts per chunk. Ensures full-document coverage. |
| **pgvector** | PostgreSQL extension for vector storage and similarity search. The `embedding` column is of type `VECTOR(3072)`. |
| **RLS (Row-Level Security)** | Database policy that filters rows based on the authenticated user. Enforces educator → owns only their own materials. |
| **Signed URL** | A time-limited URL (e.g., 1-hour expiry) to access a private file in Supabase Storage without explicit authentication. |
| **Scanned PDF** | A PDF created from images (e.g., photocopied pages) with no extractable text layer. Rejected at upload time. |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-07-28 | Initial comprehensive guide. Covers upload, extraction, deduplication, CRUD, architecture, and debugging. |

---

## Related Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — High-level system design and feature logic
- [schema.sql](schema.sql) — Database schema (source of truth)
- [CLAUDE.md](CLAUDE.md) — Project overview and tech stack

---

## Contact & Support

For questions or issues related to the extraction pipeline:
1. Check the **Debugging Tips** section above
2. Review the **Error Handling & Edge Cases** section
3. Consult the **API Endpoints** section for request/response contracts
4. Check server logs and Supabase logs for detailed errors
