// ============================================================
// ENUMS (mirroring the PostgreSQL ENUM types in schema.sql)
// ============================================================

/** Only one role exists: student. Instructor role has been removed. */
export type UserRole = 'student';

export type ParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type PracticeStatus = 'in_progress' | 'completed';

/** Active game types: term_matcher, crossword, timed_trivia. boggle and trivia_blast are deprecated. */
export type GameType = 'term_matcher' | 'crossword' | 'timed_trivia';

export type EaseRating = 'easy' | 'medium' | 'hard';

// ============================================================
// TABLE INTERFACES
// ============================================================

/** public.profiles — extends auth.users */
export interface Profile {
  id: string;              // References auth.users(id)
  role: UserRole;
  first_name: string;
  last_name: string;
  created_at: string;
}

/** public.study_spaces — student-owned learning environments */
export interface StudySpace {
  id: string;
  student_id: string | null;
  title: string;
  description: string | null;
  is_published: boolean | null;   // true = CollabShare enabled (peer read-only)
  share_token: string | null;
  created_at: string;
}

/** public.materials — student-uploaded resources inside a study space */
export interface Material {
  id: string;
  space_id: string | null;         // Linked to study_spaces (not courses)
  uploader_id: string | null;
  title: string;
  storage_path: string;            // Path within Supabase Storage bucket
  parsed_status: ParsedStatus | null;
  created_at: string;
}

/** public.concepts */
export interface Concept {
  id: string;
  material_id: string | null;
  term: string;
  definition: string;
  embedding: number[] | null;      // vector(3072) — 3072-dimensional float array
  parent_concept_id: string | null;
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

/** public.flashcards — includes spaced repetition scheduling fields */
export interface Flashcard {
  id: string;
  deck_id: string | null;
  term: string;
  definition: string;
  is_ai_generated: boolean | null;
  next_review_at: string | null;   // ISO timestamp — when to show this card next
  ease_rating: EaseRating | null;  // Last self-rating by the student
  created_at: string;
}

/** public.spaced_repetition_logs — records every flashcard rating event */
export interface SpacedRepetitionLog {
  id: string;
  student_id: string | null;
  flashcard_id: string | null;
  rating: EaseRating;              // easy=4d, medium=3d, hard=1d until next review
  reviewed_at: string;
}

/** public.cognitive_logs — Free Recall & Feynman Technique sessions */
export interface CognitiveLog {
  id: string;
  space_id: string | null;
  concept_id: string | null;       // Nullable — evaluation may span whole material
  mode: string;                    // 'free_recall' | 'feynman'
  user_input: string;
  similarity_score: number | null; // Cosine similarity 0.0–1.0
  ai_feedback: string | null;
  created_at: string;
}

/** public.practice_tests — adaptive BKT-powered test sessions */
export interface PracticeTest {
  id: string;
  space_id: string | null;
  student_id: string | null;
  title: string;
  source_material_ids: string[] | null;
  question_types: string[] | null; // e.g. ['multiple_choice', 'true_or_false']
  questions_payload: Record<string, unknown>;        // JSONB
  student_answers: Record<string, unknown> | null;   // JSONB — progress/resume state
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
  latent_mastery: number | null;   // Probability 0.0–1.0
  last_updated: string;
}

/** public.gamification_profiles */
export interface GamificationProfile {
  student_id: string;              // Primary key
  day_streak: number | null;        // Consecutive days with any study activity
  total_study_hours: number | null; // Cumulative study time across all modules
  last_active_at: string | null;
}

/** public.game_sessions */
export interface GameSession {
  id: string;
  student_id: string | null;
  material_id: string | null;
  game_type: GameType;
  accuracy: number | null;
  time_spent_ms: number | null;
  detail: Record<string, unknown> | null; // Per-item response log for review
  completed_at: string | null;
}

/** public.user_badges */
export interface UserBadge {
  id: string;
  student_id: string | null;
  badge_name: string;
  awarded_at: string | null;
}

/** public.game_content — AI-generated game content (crossword/term/trivia payloads) */
export interface GameContent {
  id: string;
  student_id: string | null;
  space_id: string | null;
  material_ids: string[];
  game_type: GameType;
  difficulty: string;                 // 'easy' | 'medium' | 'hard' — BKT calibration seam
  payload: Record<string, unknown>;   // JSONB — full CourseGameData for this game_type
  created_at: string | null;
}
