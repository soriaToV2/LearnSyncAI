-- ============================================================================
-- 0013 — Move the RLS helper functions into a non-exposed `private` schema
-- ============================================================================
-- Migration 0012 revoked EXECUTE from PUBLIC, which closed the PostgREST RPC
-- endpoints but also broke RLS: policy expressions ARE evaluated with the
-- caller's privileges, so `permission denied for function auth_grade_level`
-- was raised on every student read of `materials`.
--
-- The correct separation is by schema, not by grant. PostgREST only exposes
-- `public`, so helpers living in `private` are unreachable over the REST API
-- while policies can still call them with EXECUTE granted.
--
-- The three trigger functions stay in `public` with EXECUTE revoked: trigger
-- execution does not re-check the caller's privilege (verified by inserting
-- into auth.users and activity_logs after the revoke).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- USAGE only: no table access is granted through this schema.
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

-- 1. Helpers, relocated ---------------------------------------------------------

CREATE OR REPLACE FUNCTION private.auth_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION private.auth_grade_level()
RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT grade_level FROM public.profiles
     WHERE id = auth.uid() AND status = 'active' AND role = 'student';
$$;

CREATE OR REPLACE FUNCTION private.auth_assigned_grades()
RETURNS SMALLINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT assigned_grade_levels FROM public.profiles
     WHERE id = auth.uid() AND status = 'active' AND role = 'educator';
$$;

CREATE OR REPLACE FUNCTION private.owns_study_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.study_spaces
         WHERE id = p_space_id AND student_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION private.auth_role() IS
    'Role of the calling user, or NULL if unauthenticated or disabled. Lives in `private` so PostgREST cannot expose it as an RPC endpoint.';

GRANT EXECUTE ON FUNCTION private.auth_role()            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.auth_grade_level()     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.auth_assigned_grades() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owns_study_space(UUID) TO anon, authenticated;

-- 2. Repoint every policy that referenced the public helpers ---------------------

DROP POLICY "Educators read students in their assigned grades" ON profiles;
CREATE POLICY "Educators read students in their assigned grades"
    ON profiles FOR SELECT
    USING (role = 'student' AND grade_level = ANY (private.auth_assigned_grades()));

DROP POLICY "Admins manage all profiles" ON profiles;
CREATE POLICY "Admins manage all profiles"
    ON profiles FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');

DROP POLICY "Educators manage their own materials" ON materials;
CREATE POLICY "Educators manage their own materials"
    ON materials FOR ALL
    USING (educator_id = auth.uid() AND private.auth_role() = 'educator')
    WITH CHECK (educator_id = auth.uid() AND private.auth_role() = 'educator');

DROP POLICY "Students read materials published to their grade" ON materials;
CREATE POLICY "Students read materials published to their grade"
    ON materials FOR SELECT
    USING (NOT is_archived AND private.auth_grade_level() = ANY (grade_levels));

DROP POLICY "Admins read all materials" ON materials;
CREATE POLICY "Admins read all materials"
    ON materials FOR SELECT USING (private.auth_role() = 'admin');

DROP POLICY "Students read concepts of accessible materials" ON concepts;
CREATE POLICY "Students read concepts of accessible materials"
    ON concepts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = concepts.material_id
           AND NOT m.is_archived
           AND private.auth_grade_level() = ANY (m.grade_levels)
    ));

DROP POLICY "Students manage materials in their own spaces" ON study_space_materials;
CREATE POLICY "Students manage materials in their own spaces"
    ON study_space_materials FOR ALL
    USING (private.owns_study_space(space_id))
    WITH CHECK (
        private.owns_study_space(space_id)
        AND EXISTS (
            SELECT 1 FROM materials m
             WHERE m.id = study_space_materials.material_id
               AND NOT m.is_archived
               AND private.auth_grade_level() = ANY (m.grade_levels)
        )
    );

DROP POLICY "Students manage their own decks" ON flashcard_decks;
CREATE POLICY "Students manage their own decks"
    ON flashcard_decks FOR ALL
    USING (private.owns_study_space(space_id))
    WITH CHECK (private.owns_study_space(space_id));

DROP POLICY "Students manage their own flashcards" ON flashcards;
CREATE POLICY "Students manage their own flashcards"
    ON flashcards FOR ALL
    USING (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND private.owns_study_space(d.space_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND private.owns_study_space(d.space_id)
    ));

DROP POLICY "Educators read mastery for their assigned grades" ON bkt_mastery;
CREATE POLICY "Educators read mastery for their assigned grades"
    ON bkt_mastery FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_mastery.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (private.auth_assigned_grades())
    ));

DROP POLICY "Educators read BKT update logs for their assigned grades" ON bkt_update_logs;
CREATE POLICY "Educators read BKT update logs for their assigned grades"
    ON bkt_update_logs FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_update_logs.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (private.auth_assigned_grades())
    ));

DROP POLICY "Authenticated users read BKT parameters" ON bkt_parameters;
CREATE POLICY "Authenticated users read BKT parameters"
    ON bkt_parameters FOR SELECT USING (private.auth_role() IS NOT NULL);

DROP POLICY "Admins manage BKT parameters" ON bkt_parameters;
CREATE POLICY "Admins manage BKT parameters"
    ON bkt_parameters FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');

-- 3. Storage policies -------------------------------------------------------------

DROP POLICY "Educators upload their own materials" ON storage.objects;
CREATE POLICY "Educators upload their own materials"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'materials'
        AND private.auth_role() = 'educator'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY "Students read materials for their grade" ON storage.objects;
CREATE POLICY "Students read materials for their grade"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND NOT m.is_archived
               AND private.auth_grade_level() = ANY (m.grade_levels)
        )
    );

-- 4. Retire the public copies -------------------------------------------------------

DROP FUNCTION public.auth_role();
DROP FUNCTION public.auth_grade_level();
DROP FUNCTION public.auth_assigned_grades();
DROP FUNCTION public.owns_study_space(UUID);
