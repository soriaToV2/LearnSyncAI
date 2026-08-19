/**
 * BKT Implementation Correctness Rate (ICR) harness.
 *
 *   npx tsx scripts/bkt-verify.ts              # offline: the arithmetic
 *   npx tsx scripts/bkt-verify.ts --live       # + drive the real flashcard endpoint
 *   npx tsx scripts/bkt-verify.ts --live --live-test
 *                                              # + generate and sit a real test
 *                                              #   (5 gemini-3.6-flash requests — see below)
 *   npx tsx scripts/bkt-verify.ts --live --keep
 *                                              # leave the throwaway student behind
 *
 * `--live` needs `npm run dev:server` running. It builds its own throwaway
 * student and deletes it afterwards, so it touches no real account and can be
 * re-run freely.
 *
 * WHAT THIS IS FOR
 *
 * Paper pp. 94-96 defines how the BKT engine is evaluated. There is no accuracy
 * metric, because the parameters are selected rather than learned:
 *
 *   "The BKT module is evaluated through deterministic algorithm verification,
 *    confirming whether the system's programmatic implementation produces mastery
 *    estimates that are mathematically identical to hand-computed expected
 *    values... These test cases cover consecutive correct responses, consecutive
 *    incorrect responses, alternating responses, and mixed sequences across
 *    Adaptive Flashcard ratings (Easy, Medium, Hard) and Adaptive Test Mode
 *    question types... Each test case is executed in the live application, and
 *    the system-generated mastery value is compared against the manually computed
 *    expected value."
 *
 *   EQ(6):  ICR = (passed test cases / total test cases) x 100
 *
 *   "A test case is considered passed if the absolute difference between the
 *    system-generated and manually computed values falls within a tolerance of
 *    +/-0.01, accounting for floating-point arithmetic variations."
 *
 * ── HOW THIS AVOIDS GRADING ITS OWN HOMEWORK ─────────────────────────────────
 *
 * A harness that computes the expected answer with the code under test proves
 * nothing. Three rules keep that from happening, and they are the reason this
 * file is arranged the way it is:
 *
 * RULE 1 — Section 2 states every parameter as a LITERAL and never looks one up.
 *   It imports `bktStep` and nothing else. If it fetched P(G) through
 *   `GUESS_KEY_BY_FORMAT`, then a mapping bug (true_or_false wired to g_mc) would
 *   PASS, because both sides would use the same wrong number. Section 1 tests
 *   those maps separately, against literals from the paper.
 *
 * RULE 2 — Section 3's expectations come from a second, independent derivation:
 *   the ODDS-RATIO form of the same equations.
 *
 *        odds(L) = L / (1 - L)
 *        correct    odds(L | obs=1) = odds(L) * (1 - P(S)) / P(G)
 *        incorrect  odds(L | obs=0) = odds(L) * P(S) / (1 - P(G))
 *        transition P(L_t+1)        = 1 - (1 - e)(1 - P(T))
 *
 *   Algebraically identical to EQ(1)/(2)/(3) — divide numerator and denominator
 *   of EQ(1) by (1-L)P(G) to see it — but no shared arithmetic whatsoever. Two
 *   independent routes agreeing to 1e-12 across the full matrix is a far stronger
 *   claim than one route agreeing with itself.
 *
 * RULE 3 — Chained cases restate their own prior as a literal (Section 2), so one
 *   arithmetic slip is one failure rather than a cascade down the sequence.
 *   Section 4 exists to close the gap that leaves: it checks that the posterior
 *   really is fed forward as the next prior.
 *
 * Section 5 is the strongest check available and depends on no arithmetic at all:
 * the all-incorrect fixed point is closed-form. Solving L = 0.8e(L) + 0.2 for
 * multiple choice gives 4L^2 - 5L + 1 = 0, whose non-trivial root is exactly
 * 0.25; for true/false, 7L^2 - 9L + 2 = 0 gives 2/7. Those roots were obtained
 * with the quadratic formula on paper, so no reader can call them circular.
 *
 * ── A WARNING FOR WHOEVER EXTENDS THIS ───────────────────────────────────────
 *
 * CONSECUTIVE-INCORRECT SEQUENCES GO UP, NOT DOWN, and the expected literals
 * below say so. `posterior = e + (1-e)P(T)` bottoms out at P(T) = 0.20, above the
 * 0.10 prior, so three wrong multiple-choice answers run 0.10 -> 0.2174 -> 0.2421
 * -> 0.2480. That is a non-zero learning rate doing its job. If you "correct"
 * these literals downward you will break a working engine to satisfy an intuition
 * the model does not share.
 */

