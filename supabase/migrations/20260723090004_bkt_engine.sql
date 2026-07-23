-- ============================================================================
-- 0004 — BKT engine: parameters, audit trail, and the concept links it needs
-- ============================================================================
-- Bayesian Knowledge Tracing runs inside the Express backend using the classical
-- four-parameter update equations. This migration provides:
--
--   * bkt_parameters   - the documented default parameter table, in one place
--   * bkt_update_logs  - a per-observation audit trail; every row records the
--                        prior, the exact P(G)/P(S)/P(T) applied, and both
--                        update phases, so the documented Implementation
--                        Correctness Rate test can diff system output against
--                        hand-computed values with a single query
--   * flashcards.concept_id - previously missing, which is why a flashcard
--                        rating had no concept to update mastery for
--   * practice_tests.question_types / practice_telemetry.question_type -
--                        the format determines which P(G) applies
-- ============================================================================

-- 1. Enums ---------------------------------------------------------------------

CREATE TYPE question_type AS ENUM (
    'multiple_choice',
    'identification',
    'matching_type',
    'fill_in_the_blank',
    'true_or_false'
);

CREATE TYPE bkt_source AS ENUM ('flashcard', 'adaptive_test');

COMMENT ON TYPE bkt_source IS
    'The two interaction modes permitted to move mastery. Games, Free Recall and Feynman read mastery but never write it.';

-- 2. Documented default parameters ---------------------------------------------

CREATE TABLE bkt_parameters (
    key         TEXT PRIMARY KEY,
    value       NUMERIC NOT NULL CHECK (value >= 0 AND value <= 1),
    description TEXT NOT NULL
);

COMMENT ON TABLE bkt_parameters IS
    'Default BKT parameters (Bulut et al., 2023). Read by the backend BKT engine; no EM fitting is performed.';

INSERT INTO bkt_parameters (key, value, description) VALUES
    ('p_l0',     0.10, 'P(L0) initial knowledge state - conservative 10% prior of pre-existing mastery'),
    ('p_t',      0.20, 'P(T) transition/learning rate per learning opportunity'),
    ('p_s',      0.15, 'P(S) slip probability - mastered but answers incorrectly'),
    ('g_easy',   0.05, 'P(G) flashcard rated Easy - correct response reflects genuine knowledge'),
    ('g_medium', 0.25, 'P(G) flashcard rated Medium - moderate chance of partial guessing'),
    ('g_hard',   0.10, 'P(G) flashcard rated Hard - incorrect observation, allows vague partial recall'),
    ('g_mc',     0.25, 'P(G) multiple choice, 4 options (1/4)'),
    ('g_tf',     0.50, 'P(G) true or false, binary format (1/2)'),
    ('g_id',     0.05, 'P(G) identification - open ended, near-zero guessing'),
    ('g_fib',    0.05, 'P(G) fill in the blank - free recall, no selectable options'),
    ('g_match',  0.17, 'P(G) matching type, 4 terms against 6 definitions (1/6)');

-- 3. bkt_mastery: correct prior + opportunity counter ---------------------------
-- The old default of 0.0 contradicted P(L0) = 0.10. The table is empty, so the
-- change is free.

ALTER TABLE bkt_mastery
    ALTER COLUMN student_id     SET NOT NULL,
    ALTER COLUMN concept_id     SET NOT NULL,
    ALTER COLUMN latent_mastery SET DEFAULT 0.10,
    ALTER COLUMN latent_mastery SET NOT NULL,
    ADD COLUMN  opportunity_count INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT bkt_mastery_range
        CHECK (latent_mastery >= 0 AND latent_mastery <= 1);

COMMENT ON COLUMN bkt_mastery.latent_mastery IS
    'P(L_current) for this student/concept. Seeded at P(L0) = 0.10 and updated only by flashcard ratings and adaptive tests.';
COMMENT ON COLUMN bkt_mastery.opportunity_count IS
    'Number of BKT learning opportunities recorded so far. Useful for cold-start reporting.';

-- 4. Per-observation audit trail ------------------------------------------------

