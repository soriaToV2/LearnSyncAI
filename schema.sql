-- Enable pgvector extension for AI semantic search and similarities (Free Recall)
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- 1. USER MANAGEMENT (STUDENT-ONLY)
-- ==========================================

CREATE TYPE user_role AS ENUM ('student');

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'student',
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 2. STUDY SPACES & COURSE RESOURCES
-- ==========================================

-- Students create their own study spaces (no instructor/course linkage)
CREATE TABLE study_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    is_published BOOLEAN DEFAULT false, -- Triggers CollabShare (peer read-only access)
    share_token TEXT UNIQUE,            -- Secure sync key for CollabShare
    cloned_from_id UUID,
    original_author_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 3. DOCUMENT PARSING & SEMANTIC STORAGE
-- ==========================================

CREATE TYPE parsed_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Student-uploaded learning resources (PDFs, etc.) linked to their study space
CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE, -- Owned by a student's study space
    uploader_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL, -- Path in Supabase Storage Bucket
    parsed_status parsed_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Concept Glossary (NLP extracted with pgvector embeddings)
CREATE TABLE concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID REFERENCES materials(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    embedding vector(3072), -- 3072 dimensions for Gemini embedding models (gemini-embedding-001)
    parent_concept_id UUID REFERENCES concepts(id), -- For hierarchical concept maps
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Semantic search function: retrieves top-N concepts closest to a query vector
-- Used by the Study Assistant chatbot for Retrieval-Augmented Generation (RAG)
CREATE OR REPLACE FUNCTION match_concepts(
  query_embedding vector(3072),
  material_ids    uuid[],
  match_count     int DEFAULT 8
)
RETURNS TABLE (
  term        text,
  definition  text,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    term,
    definition,
    1 - (embedding <=> query_embedding) AS similarity
  FROM concepts
  WHERE material_id = ANY(material_ids)
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ==========================================
-- 4. FLASHCARDS (Spaced Repetition + BKT)
-- ==========================================

-- Flashcard Decks (Organizers for Flashcards within a Study Space)
CREATE TABLE flashcard_decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, -- e.g., 'Lesson 1', 'Chapter 2 Vocab'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Flashcards with spaced repetition scheduling fields
CREATE TABLE flashcards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    is_ai_generated BOOLEAN DEFAULT false,
    next_review_at TIMESTAMPTZ DEFAULT now(), -- Spaced repetition: when to show next
    ease_rating TEXT CHECK (ease_rating IN ('easy', 'medium', 'hard')), -- Last self-rating by student
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Logs every flashcard rating event (drives spaced repetition intervals & BKT updates)
-- Easy=4 days, Medium=3 days, Hard=1 day until next review
CREATE TABLE spaced_repetition_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    flashcard_id UUID REFERENCES flashcards(id) ON DELETE CASCADE,
    rating TEXT NOT NULL CHECK (rating IN ('easy', 'medium', 'hard')),
    reviewed_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 5. COGNITIVE REVIEW (Free Recall & Feynman Technique)
-- ==========================================

-- Logs for Free Recall and Feynman Technique AI evaluation sessions
CREATE TABLE cognitive_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    concept_id UUID REFERENCES concepts(id) ON DELETE SET NULL, -- Nullable: whole-material evaluation doesn't require a single concept
    mode TEXT NOT NULL, -- 'free_recall' or 'feynman'
    user_input TEXT NOT NULL,
    similarity_score NUMERIC, -- Cosine similarity coverage %
    ai_feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 6. AI CHATBOT (Course Resources Tab)
-- ==========================================

-- Stores conversation history between students and the AI chatbot
-- The chatbot uses RAG (Retrieval-Augmented Generation) against concept embeddings
CREATE TABLE chatbot_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,               -- The student's question
    response TEXT NOT NULL,              -- The AI's RAG-grounded answer
    source_concept_ids UUID[],           -- Concept IDs retrieved by pgvector for this response
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 6. ADAPTIVE TEST MODE (BKT-Powered)
-- ==========================================

CREATE TYPE practice_status AS ENUM ('in_progress', 'completed');

-- Student-generated Adaptive Practice Tests (BKT Powered)
-- Question types: multiple_choice, identification, matching_type, fill_in_the_blank, true_or_false
CREATE TABLE practice_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_material_ids UUID[], -- Materials selected by the student for this test
    questions_payload JSONB NOT NULL, -- The adaptive AI-generated questions
    student_answers JSONB, -- Stores progress so they can pause and resume
    score NUMERIC,
    status practice_status DEFAULT 'in_progress',
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- BKT Adaptive Testing Telemetry (per-question correctness & response time)
CREATE TABLE practice_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    concept_id UUID REFERENCES concepts(id) ON DELETE CASCADE,
    practice_test_id UUID REFERENCES practice_tests(id) ON DELETE CASCADE,
    is_correct BOOLEAN NOT NULL,
    latency_ms INTEGER NOT NULL, -- Time-on-task in milliseconds
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Latent Mastery Vectors (Continuously updated by BKT Python Microservice)
CREATE TABLE bkt_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    concept_id UUID REFERENCES concepts(id) ON DELETE CASCADE,
    latent_mastery NUMERIC DEFAULT 0.0, -- Probability of mastery (0.0 to 1.0)
    last_updated TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, concept_id)
);

