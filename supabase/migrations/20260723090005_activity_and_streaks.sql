-- ============================================================================
-- 0005 — Unified activity log (DFD store D3) and corrected streak logic
-- ============================================================================
-- The documentation tracks day streaks and total study hours across *every*
-- study activity, not just games. The previous trigger fired only on
-- game_sessions and incremented day_streak on every insert, so five games in
-- one afternoon produced a five-day streak.
--
-- activity_logs becomes the single source for both metrics, and the streak is
-- now computed from calendar-day succession.
--
-- Streak days are measured in Asia/Manila, the school's local time. A bare
-- `occurred_at::date` would depend on the session TimeZone (so it is only
-- STABLE and cannot be indexed), and under UTC an early-morning study session
-- in the Philippines would be attributed to the previous day.
-- ============================================================================

-- 1. Activity log ---------------------------------------------------------------

CREATE TYPE activity_type AS ENUM (
    'flashcard',
    'free_recall',
    'feynman',
    'adaptive_test',
    'game',
    'chat'
);

CREATE TABLE activity_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    UUID NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    activity_type activity_type NOT NULL,
    space_id      UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    material_id   UUID REFERENCES materials(id)    ON DELETE SET NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE activity_logs IS
    'DFD data store D3. Every study interaction lands here; day streaks and total study hours derive from it.';

CREATE INDEX idx_activity_logs_student_day
    ON activity_logs (student_id, ((occurred_at AT TIME ZONE 'Asia/Manila')::date));
CREATE INDEX idx_activity_logs_occurred
    ON activity_logs (occurred_at DESC);

-- 2. Backfill from the existing per-feature tables -------------------------------
-- Done before the trigger exists, so historical rows do not drive streak math in
-- insertion order. The streak is recomputed set-based in step 4.

INSERT INTO activity_logs (student_id, activity_type, material_id, duration_ms, occurred_at)
SELECT student_id, 'game', material_id, COALESCE(time_spent_ms, 0), completed_at
  FROM game_sessions
 WHERE student_id IS NOT NULL AND completed_at IS NOT NULL;

INSERT INTO activity_logs (student_id, activity_type, space_id, occurred_at)
SELECT s.student_id,
       CASE cl.mode WHEN 'feynman' THEN 'feynman'::activity_type
                    ELSE 'free_recall'::activity_type END,
       cl.space_id,
       cl.created_at
  FROM cognitive_logs cl
  JOIN study_spaces s ON s.id = cl.space_id
 WHERE cl.created_at IS NOT NULL;

INSERT INTO activity_logs (student_id, activity_type, space_id, occurred_at)
SELECT student_id, 'chat', space_id, created_at
  FROM chatbot_logs
 WHERE student_id IS NOT NULL AND created_at IS NOT NULL;

INSERT INTO activity_logs (student_id, activity_type, occurred_at)
SELECT student_id, 'flashcard', reviewed_at
  FROM spaced_repetition_logs
 WHERE student_id IS NOT NULL AND reviewed_at IS NOT NULL;

-- 3. Gamification profile columns ------------------------------------------------

ALTER TABLE gamification_profiles
    ADD COLUMN longest_streak INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_active_on DATE,
    ALTER COLUMN day_streak        SET NOT NULL,
    ALTER COLUMN total_study_hours SET NOT NULL,
    ADD CONSTRAINT gamification_streaks_nonneg
        CHECK (day_streak >= 0 AND longest_streak >= 0 AND total_study_hours >= 0);

-- last_active_at is superseded by last_active_on; keeping both invites drift.
ALTER TABLE gamification_profiles DROP COLUMN last_active_at;

COMMENT ON COLUMN gamification_profiles.last_active_on IS
    'Asia/Manila calendar date of the most recent activity. Streak succession is measured against this, not a 48-hour clock.';

-- 4. Recompute streaks and hours from the backfilled log --------------------------
-- Classic gaps-and-islands: consecutive dates share (date - row_number()).

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
       longest_streak    = s.longest,
       last_active_on    = s.last_day,
       total_study_hours = COALESCE(h.total_hours, 0)
  FROM summary s
  LEFT JOIN hours h ON h.student_id = s.student_id
 WHERE gp.student_id = s.student_id;

-- 5. Replace the streak trigger ---------------------------------------------------

DROP TRIGGER IF EXISTS trigger_update_streak ON game_sessions;

CREATE OR REPLACE FUNCTION public.update_study_streak()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day    DATE := (NEW.occurred_at AT TIME ZONE 'Asia/Manila')::date;
    v_last   DATE;
    v_streak INTEGER;
BEGIN
    -- Students always have a gamification profile, but tolerate a missing row.
    INSERT INTO gamification_profiles (student_id)
    VALUES (NEW.student_id)
    ON CONFLICT (student_id) DO NOTHING;

    SELECT last_active_on, day_streak
      INTO v_last, v_streak
      FROM gamification_profiles
     WHERE student_id = NEW.student_id
     FOR UPDATE;

    IF v_last IS NULL OR v_day > v_last THEN
        -- A new calendar day: extend the run if it is the very next day, else restart.
        v_streak := CASE WHEN v_last IS NOT NULL AND v_day = v_last + 1
                         THEN v_streak + 1
                         ELSE 1
                    END;

        UPDATE gamification_profiles
           SET day_streak     = v_streak,
               longest_streak = greatest(longest_streak, v_streak),
               last_active_on = v_day
         WHERE student_id = NEW.student_id;
    END IF;
    -- Repeat activity on a day already counted leaves the streak untouched.

    UPDATE gamification_profiles
       SET total_study_hours = total_study_hours + (NEW.duration_ms / 3600000.0)
     WHERE student_id = NEW.student_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_study_streak() IS
    'Maintains day_streak, longest_streak and total_study_hours from activity_logs inserts. Days are Asia/Manila local.';

CREATE TRIGGER trigger_update_streak
    AFTER INSERT ON activity_logs
    FOR EACH ROW EXECUTE FUNCTION update_study_streak();
