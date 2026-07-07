import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Trophy, Hourglass, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { MOCK_COURSES } from '../../../data/mockCourses';
import { COURSE_DATABASE, getCourseDisplayInfo, getCourseResources, Question } from './gamesData';

export default function TimedTriviaGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('course') || 'bio-301';

  const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || MOCK_COURSES[0];
  const targetInfo = getCourseDisplayInfo(targetCourse);
  const targetData = COURSE_DATABASE[targetInfo.gameKey];
  const finalConnectedResources = getCourseResources(courseId);

  const [triviaQueue, setTriviaQueue] = useState<Question[]>([]);
  const [currentTriviaIdx, setCurrentTriviaIdx] = useState(0);
  const [triviaSelected, setTriviaSelected] = useState<string | null>(null);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaFinished, setTriviaFinished] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [triviaCorrectStreak, setTriviaCorrectStreak] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [questionStartTime, setQuestionStartTime] = useState<number>(0);
  const [triviaTimeLeft, setTriviaTimeLeft] = useState(15);

  const startTriviaGame = () => {
    setCurrentTriviaIdx(0);
    setTriviaSelected(null);
    setTriviaScore(0);
    setTriviaFinished(false);
    setTriviaCorrectStreak(0);
    setQuestionStartTime(Date.now());
    setTriviaTimeLeft(15);

    const courseTrivia = targetData.trivia;
    const initialQueue: Question[] = [];
    for (let i = 0; i < 10; i++) {
      initialQueue.push(courseTrivia[i % courseTrivia.length]);
    }

    setTriviaQueue(initialQueue);
  };

  useEffect(() => {
    startTriviaGame();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const handleTriviaTimeout = () => {
    setTriviaSelected('TIMEOUT_EXPIRED');
    setTriviaCorrectStreak(0);

    setTimeout(() => {
      setTriviaFinished(true);
    }, 1500);
  };

  useEffect(() => {
    if (triviaFinished || triviaSelected !== null || triviaQueue.length === 0) return;

    const timer = setInterval(() => {
      setTriviaTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTriviaTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triviaFinished, triviaSelected, currentTriviaIdx, triviaQueue]);

  const handleTriviaAnswer = (option: string) => {
    if (triviaSelected) return;
    setTriviaSelected(option);

    const isCorrect = option === triviaQueue[currentTriviaIdx].correct;

    if (isCorrect) {
      setTriviaScore(prev => prev + 1);
      setTriviaCorrectStreak(prev => prev + 1);
    } else {
      setTriviaCorrectStreak(0);
    }

    setTimeout(() => {
      if (isCorrect) {
        if (currentTriviaIdx < triviaQueue.length - 1) {
          setCurrentTriviaIdx(prev => prev + 1);
          setTriviaSelected(null);
          setTriviaTimeLeft(15);
          setQuestionStartTime(Date.now());
        } else {
          setTriviaFinished(true);
        }
      } else {
        // Incorrect answer ends the game immediately
        setTriviaFinished(true);
      }
    }, 1500);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <button
          onClick={() => navigate('/student/games')}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
        >
          ← Back to Games
        </button>
        {finalConnectedResources.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center bg-cyan-400/5 border border-cyan-400/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
            <span className="font-semibold text-slate-350">Connected Materials:</span>
            {finalConnectedResources.map((res) => (
              <span key={res} className="px-2 py-0.5 bg-cyan-400/10 border border-cyan-400/20 rounded text-cyan-400 text-[11px] flex items-center gap-1 font-medium">
                <FileText className="w-3 h-3" />
                {res}
              </span>
            ))}
          </div>
        )}
      </div>

      {triviaFinished ? (
        <div className="glass-card rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-10 text-center space-y-6 animate-modal-in">
          <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/10">
            <Trophy className="w-10 h-10" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Trivia Complete!</h2>
            <p className="font-sans text-slate-350 text-sm mt-2">
              You scored {triviaScore} out of {triviaQueue.length} correct.
            </p>
          </div>
          <div className="pt-4 flex gap-4 justify-center">
            <button
              onClick={() => navigate('/student/games')}
              className="px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
            >
              Close Game
            </button>
            <button
              onClick={startTriviaGame}
              className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-sans font-bold text-sm transition-all active:scale-95 shadow-lg shadow-cyan-500/10"
            >
              Play Again
            </button>
          </div>
        </div>
      ) : (
        triviaQueue[currentTriviaIdx] && (
          <div className="glass-card rounded-2xl border border-white/5 p-6 md:p-8 space-y-6">
            <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-widest text-slate-500 font-sans border-b border-white/5 pb-4">
              <span>Question {currentTriviaIdx + 1} of {triviaQueue.length}</span>
              <span className={clsx(
                "flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-lg border transition-all duration-300 font-sans",
                triviaTimeLeft <= 5
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse scale-105"
                  : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
              )}>
                <Hourglass className="w-3.5 h-3.5" />
                {triviaTimeLeft}s
              </span>
            </div>

            <h3 className="font-display text-xl md:text-2xl font-bold text-white leading-relaxed">
              {triviaQueue[currentTriviaIdx].question}
            </h3>

            <div className="grid grid-cols-1 gap-3 pt-4">
              {triviaQueue[currentTriviaIdx].options.map((option) => {
                const isSelected = triviaSelected === option;
                const isCorrect = option === triviaQueue[currentTriviaIdx].correct;
                const showsAnswer = triviaSelected !== null;

                return (
                  <button
                    key={option}
                    onClick={() => handleTriviaAnswer(option)}
                    disabled={showsAnswer}
                    className={clsx(
                      "w-full p-4 rounded-xl border transition-all duration-300 flex items-center justify-between outline-none select-none text-left font-sans text-sm font-medium",
                      showsAnswer
                        ? isCorrect
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold"
                          : isSelected
                            ? "bg-rose-500/10 border-rose-500 text-rose-400"
                            : "bg-white/2 border-white/2 text-slate-500 cursor-default"
                        : "bg-surface-container-lowest border-white/5 text-slate-300 hover:bg-surface-container-high/50 hover:border-white/10 active:scale-[0.99]"
                    )}
                  >
                    <span>{option}</span>
                    {showsAnswer && isCorrect && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    {showsAnswer && isSelected && !isCorrect && (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}