import 'dotenv/config';
import {
  bktStep,
  loadBktParameters,
  GUESS_KEY_BY_FORMAT,
  GUESS_KEY_BY_RATING,
  OBSERVATION_BY_RATING,
  type GuessKey,
} from '../server/lib/bkt';
import type { QuestionFormat } from '../server/lib/testAllocation';
import type { EaseRating } from '../server/lib/reviewSchedule';

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

/** Paper p. 96. */
const TOLERANCE = 0.01;
/** Floating-point slack so a value exactly on the boundary is not a coin flip. */
const EPSILON = 1e-9;

interface Section {
  id: string;
  title: string;
  provenance: string;
  passed: number;
  total: number;
}

const sections: Section[] = [];
let current: Section | null = null;

function beginSection(id: string, title: string, provenance: string): void {
  current = { id, title, provenance, passed: 0, total: 0 };
  sections.push(current);
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`${id}  ${title}`);
  console.log(`     expectations derived from: ${provenance}`);
  console.log('─'.repeat(100));
}

function record(pass: boolean): void {
  if (!current) throw new Error('record() called outside a section');
  current.total += 1;
  if (pass) current.passed += 1;
}

const f4 = (x: number): string => x.toFixed(4);
const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n);

/** One case judged at the paper's ±0.01. */
function check(label: string, actual: number, expected: number, work?: string): boolean {
  const delta = Math.abs(actual - expected);
  const pass = delta <= TOLERANCE + EPSILON;
  record(pass);
  console.log(
    `  ${pad(label, 54)} ${f4(actual)}  vs ${f4(expected)}   Δ ${delta.toFixed(4)}  ${pass ? 'PASS' : '** FAIL **'}`
  );
  if (work) console.log(`     ${work}`);
  return pass;
}

/** An exact equality, for parameter values and lookup tables. */
function checkExact(label: string, actual: unknown, expected: unknown): boolean {
  const pass = actual === expected;
  record(pass);
  console.log(
    `  ${pad(label, 54)} ${pad(String(actual), 18)} expected ${pad(String(expected), 18)} ${pass ? 'PASS' : '** FAIL **'}`
  );
  return pass;
}

// ─────────────────────────────────────────────────────────────────────────────
// The independent implementation (Rule 2)
// ─────────────────────────────────────────────────────────────────────────────

const S = 0.15;
const T = 0.2;

/**
 * The odds-ratio form. Deliberately NOT imported from bkt.ts — this is a second
 * derivation of the same equations, written out so a reader can check the algebra.
 *
 * Goes to NaN once mastery saturates to 1.0 (`L/(1-L)` diverges), which is how
 * the absorbing-state problem in the direct form was found. Callers must stop at
 * the boundary; `MASTERY_CEILING` in bkt.ts is what keeps the direct form off it.
 */
