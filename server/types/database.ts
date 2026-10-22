// Enums (mirroring schema.sql)

/** Admin manages accounts; educators upload and view analytics; students learn. */
export type UserRole = 'student' | 'educator' | 'admin';

/** Account lifecycle state, from the account_status enum. */
export type AccountStatus = 'active' | 'disabled';

export type ParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type PracticeStatus = 'in_progress' | 'completed';

/** Active game types: term_matcher, crossword, timed_trivia. boggle and trivia_blast are deprecated. */
export type GameType = 'term_matcher' | 'crossword' | 'timed_trivia';

export type EaseRating = 'easy' | 'medium' | 'hard';

/** Postgres `question_type`. Mirrors `QUESTION_FORMATS` in types/api.ts. */
export type QuestionType =
  | 'multiple_choice'
  | 'identification'
  | 'matching_type'
  | 'fill_in_the_blank'
  | 'true_or_false';

/** Postgres `bkt_source`. The only two interaction modes that may move mastery. */
export type BktSource = 'flashcard' | 'adaptive_test';

// Table interfaces

/** public.profiles — extends auth.users */
export interface Profile {
  id: string;              // References auth.users(id)
  role: UserRole;
  /** The login identifier (resolved to an email server-side). Case-insensitively unique; NULL can't sign in. */
  username: string | null;
  first_name: string;
  last_name: string;
  grade_level: number | null;  // 7–10 for students; null for educators/admins
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

/** public.study_spaces — student-owned learning environments, one subject each */
export interface StudySpace {
  id: string;
  student_id: string;
  title: string;
  description: string | null;
  subject: string;                 // FK → subjects.code. Fixed at creation.
  created_at: string;
  updated_at: string;
}

/** public.study_space_materials — which educator materials a space holds */
export interface StudySpaceMaterial {
  space_id: string;
  material_id: string;
  added_at: string;
}

/** A material as the student Resources tab sees it: no educator-only columns, plus concept_count. */
export interface SpaceMaterial {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  file_size_bytes: number | null;
  page_count: number | null;
  is_scanned: boolean;
  parsed_status: ParsedStatus;
  parse_error: string | null;
  concept_count: number;
  added_at: string;
}

/** public.materials — educator-uploaded learning resources, scoped by grade level */
export interface Material {
  id: string;
  educator_id: string;             // Owner (FK → profiles.id)
  title: string;
  description: string | null;
  subject: string;                 // FK → subjects.code
  /** Exactly one grade, but kept as an array: all grade-access code is built on it. */
  grade_levels: number[];
  storage_path: string;            // Path within the private "materials" bucket
  file_size_bytes: number | null;
  page_count: number | null;
  is_scanned: boolean;
  /** NOT NULL DEFAULT 'pending'. */
  parsed_status: ParsedStatus;
  parse_error: string | null;
  is_archived: boolean;
  /** OCR transcript per page ('' if unreadable); NULL for text PDFs. Served only by GET /:id/ocr-text. */
  ocr_pages: OcrPage[] | null;
  created_at: string;
  updated_at: string;
}

/** One page of `materials.ocr_pages` — the same shape the concept extractor consumes. */
export interface OcrPage {
  page: number;
  text: string;
}

/** public.concepts */
export interface Concept {
  id: string;
  material_id: string | null;
  term: string;
  definition: string;
  embedding: number[] | null;      // vector(3072) — 3072-dimensional float array
  parent_concept_id: string | null;
  source_pages: number[] | null;   // source PDF page(s) — educator traceability
  created_at: string;
}

/** public.flashcard_decks */
export interface FlashcardDeck {
  id: string;
  space_id: string | null;
  title: string;
  description: string | null;
  /** Display only: show the definition first. */
  answer_first: boolean;
  created_at: string;
}

/** public.flashcards — includes spaced repetition scheduling fields */
export interface Flashcard {
  id: string;
  deck_id: string | null;
  term: string;
  definition: string;
  is_ai_generated: boolean | null;  // True only where the model wrote the front
  concept_id: string | null;        // Concept this card assesses — what BKT hangs on
  source_material_id: string | null;// Material it was generated from
  next_review_at: string | null;    // ISO timestamp — due when this is <= now
  ease_rating: EaseRating | null;   // Last self-rating by the student
  created_at: string;
}

/** public.spaced_repetition_logs: one row per counted (due) rating. */
export interface SpacedRepetitionLog {
  id: string;
  student_id: string | null;
  flashcard_id: string | null;
  concept_id: string | null;       // Denormalised from the card so BKT can join directly
  rating: EaseRating;              // easy=7d, medium=3d, hard=1d until next review
  interval_days: 1 | 3 | 7;        // Leitner tier applied — CHECK (interval_days IN (1,3,7))
  next_review_at: string | null;   // Where this rating pushed the card to
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

/** public.practice_telemetry — one row per question of a completed test. */
export interface PracticeTelemetry {
  id: string;
  student_id: string;
  concept_id: string;
  practice_test_id: string;
  /** Selects the observation's P(G). NOT NULL. */
  question_type: QuestionType;
  question_index: number | null;
  is_correct: boolean;
  /** Results screen only; BKT ignores it. */
  latency_ms: number;
  created_at: string;
}

/** public.bkt_mastery — P(L) per student per concept. One row, updated in place. */
export interface BktMastery {
  id: string;
  student_id: string;
  concept_id: string;
  /** P(L), 0–1. No row means P(L₀) = 0.10 at read time (rows are never pre-seeded). */
  latent_mastery: number;
  /** Reporting only; never used in the arithmetic. */
  opportunity_count: number;
  /** No trigger maintains it; writers set it. */
  last_updated: string | null;
}

/**
 * public.bkt_update_logs: append-only trace of every BKT update, the ICR evidence (paper p. 96).
 * Stores the prior, parameters and both phases. Exactly one of flashcard_id/practice_test_id is set
 * (writer convention, not a constraint).
 */
export interface BktUpdateLog {
  id: string;
  student_id: string;
  concept_id: string;
  source: BktSource;
  observation: 0 | 1;
  p_l_prior: number;
  p_guess: number;
  p_slip: number;
  p_transit: number;
  p_l_evidence: number;
  p_l_posterior: number;
  flashcard_id: string | null;
  practice_test_id: string | null;
  question_type: QuestionType | null;
  rating: 'easy' | 'medium' | 'hard' | null;
  created_at: string;
}

/** public.bkt_parameters: p_l0, p_t, p_s and eight P(G) keys. `value` is NUMERIC (arrives as a string). */
export interface BktParameter {
  key: string;
  value: number;
  description: string;
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
  /** The game_content row played; the fields below are copied from it. */
  content_id: string | null;
  space_id: string | null;
  material_id: string | null;
  game_type: GameType;
  accuracy: number | null;
  time_spent_ms: number | null;
  /** M_doc at generation, for the Difficulty Alignment check (paper p. 98). */
  mastery_snapshot: number | null;
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
  /** Derived from mastery_snapshot server-side, never client-supplied. */
  difficulty: string;
  /** M_doc passed to the prompt (paper p. 83). NULL on pre-calibration rows. */
  mastery_snapshot: number | null;
  payload: Record<string, unknown>;   // JSONB — full CourseGameData for this game_type
  created_at: string | null;
}
