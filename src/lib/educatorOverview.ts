/**
 * The educator dashboard's wire types and its one API call.
 *
 * Its own module for the same reason `src/lib/dashboard.ts` is separate from
 * `mastery.ts`: this reads ACROSS materials, while `educatorAnalytics.ts` is scoped
 * to one. Filing a cross-library payload under the per-material file would make
 * that file about two different questions.
 *
 * IT DECLARES NO MASTERY VOCABULARY. `masteryTier`, `masteryPercent`,
 * `relativeTime`, `TIER_TONE`, `TIER_LABEL`, `DifficultyTier` and
 * `STRUGGLING_BELOW` all come from `educatorAnalytics.ts` (which re-exports them
 * from `mastery.ts`) and are re-exported here only for convenience. A second copy
 * of a tier threshold is the drift this codebase keeps warning about.
 *
 * THE ONE RULE, unchanged: a student with no `bkt_mastery` row sits at P(L₀) = 0.10,
 * which is an ASSUMPTION, not a measurement. Every figure below that could be
 * unmeasured is `number | null`, and every one ships the count that lets you tell
 * the two apart — `assessed_concept_count` per student, `assessed_students` per
 * concept, `started` per material / grade / class. If you find yourself printing a
 * percentage without checking one of them, stop.
 *
 * ⚠️ FIVE FIGURES, TWO COMPUTATIONS. Only `students[].m_doc` and
 * `students[].by_material[].m_doc` are EQ(4) — means over CONCEPTS, where an
 * unassessed concept correctly enters at the prior. `materials[].m_doc`,
 * `concepts[].avg_mastery`, `class.m_doc` and `grades[].m_doc` are means over
 * STUDENTS, and an absent student is never filled with the prior there.
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

/**
 * Why a material is on the "needs a look" strip. One reason per material, chosen
 * server-side by blocking-ness so the vocabulary is stated once.
 */
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
  /**
   * Mean over STARTED students. **null means nobody has started — never render it.**
   *
   * This is the same expression, over the same population, as `class.m_doc` on that
   * material's Class Performance tab. The two screens show ONE number.
   */
  m_doc: number | null;
  tier: DifficultyTier;
  /** Assessed concepts whose class average is below 0.50. */
  struggling_concepts: number;
  last_updated: string | null;
  created_at: string;
}

/** One student's standing on one of the educator's materials — the expanded row. */
export interface StudentMaterialSlice {
  material_id: string;
  /** EQ(4) over that material's concepts. Only present when they have started it. */
  m_doc: number;
  assessed_concept_count: number;
  concept_count: number;
}

/**
 * One student across every material this educator has published to their grade.
 *
 * `m_doc` is EQ(4) over the union of those concepts — the same computation the
 * student's own dashboard performs on themselves, narrowed to your materials. It
 * will therefore differ from the figure they see if another educator also publishes
 * to them, which is why the caption on this list says "your materials".
 */
export interface StudentOverview {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** **null means not started — never render it.** */
  m_doc: number | null;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
  /** Only materials they have started. Empty for a student who has not. */
  by_material: StudentMaterialSlice[];
}

/**
 * One concept across the class — the re-teach signal, library-wide.
 *
 * Unassessed concepts never reach this list: they sit at P(L₀), below every
 * genuinely struggling concept, so including them would fill it with concepts
 * nobody has ever been asked about. `avg_mastery` is therefore always a real
 * measurement here, unlike its per-material counterpart.
 */
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
  /** Mean over STARTED students in this grade. null when none have. */
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
  /** `profiles` has no email column, so there is none here and none may be invented. */
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
  /** Shaped identically to `MaterialPerformance['class']` so `overviewCaption()` fits both. */
  class: MaterialPerformance['class'];
  /** Empty when nothing needs attention — render nothing, not an "all clear" card. */
  attention: AttentionItem[];
  /** Server-sorted: started weakest-first, then quiet ones newest-first. */
  materials: MaterialOverview[];
  /** Server-sorted: started weakest-first, then not-started by name. */
  students: StudentOverview[];
  /** Weakest 20 ASSESSED concepts, ascending. `counts.concepts_assessed` is the real total. */
  concepts: ConceptOverview[];
  grades: GradeOverview[];
  recent_uploads: RecentUpload[];
}

/**
 * The sentence under a material row. Always names what the figure is out of.
 *
 * The three "nothing to report" branches are distinct problems with distinct fixes,
 * which is why they are not collapsed into one line — the same reasoning that gives
 * `ClassPerformance` four empty states instead of one.
 */
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

/** One line per attention reason. The only place this wording lives. */
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
