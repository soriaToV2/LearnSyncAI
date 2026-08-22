# PDF Upload & Concept Extraction — Implementation Guide

**Document Version:** 1.3  
**Last Updated:** 2026-08-01  
**Feature Scope:** Educator PDF upload → automatic concept extraction → curated knowledge base  
**Extraction model:** `gemini-3.6-flash` (migrated from `gemini-2.5-flash`, which already returns 404 — see `GEMINI_MIGRATION_STATUS.md`)

This document provides complete technical and architectural context for the PDF upload and concept extraction pipeline. It is intended for AI agents, developers, and auditors who need to understand, debug, or extend this feature.

---

## Read This First (if you are about to change extraction)

Five constraints that are **not** obvious from the code, each of which has already caused a bug here:

1. **Never change the embedding model.** `gemini-embedding-001`, 3072-d, fixed. Every stored `concepts.embedding` depends on it, and so do Free Recall scoring, chatbot RAG and cross-term dedup. Supported to 2028-05-14, so there is no deadline forcing your hand.
2. **Never send `temperature` to a `gemini-3*` model.** Gemini 3 dropped the sampling parameters; they are ignored now and return HTTP 400 in a future model generation. `generateJson()` strips it and warns — treat that warning as a bug at the call site, not noise. Extraction's consistency comes from `CONCEPT_SCHEMA` + verbatim terms + dedup, **not** from sampling. (§3.2)
3. **Thinking tokens spend `maxOutputTokens`.** Gemini 3 thinks by default. Always set `thinkingLevel` *and* `maxOutputTokens` explicitly, or a tight budget truncates the array and surfaces as unparseable JSON rather than a clean error. (§3.3)
4. **Quota exhaustion is not an outage.** They arrive looking the same; only one recovers on its own. Do not collapse them back into one "temporarily overloaded" message — that message was false on a free-tier key and made failures undiagnosable. (Error Handling)
5. **A model listed by `ListModels` may still be dead.** `gemini-2.5-flash` is listed and answers 404. Probe before trusting.

**Where behaviour actually lives:** `server/lib/conceptExtraction.ts` (windowing, prompt, validation, dedup) and `server/lib/gemini.ts` (model constants, retry/quota classification). `materials.routes.ts` only orchestrates and writes rows. No frontend file knows a model name.

6. **One concept row per term per material is an invariant, not a tendency.** Enforced by exact normalised-term folding *before* any embedding (§3.4). Every downstream feature — the Feynman picker, Free Recall's denominator, flashcard generation — assumes it. Do not reintroduce a similarity threshold for same-term concepts; that is precisely what used to fail.

**Biggest open weakness:** one failed window discards the entire run — see *Known Limitation* under Error Handling before you touch retry behaviour.

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
                                  │  ├─ Call Gemini (schema-pinned, no temperature)
                                  │  └─ Extract {term, definition, page}[]
                                  ├─ Fold same-term concepts into ONE row each
                                  ├─ Embed each merged definition
                                  ├─ Drop cross-term duplicates (cosine ≥ 0.93)
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
2. Extract concepts from that window (one Gemini call, shape pinned by CONCEPT_SCHEMA)
3. Repeat until all pages processed
```

**How consistency is guaranteed (updated — this used to be `temperature: 0`):**

`gemini-2.5-flash` accepted `temperature: 0`, which the pipeline used to pin output. **Gemini 3 dropped the sampling parameters entirely** — `temperature`, `top_p` and `top_k` are ignored, and a future model generation returns HTTP 400 for them. There is no equivalent knob. Consistency is therefore structural:

| Mechanism | What it pins |
|---|---|
| Fixed, disjoint windows built in `buildWindows()` | Which text reaches which call. Decided by code, not the model. |
| `CONCEPT_SCHEMA` (`responseSchema`) | The exact `{ term, definition, page }` shape of every item. |
| Prompt rule: *write `term` exactly as it appears in the text* | Term wording, so `norm(term)` matches across runs and reaches the same-term merge branch. |
| Embedding dedup at 0.90 / 0.93 | Absorbs rewordings, including ones that straddle a window boundary. |

**What is no longer guaranteed:** definition *wording* may differ between two runs over the same PDF. This is accepted because extracted concepts are reviewed and curated by the educator before any student sees them — unlike a Free Recall score, which is shown to a student directly. See the AI Services section in `CLAUDE.md`.

#### 3.3 Gemini Concept Extraction (Per Window)

**Function:** `extractConcepts(pages: PdfPage[])`  
**Model:** `gemini-3.6-flash` (`GEMINI_EXTRACTION_MODEL` in [gemini.ts](server/lib/gemini.ts))

For each window, call Gemini with a prompt like:
```
Extract all key concepts from this educational material. 
For each concept, provide:
- term: A 1–3 word name, written exactly as it appears in the text
- definition: A 12+ character, self-contained explanation
- page: The page number where this concept appears (1-indexed)

