-- ============================================================================
-- 0008 — Row-Level Security for student / educator / admin
-- ============================================================================
-- Replaces the twelve single-role policies with a complete matrix covering
-- every table in `public`. Nothing is left RLS-enabled-but-policy-less (a
-- silent deny-all) and nothing is left RLS-disabled (a silent allow-all —
-- which is what game_content was).
--
-- Enforcement note: the Express API talks to Postgres with the service role
-- key, which bypasses RLS by design. These policies are the defence-in-depth
-- layer that protects direct anon-key access, and they are the artifact the
-- documented "PostgreSQL RLS checks" are run against. The API layer must still
-- enforce role and ownership itself.
--
-- Mastery is deliberately read-only for students: bkt_mastery, bkt_update_logs,
-- gamification_profiles and user_badges have no student INSERT/UPDATE policy,
-- so a student holding an anon key cannot inflate their own scores.
-- ============================================================================

-- 1. Helper functions --------------------------------------------------------------
-- SECURITY DEFINER so reading `profiles` inside a `profiles` policy does not
-- recurse. Each returns NULL for a disabled account, which fails every
-- role comparison below and locks the account out.

CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT role FROM profiles WHERE id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION auth_grade_level()
RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT grade_level FROM profiles
     WHERE id = auth.uid() AND status = 'active' AND role = 'student';
$$;

CREATE OR REPLACE FUNCTION auth_assigned_grades()
RETURNS SMALLINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT assigned_grade_levels FROM profiles
     WHERE id = auth.uid() AND status = 'active' AND role = 'educator';
$$;

COMMENT ON FUNCTION auth_role() IS
    'Role of the calling user, or NULL if unauthenticated or disabled. SECURITY DEFINER to avoid RLS recursion on profiles.';

-- 2. Owns-this-space helper ---------------------------------------------------------

CREATE OR REPLACE FUNCTION owns_study_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM study_spaces WHERE id = p_space_id AND student_id = auth.uid()
    );
$$;

-- 3. Students cannot self-promote ----------------------------------------------------
-- RLS grants row access, not column access, so a student allowed to UPDATE
-- their own profile could otherwise set role = 'admin'.

CREATE OR REPLACE FUNCTION enforce_profile_immutables()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- auth.uid() is NULL for the service role, which the backend uses.
    IF auth.uid() IS NULL
       OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' THEN
        RETURN NEW;
    END IF;

    IF NEW.role       IS DISTINCT FROM OLD.role
    OR NEW.status     IS DISTINCT FROM OLD.status
    OR NEW.grade_level IS DISTINCT FROM OLD.grade_level
    OR NEW.assigned_grade_levels IS DISTINCT FROM OLD.assigned_grade_levels THEN
        RAISE EXCEPTION
            'Only an administrator can change role, account status or grade-level assignment';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_immutables
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_profile_immutables();

-- 4. Clear the old policy set ---------------------------------------------------------

DROP POLICY IF EXISTS "Students can manage their own study spaces"        ON study_spaces;
DROP POLICY IF EXISTS "Students manage their own decks"                   ON flashcard_decks;
DROP POLICY IF EXISTS "Students manage their own flashcards"              ON flashcards;
DROP POLICY IF EXISTS "Students manage their own spaced repetition logs"  ON spaced_repetition_logs;
DROP POLICY IF EXISTS "Students manage their own cognitive logs"          ON cognitive_logs;
DROP POLICY IF EXISTS "Students manage their own practice tests"          ON practice_tests;
DROP POLICY IF EXISTS "Students can manage their own chatbot logs"        ON chatbot_logs;

-- 5. Enable RLS everywhere -------------------------------------------------------------

ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials              ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_spaces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_space_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_decks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaced_repetition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_telemetry     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_mastery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_update_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_parameters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_content           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges            ENABLE ROW LEVEL SECURITY;

-- 6. profiles ----------------------------------------------------------------------------

CREATE POLICY "Users read their own profile"
    ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users update their own profile"
    ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Educators read students in their assigned grades"
    ON profiles FOR SELECT
    USING (role = 'student' AND grade_level = ANY (auth_assigned_grades()));

