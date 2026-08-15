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

/**
 * Mirrors `profiles_username_format` in schema.sql — 3–30 chars, lowercase
 * alphanumerics plus dot and underscore, never opening or closing on
 * punctuation. Lowercased before validation so `Juan` is accepted and stored as
 * `juan`; `ux_profiles_username_lower` makes the two the same account either way.
 *
 * No `@`, deliberately: a username that looks like an email invites the very
 * confusion migration 0021 removed.
 */
export const UsernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/,
    '3–30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number'
  );

/** Sign-in. The username is resolved to an email server-side — never client-side. */
export const LoginSchema = z.object({
  username: UsernameField,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * The ONLY writer for a user's own profile, and it accepts exactly three fields.
 *
 * ⚠️ `role`, `status` and `grade_level` are OMITTED ON PURPOSE, and this schema
 * is the only thing enforcing that. `enforce_profile_immutables()` looks like it
 * covers them, but its first branch is `IF auth.uid() IS NULL … RETURN NEW` and
 * `auth.uid()` is NULL for the service role — which is what Express holds, so the
 * trigger is inert for every request that reaches the API.
 *
 * `grade_level` is the load-bearing one: `materialAccess.ts` gates every student
 * read on `grade_levels @> [caller.gradeLevel]`, so a student who could PATCH
 * their own grade would read another year's materials. Same rule as
 * `UpdateMaterialSchema` — one writer, nothing else accepted.
 *
 * `.strict()` so an unknown key is a 400 rather than being silently dropped:
 * a client sending `grade_level` should be told it was refused, not left to
 * believe a 200 meant it applied.
 */
export const UpdateProfileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(60).optional(),
    last_name: z.string().trim().min(1).max(60).optional(),
    username: UsernameField.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/**
 * Both credential changes re-verify the current password first.
 * `supabase.auth.updateUser()` does not check it, so without this a session left
 * open on a shared school computer is a permanent account takeover.
 */
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Use at least 8 characters'),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const ChangeEmailSchema = z.object({
  current_password: z.string().min(1),
  new_email: z.string().trim().toLowerCase().email(),
});
export type ChangeEmailInput = z.infer<typeof ChangeEmailSchema>;

// ── Materials ─────────────────────────────────────────────

/**
 * A material is published to EXACTLY ONE grade level.
 *
 * Mirrors `materials_grade_levels_valid`, which is
 * `grade_levels <@ ARRAY[7,8,9,10] AND array_length(grade_levels, 1) = 1`.
 * The column stays SMALLINT[] because every grade-access path in the app is
 * built on the array form — `@>` in `materialAccess.ts`, `= ANY(...)` in five
 * RLS policies and `v_grade_level_mastery`, `unnest()` in
 * `private.auth_assigned_grades()`, and a GIN index. The single-element rule is
 * the CHECK's job, not the column type's.
 */
const GradeLevelsField = z
  .array(z.coerce.number().int().min(7).max(10))
  .length(1, 'A material is published to exactly one grade level');

/**
 * Validates an educator's material upload. The file itself is handled by multer;
 * this guards the accompanying form fields. `grade_levels` arrives as a multipart
 * string (e.g. "[8]"), so it is JSON-parsed before the array is validated.
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
    GradeLevelsField
  ),
});
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>;

/**
 * The two things an educator may change about a material after upload.
 *
 * ⚠️ EVERYTHING ELSE IS DELIBERATELY ABSENT, and this is not an oversight to be
 * filled in later:
 *
 *  - `subject` — a study space is built from its subject plus the materials
 *    published to it, so re-pointing a material's subject would strand it in
 *    every space already holding it. `UpdateStudySpaceSchema` omits subject for
 *    the mirror-image reason.
 *  - `parsed_status` / `parse_error` / `is_scanned` / `page_count` — owned by the
 *    ingest pipeline. Accepting them would let an educator mark a failed material
 *    Ready and push a concept-less material into students' study spaces.
 *  - `title` / `description` — no UI asks for them, and this route must stay the
 *    answer to "archive and grade access", not become a general row editor.
 *
 * At least one field must be present, or the request is a no-op that would still
 * bump `updated_at`.
 */
export const UpdateMaterialSchema = z
  .object({
    is_archived: z.boolean().optional(),
    grade_levels: GradeLevelsField.optional(),
  })
  .refine((v) => v.is_archived !== undefined || v.grade_levels !== undefined, {
    message: 'Provide is_archived or grade_levels',
  });
export type UpdateMaterialInput = z.infer<typeof UpdateMaterialSchema>;

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

/** The five formats, spelled exactly as the Postgres `question_type` enum. */
export const QUESTION_FORMATS = [
  'multiple_choice',
  'true_or_false',
  'identification',
  'fill_in_the_blank',
  'matching_type',
] as const;

/**
 * Building a practice test.
 *
 * ONE MATERIAL, and NO LENGTH. The test is one question per concept in that
 * material, and the count is derived server-side by `allocateConcepts()` — a
 * client-supplied length is a client-chosen test, and a student could ask for
 * five questions while still banking BKT evidence. The title is likewise derived
 * from the material rather than accepted, so it cannot disagree with the row it
 * describes.
 */