CREATE TABLE bkt_update_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    concept_id       UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    source           bkt_source NOT NULL,
    observation      SMALLINT   NOT NULL CHECK (observation IN (0, 1)),

    p_l_prior        NUMERIC NOT NULL CHECK (p_l_prior     >= 0 AND p_l_prior     <= 1),
    p_guess          NUMERIC NOT NULL CHECK (p_guess       >= 0 AND p_guess       <= 1),
    p_slip           NUMERIC NOT NULL DEFAULT 0.15 CHECK (p_slip    >= 0 AND p_slip    <= 1),
    p_transit        NUMERIC NOT NULL DEFAULT 0.20 CHECK (p_transit >= 0 AND p_transit <= 1),
    p_l_evidence     NUMERIC NOT NULL CHECK (p_l_evidence  >= 0 AND p_l_evidence  <= 1),
    p_l_posterior    NUMERIC NOT NULL CHECK (p_l_posterior >= 0 AND p_l_posterior <= 1),

    flashcard_id     UUID REFERENCES flashcards(id)     ON DELETE SET NULL,
    practice_test_id UUID REFERENCES practice_tests(id) ON DELETE SET NULL,
    question_type    question_type,
    rating           TEXT CHECK (rating IN ('easy', 'medium', 'hard')),

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bkt_update_logs IS
    'Append-only trace of every BKT update. p_l_evidence is EQ(1)/EQ(2); p_l_posterior is EQ(3). Backs the Implementation Correctness Rate test.';

CREATE INDEX idx_bkt_update_logs_student_concept
    ON bkt_update_logs (student_id, concept_id, created_at);

-- 5. Flashcards need a concept to update ----------------------------------------

ALTER TABLE flashcards
    ADD COLUMN concept_id         UUID REFERENCES concepts(id)  ON DELETE SET NULL,
    ADD COLUMN source_material_id UUID REFERENCES materials(id) ON DELETE SET NULL;

COMMENT ON COLUMN flashcards.concept_id IS
    'Concept this card assesses. NULL for hand-written cards, which then do not move BKT mastery.';

-- Opportunistically link existing cards to concepts by exact term match.
UPDATE flashcards f
   SET concept_id = c.id
  FROM concepts c
 WHERE f.concept_id IS NULL
   AND lower(btrim(f.term)) = lower(btrim(c.term));

CREATE INDEX idx_flashcards_concept ON flashcards (concept_id);

-- 6. Spaced repetition logs carry the interval and concept ----------------------

ALTER TABLE spaced_repetition_logs
    ADD COLUMN concept_id     UUID REFERENCES concepts(id) ON DELETE SET NULL,
    ADD COLUMN interval_days  SMALLINT NOT NULL DEFAULT 1
        CHECK (interval_days IN (1, 3, 7)),
    ADD COLUMN next_review_at TIMESTAMPTZ;

COMMENT ON COLUMN spaced_repetition_logs.interval_days IS
    'Leitner tier applied: Easy = 7 days, Medium = 3 days, Hard = 1 day.';

-- 7. Adaptive test: persist the selected formats and the tier that was chosen ---

ALTER TABLE practice_tests
    ADD COLUMN question_types   question_type[] NOT NULL DEFAULT ARRAY['multiple_choice']::question_type[],
    ADD COLUMN difficulty_tier  TEXT CHECK (difficulty_tier IN ('foundational', 'intermediate', 'advanced')),
    ADD COLUMN mastery_snapshot NUMERIC CHECK (mastery_snapshot IS NULL
                                               OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1)),
    ADD CONSTRAINT practice_tests_question_types_nonempty
        CHECK (array_length(question_types, 1) >= 1);

COMMENT ON COLUMN practice_tests.question_types IS
    'Formats the student selected. Previously accepted by the API but never stored.';
COMMENT ON COLUMN practice_tests.mastery_snapshot IS
    'Running mastery used to pick difficulty_tier, retained for the Difficulty Alignment check.';

-- 8. Telemetry records which format the observation came from -------------------

ALTER TABLE practice_telemetry
    ADD COLUMN question_type  question_type,
    ADD COLUMN question_index INTEGER;

COMMENT ON COLUMN practice_telemetry.question_type IS
    'Selects the context-sensitive P(G) for this observation (mc 0.25, tf 0.50, id/fib 0.05, match 0.17).';

CREATE INDEX idx_practice_telemetry_test ON practice_telemetry (practice_test_id);
