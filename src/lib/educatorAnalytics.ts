/**
 * Class-level mastery on the client: wire types and read calls. Tier vocabulary is re-exported from
 * src/lib/mastery.ts so both portals share one set of thresholds.
 * Unmeasured figures are null and travel with their count (assessed_concept_count, assessed_students,
 * started). Never print a percentage without checking it.
 */

import { api } from './api';
import {
  masteryTier,
  masteryPercent,
  relativeTime,
  TIER_TONE,
  TIER_LABEL,
  type DifficultyTier,
  type ConceptMastery,
} from './mastery';

export { masteryTier, masteryPercent, relativeTime, TIER_TONE, TIER_LABEL };
export type { DifficultyTier, ConceptMastery };

/** One student's standing on one material. */
export interface StudentPerformance {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** EQ(4) over this material's concepts; null means not started. */
  m_doc: number | null;
  tier: DifficultyTier;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
}

/** One concept across the class. `avg_mastery` is over assessed students only; show `assessed_students` beside it. */
export interface ConceptPerformance {
  concept_id: string;
  term: string;
  source_pages: number[] | null;
  assessed_students: number;
  avg_mastery: number | null;
  mastered_students: number;
  /** Assessed and below 0.50. */
  struggling_students: number;
}

export interface MaterialPerformance {
  material: {
    id: string;
    title: string;
    subject: string;
    grade_levels: number[];
    concept_count: number;
    is_archived: boolean;
    parsed_status: string;
  };
  class: {
    /** Active students in the grades this material is published to. */
    size: number;
    /** Of those, how many have at least one assessed concept. */
    started: number;
    /** Mean over STARTED students only. null when none have started. */
    m_doc: number | null;
    tier: DifficultyTier;
    /** Started students only. */
    by_tier: Record<DifficultyTier, number>;
  };
  /** Server-sorted: started weakest-first, then not-started by name. */
  students: StudentPerformance[];
  /** Server-sorted: assessed weakest-first, then untouched alphabetically. */
  concepts: ConceptPerformance[];
}

/** One student's per-concept detail (the expanded row). */
export interface StudentMaterialDetail {
  student: {
    student_id: string;
    first_name: string;
    last_name: string;
    grade_level: number;
  };
  m_doc: number | null;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
  /** Assessed weakest-first, unassessed last. `mastery` is meaningless unless `assessed`. */
  concepts: ConceptMastery[];
}

/** One student on one concept (the transpose of ConceptMastery). */
export interface ConceptStudentMastery {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** Exactly P(L₀) when `assessed` is false; don't display it then. */
  mastery: number;
  assessed: boolean;
  opportunity_count: number;
  last_updated: string | null;
}

/** Every student on one concept (the expanded concept row). */
export interface ConceptClassDetail {
  concept: {
    concept_id: string;
    term: string;
    definition: string;
    source_pages: number[] | null;
  };
  class_size: number;
  assessed_students: number;
  avg_mastery: number | null;
  mastered_students: number;
  struggling_students: number;
  /** Assessed weakest-first, then never-assessed by name. Server-sorted. */
  students: ConceptStudentMastery[];
}

/**
 * Below this an assessed student is struggling on a concept. Only apply it when `assessed` is true:
 * an unassessed student sits at P(L₀), below it, meaning nothing.
 */
export const STRUGGLING_BELOW = 0.5;

/** The caption under the class average; it must always name its denominator (started students). */
export function classCaption(c: MaterialPerformance['class'], conceptCount: number): string {
  if (conceptCount === 0) {
    return 'Concepts appear once extraction finishes — mastery starts tracking after that.';
  }
  if (c.size === 0) {
    return 'No active students are in the grade levels this material is published to.';
  }
  if (c.started === 0) {
    return `None of the ${c.size} student${c.size === 1 ? '' : 's'} in these grades has been assessed on this material yet.`;
  }
  return `Averaged across the ${c.started} of ${c.size} student${c.size === 1 ? '' : 's'} who have started.`;
}

