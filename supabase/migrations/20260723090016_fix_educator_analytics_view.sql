-- ============================================================================
-- 0016 — Make the educator analytics view actually readable by educators
-- ============================================================================
-- v_grade_level_mastery was built on v_student_material_mastery, which joins
-- study_space_materials and study_spaces. Educators have no SELECT policy on
-- either (by design — a student's study spaces are private), so under
-- security_invoker the view returned zero rows for every educator. Verified:
-- an educator could read 20 bkt_mastery rows but got 0 rows from the view.
--
-- The educator question is "how are the students in my grades doing on the
-- materials I published?", which does not involve study spaces at all. The view
-- is rebuilt directly over materials -> concepts -> students, so ordinary RLS
-- scopes it correctly:
--   materials   -> the educator's own
--   concepts    -> concepts of those materials
--   profiles    -> students in their assigned grades
--   bkt_mastery -> those same students
--
-- v_student_material_mastery is unchanged; it still drives the student
-- dashboard, where the study-space join is the correct scoping.
-- ============================================================================

DROP VIEW v_grade_level_mastery;

CREATE VIEW v_grade_level_mastery
WITH (security_invoker = on) AS
SELECT
    m.educator_id,
    m.id     AS material_id,
    m.title  AS material_title,
    m.subject,
    p.grade_level,
    p.id     AS student_id,
    p.first_name,
    p.last_name,
    count(c.id)                                                        AS concept_count,
    count(bm.concept_id)                                               AS assessed_concept_count,
    round(avg(COALESCE(bm.latent_mastery, 0.10)), 4)                   AS m_doc,
    mastery_tier(round(avg(COALESCE(bm.latent_mastery, 0.10)), 4))     AS tier,
    count(*) FILTER (WHERE COALESCE(bm.latent_mastery, 0.10) >= 0.85)  AS mastered_concept_count,
    max(bm.last_updated)                                               AS last_updated
FROM materials m
JOIN concepts c  ON c.material_id = m.id
JOIN profiles p  ON p.role = 'student'
                AND p.grade_level = ANY (m.grade_levels)
LEFT JOIN bkt_mastery bm
       ON bm.concept_id = c.id
      AND bm.student_id = p.id
WHERE NOT m.is_archived
GROUP BY m.educator_id, m.id, m.title, m.subject,
         p.grade_level, p.id, p.first_name, p.last_name;

COMMENT ON VIEW v_grade_level_mastery IS
    'Educator analytics: M_doc for every student in the educator''s grades against each material they published. Scoped by RLS, not by study space.';
