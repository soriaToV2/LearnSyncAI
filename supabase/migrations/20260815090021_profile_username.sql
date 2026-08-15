-- 0021 — profiles.username: the login identifier moves out of auth.users.email
--
-- Sign-in ran on auth.users.email, which on this project held 'student', 'educ1'
-- and 'admin' — usernames squatting in the email column, which left the app no
-- place to store a contactable address. This gives the username its own column
-- and frees auth.users.email to be a real address the user can set and change.
--
-- The backfill copies each account's current login string into username, so every
-- existing credential keeps working unchanged.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;

COMMENT ON COLUMN profiles.username IS
    'Login identifier. POST /api/auth/login resolves it to auth.users.email server-side, so the email is never disclosed to an unauthenticated caller. Unique case-insensitively. NULL means the account cannot sign in.';

-- Backfill BEFORE the unique index: two accounts differing only in case would
-- fail index creation and abort the whole migration, which is the correct loud
-- failure rather than a silently mangled name.
UPDATE profiles p
   SET username = split_part(lower(u.email), '@', 1)
  FROM auth.users u
 WHERE u.id = p.id
   AND p.username IS NULL
   AND u.email IS NOT NULL
   AND split_part(lower(u.email), '@', 1) ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$';

-- Case-insensitive uniqueness. 'Juan' and 'juan' must not be two accounts — an
-- impersonation vector where the username IS the login identifier. A functional
-- index rather than the citext extension, which would be a new extension for one
-- column.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_username_lower
    ON profiles (lower(username));

-- 3–30 chars, lowercase alphanumerics plus dot and underscore, never opening or
-- closing on punctuation. NULL is permitted because handle_new_user() fires on
-- the auth.users INSERT and cannot invent a unique name without a retry loop
-- inside a trigger that must never raise.
ALTER TABLE profiles ADD CONSTRAINT profiles_username_format
    CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$');

-- Accept a username supplied by the admin API in user_metadata. Every failure
-- path degrades to NULL rather than raising: this function's own comment notes
-- that an exception here aborts the auth.users INSERT and surfaces as an opaque
-- Supabase Auth failure.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role     user_role;
    v_grade    SMALLINT;
    v_username TEXT;
BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'student')::user_role;

    IF NULLIF(NEW.raw_user_meta_data ->> 'grade_level', '') IS NOT NULL THEN
        v_grade := (NEW.raw_user_meta_data ->> 'grade_level')::SMALLINT;
    END IF;

    IF v_role = 'student' AND v_grade IS NULL THEN
        v_grade := 7;
    END IF;

    v_username := NULLIF(lower(NEW.raw_user_meta_data ->> 'username'), '');

    IF v_username IS NOT NULL
       AND (v_username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
            OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_username)) THEN
        v_username := NULL;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, role, grade_level, username)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
        v_role,
        CASE WHEN v_role = 'student' THEN v_grade END,
        v_username
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