function oddsFormStep(prior: number, correct: boolean, pGuess: number): { evidence: number; posterior: number } {
  const priorOdds = prior / (1 - prior);
  const posteriorOdds = correct ? (priorOdds * (1 - S)) / pGuess : (priorOdds * S) / (1 - pGuess);
  const evidence = posteriorOdds / (1 + posteriorOdds);
  return { evidence, posterior: 1 - (1 - evidence) * (1 - T) };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Parameter fidelity
// ─────────────────────────────────────────────────────────────────────────────

/** Every value quoted from the paper, pp. 71-75. */
const PAPER_PARAMETERS: { key: string; value: number; where: string }[] = [
  { key: 'p_l0', value: 0.1, where: 'p.71  "P(L0) = 0.10"' },
  { key: 'p_t', value: 0.2, where: 'p.71  "P(T) = 0.20"' },
  { key: 'p_s', value: 0.15, where: 'p.75  "P(S) = 0.15"' },
  { key: 'g_mc', value: 0.25, where: 'p.73  "Multiple Choice (4 options) ... 1/4 = 0.25"' },
  { key: 'g_tf', value: 0.5, where: 'p.73  "True or False ... 1/2 = 0.50"' },
  { key: 'g_id', value: 0.05, where: 'p.73  "Identification ... negligibly low"' },
  { key: 'g_fib', value: 0.05, where: 'p.74  "Fill in the Blank ... 0.05"' },
  { key: 'g_match', value: 0.17, where: 'p.74  "Matching Type ... 1/6, applied per matched item"' },
  { key: 'g_easy', value: 0.05, where: 'p.72  "A rating of Easy assigns P(G_easy) = 0.05"' },
  { key: 'g_medium', value: 0.25, where: 'p.72  "A rating of Medium assigns P(G_medium) = 0.25"' },
  { key: 'g_hard', value: 0.1, where: 'p.72  "A rating of Hard assigns P(G_hard) = 0.10"' },
];

async function sectionParameters(): Promise<void> {
  beginSection('§1', 'Parameter fidelity', 'literals quoted from the paper, pp. 71-75');

  const params = await loadBktParameters({ force: true });
  const live: Record<string, number> = {
    p_l0: params.pL0,
    p_t: params.pT,
    p_s: params.pS,
    ...params.guess,
  };

  for (const { key, value, where } of PAPER_PARAMETERS) {
    checkExact(`${key}  ${where}`, live[key], value);
  }

  console.log('');
  const formatExpect: Record<QuestionFormat, GuessKey> = {
    multiple_choice: 'g_mc',
    true_or_false: 'g_tf',
    identification: 'g_id',
    fill_in_the_blank: 'g_fib',
    matching_type: 'g_match',
  };
  for (const [format, key] of Object.entries(formatExpect) as [QuestionFormat, GuessKey][]) {
    checkExact(`format ${format} selects`, GUESS_KEY_BY_FORMAT[format], key);
  }

  console.log('');
  const ratingExpect: Record<EaseRating, { key: GuessKey; obs: 0 | 1 }> = {
    easy: { key: 'g_easy', obs: 1 },
    medium: { key: 'g_medium', obs: 1 },
    hard: { key: 'g_hard', obs: 0 }, // p.72 "and is recorded as an incorrect response"
  };
  for (const [rating, want] of Object.entries(ratingExpect) as [EaseRating, { key: GuessKey; obs: 0 | 1 }][]) {
    checkExact(`rating ${rating} selects`, GUESS_KEY_BY_RATING[rating], want.key);
    checkExact(`rating ${rating} observation`, OBSERVATION_BY_RATING[rating], want.obs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Hand-computed anchors
// ─────────────────────────────────────────────────────────────────────────────

interface Anchor {
  ctx: string;
  pGuess: number;
  prior: number;
  correct: boolean;
  evidence: number;
  posterior: number;
  work: string;
}

/**
 * One correct and one incorrect step from the P(L0) prior at every P(G) the
 * system uses. Easy and Medium have no incorrect case and Hard has no correct
 * case, because the rating IS the observation (p.72).
 *
 * Every P(G) here is a literal. Do not replace one with a lookup — see Rule 1.
 */
const ANCHORS: Anchor[] = [
  { ctx: 'multiple_choice  correct', pGuess: 0.25, prior: 0.1, correct: true, evidence: 0.2742, posterior: 0.4194,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.25)] = 0.085/0.3100 = 0.2742 ; 0.2742+(1-0.2742)(0.20) = 0.4194' },
  { ctx: 'multiple_choice  incorrect', pGuess: 0.25, prior: 0.1, correct: false, evidence: 0.0217, posterior: 0.2174,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.75)] = 0.015/0.6900 = 0.0217 ; 0.0217+(1-0.0217)(0.20) = 0.2174' },
  { ctx: 'true_or_false  correct', pGuess: 0.5, prior: 0.1, correct: true, evidence: 0.1589, posterior: 0.3271,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.50)] = 0.085/0.5350 = 0.1589 ; 0.1589+(1-0.1589)(0.20) = 0.3271' },
  { ctx: 'true_or_false  incorrect', pGuess: 0.5, prior: 0.1, correct: false, evidence: 0.0323, posterior: 0.2258,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.50)] = 0.015/0.4650 = 0.0323 ; 0.0323+(1-0.0323)(0.20) = 0.2258' },
  { ctx: 'identification  correct', pGuess: 0.05, prior: 0.1, correct: true, evidence: 0.6538, posterior: 0.7231,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.05)] = 0.085/0.1300 = 0.6538 ; 0.6538+(1-0.6538)(0.20) = 0.7231' },
  { ctx: 'identification  incorrect', pGuess: 0.05, prior: 0.1, correct: false, evidence: 0.0172, posterior: 0.2138,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.95)] = 0.015/0.8700 = 0.0172 ; 0.0172+(1-0.0172)(0.20) = 0.2138' },
  { ctx: 'fill_in_the_blank  correct', pGuess: 0.05, prior: 0.1, correct: true, evidence: 0.6538, posterior: 0.7231,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.05)] = 0.085/0.1300 = 0.6538 ; 0.6538+(1-0.6538)(0.20) = 0.7231' },
  { ctx: 'fill_in_the_blank  incorrect', pGuess: 0.05, prior: 0.1, correct: false, evidence: 0.0172, posterior: 0.2138,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.95)] = 0.015/0.8700 = 0.0172 ; 0.0172+(1-0.0172)(0.20) = 0.2138' },
  { ctx: 'matching_type  correct', pGuess: 0.17, prior: 0.1, correct: true, evidence: 0.3571, posterior: 0.4857,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.17)] = 0.085/0.2380 = 0.3571 ; 0.3571+(1-0.3571)(0.20) = 0.4857' },
  { ctx: 'matching_type  incorrect', pGuess: 0.17, prior: 0.1, correct: false, evidence: 0.0197, posterior: 0.2157,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.83)] = 0.015/0.7620 = 0.0197 ; 0.0197+(1-0.0197)(0.20) = 0.2157' },
  { ctx: 'flashcard Easy    (obs=1)', pGuess: 0.05, prior: 0.1, correct: true, evidence: 0.6538, posterior: 0.7231,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.05)] = 0.085/0.1300 = 0.6538 ; 0.6538+(1-0.6538)(0.20) = 0.7231' },
  { ctx: 'flashcard Medium  (obs=1)', pGuess: 0.25, prior: 0.1, correct: true, evidence: 0.2742, posterior: 0.4194,
    work: '0.10(0.85)/[0.10(0.85)+0.90(0.25)] = 0.085/0.3100 = 0.2742 ; 0.2742+(1-0.2742)(0.20) = 0.4194' },
  { ctx: 'flashcard Hard    (obs=0)', pGuess: 0.1, prior: 0.1, correct: false, evidence: 0.0182, posterior: 0.2145,
    work: '0.10(0.15)/[0.10(0.15)+0.90(0.90)] = 0.015/0.8250 = 0.0182 ; 0.0182+(1-0.0182)(0.20) = 0.2145' },
];

