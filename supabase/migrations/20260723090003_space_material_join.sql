-- ============================================================================
-- 0003 — Study space <-> material join table; CollabShare removed
-- ============================================================================
-- A student builds a study space by selecting educator-uploaded materials that
-- are published to their grade level. That is a many-to-many relationship: one
-- material feeds many students' spaces, and one space draws on many materials.
--
-- CollabShare (peer-shared / cloned study spaces) appears nowhere in the
-- version-4 documentation and contradicts the stated guarantee that RLS
-- isolates each student's data, so it is removed entirely.
-- ============================================================================

-- 1. Join table ----------------------------------------------------------------

CREATE TABLE study_space_materials (
    space_id    UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES materials(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, material_id)
);

COMMENT ON TABLE study_space_materials IS
    'Educator materials a student has pulled into a study space. Access is still gated by materials.grade_levels.';

CREATE INDEX idx_ssm_material ON study_space_materials (material_id);

-- 2. Preserve the existing 1:N links before dropping the column ----------------

INSERT INTO study_space_materials (space_id, material_id)
SELECT space_id, id
  FROM materials
 WHERE space_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Drop the old policies first -----------------------------------------------
-- Both materials policies read space_id and both peer policies read
-- is_published, so the columns cannot be dropped while they exist.
-- Migration 0008 replaces all of them with the three-role policy set.

DROP POLICY IF EXISTS "Students can manage materials in their own study spaces" ON materials;
DROP POLICY IF EXISTS "Peers can view materials in published study spaces"      ON materials;
DROP POLICY IF EXISTS "Peers can read published study spaces (CollabShare)"     ON study_spaces;
DROP POLICY IF EXISTS "Peers can read published decks"                          ON flashcard_decks;
DROP POLICY IF EXISTS "Peers can read flashcards in published spaces"           ON flashcards;

-- 4. Drop the superseded columns -----------------------------------------------

ALTER TABLE materials DROP COLUMN space_id;

ALTER TABLE study_spaces
    DROP COLUMN is_published,
    DROP COLUMN share_token,
    DROP COLUMN cloned_from_id,
    DROP COLUMN original_author_name;

ALTER TABLE study_spaces
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE study_spaces
    ALTER COLUMN student_id SET NOT NULL;

CREATE INDEX idx_study_spaces_student ON study_spaces (student_id);

CREATE TRIGGER trg_study_spaces_updated_at
    BEFORE UPDATE ON study_spaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
