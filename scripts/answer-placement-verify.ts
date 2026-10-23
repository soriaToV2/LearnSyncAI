/**
 * Verifies that correct answers land in balanced, unpredictable positions (server/lib/answerPlacement.ts).
 * Run: `npx tsx scripts/answer-placement-verify.ts`
 *
 * Every one of 129 stored tests ran A,B,C,D,A… on multiple choice and True,False,True… on
 * true/false, because hash(index) % 4 equalled index % 4 and the verdicts alternated by design.
 * This drives the real helpers testGeneration.ts and gameContent.ts call, 10,000 times each.
 *
 * No network, no database, no model.
 */
import { balancedSlots, shuffled } from '../server/lib/answerPlacement';

const TRIALS = 10_000;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`         ${detail}`);
}

const counts = (slots: number[], choices: number) =>
  Array.from({ length: choices }, (_, s) => slots.filter(x => x === s).length);

const factorial = (k: number): number => (k <= 1 ? 1 : k * factorial(k - 1));

/**
 * Chance that balancedSlots() returns one specific layout: the share of offsets producing its
 * slot counts, over the number of orderings of those counts. Any single layout is this likely,
 * the old cycle included (1 in 252 for ten true/false), so that is the bar it must not exceed.
 */
function layoutProbability(layout: number[], choices: number): number {
  const target = counts(layout, choices).join();
  let offsets = 0;
  for (let o = 0; o < choices; o++) {
    const c = counts(layout.map((_, i) => (i + o) % choices), choices);
    if (c.join() === target) offsets++;
  }
  const orderings = factorial(layout.length) / counts(layout, choices).reduce((p, k) => p * factorial(k), 1);
  return offsets / choices / orderings;
}

/** Balance, no fixed cycle, and no tie between a question's number and its slot. */
function verify(label: string, n: number, choices: number, oldPattern: number[]): void {
  console.log(`\n${label} (${n} questions, ${choices} positions)`);
  const minAllowed = Math.floor(n / choices);
  const maxAllowed = Math.ceil(n / choices);

  let unbalanced = 0;
  let oldCycle = 0;
  const perIndex = Array.from({ length: n }, () => new Array(choices).fill(0));

  for (let t = 0; t < TRIALS; t++) {
    const slots = balancedSlots(n, choices);
    const c = counts(slots, choices);
    if (Math.min(...c) < minAllowed || Math.max(...c) > maxAllowed) unbalanced++;
    if (slots.every((s, i) => s === oldPattern[i])) oldCycle++;
    slots.forEach((s, i) => perIndex[i][s]++);
  }

  check(
    `every position is used ${minAllowed}–${maxAllowed} times in every test`,
    unbalanced === 0,
    `${unbalanced} of ${TRIALS} layouts out of balance`
  );
  // Binomial upper bound: the old cycle may appear only as often as any other single layout.
  const mean = layoutProbability(oldPattern, choices) * TRIALS;
  const ceiling = mean + 4 * Math.sqrt(mean) + 1;
  check(
    'the old fixed cycle is no more likely than any other layout',
    oldCycle <= ceiling,
    `${oldCycle} of ${TRIALS} layouts matched it · expected about ${mean.toFixed(1)} by chance (it was every test before)`
  );

  const expected = 1 / choices;
  let worst = 0;
  for (const row of perIndex) {
    for (const hits of row) worst = Math.max(worst, Math.abs(hits / TRIALS - expected));
  }
  check(
    `a question's number does not predict its position (each about ${(expected * 100).toFixed(0)}%)`,
    worst <= 0.02,
    `largest deviation ${(worst * 100).toFixed(2)} percentage points (allowed 2.00)`
  );
}

// Multiple choice: the old placement was index % 4.
verify('Multiple choice', 10, 4, Array.from({ length: 10 }, (_, i) => i % 4));
// True/false: slot 0 = True; the old verdicts were True on even positions.
verify('True or false', 10, 2, Array.from({ length: 10 }, (_, i) => i % 2));
verify('True or false, odd count', 9, 2, Array.from({ length: 9 }, (_, i) => i % 2));
// Trivia games use the same helper at 10 questions × 4 options (covered by the first block).

console.log('\nMatching (6 options shuffled per block)');
const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
const seen = pool.map(() => new Set<number>());
let lost = 0;
for (let t = 0; t < TRIALS; t++) {
  const options = shuffled(pool);
  if ([...options].sort().join() !== pool.join()) lost++;
  options.forEach((o, slot) => seen[pool.indexOf(o)].add(slot));
}
check('every shuffle keeps all six options', lost === 0, `${lost} of ${TRIALS} shuffles changed the set`);
check(
  'every option reaches every slot',
  seen.every(s => s.size === pool.length),
  seen.map((s, i) => `${pool[i]}:${s.size}`).join(' ')
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
