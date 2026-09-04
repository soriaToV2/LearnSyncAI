/**
 * Fisher-Yates, over a copy.
 *
 * ══ WHY IT LIVES IN `src/lib/` ══
 * An identical private copy sat inside `TermMatchingGame.tsx` until the deck
 * grid needed one too. `src/lib/reviewSchedule.ts` states the rule this follows:
 * a tab exporting a utility up to its own parent is backwards, and two copies of
 * one rule drift. Same lift `surfaces.ts` and `reviewSchedule.ts` got.
 *
 * ══ NOT SEEDED, UNLIKE `seededShuffle` IN `server/lib/testGeneration.ts` ══
 * A generated test must be reproducible from its seed. A shuffled deck must be
 * the opposite: pressing Shuffle twice has to give two different orders, or the
 * button reads as broken. There is no client-side use for a seeded variant, and
 * adding one here would invite a caller to pick the wrong one.
 *
 * Uniform: `j` is drawn from `[0, i]` inclusive, which is what makes every
 * permutation equally likely. Drawing from `[0, length)` instead is the classic
 * off-by-one that biases the result -- do not "simplify" it to that.
 */
export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
