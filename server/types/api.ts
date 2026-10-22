import { z } from 'zod';

// Response envelopes

export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Request body schemas

// Auth

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Mirrors `profiles_username_format`. Lowercased before validation. No `@`, so it never looks like an email. */
export const UsernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/,
    '3–30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number'
  );

/** The username is resolved to an email server-side, never client-side. */
export const LoginSchema = z.object({
  username: UsernameField,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Self-edit accepts only these three fields. This schema is the only guard on role/status/grade_level:
 * the immutables trigger is inert under the service role. `.strict()` so refused keys are a 400.
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
 * The one password rule for every path that sets a password: 8+ characters with at least one
 * non-alphanumeric. Client mirror: passwordProblem() in src/lib/account.ts. Don't add more
 * composition rules.
 */
const HAS_SPECIAL = /[^A-Za-z0-9]/;

const PasswordField = z
  .string()
  .min(8, 'Use at least 8 characters')
  .regex(HAS_SPECIAL, 'Include at least one special character, for example ! ? # - or _');

/** Credential changes re-verify the current password; Supabase's updateUser() does not. */
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: PasswordField,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const ChangeEmailSchema = z.object({
  current_password: z.string().min(1),
  new_email: z.string().trim().toLowerCase().email(),
});
export type ChangeEmailInput = z.infer<typeof ChangeEmailSchema>;

/** Six-digit emailed code; trimmed because codes are usually pasted from a mail client. */
const OtpCodeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

/** Email change step 2. The client re-sends the address; verifyOtp fails if it doesn't match. */
export const ConfirmEmailChangeSchema = z
  .object({
    new_email: z.string().trim().toLowerCase().email(),
    code: OtpCodeField,
  })
  .strict();
export type ConfirmEmailChangeInput = z.infer<typeof ConfirmEmailChangeSchema>;

/** Unauthenticated. Username only; never accept an email here, or it becomes an address oracle. */
export const ForgotPasswordSchema = z.object({ username: UsernameField }).strict();
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** Unauthenticated. Uses the same PasswordField as every other path. */
export const ResetPasswordSchema = z
  .object({
    username: UsernameField,
    code: OtpCodeField,
    new_password: PasswordField,
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

// Admin: account administration

/** Roles an admin may assign. Never `admin`: further admins come from the Supabase dashboard. */
export const AssignableRole = z.enum(['student', 'educator']);

/** Mirrors `profiles_grade_level_range`. Students only. */
const GradeLevelField = z.coerce.number().int().min(7).max(10);

/**
 * A student must have a grade here: `handle_new_user()` would silently default it to 7.
 * An educator must not have one.
 */
export const CreateAccountSchema = z
  .object({
    role: AssignableRole,
    first_name: z.string().trim().min(1).max(60),
    last_name: z.string().trim().min(1).max(60),
    /** Required here; optional only on import rows. */
    username: UsernameField,
    grade_level: GradeLevelField.nullable().optional(),
    /**
     * Optional contact address (not a credential); absent means a placeholder and admin-only resets.
     * `''` is read as absent. Must be unique across accounts.
     */
    email: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().toLowerCase().email('Enter a valid email address').optional()
    ),
    /** Generated when absent and shown to the admin once. */
    password: PasswordField.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === 'student' && (v.grade_level === null || v.grade_level === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'A student needs a grade level — it decides which materials they can open',
      });
    }
    if (v.role === 'educator' && v.grade_level !== null && v.grade_level !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'An educator has no grade level — they choose grades per material at upload',
      });
    }
  });
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

/**
 * Admin profile edit. Load-bearing security: the immutables trigger is inert under the service role.
 * `status` has its own route. The route re-checks role/grade against the current row.
 */
export const UpdateAccountSchema = z
  .object({
    first_name: z.string().trim().min(1).max(60).optional(),
    last_name: z.string().trim().min(1).max(60).optional(),
    username: UsernameField.optional(),
    role: AssignableRole.optional(),
    /** Nullable so student → educator can clear it in the same request. */
    grade_level: GradeLevelField.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .superRefine((v, ctx) => {
    if (v.role === 'student' && v.grade_level === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'A student needs a grade level',
      });
    }
    if (v.role === 'educator' && typeof v.grade_level === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'An educator has no grade level',
      });
    }
  });
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;

/** Own route so the self-lockout guard has one home. */
export const SetAccountStatusSchema = z
  .object({ status: z.enum(['active', 'disabled']) })
  .strict();