-- ==========================================
-- 7. PLAYME MODULE (GAMIFICATION)
-- ==========================================

-- game_type includes: term_matcher, crossword, timed_trivia
-- Note: 'boggle' and 'trivia_blast' are deprecated; only use the 3 active types above
CREATE TYPE game_type AS ENUM ('term_matcher', 'crossword', 'trivia_blast', 'timed_trivia');

-- Student gamification profile (XP, streaks, hours)
CREATE TABLE gamification_profiles (
    student_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    total_xp INTEGER DEFAULT 0,
    day_streak INTEGER DEFAULT 0,          -- Consecutive days with any study activity
    total_study_hours NUMERIC DEFAULT 0,   -- Cumulative study time across all modules
    last_active_at TIMESTAMPTZ DEFAULT now()
);

-- Individual game session logs
CREATE TABLE game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    material_id UUID REFERENCES materials(id) ON DELETE CASCADE,
    game_type game_type NOT NULL,
    xp_earned INTEGER NOT NULL,
    accuracy NUMERIC,
    time_spent_ms INTEGER,
    completed_at TIMESTAMPTZ DEFAULT now()
);

-- Milestone badges awarded to students
CREATE TABLE user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    badge_name TEXT NOT NULL,
    awarded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, badge_name)
);

-- ==========================================
-- 8. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS
ALTER TABLE study_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaced_repetition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_logs ENABLE ROW LEVEL SECURITY;

-- Study Spaces: Owners have full access; Peers have Read-Only if published (CollabShare)
CREATE POLICY "Students can manage their own study spaces"
ON study_spaces FOR ALL
USING (auth.uid() = student_id);

CREATE POLICY "Peers can read published study spaces (CollabShare)"
ON study_spaces FOR SELECT
USING (is_published = true);

-- Materials: Owned by student via their space; peers can view published
CREATE POLICY "Students can manage materials in their own study spaces"
ON materials FOR ALL
USING (space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid()));

CREATE POLICY "Peers can view materials in published study spaces"
ON materials FOR SELECT
USING (space_id IN (SELECT id FROM study_spaces WHERE is_published = true));

-- Flashcard Decks
CREATE POLICY "Students manage their own decks"
ON flashcard_decks FOR ALL
USING (space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid()));

CREATE POLICY "Peers can read published decks"
ON flashcard_decks FOR SELECT
USING (
    space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid() OR is_published = true)
);

