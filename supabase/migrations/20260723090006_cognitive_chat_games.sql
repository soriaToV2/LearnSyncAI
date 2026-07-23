-- ============================================================================
-- 0006 — Cognitive review, chatbot and game tables aligned to the v4 spec
-- ============================================================================
--   * cognitive_logs gains a direct student_id (it previously reached the
--     student only through space_id, forcing a subquery in every RLS policy
--     and every educator-analytics read) and the material set it was graded on
--   * cognitive_logs.mode becomes an enum instead of free text
--   * chatbot_logs records which materials and which retrieval mode were used
--   * game tables record the M_doc snapshot used to calibrate difficulty
--   * game_type drops the two deprecated values
-- ============================================================================

-- 1. Cognitive logs --------------------------------------------------------------

CREATE TYPE cognitive_mode AS ENUM ('free_recall', 'feynman');

ALTER TABLE cognitive_logs
    ADD COLUMN student_id   UUID,
    ADD COLUMN material_ids UUID[];

UPDATE cognitive_logs cl
   SET student_id = s.student_id
  FROM study_spaces s
 WHERE s.id = cl.space_id
   AND cl.student_id IS NULL;

-- Any log whose study space has since been deleted cannot be attributed.
DELETE FROM cognitive_logs WHERE student_id IS NULL;

ALTER TABLE cognitive_logs
    ALTER COLUMN student_id SET NOT NULL,
    ADD CONSTRAINT cognitive_logs_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ALTER COLUMN mode TYPE cognitive_mode USING mode::cognitive_mode,
    ADD CONSTRAINT cognitive_logs_similarity_range
        CHECK (similarity_score IS NULL
               OR (similarity_score >= 0 AND similarity_score <= 1));

COMMENT ON COLUMN cognitive_logs.material_ids IS
    'Materials the submission was evaluated against. Free Recall and Feynman can span several.';
COMMENT ON COLUMN cognitive_logs.similarity_score IS
    'Free Recall coverage ratio: coveredConcepts / totalConcepts, where a concept counts as covered at >= 0.70 cosine similarity.';
COMMENT ON COLUMN cognitive_logs.ai_feedback IS
    'JSON string (not jsonb) - the frontend parses it with JSON.parse per the documented convention.';

CREATE INDEX idx_cognitive_logs_student ON cognitive_logs (student_id, created_at DESC);

-- 2. Chatbot logs ------------------------------------------------------------------

ALTER TABLE chatbot_logs
    ADD COLUMN material_ids UUID[],
    ADD COLUMN mode         TEXT CHECK (mode IN ('rag', 'full'));

COMMENT ON COLUMN chatbot_logs.mode IS
    'rag = pgvector similarity retrieval; full = all concepts of a single material injected as context.';

-- 3. Game type: drop the deprecated values -----------------------------------------
-- No rows use trivia_blast or boggle, so the rebuild is a pure type swap.

CREATE TYPE game_type_new AS ENUM ('term_matcher', 'crossword', 'timed_trivia');

ALTER TABLE game_sessions
    ALTER COLUMN game_type TYPE game_type_new USING game_type::text::game_type_new;

ALTER TABLE game_content ALTER COLUMN game_type DROP DEFAULT;
ALTER TABLE game_content
    ALTER COLUMN game_type TYPE game_type_new USING game_type::text::game_type_new;

DROP TYPE game_type;
ALTER TYPE game_type_new RENAME TO game_type;

-- 4. Games record the mastery that calibrated them ----------------------------------

ALTER TABLE game_sessions
    ALTER COLUMN student_id SET NOT NULL,
    ADD COLUMN space_id         UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    ADD COLUMN mastery_snapshot NUMERIC
        CHECK (mastery_snapshot IS NULL OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1)),
    ADD CONSTRAINT game_sessions_accuracy_range
        CHECK (accuracy IS NULL OR (accuracy >= 0 AND accuracy <= 1));

ALTER TABLE game_content
    ALTER COLUMN student_id SET NOT NULL,
    ADD COLUMN mastery_snapshot NUMERIC
        CHECK (mastery_snapshot IS NULL OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1));

COMMENT ON COLUMN game_sessions.mastery_snapshot IS
    'M_doc at session start. Recorded for the Difficulty Alignment check; games never write back to bkt_mastery.';
COMMENT ON COLUMN game_content.mastery_snapshot IS
    'M_doc passed to the generation prompt. Games personalise from mastery but never modify it.';

CREATE INDEX idx_game_sessions_student ON game_sessions (student_id, completed_at DESC);

-- 5. Only students have a gamification profile ---------------------------------------
-- The old signup trigger created one for every account, including the educator.

DELETE FROM gamification_profiles
 WHERE student_id IN (SELECT id FROM profiles WHERE role <> 'student');

-- 6. Concepts: index the parent lookup and the material lookup ------------------------

CREATE INDEX IF NOT EXISTS idx_concepts_material ON concepts (material_id);
CREATE INDEX IF NOT EXISTS idx_concepts_parent   ON concepts (parent_concept_id);

-- 7. Drop dead code -------------------------------------------------------------------
-- evaluate_recall() is unreferenced by the application and ordered its results
-- by ascending similarity (least similar first). Free Recall scoring is done in
-- the backend with the coverage-ratio method instead.

DROP FUNCTION IF EXISTS evaluate_recall(vector, uuid[]);
