import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  Lightbulb,
} from 'lucide-react';
import clsx from 'clsx';
import {
  GameStage,
  GameStatusScreen,
  HudStat,
  ResultScreen,
  ScreenFlash,
  useGameContent,
  useGameFlash,
} from './gameUi';
import { useGameAudio } from './gameAudio';

type Direction = 'across' | 'down';
interface Coord {
  r: number;
  c: number;
}
interface Word {
  key: string;
  dir: Direction;
  cells: Coord[];
}
interface Clue {
  word: Word;
  dir: Direction;
  num: number;
  text: string;
}

const keyOf = (r: number, c: number) => `${r}-${c}`;
const sameCoord = (a: Coord, b: Coord) => a.r === b.r && a.c === b.c;

/**
 * How many pixels of the layout viewport are currently covered at the bottom —
 * in practice, the on-screen keyboard.
 *
 * ⚠️ THIS EXISTS BECAUSE `position: fixed; bottom: 0` IS NOT ENOUGH ON iOS.
 * iOS Safari does not shrink the LAYOUT viewport when the keyboard opens, so a
 * bottom-fixed element stays pinned to the bottom of the page and ends up
 * *behind* the keyboard — which for the solving bar means the clue disappears at
 * exactly the moment the student starts typing the answer to it.
 *
 * `window.visualViewport` reports the part of the page actually visible.
 * `innerHeight - (vv.height + vv.offsetTop)` is therefore the occluded strip,
 * and offsetting the bar by it lifts it to sit directly on top of the keyboard.
 *
 * The same expression is correct on Android/Chrome, where the keyboard shrinks
 * the visual viewport too, and it degrades to 0 on any desktop browser — so
 * there is no platform sniffing and no branch to get wrong. `visualViewport` is
 * absent on very old browsers; there the hook stays at 0 and the bar behaves
 * exactly as it did before.
 *
 * Listens to `scroll` as well as `resize`: iOS shifts `offsetTop` when the
 * keyboard pushes the page, and that moves the strip without changing its size.
 */
/**
 * Breathing room between the last thing on the page and the top of the pinned
 * solving bar. Purely visual — without it the AI Assist / Reset row scrolls to
 * sit flush against the bar's border.
 */
const BAR_GAP_PX = 16;

/**
 * How much space the page must reserve below itself so that nothing ends up
 * permanently trapped behind the pinned solving bar.
 *
 * ⚠️ THIS IS MEASURED, NOT A CONSTANT, AND A CONSTANT IS WHAT WAS BROKEN.
 * It was a static `pb-24` (96px), chosen against a bar showing a short clue.
 * But the bar's height is the CLUE'S height, and a clue is a free-form sentence
 * from the model — three lines of `text-sm` puts the bar at ~124px, so the last
 * ~28px of the page (which is `GameStage`'s footer, i.e. the AI Assist and Reset
 * buttons) sat under the bar with no scroll left to lift it clear. The buttons
 * were visible, half-covered and unclickable.
 *
 * Measuring the element removes the guess entirely: any clue length, the
 * iPhone home indicator (`env(safe-area-inset-bottom)`, which is inside
 * `offsetHeight`) and any future control added to the bar are all accounted for.
 *
 * ⚠️ IT READS THE COMPUTED `position` RATHER THAN A BREAKPOINT. From `sm:` up
 * the bar is `static` and already occupies its own space in flow, so reserving
 * more would be the dead-space bug over again. Asking the browser where the
 * element actually is keeps the `sm:` boundary defined in exactly one place —
 * the className — instead of duplicating `640` into JS where it can drift.
 */