-- Flashcards
CREATE POLICY "Students manage their own flashcards"
ON flashcards FOR ALL
USING (deck_id IN (SELECT id FROM flashcard_decks WHERE space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid())));

CREATE POLICY "Peers can read flashcards in published spaces"
ON flashcards FOR SELECT
USING (
    deck_id IN (SELECT id FROM flashcard_decks WHERE space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid() OR is_published = true))
);

-- Spaced Repetition Logs
CREATE POLICY "Students manage their own spaced repetition logs"
ON spaced_repetition_logs FOR ALL
USING (student_id = auth.uid());

-- Cognitive Logs
CREATE POLICY "Students manage their own cognitive logs"
ON cognitive_logs FOR ALL
USING (space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid()));

-- Practice Tests
CREATE POLICY "Students manage their own practice tests"
ON practice_tests FOR ALL
USING (student_id = auth.uid());

-- Chatbot Logs
CREATE POLICY "Students can manage their own chatbot logs"
ON chatbot_logs FOR ALL
USING (student_id = auth.uid());

-- ==========================================
-- 9. INDEXING FOR PERFORMANCE OPTIMIZATION
-- ==========================================

-- NOTE: idx_concepts_embedding intentionally omitted — pgvector HNSW/IVFFlat indexes
-- only support up to 2000 dimensions. gemini-embedding-001 outputs 3072 dimensions.
-- Cosine similarity queries using the <=> operator still work without the index.

-- BKT & analytics
CREATE INDEX idx_bkt_student_concept ON bkt_mastery(student_id, concept_id);
CREATE INDEX idx_practice_telemetry_student ON practice_telemetry(student_id);

-- Study space navigation
CREATE INDEX idx_materials_space ON materials(space_id);
CREATE INDEX idx_flashcards_deck ON flashcards(deck_id);
CREATE INDEX idx_flashcard_decks_space ON flashcard_decks(space_id);
CREATE INDEX idx_cognitive_logs_space ON cognitive_logs(space_id);

-- Spaced repetition lookups
CREATE INDEX idx_spaced_repetition_logs_student ON spaced_repetition_logs(student_id);
CREATE INDEX idx_spaced_repetition_logs_flashcard ON spaced_repetition_logs(flashcard_id);

-- Chatbot lookups
CREATE INDEX idx_chatbot_logs_space ON chatbot_logs(space_id);
CREATE INDEX idx_chatbot_logs_student ON chatbot_logs(student_id);

-- ==========================================
-- 10. AUTOMATION & TRIGGERS
-- ==========================================

-- 48-hour Streak Logic (PlayMe Module)
-- Fires after every game session to update day_streak and total_xp in gamification_profiles
CREATE OR REPLACE FUNCTION update_study_streak()
RETURNS TRIGGER AS $$
BEGIN
    -- If last active was more than 48 hours ago, reset streak to 1; else increment
    IF (NEW.completed_at - (SELECT last_active_at FROM gamification_profiles WHERE student_id = NEW.student_id)) > interval '48 hours' THEN
        UPDATE gamification_profiles
        SET day_streak = 1, last_active_at = NEW.completed_at, total_xp = total_xp + NEW.xp_earned
        WHERE student_id = NEW.student_id;
    ELSE
        UPDATE gamification_profiles
        SET day_streak = day_streak + 1, last_active_at = NEW.completed_at, total_xp = total_xp + NEW.xp_earned
        WHERE student_id = NEW.student_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_streak
AFTER INSERT ON game_sessions
FOR EACH ROW EXECUTE FUNCTION update_study_streak();

-- Auto-Create Profile on New User Signup
-- Fires immediately after a new user is created in Supabase Auth (auth.users).
-- Mirrors the user into public.profiles and creates their gamification_profiles row.
-- SECURITY DEFINER ensures this runs with elevated privileges to write to auth-adjacent tables.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, first_name, last_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        'student'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.gamification_profiles (student_id)
    VALUES (NEW.id)
    ON CONFLICT (student_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();