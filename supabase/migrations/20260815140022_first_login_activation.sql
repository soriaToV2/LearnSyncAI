-- ============================================================================
-- First-login activation
--
-- An account created by an administrator carries a password the administrator
-- chose or read off a screen — and for a bulk import, fifty of them sit in a
-- table that gets copied into a spreadsheet and printed. Until the student
-- replaces it, their teacher can sign in as them. This column is what forces
-- the replacement.
--
-- ⚠️ account_status IS DELIBERATELY NOT GAINING A THIRD VALUE.
-- The admin UI shows "Not activated", but it derives that from
-- (status = 'active' AND must_change_password). Two reasons:
--
--   1. These are independent facts. A student can be created, never sign in,
--      then leave the school and be disabled. One column would overwrite the
--      "never activated" fact and could not restore it on re-enable.
--   2. `status` is the access gate, read in ~19 places — requireRole,
--      POST /api/auth/login, materialAccess.loadCaller, spaceAccess,
--      educatorScope, and private.auth_role() / auth_grade_level() /
--      auth_assigned_grades(), which every RLS policy inherits. A third value
--      means re-auditing all of them, where the failure modes are "legitimate
--      user locked out" and "un-activated user let through".
-- ============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS
    'True while the account still holds a password an administrator set. requireRole refuses every route except GET /api/auth/me and POST /api/auth/change-password until the user replaces it. Cleared by that endpoint; re-armed by admin account creation and admin password reset.';

-- DEFAULT false, so every existing account is unaffected. A default of true here
-- would lock all three live accounts — including the only admin — out of the
-- application on deploy, with the recovery path behind the very gate it armed.

-- ── handle_new_user(): set the flag atomically with the row ─────────────────
--
-- Set here rather than by a follow-up UPDATE from the API, so there is no window
-- in which the account exists without the flag. The read is a COALESCE with a
-- safe default and adds no new failure path: this function must never raise,
-- because an exception aborts the auth.users INSERT and surfaces as an opaque
-- Supabase Auth error.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role       user_role;
    v_grade      SMALLINT;
    v_username   TEXT;
    v_must_change BOOLEAN;
BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'student')::user_role;

    IF NULLIF(NEW.raw_user_meta_data ->> 'grade_level', '') IS NOT NULL THEN
        v_grade := (NEW.raw_user_meta_data ->> 'grade_level')::SMALLINT;
    END IF;

    IF v_role = 'student' AND v_grade IS NULL THEN
        v_grade := 7;
    END IF;

    -- A malformed or already-taken username degrades to NULL rather than raising,
    -- for the same reason the defaults above do: an exception here aborts the
    -- auth.users INSERT. The account is then created without a login identifier,
    -- which an admin fixes, instead of not being created at all.
    v_username := NULLIF(lower(NEW.raw_user_meta_data ->> 'username'), '');

    IF v_username IS NOT NULL
       AND (v_username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
            OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_username)) THEN
        v_username := NULL;
    END IF;

    -- Anything unparseable degrades to false — an account that is usable but was
    -- not forced to re-key is a lesser failure than one nobody can activate.
    BEGIN
        v_must_change := COALESCE(
            (NULLIF(NEW.raw_user_meta_data ->> 'must_change_password', ''))::BOOLEAN,
            false
        );
    EXCEPTION WHEN others THEN
        v_must_change := false;
    END;

    INSERT INTO public.profiles (
        id, first_name, last_name, role, grade_level, username, must_change_password
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
        v_role,
        CASE WHEN v_role = 'student' THEN v_grade END,
        v_username,
        v_must_change
    )
    ON CONFLICT (id) DO NOTHING;

    -- Only students have a gamification profile.
    IF v_role = 'student' THEN
        INSERT INTO public.gamification_profiles (student_id)
        VALUES (NEW.id)
        ON CONFLICT (student_id) DO NOTHING;
    END IF;

    -- Educators need no further setup: subject and grade access are chosen per
    -- material at upload time, so a new account can publish immediately.
    RETURN NEW;
END;
$$;