/**
 * The paper's own worked example, p.77 §1.2, transcribed verbatim.
 *
 * This is the single strongest case in the harness: the expected numbers are
 * PUBLISHED, not computed by anyone working on this codebase. Each step restates
 * its prior as the paper prints it (Rule 3), so the three are independent.
 */
const PAPER_WORKED_EXAMPLE: Anchor[] = [
  { ctx: 'paper p.77 attempt 1  correct', pGuess: 0.25, prior: 0.1, correct: true, evidence: 0.27, posterior: 0.42,
    work: 'paper: "P(L0|obs=1) = 0.27" then "P(L0+1) = 0.27 + (1-0.27)0.20 = 0.42"' },
  { ctx: 'paper p.77 attempt 2  correct', pGuess: 0.25, prior: 0.42, correct: true, evidence: 0.71, posterior: 0.77,
    work: 'paper: "P(L1|obs=1) = 0.71" then "P(L1+1) = 0.71 + (1-0.71)0.20 = 0.77"' },
  { ctx: 'paper p.77 attempt 3  incorrect', pGuess: 0.25, prior: 0.77, correct: false, evidence: 0.4, posterior: 0.52,
    work: 'paper: "P(L2|obs=0) = 0.40" then "P(L2+1) = 0.40 + (1-0.40)0.20 = 0.52"' },
];

