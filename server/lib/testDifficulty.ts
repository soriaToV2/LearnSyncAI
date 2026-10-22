import { supabaseAdmin } from './supabase';
import type { DifficultyTier } from './testAllocation';

/**
 * Practice-test difficulty calibration (paper p. 81). One tier per test, not per question;
 * the tier and the pre-test mastery snapshot are both stored for the Difficulty Alignment check (p. 98).
 */

/** P(L₀). Must match `bkt_parameters.p_l0`, the `latent_mastery` default and `document_mastery()`. */
export const P_L0 = 0.1;

/** Paper pp. 81/98; identical to `mastery_tier()` in schema.sql. */
export function masteryTier(mastery: number): DifficultyTier {
  if (!Number.isFinite(mastery)) return 'foundational';
  if (mastery >= 0.85) return 'advanced';
  if (mastery >= 0.5) return 'intermediate';
  return 'foundational';
}

export interface ConceptMasteryRow {
  /** `bkt_mastery.latent_mastery`, already `Number()`-coerced. */
  mastery: number;
  /** Reporting only; never enters the BKT arithmetic. */
  opportunityCount: number;
  lastUpdated: string | null;
}

/** `.in()` goes into the query string, so long id lists are chunked to keep URLs short. */
const IN_CHUNK = 200;

/** PostgREST's default max rows per response. */
const PAGE = 1_000;

/** This student's `bkt_mastery` rows for `conceptIds`. Absent = not assessed (not zero). */
export async function masteryRows(
  studentId: string,
  conceptIds: string[]
): Promise<Map<string, ConceptMasteryRow>> {
  const rows = new Map<string, ConceptMasteryRow>();
  if (conceptIds.length === 0) return rows;

  for (let i = 0; i < conceptIds.length; i += IN_CHUNK) {
    const chunk = conceptIds.slice(i, i + IN_CHUNK);
    const { data } = await supabaseAdmin
      .from('bkt_mastery')
      .select('concept_id, latent_mastery, opportunity_count, last_updated')
      .eq('student_id', studentId)
      .in('concept_id', chunk);

    for (const row of data ?? []) {
      // NUMERIC and INTEGER both arrive as strings over PostgREST.
      const mastery = Number(row.latent_mastery);
      if (!Number.isFinite(mastery)) continue;
      const opportunities = Number(row.opportunity_count);
      rows.set(row.concept_id as string, {
        mastery,
        opportunityCount: Number.isFinite(opportunities) ? opportunities : 0,
        lastUpdated: (row.last_updated as string) ?? null,
      });
    }
  }

  return rows;
}

/**
 * Every `bkt_mastery` row for this student. Callers must intersect with their own concept set:
 * rows survive archiving and unlinking.
 */
export async function allMasteryRows(studentId: string): Promise<Map<string, ConceptMasteryRow>> {
  const rows = new Map<string, ConceptMasteryRow>();

  const { data } = await supabaseAdmin
    .from('bkt_mastery')
    .select('concept_id, latent_mastery, opportunity_count, last_updated')
    .eq('student_id', studentId);

  for (const row of data ?? []) {
    // NUMERIC and INTEGER both arrive as strings over PostgREST.
    const mastery = Number(row.latent_mastery);
    if (!Number.isFinite(mastery)) continue;
    const opportunities = Number(row.opportunity_count);
    rows.set(row.concept_id as string, {
      mastery,
      opportunityCount: Number.isFinite(opportunities) ? opportunities : 0,
      lastUpdated: (row.last_updated as string) ?? null,
    });
  }

  return rows;
}

/**
 * Latest `last_updated` in a concept-keyed map, optionally narrowed by `only`.
 * Not for `classMasteryRows()` maps, which are keyed by `classKey()`.
 */
export function latestUpdate(
  rows: ReadonlyMap<string, ConceptMasteryRow>,
  only?: ReadonlySet<string>
): string | null {
  let latest: string | null = null;
  for (const [conceptId, row] of rows) {
    if (only && !only.has(conceptId)) continue;
    if (row.lastUpdated && (latest === null || row.lastUpdated > latest)) latest = row.lastUpdated;
  }
  return latest;
}

/** Key for `classMasteryRows()`. */
export function classKey(studentId: string, conceptId: string): string {
  return `${studentId}:${conceptId}`;
}

/**
 * `bkt_mastery` rows for these students × these concepts, keyed by `classKey()`. Sparse: absent = not assessed.
 * Both id lists are chunked; the student filter leads so `idx_bkt_student_concept` applies.
 */