Return a JSON array: [{ term, definition, page }, ...]
```

**Call configuration:**
```typescript
raw = await generateJson<RawConcept[]>(prompt, {
  model: GEMINI_EXTRACTION_MODEL,          // gemini-3.6-flash
  thinkingLevel: ThinkingLevel.LOW,        // enumeration, not reasoning
  responseSchema: CONCEPT_SCHEMA,          // pins the item shape
  maxOutputTokens: 16384,                  // thinking shares this budget
});
```

**Why each setting:**
- **No `temperature`** — Gemini 3 ignores it (see §3.2). Passing it would log a warning from `generateJson()` and be dropped.
- **`thinkingLevel: LOW`** — Gemini 3 thinks by default (`medium` on 3.6-flash). Extraction is enumeration, so `low` keeps per-window latency close to the old 2.5-flash timings while leaving headroom for the "extract EVERY testable term" instruction.
- **`maxOutputTokens: 16384`** — thinking tokens draw on the *same* budget as the answer. A dense window yielding 30+ concepts under a default ceiling truncates mid-array, which surfaces as unparseable JSON rather than a clean error. Well under the model's 64k cap.

**Response schema (`CONCEPT_SCHEMA`):**
```typescript
{
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      term:       { type: Type.STRING },
      definition: { type: Type.STRING },
      page:       { type: Type.INTEGER },
    },
    required: ['term', 'definition', 'page'],
    propertyOrdering: ['term', 'definition', 'page'],
  },
}
```

The schema constrains **structure only**. Value rules — minimum definition length, definition ≠ term, page inside the window's range — are still enforced in the validation loop below, because a JSON schema cannot express them.

**Gemini Response Format:**
```json
[
  { "term": "Photosynthesis", "definition": "The process by which green plants convert sunlight, water, and carbon dioxide into glucose and oxygen.", "page": 1 },
  { "term": "Chlorophyll", "definition": "The green pigment found in chloroplasts that absorbs light energy for photosynthesis.", "page": 1 },
  ...
]
```

**Validation (on raw Gemini response):**

Bad items are **skipped, never thrown on.** One malformed concept must not cost the educator the other 70 in the same window — and the model does occasionally emit a stub. The page number is *clamped* rather than rejected, because a wrong page is a traceability nuisance while a discarded concept is lost content.

```typescript
for (const item of raw) {
  const term = typeof item?.term === 'string' ? item.term.trim() : '';
  const definition = typeof item?.definition === 'string' ? item.definition.trim() : '';
  if (!term || !definition) continue;                     // missing either half
  if (definition.length < MIN_DEFINITION_CHARS) continue;  // 12 chars — not self-contained
  if (norm(definition) === norm(term)) continue;           // definition just restates the term

  // Clamp the reported page into THIS window's real range, never the document's.
  let page = typeof item?.page === 'number' ? Math.round(item.page) : w.startPage;
  if (page < w.startPage || page > w.endPage) page = w.startPage;

  candidates.push({ term, definition, page });
}
```

`norm()` is `trim → lowercase → collapse whitespace`. Note the clamp is against the **window** bounds (`w.startPage`/`w.endPage`), not the whole document — the model only saw this window, so a page number outside it is a hallucination regardless of whether the document has that page.

An entire window that comes back as a non-array is skipped with `continue`; only a thrown API error aborts the run.

#### 3.4 Same-Term Fold — **one concept row per term**

> **Invariant:** a term appears **at most once per material**. Everything the document says about it is folded into that single record.

String work on `foldKey(term)`, running **before any embedding**. Exact identity cannot be missed the way a similarity search can — this, not a threshold, is what guarantees the invariant. §3.3's prompt asks the model for the same thing, but a prompt is a request; this is the enforcement.

**`foldKey()` = `norm()` (trim → lowercase → collapse whitespace) plus one documented exception: a trailing ALL-CAPS acronym is ignored.**

```
SECURE SOFTWARE DEVELOPMENT LIFE CYCLE (SSDLC)  ─┐
SECURE SOFTWARE DEVELOPMENT LIFE CYCLE          ─┼─→ one concept
SSDLC                                           ─┘
```

A bare acronym folds in too: any term ending `(ABC)` registers `ABC` as an alias for its full name, so a standalone `SSDLC` row merges into it. The label kept for display is the one **carrying the acronym** — `Incident response (IR)` teaches the abbreviation, `INCIDENT RESPONSE` does not.

> **Why the acronym rule is narrow and not "strip every bracket".** A lowercase parenthetical is usually a *disambiguator* doing the opposite job. `Bank (river)` and `Bank (financial)` are two concepts and must stay two rows — stripping all brackets would silently merge them. `TRAILING_ACRONYM` therefore only matches an ALL-CAPS/digit token of 1–10 characters, and only at the end.

This rule was added after a real upload: that material produced `… LIFE CYCLE (SSDLC)` on page 5 and `… LIFE CYCLE` on page 7. Their definitions embed at **0.887 cosine** — comfortably below `CROSS_TERM_DUP`, so §3.6 would never have caught them either. Re-checked across all 37 concepts of that material, the rule merges exactly those two pairs and nothing else.

**`mergeDefinitions()`:**
1. Order the group's definitions by **source page ascending** — the merged passage reads in document order and is identical on every run.
2. Drop exact repeats, and any definition wholly contained in a longer one. Terminal punctuation is stripped before that comparison: `"A fast store."` *is* contained in `"A fast store of recently used data."`, but the full stop hides it from a plain substring test and the fragment gets appended anyway.
3. Join with a space, giving each part terminal punctuation first.
4. Stop at `MAX_MERGED_DEFINITION_CHARS = 800`, adding parts in page order so the earliest (usually most foundational) survive. Never truncates mid-sentence.

`source_pages` is unioned across the group, so traceability survives the fold.

**Worked example** — the model returns three items for one term:

```
Firewall   p1  "A barrier that blocks unwanted network traffic."
firewall   p3  "A network security device that monitors and filters incoming and
                outgoing traffic based on established security policies."
