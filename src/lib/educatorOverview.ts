/**
 * Educator dashboard wire types and its API call (across all materials).
 * Mastery vocabulary is re-exported from educatorAnalytics.ts, never redeclared.
 * Unmeasured figures are null and ship with their counts; check them before printing a percentage.
 * Only students[].m_doc and by_material[].m_doc are EQ(4); the other means are over students.
 */

import { api } from './api';
import {
  masteryTier,
  masteryPercent,
  relativeTime,
  overviewCaption,
  STRUGGLING_BELOW,
  TIER_TONE,
  TIER_LABEL,
  type DifficultyTier,
  type MaterialPerformance,
} from './educatorAnalytics';

export {
  masteryTier,
  masteryPercent,
  relativeTime,
  overviewCaption,
  STRUGGLING_BELOW,
  TIER_TONE,
  TIER_LABEL,
};
export type { DifficultyTier };

/** Why a material needs attention; one reason per material, chosen server-side. */
export type AttentionReason =
  | 'parse_failed'
  | 'parse_pending'
  | 'no_concepts'
  | 'no_students'
  | 'nobody_started';

export interface AttentionItem {
  material_id: string;
  title: string;
  reason: AttentionReason;
  grade_levels: number[];
  /** Only ever set on `parse_failed`. */
  parse_error: string | null;
  /** Only meaningful on `nobody_started`. */
  class_size: number;
}

/** One of the educator's live materials, summarised across its class. */
export interface MaterialOverview {
  material_id: string;
  title: string;
  subject: string;
  grade_levels: number[];
  parsed_status: string;
  concept_count: number;
  class_size: number;
  started: number;
  /** Mean over started students; null if none. Same number as that material's Class Performance tab. */
  m_doc: number | null;
  tier: DifficultyTier;
  /** Assessed concepts whose class average is below 0.50. */
  struggling_concepts: number;
  last_updated: string | null;
  created_at: string;
}

/** One student on one of the educator's materials (the expanded row). */
export interface StudentMaterialSlice {
  material_id: string;
  /** EQ(4) over that material; present only once started. */
  m_doc: number;
  assessed_concept_count: number;
  concept_count: number;
}

/** One student across this educator's materials. EQ(4) over your materials only, so it can differ from what the student sees. */
export interface StudentOverview {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** null means not started. */
  m_doc: number | null;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
  /** Started materials only. */
  by_material: StudentMaterialSlice[];
}

/** One concept across the class. Assessed concepts only, so `avg_mastery` is always a real measurement. */
export interface ConceptOverview {
  concept_id: string;
  term: string;
  material_id: string;
  material_title: string;
  source_pages: number[] | null;
  assessed_students: number;
  avg_mastery: number;
  mastered_students: number;
  struggling_students: number;
}

export interface GradeOverview {
  grade_level: number;
  material_count: number;
  size: number;
  started: number;
  /** Mean over started students in this grade; null if none. */
  m_doc: number | null;
  tier: DifficultyTier;
}

export interface RecentUpload {
  material_id: string;
  title: string;
  subject: string;
  grade_levels: number[];
  parsed_status: string;
  concept_count: number;
  created_at: string;
}

export interface EducatorOverview {
  /** No email here: profiles has none. */
  educator: { first_name: string; last_name: string };
  counts: {
    materials_live: number;
    materials_archived: number;
    /** Parse not completed, or completed with zero concepts. */
    materials_unready: number;
    concepts_total: number;
    /** Concepts at least one student has been assessed on. */
    concepts_assessed: number;
    /** Grades reached by the live materials, ascending. */
    grades: number[];
  };
  /** Same shape as MaterialPerformance['class'], so overviewCaption() fits both. */
  class: MaterialPerformance['class'];
  /** Empty when nothing needs attention; render nothing then. */
  attention: AttentionItem[];
  /** Server-sorted: started weakest-first, then quiet ones newest-first. */
  materials: MaterialOverview[];
  /** Server-sorted: started weakest-first, then not-started by name. */
  students: StudentOverview[];
  /** Weakest 20 assessed concepts; counts.concepts_assessed is the real total. */
  concepts: ConceptOverview[];
  grades: GradeOverview[];
  recent_uploads: RecentUpload[];
}

/** The caption under a material row; always names its denominator. Each empty case has its own wording. */
export function materialCaption(m: MaterialOverview): string {
  if (m.concept_count === 0) return 'No concepts yet';
  if (m.class_size === 0) {
    return `No active students in ${m.grade_levels.map((g) => `Grade ${g}`).join(' or ')}`;
  }
  if (m.started === 0) return `Nobody of ${m.class_size} has started`;
  const parts = [`${m.started} of ${m.class_size} started`];
  if (m.struggling_concepts > 0) parts.push(`${m.struggling_concepts} concepts below 50%`);
  return parts.join(' · ');
}

/** The sentence under a student row. */
export function studentCaption(s: StudentOverview): string {
  const grade = `Grade ${s.grade_level}`;
  if (s.m_doc === null) return `${grade} · Not started`;
  const parts = [grade, `${s.assessed_concept_count} of ${s.concept_count} assessed`];
  if (s.mastered_concept_count > 0) parts.push(`${s.mastered_concept_count} mastered`);
  const when = relativeTime(s.last_updated);
  if (when) parts.push(when);
  return parts.join(' · ');
}

/** One line per attention reason; the only place this wording lives. */
export const ATTENTION_TEXT: Record<AttentionReason, (item: AttentionItem) => string> = {
  parse_failed: () => 'Concept extraction failed — students cannot study this',
  parse_pending: () => 'Still being processed — concepts are not ready yet',
  no_concepts: () => 'No concepts were extracted, so there is nothing to measure',
  no_students: (i) =>
    `Reaches no active students — no account is in ${i.grade_levels
      .map((g) => `Grade ${g}`)
      .join(' or ')}`,
  nobody_started: (i) =>
    `None of the ${i.class_size} student${i.class_size === 1 ? '' : 's'} in these grades has started it`,
};

export const educatorOverviewApi = {
  /** Everything the educator dashboard renders, in one request. Accepts nothing. */
  async load(): Promise<EducatorOverview> {
    const res = await api.get<EducatorOverview>('/educator/overview');
    return res.data;
  },
};