CREATE POLICY "Admins manage all profiles"
    ON profiles FOR ALL
    USING (auth_role() = 'admin') WITH CHECK (auth_role() = 'admin');

-- 7. materials ---------------------------------------------------------------------------

CREATE POLICY "Educators manage their own materials"
    ON materials FOR ALL
    USING (educator_id = auth.uid() AND auth_role() = 'educator')
    WITH CHECK (educator_id = auth.uid() AND auth_role() = 'educator');

CREATE POLICY "Students read materials published to their grade"
    ON materials FOR SELECT
    USING (NOT is_archived AND auth_grade_level() = ANY (grade_levels));

CREATE POLICY "Admins read all materials"
    ON materials FOR SELECT USING (auth_role() = 'admin');

-- 8. concepts ------------------------------------------------------------------------------

CREATE POLICY "Students read concepts of accessible materials"
    ON concepts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = concepts.material_id
           AND NOT m.is_archived
           AND auth_grade_level() = ANY (m.grade_levels)
    ));

CREATE POLICY "Educators read concepts of their own materials"
    ON concepts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = concepts.material_id
           AND m.educator_id = auth.uid()
    ));

-- 9. Student-owned study data ----------------------------------------------------------------

CREATE POLICY "Students manage their own study spaces"
    ON study_spaces FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- A student may only attach a material their grade level can actually access.
CREATE POLICY "Students manage materials in their own spaces"
    ON study_space_materials FOR ALL
    USING (owns_study_space(space_id))
    WITH CHECK (
        owns_study_space(space_id)
        AND EXISTS (
            SELECT 1 FROM materials m
             WHERE m.id = study_space_materials.material_id
               AND NOT m.is_archived
               AND auth_grade_level() = ANY (m.grade_levels)
        )
    );

CREATE POLICY "Students manage their own decks"
    ON flashcard_decks FOR ALL
    USING (owns_study_space(space_id)) WITH CHECK (owns_study_space(space_id));

CREATE POLICY "Students manage their own flashcards"
    ON flashcards FOR ALL
    USING (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND owns_study_space(d.space_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND owns_study_space(d.space_id)
    ));

CREATE POLICY "Students manage their own spaced repetition logs"
    ON spaced_repetition_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own cognitive logs"
    ON cognitive_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own chatbot logs"
    ON chatbot_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own practice tests"
    ON practice_tests FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own practice telemetry"
    ON practice_telemetry FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own game content"
    ON game_content FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- 10. Append-only / read-only student records --------------------------------------------------
-- Streaks, mastery and badges are written by the backend. Students may read
-- them and log new activity, but never rewrite history.

CREATE POLICY "Students read their own activity log"
    ON activity_logs FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students append to their own activity log"
    ON activity_logs FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students read their own game sessions"
    ON game_sessions FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students append their own game sessions"
    ON game_sessions FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students read their own gamification profile"
    ON gamification_profiles FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students read their own badges"
    ON user_badges FOR SELECT USING (student_id = auth.uid());

-- 11. Mastery: student reads own, educator reads their assigned grades ---------------------------

CREATE POLICY "Students read their own mastery"
    ON bkt_mastery FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Educators read mastery for their assigned grades"
    ON bkt_mastery FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_mastery.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (auth_assigned_grades())
    ));

CREATE POLICY "Students read their own BKT update log"
    ON bkt_update_logs FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Educators read BKT update logs for their assigned grades"
    ON bkt_update_logs FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_update_logs.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (auth_assigned_grades())
    ));

-- 12. BKT parameters are reference data ------------------------------------------------------------

CREATE POLICY "Authenticated users read BKT parameters"
    ON bkt_parameters FOR SELECT USING (auth_role() IS NOT NULL);

CREATE POLICY "Admins manage BKT parameters"
    ON bkt_parameters FOR ALL
    USING (auth_role() = 'admin') WITH CHECK (auth_role() = 'admin');