FIREWALL   p2  "A barrier that blocks unwanted network traffic."   ← exact repeat

⇒ ONE row, source_pages {1,2,3}
  "A barrier that blocks unwanted network traffic. A network security device that
   monitors and filters incoming and outgoing traffic based on established
   security policies."
```

**Why one row per term.** This replaced a rule that kept the same term as two rows whenever its definitions embedded far enough apart, on the theory they were two senses of one word ("bank": river vs financial). In real JHS modules that branch almost never caught polysemy — it caught two *partial* definitions of one term from different pages, which embed apart merely because they stress different aspects.

The cost of getting it wrong is wildly asymmetric:

| Failure | Visibility | Consequence |
|---|---|---|
| Concept wrongly **split** | Invisible | Inflates Free Recall's coverage denominator; a picker offering the same term twice cannot show a student which is which, and rows past the first were unreachable in Feynman. |
| Concept wrongly **merged** | Listed in the Concepts tab | Educator edits it in seconds, or splits it back out via `POST /api/materials/:id/concepts`. |

So the pipeline always merges, and leaves genuine polysemy to manual curation. There is deliberately **no** `UNIQUE (material_id, lower(term))` constraint — that would also block the manual escape hatch.

**Not folded:** `foldKey()` does no stemming, so "Firewall" and "Firewalls" stay separate rows and fall to §3.6. Stemming invites worse false merges than it prevents.

**Where to stop adding rules.** The fold is deliberately made of *mechanical* conventions — a term written with and without its acronym is always the same concept, so code can settle it with no judgement. Anything requiring judgement (`Firewall`/`Firewalls`, `Bank` in two senses) belongs to the educator, who has add/edit/delete in the Concepts tab. Resist widening these rules into fuzzy matching; the previous 0.90 similarity gate is exactly what let duplicates through in the first place.

#### 3.5 Embedding

**Function:** `generateEmbedding(definition: string): Promise<number[]>`  
**File:** [server/lib/gemini.ts](server/lib/gemini.ts)

```typescript
const embedding = await generateEmbedding(mergedDefinition);
// Returns: number[] of length 3072 (gemini-embedding-001 dimensions)
```

**Order matters:** embedding runs **after** the fold, on the **final** definition — never an intermediate one. Text and vector are produced together and cannot diverge.

> This ordering fixed a real bug. The old merge branch swapped in the longer definition but kept the *original* definition's embedding, so the stored vector described text that was no longer stored. Free Recall (0.70 covered threshold), the chatbot's `match_concepts` RPC (0.60) and cross-term dedup all read that vector, so a stale one silently mis-scores students.

Folding first also makes **fewer** embedding calls than before: one per final concept rather than one per raw candidate.

**Critical Note:** The embedding model **must always be `gemini-embedding-001`**. Changing it would invalidate all stored concept vectors and break similarity search downstream (Free Recall, chatbot RAG, etc.).

#### 3.6 Cross-Term Deduplication (Embedding-Based)

**Purpose:** drop concepts under *different* terms that mean the same thing — including repeats that straddle a window boundary. Same-term duplicates no longer reach this stage at all.

```typescript
for (const m of merged) {
  const embedding = await generateEmbedding(m.definition);

  let bestIdx = -1, bestSim = -1;
  for (let i = 0; i < kept.length; i++) {
    const sim = cosine(embedding, kept[i].embedding);
    if (sim > bestSim) { bestSim = sim; bestIdx = i; }
  }

  // Different term, near-identical idea ⇒ reworded duplicate.
  // Drop it, but keep its pages on the survivor.
  if (bestIdx >= 0 && bestSim >= CROSS_TERM_DUP) {          // 0.93
    for (const page of m.source_pages) {
      kept[bestIdx].source_pages = unionPages(kept[bestIdx].source_pages, page);
    }
    continue;
  }

  kept.push({ ...m, embedding });
}
```

**One threshold: `CROSS_TERM_DUP = 0.93`.** In 3072-dimensional space even unrelated vectors score ~0.60–0.65 (the hubness problem), so 0.93 means truly near-identical semantic content. There is deliberately **no same-term threshold** any more.

> **A bug this restructure removed.** The old loop found the single globally-most-similar concept and *then* asked whether it shared the candidate's term. A same-term concept sitting at 0.91 was invisible whenever an unrelated concept scored 0.92 — so the same-term merge silently never fired for it. Term identity is now settled by exact grouping in §3.4, before any vector comparison, so no branch can be shadowed this way.

#### 3.7 Batch Insert Concepts

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

#### 3.8 Status Update → "completed" (or "failed")

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
| `pdfjs-dist` | ^5.x | PDF text extraction (legacy Node.js build) |
| `@google/genai` | ^1.50.0 | Gemini API client |
| `@supabase/supabase-js` | ^2.x | Database + storage client |

**Gemini models used by this pipeline:**

| Purpose | Model | Notes |
|---------|-------|-------|
| Concept extraction | `gemini-3.6-flash` | Google's listed replacement for `gemini-2.5-flash`. Thinking on by default; no `temperature`. |
| Concept embeddings | `gemini-embedding-001` | 3072-d. **Fixed** — supported to 2028-05-14, and changing it invalidates every stored vector. |

> The `^1.50.0` floor is not cosmetic: `ThinkingLevel` and `thinkingConfig` arrived with the Gemini 3 family, and the extraction call now depends on them.

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

### Gemini API Failures — Retries, Quota and Overload

All Gemini calls (generation *and* embedding) go through `withRetry()` in [gemini.ts](server/lib/gemini.ts). It sorts every upstream failure into **three outcomes that must not be conflated**:

| Outcome | Trigger | Behaviour | Thrown |
|---|---|---|---|
| `fatal` | 400, 403, **404** (dead model), bad key | Rethrown **immediately**, untouched | original `ApiError` |
| `quota` | 429 / `RESOURCE_EXHAUSTED` on a non-per-minute metric | **One** retry, then give up | `GeminiQuotaError` (429) |
| `transient` | 500/502/503/504, or 429 on a `*_per_minute` metric | Full backoff, up to 4 attempts | `GeminiUnavailableError` (503) |

**Why quota and overload are separated.** They arrive looking identical — both are retryable-shaped 429/5xx — but only one recovers on its own. Before this split, both reached the educator as *"The AI service is temporarily overloaded. Please try again in a moment."* On a free-tier key that sentence is **false**: the daily allowance is spent and no amount of retrying inside one upload will change it. Google names the window in the quota metric, which is the only reliable signal:

- `…/generate_content_free_tier_requests` → **daily**, will not recover → `quota`
- `…_per_minute` → burst limit, clears by itself → `transient`

**Google's own retry hint is honoured.** `google.rpc.RetryInfo` in the error body carries a `retryDelay` (e.g. `"7.248835383s"`). `withRetry` uses it in preference to its own exponential backoff, capped at `MAX_HONOURED_RETRY_DELAY_MS = 30_000`. This matters for multi-window documents: on a ~10 RPM free tier a long module *will* trip the per-minute limit, and waiting the server-suggested delay lets the run continue instead of dying.

**Every attempt logs the real cause.** The SDK's `ApiError` puts the HTTP code on `.status` and the whole JSON error body in `.message`, so `parseUpstreamError()` digs out the status, the `google.rpc` reason, the quota metric and the retry hint:

```
[Gemini] generateJson attempt 1/4 failed — HTTP 429 RESOURCE_EXHAUSTED [quota]:
  Quota exceeded for metric: …/generate_content_free_tier_requests, limit: 20
