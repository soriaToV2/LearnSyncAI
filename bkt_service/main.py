"""
LearnSyncAI — BKT (Bayesian Knowledge Tracing) Microservice
============================================================
Runs as a standalone FastAPI service on port 8000.

Responsibilities:
  - Read practice_telemetry from Supabase for a student
  - Run the pyBKT model to estimate latent mastery per concept
  - Write updated latent_mastery values back to bkt_mastery table
  - Return the updated scores to the caller (Express backend)

Start:
  cd bkt_service
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000
"""

import os
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env from the project root (one level up)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

app = FastAPI(title="LearnSyncAI BKT Microservice", version="1.0.0")

# ─────────────────────────────────────────────
# Supabase Client Setup
# ─────────────────────────────────────────────

supabase_url: str = os.environ.get("SUPABASE_URL", "")
supabase_key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not supabase_url or not supabase_key:
    print("⚠️  Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.")

supabase: Client = create_client(supabase_url, supabase_key)

# ─────────────────────────────────────────────
# BKT Parameters (Standard defaults)
# These can be made per-concept in the future.
# ─────────────────────────────────────────────

BKT_PARAMS = {
    "prior":   0.1,   # P(L0)   — initial probability of knowing the concept
    "learn":   0.2,   # P(T)    — probability of transitioning from not-knowing to knowing
    "slip":    0.1,   # P(S)    — probability of incorrect answer despite knowing
    "guess":   0.2,   # P(G)    — probability of correct answer despite not knowing
}

def run_bkt(observations: list[bool], params: dict) -> float:
    """
    Runs the standard 2-state Bayesian Knowledge Tracing model
    on a sequence of boolean observations (True = correct, False = incorrect).

    Returns the final probability of mastery P(L_n) as a float between 0 and 1.

    BKT Update equations:
      Evidence update (Bayes):
        P(L|correct) = P(L) * (1 - P(S)) / [P(L)*(1-P(S)) + (1-P(L))*P(G)]
        P(L|incorrect) = P(L) * P(S) / [P(L)*P(S) + (1-P(L))*(1-P(G))]

      Learning transition:
        P(L_new) = P(L|evidence) + (1 - P(L|evidence)) * P(T)
    """
    p_l = params["prior"]
    p_t = params["learn"]
    p_s = params["slip"]
    p_g = params["guess"]

    for correct in observations:
        if correct:
            # Correct answer — update belief
            numerator = p_l * (1 - p_s)
            denominator = numerator + (1 - p_l) * p_g
        else:
            # Incorrect answer — update belief
            numerator = p_l * p_s
            denominator = numerator + (1 - p_l) * (1 - p_g)

        if denominator == 0:
            p_l_given_evidence = p_l
        else:
            p_l_given_evidence = numerator / denominator

        # Apply learning transition
        p_l = p_l_given_evidence + (1 - p_l_given_evidence) * p_t

    return float(np.clip(p_l, 0.0, 1.0))


# ─────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────

class RecalculateRequest(BaseModel):
    student_id: str
    practice_test_id: Optional[str] = None
    concept_ids: Optional[list[str]] = None   # If None, recalculates all concepts


class MasteryResult(BaseModel):
    concept_id: str
    latent_mastery: float
    observation_count: int


class RecalculateResponse(BaseModel):
    student_id: str
    updated: list[MasteryResult]


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@app.get("/health")
def health_check():
    """Health check endpoint — used by Express to verify this service is alive."""
    return {"status": "ok", "service": "LearnSyncAI BKT Microservice"}


@app.post("/recalculate", response_model=RecalculateResponse)
def recalculate_mastery(request: RecalculateRequest):
    """
    Recalculates BKT mastery for a student across one or more concepts.

    Steps:
    1. Fetch all practice_telemetry for the student (optionally filtered by concept_ids)
    2. Group observations by concept_id
    3. Run the BKT model per concept
    4. Upsert the new latent_mastery values into bkt_mastery
    5. Return the updated scores
    """
    student_id = request.student_id

    # 1. Fetch telemetry
    query = (
        supabase
        .from_("practice_telemetry")
        .select("concept_id, is_correct, created_at")
        .eq("student_id", student_id)
        .order("created_at", desc=False)
    )

    if request.concept_ids:
        query = query.in_("concept_id", request.concept_ids)

    if request.practice_test_id:
        query = query.eq("practice_test_id", request.practice_test_id)

    response = query.execute()

    if not response.data:
        raise HTTPException(
            status_code=404,
            detail=f"No telemetry found for student {student_id}"
        )

    # 2. Group observations by concept_id
    df = pd.DataFrame(response.data)
    grouped = df.groupby("concept_id")

    # 3. Run BKT per concept
    results: list[MasteryResult] = []
    upsert_rows = []

    for concept_id, group in grouped:
        observations = group["is_correct"].tolist()
        mastery = run_bkt(observations, BKT_PARAMS)

        results.append(MasteryResult(
            concept_id=str(concept_id),
            latent_mastery=mastery,
            observation_count=len(observations),
        ))

        upsert_rows.append({
            "student_id": student_id,
            "concept_id": str(concept_id),
            "latent_mastery": mastery,
            "last_updated": pd.Timestamp.now(tz="UTC").isoformat(),
        })

    # 4. Upsert into bkt_mastery (uses UNIQUE(student_id, concept_id) constraint)
    if upsert_rows:
        supabase.from_("bkt_mastery").upsert(
            upsert_rows,
            on_conflict="student_id,concept_id"
        ).execute()

    print(f"[BKT] ✅ Recalculated {len(results)} concept(s) for student {student_id}")

    return RecalculateResponse(student_id=student_id, updated=results)
