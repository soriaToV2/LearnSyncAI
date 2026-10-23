-- LearnSync AI database schema (source of truth). Kept in step with supabase/migrations/:
-- running this on an empty database produces the same schema.
--
-- Roles: admin (accounts only), educator (uploads materials, monitors mastery), student (studies).
-- Invariants:
--   * Only educators upload materials; each is published to one grade level (7-10).
--   * BKT mastery is written only by Adaptive Flashcards and Adaptive Test Mode.
--   * Embeddings are vector(3072) from gemini-embedding-001. Never change the embedding model.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Enum types

CREATE TYPE user_role      AS ENUM ('student', 'educator', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'disabled');
CREATE TYPE parsed_status  AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE practice_status AS ENUM ('in_progress', 'completed');
CREATE TYPE cognitive_mode AS ENUM ('free_recall', 'feynman');
CREATE TYPE game_type      AS ENUM ('term_matcher', 'crossword', 'timed_trivia');

CREATE TYPE question_type AS ENUM (
    'multiple_choice',
    'identification',
    'matching_type',
    'fill_in_the_blank',
    'true_or_false'
);

-- The only two interaction modes permitted to move BKT mastery.
CREATE TYPE bkt_source AS ENUM ('flashcard', 'adaptive_test');

CREATE TYPE activity_type AS ENUM (
    'flashcard',
    'free_recall',
    'feynman',
    'adaptive_test',
    'game',
    'chat'
);

-- 2. Shared trigger function

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- 3. User management

CREATE TABLE profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role        user_role      NOT NULL DEFAULT 'student',
    username    TEXT,
    first_name  TEXT           NOT NULL,
    last_name   TEXT           NOT NULL,
    grade_level SMALLINT,
    status      account_status NOT NULL DEFAULT 'active',
    -- True while the account holds an admin-set password; separate from `status` (see below).
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ    DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT profiles_grade_level_range
        CHECK (grade_level IS NULL OR grade_level BETWEEN 7 AND 10),
    -- A student without a grade level cannot be matched to any material.
    CONSTRAINT profiles_student_needs_grade
        CHECK (role <> 'student' OR grade_level IS NOT NULL),
    -- 3-30 chars, lowercase alphanumerics, dot, underscore; no leading/trailing punctuation. NULL allowed.
    CONSTRAINT profiles_username_format
        CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$')
);

COMMENT ON COLUMN profiles.grade_level IS
    'Junior High School grade level (7-10). Required for students, NULL for educators and admins.';
COMMENT ON COLUMN profiles.status IS
    'Set to disabled by an admin to revoke access without deleting the account.';
COMMENT ON COLUMN profiles.username IS
    'Login identifier. POST /api/auth/login resolves it to auth.users.email server-side, so the email is never disclosed to an unauthenticated caller. Unique case-insensitively. NULL means the account cannot sign in.';
COMMENT ON COLUMN profiles.must_change_password IS
    'True while the account still holds a password an administrator set. requireRole refuses every route except GET /api/auth/me and POST /api/auth/change-password until the user replaces it. Cleared by that endpoint; re-armed by admin account creation and admin password reset.';

-- "Not activated" is derived from (status = 'active' AND must_change_password); account_status stays
-- two values. The facts are independent, and `status` is the access gate read in many places.

-- The username is the login identifier; auth.users.email is contact information only.
-- POST /api/auth/login resolves username -> email server-side.
-- Nullable: handle_new_user() must never raise, so a bad or taken username becomes NULL, and that
-- account cannot sign in until an admin fixes it.

-- Case-insensitive uniqueness, since the username is the credential.
CREATE UNIQUE INDEX ux_profiles_username_lower ON profiles (lower(username));

-- An educator's grades are derived from their published materials (private.auth_assigned_grades()).

