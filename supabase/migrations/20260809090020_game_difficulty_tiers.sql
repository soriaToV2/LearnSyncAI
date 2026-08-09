-- Games calibrate their difficulty from document mastery (paper p. 83), so
-- game_content.difficulty now holds the same three tiers as
-- practice_tests.difficulty_tier and mastery_tier() — the vocabulary the paper's
-- Difficulty Alignment check (p. 98) is stated in: foundational (< 0.50),
-- intermediate (0.50–0.85), advanced (>= 0.85).
--
-- Every column the feature actually WRITES already existed and was unused
-- (game_content.mastery_snapshot, game_sessions.mastery_snapshot,
-- game_sessions.space_id), so nothing here is required to make it work. This
-- migration closes failure modes instead.

-- ── 1. Retire the client-chosen easy|medium|hard vocabulary ──────────────────
--
-- Legacy rows keep mastery_snapshot IS NULL, and that NULL — not this mapped
-- value — is what distinguishes "generated before calibration existed" from
-- "calibrated". The audit query filters on it, so the mapping below never has to
-- be trusted; it exists only so the CHECK can be added.
UPDATE game_content
   SET difficulty = CASE difficulty
                      WHEN 'easy'   THEN 'foundational'
                      WHEN 'medium' THEN 'intermediate'
                      WHEN 'hard'   THEN 'advanced'
                      ELSE difficulty
                    END
 WHERE difficulty IN ('easy', 'medium', 'hard');

-- ── 2. Constrain it ─────────────────────────────────────────────────────────
--
-- Dropping the DEFAULT is the point of this step. NOT NULL DEFAULT 'medium' meant
-- an insert that forgot the column wrote a plausible-looking value instead of
-- failing — the same shape as the practice_telemetry insert that omitted a
-- NOT NULL column and therefore never once succeeded while looking fine. Without
-- a default, that becomes a loud NOT NULL violation.
ALTER TABLE game_content ALTER COLUMN difficulty DROP DEFAULT;

ALTER TABLE game_content
    ADD CONSTRAINT game_content_difficulty_tier
        CHECK (difficulty IN ('foundational', 'intermediate', 'advanced'));

COMMENT ON COLUMN game_content.difficulty IS
    'Tier derived server-side from mastery_snapshot via masteryTier(). Never client-supplied — GenerateGameContentSchema deliberately has no difficulty field.';

-- ── 3. Link a played session to the payload it played ───────────────────────
--
-- Without this a session and its content are related only by timestamp, so
-- "prove this session played the foundational crossword" is unanswerable — and
-- that is exactly the p. 99 black-box test case. ON DELETE SET NULL rather than
-- CASCADE: deleting generated content must not erase the student's play history.
ALTER TABLE game_sessions
    ADD COLUMN content_id UUID REFERENCES game_content(id) ON DELETE SET NULL;

CREATE INDEX idx_game_sessions_content ON game_sessions (content_id);

COMMENT ON COLUMN game_sessions.content_id IS
    'The game_content row this session played. space_id, material_id, game_type and mastery_snapshot are all copied from it at insert; the client supplies only the outcome.';
