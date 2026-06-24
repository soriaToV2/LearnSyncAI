-- Enable pgvector extension for AI semantic search and similarities (Free Recall)
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- 1. MULTI-TENANT & USER MANAGEMENT (RBAC)
-- ==========================================

-- Institutions (Multi-tenant isolation)
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Profiles extending Supabase auth.users (Removed 'admin' role)
CREATE TYPE user_role AS ENUM ('student', 'instructor');

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'student',
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL, -- Made optional for independent users
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Courses created by instructors
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL, -- Made optional
    instructor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    course_title TEXT NOT NULL,
    course_code TEXT, -- E.g., 'IT-101'
    section TEXT,     -- E.g., 'A', '1'
    description TEXT,
    join_code TEXT UNIQUE, -- Added for Google Classroom-style student joining
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Student Enrollments
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(course_id, student_id)
);

-- Course Announcements (Instructor -> Students)
CREATE TABLE course_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    instructor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 2. DOCUMENT PARSING & SEMANTIC STORAGE
-- ==========================================

CREATE TYPE parsed_status AS ENUM ('pending', 'processing', 'completed');

-- Uploaded instructor resources (PDFs, PPTs) mapped to Supabase Storage
CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
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

-- ==========================================
-- 3. SUMMATIVE PATHWAY (IMMUTABLE EXAMS)
-- ==========================================

CREATE TYPE assessment_type AS ENUM ('quiz', 'exam');
CREATE TYPE assessment_status AS ENUM ('draft', 'ready', 'deployed', 'closed');

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    assessment_type assessment_type NOT NULL DEFAULT 'quiz',
    start_time TIMESTAMPTZ, -- Scheduled start date and time
    duration_minutes INTEGER, -- Time limit
    source_material_ids UUID[], -- Array of material IDs selected for AI generation
    total_questions INTEGER,
    question_types TEXT[], -- Array of types: 'enumeration', 'essay', 'true_false', etc.
    number_of_sets INTEGER DEFAULT 1, -- e.g., 2 means AI generates Set A and Set B
    status assessment_status DEFAULT 'draft', 
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Instructor-reviewed generated sets (Set A, Set B, etc.)
CREATE TABLE assessment_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
    set_name TEXT NOT NULL, -- E.g., 'Set A', 'Set B'
    questions_payload JSONB NOT NULL, -- The AI generated & instructor-reviewed questions
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Locked, uneditable records to protect grading integrity
CREATE TABLE assessment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
    assessment_set_id UUID REFERENCES assessment_sets(id) ON DELETE CASCADE, -- Identifies which set they took
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    student_answers JSONB NOT NULL, -- The actual answers submitted by the student
    score NUMERIC,
    latency_ms INTEGER,
    submitted_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 4. FORMATIVE PATHWAY (STUDY SPACE & COLLABSHARE)
-- ==========================================

CREATE TABLE study_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE, -- Linked to fetch resources
    title TEXT NOT NULL,
    is_published BOOLEAN DEFAULT false, -- Triggers CollabShare
    share_token TEXT UNIQUE, -- Secure sync key
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Flashcard Decks (Organizers for Flashcards)
CREATE TABLE flashcard_decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, -- e.g., 'Lesson 1', 'Chapter 2 Vocab'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Mode A: Flashcards (Now stored inside Decks)
CREATE TABLE flashcards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    is_ai_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Mode B & C: Cognitive Review Logs (Free Recall & Feynman)
CREATE TABLE cognitive_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    concept_id UUID REFERENCES concepts(id) ON DELETE CASCADE,
    mode TEXT NOT NULL, -- 'free_recall' or 'feynman'
    user_input TEXT NOT NULL,
    similarity_score NUMERIC, -- Cosine similarity coverage %
    ai_feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TYPE practice_status AS ENUM ('in_progress', 'completed');

-- Student-generated Adaptive Practice Tests (BKT Powered)
CREATE TABLE practice_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES study_spaces(id) ON DELETE CASCADE,
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL, -- e.g., 'Practice: IP Subnetting'
    source_material_ids UUID[], -- Materials selected by the student
    questions_payload JSONB NOT NULL, -- The adaptive AI-generated questions
    student_answers JSONB, -- Stores progress so they can pause and resume
    score NUMERIC,
    status practice_status DEFAULT 'in_progress',
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Mode D: BKT Adaptive Testing Telemetry
CREATE TABLE practice_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    concept_id UUID REFERENCES concepts(id) ON DELETE CASCADE,
    practice_test_id UUID REFERENCES practice_tests(id) ON DELETE CASCADE, -- Links telemetry to the specific session
    is_correct BOOLEAN NOT NULL,
    latency_ms INTEGER NOT NULL, -- Time-on-task
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
-- 5. PLAYME MODULE (GAMIFICATION)
-- ==========================================

