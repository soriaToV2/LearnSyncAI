-- ============================================================================
-- 0024 — Pre-test / post-test: the study's measurement instrument
--
-- The paper's RQ4 (p. 55) asks how significant the difference is between a
-- student's standard pre-test score and their post-test score, and p. 103 names
-- the system-generated pre/post tests as the PRIMARY evaluation instrument.
-- Nothing in the codebase implemented any of it.
--
-- THIS IS A TEMPORARY RESEARCH INSTRUMENT. It is removed after the school
-- study. Everything it adds is confined to the two tables and one enum below,
-- so removal is one DROP. Nothing here feeds BKT, telemetry or gamification:
-- bkt_source stays a two-value enum and activity_type gains no value, because
-- paper p. 58 limits mastery writers to Adaptive Flashcards and Adaptive Test
-- Mode, and a pre-test that moved mastery would corrupt the baseline it exists
-- to measure.
--
-- Both forms live on ONE row. The pre-test and the post-test ask about the same
-- 20 concepts with the same answers and the same four options; only the sentence
-- and the option order differ. That is a parallel form (paper p. 103's own
-- wording), and holding both stems on one item is what makes it structural
-- rather than two generations that have to be hoped into alignment.
--
-- SAFE TO RE-RUN. Every statement below is guarded, because this migration is
-- applied by hand in the Supabase SQL editor (there is no runner in this repo)
-- and a paste that fails halfway must be fixable by pasting it again rather than
-- by working out which half already landed. Postgres has no
-- CREATE POLICY IF NOT EXISTS, hence the DROP POLICY IF EXISTS before each one.
-- ============================================================================

-- 1. Phase enum ---------------------------------------------------------------
--
-- No `assessment_status`: generation is synchronous (one Gemini call, measured at
-- 36.1s), so a row exists only on success. A status column would exist solely to
-- record a state no reader can ever observe, and would strand rows on `processing`
-- when the server restarts mid-job -- the known defect in materials.parsed_status.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_phase') THEN
        CREATE TYPE assessment_phase AS ENUM ('pre', 'post');
    END IF;
END $$;


-- 2. material_assessments -----------------------------------------------------

CREATE TABLE IF NOT EXISTS material_assessments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id      UUID NOT NULL UNIQUE REFERENCES materials(id) ON DELETE CASCADE,
    created_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    items            JSONB    NOT NULL,
    item_count       SMALLINT NOT NULL,
    pre_released_at  TIMESTAMPTZ,
    post_released_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT material_assessments_item_count_valid
        CHECK (item_count BETWEEN 5 AND 20),
    -- The post-test cannot be released before the pre-test. Releasing it first
    -- would gate every student who had not yet sat the pre-test onto a phase
    -- they can reach, while the pre-test they still owe becomes unreachable.
    CONSTRAINT material_assessments_release_order
        CHECK (post_released_at IS NULL OR pre_released_at IS NOT NULL)
);

COMMENT ON TABLE material_assessments IS
    'TEMPORARY (research instrument). One pre/post test set per material. Removed after the study.';
COMMENT ON COLUMN material_assessments.material_id IS
    'UNIQUE: exactly one pre/post set per material, holding BOTH forms.';
COMMENT ON COLUMN material_assessments.created_by IS
    'Educator who generated the set. RESTRICT, matching materials.educator_id.';
COMMENT ON COLUMN material_assessments.items IS
    'HOLDS THE ANSWER KEY. { version, items: [{ index, concept_id, concept_term, pre_stem, post_stem, options_pre[], options_post[], answer }] }. Never serialised to a student except through stripAssessmentKey().';
COMMENT ON COLUMN material_assessments.pre_released_at IS
    'Set when the educator releases the pre-test to students; NULL un-releases it. Un-releasing destroys no attempts.';

CREATE INDEX IF NOT EXISTS idx_material_assessments_material ON material_assessments (material_id);
CREATE INDEX IF NOT EXISTS idx_material_assessments_creator  ON material_assessments (created_by);

DROP TRIGGER IF EXISTS trg_material_assessments_updated_at ON material_assessments;
CREATE TRIGGER trg_material_assessments_updated_at
    BEFORE UPDATE ON material_assessments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 3. assessment_attempts ------------------------------------------------------
--
-- No space_id. The assessment measures the MATERIAL, and a student may hold two
-- study spaces of the same subject; keying the attempt on a space would make
-- "have they sat the pre-test?" depend on where they happened to sit it.

CREATE TABLE IF NOT EXISTS assessment_attempts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES material_assessments(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phase         assessment_phase NOT NULL,
    answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
    score         NUMERIC,
    correct_count SMALLINT,
    status        practice_status NOT NULL DEFAULT 'in_progress',
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,

    CONSTRAINT assessment_attempts_score_range
        CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
    -- ONE ATTEMPT PER PHASE. No retakes: a second sitting of the same paper is
    -- not a second measurement.
    CONSTRAINT assessment_attempts_one_per_phase
        UNIQUE (assessment_id, student_id, phase)
);

COMMENT ON TABLE assessment_attempts IS
    'TEMPORARY (research instrument). One student sitting of one phase. Removed after the study.';
COMMENT ON COLUMN assessment_attempts.answers IS
    'Keyed by item index as a string: { "0": { answer, latency_ms } }. Mirrors practice_tests.student_answers.';
COMMENT ON COLUMN assessment_attempts.status IS
    'Reuses practice_status. A material stays locked until the gating phase has a COMPLETED attempt.';

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student    ON assessment_attempts (student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment ON assessment_attempts (assessment_id, phase);


-- 4. Row-level security -------------------------------------------------------
--
-- DELIBERATELY UNLIKE practice_tests, which is FOR ALL USING (student_id =
-- auth.uid()) and therefore already lets a student read their own
-- questions_payload -- answer key included -- with the anon key.
--
-- material_assessments has NO student policy at all. It carries no student_id,
-- so any "students read assessments for their grade" policy would hand the whole
-- answer key to every student in the grade, permanently, BEFORE either test.
-- Express reads it with the service role, so students lose nothing.

ALTER TABLE material_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_attempts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Educators manage assessments for their own materials" ON material_assessments;
CREATE POLICY "Educators manage assessments for their own materials"
    ON material_assessments FOR ALL
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = material_assessments.material_id
           AND m.educator_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = material_assessments.material_id
           AND m.educator_id = auth.uid()
    ));

-- Read-only for students, following the activity_logs / gamification_profiles
-- precedent: `answers` and `score` ARE the study's measurement, so they must not
-- be student-writable. The API writes them with the service role.
DROP POLICY IF EXISTS "Students read their own assessment attempts" ON assessment_attempts;
CREATE POLICY "Students read their own assessment attempts"
    ON assessment_attempts FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Educators read attempts for their assigned grades" ON assessment_attempts;
CREATE POLICY "Educators read attempts for their assigned grades"
    ON assessment_attempts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = assessment_attempts.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (private.auth_assigned_grades())
    ));
