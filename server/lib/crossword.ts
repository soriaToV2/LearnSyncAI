/**
 * Deterministic crossword layout builder.
 *
 * The LLM supplies candidate answer/clue pairs (see generateCrosswordWords in
 * lib/gameContent.ts) but never assigns coordinates — placing interlocking words on a
 * grid is a constraint-satisfaction problem that code solves reliably and models
 * do not. This module runs a backtracking-style greedy placement: the first word
 * anchors the grid, and each subsequent word is placed on the first valid
 * intersection with an already-placed word, respecting standard crossword
 * adjacency rules. Words that cannot be placed are skipped.
 *
 * Output matches the frontend contract:
 *   - crossword:      sparse list of filled cells { r, c, correctLetter, label? }
 *   - crosswordClues: { number, direction, clue }[]
 * Coordinates are normalized so the grid is anchored at (0,0).
 */

export type CrosswordDirection = 'across' | 'down';

export interface CrosswordInputWord {
  answer: string; // uppercase A–Z, already sanitized
  clue: string;
}

export interface CrosswordCell {
  r: number;
  c: number;
  correctLetter: string;
  label?: string;
}

export interface CrosswordClue {
  number: number;
  direction: CrosswordDirection;
  clue: string;
}

export interface CrosswordLayout {
  crossword: CrosswordCell[];
  crosswordClues: CrosswordClue[];
}

interface PlacedWord {
  answer: string;
  clue: string;
  r: number;
  c: number;
  direction: CrosswordDirection;
}

interface BuildOptions {
  /** Max grid extent in either dimension before a placement is rejected. */
  size?: number;
  /** Stop after this many words are placed. */
  maxWords?: number;
}

const keyOf = (r: number, c: number) => `${r}-${c}`;
const step = (dir: CrosswordDirection): [number, number] => (dir === 'across' ? [0, 1] : [1, 0]);
const opposite = (dir: CrosswordDirection): CrosswordDirection => (dir === 'across' ? 'down' : 'across');

/**
 * Checks whether `answer` can be placed at (r,c) going `direction` on the given
 * letter grid without violating crossword rules:
 *   - existing letters at overlapped cells must match,
 *   - the cell immediately before the start and after the end must be empty,
 *   - a NEW (non-overlapping) letter must not touch a parallel neighbour, which
 *     would create an unintended adjacent word.
 * Returns the number of overlaps (intersections) if valid, or -1 if invalid.
 */
function tryPlacement(
  answer: string,
  r: number,
  c: number,
  direction: CrosswordDirection,
  grid: Map<string, string>
): number {
  const [dr, dc] = step(direction);
  const [pdr, pdc] = step(opposite(direction));
  let overlaps = 0;

  // Cell just before the word and just after must be empty (word boundaries).
  if (grid.has(keyOf(r - dr, c - dc))) return -1;
  if (grid.has(keyOf(r + dr * answer.length, c + dc * answer.length))) return -1;

  for (let i = 0; i < answer.length; i++) {
    const cr = r + dr * i;
    const cc = c + dc * i;
    const existing = grid.get(keyOf(cr, cc));

    if (existing !== undefined) {
      if (existing !== answer[i]) return -1; // conflicting letter
      overlaps++;
      continue; // valid intersection — parallel neighbours are allowed here
    }

    // This is a fresh cell; it must not sit alongside a parallel word.
    if (grid.has(keyOf(cr + pdr, cc + pdc))) return -1;
    if (grid.has(keyOf(cr - pdr, cc - pdc))) return -1;
  }

  return overlaps;
}

function commit(word: PlacedWord, grid: Map<string, string>): void {
  const [dr, dc] = step(word.direction);
  for (let i = 0; i < word.answer.length; i++) {
    grid.set(keyOf(word.r + dr * i, word.c + dc * i), word.answer[i]);
  }
}

/**
 * Attempts to place `answer` by intersecting it with any already-placed word.
 * Returns the placement with the most overlaps, or null if none fits.
 */
/** Bounding box of every currently placed cell. */
function currentBounds(placed: PlacedWord[]): { minR: number; minC: number; maxR: number; maxC: number } {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -Infinity;
  let maxC = -Infinity;
  for (const w of placed) {
    const [dr, dc] = step(w.direction);
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.r + dr * i;
      const c = w.c + dc * i;
      minR = Math.min(minR, r);
      minC = Math.min(minC, c);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
  }
  return { minR, minC, maxR, maxC };
}

/**
 * Finds the best placement for `answer` intersecting an already-placed word.
 * Scored by: more intersections first (denser interlock), then the most COMPACT
 * result (smallest overall bounding box) so the grid stays tight instead of
 * sprawling into an awkward, mostly-empty layout.
 */