CREATE INDEX idx_profiles_role_grade ON profiles (role, grade_level);

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Study spaces
-- Private and student-owned. One subject per space, fixed at creation; contents are the materials
-- published to (subject, owner's grade). The FK to subjects is added in section 5.
-- One space per (student, subject): a second copy would let the per-space "one lesson in one deck"
-- guard be bypassed (migration 0029).

CREATE TABLE study_spaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    subject     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN study_spaces.subject IS
    'Subject this space covers, from the subjects catalogue. Fixed at creation — the space''s materials are derived from it.';

CREATE INDEX idx_study_spaces_student ON study_spaces (student_id);
CREATE INDEX idx_study_spaces_subject ON study_spaces (subject);
CREATE UNIQUE INDEX ux_study_spaces_student_subject ON study_spaces (student_id, subject);

CREATE TRIGGER trg_study_spaces_updated_at
    BEFORE UPDATE ON study_spaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Subjects
-- A controlled vocabulary. Educators choose subject and grade per upload.

CREATE TABLE subjects (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE subjects IS
    'Controlled list of JHS subjects. Referenced by materials.subject so free text cannot fragment dashboard grouping into Science / science / Sci.';

-- DepEd JHS core subjects (a seed). Both portals read this table at runtime via GET /api/subjects.
INSERT INTO subjects (code, name, sort_order) VALUES
    ('FIL',   'Filipino',                                   1),
    ('ENG',   'English',                                    2),
    ('MATH',  'Mathematics',                                3),
    ('SCI',   'Science',                                    4),
    ('AP',    'Araling Panlipunan',                         5),
    ('ESP',   'Edukasyon sa Pagpapakatao',                  6),
    ('TLE',   'Technology and Livelihood Education',        7),
    ('MAPEH', 'Music, Arts, Physical Education and Health',  8);

-- Declared here because study_spaces is created first.
ALTER TABLE study_spaces
    ADD CONSTRAINT study_spaces_subject_fkey
        FOREIGN KEY (subject) REFERENCES subjects(code) ON DELETE RESTRICT;

-- 6. Materials & concept extraction
-- Only educators upload. Access is by grade level. Title, subject, grade and archive state are
-- editable afterwards via PATCH /api/materials/:id.

CREATE TABLE materials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    educator_id     UUID       NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    title           TEXT       NOT NULL,
    description     TEXT,
    subject         TEXT       NOT NULL REFERENCES subjects(code) ON DELETE RESTRICT,
    grade_levels    SMALLINT[] NOT NULL,
    storage_path    TEXT       NOT NULL,
    file_size_bytes BIGINT,
    page_count      INTEGER,
    is_scanned      BOOLEAN    NOT NULL DEFAULT false,
    parsed_status   parsed_status NOT NULL DEFAULT 'pending',
    parse_error     TEXT,
    is_archived     BOOLEAN    NOT NULL DEFAULT false,
    -- OCR transcript [{page, text}] for scans ('' for unreadable pages, NULL for text PDFs).
    -- Read only by the owner-gated GET /api/materials/:id/ocr-text.
    ocr_pages       JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Exactly one grade level. Kept as SMALLINT[] because all grade-access code uses the array form.
    CONSTRAINT materials_grade_levels_valid
        CHECK (grade_levels <@ ARRAY[7, 8, 9, 10]::SMALLINT[]
               AND array_length(grade_levels, 1) = 1),
    -- Ingest limit: 20 MB.
    CONSTRAINT materials_file_size_limit
        CHECK (file_size_bytes IS NULL OR file_size_bytes <= 20971520),
    -- Ingest limit: scanned PDFs up to 20 pages.
    CONSTRAINT materials_scanned_page_limit
        CHECK (NOT is_scanned OR page_count IS NULL OR page_count <= 20),
    CONSTRAINT materials_page_count_positive
        CHECK (page_count IS NULL OR page_count > 0)
);

COMMENT ON COLUMN materials.educator_id IS
    'Educator who uploaded this material. RESTRICT: an educator with materials cannot be deleted.';
COMMENT ON COLUMN materials.subject IS
    'Subject this material is filed under, from the subjects catalogue. Chosen by the uploading educator.';
COMMENT ON COLUMN materials.grade_levels IS
    'The ONE JHS grade level this material is published to, held as a single-element array (see materials_grade_levels_valid). Drives student-side RLS and, in turn, which students the educator can monitor. Editable after upload via PATCH /api/materials/:id.';
COMMENT ON COLUMN materials.is_scanned IS
    'True for image-based/scanned PDFs (including assembled photo uploads), which are limited to 20 pages and go through OCR before extraction.';
COMMENT ON COLUMN materials.ocr_pages IS
    'Per-page transcript produced by OCR for scanned/photographed materials, [{page, text}] in page order; NULL for text PDFs.';
COMMENT ON COLUMN materials.parse_error IS
    'Populated alongside parsed_status = failed so the educator sees why ingestion failed.';

CREATE INDEX idx_materials_educator     ON materials (educator_id);
CREATE INDEX idx_materials_grade_levels ON materials USING GIN (grade_levels);
CREATE INDEX idx_materials_subject      ON materials (subject);
CREATE INDEX idx_materials_status       ON materials (parsed_status) WHERE NOT is_archived;

CREATE TRIGGER trg_materials_updated_at
    BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Students select which educator materials to pull into each study space.
CREATE TABLE study_space_materials (
    space_id    UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES materials(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, material_id)
);

COMMENT ON TABLE study_space_materials IS
    'Educator materials a student has pulled into a study space. Access is still gated by materials.grade_levels.';

CREATE INDEX idx_ssm_material ON study_space_materials (material_id);

-- Concept glossary extracted by Gemini, with pgvector embeddings.
CREATE TABLE concepts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id       UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    term              TEXT NOT NULL,
    definition        TEXT NOT NULL,
    embedding         vector(3072),   -- gemini-embedding-001; do not change the model
    parent_concept_id UUID REFERENCES concepts(id),
    source_pages      SMALLINT[],     -- source PDF page(s) this concept was drawn from (educator traceability)
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_concepts_material ON concepts (material_id);
CREATE INDEX idx_concepts_parent   ON concepts (parent_concept_id);

-- No ANN index: pgvector HNSW/IVFFlat cap at 2000 dimensions. <=> still works as a sequential scan.

-- RAG search for the chatbot. Results are gated by match_threshold (~0.60), so empty means off-topic.
CREATE OR REPLACE FUNCTION match_concepts(
    query_embedding vector(3072),
    material_ids    UUID[],
    match_count     INT   DEFAULT 8,
    match_threshold FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    id         UUID,
    term       TEXT,
    definition TEXT,
    similarity FLOAT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        id,
        term,
        definition,
        1 - (embedding <=> query_embedding) AS similarity
    FROM concepts
    WHERE material_id = ANY(material_ids)
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> query_embedding) >= match_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;

-- 7. Flashcards (spaced repetition + BKT)

CREATE TABLE flashcard_decks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id     UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    -- Per-student display setting (a deck belongs to one student).
    answer_first BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN flashcard_decks.answer_first IS
    'Display preference: true shows the definition (the answer) on the first face and the term/question on the reverse, in both the card grid and the study session. Written only by PUT /api/spaces/:id/decks/:deckId. Affects nothing but rendering -- no score, schedule or mastery path reads it.';

CREATE INDEX idx_flashcard_decks_space ON flashcard_decks (space_id);

CREATE TABLE flashcards (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id            UUID NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
    term               TEXT NOT NULL,
    definition         TEXT NOT NULL,
    is_ai_generated    BOOLEAN     DEFAULT false,
    concept_id         UUID REFERENCES concepts(id)  ON DELETE SET NULL,
    source_material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
    next_review_at     TIMESTAMPTZ DEFAULT now(),
    ease_rating        TEXT CHECK (ease_rating IN ('easy', 'medium', 'hard')),
    created_at         TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN flashcards.concept_id IS
    'Concept this card assesses. NULL for hand-written cards, which then do not move BKT mastery.';

CREATE INDEX idx_flashcards_deck     ON flashcards (deck_id);
CREATE INDEX idx_flashcards_concept  ON flashcards (concept_id);
CREATE INDEX idx_flashcards_material ON flashcards (source_material_id);

-- Every counted rating. Leitner tiers: Easy 7 days, Medium 3, Hard 1.
CREATE TABLE spaced_repetition_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     UUID NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
    flashcard_id   UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    concept_id     UUID REFERENCES concepts(id) ON DELETE SET NULL,
    rating         TEXT     NOT NULL CHECK (rating IN ('easy', 'medium', 'hard')),
    interval_days  SMALLINT NOT NULL DEFAULT 1 CHECK (interval_days IN (1, 3, 7)),
    next_review_at TIMESTAMPTZ,
    reviewed_at    TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN spaced_repetition_logs.interval_days IS
    'Leitner tier applied: Easy = 7 days, Medium = 3 days, Hard = 1 day.';

CREATE INDEX idx_spaced_repetition_logs_student   ON spaced_repetition_logs (student_id);
CREATE INDEX idx_spaced_repetition_logs_flashcard ON spaced_repetition_logs (flashcard_id);
CREATE INDEX idx_srl_concept                      ON spaced_repetition_logs (concept_id);

-- 8. Cognitive review (Free Recall & Feynman). AI feedback only; never modifies mastery.

CREATE TABLE cognitive_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    space_id         UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    concept_id       UUID REFERENCES concepts(id) ON DELETE SET NULL,
    material_ids     UUID[],
    mode             cognitive_mode NOT NULL,
    user_input       TEXT NOT NULL,
    similarity_score NUMERIC,
    ai_feedback      TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT cognitive_logs_similarity_range
        CHECK (similarity_score IS NULL
               OR (similarity_score >= 0 AND similarity_score <= 1))
);

COMMENT ON COLUMN cognitive_logs.concept_id IS
    'NULL for whole-material evaluations, which name no single concept.';
COMMENT ON COLUMN cognitive_logs.material_ids IS
    'Materials the submission was evaluated against. Free Recall and Feynman can span several.';
COMMENT ON COLUMN cognitive_logs.similarity_score IS
    'Free Recall coverage ratio: coveredConcepts / totalConcepts, where a concept counts as covered at >= 0.70 cosine similarity.';
COMMENT ON COLUMN cognitive_logs.ai_feedback IS
    'JSON string (not jsonb) - the frontend parses it with JSON.parse per the documented convention.';

CREATE INDEX idx_cognitive_logs_space   ON cognitive_logs (space_id);
CREATE INDEX idx_cognitive_logs_student ON cognitive_logs (student_id, created_at DESC);

-- 9. AI chatbot (Course Resources tab)

CREATE TABLE chatbot_logs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id         UUID NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    space_id           UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    message            TEXT NOT NULL,
    response           TEXT NOT NULL,
    material_ids       UUID[],
    source_concept_ids UUID[],
    mode               TEXT CHECK (mode IN ('rag', 'full')),
    created_at         TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN chatbot_logs.mode IS
    'rag = pgvector similarity retrieval; full = all concepts of a single material injected as context.';

CREATE INDEX idx_chatbot_logs_space   ON chatbot_logs (space_id);
CREATE INDEX idx_chatbot_logs_student ON chatbot_logs (student_id);

-- 10. Adaptive Test Mode

CREATE TABLE practice_tests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id          UUID NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    space_id            UUID NOT NULL REFERENCES study_spaces(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    source_material_ids UUID[],
    question_types      question_type[] NOT NULL DEFAULT ARRAY['multiple_choice']::question_type[],
    questions_payload   JSONB NOT NULL,
    student_answers     JSONB,
    score               NUMERIC,
    difficulty_tier     TEXT CHECK (difficulty_tier IN ('foundational', 'intermediate', 'advanced')),
    mastery_snapshot    NUMERIC CHECK (mastery_snapshot IS NULL
                                       OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1)),
    status              practice_status DEFAULT 'in_progress',
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ,

    CONSTRAINT practice_tests_question_types_nonempty
        CHECK (array_length(question_types, 1) >= 1)
);

