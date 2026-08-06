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

/**
 * Validates an educator's material upload. The file itself is handled by multer;
 * this guards the accompanying form fields. `grade_levels` arrives as a multipart
 * string (e.g. "[7,8]"), so it is JSON-parsed before the array is validated.
 * Mirrors the CHECK constraints on public.materials: grades ⊆ {7,8,9,10}, ≥ 1.
 */
export const CreateMaterialSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  subject: z.string().trim().min(1, 'Subject is required'),
  description: z.string().trim().optional().nullable(),
  grade_levels: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    },
    z
      .array(z.coerce.number().int().min(7).max(10))
      .min(1, 'Select at least one grade level')
      .max(4)
  ),
});
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

export const FetchConceptsBatchSchema = z.object({
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
});
export type FetchConceptsBatchInput = z.infer<typeof FetchConceptsBatchSchema>;

/**
 * An educator manually adding a concept the extractor missed. The definition is
 * embedded server-side (gemini-embedding-001) so the concept behaves exactly like
 * an extracted one in Free Recall, the chatbot, and generated assessments.
 * `source_pages` is optional — a hand-added concept may have no page provenance.
 */
export const CreateConceptSchema = z.object({
  term: z.string().trim().min(1, 'Term is required'),
  definition: z.string().trim().min(1, 'Definition is required'),
  source_pages: z.array(z.number().int().positive()).optional().nullable(),
});
export type CreateConceptInput = z.infer<typeof CreateConceptSchema>;

/** Editing a concept. Any subset of fields; at least one must be present. */
export const UpdateConceptSchema = z
  .object({
    term: z.string().trim().min(1, 'Term cannot be empty').optional(),
    definition: z.string().trim().min(1, 'Definition cannot be empty').optional(),
    source_pages: z.array(z.number().int().positive()).optional().nullable(),
  })
  .refine((v) => v.term !== undefined || v.definition !== undefined || v.source_pages !== undefined, {
    message: 'Provide at least one field to update',
  });
export type UpdateConceptInput = z.infer<typeof UpdateConceptSchema>;

// ── Study Spaces ──────────────────────────────────────────

/**
 * A study space covers exactly one subject. The subject is what makes the space's
 * contents derivable — every non-archived material published to that subject at
 * the student's grade level — so it is required, not optional.
 * The code is re-checked against public.subjects in the route.
 */
export const CreateStudySpaceSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  subject: z.string().trim().min(1, 'Choose a subject for this study space'),
});
export type CreateStudySpaceInput = z.infer<typeof CreateStudySpaceSchema>;

/**
 * `subject` is deliberately absent: a space's decks, practice tests and mastery
 * are all built from its materials, so re-pointing it at another subject would
 * strand that work. Create a second space instead.
 */
export const UpdateStudySpaceSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
});
export type UpdateStudySpaceInput = z.infer<typeof UpdateStudySpaceSchema>;

/**
 * Pulling newly published materials into a space. The set to add is derived
 * server-side from (space.subject, student's grade level) — a client cannot name
 * which materials to attach — so the body carries nothing. Validated anyway so
 * the endpoint follows the same rule as every other POST.
 */
export const SyncSpaceMaterialsSchema = z.object({}).passthrough();
export type SyncSpaceMaterialsInput = z.infer<typeof SyncSpaceMaterialsSchema>;

// A deck is the student's own filing system — they name it, rename it and throw
// it away. Its CONTENTS are not theirs to write: there is no create/update/delete
// schema for a flashcard, because every card assesses a concept an educator
// uploaded and vetted. Cards enter a deck through generation only.

export const CreateDeckSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;

/** Renaming and re-describing only. A deck has nothing else a student may set. */
export const UpdateDeckSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
});
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>;

// ── AI Flashcard Generation ───────────────────────────────

/**
 * Filling a deck from one of the space's materials.
 *
 * One material per call, not an array: a deck gathers materials one lesson at a
 * time, and "is this material already in this deck?" is only answerable per
 * material. `replace` is the student's explicit answer to the 409 they get when
 * it already is.
 */
export const GenerateDeckCardsSchema = z.object({
  material_id: z.string().uuid(),
  replace: z.boolean().default(false),
  /**
   * 'term'     — front is the concept's term, verbatim. No model involved.
   * 'question' — front is an AI-written question. The BACK is the educator's
   *              definition either way; the model never writes the answer.
   */
  format: z.enum(['term', 'question']).default('term'),
});
export type GenerateDeckCardsInput = z.infer<typeof GenerateDeckCardsSchema>;

// ── Spaced Repetition ────────────────────────────────────

export const RateFlashcardSchema = z.object({
  flashcard_id: z.string().uuid(),
  rating: z.enum(['easy', 'medium', 'hard']),
});
export type RateFlashcardInput = z.infer<typeof RateFlashcardSchema>;

// ── Cognitive Review ──────────────────────────────────────

export const FreeRecallSchema = z.object({
  space_id: z.string().uuid(),
  /**
   * Exactly one material. The score is a coverage ratio over every concept in the
   * selection, so spanning two lessons doubles the denominator and reports a
   * student who recalled one of them well as having recalled little.
   *
   * Stays an ARRAY despite the cap: `cognitive_logs.material_ids` is `UUID[]` and
   * older attempts genuinely hold several, which History must keep rendering.
   * Only new submissions are capped.
   */
  material_ids: z
    .array(z.string().uuid())
    .min(1, 'A material must be selected')
    .max(1, 'Only one material can be evaluated at a time'),
  user_input: z.string().min(10, 'Response must be at least 10 characters'),
});
export type FreeRecallInput = z.infer<typeof FreeRecallSchema>;