function runAnchors(list: Anchor[]): void {
  for (const a of list) {
    const step = bktStep({ prior: a.prior, correct: a.correct, pGuess: a.pGuess, pSlip: S, pTransit: T });
    check(a.ctx, step.posterior, a.posterior, a.work);
    // The evidence phase is printed for inspection but scored too — both EQ(1)/(2)
    // and EQ(3) are stored in bkt_update_logs and the audit reads both.
    check(`${a.ctx}  [evidence phase]`, step.evidence, a.evidence);
  }
}

function sectionAnchors(): void {
  beginSection('§2', 'Hand-computed anchors', 'the published worked example, and hand arithmetic shown in full below each case');
  console.log('\n  The paper\'s own worked example (p.77) — expected values are PUBLISHED, not ours:\n');
  runAnchors(PAPER_WORKED_EXAMPLE);
  console.log('\n  One correct and one incorrect step from P(L0) at every P(G) the system uses:\n');
  runAnchors(ANCHORS);
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — The full matrix, cross-checked against the odds-ratio derivation
// ─────────────────────────────────────────────────────────────────────────────

/** The four response shapes the paper names on p.95. */
const PATTERNS: Record<string, boolean[]> = {
  'all correct     (CCC)': [true, true, true],
  'all incorrect   (III)': [false, false, false],
  'alternating    (CICI)': [true, false, true, false],
  'mixed          (CCIC)': [true, true, false, true],
};

const TEST_CONTEXTS: { label: string; pGuess: number }[] = [
  { label: 'multiple_choice  ', pGuess: 0.25 },
  { label: 'true_or_false    ', pGuess: 0.5 },
  { label: 'identification   ', pGuess: 0.05 },
  { label: 'fill_in_the_blank', pGuess: 0.05 },
  { label: 'matching_type    ', pGuess: 0.17 },
];

/** Easy and Medium are obs=1, Hard is obs=0 — so a rating sequence IS a response pattern. */
const RATING_SEQUENCES: { label: string; ratings: EaseRating[] }[] = [
  { label: 'easy, easy, easy      ', ratings: ['easy', 'easy', 'easy'] },
  { label: 'hard, hard, hard      ', ratings: ['hard', 'hard', 'hard'] },
  { label: 'easy, hard, easy, hard', ratings: ['easy', 'hard', 'easy', 'hard'] },
  { label: 'medium, easy, hard, md', ratings: ['medium', 'easy', 'hard', 'medium'] },
];

const RATING_GUESS: Record<EaseRating, number> = { easy: 0.05, medium: 0.25, hard: 0.1 };

function crossCheckSequence(label: string, prior: number, steps: { correct: boolean; pGuess: number }[]): void {
  let direct = prior;
  let odds = prior;
  const trail: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const { correct, pGuess } = steps[i];
    const d = bktStep({ prior: direct, correct, pGuess, pSlip: S, pTransit: T });
    const o = oddsFormStep(odds, correct, pGuess);

    // Compared far tighter than the paper's ±0.01: two exact derivations of the
    // same expression should agree to machine precision, and anything looser
    // would hide a real discrepancy inside the display tolerance.
    const delta = Math.abs(d.posterior - o.posterior);
    const pass = delta < 1e-12;
    record(pass);
    trail.push(`${f4(d.posterior)}${pass ? '' : ' **'}`);

    direct = d.posterior;
    odds = o.posterior;
  }

  console.log(`  ${pad(label, 54)} ${trail.join(' → ')}`);
}

