-- ============================================================
-- 0026 · Student onboarding progress
-- ============================================================
--
-- Accounts are issued by an administrator, never self-registered, so every
-- student arrives having never seen the application. The student portal has four
-- sidebar areas and six study tools inside every space, and nothing anywhere
-- explains what any of it is for. This table is the store behind a first-run
-- guided tour, a short intro the first time each study tool is opened, and a
-- "How to use" page.
--
-- ══ WHY A TABLE AND NOT A COLUMN ON `profiles` ══
-- Onboarding state is not one boolean, it is a SET of keys (the tour, plus one
-- per study tool). `profiles` carries ten columns, no JSONB and no spare field,
-- and the doctrine note under that table is explicit that independent facts must
-- not be collapsed into one column. A JSONB or TEXT[] column would also sit on
-- every educator and admin row meaning nothing, and would make every write a
-- read-modify-write that two open tabs can lose.
--
-- `user_badges` is the existing precedent for "a set of string keys held per
-- student" and this mirrors it deliberately, including the composite key that
-- makes INSERT ... ON CONFLICT DO NOTHING idempotent with no read-then-write
-- race. Nothing here touches `profiles`, `handle_new_user()` or `requireRole`.
--
-- ⚠️ THIS GATES NOTHING. Unlike `must_change_password` (migration 0022), no
-- middleware reads it and no route refuses on it. It is recorded state only, so
-- a failed read or write costs a student a tour step, never their access.
--
-- ══ NO `activity_logs` ROW IS EVER WRITTEN FOR THIS ══
-- Every insert into `activity_logs` fires `trigger_update_streak`, so recording
-- onboarding there would award a study-streak day for reading a tour and count
-- it toward streak_3/5/7. `activity_type` deliberately gains no value here, for
-- the same reason migration 0024 declined to add one.
--
-- SAFE TO RE-RUN. Every statement is guarded: this is applied by hand in the
-- Supabase SQL editor, as there is no runner in this repo.

-- 1. The table ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.onboarding_seen (
    student_id UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    step_key   TEXT        NOT NULL,
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, step_key)
);

COMMENT ON TABLE public.onboarding_seen IS
    'One row per onboarding step a student has been shown. Written only by POST /api/onboarding/seen; read by GET /api/onboarding. Recorded state, not an access gate.';

COMMENT ON COLUMN public.onboarding_seen.step_key IS
    'Stable identifier from the catalogue in src/lib/onboarding.ts, mirrored as a Zod enum in server/types/api.ts (e.g. tour_v1, tool_flashcards). The string IS the identity -- renaming one re-shows that step to every student who had already dismissed it. Versioned suffix (tour_v1) is how a genuinely rewritten tour is re-shown on purpose.';

-- The PK is (student_id, step_key), so a lookup by student alone already uses
-- it as a prefix. No second index is needed: this table is read once per portal
-- entry and holds at most a handful of rows per student.

-- 2. Row-level security ------------------------------------------------------
--
-- Express talks to Postgres with the service role, which bypasses RLS entirely,
-- so these policies protect direct anon-key access only.
--
-- ⚠️ SELECT ONLY, AND DELIBERATELY NO INSERT POLICY. Migration 0023 dropped the
-- student INSERT policy on `activity_logs` for exactly this reason, and dropping
-- it cost nothing because the API writes with the service role. There is no
-- score to inflate here, but a student who could INSERT could also suppress
-- their own tour, and a write path nobody needs is a write path nobody audits.

ALTER TABLE public.onboarding_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read their own onboarding progress" ON public.onboarding_seen;
CREATE POLICY "Students read their own onboarding progress"
    ON public.onboarding_seen FOR SELECT USING (student_id = auth.uid());