/**
 * Written coaching on a Free Recall attempt, nested inside the `ai_feedback`
 * JSON string as `written_feedback`.
 *
 * Optional everywhere it is read: generation is allowed to fail without taking
 * the score down with it, and attempts logged before this shipped have none.
 */
export interface FreeRecallWrittenFeedback {
  /**
   * The whole written response: what landed, what did not, and — as its closing
   * sentence — one concrete thing to do next, naming the page it is on.
   *
   * ONE field, arrived at by removing two. It was `strengths`/`gaps`/`next_steps`,
   * where the model had to fill three slots from one set of observations and ran
   * out: in every logged attempt `next_steps` merely paraphrased `gaps`. Merging
   * the first two fixed that. The remaining split was then kept on the theory
   * that a concrete action is the hardest sentence to write and would be crowded
   * out of a free passage — **that was measured and disproved.** Run on two
   * stored submissions, including a 28/28 attempt with no obvious gap to point
   * at, the merged prompt still closed with "try reviewing Injection on page 24"
   * and "review security headers on page 39". Do not split it again on that
   * reasoning.
   *
   * It describes COVERAGE, never certifies correctness. Coverage is decided by
   * cosine similarity, which measures whether the student wrote ABOUT a concept,
   * not whether they were right — a sentence calling RA 10175 the Data Privacy
   * Act scored 0.7175 and counted as covered. Contradictions belong in
   * `corrections`, which is checked against the lesson's own definitions.
   */
  feedback: string;
  /**
   * Statements that contradict the lesson's own definitions, quoted back in the
   * student's words. Empty string when nothing conflicts.
   *
   * Prose only — this NEVER moves `similarity_score`. Coverage stays a pure
   * cosine computation, which keeps the score deterministic given the
   * extraction and keeps this call on GEMINI_UTILITY_MODEL under the rule in
   * CLAUDE.md: the model's judgement here becomes words, not a number.
   *
   * Optional: attempts logged before this shipped carry none.
   */
  corrections?: string;
}

/** Full payload stored in `cognitive_logs.ai_feedback` for a Free Recall attempt. */
export interface FreeRecallFeedback {
  missed_concepts: string[];
  /**
   * Retained as DATA, no longer shown to the student.
   *
   * It was derived from fixed thresholds (>= 0.30 strong, >= 0.15 partial) tuned
   * against a 78-concept lesson, but the denominator is whichever material was
   * selected. On a 29-concept material an 86% answer and a 36% answer containing
   * two factual errors both came back "strong", so the label carried no
   * information. The UI now leads with the covered/total count and the student's
   * own progress on that same material.
   *
   * Still computed and stored so the payload shape is unchanged and the
   * distribution stays available for later analysis.
   */
  overall_verdict: 'strong' | 'partial' | 'needs_review';
  written_feedback: FreeRecallWrittenFeedback | null;
  /**
   * Stored so a past attempt can say "covered 15 of 78" without recomputing.
   * Optional: attempts logged before this shipped carry neither.
   */
  covered_count?: number;
  total_concepts?: number;
}

// ── Feynman Technique ─────────────────────────────────────

/**
 * The paper specifies exactly one audience — "a 10-year-old child" — so the
 * rubric is fixed. Kept as a single-value enum rather than dropped entirely:
 * every stored `ai_feedback` payload records which rubric graded it, so a
 * future audience is one entry here plus one rubric, not a data migration.
 */
export const FEYNMAN_AUDIENCES = ['10yr_old'] as const;

/**
 * A Feynman submission explains one or more concepts to the target audience.
 * Only `concept_id` is accepted — the authoritative `term` and `definition`
 * are looked up server-side so a client cannot grade itself against a
 * definition it invented.
 */
export const FeynmanEvaluationSchema = z.object({
  space_id: z.string().uuid(),
  /**
   * Exactly one material — see the note on FreeRecallSchema. Here it also keeps
   * term grouping honest: the same term in two materials is two different lessons'
   * definitions, and grading an explanation against both would be judging the
   * student on a lesson they did not choose.
   */
  material_ids: z
    .array(z.string().uuid())
    .min(1, 'A material must be selected')
    .max(1, 'Only one material can be evaluated at a time'),
  audience: z.enum(FEYNMAN_AUDIENCES).default('10yr_old'),
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

  // ── Analogy Verification (pipeline step 2) ──────────────────────────────
  // Using an everyday comparison already moved `simplicity_score`, because the
  // rubric tells the model to reward one. These three fields make that visible:
  // the student is told whether they used one, which one, and whether it lands.
  /** Did the student's own explanation contain an everyday comparison? */
  analogy_used: boolean;
  /** The student's comparison in their own words. Empty when none was used. */
  analogy_quote: string;
  /** Verdict on their analogy, or — when none was used — one they could try. */
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

// Per-item response log stored on the session for post-game review. Shape
// varies by game (trivia questions / matched pairs / crossword words), so it's
// validated loosely as { type, items[] } and rendered by the frontend.
export const GameSessionDetailSchema = z.object({
  type: z.enum(['trivia', 'term_matcher', 'crossword']),
  items: z.array(z.record(z.string(), z.unknown())),
});

// XP was removed as a feature (not in the official spec).
export const CreateGameSessionSchema = z.object({
  material_id: z.string().uuid(),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
  accuracy: z.number().min(0).max(1).optional(),
  time_spent_ms: z.number().int().nonnegative().optional(),
  detail: GameSessionDetailSchema.optional(),
});
export type CreateGameSessionInput = z.infer<typeof CreateGameSessionSchema>;

// AI generation of game content from a study space's materials.
// `difficulty` is a seam for future BKT calibration; it currently only tunes the prompt.
export const GenerateGameContentSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});
export type GenerateGameContentInput = z.infer<typeof GenerateGameContentSchema>;

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