function useBarClearance(el: HTMLElement | null): number {
  const [clearance, setClearance] = useState(0);

  useEffect(() => {
    if (!el) {
      setClearance(0);
      return;
    }

    const update = () => {
      const lifted = window.getComputedStyle(el).position === 'fixed';
      setClearance(lifted ? el.offsetHeight + BAR_GAP_PX : 0);
    };

    update();
    // Catches a clue changing length; the width change when the viewport
    // crosses `sm:` fires it too, which is when `position` flips.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [el]);

  return clearance;
}

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      // Round to whole pixels: iOS reports fractional heights mid-animation and
      // an unrounded value re-renders on every frame of the keyboard transition.
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}

export default function CrosswordGame() {
  const { data: targetData, resources, loading, error, calibration, regenerate, regenerating, recordSession } =
    useGameContent();
  const cells = useMemo(() => targetData?.crossword ?? [], [targetData]);
  const crosswordClues = useMemo(() => targetData?.crosswordClues ?? [], [targetData]);

  // Grid extent adapts to the generated layout (no longer a fixed 5×5).
  const gridSize = useMemo(
    () => cells.reduce((max, cell) => Math.max(max, cell.r + 1, cell.c + 1), 1),
    [cells]
  );

  const { flash, fire } = useGameFlash();
  const { play } = useGameAudio();
  const keyboardInset = useKeyboardInset();
  /* A state-backed ref, not `useRef`: the bar does not exist on the loading or
     victory branches, so the measuring effect has to re-run when it mounts.
     A `useRef` would still hold null from the first render and never observe. */
  const [solvingBar, setSolvingBar] = useState<HTMLDivElement | null>(null);
  const barClearance = useBarClearance(solvingBar);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [victory, setVictory] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [poppedKey, setPoppedKey] = useState<string | null>(null);
  const [active, setActive] = useState<Coord>({ r: 0, c: 0 });
  const [direction, setDirection] = useState<Direction>('across');
  /* Mobile only — the full Across/Down list is ~12 rows and pushed the grid and
     the Check button off a phone screen. Always open from `sm:` up. */
  const [showAllClues, setShowAllClues] = useState(false);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const popTimer = useRef<number | null>(null);
  const startedAt = useRef(Date.now());
  const recorded = useRef(false);
  // Cell keys the student revealed via AI Assist, for the post-game review.
  const hintedCells = useRef<Set<string>>(new Set());

  const cellMap = useMemo(() => {
    const map = new Map<string, (typeof cells)[number]>();
    cells.forEach((cell) => map.set(keyOf(cell.r, cell.c), cell));
    return map;
  }, [cells]);

  /** Walks to the start of a word, then collects every cell along its direction. */
  const collectWord = useCallback(
    (r: number, c: number, dir: Direction): Coord[] => {
      const [dr, dc] = dir === 'across' ? [0, 1] : [1, 0];
      let sr = r;
      let sc = c;
      while (cellMap.has(keyOf(sr - dr, sc - dc))) {
        sr -= dr;
        sc -= dc;
      }
      const word: Coord[] = [];
      while (cellMap.has(keyOf(sr, sc))) {
        word.push({ r: sr, c: sc });
        sr += dr;
        sc += dc;
      }
      return word;
    },
    [cellMap]
  );

  const words = useMemo(() => {
    const seen = new Set<string>();
    const found: Word[] = [];
    cells.forEach((cell) => {
      (['across', 'down'] as Direction[]).forEach((dir) => {
        const word = collectWord(cell.r, cell.c, dir);
        if (word.length < 2) return;
        const key = `${dir}-${keyOf(word[0].r, word[0].c)}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ key, dir, cells: word });
      });
    });
    return found;
  }, [cells, collectWord]);

  const acrossWords = useMemo(
    () => words.filter((w) => w.dir === 'across').sort((a, b) => a.cells[0].r - b.cells[0].r),
    [words]
  );

  const clues = useMemo(() => {
    const entries: Clue[] = [];

    // Each derived word starts at a numbered cell; match it to its clue by
    // (number, direction) so the layout can be any shape, not the fixed template.
    words.forEach((word) => {
      const start = word.cells[0];
      const label = cellMap.get(keyOf(start.r, start.c))?.label;
      if (!label) return;
      const num = Number(label);
      const match = crosswordClues.find(
        (clue) => clue.number === num && clue.direction === word.dir
      );
      if (match) entries.push({ word, dir: word.dir, num, text: match.clue });
    });

    return entries.sort((a, b) => a.num - b.num || (a.dir === b.dir ? 0 : a.dir === 'across' ? -1 : 1));
  }, [words, cellMap, crosswordClues]);

  /** The word the cursor sits in; falls back to the perpendicular word for single-cell runs. */
  const activeWord = useMemo(() => {
    const primary = collectWord(active.r, active.c, direction);
    if (primary.length > 1) return primary;
    return collectWord(active.r, active.c, direction === 'across' ? 'down' : 'across');
  }, [active, direction, collectWord]);

  const activeKeys = useMemo(() => new Set(activeWord.map((cell) => keyOf(cell.r, cell.c))), [activeWord]);

  const activeClueIdx = useMemo(
    () =>
      clues.findIndex(
        (clue) => clue.dir === direction && activeWord.length > 0 && sameCoord(clue.word.cells[0], activeWord[0])
      ),
    [clues, direction, activeWord]
  );
  const activeClue = clues[activeClueIdx];

  const resetGame = useCallback(() => {
    setAnswers({});
    setChecked(false);
    setStatus(null);
    setVictory(false);
    setHintsUsed(0);
    setPoppedKey(null);
    setDirection('across');
    setActive(acrossWords[0]?.cells[0] ?? { r: 0, c: 0 });
    startedAt.current = Date.now();
    recorded.current = false;
    hintedCells.current = new Set();
  }, [acrossWords]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  useEffect(
    () => () => {
      if (popTimer.current) window.clearTimeout(popTimer.current);
    },
    []
  );

  /*
   * ── SIZING IS DERIVED FROM THE COLUMN COUNT, NOT FROM THE VIEWPORT ──
   *
   * The grid always fits the screen (no horizontal scroll), so a cell's real
   * width is `available / gridSize` — which a `sm:`/`md:` breakpoint cannot see.
   * `buildCrossword()` caps the layout at 13 columns, and at 13 a phone gives
   * ~23px per cell, so the gap, the letter and the clue number all have to come
   * down with it. A media query would size a 5-column grid and a 13-column grid
   * identically, which is exactly the case that breaks.
   *
   * 23px at 13 columns is the same cell size the NYT app ships a 15×15 grid at
   * on a phone, so this is the standard trade rather than a compromise: the
   * whole puzzle stays visible, which is most of what a crossword is.
   */
  const dense = gridSize >= 11;
  const cellGap = dense ? 'gap-0.5 sm:gap-1' : 'gap-1 sm:gap-1.5';
  const cellText =
    gridSize <= 7
      ? 'text-lg md:text-xl'
      : gridSize <= 10
        ? 'text-base md:text-lg'
        : 'text-xs sm:text-sm md:text-base';
  /* The clue number is functional — it maps a square to the clue list — so it is
     never dropped. At 11+ columns it takes 9px because the cell is ~23px and
     there is genuinely no room for more; that is the cost of showing the whole
     grid, chosen deliberately over clipping columns away. */
  const labelText = dense ? 'text-[9px]' : 'text-[10px]';
  /* Caps cell growth at the old desktop 3.5rem so a 5-column puzzle does not
     stretch into giant squares on a wide screen. `1.5rem` is the `sm:p-3`
     padding, `0.375rem` the `sm:gap-1.5`. */
  const gridMaxWidth = `calc(${gridSize} * 3.5rem + ${Math.max(0, gridSize - 1)} * 0.375rem + 1.5rem)`;

  const filledCount = cells.filter((cell) => answers[keyOf(cell.r, cell.c)]).length;
  const isComplete =
    cells.length > 0 && cells.every((cell) => answers[keyOf(cell.r, cell.c)] === cell.correctLetter);

  useEffect(() => {
    if (isComplete && !victory) {
      fire('correct');
      play('victory');
      setVictory(true);
    }
  }, [isComplete, victory, fire, play]);

  // Log the solved grid once. Accuracy = squares solved unaided (fewer hints →
  // higher). The review lists each word's answer and how many letters were
  // revealed via AI Assist.
  useEffect(() => {
    if (!victory || recorded.current || cells.length === 0) return;
    recorded.current = true;
    const unaided = Math.max(0, cells.length - hintsUsed) / cells.length;
    const items = clues.map((clue) => ({
      number: clue.num,
      direction: clue.dir,
      clue: clue.text,
      answer: clue.word.cells
        .map((cell) => cellMap.get(keyOf(cell.r, cell.c))?.correctLetter ?? '')
        .join(''),
      hintedLetters: clue.word.cells.filter((cell) => hintedCells.current.has(keyOf(cell.r, cell.c))).length,
    }));
    recordSession({
      accuracy: unaided,
      timeMs: Date.now() - startedAt.current,
      detail: { type: 'crossword', items },
    });
  }, [victory, cells.length, hintsUsed, clues, cellMap, recordSession]);

  const focusCell = (coord: Coord) => {
    setActive(coord);
    inputRefs.current[keyOf(coord.r, coord.c)]?.focus();
  };

  const popCell = (key: string) => {
    setPoppedKey(key);
    if (popTimer.current) window.clearTimeout(popTimer.current);
    popTimer.current = window.setTimeout(() => setPoppedKey(null), 200);
  };

  /** Moves the cursor to the next existing cell in a direction, skipping blocked squares. */
  const step = (from: Coord, dr: number, dc: number): Coord | null => {
    let { r, c } = from;
    for (let i = 0; i < gridSize; i++) {
      r += dr;
      c += dc;
      if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return null;
      if (cellMap.has(keyOf(r, c))) return { r, c };
    }
    return null;
  };

  const advanceWithinWord = (from: Coord, offset: 1 | -1) => {
    const idx = activeWord.findIndex((cell) => sameCoord(cell, from));
    const next = activeWord[idx + offset];
    if (next) focusCell(next);
  };

  const goToClue = (idx: number) => {
    const clue = clues[(idx + clues.length) % clues.length];
    if (!clue) return;
    setDirection(clue.dir);
    focusCell(clue.word.cells[0]);
  };

  const handleInput = (r: number, c: number, raw: string) => {
    const letter = raw.slice(-1).toUpperCase();
    if (letter && !/^[A-Z]$/.test(letter)) return;

    const key = keyOf(r, c);
    setAnswers((prev) => ({ ...prev, [key]: letter }));
    setChecked(false);
    setStatus(null);

    if (letter) {
      popCell(key);
      play('click');
      advanceWithinWord({ r, c }, 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number, Direction]> = {
      ArrowRight: [0, 1, 'across'],
      ArrowLeft: [0, -1, 'across'],
      ArrowDown: [1, 0, 'down'],
      ArrowUp: [-1, 0, 'down'],
    };

    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc, dir] = moves[e.key];
      setDirection(dir);
      const next = step({ r, c }, dr, dc);
      if (next) focusCell(next);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      setDirection((prev) => (prev === 'across' ? 'down' : 'across'));
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      goToClue(activeClueIdx + (e.shiftKey ? -1 : 1));
      return;
    }

    if (e.key === 'Backspace') {
      const key = keyOf(r, c);
      if (!answers[key]) {
        e.preventDefault();
        advanceWithinWord({ r, c }, -1);
      } else {
        setAnswers((prev) => ({ ...prev, [key]: '' }));
        setChecked(false);
        setStatus(null);
      }
    }
  };

  const handleCellClick = (r: number, c: number) => {
    if (sameCoord(active, { r, c })) {
      setDirection((prev) => (prev === 'across' ? 'down' : 'across'));
    }
    focusCell({ r, c });
  };

  const useHint = () => {
    // Prefer filling a gap in the word the student is currently working on.
    const candidates = [...activeWord, ...cells.map((cell) => ({ r: cell.r, c: cell.c }))];
    const target = candidates.find((coord) => {
      const cell = cellMap.get(keyOf(coord.r, coord.c))!;
      return answers[keyOf(coord.r, coord.c)] !== cell.correctLetter;
    });
    if (!target) return;

    const key = keyOf(target.r, target.c);
    const cell = cellMap.get(key)!;
    setAnswers((prev) => ({ ...prev, [key]: cell.correctLetter }));
    hintedCells.current.add(key);
    setHintsUsed((prev) => prev + 1);
    setChecked(false);
    setStatus(null);
    popCell(key);
    play('hint');
  };

  const checkAnswers = () => {
    if (filledCount < cells.length) {
      setStatus('Fill every square before checking.');
      fire('wrong');
      play('wrong');
      return;
    }

    const wrong = cells.filter((cell) => answers[keyOf(cell.r, cell.c)] !== cell.correctLetter).length;
    setChecked(true);

    if (wrong > 0) {
      setStatus(`${wrong} letter${wrong === 1 ? '' : 's'} need${wrong === 1 ? 's' : ''} another look.`);
      fire('wrong');
      play('wrong');
    }
    // An all-correct grid is caught by the completion effect, which triggers victory.
  };

  if (loading || !targetData) {
    return (
      <div className="max-w-4xl mx-auto fade-in duration-300">
        <GameStatusScreen tone="amber" state={error ? 'error' : 'loading'} />
      </div>
    );
  }

  if (victory) {
    return (
      <div className="max-w-4xl mx-auto fade-in duration-300">
        <ScreenFlash flash={flash} />
        <ResultScreen
          tone="amber"
          icon={CheckCircle2}
          title="Crossword Solved!"
          message="Every square filled, every clue cracked. Clean sweep."
          headline={`${cells.length}`}
          headlineLabel="squares solved"
          stats={[
            { label: 'Words', value: `${words.length}` },
            { label: 'Hints Used', value: `${hintsUsed}` },
          ]}
          onReplay={resetGame}
          onRegenerate={regenerate}
          regenerating={regenerating}
        />
      </div>
    );
  }

  return (
    /* ⚠️ THE CLEARANCE FOR THE FIXED SOLVING BAR BELONGS HERE, BELOW THE WHOLE
       CARD — NOT INSIDE THE PLAYFIELD. It was `pb-28` on the playfield column,
       which inserted 112px of dead space *inside* the stage, between the clue
       toggle and the materials footer, while still leaving the footer itself
       sitting under the bar. On the outer wrapper it does the one job it is for:
       lets the page scroll far enough that nothing is permanently hidden behind
       the bar.

       It is an inline style rather than a `pb-*` class because the value is the
       bar's MEASURED height — see `useBarClearance()` for why a constant could
       not work here. It is 0 from `sm:` up, where the bar is back in flow. */
    <div
      style={{ paddingBottom: barClearance }}
      className="max-w-4xl mx-auto fade-in duration-300"
    >
      <ScreenFlash flash={flash} />

      <GameStage
        tone="amber"
        icon={HelpCircle}
        title="Crossword"
        subtitle={targetData.courseName}
        tier={calibration?.tier ?? null}
        resources={resources}
        hud={
          <>
            <HudStat
              icon={Grid3x3}
              label="Filled"
              value={`${filledCount}/${cells.length}`}
              pulseKey={filledCount}
            />
            <HudStat icon={Lightbulb} label="Hints" value={hintsUsed} pulseKey={hintsUsed} />
          </>
        }
        actions={
          <>
            <button
              onClick={useHint}
              /* Amber-soft, not cyan. Cyan belonged to no game even before Timed
                 Trivia became violet — it was an orphan accent inside the amber
                 game. Soft-vs-solid now carries the hierarchy: "Check Answers"
                 is solid amber (primary), this is soft amber (optional, and it
                 costs accuracy), Reset is neutral. It also matches the amber the
                 hint badge already uses in the post-game review. */
              /* ⚠️ `hidden sm:flex` — THERE IS A SECOND HINT BUTTON BESIDE
                 "CHECK ANSWERS" FOR MOBILE, AND EXACTLY ONE OF THE TWO IS EVER
                 VISIBLE. `GameStage` puts `actions` in its footer, which on a
                 phone is below the grid, the Check button and the clue toggle —
                 a long scroll away from the square you are stuck on. `display:
                 none` also removes an element from the tab order, so this costs
                 no duplicate keyboard stop. */
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-400 hover:bg-amber-400/20 transition-all font-sans text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Assist
            </button>
            <button
              onClick={resetGame}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all font-sans text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-6">
          {/*
            ── THE SOLVING BAR ──
            On mobile this is PINNED TO THE VIEWPORT BOTTOM, where a thumb is and
            where the on-screen keyboard pushes content. Above the grid it scrolls
            away the moment you reach the squares you are filling, so you end up
            typing into a puzzle whose clue you can no longer read.

            `fixed`, not `sticky`: `GameStage`'s section is `overflow-hidden`,
            which makes it a scrollport that never scrolls, so a sticky child
            would be inert. A fixed child is not clipped by ancestor overflow —
            only by a transformed/filtered ancestor, and there is none here
            (`animate-page-fade` and `fade-in` are opacity-only, and
            `` emits no CSS in this build).

            `bottom` is driven by `useKeyboardInset()` so the bar rides ON TOP of
            the on-screen keyboard instead of behind it — see that hook for why
            `bottom-0` alone is wrong on iOS. The inline style is safe at every
            width: from `sm:` up the element is `position: static`, which ignores
            `bottom` outright.

            From `sm:` up it returns to normal flow at the top of the playfield.
          */}
          <div
            ref={setSolvingBar}
            style={{ bottom: keyboardInset }}
            className={clsx(
              'flex items-stretch gap-2',
              'fixed inset-x-0 z-30 px-3 pt-3 bg-surface-container-lowest/95 backdrop-blur border-t border-white/10',
              // Clears the iPhone home indicator when the keyboard is closed; it
              // collapses to the plain 0.75rem everywhere else.
              'pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
              'sm:static sm:z-auto sm:w-full sm:max-w-xl sm:p-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0'
            )}
          >
            <button
              onClick={() => goToClue(activeClueIdx - 1)}
              aria-label="Previous clue"
              className="w-10 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] text-slate-500 flex items-center justify-center hover:text-white hover:bg-white/[0.05] transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-center">
              <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400/80">
                {activeClue ? `${activeClue.num} ${activeClue.dir}` : 'Select a square'}
              </p>
              <p className="font-sans text-sm text-white mt-1.5 leading-snug">
                {activeClue?.text ?? 'Pick any square in the grid to see its clue.'}
              </p>
            </div>

            <button
              onClick={() => goToClue(activeClueIdx + 1)}
              aria-label="Next clue"
              className="w-10 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] text-slate-500 flex items-center justify-center hover:text-white hover:bg-white/[0.05] transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/*
            ⚠️ THE GRID ALWAYS FITS THE SCREEN. IT MUST NEVER SCROLL SIDEWAYS.

            `buildCrossword()` caps the layout at `size = 13` (server/lib/
            crossword.ts) and answers run to 10 letters, so `gridSize` genuinely
            reaches 13. With the original fixed `w-12` + `gap-1.5` that is
            13×48 + 12×6 + 24 = 696px of grid inside the ~287px a 375px phone
            has — and `GameStage`'s section is `overflow-hidden`, so the
            right-hand columns were CLIPPED AND UNREACHABLE rather than merely
            cramped. Anything past ~5 columns was unplayable on a phone.

            Horizontal scroll was the first fix and was the wrong one: a
            crossword is a grid of INTERSECTIONS, so a view that shows six
            columns at a time removes the only thing that makes it solvable.
            Fluid cells (`w-full aspect-square` in `1fr` tracks) keep the whole
            puzzle on screen at every column count; the sizing constants above
            shrink the gap, the letter and the clue number to pay for it.
          */}
          {/* FULL-BLEED ON MOBILE. `-mx-4` cancels the playfield's own `px-4`,
              which is 32px — nearly a whole extra column at 13 wide. It stops at
              `sm:` where the width is no longer the binding constraint. */}
          <div className="w-full -mx-4 sm:mx-0 px-0 flex justify-center">
            <div
              className={clsx(
                'grid w-full p-2 sm:p-3 rounded-none sm:rounded-2xl bg-black/20 border-y sm:border border-white/[0.06]',
                cellGap
              )}
              style={{
                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                maxWidth: gridMaxWidth,
              }}
            >
            {Array.from({ length: gridSize }).map((_, r) => (
              <React.Fragment key={r}>
                {Array.from({ length: gridSize }).map((_, c) => {
                  const key = keyOf(r, c);
                  const cellData = cellMap.get(key);

                  if (!cellData) {
                    return (
                      /* `aspect-square` + `w-full`: the cell fills whatever the
                         1fr column resolves to, so it shrinks with the grid
                         instead of forcing an overflow. */
                      <div key={key} className="w-full aspect-square rounded bg-white/[0.015]" />
                    );
                  }

                  const value = answers[key] || '';
                  const isActiveCell = sameCoord(active, { r, c });
                  const inActiveWord = activeKeys.has(key);
                  const isWrong = checked && value !== cellData.correctLetter;
                  const isRight = checked && value === cellData.correctLetter;

                  return (
                    <div
                      key={key}
                      onClick={() => handleCellClick(r, c)}
                      className={clsx(
                        'relative w-full aspect-square rounded sm:rounded-lg border flex items-center justify-center transition-colors duration-200',
                        isWrong && 'animate-shake',
                        isRight
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : isWrong
                            ? 'bg-rose-500/10 border-rose-500/60'
                            : isActiveCell
                              ? 'bg-amber-400/20 border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]'
                              : inActiveWord
                                ? 'bg-amber-400/[0.06] border-amber-400/30'
                                : 'bg-white/[0.03] border-white/[0.08]'
                      )}
                    >
                      {cellData.label && (
                        /* The clue number is functional — it is how a square is
                           matched to the clue list — so it does not stay at 8px,
                           the smallest type in the app. */
                        <span
                          className={clsx(
                            'absolute top-0 left-0.5 sm:top-0.5 sm:left-1 font-sans leading-none font-bold text-slate-400 pointer-events-none',
                            labelText
                          )}
                        >
                          {cellData.label}
                        </span>
                      )}
                      <input
                        ref={(el) => {
                          inputRefs.current[key] = el;
                        }}
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        maxLength={1}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                        value={value}
                        onChange={(e) => handleInput(r, c, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, r, c)}
                        onFocus={() => setActive({ r, c })}
                        className={clsx(
                          'w-full h-full text-center bg-transparent outline-none uppercase',
                          'font-display font-bold caret-amber-400',
                          cellText,
                          poppedKey === key && 'animate-cell-pop',
                          isWrong ? 'text-rose-300' : isRight ? 'text-emerald-300' : 'text-white'
                        )}
                      />
                    </div>
                  );
                })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Status / controls */}
          <div className="w-full max-w-xl space-y-4">
            {status && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 font-sans text-xs font-medium text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {status}
              </div>
            )}

            {/* Soft-vs-solid carries the hierarchy exactly as it does in the
                footer: Check Answers is the primary and keeps the solid fill,
                the hint is optional and costs accuracy, so it stays soft. */}
            <div className="flex items-stretch gap-2">
              <button
                onClick={checkAnswers}
                /* `ring-on-surface` — the button's fill is the accent, so an accent
                   ring would be the same colour twice. */
                className="flex-1 py-3 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-300 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
              >
                Check Answers
              </button>

              {/* The mobile half of the pair described on the footer's AI Assist
                  button. Directly under the grid, which is where a stuck solver
                  is looking — and in normal flow, so it does not crowd the
                  pinned solving bar or make it taller. */}
              <button
                onClick={useHint}
                className="sm:hidden shrink-0 flex items-center gap-1.5 px-4 rounded-xl bg-amber-400/10 border border-amber-400/25 text-amber-400 font-sans text-sm font-bold hover:bg-amber-400/20 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
              >
                <Sparkles className="w-4 h-4" /> Hint
              </button>
            </div>

            {/* `hidden sm:block`: these shortcuts need a physical keyboard, and on
                a phone the line is three pieces of advice nobody can act on —
                the same treatment `FlashcardStudyView` gives its key hints. */}
            <p className="hidden sm:block text-center font-sans text-[11px] text-slate-500">
              <kbd className="font-bold text-slate-400">Arrows</kbd> move ·{' '}
              <kbd className="font-bold text-slate-400">Space</kbd> flips direction ·{' '}
              <kbd className="font-bold text-slate-400">Tab</kbd> next clue
            </p>
          </div>

          {/* Full clue list — collapsed on mobile.
              Twelve-odd rows of Across/Down pushed the grid and the Check button
              off a phone screen, and the solving bar already surfaces the clue
              that matters. Always open from `sm:` up, where there is room. */}
          <button
            type="button"
            onClick={() => setShowAllClues((prev) => !prev)}
            aria-expanded={showAllClues}
            className="sm:hidden w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] font-sans text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
          >
            {showAllClues ? 'Hide' : 'Show'} all clues ({clues.length})
            <ChevronRight
              className={clsx('w-3.5 h-3.5 transition-transform', showAllClues && 'rotate-90')}
            />
          </button>

          <div
            className={clsx(
              'w-full grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 pt-2 border-t border-white/5',
              showAllClues ? 'grid' : 'hidden sm:grid'
            )}
          >
            {(['across', 'down'] as Direction[]).map((dir) => (
              <div key={dir} className="pt-4">
                <h3 className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                  {dir}
                </h3>
                <div className="space-y-1">
                  {clues
                    .filter((clue) => clue.dir === dir)
                    .map((clue) => {
                      const isActiveClue = activeClue?.word.key === clue.word.key;
                      return (
                        <button
                          key={clue.word.key}
                          onClick={() => {
                            setDirection(dir);
                            focusCell(clue.word.cells[0]);
                          }}
                          aria-current={isActiveClue ? 'true' : undefined}
                          className={clsx(
                            'w-full flex gap-2.5 items-start rounded-lg p-2 text-left transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
                            isActiveClue ? 'bg-amber-400/[0.08]' : 'hover:bg-white/[0.03]'
                          )}
                        >
                          <span
                            className={clsx(
                              'w-5 h-5 shrink-0 rounded-md flex items-center justify-center font-display text-[10px] font-bold transition-colors',
                              isActiveClue ? 'bg-amber-400 text-black' : 'bg-white/[0.05] text-slate-500'
                            )}
                          >
                            {clue.num}
                          </span>
                          <p
                            className={clsx(
                              'font-sans text-xs leading-relaxed',
                              isActiveClue ? 'text-white' : 'text-slate-500'
                            )}
                          >
                            {clue.text}
                          </p>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GameStage>
    </div>
  );
}