COMMENT ON COLUMN practice_tests.question_types IS
    'Formats the student selected: multiple_choice, identification, matching_type, fill_in_the_blank, true_or_false.';
COMMENT ON COLUMN practice_tests.mastery_snapshot IS
    'Running mastery used to pick difficulty_tier, retained for the Difficulty Alignment check.';

CREATE INDEX idx_practice_tests_student ON practice_tests (student_id, created_at DESC);
CREATE INDEX idx_practice_tests_space   ON practice_tests (space_id);

-- The only writer of student_answers while a test is open (PUT /api/practice/:id/answer).
-- One UPDATE merges the key with ||, so simultaneous saves (a matching block's four) can't overwrite
-- each other; the JS read-modify-write it replaced lost them (QA D21-race, migration 0030).
-- Returns NULL when the test is completed or not the student's. EXECUTE is revoked below.
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

CREATE TABLE practice_telemetry (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES profiles(id)       ON DELETE CASCADE,
    concept_id       UUID NOT NULL REFERENCES concepts(id)       ON DELETE CASCADE,
    practice_test_id UUID NOT NULL REFERENCES practice_tests(id) ON DELETE CASCADE,
    question_type    question_type NOT NULL,
    question_index   INTEGER,
    is_correct       BOOLEAN NOT NULL,
    latency_ms       INTEGER NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN practice_telemetry.question_type IS
    'Selects the context-sensitive P(G) for this observation (mc 0.25, tf 0.50, id/fib 0.05, match 0.17).';

CREATE INDEX idx_practice_telemetry_student ON practice_telemetry (student_id);
CREATE INDEX idx_practice_telemetry_test    ON practice_telemetry (practice_test_id);

-- 11. Bayesian Knowledge Tracing (classical four-parameter, in the Express backend; no pyBKT, no EM)
--   Evidence, correct:    P(L|1) = P(L)(1-P(S)) / [P(L)(1-P(S)) + (1-P(L))P(G)]
--   Evidence, incorrect:  P(L|0) = P(L)P(S)     / [P(L)P(S)     + (1-P(L))(1-P(G))]
--   Transition:           P(L_t+1) = P(L|obs) + (1 - P(L|obs)) * P(T)

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

CREATE TABLE bkt_mastery (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id        UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    concept_id        UUID    NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    latent_mastery    NUMERIC NOT NULL DEFAULT 0.10,
    opportunity_count INTEGER NOT NULL DEFAULT 0,
    last_updated      TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT bkt_mastery_range CHECK (latent_mastery >= 0 AND latent_mastery <= 1),
    UNIQUE (student_id, concept_id)
);

COMMENT ON COLUMN bkt_mastery.latent_mastery IS
    'P(L_current) for this student/concept. Seeded at P(L0) = 0.10 and updated only by flashcard ratings and adaptive tests.';
COMMENT ON COLUMN bkt_mastery.opportunity_count IS
    'Number of BKT learning opportunities recorded so far. Useful for cold-start reporting.';

CREATE INDEX idx_bkt_student_concept ON bkt_mastery (student_id, concept_id);

-- Append-only audit trail: prior, applied parameters and both phases, for the ICR test.
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

CREATE INDEX idx_bkt_update_logs_student_concept ON bkt_update_logs (student_id, concept_id, created_at);
CREATE INDEX idx_bkt_update_logs_test            ON bkt_update_logs (practice_test_id);
CREATE INDEX idx_bkt_update_logs_card            ON bkt_update_logs (flashcard_id);

-- EQ(4): document mastery is the arithmetic mean of per-concept probabilities.
CREATE OR REPLACE FUNCTION document_mastery(p_student_id UUID, p_material_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION mastery_tier(p_mastery NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
             WHEN p_mastery IS NULL THEN 'foundational'
             WHEN p_mastery >= 0.85 THEN 'advanced'
             WHEN p_mastery >= 0.50 THEN 'intermediate'
             ELSE                        'foundational'
           END;
$$;

COMMENT ON FUNCTION mastery_tier(NUMERIC) IS
    'Adaptive test / game difficulty tier: < 0.50 foundational, 0.50-0.85 intermediate, >= 0.85 advanced.';

-- 12. Activity log, streaks & gamification
-- Streak days use Asia/Manila calendar dates (a bare ::date depends on the session TimeZone).

CREATE TABLE activity_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_type activity_type NOT NULL,
    space_id      UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    material_id   UUID REFERENCES materials(id)    ON DELETE SET NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE activity_logs IS
    'DFD data store D3. Every study interaction lands here; day streaks and total study hours derive from it.';

CREATE INDEX idx_activity_logs_student_day
    ON activity_logs (student_id, ((occurred_at AT TIME ZONE 'Asia/Manila')::date));
CREATE INDEX idx_activity_logs_occurred ON activity_logs (occurred_at DESC);
CREATE INDEX idx_activity_logs_space    ON activity_logs (space_id);
CREATE INDEX idx_activity_logs_material ON activity_logs (material_id);

CREATE TABLE gamification_profiles (
    student_id        UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    day_streak        INTEGER NOT NULL DEFAULT 0,
    longest_streak    INTEGER NOT NULL DEFAULT 0,
    total_study_hours NUMERIC NOT NULL DEFAULT 0,
    last_active_on    DATE,

    CONSTRAINT gamification_streaks_nonneg
        CHECK (day_streak >= 0 AND longest_streak >= 0 AND total_study_hours >= 0)
);

COMMENT ON COLUMN gamification_profiles.last_active_on IS
    'Asia/Manila calendar date of the most recent activity. Streak succession is measured against this, not a 48-hour clock.';

-- AI-generated game content. Declared before game_sessions, which references it.
CREATE TABLE game_content (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID   NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    space_id         UUID   REFERENCES study_spaces(id) ON DELETE CASCADE,
    material_ids     UUID[] NOT NULL,
    game_type        game_type NOT NULL,
    difficulty       TEXT   NOT NULL,
    mastery_snapshot NUMERIC,
    payload          JSONB  NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),

    -- Same tiers as mastery_tier(); no DEFAULT, so a missing value fails loudly.
    CONSTRAINT game_content_difficulty_tier
        CHECK (difficulty IN ('foundational', 'intermediate', 'advanced')),
    CONSTRAINT game_content_mastery_snapshot_check
        CHECK (mastery_snapshot IS NULL OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1))
);

COMMENT ON COLUMN game_content.difficulty IS
    'Tier derived server-side from mastery_snapshot via masteryTier(). Never client-supplied — GenerateGameContentSchema deliberately has no difficulty field.';

COMMENT ON COLUMN game_content.mastery_snapshot IS
    'M_doc passed to the generation prompt. Games personalise from mastery but never modify it. NULL on rows generated before calibration existed.';

CREATE INDEX idx_game_content_student ON game_content (student_id);
CREATE INDEX idx_game_content_space   ON game_content (space_id);

CREATE TABLE game_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_id       UUID REFERENCES game_content(id) ON DELETE SET NULL,
    space_id         UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    material_id      UUID REFERENCES materials(id)    ON DELETE CASCADE,
    game_type        game_type NOT NULL,
    accuracy         NUMERIC,
    time_spent_ms    INTEGER,
    mastery_snapshot NUMERIC,
    detail           JSONB,
    completed_at     TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT game_sessions_accuracy_range
        CHECK (accuracy IS NULL OR (accuracy >= 0 AND accuracy <= 1)),
    CONSTRAINT game_sessions_mastery_snapshot_check
        CHECK (mastery_snapshot IS NULL OR (mastery_snapshot >= 0 AND mastery_snapshot <= 1))
);

COMMENT ON COLUMN game_sessions.content_id IS
    'The game_content row this session played. space_id, material_id, game_type and mastery_snapshot are all copied from it at insert; the client supplies only the outcome.';

COMMENT ON COLUMN game_sessions.mastery_snapshot IS
    'M_doc at session start. Recorded for the Difficulty Alignment check; games never write back to bkt_mastery.';

CREATE INDEX idx_game_sessions_student  ON game_sessions (student_id, completed_at DESC);
CREATE INDEX idx_game_sessions_material ON game_sessions (material_id);
CREATE INDEX idx_game_sessions_content  ON game_sessions (content_id);

CREATE TABLE user_badges (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_name TEXT NOT NULL,
    awarded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (student_id, badge_name)
);

COMMENT ON COLUMN user_badges.badge_name IS
    'Stable identifier from the catalogue in server/lib/badges.ts (e.g. streak_3, mastery_10). Never renamed once live -- the string IS the identity. There is deliberately no `badges` table: a catalogue nobody can edit is a constant with extra steps.';

-- UNIQUE (student_id, badge_name) makes awarding idempotent (ON CONFLICT DO NOTHING).
CREATE INDEX idx_user_badges_student ON user_badges (student_id);

-- Onboarding steps a student has seen. Composite PK makes writes idempotent.
-- Gates nothing, and never writes activity_logs (that would award streak days).
CREATE TABLE onboarding_seen (
    student_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    step_key   TEXT        NOT NULL,
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, step_key)
);

