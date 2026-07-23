-- ============================================================================
-- 0015 — Educator teaching assignments (subject x grade)
-- ============================================================================
-- A PCA teacher can hold different subjects at different grade levels, e.g.
-- Science in Grade 7 and Filipino in Grade 10. The flat
-- profiles.assigned_grade_levels array could only say "this teacher is
-- associated with grades 7 and 10" — it could not say which subject at which
-- grade, and nothing stopped a teacher assigned to grade 7 publishing to
-- grade 9 (verified before this migration).
--
-- educator_assignments becomes the single source of truth. The flat array is
-- dropped and private.auth_assigned_grades() now derives from this table, so
-- the two can never drift apart.
-- ============================================================================

CREATE TABLE educator_assignments (
    educator_id  UUID     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    subject_code TEXT     NOT NULL REFERENCES subjects(code) ON DELETE RESTRICT,
    grade_level  SMALLINT NOT NULL CHECK (grade_level BETWEEN 7 AND 10),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (educator_id, subject_code, grade_level)
);

COMMENT ON TABLE educator_assignments IS
    'One row per subject/grade a teacher handles. Example: (teacher_a, SCI, 7) and (teacher_a, FIL, 10). Governs both publishing rights and analytics scope.';

CREATE INDEX idx_educator_assignments_grade   ON educator_assignments (grade_level);
CREATE INDEX idx_educator_assignments_subject ON educator_assignments (subject_code);

-- 1. Backfill from what each educator has already published -----------------------
-- Deriving from existing materials guarantees every current material stays valid
-- under the enforcement trigger added below. Educators with no materials yet get
-- no assignments and cannot publish until an admin assigns them.

INSERT INTO educator_assignments (educator_id, subject_code, grade_level)
SELECT DISTINCT m.educator_id, m.subject, g
  FROM materials m
  CROSS JOIN LATERAL unnest(m.grade_levels) g
ON CONFLICT DO NOTHING;

-- 2. Derive assigned grades from the new table -------------------------------------
-- Signature is unchanged, so every policy that calls it keeps working.

CREATE OR REPLACE FUNCTION private.auth_assigned_grades()
RETURNS SMALLINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT array_agg(DISTINCT ea.grade_level)
      FROM public.educator_assignments ea
      JOIN public.profiles p ON p.id = ea.educator_id
     WHERE ea.educator_id = auth.uid()
       AND p.status = 'active'
       AND p.role   = 'educator';
$$;

COMMENT ON FUNCTION private.auth_assigned_grades() IS
    'Distinct grade levels the calling educator teaches, derived from educator_assignments. NULL when they have none.';

-- 3. Rewrite the two functions that touched the old column ---------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role  user_role;
    v_grade SMALLINT;
BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'student')::user_role;

    IF NULLIF(NEW.raw_user_meta_data ->> 'grade_level', '') IS NOT NULL THEN
        v_grade := (NEW.raw_user_meta_data ->> 'grade_level')::SMALLINT;
    END IF;

    IF v_role = 'student' AND v_grade IS NULL THEN
        v_grade := 7;
    END IF;

    INSERT INTO public.profiles (id, first_name, last_name, role, grade_level)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
        v_role,
        CASE WHEN v_role = 'student' THEN v_grade END
    )
    ON CONFLICT (id) DO NOTHING;

    -- Only students have a gamification profile.
    IF v_role = 'student' THEN
        INSERT INTO public.gamification_profiles (student_id)
        VALUES (NEW.id)
        ON CONFLICT (student_id) DO NOTHING;
    END IF;

    -- Educator teaching load is assigned separately by an admin, since the
    -- subject/grade pairs are not known at account-creation time.
    RETURN NEW;
END;
$$;

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

    IF NEW.role        IS DISTINCT FROM OLD.role
    OR NEW.status      IS DISTINCT FROM OLD.status
    OR NEW.grade_level IS DISTINCT FROM OLD.grade_level THEN
        RAISE EXCEPTION
            'Only an administrator can change role, account status or grade level';
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Retire the flat array ------------------------------------------------------------
-- Its CHECK constraint and GIN index are dropped along with the column.

ALTER TABLE profiles DROP COLUMN assigned_grade_levels;

-- 5. Publishing scope enforcement ------------------------------------------------------
-- Implemented as a trigger rather than an RLS WITH CHECK because the Express
-- backend connects with the service role, which bypasses RLS entirely. A trigger
-- holds for every writer and gives a precise error naming the missing grades.

CREATE OR REPLACE FUNCTION enforce_material_publish_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_missing SMALLINT[];
BEGIN
    SELECT array_agg(g ORDER BY g)
      INTO v_missing
      FROM unnest(NEW.grade_levels) g
     WHERE NOT EXISTS (
        SELECT 1 FROM educator_assignments ea
         WHERE ea.educator_id  = NEW.educator_id
           AND ea.subject_code = NEW.subject
           AND ea.grade_level  = g
     );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Educator % is not assigned to teach subject % in grade(s) %',
            NEW.educator_id, NEW.subject, v_missing
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_material_publish_scope() IS
    'Rejects a material whose subject/grade_levels are not fully covered by the educator''s rows in educator_assignments.';

CREATE TRIGGER trg_materials_publish_scope
    BEFORE INSERT OR UPDATE OF educator_id, subject, grade_levels ON materials
    FOR EACH ROW EXECUTE FUNCTION enforce_material_publish_scope();

-- 6. RLS on the new table ----------------------------------------------------------------

ALTER TABLE educator_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Educators read their own assignments"
    ON educator_assignments FOR SELECT USING (educator_id = auth.uid());

CREATE POLICY "Admins manage educator assignments"
    ON educator_assignments FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');
