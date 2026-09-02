/**
 * Class-level mastery on the client — wire types and the two read calls.
 *
 * The educator counterpart of `src/lib/mastery.ts`, and it deliberately declares
 * none of that file's vocabulary: `DifficultyTier`, `masteryTier`,
 * `masteryPercent`, `TIER_TONE`, `TIER_LABEL` and `relativeTime` are all imported
 * and re-exported from there. A student's mastery and an educator's view of the
 * same student's mastery are one number, and the moment the two portals own two
 * copies of the thresholds they start disagreeing about who is "advanced".
 *
 * THE ONE RULE, unchanged from the student side: a student with no `bkt_mastery`
 * row sits at P(L₀) = 0.10, and that is an ASSUMPTION, not a measurement. Every
 * figure here that could be unmeasured is `number | null`, and every one carries
 * the count that lets you tell the two apart — `assessed_concept_count` per
 * student, `assessed_students` per concept, `started` per class. If you find
 * yourself printing a percentage without checking one of them, stop.
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
  /** EQ(4) over this material's concepts. **null means not started — never render it.** */
  m_doc: number | null;
  tier: DifficultyTier;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
}

/**
 * One concept across the class — the re-teach signal.
 *
 * `avg_mastery` is a mean over ASSESSED students only, so it is not EQ(4) and
 * does not fill absences with the prior. `assessed_students` is its denominator
 * and must be shown next to it.
 */
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
    /** Over started students only — an unmeasured student is in no tier. */
    by_tier: Record<DifficultyTier, number>;
  };
  /** Server-sorted: started weakest-first, then not-started by name. */
  students: StudentPerformance[];
  /** Server-sorted: assessed weakest-first, then untouched alphabetically. */
  concepts: ConceptPerformance[];
}

/** One student's concept-by-concept detail — the expanded row. */
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

/** One student's standing on ONE concept — the transpose of `ConceptMastery`. */
export interface ConceptStudentMastery {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** Exactly P(L₀) when `assessed` is false. Do not display it in that case. */
  mastery: number;
  assessed: boolean;
  opportunity_count: number;
  last_updated: string | null;
}

/** Who stands where on one concept — the expanded concept row. */
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
 * The mastery below which an ASSESSED student counts as struggling on a concept.
 *
 * It is the foundational band, `mastery_tier()`'s lower bound, and the same 0.50
 * the tier badge uses — but it is applied per concept, to one student, and ONLY
 * once there is evidence. A student who has never been asked about a concept sits
 * at P(L₀) = 0.10, which is below this number and means nothing; the server gates
 * on `assessed` before comparing, and any client-side reuse of this constant must
 * do the same. That gate is why `TIER_STYLE.foundational` can be slate (the cold
 * start is not a failure) while a struggling count can still be flagged.
 */
export const STRUGGLING_BELOW = 0.5;

/**
 * The sentence printed under the class average.
 *
 * It must always name its denominator. The average excludes students who have not
 * started, so "54%" on its own would read as the whole class when it may describe
 * three people out of twenty — and that gap is the most actionable thing on the
 * screen, not a footnote.
 */
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

/**
 * The same sentence for the DASHBOARD's class average, which is over every material
 * the educator has published rather than one.
 *
 * Deliberately adjacent to `classCaption()` rather than filed with the overview's
 * own types: they are one sentence at two scopes, and the moment they live in two
 * files one of them starts naming its denominator and the other stops.
 */
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

/** "3 of 5 struggling" — the concept row's caption, or null when untouched. */
export function conceptCaption(c: ConceptPerformance): string | null {
  if (c.assessed_students === 0) return null;
  const parts = [`${c.assessed_students} assessed`];
  if (c.struggling_students > 0) parts.push(`${c.struggling_students} struggling`);
  if (c.mastered_students > 0) parts.push(`${c.mastered_students} mastered`);
  return parts.join(' · ');
}

/**
 * One student's learning-progress row — the study's evidence, one material.
 *
 * ⚠️ `start_mastery` IS NOT A BASELINE. It is the mean mastery AFTER the student's
 * first answer on each assessed concept, so that answer's outcome is already
 * inside it. Never label a column, caption or chart derived from it "pre-test",
 * "baseline" or "before studying". The one honest phrasing is "after the first
 * opportunity". (The genuine before-value, P(L₀) = 0.10, is identical for every
 * student and is an assumption, which is why it is not in this payload at all.)
 *
 * `start`, `end` and `growth` are all means over the SAME set — the concepts with
 * a mastery row — which is what makes `growth` a paired difference. Their
 * denominator is `assessed_concept_count`, and it must travel with them.
 */
