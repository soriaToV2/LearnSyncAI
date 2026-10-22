/**
 * Allocates concepts to test sections, which fixes the test length. Authoritative copy;
 * `src/lib/testMode.ts` mirrors it for the setup preview. Change both together.
 */

/** Matches the `question_type` enum. */
export type QuestionFormat =
  | 'multiple_choice'
  | 'true_or_false'
  | 'identification'
  | 'fill_in_the_blank'
  | 'matching_type';

/** Matches `practice_tests.difficulty_tier` and `mastery_tier()`. */
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
 * 4 terms vs 6 definitions (paper p. 75). Six options is what makes P(G_match) = 1/6;
 * if the two ever conflict, bend the term count, never the option count.
 */
export const MATCH_TERMS_PER_BLOCK = 4;
export const MATCH_OPTIONS_PER_BLOCK = 6;

export interface AllocationItem {
  format: QuestionFormat;
  count: number;
}

export interface Allocation {
  items: AllocationItem[];
  /** Concepts that get a question; less than the total only when matching rounds down. */
  covered: number;
  /** Matching requested but no room for a whole block. */
  matchingDropped: boolean;
}

/** Formats in exam-paper order. */
export function orderedFormats(formats: QuestionFormat[]): QuestionFormat[] {
  return [...new Set(formats)].sort((a, b) => SECTION_ORDER[a] - SECTION_ORDER[b]);
}

/**
 * One question per concept, always, so each test gives BKT one independent observation per concept.
 * Matching is allocated first in whole blocks; the rest is split across the other formats.
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
