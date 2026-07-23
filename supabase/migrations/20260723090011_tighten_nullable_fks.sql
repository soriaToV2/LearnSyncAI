-- ============================================================================
-- 0011 — Tighten foreign keys that were nullable but never optional
-- ============================================================================
-- A concept with no material, a deck with no study space or a practice test
-- with no student are all meaningless rows that the old schema permitted.
-- Verified beforehand that none of these columns contains a NULL.
--
-- Columns deliberately left nullable because they are genuinely optional:
--   cognitive_logs.concept_id       - whole-material evaluations name no concept
--   game_sessions.material_id       - a game may be generated from several materials
--   flashcards.concept_id           - hand-written cards assess no stored concept
--   bkt_update_logs.flashcard_id / practice_test_id - exactly one is set per row
-- ============================================================================

ALTER TABLE concepts               ALTER COLUMN material_id      SET NOT NULL;

ALTER TABLE flashcard_decks        ALTER COLUMN space_id         SET NOT NULL;
ALTER TABLE flashcards             ALTER COLUMN deck_id          SET NOT NULL;

ALTER TABLE spaced_repetition_logs ALTER COLUMN student_id       SET NOT NULL,
                                   ALTER COLUMN flashcard_id     SET NOT NULL;

ALTER TABLE cognitive_logs         ALTER COLUMN space_id         SET NOT NULL;

ALTER TABLE chatbot_logs           ALTER COLUMN student_id       SET NOT NULL,
                                   ALTER COLUMN space_id         SET NOT NULL;

ALTER TABLE practice_tests         ALTER COLUMN student_id       SET NOT NULL,
                                   ALTER COLUMN space_id         SET NOT NULL;

ALTER TABLE practice_telemetry     ALTER COLUMN student_id       SET NOT NULL,
                                   ALTER COLUMN concept_id       SET NOT NULL,
                                   ALTER COLUMN practice_test_id SET NOT NULL;

ALTER TABLE user_badges            ALTER COLUMN student_id       SET NOT NULL;

-- Telemetry is only meaningful with the format that produced it, since the
-- format selects the P(G) used by the BKT update.
UPDATE practice_telemetry SET question_type = 'multiple_choice' WHERE question_type IS NULL;
ALTER TABLE practice_telemetry     ALTER COLUMN question_type    SET NOT NULL;
