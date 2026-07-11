import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Hourglass, CheckCircle2, XCircle, Flame, Target, Zap } from 'lucide-react';
import clsx from 'clsx';
import { Question } from './gamesData';
import {
  GameStage,
  GameStatusScreen,
  HudStat,
  ResultScreen,
  ScreenFlash,
  TimerRing,
  useGameContent,
  useGameFlash,
} from './gameUi';

const QUESTION_COUNT = 10;
const QUESTION_MS = 15_000;
const TICK_MS = 100;
const TIMEOUT_SENTINEL = '__timeout__';
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

type EndReason = 'complete' | 'wrong' | 'timeout';

const END_COPY: Record<EndReason, { title: string; message: string }> = {
  complete: {
    title: 'Perfect Run!',
    message: 'You cleared every question without a single miss. Flawless recall.',
  },
  wrong: {
    title: 'Run Ended',
    message: 'That answer broke the streak. Review the material and go again.',
  },
  timeout: {
    title: "Time's Up!",
    message: 'The clock ran out on that one. Speed comes with familiarity — try again.',
  },
};

const DIFFICULTY_STYLES: Record<Question['difficulty'], string> = {
  easy: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
  medium: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
  hard: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
};

export default function TimedTriviaGame() {
  const { data: targetData, resources, loading, error, regenerate, regenerating } = useGameContent();

  const { flash, fire } = useGameFlash();

  const [queue, setQueue] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(QUESTION_MS);
  const [finished, setFinished] = useState(false);
  const [endReason, setEndReason] = useState<EndReason>('complete');

  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay));
  }, []);

  const startGame = useCallback(() => {
    clearTimers();
    setCurrentIdx(0);
    setSelected(null);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setTimeLeftMs(QUESTION_MS);
    setFinished(false);
    setEndReason('complete');

    const pool = targetData?.trivia ?? [];
    if (pool.length === 0) {
      setQueue([]);
      return;
    }
    setQueue(Array.from({ length: QUESTION_COUNT }, (_, i) => pool[i % pool.length]));
  }, [targetData, clearTimers]);

  useEffect(() => {
    startGame();
    return clearTimers;
  }, [startGame, clearTimers]);

  const current = queue[currentIdx];
  const answered = selected !== null;
  const timedOut = selected === TIMEOUT_SENTINEL;

  const endGame = useCallback((reason: EndReason) => {
    setEndReason(reason);
    setFinished(true);
  }, []);

  // Countdown ticks in milliseconds so the ring sweeps smoothly.
  useEffect(() => {
    if (finished || answered || queue.length === 0) return;

    const interval = window.setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev <= TICK_MS) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - TICK_MS;
      });
    }, TICK_MS);

    return () => window.clearInterval(interval);
  }, [finished, answered, currentIdx, queue.length]);

  useEffect(() => {
    if (timeLeftMs > 0 || finished || answered || queue.length === 0) return;

    setSelected(TIMEOUT_SENTINEL);
    setStreak(0);
    fire('wrong');
    schedule(() => endGame('timeout'), 1400);
  }, [timeLeftMs, finished, answered, queue.length, fire, schedule, endGame]);

  const handleAnswer = useCallback(
    (option: string) => {
      if (selected !== null || !current) return;

      setSelected(option);

      if (option !== current.correct) {
        setStreak(0);
        fire('wrong');
        schedule(() => endGame('wrong'), 1400);
        return;
      }

      setScore((prev) => prev + 1);
      setStreak((prev) => {
        const next = prev + 1;
        setBestStreak((best) => Math.max(best, next));
        return next;
      });
      fire('correct');

      schedule(() => {
        if (currentIdx < queue.length - 1) {
          setCurrentIdx((prev) => prev + 1);
          setSelected(null);
          setTimeLeftMs(QUESTION_MS);
        } else {
          endGame('complete');
        }
      }, 900);
    },
    [selected, current, currentIdx, queue.length, fire, schedule, endGame]
  );

  // Answer with A–D or 1–4 without reaching for the mouse.
  useEffect(() => {
    if (finished || answered || !current) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      const byLetter = OPTION_KEYS.indexOf(key);
      const byNumber = Number(key) - 1;
      const idx = byLetter >= 0 ? byLetter : byNumber;

      if (Number.isInteger(idx) && idx >= 0 && idx < current.options.length) {
        e.preventDefault();
        handleAnswer(current.options[idx]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, answered, current, handleAnswer]);

  const secondsLeft = Math.ceil(timeLeftMs / 1000);
  const isUrgent = timeLeftMs <= 5000 && !answered;
  const answeredWrong = answered && !timedOut && selected !== current?.correct;

  if (loading || !targetData) {
    return (
      <div className="max-w-3xl mx-auto animate-in fade-in duration-300">
        <GameStatusScreen tone="cyan" state={error ? 'error' : 'loading'} />
      </div>
    );
  }

  if (finished) {
    return (
      <div className="max-w-3xl mx-auto animate-in fade-in duration-300">
        <ScreenFlash flash={flash} />
        <ResultScreen
          tone="cyan"
          icon={Trophy}
          title={END_COPY[endReason].title}
          message={END_COPY[endReason].message}
          headline={`${score}`}
          headlineLabel={`of ${queue.length} correct`}
          stats={[
            { label: 'Best Streak', value: `${bestStreak}` },
            { label: 'Accuracy', value: `${queue.length ? Math.round((score / queue.length) * 100) : 0}%` },
          ]}
          onReplay={startGame}
          onRegenerate={regenerate}
          regenerating={regenerating}
          celebrate={endReason === 'complete'}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <ScreenFlash flash={flash} />

      <GameStage
        tone="cyan"
        icon={Hourglass}
        title="Timed Trivia"
        subtitle={targetData.courseName}
        resources={resources}
        hud={
          <>
            <HudStat icon={Target} label="Score" value={score} pulseKey={score} />
            <HudStat
              icon={Flame}
              label="Streak"
              value={streak}
              pulseKey={streak}
              highlight={streak >= 3}
            />
          </>
        }
        actions={
          <span className="font-sans text-[10px] text-slate-600 hidden sm:block">
            Press <kbd className="text-slate-400 font-bold">A–D</kbd> or{' '}
            <kbd className="text-slate-400 font-bold">1–4</kbd> to answer
          </span>
        }
      >
        {current && (
          <div className={clsx('space-y-8', (answeredWrong || timedOut) && 'animate-shake')}>
            {/* Question header: ring + prompt */}
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <TimerRing
                progress={timeLeftMs / QUESTION_MS}
                seconds={secondsLeft}
                urgent={isUrgent}
              />

              <div className="flex-1 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {currentIdx + 1} / {queue.length}
                  </span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-widest',
                      DIFFICULTY_STYLES[current.difficulty]
                    )}
                  >
                    {current.difficulty}
                  </span>
                </div>

                <h2 className="font-display text-xl md:text-2xl font-bold text-white leading-snug">
                  {current.question}
                </h2>
              </div>
            </div>

            {/* Answer pad */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {current.options.map((option, i) => {
                const isCorrect = option === current.correct;
                const isSelected = selected === option;
                const dimmed = answered && !isCorrect && !isSelected;

                return (
                  <button
                    key={option}
                    onClick={() => handleAnswer(option)}
                    disabled={answered}
                    className={clsx(
                      'group relative flex items-center gap-3 rounded-2xl border p-4 text-left',
                      'font-sans text-sm font-medium transition-all duration-300 outline-none select-none',
                      answered
                        ? isCorrect
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300 animate-pop'
                          : isSelected
                            ? 'bg-rose-500/10 border-rose-500 text-rose-300'
                            : 'border-white/5 text-slate-600'
                        : 'bg-white/[0.02] border-white/[0.08] text-slate-300 hover:bg-white/[0.05] hover:border-cyan-400/40 active:scale-[0.98]',
                      dimmed && 'opacity-50'
                    )}
                  >
                    <span
                      className={clsx(
                        'w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center',
                        'font-display text-xs font-bold transition-colors',
                        answered
                          ? isCorrect
                            ? 'bg-emerald-500 border-emerald-500 text-black'
                            : isSelected
                              ? 'bg-rose-500 border-rose-500 text-white'
                              : 'border-white/5 text-slate-600'
                          : 'bg-white/[0.03] border-white/10 text-slate-500 group-hover:border-cyan-400/50 group-hover:text-cyan-400'
                      )}
                    >
                      {OPTION_KEYS[i]}
                    </span>

                    <span className="flex-1 leading-snug">{option}</span>

                    {answered && isCorrect && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    {answered && isSelected && !isCorrect && (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Run status */}
            <div className="flex items-center justify-center gap-2 font-sans text-[11px] text-slate-600">
              {timedOut ? (
                <span className="font-bold uppercase tracking-widest text-rose-400">
                  Out of time — the answer is highlighted above
                </span>
              ) : answeredWrong ? (
                <span className="font-bold uppercase tracking-widest text-rose-400">
                  Incorrect — run over
                </span>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  <span>Sudden death — one wrong answer ends the run</span>
                </>
              )}
            </div>
          </div>
        )}
      </GameStage>
    </div>
  );
}
