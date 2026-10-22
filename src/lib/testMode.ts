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
 * Test Mode types shared with server/routes/practice.routes.ts (they mirror schema.sql).
 * `allocateConcepts()` mirrors server/lib/testAllocation.ts, which is authoritative; change both.
 */

// Formats

/** Matches the `question_type` enum; one spelling app-wide (it selects P(G), so a wrong id loses the observation). */
export type QuestionFormat =
  | 'multiple_choice'
  | 'true_or_false'
  | 'identification'
  | 'fill_in_the_blank'
  | 'matching_type';

/** Matches `practice_tests.difficulty_tier` and `mastery_tier()`. */
export type DifficultyTier = 'foundational' | 'intermediate' | 'advanced';

/** The single source of format labels, blurbs and exam-paper order (Test I..V). */
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
 * 4 terms vs 6 definitions (paper p. 75). Six options is what makes P(G_match) = 1/6; if the two ever
 * conflict, bend the term count, never the option count.
 */
export const MATCH_TERMS_PER_BLOCK = 4;
export const MATCH_OPTIONS_PER_BLOCK = 6;

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Formats in exam-paper order. */
export function orderedFormats(formats: QuestionFormat[]): QuestionFormat[] {
  return [...new Set(formats)].sort(
    (a, b) => FORMAT_META[a].sectionOrder - FORMAT_META[b].sectionOrder
  );
}

/** 'Test III' style labels, numbered across the chosen formats only. */
export function sectionLabel(formats: QuestionFormat[], format: QuestionFormat): string {
  const idx = orderedFormats(formats).indexOf(format);
  return idx < 0 ? 'Test' : `Test ${ROMAN[idx] ?? idx + 1}`;
}

export interface Allocation {
  items: { format: QuestionFormat; count: number }[];
  /** Concepts that get a question; less than the total only when matching rounds down. */
  covered: number;
  /** Matching requested but no room for a whole block. */
  matchingDropped: boolean;
}

/**
 * One question per concept, always, so each test gives BKT one independent observation per concept.
 * Matching is allocated first in whole blocks. Mirror of the server copy, used only for the preview.
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
    // Leave every other section at least one concept. A block needs six distinct definitions.
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

// Questions

interface QuestionBase {
  /** Position in the whole test. This is `practice_telemetry.question_index`. */
  index: number;
  /** Server-validated; a wrong id would corrupt BKT. */
  concept_id: string;
  /** Results only; showing it during the test gives the answer away. */
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

/** No answer key or explanation: those reach the browser only in TestResult, after submission. */
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

// Results

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

/** What this submission did to one concept's mastery. Mirrors MasteryChangeDto on the server. */
export interface MasteryChange {
  concept_id: string;
  term: string;
  /** Meaningless unless `assessed_before` (it's P(L₀)); render "Not measured before". */
  before: number;
  after: number;
  /** Items in THIS test that asked about it. */
  observations: number;
  /** Total attempts ever, after this test — flashcard ratings included. */
  opportunity_count: number;
  assessed_before: boolean;
}

export interface TestResult {
  test: Omit<GeneratedTest, 'questions' | 'answers'>;
  /** 0–1, correct / total; skipping never raises it. */
  score: number;
  correct: number;
  total: number;
  results: QuestionResult[];
  /** Concepts the student got wrong at least once, worst first. */
  missed_concepts: MissedConcept[];
  /** Sum of per-question latency, ms. */
  elapsed_ms: number;
  /** Present only on the response that completed the test. Absent = "no claim"; `[]` = nothing moved. */
  mastery_changes?: MasteryChange[];
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

// Screens

export type TestScreen =
  | { kind: 'single'; index: number; question: Exclude<TestQuestion, MatchingQuestion> }
  | { kind: 'matching'; index: number; blockId: string; options: string[]; questions: MatchingQuestion[] };

/** One question per screen, except a matching block (one shared pool), which still emits four rows. */
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

// Display helpers

/** Answers are plain strings (option text, 'true'/'false', or typed), never indices. */
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

// API

/** Only the chosen sections: the server derives length and title. */
export interface GenerateTestRequest {
  space_id: string;
  material_id: string;
  formats: QuestionFormat[];
}

export interface TestApi {
  /** Past tests for one space, newest first. */
  list(spaceId: string): Promise<TestSummary[]>;
  generate(req: GenerateTestRequest): Promise<GeneratedTest>;
  /** Failures surface as a strip, not a block. */
  saveAnswer(testId: string, index: number, answer: string, latencyMs: number): Promise<void>;
  complete(testId: string): Promise<TestResult>;
  /** A finished test, for review from the overview list. */
  fetchResult(testId: string): Promise<TestResult>;
  /** An unfinished test, with `answers` populated. */
  resume(testId: string): Promise<GeneratedTest>;
}

/** The backend client. A non-2xx becomes Error(message), so quota messages show verbatim. No answer key is ever exchanged. */
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