function sectionMatrix(): void {
  beginSection(
    '§3',
    'Full response matrix, direct form vs odds-ratio form',
    'an independent algebraic derivation — odds(L|obs) = odds(L)·(1-P(S))/P(G), agreement required to 1e-12'
  );

  console.log('\n  Adaptive Test Mode — 5 question types x 4 response patterns:\n');
  for (const ctx of TEST_CONTEXTS) {
    for (const [pname, pattern] of Object.entries(PATTERNS)) {
      crossCheckSequence(
        `${ctx.label}  ${pname}`,
        0.1,
        pattern.map((correct) => ({ correct, pGuess: ctx.pGuess }))
      );
    }
  }

  console.log('\n  Adaptive Flashcards — rating sequences (Hard is an incorrect observation):\n');
  for (const seq of RATING_SEQUENCES) {
    crossCheckSequence(
      `flashcard  ${seq.label}`,
      0.1,
      seq.ratings.map((r) => ({ correct: OBSERVATION_BY_RATING[r] === 1, pGuess: RATING_GUESS[r] }))
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Sequence correctness: is the posterior really fed forward?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Section 2 restates each prior as a literal, so it cannot catch an engine that
 * computes every step perfectly and then forwards the wrong value. These cases
 * run the chain for real and check only the FINAL mastery, against a literal.
 *
 * The orchestrator's own grouping and chaining is verified end-to-end by --live.
 */
const CHAIN_CASES: { label: string; pGuess: number; pattern: boolean[]; final: number; trail: string }[] = [
  { label: 'multiple_choice    CCC', pGuess: 0.25, pattern: [true, true, true], final: 0.9349, trail: '0.4194 → 0.7685 → 0.9349' },
  { label: 'multiple_choice    III', pGuess: 0.25, pattern: [false, false, false], final: 0.248, trail: '0.2174 → 0.2421 → 0.2480' },
  { label: 'multiple_choice   CICI', pGuess: 0.25, pattern: [true, false, true, false], final: 0.435, trail: '0.4194 → 0.3010 → 0.6753 → 0.4350' },
  { label: 'multiple_choice   CCIC', pGuess: 0.25, pattern: [true, true, false, true], final: 0.8287, trail: '0.4194 → 0.7685 → 0.5192 → 0.8287  (first three are the paper\'s p.77 example)' },
  { label: 'true_or_false      CCC', pGuess: 0.5, pattern: [true, true, true], final: 0.7485, trail: '0.3271 → 0.5620 → 0.7485' },
  { label: 'true_or_false      III', pGuess: 0.5, pattern: [false, false, false], final: 0.2779, trail: '0.2258 → 0.2644 → 0.2779' },
  { label: 'true_or_false     CICI', pGuess: 0.5, pattern: [true, false, true, false], final: 0.4077, trail: '0.3271 → 0.3018 → 0.5389 → 0.4077' },
  { label: 'true_or_false     CCIC', pGuess: 0.5, pattern: [true, true, false, true], final: 0.6433, trail: '0.3271 → 0.5620 → 0.4223 → 0.6433' },
  { label: 'identification     CCC', pGuess: 0.05, pattern: [true, true, true], final: 0.9992, trail: '0.7231 → 0.9824 → 0.9992' },
  { label: 'identification     III', pGuess: 0.05, pattern: [false, false, false], final: 0.2366, trail: '0.2138 → 0.2329 → 0.2366' },
  { label: 'identification    CICI', pGuess: 0.05, pattern: [true, false, true, false], final: 0.7782, trail: '0.7231 → 0.4335 → 0.9429 → 0.7782' },
  { label: 'identification    CCIC', pGuess: 0.05, pattern: [true, true, false, true], final: 0.9958, trail: '0.7231 → 0.9824 → 0.9184 → 0.9958' },
  { label: 'fill_in_the_blank  CCC', pGuess: 0.05, pattern: [true, true, true], final: 0.9992, trail: '0.7231 → 0.9824 → 0.9992' },
  { label: 'fill_in_the_blank  III', pGuess: 0.05, pattern: [false, false, false], final: 0.2366, trail: '0.2138 → 0.2329 → 0.2366' },
  { label: 'fill_in_the_blank CICI', pGuess: 0.05, pattern: [true, false, true, false], final: 0.7782, trail: '0.7231 → 0.4335 → 0.9429 → 0.7782' },
  { label: 'fill_in_the_blank CCIC', pGuess: 0.05, pattern: [true, true, false, true], final: 0.9958, trail: '0.7231 → 0.9824 → 0.9184 → 0.9958' },
  { label: 'matching_type      CCC', pGuess: 0.17, pattern: [true, true, true], final: 0.9748, trail: '0.4857 → 0.8602 → 0.9748' },
  { label: 'matching_type      III', pGuess: 0.17, pattern: [false, false, false], final: 0.2427, trail: '0.2157 → 0.2379 → 0.2427' },
  { label: 'matching_type     CICI', pGuess: 0.17, pattern: [true, false, true, false], final: 0.49, trail: '0.4857 → 0.3166 → 0.7588 → 0.4900' },
  { label: 'matching_type     CCIC', pGuess: 0.17, pattern: [true, true, false, true], final: 0.913, trail: '0.4857 → 0.8602 → 0.6212 → 0.9130' },
  { label: 'flashcard Easy x3      ', pGuess: 0.05, pattern: [true, true, true], final: 0.9992, trail: '0.7231 → 0.9824 → 0.9992' },
  { label: 'flashcard Medium x3    ', pGuess: 0.25, pattern: [true, true, true], final: 0.9349, trail: '0.4194 → 0.7685 → 0.9349' },
  { label: 'flashcard Hard x3      ', pGuess: 0.1, pattern: [false, false, false], final: 0.2389, trail: '0.2145 → 0.2348 → 0.2389' },
];

function sectionChains(): void {
  beginSection('§4', 'Sequence correctness — posterior fed forward as the next prior', 'hand arithmetic on the final value; the per-step trail is printed for inspection');
  console.log('');
  for (const c of CHAIN_CASES) {
    let mastery = 0.1;
    for (const correct of c.pattern) {
      mastery = bktStep({ prior: mastery, correct, pGuess: c.pGuess, pSlip: S, pTransit: T }).posterior;
    }
    check(c.label, mastery, c.final, c.trail);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Analytic convergence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where an all-incorrect run must settle, solved on paper rather than computed.
 *
 * Setting L = e(L) + (1 - e(L))P(T) with e(L) = P(S)L / [P(S)L + (1-P(G))(1-L)]
 * and clearing denominators gives a quadratic in L. Its trivial root is 1; the
 * other is the limit. For multiple choice that quadratic is 4L^2 - 5L + 1 = 0,
 * root 0.25; for true/false it is 7L^2 - 9L + 2 = 0, root 2/7.
 *
 * This also pins finding A of the plan: every limit is ABOVE the 0.10 prior and
 * BELOW the 0.50 tier threshold, so failing everything raises mastery a little
 * and can never buy a harder test.
 */
const CONVERGENCE: { label: string; pGuess: number; limit: number; derivation: string }[] = [
  { label: 'multiple_choice   all incorrect', pGuess: 0.25, limit: 0.25, derivation: '4L² - 5L + 1 = 0  →  L* = 0.25 exactly' },
  { label: 'true_or_false     all incorrect', pGuess: 0.5, limit: 2 / 7, derivation: '7L² - 9L + 2 = 0  →  L* = 2/7 ≈ 0.285714' },
  { label: 'identification    all incorrect', pGuess: 0.05, limit: 0.2375, derivation: 'same reduction with P(G)=0.05  →  L* = 0.2375' },
  { label: 'matching_type     all incorrect', pGuess: 0.17, limit: 0.244118, derivation: 'same reduction with P(G)=0.17  →  L* ≈ 0.244118' },
];

function sectionConvergence(): void {
  beginSection('§5', 'Analytic convergence of an all-incorrect run', 'closed-form roots obtained with the quadratic formula on paper');
  console.log('');
  for (const c of CONVERGENCE) {
    let mastery = 0.1;
    for (let i = 0; i < 200; i++) {
      mastery = bktStep({ prior: mastery, correct: false, pGuess: c.pGuess, pSlip: S, pTransit: T }).posterior;
    }
    check(c.label, mastery, c.limit, c.derivation);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

function report(mode: string): number {
  const passed = sections.reduce((n, s) => n + s.passed, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const icr = total === 0 ? 0 : (passed / total) * 100;

  console.log(`\n${'═'.repeat(100)}`);
  console.log('SECTION TOTALS');
  console.log('═'.repeat(100));
  for (const s of sections) {
    const flag = s.passed === s.total ? '' : '   ** FAILURES **';
    console.log(`  ${s.id}  ${pad(s.title, 62)} ${String(s.passed).padStart(4)} / ${String(s.total).padEnd(4)}${flag}`);
  }
  console.log('─'.repeat(100));
  console.log(`  EQ(6)   ICR = ${passed} / ${total} × 100 = ${icr.toFixed(1)}%`);
  console.log(`          tolerance ±${TOLERANCE}  ·  mode: ${mode}  ·  ${new Date().toISOString()}`);
  console.log('═'.repeat(100));

  if (passed !== total) {
    console.log('\nFailed cases are marked ** FAIL ** above, with their expected value and deviation.');
  }
  return passed === total ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');

  console.log('═'.repeat(100));
  console.log('LearnSync AI — BKT Implementation Correctness Rate');
  console.log('Classical four-parameter BKT, implemented in the Express backend (paper p.68).');
  console.log('No pyBKT, no external library, no Expectation Maximization (p.70).');
  console.log('═'.repeat(100));

  const params = await loadBktParameters({ force: true });
  console.log(`\nParameters read from bkt_parameters:`);
  console.log(`  P(L0) ${params.pL0}   P(T) ${params.pT}   P(S) ${params.pS}`);
  console.log(
    `  P(G)  ` +
      Object.entries(params.guess)
        .map(([k, v]) => `${k.replace('g_', '')} ${v}`)
        .join('   ')
  );

  await sectionParameters();
  sectionAnchors();
  sectionMatrix();
  sectionChains();
  sectionConvergence();

  if (live) {
    const { runLiveVerification } = await import('./bkt-verify-live');
    await runLiveVerification({
      includeTest: argv.includes('--live-test'),
      keep: argv.includes('--keep'),
      beginSection,
      check,
      checkExact,
    });
  }

  process.exit(report(live ? 'offline + live application' : 'offline'));
}

main().catch((err) => {
  console.error('\nHarness crashed:', err);
  process.exit(1);
});