export type SetAccountStatusInput = z.infer<typeof SetAccountStatusSchema>;

/** Admin reset; no current password. The recovery path that always works. */
export const ResetAccountPasswordSchema = z
  .object({ new_password: PasswordField })
  .strict();
export type ResetAccountPasswordInput = z.infer<typeof ResetAccountPasswordSchema>;

/**
 * The only admin email writer (a separate table from profiles, so its own route). Applies
 * immediately with no code, unlike self-service. Duplicates map to 409.
 */
export const SetAccountEmailSchema = z
  .object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') })
  .strict();
export type SetAccountEmailInput = z.infer<typeof SetAccountEmailSchema>;

/**
 * One import row: CreateAccountSchema with optional username (generated from the name).
 * The refine is duplicated because a refined schema can't be extended; keep the two in step.
 */
export const ImportAccountRowSchema = z
  .object({
    role: AssignableRole,
    first_name: z.string().trim().min(1).max(60),
    last_name: z.string().trim().min(1).max(60),
    username: UsernameField.optional(),
    grade_level: GradeLevelField.nullable().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    password: PasswordField.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === 'student' && (v.grade_level === null || v.grade_level === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'A student needs a grade level — it decides which materials they can open',
      });
    }
    if (v.role === 'educator' && v.grade_level !== null && v.grade_level !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grade_level'],
        message: 'An educator has no grade level — they choose grades per material at upload',
      });
    }
  });

/** Bulk creation. The cap guards Supabase's auth admin rate limit. */
export const ImportAccountsSchema = z
  .object({
    rows: z.array(ImportAccountRowSchema).min(1).max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Catch within-file duplicate usernames before any account is created. Case-insensitive.
    const seen = new Map<string, number>();
    v.rows.forEach((row, i) => {
      if (!row.username) return;
      const key = row.username.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', i, 'username'],
          message: `Duplicate of row ${first + 1} in this file`,
        });
      } else {
        seen.set(key, i);
      }
    });

    // Same for emails, which must be unique in auth.users. Blank ones get unique placeholders.
    const seenEmails = new Map<string, number>();
    v.rows.forEach((row, i) => {
      if (!row.email) return;
      const key = row.email.toLowerCase();
      const first = seenEmails.get(key);
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', i, 'email'],
          message: `The same address is on row ${first + 1} of this file`,
        });
      } else {
        seenEmails.set(key, i);
      }
    });
  });
export type ImportAccountsInput = z.infer<typeof ImportAccountsSchema>;

/** Names in, a free username out. Admin-only: it is a username-availability oracle. */
export const SuggestUsernameSchema = z
  .object({
    first_name: z.string().trim().max(60),
    last_name: z.string().trim().max(60),
  })
  .strict()
  .refine((v) => v.first_name.length > 0 || v.last_name.length > 0, {
    message: 'Enter a first or last name first',
  });
export type SuggestUsernameInput = z.infer<typeof SuggestUsernameSchema>;

/**
 * Which of these usernames/emails already exist, for the import review screen.
 * An enumeration oracle, safe only behind requireRole('admin'). Never expose it elsewhere.
 */
export const ImportPrecheckSchema = z
  .object({
    usernames: z.array(UsernameField).max(100).default([]),
    emails: z.array(z.string().trim().toLowerCase().email()).max(100).default([]),
  })
  .strict();
export type ImportPrecheckInput = z.infer<typeof ImportPrecheckSchema>;