[Gemini] generateJson retrying in 7249ms (server-suggested)
```

> **Do not remove the status and reason from that log line.** An earlier version logged only `failed (attempt 1/4)` and threw a hardcoded message, which made a spent quota and a genuine outage *indistinguishable after the fact* — a failed upload could not be diagnosed at all once it had happened.

**What the educator sees.** The thrown message is wrapped by `extractConcepts()` with the page range and stored in `materials.parse_error` (truncated to 500 chars), which `MaterialDetail.tsx` renders verbatim:

```
Extraction failed on pages 1–6: The Gemini API quota for this key is exhausted
(generate_content_free_tier_requests, limit 20). Free-tier quotas reset on a daily
cycle — try again after the reset, or enable billing on the Google Cloud project
behind this API key.
```

The material lands on `parsed_status = 'failed'`, and the educator can still add concepts by hand or re-upload once the quota resets.

`GeminiQuotaError` **extends** `GeminiUnavailableError`, so existing `instanceof` handlers keep catching it; it simply answers 429 instead of 503. Route handlers should forward `err.status` rather than hardcoding a status — see the two handlers in [cognitive.routes.ts](server/routes/cognitive.routes.ts).

### Free-Tier Quota Reality

Observed against this project's own keys — **not** the generous figures in Google's public docs:

```
429 — Quota exceeded for metric:
      generativelanguage.googleapis.com/generate_content_free_tier_requests,
      limit: 20, model: gemini-3.6-flash