export async function classMasteryRows(
  studentIds: string[],
  conceptIds: string[]
): Promise<Map<string, ConceptMasteryRow>> {
  const rows = new Map<string, ConceptMasteryRow>();
  if (studentIds.length === 0 || conceptIds.length === 0) return rows;

  for (let s = 0; s < studentIds.length; s += IN_CHUNK) {
    const students = studentIds.slice(s, s + IN_CHUNK);

    for (let c = 0; c < conceptIds.length; c += IN_CHUNK) {
      const concepts = conceptIds.slice(c, c + IN_CHUNK);

      // Must stay paged and ordered: PostgREST silently caps responses at 1000 rows.
      for (let offset = 0; ; offset += PAGE) {
        const { data } = await supabaseAdmin
          .from('bkt_mastery')
          .select('student_id, concept_id, latent_mastery, opportunity_count, last_updated')
          .in('student_id', students)
          .in('concept_id', concepts)
          .order('student_id', { ascending: true })
          .order('concept_id', { ascending: true })
          .range(offset, offset + PAGE - 1);

        const page = data ?? [];
        for (const row of page) {
          // NUMERIC and INTEGER both arrive as strings over PostgREST.
          const mastery = Number(row.latent_mastery);
          if (!Number.isFinite(mastery)) continue;
          const opportunities = Number(row.opportunity_count);
          rows.set(classKey(row.student_id as string, row.concept_id as string), {
            mastery,
            opportunityCount: Number.isFinite(opportunities) ? opportunities : 0,
            lastUpdated: (row.last_updated as string) ?? null,
          });
        }

        if (page.length < PAGE) break;
      }
    }
  }

  return rows;
}

/**
 * Oldest surviving `bkt_update_logs` row per (student, concept), plus the trail's shape.
 * `lastPosterior` is for the integrity assert only and must never be serialised.
 */
export interface FirstObservation {
  /** `p_l_posterior` of the oldest row: mastery after the first opportunity. */
  firstPosterior: number;
  firstAt: string;
  lastAt: string;
  /** Cross-check only; never shipped. */
  lastPosterior: number;
  rows: number;
  bySource: { flashcard: number; adaptive_test: number };
}

/** Rows past this per chunk pair are dropped and `truncated` is set. */
const EVIDENCE_ROW_CAP = 5_000;

/**
 * First logged observation per (student, concept), keyed by `classKey()`; the "start" side of the
 * mastery-evidence export. `firstPosterior` is "after the first opportunity", never a baseline.
 * Ascending order matters: the cap then drops only the newest rows, which this reader doesn't need.
 */
export async function classFirstObservations(
  studentIds: string[],
  conceptIds: string[]
): Promise<{ rows: Map<string, FirstObservation>; truncated: boolean }> {
  const rows = new Map<string, FirstObservation>();
  let truncated = false;
  if (studentIds.length === 0 || conceptIds.length === 0) return { rows, truncated };

  for (let s = 0; s < studentIds.length; s += IN_CHUNK) {
    const students = studentIds.slice(s, s + IN_CHUNK);

    for (let c = 0; c < conceptIds.length; c += IN_CHUNK) {
      const concepts = conceptIds.slice(c, c + IN_CHUNK);

      for (let offset = 0; offset < EVIDENCE_ROW_CAP; offset += PAGE) {
        const { data } = await supabaseAdmin
          .from('bkt_update_logs')
          .select('student_id, concept_id, p_l_posterior, source, created_at')
          .in('student_id', students)
          .in('concept_id', concepts)
          .order('created_at', { ascending: true })
          .range(offset, offset + PAGE - 1);

        const page = data ?? [];
        for (const row of page) {
          // NUMERIC arrives as a string over PostgREST.
          const posterior = Number(row.p_l_posterior);
          if (!Number.isFinite(posterior)) continue;

          const key = classKey(row.student_id as string, row.concept_id as string);
          const at = row.created_at as string;
          const source = row.source as 'flashcard' | 'adaptive_test';

          const seen = rows.get(key);
          if (!seen) {
            rows.set(key, {
              firstPosterior: posterior,
              firstAt: at,
              lastAt: at,
              lastPosterior: posterior,
              rows: 1,
              bySource: {
                flashcard: source === 'flashcard' ? 1 : 0,
                adaptive_test: source === 'adaptive_test' ? 1 : 0,
              },
            });
            continue;
          }

          seen.rows += 1;
          seen.lastAt = at;
          seen.lastPosterior = posterior;
          if (source === 'flashcard') seen.bySource.flashcard += 1;
          else seen.bySource.adaptive_test += 1;
        }

        if (page.length < PAGE) break;
        if (offset + PAGE >= EVIDENCE_ROW_CAP) truncated = true;
      }
    }
  }

  return { rows, truncated };
}

/**
 * EQ(4) document mastery: mean over every concept, with a missing concept counted as P(L₀), not 0.
 * The only place the mean and its 4dp rounding live; the rounding keeps float error off tier boundaries.
 */
