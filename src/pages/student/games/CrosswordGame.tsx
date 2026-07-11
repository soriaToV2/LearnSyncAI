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

export default function CrosswordGame() {
  const { data: targetData, resources, loading, error, regenerate, regenerating } = useGameContent();
  const cells = useMemo(() => targetData?.crossword ?? [], [targetData]);
  const crosswordClues = useMemo(() => targetData?.crosswordClues ?? [], [targetData]);

  // Grid extent adapts to the generated layout (no longer a fixed 5×5).
  const gridSize = useMemo(
    () => cells.reduce((max, cell) => Math.max(max, cell.r + 1, cell.c + 1), 1),
    [cells]
  );

  const { flash, fire } = useGameFlash();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [victory, setVictory] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [poppedKey, setPoppedKey] = useState<string | null>(null);
  const [active, setActive] = useState<Coord>({ r: 0, c: 0 });
  const [direction, setDirection] = useState<Direction>('across');

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const popTimer = useRef<number | null>(null);

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

  const filledCount = cells.filter((cell) => answers[keyOf(cell.r, cell.c)]).length;
  const isComplete =
    cells.length > 0 && cells.every((cell) => answers[keyOf(cell.r, cell.c)] === cell.correctLetter);

  useEffect(() => {
    if (isComplete && !victory) {
      fire('correct');
      setVictory(true);
    }
  }, [isComplete, victory, fire]);

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
    setHintsUsed((prev) => prev + 1);
    setChecked(false);
    setStatus(null);
    popCell(key);
  };

  const checkAnswers = () => {
    if (filledCount < cells.length) {
      setStatus('Fill every square before checking.');
      fire('wrong');
      return;
    }

    const wrong = cells.filter((cell) => answers[keyOf(cell.r, cell.c)] !== cell.correctLetter).length;
    setChecked(true);

    if (wrong > 0) {
      setStatus(`${wrong} letter${wrong === 1 ? '' : 's'} need${wrong === 1 ? 's' : ''} another look.`);
      fire('wrong');
    }
    // An all-correct grid is caught by the completion effect, which triggers victory.
  };

  if (loading || !targetData) {
    return (
      <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
        <GameStatusScreen tone="amber" state={error ? 'error' : 'loading'} />
      </div>
    );
  }

  if (victory) {
    return (
      <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
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
    <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <ScreenFlash flash={flash} />

      <GameStage
        tone="amber"
        icon={HelpCircle}
        title="Crossword"
        subtitle={targetData.courseName}
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/20 transition-all font-sans text-xs font-bold"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Assist
            </button>
            <button
              onClick={resetGame}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all font-sans text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-6">
          {/* Active clue bar — the focal point of the playfield */}
          <div className="w-full max-w-xl flex items-stretch gap-2">
            <button
              onClick={() => goToClue(activeClueIdx - 1)}
              aria-label="Previous clue"
              className="w-10 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] text-slate-500 flex items-center justify-center hover:text-white hover:bg-white/[0.05] transition-all active:scale-95"
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
              className="w-10 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] text-slate-500 flex items-center justify-center hover:text-white hover:bg-white/[0.05] transition-all active:scale-95"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Grid */}
          <div
            className="grid gap-1.5 p-3 rounded-2xl bg-black/20 border border-white/[0.06]"
            style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: gridSize }).map((_, r) => (
              <React.Fragment key={r}>
                {Array.from({ length: gridSize }).map((_, c) => {
                  const key = keyOf(r, c);
                  const cellData = cellMap.get(key);

                  if (!cellData) {
                    return <div key={key} className="w-12 h-12 md:w-14 md:h-14 rounded-lg bg-white/[0.015]" />;
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
                        'relative w-12 h-12 md:w-14 md:h-14 rounded-lg border flex items-center justify-center transition-colors duration-200',
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
                        <span className="absolute top-0.5 left-1 font-sans text-[8px] font-bold text-slate-500">
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
                          'font-display font-bold text-lg md:text-xl caret-amber-400',
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

          {/* Status / controls */}
          <div className="w-full max-w-xl space-y-4">
            {status && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 font-sans text-xs font-medium text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {status}
              </div>
            )}

            <button
              onClick={checkAnswers}
              className="w-full py-3 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-300 transition-all active:scale-[0.98]"
            >
              Check Answers
            </button>

            <p className="text-center font-sans text-[10px] text-slate-600">
              <kbd className="font-bold text-slate-500">Arrows</kbd> move ·{' '}
              <kbd className="font-bold text-slate-500">Space</kbd> flips direction ·{' '}
              <kbd className="font-bold text-slate-500">Tab</kbd> next clue
            </p>
          </div>

          {/* Full clue list */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 pt-2 border-t border-white/5">
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
                          className={clsx(
                            'w-full flex gap-2.5 items-start rounded-lg p-2 text-left transition-colors',
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