function findPlacement(answer: string, placed: PlacedWord[], grid: Map<string, string>, size: number): PlacedWord | null {
  const bounds = currentBounds(placed);
  let best:
    | { r: number; c: number; direction: CrosswordDirection; overlaps: number; area: number }
    | null = null;

  for (const word of placed) {
    const [wdr, wdc] = step(word.direction);
    const direction = opposite(word.direction);
    const [ndr, ndc] = step(direction);

    // For every letter of the placed word, look for a matching letter in `answer`.
    for (let wi = 0; wi < word.answer.length; wi++) {
      const cr = word.r + wdr * wi;
      const cc = word.c + wdc * wi;

      for (let ai = 0; ai < answer.length; ai++) {
        if (answer[ai] !== word.answer[wi]) continue;

        // Anchor `answer` so its ai-th letter lands on (cr,cc).
        const startR = cr - ndr * ai;
        const startC = cc - ndc * ai;

        const overlaps = tryPlacement(answer, startR, startC, direction, grid);
        if (overlaps < 1) continue; // must intersect at least once

        const endR = startR + ndr * (answer.length - 1);
        const endC = startC + ndc * (answer.length - 1);

        // Bounding box if this word were added.
        const nMinR = Math.min(bounds.minR, startR, endR);
        const nMinC = Math.min(bounds.minC, startC, endC);
        const nMaxR = Math.max(bounds.maxR, startR, endR);
        const nMaxC = Math.max(bounds.maxC, startC, endC);

        // Keep the whole grid within `size` in both dimensions so it stays
        // compact enough to render cleanly (not just each individual word).
        if (nMaxR - nMinR + 1 > size || nMaxC - nMinC + 1 > size) continue;

        const area = (nMaxR - nMinR + 1) * (nMaxC - nMinC + 1);

        // Prefer more overlaps; break ties toward the tighter grid.
        if (!best || overlaps > best.overlaps || (overlaps === best.overlaps && area < best.area)) {
          best = { r: startR, c: startC, direction, overlaps, area };
        }
      }
    }
  }

  if (!best) return null;
  return { answer, clue: '', r: best.r, c: best.c, direction: best.direction };
}

/**
 * Builds a crossword layout from candidate words. Deduplicates by answer, sorts
 * longest-first (long words interlock more easily), anchors the first word, then
 * greedily places the rest by best intersection.
 */
export function buildCrossword(words: CrosswordInputWord[], options: BuildOptions = {}): CrosswordLayout {
  // `size` caps the total grid in both dimensions (must exceed the longest
  // answer, currently ≤10 letters) so it renders cleanly.
  const size = options.size ?? 13;
  const maxWords = options.maxWords ?? 10;

  // Deduplicate by answer, keeping the first clue seen.
  const seen = new Set<string>();
  const candidates = words
    .filter((w) => {
      if (seen.has(w.answer)) return false;
      seen.add(w.answer);
      return true;
    })
    .sort((a, b) => b.answer.length - a.answer.length);

  if (candidates.length === 0) {
    return { crossword: [], crosswordClues: [] };
  }

  const grid = new Map<string, string>();
  const placed: PlacedWord[] = [];

  // Anchor the longest word horizontally at the origin.
  const first: PlacedWord = { ...candidates[0], r: 0, c: 0, direction: 'across' };
  commit(first, grid);
  placed.push(first);

  // Greedily place remaining candidates; retry skipped ones once more placements exist.
  const remaining = candidates.slice(1);
  let progress = true;
  while (progress && placed.length < maxWords) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      if (placed.length >= maxWords) break;
      const candidate = remaining[i];
      const placement = findPlacement(candidate.answer, placed, grid, size);
      if (placement) {
        placement.clue = candidate.clue;
        commit(placement, grid);
        placed.push(placement);
        remaining.splice(i, 1);
        i--;
        progress = true;
      }
    }
  }

  return finalizeLayout(placed);
}

/**
 * Normalizes coordinates to (0,0), assigns standard crossword numbering, and
 * emits the sparse cell list + clue list the frontend expects.
 */
function finalizeLayout(placed: PlacedWord[]): CrosswordLayout {
  if (placed.length === 0) return { crossword: [], crosswordClues: [] };

  // Shift so the top-left filled cell is at (0,0).
  let minR = Infinity;
  let minC = Infinity;
  for (const w of placed) {
    const [dr, dc] = step(w.direction);
    for (let i = 0; i < w.answer.length; i++) {
      minR = Math.min(minR, w.r + dr * i);
      minC = Math.min(minC, w.c + dc * i);
    }
  }

  const letters = new Map<string, string>();
  const normalized = placed.map((w) => ({ ...w, r: w.r - minR, c: w.c - minC }));
  for (const w of normalized) {
    const [dr, dc] = step(w.direction);
    for (let i = 0; i < w.answer.length; i++) {
      letters.set(keyOf(w.r + dr * i, w.c + dc * i), w.answer[i]);
    }
  }

  // Number the starting cells in reading order (top-left → bottom-right).
  const starts = new Map<string, number>();
  const starterCells = [...new Set(normalized.map((w) => keyOf(w.r, w.c)))].sort((a, b) => {
    const [ar, ac] = a.split('-').map(Number);
    const [br, bc] = b.split('-').map(Number);
    return ar - br || ac - bc;
  });
  starterCells.forEach((cellKey, idx) => starts.set(cellKey, idx + 1));

  const crossword: CrosswordCell[] = [...letters.entries()]
    .map(([cellKey, correctLetter]) => {
      const [r, c] = cellKey.split('-').map(Number);
      const label = starts.has(cellKey) ? String(starts.get(cellKey)) : undefined;
      return { r, c, correctLetter, ...(label ? { label } : {}) };
    })
    .sort((a, b) => a.r - b.r || a.c - b.c);

  const crosswordClues: CrosswordClue[] = normalized
    .map((w) => ({
      number: starts.get(keyOf(w.r, w.c))!,
      direction: w.direction,
      clue: `${w.clue} (${w.answer.length} letters)`,
    }))
    .sort((a, b) => a.number - b.number || (a.direction === b.direction ? 0 : a.direction === 'across' ? -1 : 1));

  return { crossword, crosswordClues };
}