```

**20 generation requests per day.** Extraction makes **one call per window**, so:

| Document | Windows | Share of a 20/day budget |
|---|---|---|
| 6 pages | 1 | 5% |
| ~40 pages | ~6 | 30% |
| 100 pages | ~12–15 | **60–75%** |

Embeddings are metered **separately** from generation, so they do not consume this budget — but they do count toward per-minute request pressure on the same project.

Plan testing around this, or enable billing before a demo. A key that worked an hour ago can refuse the next upload purely because the day's allowance ran out.

### Truncated Model Output (Gemini 3 only)

A failure mode `gemini-2.5-flash` did not have. Gemini 3 thinks by default, and **thinking tokens draw on the same `maxOutputTokens` budget as the answer**. If the budget runs out mid-array, the call returns no usable text and `finishReason = MAX_TOKENS`.

`generateJson()` names this explicitly rather than reporting a bare "empty response":

```
Failed to generate JSON content: the model hit its output token limit before
finishing (finishReason=MAX_TOKENS). On a thinking model, raise maxOutputTokens
or lower thinkingLevel.
```

The error propagates through `extractConcepts()`, which wraps it with the page range (`Extraction failed on pages 13–18: …`), so `parse_error` tells the educator *where* it broke. Fixes, in order of preference: raise `EXTRACTION_MAX_OUTPUT_TOKENS`, lower `EXTRACTION_THINKING`, or shrink `MAX_WINDOW_CHARS` — all in [conceptExtraction.ts](server/lib/conceptExtraction.ts).

### Large Documents

A 100-page document with 8k-char windows:
- ~12–15 windows (depending on page lengths)
- Each window calls Gemini **once** — and one embedding call per surviving candidate
- Concepts extracted independently per window, then deduplicated
- Total processing time: 2–5 minutes (mostly Gemini latency)

### ⚠️ Known Limitation — One Failed Window Discards the Whole Run

**`extractConcepts()` throws on the first window that fails, and `processMaterialAsync()` catches it and marks the material `failed`. Nothing is persisted.** Every window that already succeeded is thrown away, along with every API request already spent on it.

```
window 1..13  ✓ extracted, embedded, held in memory
window 14     ✗ 429 / 503
              ⇒ all 13 windows' concepts discarded, material = 'failed'
