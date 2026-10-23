/**
 * Verifies that concepts rotate across question formats from test to test (server/lib/testAssignment.ts).
 * Run: `npx tsx scripts/test-assignment-verify.ts`
 *
 * Concepts used to be dealt to sections in lesson order, so a concept met the same format, and the
 * same P(G), in every test of a lesson (2,015 of 2,015 repeat observations on production). This
 * simulates one student taking tests back to back on a 46-concept lesson with all five formats,
 * feeding each test's assignment back as history exactly as practice_telemetry would.
 *
 * No network, no database, no model.
 */
import { allocateConcepts, ALL_FORMATS, type QuestionFormat } from '../server/lib/testAllocation';
import { assignFormats, type FormatHistory } from '../server/lib/testAssignment';
import type { ConceptForTest } from '../server/lib/testGeneration';

const LESSON_SIZE = 46;
const TESTS = 5;
const RUNS = 200;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`         ${detail}`);
}

const concepts: ConceptForTest[] = Array.from({ length: LESSON_SIZE }, (_, i) => ({
  id: `c${String(i).padStart(2, '0')}`,
  term: `term ${i}`,
  definition: `definition ${i}`,
}));
const lessonIndex = new Map(concepts.map((c, i) => [c.id, i]));

function record(history: Map<string, FormatHistory>, slices: Map<QuestionFormat, ConceptForTest[]>): void {
  for (const [format, list] of slices) {
    for (const c of list) {
      const entry = history.get(c.id) ?? { counts: new Map<QuestionFormat, number>(), last: null };
      entry.counts.set(format, (entry.counts.get(format) ?? 0) + 1);
      entry.last = format;
      history.set(c.id, entry);
    }
  }
}

function formatOf(slices: Map<QuestionFormat, ConceptForTest[]>): Map<string, QuestionFormat> {
  const out = new Map<string, QuestionFormat>();
  for (const [format, list] of slices) for (const c of list) out.set(c.id, format);
  return out;
}

const allocation = allocateConcepts(LESSON_SIZE, ALL_FORMATS).items;
console.log(`Allocation for ${LESSON_SIZE} concepts: ${allocation.map(a => `${a.format} ${a.count}`).join(' · ')}`);
console.log(`${RUNS} simulated students × ${TESTS} tests each\n`);

let badShape = 0;
let outOfOrder = 0;
let repeatsTest2 = 0;
let repeatsLater = 0;
let minDistinct = Infinity;
const distinctHistogram = new Map<number, number>();

for (let run = 0; run < RUNS; run++) {
  const history = new Map<string, FormatHistory>();
  let previous: Map<string, QuestionFormat> | null = null;

  for (let t = 1; t <= TESTS; t++) {
    const slices = assignFormats({ concepts, allocation, history });

    // Shape: every concept exactly once, every section at its allocated count.
    const placed = [...slices.values()].flat();
    const sizesOk = allocation.every(a => (slices.get(a.format) ?? []).length === a.count);
    if (!sizesOk || placed.length !== LESSON_SIZE || new Set(placed.map(c => c.id)).size !== LESSON_SIZE) badShape++;

    // Each section keeps lesson order.
    for (const list of slices.values()) {
      for (let i = 1; i < list.length; i++) {
        if (lessonIndex.get(list[i].id)! < lessonIndex.get(list[i - 1].id)!) outOfOrder++;
      }
    }

    const now = formatOf(slices);
    if (previous) {
      const repeats = [...now].filter(([id, f]) => previous!.get(id) === f).length;
      if (t === 2) repeatsTest2 += repeats;
      else repeatsLater += repeats;
    }
    previous = now;
    record(history, slices);
  }

  for (const c of concepts) {
    const distinct = history.get(c.id)?.counts.size ?? 0;
    minDistinct = Math.min(minDistinct, distinct);
    distinctHistogram.set(distinct, (distinctHistogram.get(distinct) ?? 0) + 1);
  }
}

check('every test uses each concept once and fills each section exactly', badShape === 0, `${badShape} of ${RUNS * TESTS} tests malformed`);
check('each section stays in lesson order', outOfOrder === 0, `${outOfOrder} out-of-order pairs`);
check(
  'test 2: no concept repeats its test-1 format (the reported bug)',
  repeatsTest2 === 0,
  `${repeatsTest2} repeats across ${RUNS} students (was ${LESSON_SIZE} per student before the fix)`
);
check('tests 3–5: no concept repeats the format it had just before', repeatsLater === 0, `${repeatsLater} repeats`);
check(
  `after ${TESTS} tests every concept has met at least 4 of the 5 formats`,
  minDistinct >= 4,
  `formats met per concept: ${[...distinctHistogram].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} → ${v}`).join(', ')}`
);

// A first test has no history: it must not fall back to lesson order, and must vary between students.
const first = formatOf(assignFormats({ concepts, allocation, history: new Map() }));
const second = formatOf(assignFormats({ concepts, allocation, history: new Map() }));
let lessonOrderCursor = 0;
const lessonOrder = new Map<string, QuestionFormat>();
for (const a of allocation) for (let i = 0; i < a.count; i++) lessonOrder.set(concepts[lessonOrderCursor++].id, a.format);
const sameAsLessonOrder = [...first].filter(([id, f]) => lessonOrder.get(id) === f).length;
const sameAsOther = [...first].filter(([id, f]) => second.get(id) === f).length;
check(
  'a first test is not dealt in lesson order and differs between students',
  sameAsLessonOrder < LESSON_SIZE && sameAsOther < LESSON_SIZE,
  `${sameAsLessonOrder}/${LESSON_SIZE} match lesson-order dealing · ${sameAsOther}/${LESSON_SIZE} match another first test (≈${Math.round(LESSON_SIZE / 5)} by chance)`
);

// Matching only: fewer slots than concepts, and the best-measured concepts sit out.
const matchingOnly = allocateConcepts(LESSON_SIZE, ['matching_type']).items;
const heavy = new Map<string, FormatHistory>();
for (const id of ['c07', 'c31']) heavy.set(id, { counts: new Map([['multiple_choice', 4]]), last: 'multiple_choice' });
const matchSlices = assignFormats({ concepts, allocation: matchingOnly, history: heavy });
const included = new Set([...matchSlices.values()].flat().map(c => c.id));
const left = concepts.filter(c => !included.has(c.id)).map(c => c.id);
check(
  'matching-only test leaves out the most-tested concepts',
  left.length === LESSON_SIZE - matchingOnly[0].count && left.every(id => heavy.has(id)),
  `${matchingOnly[0].count} slots · left out: ${left.join(', ')} (expected c07, c31)`
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
