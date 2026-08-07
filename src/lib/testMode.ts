import {
  ListChecks,
  ToggleLeft,
  PenLine,
  TextCursorInput,
  GitMerge,
  type LucideIcon,
} from 'lucide-react';
import { api } from './api';

/**
 * Test Mode — the contract between the UI and the backend.
 *
 * Every type here mirrors a column or enum in `schema.sql`, so there is nothing
 * to reconcile between the shapes the components consume and the shapes
 * `server/routes/practice.routes.ts` returns.
 *
 * `allocateConcepts()` below is a MIRROR. `server/lib/testAllocation.ts` is
 * authoritative — it counts concepts itself and re-derives the allocation; this
 * copy only drives the setup preview. Same arrangement as
 * `src/lib/reviewSchedule.ts` ↔ `server/lib/reviewSchedule.ts`. Change one,
 * change the other.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exactly the Postgres `question_type` enum. One spelling, app-wide.
 *
 * There were three incompatible spellings of these same five formats: the old
 * tab's `'multiple-choice'`, the generation prompt's `'true_false' |
 * 'short_answer'` (neither of which is a valid enum member), and the database's
 * own. `practice_telemetry.question_type` is `NOT NULL` and selects the P(G)
 * used by the BKT update, so a format id that cannot be written straight into
 * that column is a format id that silently costs the student their observation.
 */
export type QuestionFormat =
  | 'multiple_choice'
  | 'true_or_false'
  | 'identification'
  | 'fill_in_the_blank'
  | 'matching_type';

/** Exactly `practice_tests.difficulty_tier`'s CHECK, and `mastery_tier()` in schema.sql. */
export type DifficultyTier = 'foundational' | 'intermediate' | 'advanced';

/**
 * The single source of every format label, blurb and ordering in the app.
 *
 * `sectionOrder` is the traditional order of a Philippine exam paper and is what
 * assigns Test I..Test V. Nothing else may hardcode a format's display name.
 */
export const FORMAT_META: Record<
  QuestionFormat,
  { label: string; short: string; blurb: string; icon: LucideIcon; sectionOrder: number }
> = {
  multiple_choice: {
    label: 'Multiple Choice',
    short: 'MCQ',
    blurb: 'Pick the best answer out of four options.',
    icon: ListChecks,
    sectionOrder: 1,
  },
  true_or_false: {
    label: 'True or False',
    short: 'T/F',
    blurb: 'Decide whether a statement about the lesson holds.',
    icon: ToggleLeft,
    sectionOrder: 2,
  },
  identification: {
    label: 'Identification',
    short: 'ID',
    blurb: 'Read a description and name the term it defines.',
    icon: PenLine,
    sectionOrder: 3,
  },
  fill_in_the_blank: {
    label: 'Fill in the Blank',
    short: 'FIB',
    blurb: 'Complete a sentence taken from the lesson.',
    icon: TextCursorInput,
    sectionOrder: 4,
  },
  matching_type: {
    label: 'Matching Type',
    short: 'Match',
    blurb: 'Match four terms against six definitions.',
    icon: GitMerge,
    sectionOrder: 5,
  },
};

export const ALL_FORMATS: QuestionFormat[] = (
  Object.keys(FORMAT_META) as QuestionFormat[]
).sort((a, b) => FORMAT_META[a].sectionOrder - FORMAT_META[b].sectionOrder);

/**
 * A matching block is 4 terms against 6 definitions. Paper p. 75:
 *
 *   "Matching Type (4 terms, 6 definitions): P(G_match) = 0.17. For any
 *    individual term, the probability of selecting the correct definition from
 *    the pool of six through random guessing is 1/6 ≈ 0.17, applied per
 *    matched item."
 *
 * Two separate rules, and they are load-bearing for different reasons:
 *
 * - SIX OPTIONS is the BKT rule. 1/6 is the guess probability the update
 *   applies, so an option pool of any other size makes the maths wrong.
 * - FOUR TERMS is a fidelity rule, NOT a BKT rule. "Applied per matched item"
 *   means each term is scored against the pool of six on its own, so a block of
 *   two terms would compute perfectly well — the term count never enters the
 *   formula. It is enforced because the paper and the `schema.sql` seed comment
 *   both state it, and code that quietly does otherwise misleads whoever reads
 *   the spec next.
 *
 * The priority follows from that: if these two ever conflict with something that
 * genuinely affects scoring, bend the term count, never the option count.
 *
 * `allocateConcepts()` is what enforces four — matching only ever receives a
 * multiple of 4, and leftovers go to the other sections.
 */
