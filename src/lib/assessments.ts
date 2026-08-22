import { api } from './api';

/**
 * Pre-test / post-test client contract — TEMPORARY research instrument.
 *
 * Removed after the school study; the whole feature deletes as this file plus
 * three components plus the marked edits. It serves paper RQ4 (p. 55) and is
 * deliberately isolated from `testMode.ts`: adaptive Test Mode is a study tool
 * that moves BKT mastery, this is a measurement that must not.
 *
 * ⚠️ NOTE WHAT IS ABSENT FROM `AssessmentItem`: there is no `answer`. The server's
 * `stripAssessmentKey()` allow-lists three fields, and during a PRE-test it also
 * withholds the post-test wording — both stems live on one row, so a phase-blind
 * response would hand a student the whole test they have not sat yet.
 */

export type AssessmentPhase = 'pre' | 'post';

export const PHASE_LABEL: Record<AssessmentPhase, string> = {
  pre: 'Pre-Test',
  post: 'Post-Test',
};

/** One question as it reaches the browser. No answer key, one wording. */
export interface AssessmentItem {
  index: number;
  prompt: string;
  options: string[];
}

/** Per-phase state for one material, from `GET /assessments/space/:spaceId`. */
export interface PhaseState {
  released: boolean;
  taken: boolean;
  correct_count: number | null;
  completed_at: string | null;
}

export interface AssessmentSummary {
  assessment_id: string;
  material_id: string;
  material_title: string;
  item_count: number;
  pre: PhaseState;
  post: PhaseState;
  /**
   * The phase currently blocking this material, or null.
   *
   * SERVER-DERIVED, and the client must never recompute it. The rule is "the
   * LATEST released phase with no completed attempt" — not "any released phase",
   * which would strand a student who was released a post-test before finishing
   * their pre-test.
   *
   * ⚠️ USE THIS ONLY TO DECIDE WHETHER A MATERIAL IS LOCKED. For telling the
   * student what to DO, use `action_phase` — see below.
   */
  locked_phase: AssessmentPhase | null;

  /**
   * The phase the student must actually sit next, or null.
   *
   * ⚠️ NOT THE SAME AS `locked_phase`, AND CONFLATING THEM IS A REAL BUG THAT
   * SHIPPED. The lock points at the LATEST released phase, so a student who still
   * owes a pre-test while the post-test is also out is locked on 'post' — and the
   * banner, reading that field, told them to "take the post-test", which is
   * precisely the one thing the server forbids until the pre-test is done.
   *
   * Ordering wins: pre before post, always.
   */
  action_phase: AssessmentPhase | null;
}

/** An open sitting. `answers` is index → chosen option text. */
export interface StartedAttempt {
  attempt_id: string;
  phase: AssessmentPhase;
  status: 'in_progress';
  item_count: number;
  items: AssessmentItem[];
  answers: Record<string, string>;
}

export interface AssessmentReviewRow {
  index: number;
  prompt: string;
  options: string[];
  student_answer: string | null;
  correct_answer: string;
  is_correct: boolean;
}

/**
 * A finished sitting.
 *
 * `review` IS ABSENT ON A PRE-TEST, and that is the single most important line in
 * this file. Pre and post share every answer, so returning a pre-test review
 * would hand the student the post-test's key weeks early and turn the study's
 * measured gain into a measure of who read a JSON response.
 */
export interface AssessmentResult {
  score: number;
  correct_count: number;
  total: number;
  review?: AssessmentReviewRow[];
}

export interface CompletedAttempt {
  attempt_id: string;
  phase: AssessmentPhase;
  status: 'completed';
  result: AssessmentResult;
}

/** Educator-side view of one item — carries the key, which is correct only there. */
export interface EducatorAssessmentItem {
  index: number;
  concept_id: string;
  concept_term: string;
  pre_stem: string;
  post_stem: string;
  options_pre: string[];
  options_post: string[];
  answer: string;
}

export interface EducatorAssessment {
  id: string;
  material_id: string;
  item_count: number;
  pre_released_at: string | null;
  post_released_at: string | null;
  created_at: string;
  items: EducatorAssessmentItem[];
}

