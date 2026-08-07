/**
 * Which concept goes to which section of a practice test, and therefore how long
 * the test is.
 *
 * **This is the authoritative copy.** `src/lib/testMode.ts` holds a mirror that
 * drives the setup preview only; the server counts `concepts` itself and
 * re-derives the allocation, because a client-supplied length is a client-chosen
 * test — a student could ask for five questions and still bank BKT evidence.
 * Same arrangement as `server/lib/reviewSchedule.ts` ↔ `src/lib/reviewSchedule.ts`.
 *
 * The two copies must stay in step. If you change the rule here, change it there.
 */

/** Exactly the Postgres `question_type` enum (schema.sql:39-45). */
export type QuestionFormat =
  | 'multiple_choice'
  | 'true_or_false'
  | 'identification'
  | 'fill_in_the_blank'
  | 'matching_type';

/** Exactly `practice_tests.difficulty_tier`'s CHECK, and `mastery_tier()` in schema.sql. */
export type DifficultyTier = 'foundational' | 'intermediate' | 'advanced';

export const ALL_FORMATS: QuestionFormat[] = [
  'multiple_choice',
  'true_or_false',
  'identification',
  'fill_in_the_blank',
  'matching_type',
];

const SECTION_ORDER: Record<QuestionFormat, number> = {
  multiple_choice: 1,
  true_or_false: 2,
  identification: 3,
  fill_in_the_blank: 4,
  matching_type: 5,
};

/**
 * Paper p. 75: "Matching Type (4 terms, 6 definitions): P(G_match) = 0.17 … the
 * probability of selecting the correct definition from the pool of six through
 * random guessing is 1/6 ≈ 0.17, applied per matched item."
 *
 * SIX OPTIONS is the BKT rule — 1/6 is the guess probability the update applies,
 * so any other pool size makes the maths wrong. FOUR TERMS is a fidelity rule:
 * "per matched item" means the term count never enters the formula, but the
 * paper and the `schema.sql` seed comment both state it, so a short trailing
 * block must never be produced.
 */
export const MATCH_TERMS_PER_BLOCK = 4;
export const MATCH_OPTIONS_PER_BLOCK = 6;

export interface AllocationItem {
  format: QuestionFormat;
  count: number;
}

export interface Allocation {
  items: AllocationItem[];
  /** Concepts that get a question. Equals `conceptCount` unless matching rounds down. */
  covered: number;
  /** Matching was requested but there was no room for a whole block of four. */
  matchingDropped: boolean;
}

/** The chosen formats in exam-paper order. */
export function orderedFormats(formats: QuestionFormat[]): QuestionFormat[] {
  return [...new Set(formats)].sort((a, b) => SECTION_ORDER[a] - SECTION_ORDER[b]);
}

/**
 * ONE QUESTION PER CONCEPT, always.
 *
 * The student does not choose a length. A length picker meant cycling concepts
 * to fill it, so a 40-item test on a 29-concept lesson asked about some concepts
 * three or four times in one sitting — and four back-to-back answers on one
 * concept are not four independent observations, which is exactly what BKT
 * assumes. Same trap the flashcard due-check exists to avoid. One question per
 * concept means one BKT observation per concept per test, and it makes
 * `document_mastery()` meaningful after a single test.
 *
 * Matching is allocated FIRST and only in whole blocks of four; the remainder
 * goes to the other sections. If matching is the only format chosen there is
 * nowhere for the remainder to go, so those concepts are untested — `covered`
 * reports it rather than the count silently disagreeing.
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
    // `n < MATCH_OPTIONS_PER_BLOCK` is the other half of the block invariant:
    // four terms need six DISTINCT definitions to choose between, and a lesson
    // with five concepts cannot supply them.
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