export const MATCH_TERMS_PER_BLOCK = 4;
export const MATCH_OPTIONS_PER_BLOCK = 6;

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** The chosen formats in exam-paper order. */
export function orderedFormats(formats: QuestionFormat[]): QuestionFormat[] {
  return [...new Set(formats)].sort(
    (a, b) => FORMAT_META[a].sectionOrder - FORMAT_META[b].sectionOrder
  );
}

/**
 * `'Test III'` — numbered across the formats the student actually chose, not
 * across all five. Picking MCQ and Matching gives Test I and Test II, so the
 * paper never has a gap in its numbering.
 */
export function sectionLabel(formats: QuestionFormat[], format: QuestionFormat): string {
  const idx = orderedFormats(formats).indexOf(format);
  return idx < 0 ? 'Test' : `Test ${ROMAN[idx] ?? idx + 1}`;
}

export interface Allocation {
  items: { format: QuestionFormat; count: number }[];
  /** Concepts that actually get a question. Equals `conceptCount` unless matching rounds down. */
  covered: number;
  /** Matching was asked for but there was no room for a whole block of four. */
  matchingDropped: boolean;
}

/**
 * Which concept goes to which section. **This is the rule that decides how long
 * a test is: one question per concept, always.**
 *
 * The student does not choose a length. A length picker meant cycling concepts
 * to fill it, so a 40-item test on a 29-concept lesson asked about some concepts
 * three or four times in one sitting — and four back-to-back answers on one
 * concept are not four independent observations, which is precisely what BKT
 * assumes. It is the same trap the flashcard due-check exists to avoid. One
 * question per concept means exactly one BKT observation per concept per test,
 * and it makes `document_mastery()` (the mean over every concept in the
 * material) meaningful after a single test rather than mostly seed values.
 *
 * Matching is allocated FIRST and only in whole blocks of four, because
 * `MATCH_TERMS_PER_BLOCK` has to hold exactly. Whatever is left over goes to the
 * other sections. If matching is the only format chosen, the remainder simply
 * has no section to go to and those concepts are untested — `covered` reports
 * it so the UI can say so rather than the count silently disagreeing.
 *
 * PHASE 2: mirror this server-side. The server recounts `concepts` and
 * re-derives the allocation; this copy only drives the setup preview. The
 * precedent is `src/lib/reviewSchedule.ts` mirroring `server/lib/reviewSchedule.ts`.
 */