export function documentMastery(
  conceptIds: readonly string[],
  byConcept: ReadonlyMap<string, number>
): number {
  if (conceptIds.length === 0) return P_L0;
  const total = conceptIds.reduce((sum, id) => sum + (byConcept.get(id) ?? P_L0), 0);
  return Math.round((total / conceptIds.length) * 10_000) / 10_000;
}

/** EQ(4) for one concept set. For several subsets, use masteryRows() + documentMastery() instead. */
export async function masterySnapshot(
  studentId: string,
  conceptIds: string[]
): Promise<{ snapshot: number; byConcept: Map<string, number> }> {
  const byConcept = new Map<string, number>();
  if (conceptIds.length === 0) return { snapshot: P_L0, byConcept };

  for (const [conceptId, row] of await masteryRows(studentId, conceptIds)) {
    byConcept.set(conceptId, row.mastery);
  }

  return { snapshot: documentMastery(conceptIds, byConcept), byConcept };
}

/** Tier framing quoted from paper p. 81. The operative per-format rules are below. */
export const TIER_GUIDANCE: Record<DifficultyTier, string> = {
  foundational:
    'FOUNDATIONAL tier — simple, highly supportive retrieval focusing on direct definitions and ' +
    'basic conceptual associations. The student is meeting this material for the first time.',
  intermediate:
    'INTERMEDIATE tier — conceptual comparisons, multi-concept recall and practical applications. ' +
    'The student already knows the definitions.',
  advanced:
    'ADVANCED tier — analytical scenarios, synthesis and edge cases. The student has mastered the ' +
    'definitions and is being asked to reason with them.',
};

/**
 * True/false rules. These replace the "VERDICT" line itself; as a separate hint the model ignored
 * the tier. Thin source definitions still cap how hard advanced can get.
 */
export const TF_TIER_RULES: Record<DifficultyTier, { whenTrue: string; whenFalse: string }> = {
  foundational: {
    whenTrue: 'state plainly what the term IS, as the definition says.',
    whenFalse:
      'describe something the term is NOT — give it the meaning of a clearly different thing.',
  },
  intermediate: {
    whenTrue:
      'state WHEN or WHERE the term is used, or how it differs from a related idea in the lesson. ' +
      'Do not simply repeat the definition.',
    whenFalse:
      'give this term a job that actually belongs to a NEIGHBOURING idea in the same lesson, so it ' +
      'is only wrong to someone who can tell the two apart.',
  },
  advanced: {
    whenTrue:
      'state a CONSEQUENCE — what this achieves, prevents, or costs. Do NOT describe what it is. ' +
      'A sentence that could be mistaken for the definition is wrong for this tier.',
    whenFalse:
      'OVERSTATE what it guarantees — claim it prevents something it does not, or works in a case ' +
      'where it does not. It must sound correct to a student who memorised the definition but ' +
      'never thought about its limits.',
  },
};

/** What each tier means per question format: a concrete change of task, not an adjective. */
export const FORMAT_TIER_GUIDANCE: Record<string, Record<DifficultyTier, string>> = {
  multiple_choice: {
    foundational:
      'Ask what the term MEANS. The correct option restates the definition plainly. Distractors ' +
      'should be definitions of clearly different things.',
    intermediate:
      'Ask which SITUATION is an example of the term, or what it is FOR. Distractors should be ' +
      'neighbouring ideas from the same lesson that a student could confuse it with — near ' +
      'misses, not unrelated topics.',
    advanced:
      'Open with a one-sentence scenario, then ask what applies, what would go wrong, or what the ' +
      'consequence is. Distractors should be answers that are true in general but wrong for THIS ' +
      'scenario.',
  },
  true_or_false: {
    foundational: 'Statements are about what the term IS.',
    intermediate: 'Statements are about WHEN the term is used, or how it differs from a related idea.',
    advanced: 'Statements are about the CONSEQUENCES of the term — what it achieves, prevents or costs.',
  },
  identification: {
    foundational: 'Describe plainly what the term is.',
    intermediate:
      'Describe a realistic situation in which this term is what is needed, without defining it.',
    advanced:
      'Describe the PROBLEM this term solves, or what goes wrong in its absence, and let the ' +
      'student infer it. Do not describe the term itself.',
  },
  fill_in_the_blank: {
    foundational: 'A plain definitional sentence with the term removed.',
    intermediate: 'A sentence set in a practical, everyday situation where the term is applied.',
    advanced:
      'The sentence must describe something GOING WRONG — a failure, a cost, or a trade-off that ' +
      'happens when this is missing, skipped or done badly. A sentence about the benefit of doing ' +
      'it correctly is an INTERMEDIATE sentence and is not acceptable here.',
  },
  matching_type: {
    foundational: 'A plain, literal restatement of what the term is.',
    intermediate: 'What the term is FOR — its purpose in one short phrase.',
    advanced: 'The effect it has, or the problem it prevents — not a restatement of the name.',
  },
};