/** Account list filters; absent means "any". */
export const ListAccountsQuerySchema = z
  .object({
    role: z.enum(['student', 'educator', 'admin']).optional(),
    grade: GradeLevelField.optional(),
    status: z.enum(['active', 'disabled']).optional(),
    /** Matched against first name, last name and username. */
    q: z.string().trim().max(60).optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();
export type ListAccountsQuery = z.infer<typeof ListAccountsQuerySchema>;

// Materials

/** Exactly one grade, mirroring `materials_grade_levels_valid`. Stays an array; don't assume a scalar. */
const GradeLevelsField = z
  .array(z.coerce.number().int().min(7).max(10))
  .length(1, 'A material is published to exactly one grade level');

/** Upload form fields (multer handles the file). `grade_levels` arrives as a JSON string. */
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
 * The only post-upload material edit: archive, grade, title, subject. Ingest-owned fields
 * (parsed_status, parse_error, is_scanned, page_count) must never be accepted. `.strict()`.
 */
export const UpdateMaterialSchema = z
  .object({
    is_archived: z.boolean().optional(),
    grade_levels: GradeLevelsField.optional(),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Keep the title under 200 characters').optional(),
    subject: z.string().trim().min(1, 'Subject is required').optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide is_archived, grade_levels, title or subject',
  });
export type UpdateMaterialInput = z.infer<typeof UpdateMaterialSchema>;

export const FetchConceptsBatchSchema = z.object({
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
});
export type FetchConceptsBatchInput = z.infer<typeof FetchConceptsBatchSchema>;

/** Educator-added concept; embedded server-side like an extracted one. */
export const CreateConceptSchema = z.object({
  term: z.string().trim().min(1, 'Term is required'),
  definition: z.string().trim().min(1, 'Definition is required'),
  source_pages: z.array(z.number().int().positive()).optional().nullable(),
});
export type CreateConceptInput = z.infer<typeof CreateConceptSchema>;

/** At least one field required. */
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

// Study spaces

/** One subject per space, required; the route re-checks it against public.subjects. */
export const CreateStudySpaceSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  subject: z.string().trim().min(1, 'Choose a subject for this study space'),
});
export type CreateStudySpaceInput = z.infer<typeof CreateStudySpaceSchema>;

/** No `subject`: a space's subject is fixed at creation. */
export const UpdateStudySpaceSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
});
export type UpdateStudySpaceInput = z.infer<typeof UpdateStudySpaceSchema>;

/** Empty body: the materials to add are derived server-side. */
export const SyncSpaceMaterialsSchema = z.object({}).passthrough();
export type SyncSpaceMaterialsInput = z.infer<typeof SyncSpaceMaterialsSchema>;

// Students own decks but not cards; cards enter a deck only through generation.

export const CreateDeckSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;

/**
 * Partial update; the handler writes only the keys it receives. For `description`, absent means
 * leave it and null means clear it.
 */
export const UpdateDeckSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    /** Display only: show the definition first. */
    answer_first: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.title === undefined && data.description === undefined && data.answer_first === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one of title, description or answer_first',
      });
    }
  });
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>;

// Flashcard generation

/** One material per call. `replace` answers the 409 when the material is already in the deck. */
export const GenerateDeckCardsSchema = z.object({
  material_id: z.string().uuid(),
  replace: z.boolean().default(false),
  /** Front: the term, or a model-written question. The back is always the educator's definition. */
  format: z.enum(['term', 'question']).default('term'),
});
export type GenerateDeckCardsInput = z.infer<typeof GenerateDeckCardsSchema>;

// Spaced repetition

export const RateFlashcardSchema = z.object({
  flashcard_id: z.string().uuid(),
  rating: z.enum(['easy', 'medium', 'hard']),
});
export type RateFlashcardInput = z.infer<typeof RateFlashcardSchema>;

// Cognitive review

export const FreeRecallSchema = z.object({
  space_id: z.string().uuid(),
  /** Exactly one material (coverage is over all its concepts). An array because older rows hold several. */
  material_ids: z
    .array(z.string().uuid())
    .min(1, 'A material must be selected')
    .max(1, 'Only one material can be evaluated at a time'),
  user_input: z.string().min(10, 'Response must be at least 10 characters'),
});
export type FreeRecallInput = z.infer<typeof FreeRecallSchema>;

/** Written coaching, stored as `ai_feedback.written_feedback`. Optional: it may fail or predate this. */
export interface FreeRecallWrittenFeedback {
  /**
   * One passage weaving what landed with what didn't, closing with a page-anchored action.
   * Don't split it into fields. It describes coverage and never certifies correctness.
   */
  feedback: string;
  /** Statements contradicting the lesson, quoted back; '' when none. Never moves the score. */
  corrections?: string;
}

/** `cognitive_logs.ai_feedback` for a Free Recall attempt. */
export interface FreeRecallFeedback {
  missed_concepts: string[];
  /** Stored for analysis only; never displayed (fixed thresholds are meaningless across materials). */
  overall_verdict: 'strong' | 'partial' | 'needs_review';
  written_feedback: FreeRecallWrittenFeedback | null;
  /** Optional: older attempts lack them. */
  covered_count?: number;
  total_concepts?: number;
}

// Feynman technique

/** The paper specifies one audience; kept as an enum so stored payloads record the rubric. */
export const FEYNMAN_AUDIENCES = ['10yr_old'] as const;