export interface EducatorAssessmentView {
  assessment: EducatorAssessment | null;
  attempts: { pre: number; post: number; total: number };
}

export interface AssessmentResultRow {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  pre_correct: number | null;
  post_correct: number | null;
  pre_at: string | null;
  post_at: string | null;
  gain: number | null;
}

export interface AssessmentResults {
  material_title: string;
  item_count: number;
  students: AssessmentResultRow[];
}

/**
 * The real backend, `server/routes/assessments.routes.ts`.
 *
 * `apiFetch` already throws `Error(message)` on a non-2xx, so a 422 ("this
 * material has 3 concepts") or a 429 (daily model quota) arrives as its own
 * sentence and the UI shows it verbatim rather than inventing one.
 */
export const assessmentApi = {
  // ── student ──
  async forSpace(spaceId: string): Promise<AssessmentSummary[]> {
    const res = await api.get<{ materials: AssessmentSummary[] }>(`/assessments/space/${spaceId}`);
    return res.data?.materials ?? [];
  },

  /** Start OR resume. A completed attempt comes back as `CompletedAttempt`. */
  async start(assessmentId: string, phase: AssessmentPhase): Promise<StartedAttempt | CompletedAttempt> {
    const res = await api.post<StartedAttempt | CompletedAttempt>(
      `/assessments/${assessmentId}/attempts`,
      { phase }
    );
    return res.data;
  },

  async saveAnswer(attemptId: string, index: number, answer: string, latencyMs: number): Promise<void> {
    await api.put(`/assessments/attempts/${attemptId}/answer`, {
      item_index: index,
      answer,
      latency_ms: latencyMs,
    });
  },

  async complete(attemptId: string): Promise<{ result: AssessmentResult; phase: AssessmentPhase }> {
    const res = await api.put<{ result: AssessmentResult; phase: AssessmentPhase }>(
      `/assessments/attempts/${attemptId}/complete`,
      {}
    );
    return res.data;
  },

  // ── educator ──
  async forMaterial(materialId: string): Promise<EducatorAssessmentView> {
    const res = await api.get<EducatorAssessmentView>(`/assessments/materials/${materialId}`);
    return res.data;
  },

  async generate(materialId: string): Promise<EducatorAssessmentView> {
    const res = await api.post<EducatorAssessmentView>(
      `/assessments/materials/${materialId}/generate`,
      {}
    );
    return res.data;
  },

  async release(
    materialId: string,
    change: { pre_released?: boolean; post_released?: boolean }
  ): Promise<{ pre_released_at: string | null; post_released_at: string | null }> {
    const res = await api.patch<{ pre_released_at: string | null; post_released_at: string | null }>(
      `/assessments/materials/${materialId}/release`,
      change
    );
    return res.data;
  },

  async results(materialId: string): Promise<AssessmentResults> {
    const res = await api.get<AssessmentResults>(`/assessments/materials/${materialId}/results`);
    return res.data;
  },
};

/** One row of `GET /assessments/overview` — library-wide coverage, no answer key. */
export interface AssessmentOverviewRow {
  material_id: string;
  item_count: number;
  pre_released_at: string | null;
  post_released_at: string | null;
}

/**
 * Coverage across the educator's whole library, for the materials-list pill.
 *
 * A SEPARATE read rather than a field on `GET /api/materials`, so removing this
 * feature is deleting one fetch instead of editing a shared route back.
 */
export async function assessmentOverview(): Promise<Map<string, AssessmentOverviewRow>> {
  const res = await api.get<{ assessments: AssessmentOverviewRow[] }>('/assessments/overview');
  return new Map((res.data?.assessments ?? []).map((a) => [a.material_id, a]));
}

/** The three states a material's test can be in, for a status pill. */
export type AssessmentState = 'none' | 'ready' | 'pre_open' | 'post_open';

export function assessmentState(row: AssessmentOverviewRow | undefined): AssessmentState {
  if (!row) return 'none';
  if (row.post_released_at) return 'post_open';
  if (row.pre_released_at) return 'pre_open';
  return 'ready';
}