COMMENT ON COLUMN onboarding_seen.step_key IS
    'Stable identifier from the catalogue in src/lib/onboarding.ts, mirrored as a Zod enum in server/types/api.ts (e.g. tour_v1, tool_flashcards). The string IS the identity -- renaming one re-shows that step to every student who had already dismissed it. The version suffix (tour_v1) is how a genuinely rewritten tour gets re-shown on purpose.';

-- No secondary index: the PK leads with student_id.

-- 13. Dashboard views
-- security_invoker so the caller's RLS applies; a default view would leak every student's mastery.

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
JOIN study_spaces ss ON ss.id = ssm.space_id
JOIN concepts c      ON c.material_id = ssm.material_id
LEFT JOIN bkt_mastery bm
       ON bm.concept_id = c.id
      AND bm.student_id = ss.student_id
GROUP BY ss.student_id, ssm.material_id;

COMMENT ON VIEW v_student_material_mastery IS
    'M_doc per student per material, deduplicated across study spaces. Backs the dashboard progress bar and game calibration.';

-- Built over materials -> concepts -> students, not v_student_material_mastery (educators have no
-- policy on study spaces, so that route returned zero rows).
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

-- 14. Automation & triggers

-- Mirrors a new auth user into profiles, taking role and grade from user_metadata.
-- Applies defaults rather than raising: an exception would abort the auth.users INSERT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role        user_role;
    v_grade       SMALLINT;
    v_username    TEXT;
    v_must_change BOOLEAN;
BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'student')::user_role;

    IF NULLIF(NEW.raw_user_meta_data ->> 'grade_level', '') IS NOT NULL THEN
        v_grade := (NEW.raw_user_meta_data ->> 'grade_level')::SMALLINT;
    END IF;

    IF v_role = 'student' AND v_grade IS NULL THEN
        v_grade := 7;
    END IF;

    -- A malformed or taken username becomes NULL rather than raising; an admin fixes it.
    v_username := NULLIF(lower(NEW.raw_user_meta_data ->> 'username'), '');

    IF v_username IS NOT NULL
       AND (v_username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
            OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_username)) THEN
        v_username := NULL;
    END IF;

    -- Set here so the row is born with the flag; unparseable values become false.
    BEGIN
        v_must_change := COALESCE(
            (NULLIF(NEW.raw_user_meta_data ->> 'must_change_password', ''))::BOOLEAN,
            false
        );
    EXCEPTION WHEN others THEN
        v_must_change := false;
    END;

    INSERT INTO public.profiles (
        id, first_name, last_name, role, grade_level, username, must_change_password
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
        v_role,
        CASE WHEN v_role = 'student' THEN v_grade END,
        v_username,
        v_must_change
    )
    ON CONFLICT (id) DO NOTHING;

    -- Only students have a gamification profile.
    IF v_role = 'student' THEN
        INSERT INTO public.gamification_profiles (student_id)
        VALUES (NEW.id)
        ON CONFLICT (student_id) DO NOTHING;
    END IF;

    -- Educators need no further setup.
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Day streaks and total study hours, driven by activity_logs.
CREATE OR REPLACE FUNCTION public.update_study_streak()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day    DATE := (NEW.occurred_at AT TIME ZONE 'Asia/Manila')::date;
    v_last   DATE;
    v_streak INTEGER;
