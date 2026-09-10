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
 * PostgREST's own default `db.max_rows`; nothing in this project raises it.
 * Declared beside `IN_CHUNK` because both readers below page against it.
 */
const PAGE = 1_000;

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
 * Every `bkt_mastery` row this student has, whatever material it belongs to.
 *
 * The global counterpart of `masteryRows()`, and it needs none of that function's
 * machinery: `bkt_mastery` carries `student_id` directly, so there is no concept
 * id list to pass and therefore nothing to chunk. One query, whatever the size of
 * the student's library. That is what makes a single global dashboard read
 * possible where the per-space endpoints cost N.
 *
 * Callers MUST intersect the result with their own concept set. A student keeps
 * mastery rows for concepts whose material has since been archived or unlinked —
 * mastery is per (student, concept) and survives both — and counting those would
 * quietly inflate every denominator on the page.
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
 * Most recent `last_updated` across rows already in hand — no extra query.
 *
 * `only` narrows it to one material's concepts. ISO-8601 UTC strings sort
 * lexicographically in timestamp order, so this needs no Date parsing.
 *
 * Lives here rather than in `practice.routes.ts`, where it started, because the
 * educator analytics needs it against a map produced by `masteryRows()` too — and
 * a routes file exporting a helper up to another routes file is backwards.
 *
 * ⚠️ Keyed by CONCEPT id. A `classMasteryRows()` map is keyed by `classKey()`, so
 * this cannot be pointed at one; take the max as you fold that map instead.
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

/** Key for `classMasteryRows()`. The only place this composition is written. */
export function classKey(studentId: string, conceptId: string): string {
  return `${studentId}:${conceptId}`;
}

/**
 * Every `bkt_mastery` row for THESE students over THESE concepts, keyed by
 * `classKey()`.
 *
 * The class counterpart of `masteryRows()`, and the first reader in the codebase
 * that is not about one student. Everything else — `masteryRows`,
 * `allMasteryRows`, `masterySnapshot` — is single-student by signature, because
 * until the educator analytics landed nothing on the server ever needed to name a
 * set of students.
 *
 * BOTH id lists are chunked. `.in()` serialises into the QUERY STRING (see
 * `IN_CHUNK` above), and this is the first place two lists multiply into one URL:
 * a grade of 50 students against a 400-concept lesson is ~17 KB of ids. The nested
 * loop degenerates to a single query at realistic sizes (50 × 57) and stays
 * correct at any size.
 *
 * The student filter leads on purpose. `idx_bkt_student_concept` is
 * `(student_id, concept_id)`, so constraining students lets the index be used as a
 * prefix; filtering on concepts alone cannot use it at all, and would additionally
 * drag in rows for students in other grades that the caller must then discard.
 *
 * As with `masteryRows()`, a missing entry means NOT ASSESSED — not zero, and not
 * P(L₀). Callers must be able to tell those apart, which is the whole reason this
 * returns a sparse map rather than a filled grid.
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

      /*
       * ⚠️ PAGED, and it must stay paged. PostgREST caps a response at 1000 rows
       * by default (nothing sets `db.max_rows` in `server/lib/supabase.ts`) and
       * one chunk pair asks for up to IN_CHUNK², i.e. 40,000. A single 50-student
       * class on a 57-concept material is already 2,850 — so the unpaged version
       * silently returned the first 1000 and every screen reading this quietly
       * under-reported. There is no error to notice: the request succeeds.
       *
       * Ordered, because a cap without an order is a cap on an arbitrary subset.
       */
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

        // A short page is the last page. The pair can hold at most IN_CHUNK²
        // rows, so this terminates without a separate cap.
        if (page.length < PAGE) break;
      }
    }
  }

  return rows;
}

/**
 * The oldest surviving `bkt_update_logs` row for a (student, concept) pair, plus
 * the trail's shape around it.
 *
 * `lastPosterior` exists ONLY for the integrity assert in
 * `GET /materials/:id/mastery-evidence` — it must never be serialised. The
 * authoritative current value is `bkt_mastery.latent_mastery`; the audit trail is
 * allowed to lose rows (`logWriteError` in `bkt.ts` is non-fatal by design, and
 * stays that way), so anything a reader anchors on must come from the mastery
 * table, never from here.
 */
export interface FirstObservation {
  /** `p_l_posterior` of the OLDEST row — mastery after the first opportunity. */
  firstPosterior: number;
  firstAt: string;
  lastAt: string;
  /** `p_l_posterior` of the newest row. Cross-check only — never shipped. */
  lastPosterior: number;
  rows: number;
  bySource: { flashcard: number; adaptive_test: number };
}

/**
 * Rows past this per chunk pair are dropped and `truncated` is set. Mirrors
 * `CURVE_ROW_CAP` in `dashboard.routes.ts` — same job, same order of magnitude.
 */
const EVIDENCE_ROW_CAP = 5_000;

/**
 * The FIRST logged observation per (student, concept), for THESE students over
 * THESE concepts, keyed by `classKey()`.
 *
 * This is the "before" half of the mastery-evidence export, and the reason it
 * reads the audit trail at all: `bkt_mastery` holds only the current value, so a
 * per-student growth figure has nowhere else to come from.
 *
 * ⚠️ `firstPosterior` IS NOT A BASELINE AND MUST NEVER BE LABELLED AS ONE. It is
 * EQ(3) applied to the student's FIRST answer, so that answer's outcome is already
 * inside it (a first correct MCQ lands at 0.3271, a first wrong one at 0.2174).
 * The honest phrasing is "after the first opportunity". What it is NOT is
 * `p_l_prior`, which is P(L₀) = 0.10 for every student on every concept — the
 * model's initialisation, not a measurement, and forbidden from any output.
 *
 * ⚠️ ASCENDING ORDER IS LOAD-BEARING. The cap then drops only the NEWEST rows,
 * which this reader does not need — the "after" side is anchored to
 * `bkt_mastery.latent_mastery`, never to the log. `buildCurve()` gets the same
 * property from ordering the other way, because it is anchored at the other end.
 *
 * Both id lists are chunked exactly as `classMasteryRows()` chunks them, and each
 * chunk pair is additionally PAGED: `.in()` goes into the query string, and one
 * pair can legitimately want more rows than PostgREST returns by default (50
 * students × 2 tests × 20 items is 2,000 rows for a single material).
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

          // Ascending order means the first row seen for a key is the oldest, so
          // only the trailing half moves.
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