CREATE TYPE game_type AS ENUM ('term_matcher', 'crossword', 'trivia_blast', 'boggle');

CREATE TABLE gamification_profiles (
    student_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    total_xp INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    last_active_at TIMESTAMPTZ DEFAULT now()
);

-- Logs individual procedural game sessions
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

CREATE TABLE user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    badge_name TEXT NOT NULL,
    awarded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, badge_name)
);

-- ==========================================
-- 6. NOTIFICATIONS SYSTEM
-- ==========================================

CREATE TYPE notification_type AS ENUM ('material', 'assessment', 'announcement');

-- Store individual student notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    reference_id UUID, -- Points to the specific material, assessment, or announcement ID for UI deep linking
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 7. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS on core tables
ALTER TABLE assessment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Notifications
CREATE POLICY "Students can view their own notifications"
ON notifications FOR SELECT
USING (student_id = auth.uid());

CREATE POLICY "Students can update their notifications (mark as read)"
ON notifications FOR UPDATE
USING (student_id = auth.uid());

-- Policy: Course Announcements
CREATE POLICY "Instructors manage their own course announcements"
ON course_announcements FOR ALL
USING (instructor_id = auth.uid());

CREATE POLICY "Enrolled students can view course announcements"
ON course_announcements FOR SELECT
USING (
    auth.uid() IN (SELECT student_id FROM enrollments WHERE course_id = course_announcements.course_id)
);

-- Policy: Assessment Sets are readable by instructors and enrolled students
CREATE POLICY "Assessment sets are readable by enrolled students and instructors" 
ON assessment_sets FOR SELECT 
USING (
    auth.uid() IN (SELECT student_id FROM enrollments WHERE course_id = (SELECT course_id FROM assessments WHERE id = assessment_sets.assessment_id)) OR 
    auth.uid() IN (SELECT instructor_id FROM courses WHERE id = (SELECT course_id FROM assessments WHERE id = assessment_sets.assessment_id))
);

-- Policy: Immutable Assessment Submissions (Write-Once, Read-Only, No Updates)
CREATE POLICY "Assessments are write-once by students" 
ON assessment_submissions FOR INSERT 
WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Assessments are read-only for instructors and students" 
ON assessment_submissions FOR SELECT 
USING (auth.uid() = student_id OR auth.uid() IN (
    SELECT instructor_id FROM courses WHERE id = (
        SELECT course_id FROM assessments WHERE id = assessment_submissions.assessment_id
    )
));

CREATE POLICY "Assessments cannot be updated to prevent cheating" 
ON assessment_submissions FOR UPDATE USING (false);

CREATE POLICY "Assessments cannot be deleted" 
ON assessment_submissions FOR DELETE USING (false);

-- Policy: CollabShare RLS (Owners have full access; Peers have Read-Only if published)
CREATE POLICY "Students can manage their own study spaces" 
ON study_spaces FOR ALL 
USING (auth.uid() = student_id);

CREATE POLICY "Peers can read published study spaces (CollabShare)" 
ON study_spaces FOR SELECT 
USING (is_published = true);

-- Policies for Decks
CREATE POLICY "Students manage their own decks"
ON flashcard_decks FOR ALL
USING (space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid()));

CREATE POLICY "Peers can read published decks" 
ON flashcard_decks FOR SELECT 
USING (
    space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid() OR is_published = true)
);

-- Policies for Flashcards
CREATE POLICY "Students manage their own flashcards"
ON flashcards FOR ALL
USING (deck_id IN (SELECT id FROM flashcard_decks WHERE space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid())));

CREATE POLICY "Peers can read flashcards in published spaces" 
ON flashcards FOR SELECT 
USING (
    deck_id IN (SELECT id FROM flashcard_decks WHERE space_id IN (SELECT id FROM study_spaces WHERE student_id = auth.uid() OR is_published = true))
);

-- Policies for Practice Tests
CREATE POLICY "Students manage their own practice tests"
ON practice_tests FOR ALL
USING (student_id = auth.uid());