BEGIN
    -- Students always have a gamification profile, but tolerate a missing row.
    INSERT INTO gamification_profiles (student_id)
    VALUES (NEW.student_id)
    ON CONFLICT (student_id) DO NOTHING;

    SELECT last_active_on, day_streak
      INTO v_last, v_streak
      FROM gamification_profiles
     WHERE student_id = NEW.student_id
     FOR UPDATE;

    IF v_last IS NULL OR v_day > v_last THEN
        -- New calendar day: extend the run if consecutive, else restart.
        v_streak := CASE WHEN v_last IS NOT NULL AND v_day = v_last + 1
                         THEN v_streak + 1
                         ELSE 1
                    END;

        UPDATE gamification_profiles
           SET day_streak     = v_streak,
               longest_streak = greatest(longest_streak, v_streak),
               last_active_on = v_day
         WHERE student_id = NEW.student_id;
    END IF;
    -- A second activity on the same day leaves the streak unchanged.

    UPDATE gamification_profiles
       SET total_study_hours = total_study_hours + (NEW.duration_ms / 3600000.0)
     WHERE student_id = NEW.student_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_study_streak() IS
    'Maintains day_streak, longest_streak and total_study_hours from activity_logs inserts. Days are Asia/Manila local.';

CREATE TRIGGER trigger_update_streak
    AFTER INSERT ON activity_logs
    FOR EACH ROW EXECUTE FUNCTION update_study_streak();