export interface EvidenceStudent {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  concept_count: number;
  /** The denominator of the three figures below. **null figures mean not started.** */
  assessed_concept_count: number;
  /** Has mastery but no surviving audit row — excluded from start AND end. */
  concepts_without_trail: number;
  opportunity_count: number;
  flashcard_observations: number;
  test_observations: number;
  start_mastery: number | null;
  end_mastery: number | null;
  growth: number | null;
  /** EQ(4) over every concept — the number Class Performance prints. */
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
  /** The audit-trail read hit its row cap. Figures are still anchored to bkt_mastery. */
  truncated: boolean;
  class: {
    size: number;
    started: number;
    start_mastery: number | null;
    end_mastery: number | null;
    growth: number | null;
    m_doc: number | null;
  };
  /** Roster order (by name), NOT weakest-first — this is a table, not a ranking. */
  students: EvidenceStudent[];
}

/**
 * The export's columns.
 *
 * `assessed_concepts` is not optional decoration: it is the denominator of
 * `start_mastery`, `end_mastery` and `growth`, and those three cannot be
 * interpreted without it. Names lead so a row can be checked against a class list
 * — `profiles` has no email, and one must not be invented to fill a column.
 */
export const EVIDENCE_HEADER = [
  'material_title',
  'last_name',
  'first_name',
  'grade_level',
  'concept_count',
  'assessed_concepts',
  'opportunities',
  'flashcard_obs',
  'test_obs',
  'start_mastery',
  'end_mastery',
  'growth',
  'm_doc',
  'first_observed_at',
  'last_observed_at',
] as const;

/**
 * ⚠️ A BLANK CELL MEANS NOT STARTED. Never `0`, never `0.1` — a fabricated number
 * is worse than an empty cell, and 0.10 is P(L₀), the assumption this whole file
 * exists to keep off the screen.
 *
 * Unlike `credentialRows()`, not-started students are LISTED rather than filtered.
 * "Nineteen of twenty never opened this" is a finding about the study, and a
 * filtered file would hide it.
 *
 * Values are the server's 4dp numbers verbatim — no re-rounding and no ×100.
 * `masteryPercent()` is for the screen; a second precision here would let the
 * paper's numbers disagree with the ones the educator saw. Timestamps stay ISO
 * 8601 UTC for the same reason a localised date is unparseable months later.
 */
export function evidenceRows(data: MasteryEvidence): string[][] {
  const num = (v: number | null) => (v === null ? '' : String(v));

  return data.students.map((s) => [
    data.material.title,
    s.last_name,
    s.first_name,
    String(s.grade_level),
    String(s.concept_count),
    String(s.assessed_concept_count),
    String(s.opportunity_count),
    String(s.flashcard_observations),
    String(s.test_observations),
    num(s.start_mastery),
    num(s.end_mastery),
    num(s.growth),
    num(s.m_doc),
    s.first_observed_at ?? '',
    s.last_observed_at ?? '',
  ]);
}

export const educatorAnalyticsApi = {
  /** Class summary, per-student rows and the per-concept breakdown, in one request. */
  async performance(materialId: string): Promise<MaterialPerformance> {
    const res = await api.get<MaterialPerformance>(
      `/educator/materials/${materialId}/performance`
    );
    return res.data;
  },

  /**
   * One student's concepts. Separate from the summary purely on payload size —
   * shipping every student's vector inline is ~256 KB at study scale.
   */
  async student(materialId: string, studentId: string): Promise<StudentMaterialDetail> {
    const res = await api.get<StudentMaterialDetail>(
      `/educator/materials/${materialId}/students/${studentId}/concepts`
    );
    return res.data;
  },

  /**
   * The study's learning-progress evidence for one material.
   *
   * Fetched lazily, on the export click only — it reads the BKT audit trail, and
   * a research export must not cost every educator that on every tab entry.
   */
  async evidence(materialId: string): Promise<MasteryEvidence> {
    const res = await api.get<MasteryEvidence>(
      `/educator/materials/${materialId}/mastery-evidence`
    );
    return res.data;
  },

  /** One concept across the class — the transpose of `student()`. */
  async concept(materialId: string, conceptId: string): Promise<ConceptClassDetail> {
    const res = await api.get<ConceptClassDetail>(
      `/educator/materials/${materialId}/concepts/${conceptId}/students`
    );
    return res.data;
  },
};
