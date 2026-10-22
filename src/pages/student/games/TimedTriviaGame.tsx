import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Trophy, Hourglass, CheckCircle2, XCircle, Flame, Target, Zap } from 'lucide-react';
import clsx from 'clsx';
import { Question } from './gamesData';
import {
  GameStage,
  GameStatusScreen,
  HudStat,
  ResultScreen,
  ScreenFlash,
  SessionDetail,
  TimerRing,
  useGameContent,
  useGameFlash,
} from './gameUi';
import { useGameAudio } from './gameAudio';

type TriviaReviewItem = Extract<SessionDetail, { type: 'trivia' }>['items'][number];

const QUESTION_COUNT = 10;
const TICK_MS = 100;
const TIMEOUT_SENTINEL = '__timeout__';
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

/** Fallback for mock mode and pre-calibration rows; the authority is TRIVIA_QUESTION_MS on the server (paper p. 83). */
const DEFAULT_QUESTION_MS = 15_000;

/** Guards against a corrupt stored value. */
function clampQuestionMs(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_QUESTION_MS;
  return Math.min(Math.max(ms, 5_000), 60_000);
}

// The run always plays to the end.
function summaryFor(score: number, total: number): { title: string; message: string } {
  const pct = total > 0 ? score / total : 0;
  if (total > 0 && score === total) {
    return { title: 'Perfect Run!', message: 'You cleared every question without a single miss. Flawless recall.' };
  }
  if (pct >= 0.7) {
    return { title: 'Strong Run!', message: 'Great recall — most answers landed. Review the misses and push for a clean sweep.' };
  }
  if (pct >= 0.4) {
    return { title: 'Good Effort!', message: 'A solid showing with room to grow. Another pass will sharpen the shaky spots.' };
  }
  return { title: 'Run Complete', message: 'Every question is practice. Revisit the material and go again — it climbs fast.' };
}