-- RLS grants row access, not column access, so block self-escalation of role/status/grade here.
CREATE OR REPLACE FUNCTION enforce_profile_immutables()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- auth.uid() is NULL for the service role, which the backend uses.
    IF auth.uid() IS NULL
       OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' THEN
        RETURN NEW;
    END IF;

    IF NEW.role        IS DISTINCT FROM OLD.role
    OR NEW.status      IS DISTINCT FROM OLD.status
    OR NEW.grade_level IS DISTINCT FROM OLD.grade_level THEN
        RAISE EXCEPTION
            'Only an administrator can change role, account status or grade level';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_immutables
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_profile_immutables();

-- No publish-scope trigger: the subject FK and the one-grade CHECK are the only limits.

-- 15. Row-level security
-- The API uses the service role, which bypasses RLS, so these policies are defence in depth for
-- anon-key access and must still be enforced in the API layer.
-- Mastery and gamification tables have no student write policy, so an anon key can't inflate scores.

-- Helpers live in the unexposed `private` schema (separated by schema, not by revoking EXECUTE,
-- which would break policy evaluation). SECURITY DEFINER avoids recursion on profiles. Each returns
-- NULL for a disabled account.

CREATE SCHEMA IF NOT EXISTS private;

-- USAGE only: no table access is granted through this schema.
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.auth_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION private.auth_grade_level()
RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT grade_level FROM public.profiles
     WHERE id = auth.uid() AND status = 'active' AND role = 'student';
$$;

-- Derived from the educator's live materials; NULL (no students) if they have none.
-- SECURITY DEFINER bypasses RLS on materials, so there is no policy recursion.
CREATE OR REPLACE FUNCTION private.auth_assigned_grades()
RETURNS SMALLINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT array_agg(DISTINCT g)
      FROM public.materials m
      CROSS JOIN LATERAL unnest(m.grade_levels) g
      JOIN public.profiles p ON p.id = m.educator_id
     WHERE m.educator_id = auth.uid()
       AND NOT m.is_archived
       AND p.status = 'active'
       AND p.role   = 'educator';
$$;

CREATE OR REPLACE FUNCTION private.owns_study_space(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.study_spaces
         WHERE id = p_space_id AND student_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION private.auth_role() IS
    'Role of the calling user, or NULL if unauthenticated or disabled. Lives in private so PostgREST cannot expose it as an RPC endpoint.';

GRANT EXECUTE ON FUNCTION private.auth_role()            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.auth_grade_level()     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.auth_assigned_grades() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owns_study_space(UUID) TO anon, authenticated;

-- Trigger functions stay in `public` with EXECUTE revoked; triggers don't re-check caller privilege.
REVOKE EXECUTE ON FUNCTION enforce_profile_immutables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_study_streak()        FROM PUBLIC, anon, authenticated;

-- Takes the student id as a parameter, so it must stay service-role only: callable from the anon
-- key, it would let any signed-in student write answers into another student's test.
REVOKE EXECUTE ON FUNCTION record_test_answer(UUID, UUID, INT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_test_answer(UUID, UUID, INT, TEXT, BIGINT) TO service_role;

ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials              ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_spaces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_space_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_decks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaced_repetition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_telemetry     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_mastery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_update_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bkt_parameters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_content           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_seen        ENABLE ROW LEVEL SECURITY;

-- profiles

CREATE POLICY "Users read their own profile"
    ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users update their own profile"
    ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Educators read students in their assigned grades"
    ON profiles FOR SELECT
    USING (role = 'student' AND grade_level = ANY (private.auth_assigned_grades()));

CREATE POLICY "Admins manage all profiles"
    ON profiles FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');

-- subjects

CREATE POLICY "Authenticated users read subjects"
    ON subjects FOR SELECT USING (private.auth_role() IS NOT NULL);

CREATE POLICY "Admins manage subjects"
    ON subjects FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');

-- materials & concepts

CREATE POLICY "Educators manage their own materials"
    ON materials FOR ALL
    USING (educator_id = auth.uid() AND private.auth_role() = 'educator')
    WITH CHECK (educator_id = auth.uid() AND private.auth_role() = 'educator');

CREATE POLICY "Students read materials published to their grade"
    ON materials FOR SELECT
    USING (NOT is_archived AND private.auth_grade_level() = ANY (grade_levels));

CREATE POLICY "Admins read all materials"
    ON materials FOR SELECT USING (private.auth_role() = 'admin');

CREATE POLICY "Students read concepts of accessible materials"
    ON concepts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = concepts.material_id
           AND NOT m.is_archived
           AND private.auth_grade_level() = ANY (m.grade_levels)
    ));

