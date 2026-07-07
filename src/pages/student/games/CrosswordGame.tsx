import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, CheckCircle2, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { MOCK_COURSES } from '../../../data/mockCourses';
import { COURSE_DATABASE, getCourseDisplayInfo, getCourseResources } from './gamesData';

export default function CrosswordGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('course') || 'bio-301';

  const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || MOCK_COURSES[0];
  const targetInfo = getCourseDisplayInfo(targetCourse);
  const targetData = COURSE_DATABASE[targetInfo.gameKey];
  const finalConnectedResources = getCourseResources(courseId);

  const [crosswordAnswers, setCrosswordAnswers] = useState<Record<string, string>>({});
  const [crosswordChecked, setCrosswordChecked] = useState(false);
  const [crosswordVictory, setCrosswordVictory] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [crosswordCluesUsed, setCrosswordCluesUsed] = useState(0);

  const startCrosswordGame = () => {
    setCrosswordAnswers({});
    setCrosswordChecked(false);
    setCrosswordVictory(false);
    setCrosswordCluesUsed(0);
  };

  useEffect(() => {
    startCrosswordGame();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const handleCrosswordInput = (r: number, c: number, val: string) => {
    const key = `${r}-${c}`;
    setCrosswordAnswers(prev => ({
      ...prev,
      [key]: val.toUpperCase().slice(-1)
    }));
    setCrosswordChecked(false);
  };

  const useCrosswordHint = () => {
    const emptyCell = targetData.crossword.find(cell => {
      const key = `${cell.r}-${cell.c}`;
      return crosswordAnswers[key] !== cell.correctLetter;
    });

    if (emptyCell) {
      const key = `${emptyCell.r}-${emptyCell.c}`;
      setCrosswordAnswers(prev => ({
        ...prev,
        [key]: emptyCell.correctLetter
      }));
      setCrosswordCluesUsed(prev => prev + 1);
    }
  };

  const checkCrosswordAnswers = () => {
    let allCorrect = true;
    targetData.crossword.forEach((cell) => {
      const key = `${cell.r}-${cell.c}`;
      if (crosswordAnswers[key] !== cell.correctLetter) {
        allCorrect = false;
      }
    });

    setCrosswordChecked(true);
    if (allCorrect) {
      setCrosswordVictory(true);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <button
          onClick={() => navigate('/student/games')}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
        >
          ← Back to Games
        </button>
        {finalConnectedResources.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center bg-amber-400/5 border border-amber-400/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
            <span className="font-semibold text-slate-350">Connected Materials:</span>
            {finalConnectedResources.map((res) => (
              <span key={res} className="px-2 py-0.5 bg-amber-400/10 border border-amber-400/20 rounded text-amber-400 text-[11px] flex items-center gap-1 font-medium">
                <FileText className="w-3 h-3" />
                {res}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={useCrosswordHint}
            className="px-3.5 py-2 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 rounded-lg font-sans text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI Assist Hint
          </button>
          <button
            onClick={startCrosswordGame}
            className="flex items-center gap-1.5 px-4 py-2 text-amber-400 hover:text-white transition-all font-sans text-sm font-semibold"
          >
            <RefreshCw className="w-4 h-4" /> Reset Grid
          </button>
        </div>
      </div>

      {crosswordVictory ? (
        <div className="glass-card rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-10 text-center space-y-6 animate-modal-in">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Crossword Solved!</h2>
            <p className="font-sans text-slate-350 text-sm mt-2 max-w-sm mx-auto">
              Outstanding! You successfully filled out every grid block correctly.
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
              onClick={startCrosswordGame}
              className="px-6 py-2.5 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-350 transition-all active:scale-95"
            >
              Play Again
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Grid Visual */}
          <div className="flex justify-center bg-surface-container/30 p-6 rounded-2xl border border-white/5">
            <div className="grid grid-cols-5 gap-1.5 bg-slate-950 p-3 rounded-xl">
              {Array.from({ length: 5 }).map((_, r) => (
                <React.Fragment key={r}>
                  {Array.from({ length: 5 }).map((_, c) => {
                    const cellData = targetData.crossword.find(cell => cell.r === r && cell.c === c);
                    const key = `${r}-${c}`;
                    const userVal = crosswordAnswers[key] || '';
                    const isIncorrect = crosswordChecked && userVal !== cellData?.correctLetter;

                    if (!cellData) {
                      return (
                        <div key={key} className="w-12 h-12 bg-slate-900 border border-slate-950 rounded-md" />
                      );
                    }

                    return (
                      <div key={key} className="relative w-12 h-12 bg-surface-container-high border border-white/10 rounded-md flex items-center justify-center focus-within:border-amber-400/70 transition-all">
                        {cellData.label && (
                          <span className="absolute top-0.5 left-0.5 text-[8px] font-sans font-bold text-slate-500">{cellData.label}</span>
                        )}
                        <input
                          type="text"
                          maxLength={1}
                          value={userVal}
                          onChange={(e) => handleCrosswordInput(r, c, e.target.value)}
                          className={clsx(
                            "w-full h-full text-center bg-transparent outline-none uppercase font-display font-semibold text-lg text-white",
                            isIncorrect && "text-rose-400 border border-rose-500/50 rounded-md bg-rose-500/5"
                          )}
                        />
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Clues */}
          <div className="space-y-6 bg-surface-container-low/40 p-6 rounded-2xl border border-white/5">
            <div>
              <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">Across Clues</h3>
              <div className="space-y-3 mt-3">
                <div className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">1</span>
                  <p className="text-slate-300 font-sans">{targetData.crosswordClues.across1}</p>
                </div>
                <div className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">2</span>
                  <p className="text-slate-300 font-sans">{targetData.crosswordClues.across2}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">Down Clues</h3>
              <div className="space-y-3 mt-3">
                <div className="flex gap-2.5 items-start text-sm">
                  <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">1</span>
                  <p className="text-slate-300 font-sans">{targetData.crosswordClues.down1}</p>
                </div>
              </div>
            </div>

            <button
              onClick={checkCrosswordAnswers}
              className="w-full py-2.5 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-350 transition-all active:scale-95"
            >
              Check Answers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