/** Only concept ids are accepted; term and definition are looked up server-side. */
export const FeynmanEvaluationSchema = z.object({
  space_id: z.string().uuid(),
  /** Exactly one material, as for Free Recall. */
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

/** Per-concept result inside `ai_feedback`. */
export interface FeynmanConceptResult {
  concept_id: string;
  term: string;
  accuracy_score: number;    // 0–100, graded against the stored definition
  simplicity_score: number;  // 0–100, graded against the audience rubric
  verdict: FeynmanVerdict;
  jargon_found: string[];
  feedback: string;

  // Analogy verification
  analogy_used: boolean;
  /** The student's comparison, or '' if none. */
  analogy_quote: string;
  /** Verdict on their analogy, or one to try if none was used. */
  analogy_idea: string;
}

/** `cognitive_logs.ai_feedback` (stored as a JSON string). */
export interface FeynmanFeedback {
  audience: FeynmanAudience;
  accuracy_score: number;    // mean across concepts
  simplicity_score: number;  // mean across concepts
  overall_feedback: string;
  jargon_found: string[];    // union across concepts
  concepts: FeynmanConceptResult[];
}


// Practice tests

/** Matches the `question_type` enum. */
export const QUESTION_FORMATS = [
  'multiple_choice',
  'true_or_false',
  'identification',
  'fill_in_the_blank',
  'matching_type',
] as const;

/** One material and no length: the server derives one question per concept, and the title. */
export const CreatePracticeTestSchema = z.object({
  space_id: z.string().uuid(),
  material_id: z.string().uuid(),
  formats: z.array(z.enum(QUESTION_FORMATS)).min(1, 'Choose at least one question type'),
});
export type CreatePracticeTestInput = z.infer<typeof CreatePracticeTestSchema>;

/**
 * One answer. Never add `is_correct` or `concept_id`: both are derived server-side.
 * `answer` is option text, 'true'/'false', or typed text.
 */
export const SubmitAnswerSchema = z.object({
  question_index: z.number().int().nonnegative(),
  answer: z.string().max(500),
  latency_ms: z.number().int().nonnegative().max(86_400_000),
});
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;

/** Stored question. `answer`/`explanation` are the key; only stripKey() may serialise questions to a browser. */
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

export interface StoredTestPayload {
  version: 1;
  questions: StoredTestQuestion[];
  /** Items that fell back to a template. */
  fallback_count?: number;
}

/** One entry of `practice_tests.student_answers`, keyed by question index. */
export interface StoredAnswer {
  answer: string;
  latency_ms: number;
}

// Gamification

// Per-item review log; shape varies by game, so validated loosely.
export const GameSessionDetailSchema = z.object({
  type: z.enum(['trivia', 'term_matcher', 'crossword']),
  items: z.array(z.record(z.string(), z.unknown())),
});

/**
 * A finished game. Space, material, game type and mastery snapshot are read server-side from
 * the owner-checked `game_content` row, never from the client. `content_id` is required.
 */
export const CreateGameSessionSchema = z.object({
  content_id: z.string().uuid(),
  accuracy: z.number().min(0).max(1).optional(),
  time_spent_ms: z.number().int().nonnegative().optional(),
  detail: GameSessionDetailSchema.optional(),
});
export type CreateGameSessionInput = z.infer<typeof CreateGameSessionSchema>;

/** No `difficulty` field: the server derives it from M_doc (paper p. 83). A sent one is stripped. */
export const GenerateGameContentSchema = z.object({
  space_id: z.string().uuid(),
  material_ids: z.array(z.string().uuid()).min(1, 'At least one material must be selected'),
  game_type: z.enum(['term_matcher', 'crossword', 'timed_trivia']),
});
export type GenerateGameContentInput = z.infer<typeof GenerateGameContentSchema>;

// No BKT request schema: mastery updates only as a side effect of tests and due flashcards.

// Chat

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

// Onboarding

/** Mirrors `OnboardingKey` in src/lib/onboarding.ts; edit both. Keys are identities: never rename one. */
export const OnboardingStepKeySchema = z.enum([
  'tour_v1',
  'tool_resources',
  'tool_flashcards',
  'tool_free_recall',
  'tool_feynman',
  'tool_adaptive_test',
  'tool_analytics',
  'tool_flashcards_study',
  'tool_free_recall_result',
  'tool_feynman_result',
]);
export type OnboardingStepKey = z.infer<typeof OnboardingStepKeySchema>;

export const MarkOnboardingSeenSchema = z
  .object({
    step_key: OnboardingStepKeySchema,
  })
  .strict();
export type MarkOnboardingSeenInput = z.infer<typeof MarkOnboardingSeenSchema>;
