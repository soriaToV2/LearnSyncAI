/**
 * Where correct answers sit, for tests and games alike. Both used to store predictable positions:
 * trivia's model put the answer at A 69% of the time, and tests followed a fixed cycle (A,B,C,D…,
 * True,False…) in every one of 129 stored tests. A test is stored once at generation, so nothing
 * needs its placement reproducible; Math.random() is deliberate here.
 */

/**
 * Slot numbers 0..choices-1 as an even multiset, shuffled end-to-end (never one-of-each per group,
 * which would allow elimination). The random offset decides which slots get the surplus when `n`
 * does not divide evenly, so it isn't always the first ones.
 */
export function balancedSlots(n: number, choices: number): number[] {
  const offset = Math.floor(Math.random() * choices);
  const slots = Array.from({ length: n }, (_, i) => (i + offset) % choices);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** A Fisher–Yates shuffle of a copy. */
export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
