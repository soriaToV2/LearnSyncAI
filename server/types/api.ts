import { z } from 'zod';

// ============================================================
// STANDARD API RESPONSE WRAPPERS
// ============================================================

/** Standard success response envelope */
export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
}

/** Standard error response envelope */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// ZOD VALIDATION SCHEMAS — Request Body Validators
// ============================================================

// ── Auth ──────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  // role is always 'student' — no instructor role
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// ── Materials ─────────────────────────────────────────────

export const CreateMaterialSchema = z.object({
  space_id: z.string().uuid(),    // Now linked to study_spaces, not courses
  title: z.string().min(1),
});
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

export const FetchConceptsBatchSchema = z.object({
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
});
export type FetchConceptsBatchInput = z.infer<typeof FetchConceptsBatchSchema>;

// ── Study Spaces ──────────────────────────────────────────

export const CreateStudySpaceSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
});
export type CreateStudySpaceInput = z.infer<typeof CreateStudySpaceSchema>;

export const UpdateStudySpaceSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  is_published: z.boolean().optional(),
});
export type UpdateStudySpaceInput = z.infer<typeof UpdateStudySpaceSchema>;

export const CreateDeckSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;

export const CreateFlashcardSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  is_ai_generated: z.boolean().default(false),
});
export type CreateFlashcardInput = z.infer<typeof CreateFlashcardSchema>;

// ── AI Flashcard Generation ───────────────────────────────

export const GenerateFlashcardsSchema = z.object({
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  format: z.enum(['question', 'term']).default('question'),
});
export type GenerateFlashcardsInput = z.infer<typeof GenerateFlashcardsSchema>;

// ── Spaced Repetition ────────────────────────────────────

export const RateFlashcardSchema = z.object({
  flashcard_id: z.string().uuid(),
  rating: z.enum(['easy', 'medium', 'hard']),
});
export type RateFlashcardInput = z.infer<typeof RateFlashcardSchema>;

// ── Cognitive Review ──────────────────────────────────────

export const FreeRecallSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  user_input: z.string().min(10, 'Response must be at least 10 characters'),
});
export type FreeRecallInput = z.infer<typeof FreeRecallSchema>;

// Kept for legacy Feynman Technique usage
export const CognitiveReviewSchema = z.object({
  space_id: z.string().uuid(),
  concept_id: z.string().uuid().optional().nullable(),  // Optional for whole-material evaluation
  mode: z.enum(['free_recall', 'feynman']),
  user_input: z.string().min(1),
});
export type CognitiveReviewInput = z.infer<typeof CognitiveReviewSchema>;

// ── Feynman Technique ─────────────────────────────────────

export const FEYNMAN_AUDIENCES = ['10yr_old', 'self'] as const;

/**
 * A Feynman submission explains one or more concepts to a chosen audience.
 * Only `concept_id` is accepted — the authoritative `term` and `definition`
 * are looked up server-side so a client cannot grade itself against a
 * definition it invented.
 */
export const FeynmanEvaluationSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  audience: z.enum(FEYNMAN_AUDIENCES),
  explanations: z
    .array(
      z.object({
        concept_id: z.string().uuid(),
        explanation: z.string().min(10, 'Explanation must be at least 10 characters'),
      })
    )
    .min(1, 'At least one concept must be explained'),
});
export type FeynmanEvaluationInput = z.infer<typeof FeynmanEvaluationSchema>;

export type FeynmanAudience = (typeof FEYNMAN_AUDIENCES)[number];
export type FeynmanVerdict = 'correct' | 'needs_improvement' | 'incorrect';

/** Per-concept grading result, nested inside the `ai_feedback` JSON string. */
export interface FeynmanConceptResult {
  concept_id: string;
  term: string;
  accuracy_score: number;    // 0–100, graded against the stored definition
  simplicity_score: number;  // 0–100, graded against the audience rubric
  verdict: FeynmanVerdict;
  jargon_found: string[];
  feedback: string;
  analogy_idea: string;
}

/** Full payload stored in `cognitive_logs.ai_feedback` (as a JSON string). */
export interface FeynmanFeedback {
  audience: FeynmanAudience;
  accuracy_score: number;    // mean across concepts
  simplicity_score: number;  // mean across concepts
  overall_feedback: string;
  jargon_found: string[];    // union across concepts
  concepts: FeynmanConceptResult[];
}


// ── Practice Tests ────────────────────────────────────────

export const CreatePracticeTestSchema = z.object({
  space_id: z.string().uuid(),
  title: z.string().min(1),
  source_material_ids: z.array(z.string().uuid()).min(1),
  question_types: z.array(
    z.enum(['multiple_choice', 'identification', 'matching_type', 'fill_in_the_blank', 'true_or_false'])
  ).min(1),
});
export type CreatePracticeTestInput = z.infer<typeof CreatePracticeTestSchema>;

export const SubmitAnswerSchema = z.object({
  question_index: z.number().int().nonnegative(),
  answer: z.unknown(),
  concept_id: z.string().uuid(),
  is_correct: z.boolean(),
  latency_ms: z.number().int().nonnegative(),
});
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;

// ── Gamification ──────────────────────────────────────────

export const CreateGameSessionSchema = z.object({
  material_id: z.string().uuid(),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
  xp_earned: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1).optional(),
  time_spent_ms: z.number().int().nonnegative().optional(),
});
export type CreateGameSessionInput = z.infer<typeof CreateGameSessionSchema>;

// ── BKT ───────────────────────────────────────────────────

export const BktRecalculateSchema = z.object({
  concept_ids: z.array(z.string().uuid()).min(1).optional(),
});
export type BktRecalculateInput = z.infer<typeof BktRecalculateSchema>;

// ── Chat (Study Assistant) ────────────────────────────────

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  space_id: z.string().uuid(),
  message: z.string().min(1),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  history: z.array(ChatMessageSchema).optional().default([]),
  /** 'rag' uses embedding search for specific questions. 'full' fetches all concepts (for summaries). */
  mode: z.enum(['rag', 'full']).optional().default('rag'),
});
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
