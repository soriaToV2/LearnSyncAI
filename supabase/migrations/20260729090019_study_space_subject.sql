-- ============================================================================
-- 0019 — A study space covers exactly one subject
-- ============================================================================
-- Migration 0003 established that "a student builds a study space by selecting
-- educator-uploaded materials that are published to their grade level", but left
-- the selection entirely manual. The paper's Material Ingestion and Distribution
-- Core says the platform "makes the processed content available to students
-- within the educator's selected grade level" — the student should not have to
-- go looking.
--
-- Grade level alone is too coarse: a Grade 8 student's every subject would land
-- in every space. Pinning each space to one subject makes the space's contents
-- derivable — every non-archived material published to (this subject, this
-- student's grade) — which is what lets a new space arrive pre-filled and lets
-- the Resources tab count materials the student does not have yet.
--
-- The subject is fixed at creation. Everything downstream of a space (flashcard
-- decks, practice tests, mastery) is built from its materials, so re-pointing a
-- space at a different subject would strand that work.
-- ============================================================================

ALTER TABLE study_spaces ADD COLUMN subject TEXT;

-- Dev-era spaces predate the column. 0014 used TLE for the same reason when
-- materials.subject was introduced; adjust by hand if the real subject differs.
UPDATE study_spaces SET subject = 'TLE' WHERE subject IS NULL;

ALTER TABLE study_spaces
    ALTER COLUMN subject SET NOT NULL,
    ADD CONSTRAINT study_spaces_subject_fkey
        FOREIGN KEY (subject) REFERENCES subjects(code) ON DELETE RESTRICT;

COMMENT ON COLUMN study_spaces.subject IS
    'Subject this space covers, from the subjects catalogue. Fixed at creation — the space''s materials are derived from it.';

CREATE INDEX idx_study_spaces_subject ON study_spaces (subject);

-- No new RLS policy: "Students manage their own study spaces" is FOR ALL on the
-- row, so the new column is already covered.
