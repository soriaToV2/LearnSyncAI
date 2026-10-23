-- ============================================================
-- 0030 · Record a test answer in one statement
-- ============================================================
--
-- PUT /api/practice/:id/answer read the whole student_answers JSONB, added one
-- key in JavaScript and wrote the whole object back. Two saves in flight at
-- once each wrote their own copy, so the last writer won and the other answer
-- vanished — graded as unanswered at completion and fed to BKT as an incorrect
-- observation. A matching block is one screen whose four answers the client
-- saved with Promise.all, so every matching block raced (QA defect D21-race).
--
-- ══ DATA ══
-- Measured 2026-10-23 on production: 29 of 190 completed matching blocks are
-- missing answers — up to 47 answers in 21 tests across 10 implementation-week
-- students (an upper bound: a student may also have left a term unplaced).
-- scripts/test-answer-race-verify.ts reproduced it against the live route:
-- four simultaneous saves kept 2, 2 and 1.
--
-- ══ GUARANTEE ══
-- One UPDATE merges the key with ||, so Postgres row-locks the test and a
-- concurrent save re-reads the committed row before adding its own key; nothing
-- is lost however many arrive at once. Latency accumulates exactly as the route
-- did (previous + latency_ms). status <> 'completed' is inside the UPDATE, so an
-- answer can no longer land after completion either; the route answers 409 when
-- it returns NULL. The client now also saves one at a time; this is the guarantee.
--
-- ══ SECURITY ══
-- p_student_id is a parameter, so EXECUTE is revoked from PUBLIC, anon and
-- authenticated: callable by the service role (Express) only, otherwise any
-- signed-in student could write answers into another student's test.
-- ============================================================

CREATE OR REPLACE FUNCTION record_test_answer(
    p_test_id    UUID,
    p_student_id UUID,
    p_index      INT,
    p_answer     TEXT,
    p_latency_ms BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE practice_tests
       SET student_answers = COALESCE(student_answers, '{}'::jsonb) || jsonb_build_object(
               p_index::text, jsonb_build_object(
                   'answer',     p_answer,
                   'latency_ms', COALESCE((student_answers -> (p_index::text) ->> 'latency_ms')::bigint, 0) + p_latency_ms))
     WHERE id = p_test_id
       AND student_id = p_student_id
       AND status <> 'completed'
    RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION record_test_answer(UUID, UUID, INT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_test_answer(UUID, UUID, INT, TEXT, BIGINT) TO service_role;
