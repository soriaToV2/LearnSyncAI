import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Trophy, ArrowLeft, Check, X as XIcon } from 'lucide-react';


interface Flashcard {
  id: number;
  front: string;
  back: string;
}

interface FlashcardStudyViewProps {
  cards: Flashcard[];
  deckTitle: string;
  onExit: () => void;
}

type CardResult = 'correct' | 'incorrect' | null;

export default function FlashcardStudyView({ cards, deckTitle, onExit }: FlashcardStudyViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [results, setResults] = useState<Map<number, CardResult>>(new Map());
  const [isFinished, setIsFinished] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [studyCards, setStudyCards] = useState<Flashcard[]>(cards);
  const [showHint, setShowHint] = useState(true);

  // Auto-hide keyboard hint
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  const handleFlip = useCallback(() => {
    if (isAnimating || isFinished) return;
    setIsFlipped(prev => !prev);
    setShowHint(false);
  }, [isAnimating, isFinished]);

  const handleAnswer = useCallback((correct: boolean) => {
    if (isAnimating || isFinished) return;
    setIsAnimating(true);
    setSlideDirection(correct ? 'right' : 'left');
    setShowHint(false);

    const cardId = studyCards[currentIndex].id;
    setResults(prev => {
      const newResults = new Map(prev);
      newResults.set(cardId, correct ? 'correct' : 'incorrect');
      return newResults;
    });

    setTimeout(() => {
      if (currentIndex < studyCards.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setIsFlipped(false);
      } else {
        setIsFinished(true);
      }
      setSlideDirection(null);
      setIsAnimating(false);
    }, 350);
  }, [currentIndex, studyCards, isAnimating, isFinished]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Block space scroll
      if (e.code === 'Space') {
        e.preventDefault();
        handleFlip();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleAnswer(true);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleAnswer(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFlip, handleAnswer]);

  const correctCount = Array.from(results.values()).filter(v => v === 'correct').length;
  const incorrectCount = Array.from(results.values()).filter(v => v === 'incorrect').length;
  const totalAnswered = correctCount + incorrectCount;
  const percentage = studyCards.length > 0 ? Math.round((correctCount / studyCards.length) * 100) : 0;
  const progress = studyCards.length > 0 ? ((currentIndex + (isFinished ? 1 : 0)) / studyCards.length) * 100 : 0;

  const handleRestartIncorrect = () => {
    const incorrectCards = studyCards.filter(card => results.get(card.id) === 'incorrect');
    if (incorrectCards.length === 0) return;
    setStudyCards(incorrectCards);
    setResults(new Map());
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsFinished(false);
    setSlideDirection(null);
  };

  const handleRestartAll = () => {
    setStudyCards(cards);
    setResults(new Map());
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsFinished(false);
    setSlideDirection(null);
  };

  // Results screen
  if (isFinished) {
    const circumference = 2 * Math.PI * 54;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    const getGradeColor = () => {
      if (percentage >= 80) return 'text-emerald-400';
      if (percentage >= 60) return 'text-amber-400';
      return 'text-red-400';
    };
    const getGradeRingColor = () => {
      if (percentage >= 80) return 'stroke-emerald-400';
      if (percentage >= 60) return 'stroke-amber-400';
      return 'stroke-red-400';
    };
    const getGradeMessage = () => {
      if (percentage >= 90) return "Outstanding! You've mastered this set!";
      if (percentage >= 80) return "Great work! Almost perfect!";
      if (percentage >= 60) return "Good effort! A bit more practice will help.";
      if (percentage >= 40) return "Keep going! Review the ones you missed.";
      return "Don't worry — practice makes perfect!";
    };

    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center py-12">
        {/* Results card */}
        <div className="w-full max-w-lg bg-surface-container-lowest rounded-3xl border border-white/5 p-10 text-center relative overflow-hidden">
          {/* Gradient bg */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10">
            {/* Trophy icon */}
            <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-6">
              <Trophy className={`w-8 h-8 ${getGradeColor()}`} />
            </div>

            <h2 className="font-display text-2xl font-bold text-white mb-1">Session Complete</h2>
            <p className="font-sans text-sm text-slate-400 mb-8">{deckTitle}</p>

            {/* Score ring */}
            <div className="relative w-36 h-36 mx-auto mb-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
                <circle
                  cx="60" cy="60" r="54" fill="none" strokeWidth="6" strokeLinecap="round"
                  className={getGradeRingColor()}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-display text-4xl font-bold ${getGradeColor()}`}>{percentage}%</span>
                <span className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">Mastery</span>
              </div>
            </div>

            {/* Feedback */}
            <p className="font-sans text-sm text-slate-300 mb-8">{getGradeMessage()}</p>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="font-display text-2xl font-bold text-emerald-400">{correctCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-emerald-400/70 font-semibold">Correct</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <XIcon className="w-4 h-4 text-red-400" />
                  <span className="font-display text-2xl font-bold text-red-400">{incorrectCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-red-400/70 font-semibold">Incorrect</p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              {incorrectCount > 0 && (
                <button
                  onClick={handleRestartIncorrect}
                  className="w-full px-5 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Review {incorrectCount} Missed Card{incorrectCount !== 1 ? 's' : ''}
                </button>
              )}
              <button
                onClick={handleRestartAll}
                className="w-full px-5 py-3 bg-surface-container border border-white/10 text-on-surface rounded-xl font-sans text-sm font-semibold hover:bg-surface-container-high transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Restart Entire Set
              </button>
              <button
                onClick={onExit}
                className="w-full px-5 py-3 text-slate-400 hover:text-white font-sans text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Deck
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Study view
  const currentCard = studyCards[currentIndex];

  return (
    <div className="animate-in fade-in duration-300 flex flex-col items-center">
      {/* Progress header */}
      <div className="w-full max-w-2xl mb-8">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onExit}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-sm uppercase tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" /> Exit Study
          </button>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-sans text-xs text-slate-400">{correctCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="font-sans text-xs text-slate-400">{incorrectCount}</span>
            </div>
            <span className="font-sans text-xs text-slate-500">
              {currentIndex + 1} / {studyCards.length}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-fixed-dim to-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-2xl mb-8">
        <div
          onClick={handleFlip}
          className={`relative w-full h-80 md:h-96 cursor-pointer select-none transition-all duration-350
            ${slideDirection === 'right' ? 'translate-x-[120%] opacity-0 rotate-6' : ''}
            ${slideDirection === 'left' ? '-translate-x-[120%] opacity-0 -rotate-6' : ''}
          `}
          style={{ perspective: '1200px' }}
        >
          <div
            className={`relative w-full h-full transition-transform duration-500 ease-out`}
            style={{
              transformStyle: 'preserve-3d',
              transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 rounded-3xl border border-white/10 bg-surface-container-lowest p-8 md:p-12 flex flex-col justify-center items-center text-center shadow-2xl shadow-black/20"
              style={{ backfaceVisibility: 'hidden' }}
            >
              {/* Label */}
              <span className="absolute top-5 left-6 font-sans text-[10px] uppercase tracking-widest text-slate-600 font-bold">
                Question
              </span>
              <p className="font-display text-xl md:text-2xl text-on-surface leading-relaxed">
                {currentCard.front}
              </p>
              <span className="absolute bottom-5 text-[10px] uppercase tracking-widest text-slate-600 flex items-center gap-1.5 font-semibold">
                <span className="inline-block w-5 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px]">␣</span>
                Tap or press Space to flip
              </span>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 rounded-3xl border border-primary-fixed-dim/20 bg-gradient-to-br from-surface-container-lowest to-primary-fixed-dim/5 p-8 md:p-12 flex flex-col justify-center items-center text-center shadow-2xl shadow-primary-fixed-dim/5"
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <span className="absolute top-5 left-6 font-sans text-[10px] uppercase tracking-widest text-primary-fixed-dim/50 font-bold">
                Answer
              </span>
              <p className="font-sans text-lg md:text-xl text-primary-fixed font-medium leading-relaxed">
                {currentCard.back}
              </p>
              <span className="absolute bottom-5 text-[10px] uppercase tracking-widest text-slate-600 flex items-center gap-1.5 font-semibold">
                Use arrow keys to answer
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="w-full max-w-2xl flex items-center justify-center gap-6">
        {/* Wrong */}
        <button
          onClick={() => handleAnswer(false)}
          className="group flex flex-col items-center gap-2"
          disabled={isAnimating}
        >
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center group-hover:bg-red-500/20 group-hover:border-red-500/40 group-hover:scale-110 transition-all group-disabled:opacity-50">
            <XIcon className="w-7 h-7 text-red-400" />
          </div>
          <div className="flex items-center gap-1">
            <ChevronLeft className="w-3 h-3 text-slate-500" />
            <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Don't Know</span>
          </div>
        </button>

        {/* Flip */}
        <div className="flex flex-col items-center gap-2 px-4">
          <button
            onClick={handleFlip}
            className="w-14 h-14 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center hover:bg-surface-container-high hover:scale-105 transition-all"
          >
            <RotateCcw className="w-5 h-5 text-slate-400" />
          </button>
          <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Flip</span>
        </div>

        {/* Correct */}
        <button
          onClick={() => handleAnswer(true)}
          className="group flex flex-col items-center gap-2"
          disabled={isAnimating}
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/20 group-hover:border-emerald-500/40 group-hover:scale-110 transition-all group-disabled:opacity-50">
            <Check className="w-7 h-7 text-emerald-400" />
          </div>
          <div className="flex items-center gap-1">
            <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Know It</span>
            <ChevronRight className="w-3 h-3 text-slate-500" />
          </div>
        </button>
      </div>

      {/* Keyboard hint */}
      {showHint && (
        <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-surface-container border border-white/5 rounded-xl px-5 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="inline-block w-7 h-7 rounded-md bg-white/5 border border-white/10 text-center leading-7 font-mono text-xs text-slate-400">←</span>
              <span className="font-sans text-xs text-slate-500">Wrong</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="inline-block px-2 h-7 rounded-md bg-white/5 border border-white/10 text-center leading-7 font-mono text-xs text-slate-400">Space</span>
              <span className="font-sans text-xs text-slate-500">Flip</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="inline-block w-7 h-7 rounded-md bg-white/5 border border-white/10 text-center leading-7 font-mono text-xs text-slate-400">→</span>
              <span className="font-sans text-xs text-slate-500">Correct</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
