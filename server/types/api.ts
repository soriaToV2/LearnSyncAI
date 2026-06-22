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
  role: z.enum(['student', 'instructor']),
  institution_id: z.string().uuid().optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// ── Courses ───────────────────────────────────────────────

export const CreateCourseSchema = z.object({
  course_title: z.string().min(1),
  course_code: z.string().optional(),
  section: z.string().optional(),
  description: z.string().optional(),
  institution_id: z.string().uuid().optional(),
});
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;

export const UpdateCourseSchema = CreateCourseSchema.partial();
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;

export const JoinCourseSchema = z.object({
  join_code: z.string().min(1),
});
export type JoinCourseInput = z.infer<typeof JoinCourseSchema>;

export const CreateAnnouncementSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;

// ── Materials ─────────────────────────────────────────────

export const CreateMaterialSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1),
});
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

// ── Assessments ───────────────────────────────────────────

export const CreateAssessmentSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1),
  assessment_type: z.enum(['quiz', 'exam']),
  start_time: z.string().datetime().optional(),
  duration_minutes: z.number().int().positive().optional(),
  source_material_ids: z.array(z.string().uuid()).min(1),
  total_questions: z.number().int().positive(),
  question_types: z.array(z.string()).min(1),
  number_of_sets: z.number().int().min(1).max(5).default(1),
});
export type CreateAssessmentInput = z.infer<typeof CreateAssessmentSchema>;

export const UpdateAssessmentStatusSchema = z.object({
  status: z.enum(['draft', 'ready', 'deployed', 'closed']),
});
export type UpdateAssessmentStatusInput = z.infer<typeof UpdateAssessmentStatusSchema>;

export const SubmitAssessmentSchema = z.object({
  assessment_set_id: z.string().uuid(),
  student_answers: z.record(z.unknown()),
  latency_ms: z.number().int().nonnegative().optional(),
});
export type SubmitAssessmentInput = z.infer<typeof SubmitAssessmentSchema>;

// ── Study Spaces ──────────────────────────────────────────

export const CreateStudySpaceSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1),
});
export type CreateStudySpaceInput = z.infer<typeof CreateStudySpaceSchema>;

export const UpdateStudySpaceSchema = z.object({
  title: z.string().min(1).optional(),
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

// ── Cognitive Review ──────────────────────────────────────

export const FreeRecallSchema = z.object({
  concept_id: z.string().uuid(),
  space_id: z.string().uuid(),
  mode: z.enum(['free_recall', 'feynman']),
  user_input: z.string().min(1),
});
export type FreeRecallInput = z.infer<typeof FreeRecallSchema>;

// ── Practice Tests ────────────────────────────────────────

export const CreatePracticeTestSchema = z.object({
  space_id: z.string().uuid(),
  title: z.string().min(1),
  source_material_ids: z.array(z.string().uuid()).min(1),
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
  game_type: z.enum(['term_matcher', 'crossword', 'trivia_blast', 'boggle']),
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