```

On a 20/day free tier this is severe: a 15-window module that fails on the last window burns ~70% of the daily allowance and stores **zero** concepts. Re-uploading starts from window 1 and needs the full budget again.

This is a **deliberate simplicity trade-off, not an oversight** — a half-extracted material is a worse default than a clean failure, because students would study an incomplete knowledge base without any signal that it was incomplete. But it is the most valuable thing to fix if extraction reliability becomes a problem.

If you rework this, the shape is roughly:
1. Insert concepts per window as each window completes, rather than batching at the end.
2. Record progress on the material (e.g. last completed page) so a retry resumes rather than restarts.
3. Introduce a `partial` state distinct from `completed`, so the educator and every downstream reader can tell an incomplete knowledge base from a finished one. **Do not let `partial` masquerade as `completed`** — Free Recall's coverage ratio and `v_student_material_mastery`'s `m_doc` both average over whatever concepts exist, so a half-populated material silently mis-scores students rather than failing loudly.

### Duplicate Concepts

**Same term, more than one definition** — always folded into one row (§3.4), no matter how far apart the definitions embed:
```
"Firewall" p2 → "A barrier that blocks unwanted traffic."
"Firewall" p9 → "A network security device that monitors and filters
                 incoming and outgoing traffic based on security rules."

⇒ 1 row, definition = both parts in page order, source_pages = {2, 9}
```

Even a genuine two-sense term ("Bank": financial vs river) merges. That is deliberate — see the asymmetry table in §3.4. If a material really needs both senses as separate rows, the educator adds the second by hand via `POST /api/materials/:id/concepts`.

**Different terms, identical meaning:**
```
"Photosynthesis" (term 1)
"The process by which plants convert sunlight..." (definition 1)

"Photosynthetic Process" (term 2)
"The mechanism of converting solar radiation..." (definition 2)
```
Similarity ≥0.93 → **Candidate is dropped** as a reworded duplicate.

> **History:** duplicate rows for one term used to reach the database routinely — a real upload produced three rows named "SECURE SOFTWARE DEVELOPMENT". Two causes, both now fixed: the prompt explicitly *asked* for a separate item per distinct meaning, and the code's same-term merge was gated behind a 0.90 cosine threshold that two partial definitions routinely failed. **Materials uploaded before that fix still hold their duplicate rows** — re-upload or merge them by hand in the Concepts tab.

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

### Why Windowing?

- Ensures full-document coverage (extraction doesn't miss tail-end concepts)
- Keeps token budgets reasonable (~2k tokens per window)
- Reproducible splits: same PDF → same window boundaries, decided by code

Windows stayed at 8000 chars / 6 pages through the Gemini 3.6 migration on purpose. `gemini-3.6-flash` has a 1M context and could take far larger windows, but changing the model and the windowing in one step would make any change in extraction output ambiguous. Enlarging windows — fewer calls, less rate-limit pressure — is a worthwhile follow-up once 3.6 output has been compared against 2.5 output on the same documents.

### Why Not Temperature 0 Anymore?

The pipeline used `temperature: 0` under `gemini-2.5-flash` to make repeat extractions comparable. **Gemini 3 removed that option** — the sampling parameters are ignored and will eventually 400. Rather than leave a dead parameter in the call, the guarantee was rebuilt out of things the model cannot vary: code-decided windows, a `responseSchema`, a verbatim-term prompt rule, and the embedding dedup that was already there. See §3.2 for the full table.

Two consequences worth being explicit about:

1. **Determinism was always weaker than the old wording implied.** `temperature: 0` reduces variance; it never made the model a pure function. The source comment already hedged with *"substantially the same set"*.
2. **The stakes here are low.** An educator reviews and curates every extracted concept before students see it. The same trade-off would **not** be acceptable in Free Recall or Feynman grading, where the model's output becomes a score shown directly to a student — which is why those two remain on `gemini-2.5-flash` pending a proper design.

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

#### Failure Handling
- [ ] Invalid `GEMINI_API_KEY` → material `failed`, `parse_error` names the page range, **no retries** in the log (a bad key is `fatal`, not transient)
- [ ] Quota exhausted → `parse_error` says *quota … reset on a daily cycle*, **not** "temporarily overloaded"; log shows `[quota]` and exactly 2 attempts
- [ ] Every retry log line carries an HTTP status and a `[quota]`/`[transient]`/`[fatal]` tag — if it does not, the classifier has been bypassed
- [ ] Material never sits on `processing` forever; every path ends `completed` or `failed`

Error classification can be exercised without burning quota by throwing synthetic `ApiError`s (status + JSON body in `.message`) at a stubbed `genai.models.generateContent` and asserting the class, status and attempt count that come back out.

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

#### Extraction failed — which failure was it?

**Read the retry lines, not the final message.** The final `parse_error` is a summary; the per-attempt log carries the upstream truth:

```
[Gemini] generateJson attempt 1/4 failed — HTTP 429 RESOURCE_EXHAUSTED [quota]: …
                                                ▲          ▲            ▲
                                          HTTP code   google.rpc    classification