export const CreatePracticeTestSchema = z.object({
  space_id: z.string().uuid(),
  material_id: z.string().uuid(),
  formats: z.array(z.enum(QUESTION_FORMATS)).min(1, 'Choose at least one question type'),
});
export type CreatePracticeTestInput = z.infer<typeof CreatePracticeTestSchema>;

/**
 * Recording one answer as the student works.
 *
 * `is_correct` and `concept_id` USED TO BE HERE AND MUST NOT COME BACK. Both are
 * derivable from `questions_payload[question_index]`, and accepting them let a
 * student post arbitrary correctness for any concept — the write RLS exists to
 * make impossible from a browser, handed over by the API instead.
 *
 * `answer` is the option text, `'true'`/`'false'`, or what the student typed;
 * capped because it lands in a JSONB column that grows with the test.
 */
export const SubmitAnswerSchema = z.object({
  question_index: z.number().int().nonnegative(),
  answer: z.string().max(500),
  latency_ms: z.number().int().nonnegative().max(86_400_000),
});
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;

/**
 * A question as stored in `practice_tests.questions_payload`.
 *
 * `answer` and `explanation` are the answer key. They are stripped by
 * `stripKey()` in `practice.routes.ts`, which is the ONLY function permitted to
 * serialise a question toward a browser — so adding a field here cannot leak it
 * by accident.
 */
export interface StoredTestQuestion {
  index: number;
  concept_id: string;
  concept_term: string;
  format: (typeof QUESTION_FORMATS)[number];
  difficulty: 'foundational' | 'intermediate' | 'advanced';
  prompt: string;
  options?: string[];
  blockId?: string;
  answer: string;
  explanation: string;
}

/** The envelope `questions_payload` actually holds. Versioned for future shape changes. */
export interface StoredTestPayload {
  version: 1;
  questions: StoredTestQuestion[];
  /** Items whose text came from a template because the model skipped them. */
  fallback_count?: number;
}

/** One entry of `practice_tests.student_answers`, keyed by question index. */
export interface StoredAnswer {
  answer: string;
  latency_ms: number;
}

// ── Gamification ──────────────────────────────────────────

// Per-item response log stored on the session for post-game review. Shape
// varies by game (trivia questions / matched pairs / crossword words), so it's
// validated loosely as { type, items[] } and rendered by the frontend.
export const GameSessionDetailSchema = z.object({
  type: z.enum(['trivia', 'term_matcher', 'crossword']),
  items: z.array(z.record(z.string(), z.unknown())),
});

/**
 * A finished game. XP was removed as a feature (not in the official spec).
 *
 * EVERYTHING IDENTIFYING WHAT WAS PLAYED COMES FROM THE `game_content` ROW, not
 * from the client — `space_id`, `material_id`, `game_type` and `mastery_snapshot`
 * are all read server-side from the row `content_id` names, after checking the
 * caller owns it. Same principle as `SubmitAnswerSchema` deliberately carrying no
 * `is_correct`: a client-asserted mastery snapshot is a client-chosen one, and
 * this one is the evidence the paper's Difficulty Alignment check (p. 98) reads.
 *
 * `material_id` used to be here as a bare uuid gated by nothing, which CLAUDE.md's
 * "every student-reachable route that takes a material ID must gate it" forbids.
 *
 * `content_id` is REQUIRED, not optional. Mock mode is not a counter-argument —
 * `recordSession()` already returns early when there is no content id, so it has
 * never reached this endpoint. Optional would let a real caller forget it and
 * silently write an uncalibrated row.
 */
export const CreateGameSessionSchema = z.object({
  content_id: z.string().uuid(),
  accuracy: z.number().min(0).max(1).optional(),
  time_spent_ms: z.number().int().nonnegative().optional(),
  detail: GameSessionDetailSchema.optional(),
});
export type CreateGameSessionInput = z.infer<typeof CreateGameSessionSchema>;

/**
 * AI generation of game content from a study space's materials.
 *
 * THERE IS DELIBERATELY NO `difficulty` FIELD. It is derived server-side from the
 * student's M_doc over the selected materials (paper p. 83), because a
 * client-supplied difficulty is a client-chosen difficulty and would defeat the
 * calibration entirely — the same reasoning as `testAllocation.ts` re-deriving
 * test length rather than accepting one. A stale client still sending `difficulty`
 * has it silently stripped, which is correct; verify by reading the stored row,
 * not the response code.
 */
export const GenerateGameContentSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
});
export type GenerateGameContentInput = z.infer<typeof GenerateGameContentSchema>;

/*
 * There is deliberately no BKT request schema.
 *
 * `BktRecalculateSchema` lived here for a `POST /api/bkt/recalculate` that
 * proxied to a pyBKT microservice. BKT is not something a client asks for — it
 * is a consequence of completing a test or rating a due flashcard, and both of
 * those already validate their own bodies. A recalculate endpoint would also be
 * a third mastery writer, which paper p. 58 does not allow.
 */

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
