-- ============================================================================
-- 0014 — Controlled subject list
-- ============================================================================
-- `materials.subject` was free text, so 'Science' / 'science' / 'Sci' would
-- fragment any subject-level grouping on the educator dashboard. It also has to
-- be reliable, because migration 0015 keys publishing rights on
-- (educator, subject, grade).
--
-- Seeded with the DepEd Junior High School core subjects plus Christian Living,
-- which Pasig Christian Academy teaches. Adjust the seed rows to match the
-- school's actual offering.
-- ============================================================================

CREATE TABLE subjects (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE subjects IS
    'Controlled list of JHS subjects. Referenced by materials.subject and educator_assignments.subject_code.';

INSERT INTO subjects (code, name, sort_order) VALUES
    ('FIL',   'Filipino',                                 1),
    ('ENG',   'English',                                  2),
    ('MATH',  'Mathematics',                              3),
    ('SCI',   'Science',                                  4),
    ('AP',    'Araling Panlipunan',                       5),
    ('ESP',   'Edukasyon sa Pagpapakatao',                6),
    ('TLE',   'Technology and Livelihood Education',      7),
    ('MAPEH', 'Music, Arts, Physical Education and Health', 8),
    ('CL',    'Christian Living',                         9);

-- Existing dev materials predate the subject column and are all NULL.
-- Both are information-security modules, which sit under TLE/ICT in the JHS
-- curriculum. Correct these by hand if the real subject differs.
UPDATE materials SET subject = 'TLE' WHERE subject IS NULL;

ALTER TABLE materials
    ALTER COLUMN subject SET NOT NULL,
    ADD CONSTRAINT materials_subject_fkey
        FOREIGN KEY (subject) REFERENCES subjects(code) ON DELETE RESTRICT;

COMMENT ON COLUMN materials.subject IS
    'Subject this material belongs to. Together with grade_levels it must match one of the educator''s assignments.';

CREATE INDEX idx_materials_subject ON materials (subject);

-- Reference data: readable by any signed-in user, managed by admins.
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read subjects"
    ON subjects FOR SELECT USING (private.auth_role() IS NOT NULL);

CREATE POLICY "Admins manage subjects"
    ON subjects FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');