```

| What you see | Meaning | Do this |
|---|---|---|
| `[quota]`, 2 attempts | Daily allowance spent | Wait for reset, or enable billing |
| `[transient]`, 4 attempts, HTTP 429 | Per-minute burst limit | Fewer/larger windows, or space uploads out |
| `[transient]`, 4 attempts, HTTP 5xx | Genuine Google outage | Retry later; nothing to fix locally |
| `[fatal]`, 1 attempt, HTTP 404 | Model name is dead or wrong | Check `GEMINI_EXTRACTION_MODEL` against Google's deprecation page |
| `[fatal]`, 1 attempt, HTTP 400 | Malformed request | Usually a bad `responseSchema` or an unsupported param on Gemini 3 |
| `finishReason=MAX_TOKENS` | Output truncated, not an outage | Raise `EXTRACTION_MAX_OUTPUT_TOKENS` or lower `EXTRACTION_THINKING` |

**A model that `ListModels` returns can still be dead.** `gemini-2.5-flash` is listed but answers 404 `"no longer available to new users"` on keys that had not already used it. Probe the model directly rather than trusting the listing.

**Confirm whether it is the key or the code** — hit the API without going through the app:
```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=$GEMINI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say OK."}]}]}'
```
A 200 here with a failure in the app means the problem is local. A 429 here is quota, and the response body names the exact metric and limit.

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

#### The same term appears twice in one material

Should be impossible after §3.4 — verify:
```sql
SELECT lower(term), count(*) FROM concepts
WHERE material_id = '...'
GROUP BY 1 HAVING count(*) > 1;
```
Zero rows expected — but note this checks *exact* terms, and `foldKey()` also ignores a trailing acronym. To see what the fold actually considers duplicate:
```sql
SELECT lower(btrim(regexp_replace(term, '\s*\(\s*[A-Z0-9][A-Z0-9./-]{0,9}\s*\)\s*$', ''))) AS fold_key,
       count(*), string_agg(term, '  +  ')
