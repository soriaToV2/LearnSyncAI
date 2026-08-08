import { supabaseAdmin } from './supabase';
import type { DifficultyTier } from './testAllocation';

/**
 * Difficulty calibration for a practice test.
 *
 * Paper p. 81: "When the student subsequently requests the generation of a new
 * practice test session on the same topic, the system queries this historical
 * BKT mastery probability to scale the conceptual difficulty of the newly
 * generated items. The adaptive test generation engine utilizes specific mastery
 * thresholds to adjust the generation prompt instructions sent to the large
 * language model."
 *
 * SESSION-BASED, NOT PER QUESTION. One tier is chosen when the test is built and
 * applies to every item in it — which is why `practice_tests.difficulty_tier`
 * and `mastery_snapshot` are single columns. Both are stored, because the
 * paper's Difficulty Alignment check (p. 98) is precisely "confirms that the
 * adaptive calibration pipeline correctly passes the mastery parameter to the
 * generative AI prompt", and it cannot be run against data that was never saved.
 *
 * UNTIL BKT LANDS every test is `foundational` at a snapshot of 0.10, and that
 * is correct rather than broken — nothing writes mastery yet. The plumbing is
 * built now so Phase 3 is a BKT engine and not also a Test Mode change.
 */

/**
 * P(L₀), the prior for a concept the student has never been assessed on.
 *
 * 0.10, from Bulut et al. (2023). Matches `bkt_parameters.p_l0`, the
 * `bkt_mastery.latent_mastery` column default, and the inner COALESCE in
 * `document_mastery()` — all four must agree. Phase 3 should read this from
 * `bkt_parameters` when it reads the rest of the parameter set.
 */
export const P_L0 = 0.1;

/**
 * Thresholds from paper p. 81 and p. 98, and identical to `mastery_tier()` in
 * schema.sql — which stays the definition of record for the analytics views.
 *
 * Note these are 0.50 / 0.85. The dead prompt this replaces used 30% / 70%,
 * which matched nothing in the paper or the schema.
 */
export function masteryTier(mastery: number): DifficultyTier {
  if (!Number.isFinite(mastery)) return 'foundational';
  if (mastery >= 0.85) return 'advanced';
  if (mastery >= 0.5) return 'intermediate';
  return 'foundational';
}

/** One student's stored mastery for one concept. */
export interface ConceptMasteryRow {
  /** `bkt_mastery.latent_mastery`, already `Number()`-coerced. */
  mastery: number;
  /** Reporting metadata — never enters the BKT arithmetic. */
  opportunityCount: number;
  lastUpdated: string | null;
}

/**
 * Supabase serialises `.in()` into the QUERY STRING, so a long id list becomes a
 * long URL. Four hundred concepts at 37 characters each is roughly 15 KB of URL,
 * past the default header buffer on common gateways. Chunking is eight lines and
 * closes the whole class of failure permanently.
 */
const IN_CHUNK = 200;

/**
 * Every `bkt_mastery` row this student has for `conceptIds`.
 *
 * Concepts with no row are simply absent from the map — that absence is the
 * difference between "not assessed yet" and "assessed and low", and every caller
 * depends on being able to tell those apart.
 */
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
 * EQ(4), document mastery: the arithmetic mean of per-concept probabilities over
 * EVERY concept in the material, computed from values already in hand.
 *
 * **A concept absent from `byConcept` counts as P(L₀), not as zero.** That is the
 * easy thing to get wrong here, and getting it wrong would drag every snapshot
 * toward 0 and pin every test to `foundational` forever — invisibly, because
 * `foundational` is also the correct answer for a new student. Mirrors
 * `document_mastery()` in schema.sql, which is
 * `COALESCE(avg(COALESCE(bm.latent_mastery, 0.10)), 0.10)`.
 *
 * THE ONLY PLACE THE MEAN AND ITS ROUNDING ARE WRITTEN. The rounding is
 * load-bearing rather than cosmetic: fourteen concepts at 0.90 and fourteen at
 * 0.10 is exactly 0.5 on paper but accumulates to 0.49999999999999994 in
 * floating point, which `masteryTier` reads as `foundational` — a tier boundary
 * decided by summation order. Rounding before the comparison removes that, and
 * it also stops `mastery_snapshot` being stored as 0.10000000000000005 in a
 * column a human reads for the Difficulty Alignment check.
 */
export function documentMastery(
  conceptIds: readonly string[],
  byConcept: ReadonlyMap<string, number>
): number {
  if (conceptIds.length === 0) return P_L0;
  const total = conceptIds.reduce((sum, id) => sum + (byConcept.get(id) ?? P_L0), 0);
  return Math.round((total / conceptIds.length) * 10_000) / 10_000;
}

/**
 * EQ(4) for one concept set, fetching the rows it needs.
 *
 * Prefer `masteryRows()` + `documentMastery()` when more than one subset of the
 * same concepts is needed — calling this in a loop re-fetches rows the first call
 * already had, which is what the mastery endpoint used to do once per material.
 */
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

/**
 * The tier framing, quoted from paper p. 81 so the prompt and the write-up
 * cannot drift apart. Used as the opening line; the operative instruction is
 * `FORMAT_TIER_GUIDANCE` below.
 */
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
 * What the tier actually means FOR THIS QUESTION FORMAT.
 *
 * One shared paragraph did not work. Measured across three generations of the
 * same fifteen concepts, intermediate and advanced came back **byte-identical**
 * for true/false, and average prompt length differed by four characters (129 vs
 * 125). The cause is ordinary prompt behaviour: the tier sentence sat in a
 * shared header while the rules immediately after it were specific and
 * imperative, so the specific ones won.
 *
 * Naming a concrete change of TASK per format — recall it, apply it, reason
 * about what happens when it fails — gives the model something it can actually
 * do differently.
 *
 * ⚠️ THE SOURCE MATERIAL IS THE REAL CEILING. A concept whose definition is
 * fifteen words ("Reduces Downtime — helps get systems running again quickly")
 * cannot support a genuine edge-case question, no matter how the prompt is
 * worded. Expect advanced to be reachable on richly-defined concepts and to
 * collapse toward intermediate on thin ones. That is a property of the lesson,
 * not a bug to prompt around, and it is worth stating in the write-up rather
 * than claiming a difficulty separation the output does not show.
 */
/**
 * True/false needs its own table, and this is why.
 *
 * Measured: with the tier instruction only in the shared header, the writer
 * produced **the same sentence at all three tiers** — even for SSDLC, the
 * richest concept in the corpus at 643 characters. So it was not the source
 * material running out; the writer was ignoring the tier.
 *
 * The cause is structural. The operative instruction in that prompt is
 * "VERDICT: TRUE — write a statement the definition supports", and restating the
 * definition is always the safest way to satisfy it. A tier hint fifteen lines
 * above loses to the rule sitting on the line the model is answering.
 *
 * So the tier rule now REPLACES that line rather than decorating it, and each
 * tier names a different subject for the sentence. `advanced` additionally
 * forbids describing what the term is, because that is the attractor.
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
