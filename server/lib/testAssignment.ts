/**
 * Which question format each concept gets in a new test. Pure: no database, no network.
 *
 * Concepts used to be dealt to sections in lesson order, so the same concept met the same format
 * in every test of a lesson (2,015 of 2,015 repeat observations on production). Formats carry
 * different guess rates, so one correct answer took a concept from P(L0) to 72% as identification
 * but only 33% as true/false: mastery reflected where a concept sat in the lesson, not what the
 * student knew. Each concept now gets the format it has met least often, never mastery-driven
 * (weakest-first would hand the weakest concepts the highest P(G)).
 */
import type { AllocationItem, QuestionFormat } from './testAllocation';
import type { ConceptForTest } from './testGeneration';
import { shuffled } from './answerPlacement';

/** One concept's past tests for this student, from practice_telemetry. */
export interface FormatHistory {
  counts: Map<QuestionFormat, number>;
  /** The format of its most recent test, or null. */
  last: QuestionFormat | null;
}

/** Breaks a tie between equally-seen formats against the one it had last time. */
const LAST_PENALTY = 0.5;
/** Swap passes are cheap (n is a lesson's concept count); this only bounds a pathological loop. */
const MAX_SWAP_PASSES = 50;

function cost(history: FormatHistory | undefined, format: QuestionFormat): number {
  if (!history) return 0;
  return (history.counts.get(format) ?? 0) + (history.last === format ? LAST_PENALTY : 0);
}

function timesTested(history: FormatHistory | undefined): number {
  if (!history) return 0;
  let total = 0;
  for (const n of history.counts.values()) total += n;
  return total;
}

/**
 * Fills each format with exactly its allocated count. Least-seen format first, the last one
 * avoided, ties random; then pairwise swaps while any swap lowers the total cost. Each section
 * comes back in lesson order, so related topics stay together.
 */
export function assignFormats(params: {
  /** Lesson order. */
  concepts: ConceptForTest[];
  allocation: AllocationItem[];
  history: Map<string, FormatHistory>;
}): Map<QuestionFormat, ConceptForTest[]> {
  const { concepts, allocation, history } = params;
  const slices = new Map<QuestionFormat, ConceptForTest[]>(allocation.map(a => [a.format, []]));
  const covered = allocation.reduce((sum, a) => sum + a.count, 0);
  if (covered === 0) return slices;

  // Fewer slots than concepts only happens on a matching-only test. The best-measured concepts sit
  // out, so omission rotates too; stable sort keeps the shuffle among ties.
  let pool = concepts;
  if (covered < concepts.length) {
    const ranked = shuffled(concepts).sort((a, b) => timesTested(history.get(b.id)) - timesTested(history.get(a.id)));
    const out = new Set(ranked.slice(0, concepts.length - covered).map(c => c.id));
    pool = concepts.filter(c => !out.has(c.id));
  }

  // Greedy over every (concept, format) pair, cheapest first, ties in random order. Total room
  // equals the pool size and room only shrinks, so every concept is placed.
  const room = new Map(allocation.map(a => [a.format, a.count]));
  const placed = new Map<string, QuestionFormat>();
  const pairs = shuffled(
    pool.flatMap(c => allocation.map(a => ({ c, format: a.format, cost: cost(history.get(c.id), a.format) })))
  ).sort((x, y) => x.cost - y.cost);

  for (const { c, format } of pairs) {
    if (placed.has(c.id) || (room.get(format) ?? 0) === 0) continue;
    placed.set(c.id, format);
    room.set(format, room.get(format)! - 1);
  }

  // Greedy can strand a concept in its own last format; a swap with a concept of another format
  // fixes it without changing any section's count.
  for (let pass = 0, improved = true; improved && pass < MAX_SWAP_PASSES; pass++) {
    improved = false;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i];
        const b = pool[j];
        const fa = placed.get(a.id)!;
        const fb = placed.get(b.id)!;
        if (fa === fb) continue;
        const ha = history.get(a.id);
        const hb = history.get(b.id);
        if (cost(ha, fb) + cost(hb, fa) < cost(ha, fa) + cost(hb, fb) - 1e-9) {
          placed.set(a.id, fb);
          placed.set(b.id, fa);
          improved = true;
        }
      }
    }
  }

  for (const c of concepts) {
    const format = placed.get(c.id);
    if (format) slices.get(format)!.push(c);
  }
  return slices;
}
