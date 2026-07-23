-- ============================================================================
-- 0017 — Educators choose grade access per material
-- ============================================================================
-- Previously the admin pinned subject AND grade together: educator_assignments
-- held (educator_id, subject_code, grade_level), and
-- enforce_material_publish_scope() rejected any material outside that pairing.
-- An educator assigned "Science, Grade 7" could publish a Science module to
-- Grade 7 and nowhere else — they had no grade choice at all.
--
-- The intended model is simpler: the admin says which SUBJECTS a teacher
-- handles, and the teacher decides, per material, which grade levels may access
-- it. So grade_level leaves educator_assignments and lives only on
-- materials.grade_levels, where the educator controls it.
--
-- That column was doing double duty. Besides publishing rights, it was the sole
-- source for private.auth_assigned_grades(), which three RLS policies use to
-- decide which students an educator may see:
--     profiles         "Educators read students in their assigned grades"
--     bkt_mastery      "Educators read mastery for their assigned grades"
--     bkt_update_logs  "Educators read BKT update logs for their assigned grades"
--
-- Those policies are left untouched. Instead the helper is rewritten to derive
-- the grades from the educator's own published materials, so an educator sees
-- exactly the students who can access their materials — no more, no less. This
-- also brings the helper in line with v_grade_level_mastery, which was already
-- scoped by materials.grade_levels rather than by educator_assignments.
-- ============================================================================

-- 1. educator_assignments becomes subject-only ---------------------------------
-- The primary key covers grade_level, so it has to go first. Dropping the column
-- also drops its CHECK constraint and idx_educator_assignments_grade.

ALTER TABLE educator_assignments DROP CONSTRAINT educator_assignments_pkey;
ALTER TABLE educator_assignments DROP COLUMN grade_level;

-- An educator assigned one subject across several grades now has one duplicate
-- row per grade (the demo instructor has four TLE rows). Collapse to the
-- earliest row per (educator, subject) before the new key can be added.
DELETE FROM educator_assignments a
      USING educator_assignments b
      WHERE a.ctid > b.ctid
        AND a.educator_id  = b.educator_id
        AND a.subject_code = b.subject_code;

ALTER TABLE educator_assignments ADD PRIMARY KEY (educator_id, subject_code);

COMMENT ON TABLE educator_assignments IS
    'Subjects a teacher handles, set by an admin. Grade access is chosen per material by the educator, in materials.grade_levels.';

-- 2. Analytics scope now follows what the educator published --------------------
-- Signature is unchanged, so all three policies keep working untouched.
-- SECURITY DEFINER runs as the table owner, which bypasses RLS on materials, so
-- there is no recursion with the materials policies.

CREATE OR REPLACE FUNCTION private.auth_assigned_grades()
RETURNS SMALLINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT array_agg(DISTINCT g)
      FROM public.materials m
      CROSS JOIN LATERAL unnest(m.grade_levels) g
      JOIN public.profiles p ON p.id = m.educator_id
     WHERE m.educator_id = auth.uid()
       AND NOT m.is_archived
       AND p.status = 'active'
       AND p.role   = 'educator';
$$;

COMMENT ON FUNCTION private.auth_assigned_grades() IS
    'Grade levels the calling educator has published a live material to. NULL when they have none, which correctly shows them no students.';

-- 3. Publish scope checks the subject only ---------------------------------------
-- Still a trigger rather than an RLS WITH CHECK: the Express backend connects
-- with the service role, which bypasses RLS entirely, so a trigger is the only
-- guard that holds for every writer.

CREATE OR REPLACE FUNCTION enforce_material_publish_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM educator_assignments ea
         WHERE ea.educator_id  = NEW.educator_id
           AND ea.subject_code = NEW.subject
    ) THEN
        RAISE EXCEPTION 'Educator % is not assigned to teach subject %',
            NEW.educator_id, NEW.subject
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_material_publish_scope() IS
    'Rejects a material whose subject is not one the educator is assigned to teach. Grade levels are the educator''s choice and are validated by the CHECK on materials.grade_levels.';
