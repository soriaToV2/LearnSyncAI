// ============================================================
// ENUMS (mirroring the PostgreSQL ENUM types in schema.sql)
// ============================================================

export type UserRole = 'student' | 'instructor';

export type ParsedStatus = 'pending' | 'processing' | 'completed';

export type AssessmentType = 'quiz' | 'exam';

export type AssessmentStatus = 'draft' | 'ready' | 'deployed' | 'closed';

export type PracticeStatus = 'in_progress' | 'completed';

export type GameType = 'term_matcher' | 'crossword' | 'trivia_blast' | 'boggle';

export type NotificationType = 'material' | 'assessment' | 'announcement';

// ============================================================
// TABLE INTERFACES
// ============================================================

/** public.institutions */
export interface Institution {
  id: string;
  name: string;
  created_at: string;
}

/** public.profiles — extends auth.users */
export interface Profile {
  id: string;              // References auth.users(id)
  role: UserRole;
  institution_id: string | null;
  first_name: string;
  last_name: string;
  created_at: string;
}

/** public.courses */
export interface Course {
  id: string;
  institution_id: string | null;
  instructor_id: string | null;
  course_title: string;
  course_code: string | null;
  section: string | null;
  description: string | null;
  join_code: string | null;
  created_at: string;
}

/** public.enrollments */
export interface Enrollment {
  id: string;
  course_id: string | null;
  student_id: string | null;
  enrolled_at: string;
}

/** public.course_announcements */
export interface CourseAnnouncement {
  id: string;
  course_id: string | null;
  instructor_id: string | null;
  title: string;
  description: string;
  created_at: string;
}

/** public.materials */
export interface Material {
  id: string;
  course_id: string | null;
  uploader_id: string | null;
  title: string;
  storage_path: string;        // Path within Supabase Storage bucket
  parsed_status: ParsedStatus | null;
  created_at: string;
}

/** public.concepts */
export interface Concept {
  id: string;
  material_id: string | null;
  term: string;
  definition: string;
  embedding: number[] | null;  // vector(768) — 768-dimensional float array
  parent_concept_id: string | null;
  created_at: string;
}

/** public.assessments */
export interface Assessment {
  id: string;
  course_id: string | null;
  title: string;
  assessment_type: AssessmentType;
  start_time: string | null;
  duration_minutes: number | null;
  source_material_ids: string[] | null;  // UUID[]
  total_questions: number | null;
  question_types: string[] | null;       // e.g. ['multiple_choice', 'essay']
  number_of_sets: number | null;
  status: AssessmentStatus | null;
  created_at: string;
}

/** public.assessment_sets */
export interface AssessmentSet {
  id: string;
  assessment_id: string | null;
  set_name: string;                      // e.g. 'Set A', 'Set B'
  questions_payload: Record<string, unknown>;  // JSONB — AI-generated questions
  created_at: string;
}

/** public.assessment_submissions */
export interface AssessmentSubmission {
  id: string;
  assessment_id: string | null;
  assessment_set_id: string | null;
  student_id: string | null;
  student_answers: Record<string, unknown>;  // JSONB — submitted answers
  score: number | null;
  latency_ms: number | null;
  submitted_at: string;
}

/** public.study_spaces */
export interface StudySpace {
  id: string;
  student_id: string | null;
  course_id: string | null;
  title: string;
  is_published: boolean | null;
  share_token: string | null;
  created_at: string;
}

/** public.flashcard_decks */
export interface FlashcardDeck {
  id: string;
  space_id: string | null;
  title: string;
  description: string | null;
  created_at: string;
}

/** public.flashcards */
export interface Flashcard {
  id: string;
  deck_id: string | null;
  term: string;
  definition: string;
  is_ai_generated: boolean | null;
  created_at: string;
}

/** public.cognitive_logs */
export interface CognitiveLog {
  id: string;
  space_id: string | null;
  concept_id: string | null;
  mode: string;               // 'free_recall' | 'feynman'
  user_input: string;
  similarity_score: number | null;  // Cosine similarity 0.0–1.0
  ai_feedback: string | null;
  created_at: string;
}

/** public.practice_tests */
export interface PracticeTest {
  id: string;
  space_id: string | null;
  student_id: string | null;
  title: string;
  source_material_ids: string[] | null;
  questions_payload: Record<string, unknown>;  // JSONB
  student_answers: Record<string, unknown> | null;  // JSONB — progress/resume state
  score: number | null;
  status: PracticeStatus | null;
  created_at: string;
  completed_at: string | null;
}

/** public.practice_telemetry */
export interface PracticeTelemetry {
  id: string;
  student_id: string | null;
  concept_id: string | null;
  practice_test_id: string | null;
  is_correct: boolean;
  latency_ms: number;
  created_at: string;
}

/** public.bkt_mastery */
export interface BktMastery {
  id: string;
  student_id: string | null;
  concept_id: string | null;
  latent_mastery: number | null;  // Probability 0.0–1.0
  last_updated: string;
}

/** public.gamification_profiles */
export interface GamificationProfile {
  student_id: string;   // This IS the primary key (no separate id column)
  total_xp: number | null;
  current_streak: number | null;
  last_active_at: string | null;
}

/** public.game_sessions */
export interface GameSession {
  id: string;
  student_id: string | null;
  material_id: string | null;
  game_type: GameType;
  xp_earned: number;
  accuracy: number | null;
  time_spent_ms: number | null;
  completed_at: string | null;
}

/** public.user_badges */
export interface UserBadge {
  id: string;
  student_id: string | null;
  badge_name: string;
  awarded_at: string | null;
}

/** public.notifications */
export interface Notification {
  id: string;
  student_id: string | null;
  course_id: string | null;
  type: NotificationType;
  title: string;
  message: string | null;
  reference_id: string | null;  // Points to the related material/assessment/announcement
  is_read: boolean | null;
  created_at: string;
}
