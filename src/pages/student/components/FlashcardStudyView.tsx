import React, { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Trophy, ArrowLeft, Zap, Clock, AlertTriangle, Brain, Calendar, CheckCircle2 } from 'lucide-react';
import { api } from '../../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Flashcard {
  id: number | string;
  front: string;
  back: string;
}

type EaseRating = 'easy' | 'medium' | 'hard';

interface CardSession {
  cardId: number | string;
  rating: EaseRating;
}

interface FlashcardStudyViewProps {
  cards: Flashcard[];
  deckTitle: string;
  onExit: () => void;
  studentId?: string;
}

// ─── Spaced Repetition Config ─────────────────────────────────────────────────
// Easy  → next review in 4 days
// Medium→ next review in 3 days
// Hard  → next review in 1 day

const RATING_CONFIG: Record<EaseRating, {
  label: string;
  sublabel: string;
  days: number;
  icon: React.ReactNode;
  containerClass: string;
  borderClass: string;
  hoverClass: string;
  textClass: string;
  glowClass: string;
  kbd: string;
}> = {
  hard: {
    label: 'Hard',
    sublabel: 'Review in 1 day',
    days: 1,
    icon: <AlertTriangle className="w-5 h-5" />,
    containerClass: 'bg-red-500/10',
    borderClass: 'border-red-500/25',
    hoverClass: 'hover:bg-red-500/20 hover:border-red-500/50',
    textClass: 'text-red-400',
    glowClass: 'shadow-red-500/20',
    kbd: '1',
  },
  medium: {
    label: 'Medium',
    sublabel: 'Review in 3 days',
    days: 3,
    icon: <Clock className="w-5 h-5" />,
    containerClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/25',
    hoverClass: 'hover:bg-amber-500/20 hover:border-amber-500/50',
    textClass: 'text-amber-400',
    glowClass: 'shadow-amber-500/20',
    kbd: '2',
  },
  easy: {
    label: 'Easy',
    sublabel: 'Review in 7 days',
    days: 4,
    icon: <Zap className="w-5 h-5" />,
    containerClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/25',
    hoverClass: 'hover:bg-emerald-500/20 hover:border-emerald-500/50',
    textClass: 'text-emerald-400',
    glowClass: 'shadow-emerald-500/20',
    kbd: '3',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlashcardStudyView({
  cards,
  deckTitle,
  onExit,
  studentId,
}: FlashcardStudyViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState<CardSession[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [studyCards, setStudyCards] = useState<Flashcard[]>(cards);
  const [isSaving, setIsSaving] = useState(false);
  // Track which rating was chosen on current card for animation feedback
  const [selectedRating, setSelectedRating] = useState<EaseRating | null>(null);

  // ── Rating handler ──────────────────────────────────────────────────────────

  const handleRate = useCallback(async (rating: EaseRating) => {
    if (isAnimating || isFinished || !isFlipped) return;

    setIsAnimating(true);
    setSelectedRating(rating);
    setIsSaving(true);

    const card = studyCards[currentIndex];

    // Fire-and-forget: log to backend (non-blocking — don't await)
    if (studentId) {
      api.post('/flashcards/rate', {
        flashcard_id: card.id,
        rating,
      }).catch(() => {/* silent fail — offline resilient */});
    }

    // Record session result
    setSessionResults(prev => [...prev, { cardId: card.id, rating }]);

    // Slide animation based on rating
    const direction = rating === 'easy' ? 'right' : rating === 'hard' ? 'left' : null;
    if (direction) setSlideDirection(direction);

    setTimeout(() => {
      setIsSaving(false);
      setSelectedRating(null);
      setSlideDirection(null);

      if (currentIndex < studyCards.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setIsFlipped(false);
      } else {
        setIsFinished(true);
      }
      setIsAnimating(false);
    }, 380);
  }, [isAnimating, isFinished, isFlipped, currentIndex, studyCards, studentId]);

  // ── Flip handler ────────────────────────────────────────────────────────────

  const handleFlip = useCallback(() => {
    if (isAnimating || isFinished) return;
    setIsFlipped(prev => !prev);
  }, [isAnimating, isFinished]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleFlip();
      }
      if (isFlipped) {
        if (e.key === '1') handleRate('hard');
        if (e.key === '2') handleRate('medium');
        if (e.key === '3') handleRate('easy');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFlip, handleRate, isFlipped]);

  // ── Restart helpers ─────────────────────────────────────────────────────────

  const handleRestartHard = () => {
    const hardCardIds = new Set(
      sessionResults.filter(r => r.rating === 'hard').map(r => r.cardId)
    );
    const hardCards = cards.filter(c => hardCardIds.has(c.id));
    if (!hardCards.length) return;
    setStudyCards(hardCards);
    setSessionResults([]);
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsFinished(false);
  };

  const handleRestartAll = () => {
    setStudyCards(cards);
    setSessionResults([]);
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsFinished(false);
  };

  // ── Derived stats ───────────────────────────────────────────────────────────

  const easyCount = sessionResults.filter(r => r.rating === 'easy').length;
  const mediumCount = sessionResults.filter(r => r.rating === 'medium').length;
  const hardCount = sessionResults.filter(r => r.rating === 'hard').length;
  const masteryPercent =
    studyCards.length > 0
      ? Math.round(((easyCount + mediumCount * 0.5) / studyCards.length) * 100)
      : 0;
  const progress =
    studyCards.length > 0
      ? ((currentIndex + (isFinished ? 1 : 0)) / studyCards.length) * 100
      : 0;

  // ════════════════════════════════════════════════════════════════════════════
  // RESULTS SCREEN
  // ════════════════════════════════════════════════════════════════════════════

  if (isFinished) {
    const circumference = 2 * Math.PI * 54;
    const strokeDashoffset = circumference - (masteryPercent / 100) * circumference;

    const getGradeColor = () => {
      if (masteryPercent >= 80) return 'text-emerald-400';
      if (masteryPercent >= 50) return 'text-amber-400';
      return 'text-red-400';
    };
    const getGradeRingColor = () => {
      if (masteryPercent >= 80) return 'stroke-emerald-400';
      if (masteryPercent >= 50) return 'stroke-amber-400';
      return 'stroke-red-400';
    };
    const getGradeMessage = () => {
      if (masteryPercent >= 90) return "Outstanding! Your mastery is excellent.";
      if (masteryPercent >= 75) return "Great work! Keep reviewing the harder ones.";
      if (masteryPercent >= 50) return "Good progress! Focus on the hard cards.";
      return "Keep going — spaced repetition will help!";
    };

    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-lg bg-surface-container-lowest rounded-3xl border border-white/5 p-10 text-center relative overflow-hidden shadow-2xl shadow-black/30">
          <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10">
            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-6">
              <Trophy className={`w-8 h-8 ${getGradeColor()}`} />
            </div>

            <h2 className="font-display text-2xl font-bold text-white mb-1">Session Complete</h2>
            <p className="font-sans text-sm text-slate-400 mb-8">{deckTitle}</p>

            {/* Mastery ring */}
            <div className="relative w-36 h-36 mx-auto mb-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
                <circle
                  cx="60" cy="60" r="54" fill="none" strokeWidth="6" strokeLinecap="round"
                  className={getGradeRingColor()}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-display text-4xl font-bold ${getGradeColor()}`}>{masteryPercent}%</span>
                <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Mastery</span>
              </div>
            </div>

            <p className="font-sans text-sm text-slate-300 mb-8">{getGradeMessage()}</p>

            {/* Rating breakdown */}
            <div className="grid grid-cols-3 gap-3 mb-8">
              {/* Hard */}
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="font-display text-2xl font-bold text-red-400">{hardCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-red-400/70 font-semibold">Hard</p>
                <p className="font-sans text-[9px] text-slate-600 mt-0.5">1 day</p>
              </div>
              {/* Medium */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="font-display text-2xl font-bold text-amber-400">{mediumCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-amber-400/70 font-semibold">Medium</p>
                <p className="font-sans text-[9px] text-slate-600 mt-0.5">3 days</p>
              </div>
              {/* Easy */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span className="font-display text-2xl font-bold text-emerald-400">{easyCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-emerald-400/70 font-semibold">Easy</p>
                <p className="font-sans text-[9px] text-slate-600 mt-0.5">4 days</p>
              </div>
            </div>

            {/* Spaced repetition note */}
            <div className="flex items-start gap-3 bg-primary-fixed-dim/5 border border-primary-fixed-dim/15 rounded-xl p-4 mb-8 text-left">
              <Calendar className="w-4 h-4 text-primary-fixed-dim shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Your next review dates have been scheduled based on your ratings. Cards you found hard will appear sooner.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              {hardCount > 0 && (
                <button
                  onClick={handleRestartHard}
                  className="w-full px-5 py-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl font-sans text-sm font-bold hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Drill {hardCount} Hard Card{hardCount !== 1 ? 's' : ''} Again
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

  // ════════════════════════════════════════════════════════════════════════════
  // STUDY VIEW
  // ════════════════════════════════════════════════════════════════════════════

  const currentCard = studyCards[currentIndex];
  const ratingOrder: EaseRating[] = ['hard', 'medium', 'easy'];

  return (
    <div className="animate-in fade-in duration-300 flex flex-col items-center">

      {/* ── Progress header ─────────────────────────────────────────── */}
      <div className="w-full max-w-2xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onExit}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-sm uppercase tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" /> Exit
          </button>

          <div className="flex items-center gap-4">
            {/* Mini rating pills */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="flex items-center gap-1 font-sans text-xs text-red-400">
                <AlertTriangle className="w-3 h-3" />
                {sessionResults.filter(r => r.rating === 'hard').length}
              </span>
              <span className="flex items-center gap-1 font-sans text-xs text-amber-400">
                <Clock className="w-3 h-3" />
                {sessionResults.filter(r => r.rating === 'medium').length}
              </span>
              <span className="flex items-center gap-1 font-sans text-xs text-emerald-400">
                <Zap className="w-3 h-3" />
                {sessionResults.filter(r => r.rating === 'easy').length}
              </span>
            </div>
            <span className="font-sans text-xs text-slate-500">
              {currentIndex + 1} / {studyCards.length}
            </span>
          </div>
        </div>

        {/* Segmented progress bar */}
        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex gap-0.5">
          {studyCards.map((card, i) => {
            const result = sessionResults.find(r => r.cardId === card.id);
            let barColor = 'bg-white/10';
            if (result?.rating === 'easy') barColor = 'bg-emerald-400';
            else if (result?.rating === 'medium') barColor = 'bg-amber-400';
            else if (result?.rating === 'hard') barColor = 'bg-red-400';
            else if (i === currentIndex) barColor = 'bg-primary-fixed-dim/60';
            return (
              <div
                key={card.id}
                className={`flex-1 h-full rounded-full transition-colors duration-500 ${barColor}`}
              />
            );
          })}
        </div>
      </div>

      {/* ── Flashcard ───────────────────────────────────────────────── */}
      <div className="w-full max-w-2xl mb-6">
        <div
          onClick={handleFlip}
          className={`relative w-full h-80 md:h-[22rem] cursor-pointer select-none transition-all duration-350
            ${slideDirection === 'right' ? 'translate-x-[130%] opacity-0 rotate-6' : ''}
            ${slideDirection === 'left' ? '-translate-x-[130%] opacity-0 -rotate-6' : ''}
          `}
          style={{ perspective: '1200px' }}
        >
          <div
            className="relative w-full h-full transition-transform duration-500 ease-out"
            style={{
              transformStyle: 'preserve-3d',
              transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* Front face */}
            <div
              className="absolute inset-0 rounded-3xl border border-white/10 bg-surface-container-lowest p-8 md:p-12 flex flex-col justify-center items-center text-center shadow-2xl shadow-black/20"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <span className="absolute top-5 left-6 font-sans text-[10px] uppercase tracking-widest text-slate-600 font-bold">
                Question
              </span>
              <p className="font-display text-xl md:text-2xl text-on-surface leading-relaxed">
                {currentCard.front}
              </p>
              <span className="absolute bottom-5 text-[10px] uppercase tracking-widest text-slate-600 flex items-center gap-1.5 font-semibold animate-pulse">
                <span className="inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px]">Space</span>
                Tap or press Space to reveal
              </span>
            </div>

            {/* Back face */}
            <div
              className="absolute inset-0 rounded-3xl border border-primary-fixed-dim/20 bg-gradient-to-br from-surface-container-lowest to-primary-fixed-dim/5 p-8 md:p-12 flex flex-col justify-center items-center text-center shadow-2xl shadow-primary-fixed-dim/5"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <span className="absolute top-5 left-6 font-sans text-[10px] uppercase tracking-widest text-primary-fixed-dim/50 font-bold">
                Answer
              </span>
              <p className="font-sans text-lg md:text-xl text-primary-fixed font-medium leading-relaxed">
                {currentCard.back}
              </p>

              {/* "Rate yourself" prompt — only visible when flipped */}
              <div className="absolute bottom-5 flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-slate-600" />
                <span className="font-sans text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
                  How well did you know this?
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Rating Buttons (revealed after flip) ───────────────────── */}
      <div className="w-full max-w-2xl">
        {!isFlipped ? (
          /* Before flip: show neutral flip-to-reveal state */
          <div className="flex items-center justify-center">
            <button
              onClick={handleFlip}
              className="flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-surface-container border border-white/10 text-slate-300 font-sans font-semibold text-sm hover:bg-surface-container-high hover:border-white/20 transition-all hover:scale-[1.02]"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              Reveal Answer
            </button>
          </div>
        ) : (
          /* After flip: show 3-tier rating buttons */
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <p className="text-center font-sans text-xs text-slate-500 uppercase tracking-widest mb-4 font-semibold">
              Rate your recall
            </p>
            <div className="grid grid-cols-3 gap-3">
              {ratingOrder.map((rating) => {
                const cfg = RATING_CONFIG[rating];
                const isSelected = selectedRating === rating;
                return (
                  <button
                    key={rating}
                    onClick={() => handleRate(rating)}
                    disabled={isAnimating}
                    className={`
                      group relative flex flex-col items-center gap-2 p-4 rounded-2xl border
                      transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none
                      ${cfg.containerClass} ${cfg.borderClass} ${cfg.hoverClass}
                      ${isSelected ? `scale-95 shadow-lg ${cfg.glowClass}` : 'hover:scale-[1.03]'}
                    `}
                  >
                    {/* Checkmark overlay when selected */}
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/20">
                        <CheckCircle2 className={`w-6 h-6 ${cfg.textClass}`} />
                      </div>
                    )}

                    <span className={cfg.textClass}>{cfg.icon}</span>
                    <div className="text-center">
                      <p className={`font-display font-bold text-sm ${cfg.textClass}`}>
                        {cfg.label}
                      </p>
                      <p className="font-sans text-[10px] text-slate-600 mt-0.5">
                        {cfg.sublabel}
                      </p>
                    </div>

                    {/* Keyboard hint */}
                    <span className="absolute top-2 right-2 w-5 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">
                      {cfg.kbd}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Keyboard hints row */}
            <div className="flex items-center justify-center gap-6 mt-4">
              <div className="flex items-center gap-1.5">
                <span className="inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">Space</span>
                <span className="font-sans text-[10px] text-slate-600">Flip back</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">1 / 2 / 3</span>
                <span className="font-sans text-[10px] text-slate-600">Rate</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Saving indicator */}
      {isSaving && (
        <div className="mt-4 flex items-center gap-2 text-slate-600">
          <div className="w-3 h-3 rounded-full border-2 border-slate-600 border-t-transparent animate-spin" />
          <span className="font-sans text-[10px] uppercase tracking-widest">Saving...</span>
        </div>
      )}
    </div>
  );
}
