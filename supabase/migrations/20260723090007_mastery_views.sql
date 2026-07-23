-- ============================================================================
-- 0007 — Document mastery aggregation and the dashboard views built on it
-- ============================================================================
-- EQ(4) from the documentation:  M_doc = SUM(P(L_current, i)) / N
--
-- M_doc drives three things: the student's progress bar, the difficulty
-- parameter passed to game generation, and the educator's grade-level
-- analytics table.
--
-- Both views are declared security_invoker so the querying role's RLS applies.
-- A default (security definer) view would run as its owner and leak every
-- student's mastery to anyone able to select from it.
-- ============================================================================

-- 1. Per-document mastery, EQ(4) --------------------------------------------------

CREATE OR REPLACE FUNCTION document_mastery(p_student_id UUID, p_material_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(avg(COALESCE(bm.latent_mastery, 0.10)), 0.10)
      FROM concepts c
      LEFT JOIN bkt_mastery bm
             ON bm.concept_id = c.id
            AND bm.student_id = p_student_id
     WHERE c.material_id = p_material_id;
$$;

COMMENT ON FUNCTION document_mastery(UUID, UUID) IS
    'EQ(4): arithmetic mean of per-concept BKT probabilities for one document. Unassessed concepts count as the P(L0) prior of 0.10.';

-- 2. Difficulty tier, from the documented thresholds --------------------------------

CREATE OR REPLACE FUNCTION mastery_tier(p_mastery NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
             WHEN p_mastery IS NULL   THEN 'foundational'
             WHEN p_mastery >= 0.85   THEN 'advanced'
             WHEN p_mastery >= 0.50   THEN 'intermediate'
             ELSE                          'foundational'
           END;
$$;

COMMENT ON FUNCTION mastery_tier(NUMERIC) IS
    'Adaptive test / game difficulty tier: < 0.50 foundational, 0.50-0.85 intermediate, >= 0.85 advanced.';

-- 3. Student-facing mastery per material --------------------------------------------

CREATE VIEW v_student_material_mastery
WITH (security_invoker = on) AS
SELECT
    ss.student_id,
    ssm.material_id,
    count(c.id)                                                        AS concept_count,
    count(bm.concept_id)                                               AS assessed_concept_count,
    round(avg(COALESCE(bm.latent_mastery, 0.10)), 4)                   AS m_doc,
    mastery_tier(round(avg(COALESCE(bm.latent_mastery, 0.10)), 4))     AS tier,
    count(*) FILTER (WHERE COALESCE(bm.latent_mastery, 0.10) >= 0.85)  AS mastered_concept_count,
    max(bm.last_updated)                                               AS last_updated
FROM study_space_materials ssm
JOIN study_spaces ss  ON ss.id = ssm.space_id
JOIN concepts c       ON c.material_id = ssm.material_id
LEFT JOIN bkt_mastery bm
       ON bm.concept_id = c.id
      AND bm.student_id = ss.student_id
GROUP BY ss.student_id, ssm.material_id;

COMMENT ON VIEW v_student_material_mastery IS
    'M_doc per student per material, deduplicated across study spaces. Backs the dashboard progress bar and game calibration.';

-- 4. Educator-facing grade-level analytics ------------------------------------------

CREATE VIEW v_grade_level_mastery
WITH (security_invoker = on) AS
SELECT
    m.educator_id,
    p.grade_level,
    p.id           AS student_id,
    p.first_name,
    p.last_name,
    m.id           AS material_id,
    m.title        AS material_title,
    m.subject,
    v.concept_count,
    v.assessed_concept_count,
    v.m_doc,
    v.tier,
    v.mastered_concept_count,
    v.last_updated
FROM v_student_material_mastery v
JOIN profiles  p ON p.id = v.student_id AND p.role = 'student'
JOIN materials m ON m.id = v.material_id;

COMMENT ON VIEW v_grade_level_mastery IS
    'Educator analytics feed: every monitored student''s M_doc per material, with grade level for grade-scoped filtering.';

-- 5. Remaining foreign-key indexes ---------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_practice_tests_student ON practice_tests (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_tests_space   ON practice_tests (space_id);
CREATE INDEX IF NOT EXISTS idx_game_content_space     ON game_content (space_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_material ON game_sessions (material_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_student    ON user_badges (student_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_material    ON flashcards (source_material_id);
CREATE INDEX IF NOT EXISTS idx_srl_concept            ON spaced_repetition_logs (concept_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_space    ON activity_logs (space_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_material ON activity_logs (material_id);
CREATE INDEX IF NOT EXISTS idx_bkt_update_logs_test   ON bkt_update_logs (practice_test_id);
CREATE INDEX IF NOT EXISTS idx_bkt_update_logs_card   ON bkt_update_logs (flashcard_id);
