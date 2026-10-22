import { foldKey, acronymOf } from './conceptExtraction';
import type { QuestionFormat } from './testAllocation';

/**
 * Deterministic test grading, no model call. `is_correct` is always computed here from the stored
 * key, never accepted from the client. Lenient matching would falsify P(G_id) = 0.05 (paper p. 75).
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dropArticle = (s: string) => s.replace(/^(?:a|an|the)\s+/, '');

/** Crude plural tolerance: with and without a trailing "s". */
const singulars = (s: string) => [s, s.replace(/s$/, ''), `${s}s`];

/** "RA 10173 – ", "R.A. 10175 — ", "Republic Act No. 8792 - " */
const STATUTE_PREFIX = /^(?:r\.?\s?a\.?|republic act)(?:\s+no\.?)?\s*[\d.]+\s*[–—-]\s*/i;
/** "… of 2012" */
const YEAR_SUFFIX = /\s+of\s+\d{4}$/i;

/**
 * Other names for this exact concept, derived only by mechanical rules (acronym, statute code,
 * year suffix), never by substring: "Injection" is not an alias of "SQL Injection".
 */
function termAliases(term: string): string[] {
  const seeds = new Set<string>();
  const add = (s: string) => {
    const value = norm(s);
    if (value) seeds.add(value);
  };

  add(term);
  add(foldKey(term));

  const acronym = acronymOf(term);
  if (acronym) add(acronym);

  // Peel a statute code off the front, keeping both halves.
  const codeMatch = STATUTE_PREFIX.exec(term.trim());
  const withoutCode = term.trim().replace(STATUTE_PREFIX, '');
  if (codeMatch) {
    add(withoutCode);
    add(codeMatch[0].replace(/\s*[–—-]\s*$/, ''));
  }

  // …and a trailing year from whatever is left.
  for (const base of [term, withoutCode, foldKey(term)]) {
    if (YEAR_SUFFIX.test(base.trim())) add(base.trim().replace(YEAR_SUFFIX, ''));
  }

  return [...seeds];
}

/**
 * Whether a typed answer names the expected term. Reuses foldKey/acronymOf so the rule exists once.
 * Never add substring matching: it would mark "Injection" correct for "SQL Injection".
 */
export function matchesTerm(expected: string, given: string): boolean {
  const a = norm(given);
  if (!a) return false;

  // "… Life Cycle (SSDLC)" ≡ "… Life Cycle", in either direction.
  if (norm(foldKey(given)) === norm(foldKey(expected))) return true;

  const aPlain = dropArticle(a);
  return termAliases(expected).some((alias) => {
    const bPlain = dropArticle(alias);
    return a === alias || aPlain === bPlain || singulars(aPlain).includes(bPlain);
  });
}

/** Choice answers are stored as option text, so they compare exactly. */
function matchesExact(expected: string, given: string): boolean {
  return norm(given) !== '' && norm(given) === norm(expected);
}

/** The one place a question is marked. Unanswered counts as wrong, so skipping can't raise a score. */
export function gradeAnswer(
  format: QuestionFormat,
  expected: string,
  given: string | null | undefined
): boolean {
  if (given === null || given === undefined || given.trim() === '') return false;

  switch (format) {
    case 'identification':
    case 'fill_in_the_blank':
      return matchesTerm(expected, given);
    case 'multiple_choice':
    case 'true_or_false':
    case 'matching_type':
      return matchesExact(expected, given);
    default:
      return false;
  }
}
