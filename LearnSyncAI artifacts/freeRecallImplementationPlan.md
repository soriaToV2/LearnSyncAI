# Free Recall — Backend Implementation Plan

## Overview

The current `cognitive.routes.ts` already exists but is incomplete for Free Recall. It was designed for a **single concept** evaluation (requires a `concept_id`), but the Free Recall mode needs to evaluate the student's recall against an **entire uploaded material** — all of its extracted concepts at once. We need to overhaul this route to support that.

---

## How It Will Work (The Concept-Extraction Pipeline)

To solve the "context dilution" problem (where a giant wall of text ruins the vector math), we will use an extraction-first approach:

```
Student selects a material and types recall → POST /api/cognitive/free-recall
        ↓
1. Fetch ALL concepts for the selected material_ids from the DB
        ↓
2. Send student's raw text to Gemini (generateJson):
   "Extract all discrete concepts and definitions the student discussed into a JSON array."
        ↓
3. Embed each extracted student concept individually → Gemini gemini-embedding-001
        ↓
4. Run pgvector cosine similarity: Compare every true DB concept against 
   the list of student concept vectors. Find the highest matching score for each DB concept.
        ↓
5. Grade each true DB concept based on its highest match:
   → "Missed" = highest similarity score is BELOW threshold (< 0.70)
   → "Covered" = highest similarity score is ABOVE threshold (>= 0.70)
        ↓
6. Compute overall score as a Coverage Ratio (Number of Covered Concepts / Total DB Concepts)
        ↓
7. Save the session to cognitive_logs
        ↓
8. Return: { similarity_score, missed_concepts[], ai_feedback (if any) }
```

---

## AI Model Decisions

| Concern | Choice | Reason |
|---|---|---|
| **Embedding** | `gemini-embedding-001` | Already used in the DB for concept vectors. Must be the same model for cosine similarity to be valid. |
| **Feedback Generation** | `gemini-2.5-flash` | Already in `gemini.ts`. Used for text generation — will format the feedback as a strict structured JSON list of missed and weak concept names. |

---

## Proposed Changes

---

### Backend — Route Overhaul

#### [MODIFY] [cognitive.routes.ts](file:///d:/projects/LearnSyncAI/server/routes/cognitive.routes.ts)

Completely rewrite the `/recall` endpoint to:
- Accept `{ space_id, material_ids[], user_input, mode: 'free_recall' }`.
- Pass `user_input` to Gemini `generateJson` to extract a list of concepts the student discussed.
- Loop through the extracted list, passing each to `generateEmbedding()`.
- Fetch the **full** concept list for selected materials from the DB.
- Loop through the DB concepts, comparing each against the student's embedded concepts using the cosine similarity formula `1 - (A <=> B)`.
- If the highest match for a DB concept is `< 0.70`, add it to the `missed_concepts` list.
- Calculate the `similarity_score` as a **Coverage Ratio** (`Covered Concepts / Total DB Concepts`) to avoid "hubness" score inflation.
- Save the result to `cognitive_logs`.

Add a new GET endpoint to retrieve history:
- `GET /api/cognitive/history/:spaceId` — Returns all past free recall & feynman sessions for a space, ordered by most recent, with a limit of 20.

---

### Backend — Zod Schema

#### [MODIFY] [api.ts](file:///d:/projects/LearnSyncAI/server/types/api.ts)

Update `CognitiveReviewSchema` to change `concept_id` from required to optional/nullable, and add `material_ids` as a required array for the Free Recall mode.

---

### Frontend — Connect to Real API

#### [MODIFY] [FreeRecallTab.tsx](file:///d:/projects/LearnSyncAI/src/pages/student/studySpaceTabs/FreeRecallTab.tsx)

Replace the mock `setTimeout` evaluation with a real `POST /api/cognitive/free-recall` call. On mount, load real history from `GET /api/cognitive/history/:spaceId`. Replace mock data with real `CognitiveLog` records from the database.

---

## Feedback Structure (Returned to Frontend)

The API will calculate the missed concepts mathematically (using pgvector), so we no longer need a second Gemini call to format the feedback. The backend will simply return:

```json
{
  "missed_concepts": ["Voltage-gated Calcium Channels", "Synaptic Vesicle Exocytosis"],
  "overall_verdict": "partial",
  "similarity_score": 0.65
}
```

The `overall_verdict` will be one of: `"strong"`, `"partial"`, or `"needs_review"` — based on the similarity score. The frontend's minimalist UI will display this list directly, exactly as requested.

---

## Similarity Score Logic (Coverage Ratio)

| Score Range | Verdict | Meaning |
|---|---|---|
| ≥ 0.75 | `strong` | Student covered most concepts well |
| 0.40 – 0.74 | `partial` | Student covered some, but missed key areas |
| < 0.40 | `needs_review` | Student's recall is significantly incomplete |

---

## Verification Plan

1. Upload a PDF and wait for it to finish processing (concepts extracted).
2. Select that material in the Free Recall tab.
3. Type a partial response (missing certain terms).
4. Click "Evaluate Recall" — expect a score + list of missed concepts to appear.
5. Reload the page and verify the past session appears in the History panel.