CREATE POLICY "Educators read concepts of their own materials"
    ON concepts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM materials m
         WHERE m.id = concepts.material_id
           AND m.educator_id = auth.uid()
    ));

-- student-owned study data

CREATE POLICY "Students manage their own study spaces"
    ON study_spaces FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- A student may only attach a material their grade level can actually access.
CREATE POLICY "Students manage materials in their own spaces"
    ON study_space_materials FOR ALL
    USING (private.owns_study_space(space_id))
    WITH CHECK (
        private.owns_study_space(space_id)
        AND EXISTS (
            SELECT 1 FROM materials m
             WHERE m.id = study_space_materials.material_id
               AND NOT m.is_archived
               AND private.auth_grade_level() = ANY (m.grade_levels)
        )
    );

CREATE POLICY "Students manage their own decks"
    ON flashcard_decks FOR ALL
    USING (private.owns_study_space(space_id)) WITH CHECK (private.owns_study_space(space_id));

CREATE POLICY "Students manage their own flashcards"
    ON flashcards FOR ALL
    USING (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND private.owns_study_space(d.space_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM flashcard_decks d
         WHERE d.id = flashcards.deck_id AND private.owns_study_space(d.space_id)
    ));

CREATE POLICY "Students manage their own spaced repetition logs"
    ON spaced_repetition_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own cognitive logs"
    ON cognitive_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own chatbot logs"
    ON chatbot_logs FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own practice tests"
    ON practice_tests FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own practice telemetry"
    ON practice_telemetry FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students manage their own game content"
    ON game_content FOR ALL
    USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- append-only / read-only student records

CREATE POLICY "Students read their own activity log"
    ON activity_logs FOR SELECT USING (student_id = auth.uid());

-- No student INSERT policy: only the API (service role) writes activity_logs, and the
-- SECURITY DEFINER streak trigger would otherwise let an anon key move streak counters.

CREATE POLICY "Students read their own game sessions"
    ON game_sessions FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students append their own game sessions"
    ON game_sessions FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students read their own gamification profile"
    ON gamification_profiles FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students read their own badges"
    ON user_badges FOR SELECT USING (student_id = auth.uid());

-- SELECT only; no INSERT policy (the API writes with the service role).
CREATE POLICY "Students read their own onboarding progress"
    ON onboarding_seen FOR SELECT USING (student_id = auth.uid());

-- mastery: students read their own, educators read their assigned grades

CREATE POLICY "Students read their own mastery"
    ON bkt_mastery FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Educators read mastery for their assigned grades"
    ON bkt_mastery FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_mastery.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (private.auth_assigned_grades())
    ));

CREATE POLICY "Students read their own BKT update log"
    ON bkt_update_logs FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Educators read BKT update logs for their assigned grades"
    ON bkt_update_logs FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM profiles p
         WHERE p.id = bkt_update_logs.student_id
           AND p.role = 'student'
           AND p.grade_level = ANY (private.auth_assigned_grades())
    ));

-- reference data

CREATE POLICY "Authenticated users read BKT parameters"
    ON bkt_parameters FOR SELECT USING (private.auth_role() IS NOT NULL);

CREATE POLICY "Admins manage BKT parameters"
    ON bkt_parameters FOR ALL
    USING (private.auth_role() = 'admin') WITH CHECK (private.auth_role() = 'admin');

-- 16. Storage
-- The `materials` bucket is private; files are served via createSignedUrl() with the service role.
-- Run once when provisioning a new project:
--   INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   VALUES ('materials', 'materials', false, 20971520, ARRAY['application/pdf'])
--   ON CONFLICT (id) DO UPDATE
--      SET public = false, file_size_limit = 20971520,
--          allowed_mime_types = ARRAY['application/pdf'];

-- Writes are keyed on a leading <educator_id>/ folder, so the check does not
-- depend on a materials row that does not exist yet at upload time.
CREATE POLICY "Educators upload their own materials"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'materials'
        AND private.auth_role() = 'educator'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Educators manage their own material files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND m.educator_id = auth.uid()
        )
    );

CREATE POLICY "Educators read their own material files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND m.educator_id = auth.uid()
        )
    );

CREATE POLICY "Students read materials for their grade"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'materials'
        AND EXISTS (
            SELECT 1 FROM public.materials m
             WHERE m.storage_path = storage.objects.name
               AND NOT m.is_archived
               AND private.auth_grade_level() = ANY (m.grade_levels)
        )
    );