export default function TimedTriviaGame() {
  const {
    data: targetData,
    resources,
    loading,
    error,
    calibration,
    regenerate,
    regenerating,
    recordSession,
  } = useGameContent();

  const { flash, fire } = useGameFlash();
  const { play } = useGameAudio();

  // The trivia timer is a calibration lever (paper p. 83), supplied by the server.
  const questionMs = useMemo(() => clampQuestionMs(calibration?.questionMs), [calibration]);

  const [queue, setQueue] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(questionMs);
  const [finished, setFinished] = useState(false);

  const timers = useRef<number[]>([]);
  const startedAt = useRef(Date.now());
  const recorded = useRef(false);
  // Per-question log for the review.
  const answerLog = useRef<TriviaReviewItem[]>([]);

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
    setTimeLeftMs(questionMs);
    setFinished(false);
    startedAt.current = Date.now();
    recorded.current = false;
    answerLog.current = [];

    const pool = targetData?.trivia ?? [];
    if (pool.length === 0) {
      setQueue([]);
      return;
    }
    setQueue(Array.from({ length: QUESTION_COUNT }, (_, i) => pool[i % pool.length]));
  }, [targetData, clearTimers, questionMs]);

  useEffect(() => {
    startGame();
    return clearTimers;
  }, [startGame, clearTimers]);

  const current = queue[currentIdx];
  const answered = selected !== null;
  const timedOut = selected === TIMEOUT_SENTINEL;

  // Next question, or end the run after the last. A miss just breaks the streak.
  const goNext = useCallback(() => {
    if (currentIdx < queue.length - 1) {
      setCurrentIdx((prev) => prev + 1);
      setSelected(null);
      setTimeLeftMs(questionMs);
    } else {
      setFinished(true);
    }
  }, [currentIdx, queue.length, questionMs]);

  // Millisecond ticks so the ring sweeps smoothly.
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
    play('wrong');
    if (current) {
      answerLog.current.push({
        question: current.question,
        options: current.options,
        correct: current.correct,
        selected: null,
        outcome: 'timeout',
      });
    }
    schedule(goNext, 1400);
  }, [timeLeftMs, finished, answered, queue.length, current, fire, play, schedule, goNext]);

  const handleAnswer = useCallback(
    (option: string) => {
      if (selected !== null || !current) return;

      setSelected(option);
      answerLog.current.push({
        question: current.question,
        options: current.options,
        correct: current.correct,
        selected: option,
        outcome: option === current.correct ? 'correct' : 'wrong',
      });

      if (option !== current.correct) {
        setStreak(0);
        fire('wrong');
        play('wrong');
        schedule(goNext, 1400);
        return;
      }

      setScore((prev) => prev + 1);
      setStreak((prev) => {
        const next = prev + 1;
        setBestStreak((best) => Math.max(best, next));
        return next;
      });
      fire('correct');
      play('correct', streak); // pitch climbs with the streak

      schedule(goNext, 900);
    },
    [selected, current, streak, fire, play, schedule, goNext]
  );

  // Answer with A–D or 1–4.
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
  // Urgent at a third of the clock, not a fixed 5s (which would be half of the advanced 10s clock).
  const isUrgent = timeLeftMs <= questionMs / 3 && !answered;
  const answeredWrong = answered && !timedOut && selected !== current?.correct;

  // Tick each second of a live countdown.
  useEffect(() => {
    if (finished || answered || queue.length === 0) return;
    if (secondsLeft > 0) play('tick');
  }, [secondsLeft, finished, answered, queue.length, play]);

  // Victory sting on a flawless run.
  useEffect(() => {
    if (finished && queue.length > 0 && score === queue.length) play('victory');
  }, [finished, score, queue.length, play]);

  // Log the run once. Accuracy = correct / total.
  useEffect(() => {
    if (!finished || recorded.current || queue.length === 0) return;
    recorded.current = true;
    recordSession({
      accuracy: score / queue.length,
      timeMs: Date.now() - startedAt.current,
      detail: { type: 'trivia', items: answerLog.current },
    });
  }, [finished, score, queue.length, recordSession]);

  if (loading || !targetData) {
    return (
      <div className="max-w-3xl mx-auto fade-in duration-300">
        <GameStatusScreen tone="violet" state={error ? 'error' : 'loading'} />
      </div>
    );
  }

  if (finished) {
    const summary = summaryFor(score, queue.length);
    const perfect = queue.length > 0 && score === queue.length;
    return (
      <div className="max-w-3xl mx-auto fade-in duration-300">
        <ScreenFlash flash={flash} />
        <ResultScreen
          tone="violet"
          icon={Trophy}
          title={summary.title}
          message={summary.message}
          headline={`${score}`}
          headlineLabel={`of ${queue.length} correct`}
          stats={[
            { label: 'Best Streak', value: `${bestStreak}` },
            { label: 'Accuracy', value: `${queue.length ? Math.round((score / queue.length) * 100) : 0}%` },
          ]}
          onReplay={startGame}
          onRegenerate={regenerate}
          regenerating={regenerating}
          celebrate={perfect}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto fade-in duration-300">
      <ScreenFlash flash={flash} />

      <GameStage
        tone="violet"
        icon={Hourglass}
        title="Timed Trivia"
        subtitle={targetData.courseName}
        tier={calibration?.tier ?? null}
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
            {/* Question header: ring and prompt */}
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <TimerRing
                progress={timeLeftMs / questionMs}
                seconds={secondsLeft}
                urgent={isUrgent}
              />

              <div className="flex-1 text-center sm:text-left">
                {/* No per-question difficulty badge: difficulty is per session (paper p. 81), shown on the stage header. */}
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {currentIdx + 1} / {queue.length}
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
                      /* A visible focus ring replaces the removed outline. */
                      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
                      answered
                        ? isCorrect
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300 animate-pop'
                          : isSelected
                            ? 'bg-rose-500/10 border-rose-500 text-rose-300'
                            : 'border-white/5 text-slate-600'
                        : 'bg-white/[0.02] border-white/[0.08] text-slate-300 hover:bg-white/[0.05] hover:border-violet-400/40 active:scale-[0.98]',
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
                          : 'bg-white/[0.03] border-white/10 text-slate-500 group-hover:border-violet-400/50 group-hover:text-violet-400'
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
                  Incorrect — on to the next
                </span>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  <span>Answer before the timer runs out to keep your streak</span>
                </>
              )}
            </div>
          </div>
        )}
      </GameStage>
    </div>
  );
}
