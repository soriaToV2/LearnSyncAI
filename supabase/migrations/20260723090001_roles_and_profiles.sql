-- ============================================================================
-- 0001 — Roles, Grade Levels & Account Status
-- ============================================================================
-- Brings `profiles` in line with the version-4 documentation:
--   * three roles: student, educator, admin (replacing student/instructor)
--   * students carry a JHS grade level (7-10)
--   * educators carry the set of grade levels they are assigned to monitor
--   * admins can disable accounts (account_status)
--
-- `handle_new_user()` is rewritten in this same migration because the new CHECK
-- constraints would otherwise reject every row the old trigger inserts.
-- ============================================================================

-- 1. Rebuild the user_role enum -----------------------------------------------
-- PostgreSQL has no ALTER TYPE ... DROP VALUE, so 'instructor' can only be
-- removed by swapping the type out from under the column.

CREATE TYPE user_role_new AS ENUM ('student', 'educator', 'admin');

ALTER TABLE profiles ALTER COLUMN role DROP DEFAULT;

ALTER TABLE profiles
    ALTER COLUMN role TYPE user_role_new
    USING (
        CASE role::text
            WHEN 'instructor' THEN 'educator'
            ELSE role::text
        END
    )::user_role_new;

ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'student'::user_role_new;

DROP TYPE user_role;
ALTER TYPE user_role_new RENAME TO user_role;

-- 2. Account status ------------------------------------------------------------

CREATE TYPE account_status AS ENUM ('active', 'disabled');

-- 3. New profile columns -------------------------------------------------------

ALTER TABLE profiles
    ADD COLUMN grade_level           SMALLINT,
    ADD COLUMN assigned_grade_levels SMALLINT[],
    ADD COLUMN status                account_status NOT NULL DEFAULT 'active',
    ADD COLUMN updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now();

COMMENT ON COLUMN profiles.grade_level IS
    'Junior High School grade level (7-10). Required for students, NULL for educators and admins.';
COMMENT ON COLUMN profiles.assigned_grade_levels IS
    'Grade levels an educator may monitor. Required for educators, NULL for students and admins.';
COMMENT ON COLUMN profiles.status IS
    'Set to disabled by an admin to revoke access without deleting the account.';

-- 4. Backfill before constraining ----------------------------------------------
-- Existing rows are development student accounts with no grade level yet.
-- Grade 7 is a placeholder - correct these by hand once real accounts exist.

UPDATE profiles
   SET grade_level = 7
 WHERE role = 'student'
   AND grade_level IS NULL;

UPDATE profiles
   SET assigned_grade_levels = ARRAY[7, 8, 9, 10]::SMALLINT[]
 WHERE role = 'educator'
   AND assigned_grade_levels IS NULL;

-- 5. Constraints ---------------------------------------------------------------

ALTER TABLE profiles
    ADD CONSTRAINT profiles_grade_level_range
        CHECK (grade_level IS NULL OR grade_level BETWEEN 7 AND 10),

    ADD CONSTRAINT profiles_assigned_grades_range
        CHECK (assigned_grade_levels IS NULL
               OR assigned_grade_levels <@ ARRAY[7, 8, 9, 10]::SMALLINT[]),

    -- A student without a grade level cannot be matched to any material.
    ADD CONSTRAINT profiles_student_needs_grade
        CHECK (role <> 'student' OR grade_level IS NOT NULL),

    -- An educator without assigned grades cannot see any student's mastery.
    ADD CONSTRAINT profiles_educator_needs_grades
        CHECK (role <> 'educator'
               OR COALESCE(array_length(assigned_grade_levels, 1), 0) > 0);

CREATE INDEX idx_profiles_role_grade ON profiles (role, grade_level);
CREATE INDEX idx_profiles_assigned_grades ON profiles USING GIN (assigned_grade_levels);

-- 6. updated_at maintenance ----------------------------------------------------

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Rewrite the signup trigger ------------------------------------------------
-- Accounts are created by an admin through the Supabase Auth admin API, which
-- passes role / grade_level / assigned_grade_levels in user_metadata. The
-- trigger mirrors that metadata into `profiles`.
--
-- Defaults are applied rather than raising, because an exception here would
-- abort the auth.users INSERT and surface as an opaque Supabase Auth failure.
-- The API layer validates the payload before calling createUser.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role   user_role;
    v_grade  SMALLINT;
    v_grades SMALLINT[];
BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'student')::user_role;

    IF NULLIF(NEW.raw_user_meta_data ->> 'grade_level', '') IS NOT NULL THEN
        v_grade := (NEW.raw_user_meta_data ->> 'grade_level')::SMALLINT;
    END IF;

    IF jsonb_typeof(NEW.raw_user_meta_data -> 'assigned_grade_levels') = 'array' THEN
        SELECT array_agg(value::SMALLINT)
          INTO v_grades
          FROM jsonb_array_elements_text(NEW.raw_user_meta_data -> 'assigned_grade_levels');
    END IF;

    IF v_role = 'student' AND v_grade IS NULL THEN
        v_grade := 7;
    END IF;

    IF v_role = 'educator' AND COALESCE(array_length(v_grades, 1), 0) = 0 THEN
        v_grades := ARRAY[7, 8, 9, 10]::SMALLINT[];
    END IF;

    INSERT INTO public.profiles (
        id, first_name, last_name, role, grade_level, assigned_grade_levels
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
        v_role,
        CASE WHEN v_role = 'student'  THEN v_grade  END,
        CASE WHEN v_role = 'educator' THEN v_grades END
    )
    ON CONFLICT (id) DO NOTHING;

    -- Only students have a gamification profile.
    IF v_role = 'student' THEN
        INSERT INTO public.gamification_profiles (student_id)
        VALUES (NEW.id)
        ON CONFLICT (student_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;