/** The same caption for the dashboard's class average, kept beside classCaption() so they don't drift. */
export function overviewCaption(
  c: MaterialPerformance['class'],
  conceptCount: number
): string {
  if (conceptCount === 0) {
    return 'Concepts appear once extraction finishes — mastery starts tracking after that.';
  }
  if (c.size === 0) {
    return 'No active student accounts are in the grade levels you publish to.';
  }
  if (c.started === 0) {
    return `None of the ${c.size} student${c.size === 1 ? '' : 's'} in your grades has been assessed yet.`;
  }
  return `Averaged across the ${c.started} of ${c.size} student${c.size === 1 ? '' : 's'} who have started.`;
}

/** "3 of 5 struggling", or null when untouched. */
export function conceptCaption(c: ConceptPerformance): string | null {
  if (c.assessed_students === 0) return null;
  const parts = [`${c.assessed_students} assessed`];
  if (c.struggling_students > 0) parts.push(`${c.struggling_students} struggling`);
  if (c.mastered_students > 0) parts.push(`${c.mastered_students} mastered`);
  return parts.join(' · ');
}

/**
 * One student's learning-progress row. `start_mastery` is after the first opportunity, never a
 * baseline or pre-test. start/end/growth are over the same set (denominator assessed_concept_count).
 */
export interface EvidenceStudent {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  concept_count: number;
  /** Denominator of the figures below; null figures mean not started. */
  assessed_concept_count: number;
  /** Mastery but no surviving audit row; excluded from start and end. */
  concepts_without_trail: number;
  opportunity_count: number;
  flashcard_observations: number;
  test_observations: number;
  start_mastery: number | null;
  end_mastery: number | null;
  growth: number | null;
  /** EQ(4) over every concept (what Class Performance prints). */
  m_doc: number | null;
  tier: DifficultyTier;
  first_observed_at: string | null;
  last_observed_at: string | null;
}

export interface MasteryEvidence {
  material: {
    id: string;
    title: string;
    subject: string;
    grade_levels: number[];
    concept_count: number;
    is_archived: boolean;
    parsed_status: string;
  };
  generated_at: string;
  /** The audit-trail read hit its cap; figures are still anchored to bkt_mastery. */
  truncated: boolean;
  class: {
    size: number;
    started: number;
    start_mastery: number | null;
    end_mastery: number | null;
    growth: number | null;
    m_doc: number | null;
  };
  /** Roster (name) order, not weakest-first. */
  students: EvidenceStudent[];
  /** One row per (student, assessed concept); the .xlsx rebuilds every summary from these. */
  concept_rows: EvidenceConceptRow[];
}

/** `first_posterior` is null when the audit row was lost; that concept is excluded from start and end. */
export interface EvidenceConceptRow {
  student_id: string;
  last_name: string;
  first_name: string;
  concept_id: string;
  concept_term: string;
  /** Posterior after the first opportunity; never a baseline. */
  first_posterior: number | null;
  latent_mastery: number;
  opportunity_count: number;
  flashcard_observations: number;
  test_observations: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
}

export const educatorAnalyticsApi = {
  /** Class summary, per-student rows and the per-concept breakdown, in one request. */
  async performance(materialId: string): Promise<MaterialPerformance> {
    const res = await api.get<MaterialPerformance>(
      `/educator/materials/${materialId}/performance`
    );
    return res.data;
  },

  /** One student's concepts; separate from the summary for payload size. */
  async student(materialId: string, studentId: string): Promise<StudentMaterialDetail> {
    const res = await api.get<StudentMaterialDetail>(
      `/educator/materials/${materialId}/students/${studentId}/concepts`
    );
    return res.data;
  },

  /** Learning-progress evidence; fetched only on export (it reads the audit trail). */
  async evidence(materialId: string): Promise<MasteryEvidence> {
    const res = await api.get<MasteryEvidence>(
      `/educator/materials/${materialId}/mastery-evidence`
    );
    return res.data;
  },

  /** One concept across the class. */
  async concept(materialId: string, conceptId: string): Promise<ConceptClassDetail> {
    const res = await api.get<ConceptClassDetail>(
      `/educator/materials/${materialId}/concepts/${conceptId}/students`
    );
    return res.data;
  },
};