FROM concepts WHERE material_id = '...'
GROUP BY 1 HAVING count(*) > 1;
```
Any row returned means two spellings `foldKey()` does not consider equal — most likely a plural, a hyphen, or a spelled-out abbreviation. That is a **curation fix, not a code fix**: merge them in the Concepts tab. **Do not add stemming** — it causes worse false merges than it prevents. If it is systematic, tighten the *verbatim term* rule in `PROMPT_RULES` instead.

A material uploaded before the fold shipped will still show duplicates; re-upload it.

#### Cross-term dedup overly aggressive / not aggressive enough

Distinct terms are disappearing, or obvious rewordings are surviving. One knob, in [conceptExtraction.ts](server/lib/conceptExtraction.ts):
```typescript
const CROSS_TERM_DUP = 0.93;  // different terms this similar ⇒ reworded duplicate
```
Lower → more aggressive. Higher → keep more distinct rows. There is no same-term threshold to tune; §3.4 folds those by exact match.

#### Merged definitions too long / rambling

```typescript
const MAX_MERGED_DEFINITION_CHARS = 800;
```
Lower it if flashcard backs read poorly. It used to serve full-mode chat as well, which 413'd on Groq past ~6000 tokens; since the 2026-08-19 Gemini migration that route has its own `MAX_CONTEXT_CHARS` and a ~1M-token window, so the flashcard back is the only remaining reason for this cap. Parts are dropped from the *end* (latest pages first), never truncated mid-sentence.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Concept** | A term (e.g., "Photosynthesis") + definition (e.g., "The process by which plants...") + embedding vector. The atomic unit of the knowledge base. |
| **Embedding** | A 3072-dimensional vector representation of a text (definition). Used for semantic similarity search. |
| **Cosine Similarity** | A distance metric between two embedding vectors (range 0–1, where 1 = identical). |
| **Same-Term Fold** | Combining every definition the document gives for one term into a single concept row, in page order. Exact match on the normalised term, before any embedding. Guarantees one row per term per material. |
| **Cross-Term Deduplication** | Dropping a concept whose *different* term means the same as one already kept (cosine ≥ 0.93). |
| **Windowing** | Splitting a multi-page PDF into chunks (~8k chars / 6 pages) and extracting concepts per chunk. Ensures full-document coverage. |
| **pgvector** | PostgreSQL extension for vector storage and similarity search. The `embedding` column is of type `VECTOR(3072)`. |
| **RLS (Row-Level Security)** | Database policy that filters rows based on the authenticated user. Enforces educator → owns only their own materials. |
| **Signed URL** | A time-limited URL (e.g., 1-hour expiry) to access a private file in Supabase Storage without explicit authentication. |
| **Scanned PDF** | A PDF created from images (e.g., photocopied pages) with no extractable text layer. Rejected at upload time. |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.3.1 | 2026-08-01 | **Acronym folding.** A real re-upload still produced two rows for one concept — `… LIFE CYCLE (SSDLC)` (p5) and `… LIFE CYCLE` (p7), embedding at 0.887 cosine so §3.6 could not catch them either. `foldKey()` now ignores a trailing ALL-CAPS acronym, and a bare acronym folds into the term that introduced it. Deliberately narrow: lowercase parentheticals are disambiguators (`Bank (river)` vs `Bank (financial)`) and must stay split. Verified over all 37 concepts of that material — exactly 2 pairs merge, no false merges. |
| 1.3 | 2026-08-01 | **One concept row per term.** Duplicate rows for a single term are now impossible: the prompt asks for exactly one item per term (it previously *asked* for a separate item per distinct meaning), and the code folds same-term candidates by exact normalised match **before** embedding. Definitions are joined in page order with containment collapse and an 800-char cap; `source_pages` unions. Removed `SAME_TERM_MERGE` and the "two distinct meanings" branch. Two bugs died with it: the same-term merge could never fire when an unrelated concept scored higher, and merging swapped the definition without re-embedding, leaving stored vectors describing discarded text. §3.4–3.6 rewritten. |
| 1.2 | 2026-08-01 | **Failure handling.** `withRetry()` now classifies every upstream error as `fatal` / `quota` / `transient` instead of treating all 429/5xx alike, honours Google's `RetryInfo` retry hint, and logs the real HTTP status + `google.rpc` reason on every attempt. Added `GeminiQuotaError` (429, extends `GeminiUnavailableError`) so a spent quota no longer reaches the educator as "temporarily overloaded — try again in a moment", which was false. Documented the observed 20-requests/day free-tier ceiling and the one-failed-window-discards-everything limitation. Corrected the §3.3 validation snippet, which showed `throw` where the code does `continue`. |
| 1.1 | 2026-08-01 | Migrated extraction from `gemini-2.5-flash` to `gemini-3.6-flash` ahead of the 2026-10-16 shutdown. Removed `temperature: 0` (Gemini 3 ignores it) and rebuilt the consistency guarantee on `responseSchema` + verbatim terms + existing dedup. Added `thinkingLevel: LOW` and an explicit `maxOutputTokens`. Corrected the SDK row (`@google/genai`, not `@google/generative-ai`). Windowing unchanged. |
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