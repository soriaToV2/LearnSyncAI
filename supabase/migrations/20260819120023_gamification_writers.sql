-- ============================================================================
-- 0023 — Streaks & badges: close the fabrication route, resync the profile
--
-- The gamification tables have existed since migration 0005 and have never
-- fired: nothing inserted into activity_logs, so trigger_update_streak never
-- ran, day_streak stayed 0 for everyone and user_badges stayed empty. The
-- writer lands in application code (server/lib/activity.ts). This migration
-- only prepares the ground for it.
-- ============================================================================

-- 1. Remove the student INSERT policy on activity_logs -------------------------
--
-- It contradicted the stated rule eleven lines above it in schema.sql:
-- "gamification_profiles and user_badges have no student INSERT/UPDATE policy,
--  so a student holding an anon key cannot inflate their own scores."
--
-- activity_logs is the one gamification table students could write, and
-- update_study_streak() is SECURITY DEFINER, so an anon-key insert would move
-- day_streak, longest_streak and total_study_hours directly. Harmless while
-- nothing read those numbers; a live fabrication route the moment a dashboard
-- prints them.
--
-- Express writes with the service role, which bypasses RLS entirely, so
-- dropping this costs the application nothing. The SELECT policy stays — a
-- student may read their own activity.

DROP POLICY IF EXISTS "Students append to their own activity log" ON activity_logs;

-- 2. Resync gamification_profiles with activity_logs ---------------------------
--
-- Migration 0005 backfilled 30 rows from the per-feature tables and computed the
-- profile from them. Nothing has written either side since, but the profile must
-- provably agree with its source at the moment a live writer starts appending to
-- it — otherwise the first real activity extends a streak nobody can trace.
--
-- Same gaps-and-islands shape as 0005: consecutive dates share (date - row_number()).
-- Rows are NOT deleted; they are real historical activity.

WITH days AS (
    SELECT DISTINCT student_id, (occurred_at AT TIME ZONE 'Asia/Manila')::date AS d
      FROM activity_logs
), grouped AS (
    SELECT student_id, d,
           d - (row_number() OVER (PARTITION BY student_id ORDER BY d))::int AS island
      FROM days
), runs AS (
    SELECT student_id, island, count(*)::int AS run_length, max(d) AS run_end
      FROM grouped
     GROUP BY student_id, island
), summary AS (
    SELECT student_id,
           max(run_length)                                  AS longest,
           max(run_end)                                     AS last_day,
           (array_agg(run_length ORDER BY run_end DESC))[1] AS current_run
      FROM runs
     GROUP BY student_id
), hours AS (
    SELECT student_id, sum(duration_ms) / 3600000.0 AS total_hours
      FROM activity_logs
     GROUP BY student_id
)
UPDATE gamification_profiles gp
   SET day_streak        = s.current_run,
       longest_streak    = greatest(gp.longest_streak, s.longest),
       last_active_on    = s.last_day,
       total_study_hours = COALESCE(h.total_hours, 0)
  FROM summary s
  LEFT JOIN hours h ON h.student_id = s.student_id
 WHERE gp.student_id = s.student_id;

-- A student with no activity rows at all must read as zero, not as whatever a
-- previous trigger version left behind.
UPDATE gamification_profiles gp
   SET day_streak = 0, total_study_hours = 0, last_active_on = NULL
 WHERE NOT EXISTS (SELECT 1 FROM activity_logs al WHERE al.student_id = gp.student_id);

-- 3. Badge catalogue note -------------------------------------------------------
--
-- user_badges.badge_name stays bare TEXT and there is deliberately no `badges`
-- table. The catalogue lives in server/lib/badges.ts: a table nobody can edit is
-- a constant with extra steps, and building an editor for it would repeat the
-- educator_assignments mistake (built, then removed as beyond the specification).
-- UNIQUE (student_id, badge_name) is what makes awarding idempotent.

COMMENT ON COLUMN user_badges.badge_name IS
    'Stable identifier from the catalogue in server/lib/badges.ts (e.g. streak_3, mastery_10). Never renamed once live — the string IS the identity. UNIQUE (student_id, badge_name) makes ON CONFLICT DO NOTHING the awarding idiom.';