-- ==========================================
-- 8. INDEXING FOR PERFORMANCE OPTIMIZATION
-- ==========================================

-- AI & Analytics Indexes (Existing)
-- NOTE: idx_concepts_embedding intentionally removed — pgvector HNSW/IVFFlat indexes
-- only support up to 2000 dimensions. Our embedding model (gemini-embedding-001) outputs
-- 3072 dimensions. Cosine similarity queries using the <=> operator still work correctly
-- without the index for development-scale data.
CREATE INDEX idx_bkt_student_concept ON bkt_mastery(student_id, concept_id);
CREATE INDEX idx_practice_telemetry_student ON practice_telemetry(student_id);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_notifications_student ON notifications(student_id, is_read); 

-- CRITICAL SCALABILITY UPGRADE: Foreign Key Indexes
-- Without these, queries filtering by course_id or space_id will do full-table scans
CREATE INDEX idx_materials_course ON materials(course_id);
CREATE INDEX idx_assessments_course ON assessments(course_id);
CREATE INDEX idx_assessment_sets_assessment ON assessment_sets(assessment_id);
CREATE INDEX idx_assessment_submissions_assessment ON assessment_submissions(assessment_id);
CREATE INDEX idx_flashcards_deck ON flashcards(deck_id);
CREATE INDEX idx_flashcard_decks_space ON flashcard_decks(space_id);
CREATE INDEX idx_cognitive_logs_space ON cognitive_logs(space_id);
CREATE INDEX idx_course_announcements_course ON course_announcements(course_id);

-- ==========================================
-- 9. AUTOMATION & TRIGGERS
-- ==========================================

-- Standard Updated_At Trigger (Good Sustainability Practice)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger 1: Auto-create notification for new Announcements
CREATE OR REPLACE FUNCTION notify_new_announcement()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (student_id, course_id, type, title, message, reference_id)
    SELECT student_id, NEW.course_id, 'announcement', 'New Announcement: ' || NEW.title, NEW.description, NEW.id
    FROM enrollments WHERE course_id = NEW.course_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_new_announcement
AFTER INSERT ON course_announcements
FOR EACH ROW EXECUTE FUNCTION notify_new_announcement();

-- Trigger 2: Auto-create notification for new Materials
CREATE OR REPLACE FUNCTION notify_new_material()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (student_id, course_id, type, title, message, reference_id)
    SELECT student_id, NEW.course_id, 'material', 'New Material Uploaded', 'A new resource "' || NEW.title || '" has been added.', NEW.id
    FROM enrollments WHERE course_id = NEW.course_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_new_material
AFTER INSERT ON materials
FOR EACH ROW EXECUTE FUNCTION notify_new_material();

-- Trigger 3: Auto-create notification when Assessment is Deployed
CREATE OR REPLACE FUNCTION notify_assessment_deployed()
RETURNS TRIGGER AS $$
BEGIN
    -- Only trigger when the instructor changes the status specifically to 'deployed'
    IF NEW.status = 'deployed' AND OLD.status IS DISTINCT FROM 'deployed' THEN
        INSERT INTO notifications (student_id, course_id, type, title, message, reference_id)
        SELECT student_id, NEW.course_id, 'assessment', 'Assessment Ready', 'A new ' || NEW.assessment_type || ' "' || NEW.title || '" is now available.', NEW.id
        FROM enrollments WHERE course_id = NEW.course_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_assessment_deployed
AFTER UPDATE ON assessments
FOR EACH ROW EXECUTE FUNCTION notify_assessment_deployed();

-- Trigger Function for 48-hour Streak Logic (PlayMe)
CREATE OR REPLACE FUNCTION update_study_streak()
RETURNS TRIGGER AS $$
BEGIN
    -- If last active was more than 48 hours ago, reset streak, else increment
    IF (NEW.completed_at - (SELECT last_active_at FROM gamification_profiles WHERE student_id = NEW.student_id)) > interval '48 hours' THEN
        UPDATE gamification_profiles SET current_streak = 1, last_active_at = NEW.completed_at, total_xp = total_xp + NEW.xp_earned WHERE student_id = NEW.student_id;
    ELSE
        UPDATE gamification_profiles SET current_streak = current_streak + 1, last_active_at = NEW.completed_at, total_xp = total_xp + NEW.xp_earned WHERE student_id = NEW.student_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_streak
AFTER INSERT ON game_sessions
FOR EACH ROW EXECUTE FUNCTION update_study_streak();