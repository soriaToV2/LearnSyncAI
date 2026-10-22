/**
 * Fisher-Yates over a copy. Unseeded on purpose (Shuffle must vary each time). `j` is drawn from
 * [0, i] inclusive; drawing from [0, length) would bias it.
 */
export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
