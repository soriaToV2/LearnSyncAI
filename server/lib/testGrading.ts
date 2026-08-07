import { foldKey, acronymOf } from './conceptExtraction';
import type { QuestionFormat } from './testAllocation';

/**
 * Grading a practice test answer.
 *
 * DETERMINISTIC, WITH NO MODEL CALL, on purpose:
 *
 *   - A score a student is shown must be reproducible. That is the same
 *     principle that put `findMemoisedAttempt()` in Free Recall; here it comes
 *     free, because the same answer always grades the same way.
 *   - `P(G_id) = 0.05` (paper p. 75) states that identification and
 *     fill-in-the-blank are near-impossible to guess. Lenient grading quietly
 *     falsifies that number, and the BKT update built on it.
 *   - It costs no quota, so a 29-question test is one Groq round of generation
 *     and nothing else.
 *
 * `is_correct` is ALWAYS computed here from the stored key. The old endpoint
 * took it from the request body, which let a student post `{is_correct: true}`
 * for every concept in the space — the exact write RLS forbids a browser from
 * making directly.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dropArticle = (s: string) => s.replace(/^(?:a|an|the)\s+/, '');

/** Crude but symmetric: compares with and without a trailing "s" on each side. */
const singulars = (s: string) => [s, s.replace(/s$/, ''), `${s}s`];

/** "RA 10173 – ", "R.A. 10175 — ", "Republic Act No. 8792 - " */
const STATUTE_PREFIX = /^(?:r\.?\s?a\.?|republic act)(?:\s+no\.?)?\s*[\d.]+\s*[–—-]\s*/i;
/** "… of 2012" */
const YEAR_SUFFIX = /\s+of\s+\d{4}$/i;

/**
 * The other names this exact concept goes by.
 *
 * Every entry is derived by a MECHANICAL pattern, never by taking a substring.
 * That distinction is the whole safety property: "Data Privacy Act" is a real
 * alias of "RA 10173 – Data Privacy Act of 2012" because a statute code and a
 * year suffix are removable by rule, whereas "Injection" is not an alias of
 * "SQL Injection" — it is a different, broader entry in the same lesson that
 * merely happens to be a substring.
 *
 * Same dividing line CLAUDE.md draws for `foldKey`: code settles mechanical
 * patterns, educators settle judgement calls.
 *
 * This exists because live terms are long. `RA 10173 – Data Privacy Act of 2012`
 * is 35 characters, and requiring a 13-year-old to reproduce it exactly turns a
 * correct answer into a slip — which then feeds BKT as evidence of not knowing.
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
 * Does a typed answer name the expected term?
 *
 * A ladder, widest-safe first. `foldKey` and `acronymOf` come from
 * `conceptExtraction.ts`, exported there precisely so the rule for "what counts
 * as naming this concept" exists once. Free Recall already resolves a student's
 * typed term through the same pair; a second private copy here is how the two
 * sides drift apart.
 *
 * WHAT IS DELIBERATELY ABSENT: substring or containment matching. It reads as
 * generous and is simply wrong — "Injection" is contained in "SQL Injection", so
 * containment marks a wrong answer correct, and the two are different entries in
 * the same lesson. Leniency here is not kindness; it is a false positive fed
 * into a mastery estimate.
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

/** Choice-style answers are stored as the option text, so they compare exactly. */
function matchesExact(expected: string, given: string): boolean {
  return norm(given) !== '' && norm(given) === norm(expected);
}

/**
 * The one place a question is marked right or wrong.
 *
 * An unanswered question is wrong, not excluded — skipping must not be a way to
 * raise a score, which is also why the test score divides by the total rather
 * than by the number answered.
 */
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