export function allocateConcepts(conceptCount: number, formats: QuestionFormat[]): Allocation {
  const ordered = orderedFormats(formats);
  const n = Math.max(0, Math.floor(conceptCount));
  if (ordered.length === 0 || n === 0) {
    return { items: [], covered: 0, matchingDropped: false };
  }

  const others = ordered.filter((f) => f !== 'matching_type');
  const wantsMatching = ordered.length !== others.length;

  let matchCount = 0;
  let matchingDropped = false;

  if (wantsMatching) {
    // Every other section keeps at least one concept, so matching cannot eat a
    // format the student explicitly asked for.
    //
    // The `< MATCH_OPTIONS_PER_BLOCK` test is the other half of the block
    // invariant: four terms need six DISTINCT definitions to choose between, and
    // a lesson with five concepts cannot supply them. Enforced here rather than
    // in the caller so the rule travels with the rule it belongs to — Phase 2's
    // server copy gets it without having to remember.
    const maxBlocks =
      n < MATCH_OPTIONS_PER_BLOCK ? 0 : Math.floor((n - others.length) / MATCH_TERMS_PER_BLOCK);
    if (maxBlocks < 1) {
      matchingDropped = true;
    } else {
      const fairShare = n / ordered.length / MATCH_TERMS_PER_BLOCK;
      matchCount = Math.min(Math.max(1, Math.round(fairShare)), maxBlocks) * MATCH_TERMS_PER_BLOCK;
    }
  }

  const rest = n - matchCount;
  const base = others.length > 0 ? Math.floor(rest / others.length) : 0;
  const extra = others.length > 0 ? rest % others.length : 0;

  const counts = new Map<QuestionFormat, number>();
  others.forEach((format, i) => counts.set(format, base + (i < extra ? 1 : 0)));
  if (matchCount > 0) counts.set('matching_type', matchCount);

  const items = ordered
    .filter((format) => (counts.get(format) ?? 0) > 0)
    .map((format) => ({ format, count: counts.get(format)! }));

  return {
    items,
    covered: items.reduce((sum, i) => sum + i.count, 0),
    matchingDropped,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions
// ─────────────────────────────────────────────────────────────────────────────

interface QuestionBase {
  /** Position in the whole test. This is `practice_telemetry.question_index`. */
  index: number;
  /** Server-validated against the concepts it sent the model — a wrong id corrupts BKT. */
  concept_id: string;
  /** Shown in results only. Naming the concept during the test would give the answer away. */
  concept_term: string;
  format: QuestionFormat;
  difficulty: DifficultyTier;
  prompt: string;
}

export type ChoiceQuestion = QuestionBase & { format: 'multiple_choice'; options: string[] };
export type TrueFalseQuestion = QuestionBase & { format: 'true_or_false' };
export type IdentificationQuestion = QuestionBase & { format: 'identification' };
/** `prompt` contains `BLANK_TOKEN` exactly once. */
export type FillBlankQuestion = QuestionBase & { format: 'fill_in_the_blank' };
/** Every member of a block repeats its `blockId` and the block's shared six options. */
export type MatchingQuestion = QuestionBase & {
  format: 'matching_type';
  blockId: string;
  options: string[];
};

export type TestQuestion =
  | ChoiceQuestion
  | TrueFalseQuestion
  | IdentificationQuestion
  | FillBlankQuestion
  | MatchingQuestion;

export const BLANK_TOKEN = '____';

/**
 * NOTE what is absent: there is no `correct_answer` and no `explanation` on a
 * `TestQuestion`. The answer key must never reach the browser during a test —
 * the old tab shipped it and then trusted a client-decided `is_correct`, which
 * let a student post arbitrary BKT evidence. Correctness arrives only in
 * `TestResult`, after the test is closed.
 */
export interface GeneratedTest {
  id: string;
  title: string;
  space_id: string;
  material_id: string;
  formats: QuestionFormat[];
  difficulty_tier: DifficultyTier;
  questions: TestQuestion[];
  status: 'in_progress' | 'completed';
  created_at: string;
  /** Already-answered items, keyed by `index`. Non-empty when resuming. */
  answers: Record<number, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

export interface QuestionResult {
  index: number;
  concept_id: string;
  concept_term: string;
  format: QuestionFormat;
  prompt: string;
  /** null when the student skipped it. */
  student_answer: string | null;
  correct_answer: string;
  is_correct: boolean;
  explanation: string;
}

export interface MissedConcept {
  concept_id: string;
  term: string;
  wrong: number;
  asked: number;
}

export interface TestResult {
  test: Omit<GeneratedTest, 'questions' | 'answers'>;
  /** 0–1, correct / TOTAL. Never correct / answered — skipping must not raise a score. */
  score: number;
  correct: number;
  total: number;
  results: QuestionResult[];
  /** Concepts the student got wrong at least once, worst first. */
  missed_concepts: MissedConcept[];
  /** Sum of per-question latency, ms. */
  elapsed_ms: number;
}

export interface TestSummary {
  id: string;
  title: string;
  material_id: string;
  created_at: string;
  status: 'in_progress' | 'completed';
  /** null while in progress. */
  score: number | null;
  total: number;
  answered: number;
  formats: QuestionFormat[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Screens — how questions are paged through
// ─────────────────────────────────────────────────────────────────────────────

export type TestScreen =
  | { kind: 'single'; index: number; question: Exclude<TestQuestion, MatchingQuestion> }
  | { kind: 'matching'; index: number; blockId: string; options: string[]; questions: MatchingQuestion[] };

/**
 * One question per screen — except matching, where the whole block of four
 * shares one screen because the six definitions are a single pool. The block
 * still emits four telemetry rows; it is one screen, not one question.
 */
export function buildScreens(questions: TestQuestion[]): TestScreen[] {
  const screens: TestScreen[] = [];
  const blockAt = new Map<string, number>();

  for (const q of questions) {
    if (q.format !== 'matching_type') {
      screens.push({ kind: 'single', index: screens.length, question: q });
      continue;
    }
    const at = blockAt.get(q.blockId);
    if (at === undefined) {
      blockAt.set(q.blockId, screens.length);
      screens.push({
        kind: 'matching',
        index: screens.length,
        blockId: q.blockId,
        options: q.options,
        questions: [q],
      });
    } else {
      (screens[at] as Extract<TestScreen, { kind: 'matching' }>).questions.push(q);
    }
  }
  return screens;
}

/** Every question index a screen is responsible for. */
export function screenIndices(screen: TestScreen): number[] {
  return screen.kind === 'single'
    ? [screen.question.index]
    : screen.questions.map((q) => q.index);
}

export function screenFormat(screen: TestScreen): QuestionFormat {
  return screen.kind === 'single' ? screen.question.format : 'matching_type';
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An answer is always a plain string on the wire — the option's text for a
 * choice, `'true'`/`'false'`, or what the student typed. Storing the text and
 * not an index means reordering options later cannot silently re-grade an
 * answered question.
 */
export function displayAnswer(format: QuestionFormat, raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '—';
  if (format === 'true_or_false') {
    if (value.toLowerCase() === 'true') return 'True';
    if (value.toLowerCase() === 'false') return 'False';
  }
  return value;
}

/** Splits a fill-in-the-blank prompt around its single blank. */
export function splitBlank(prompt: string): [string, string] {
  const at = prompt.indexOf(BLANK_TOKEN);
  if (at < 0) return [prompt, ''];
  return [prompt.slice(0, at), prompt.slice(at + BLANK_TOKEN.length)];
}

export function scorePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The API seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sections the student chose, and nothing else.
 *
 * No length and no title. The server counts `concepts` itself and re-derives the
 * allocation with its own copy of `allocateConcepts()` — a client-supplied
 * length is a client-chosen test, and a student could ask for five questions
 * while still banking BKT evidence. The title comes from the material row.
 */
export interface GenerateTestRequest {
  space_id: string;
  material_id: string;
  formats: QuestionFormat[];
}

export interface TestApi {
  /** Past tests for one space, newest first. */
  list(spaceId: string): Promise<TestSummary[]>;
  generate(req: GenerateTestRequest): Promise<GeneratedTest>;
  /** Fire-and-forget from the UI's point of view; failures surface as a strip, not a block. */
  saveAnswer(testId: string, index: number, answer: string, latencyMs: number): Promise<void>;
  complete(testId: string): Promise<TestResult>;
  /** A finished test, for review from the overview list. */
  fetchResult(testId: string): Promise<TestResult>;
  /** An unfinished test, with `answers` populated. */
  resume(testId: string): Promise<GeneratedTest>;
}

/**
 * The real backend, `server/routes/practice.routes.ts`.
 *
 * Every response goes through the `{ data }` envelope `src/lib/api.ts` unwraps,
 * and `apiFetch` already throws `Error(message)` on a non-2xx — so a 429 from a
 * rate-limited question writer arrives here as its own sentence rather than a
 * generic failure, and the tab shows it verbatim.
 *
 * Note what is NOT here: nothing sends or receives an answer key during a test.
 * `GeneratedTest.questions` is `TestQuestion[]`, which has no `correct_answer`
 * field, and the server's `stripKey()` is what guarantees the wire matches.
 */
export const testApi: TestApi = {
  async list(spaceId) {
    const res = await api.get<TestSummary[]>(`/practice/space/${spaceId}`);
    return res.data ?? [];
  },

  async generate(req) {
    const res = await api.post<GeneratedTest>('/practice', req);
    return res.data;
  },

  async saveAnswer(testId, index, answer, latencyMs) {
    await api.put(`/practice/${testId}/answer`, {
      question_index: index,
      answer,
      latency_ms: latencyMs,
    });
  },

  async complete(testId) {
    const res = await api.put<TestResult>(`/practice/${testId}/complete`, {});
    return res.data;
  },

  async fetchResult(testId) {
    const res = await api.get<TestResult>(`/practice/${testId}/result`);
    return res.data;
  },

  async resume(testId) {
    const res = await api.get<GeneratedTest>(`/practice/${testId}`);
    return res.data;
  },
};
