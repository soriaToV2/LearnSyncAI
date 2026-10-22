import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Trophy, ArrowLeft, Zap, Clock, AlertTriangle, Brain, Calendar, CheckCircle2 } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { api } from '../../../lib/api';
import { useBadges } from '../../../context/BadgeContext';
import { useOnboarding } from '../../../context/OnboardingContext';
import type { EaseRating } from '../../../lib/reviewSchedule';

// Types

interface Flashcard {
  id: number | string;
  front: string;
  back: string;
  /** Material this card came from, shown as a quiet label. */
  source?: string;
}

interface CardSession {
  cardId: number | string;
  rating: EaseRating;
  /**
   * What the server did with the rating; undefined while in flight. 'unchanged' = not counted (reviewed in
   * another tab first). All three are recorded, and the results panel waits until none are pending.
   */
  saved?: 'counted' | 'unchanged' | 'failed';
}

interface FlashcardStudyViewProps {
  cards: Flashcard[];
  deckTitle: string;
  onExit: () => void;
  /**
   * The deck's answer_first setting. A prop, not a front/back swap by the caller: the labels and type
   * curve must follow the text. front is always the term/question, back always the definition.
   */
  answerFirst?: boolean;
  /** What the front holds ("Term" or "Question"); passed in because format is a deck property. */
  frontNoun?: string;
}

// Spaced repetition config. Must match REVIEW_INTERVALS on the server and the interval_days CHECK.

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
    days: 7,
    icon: <Zap className="w-5 h-5" />,
    containerClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/25',
    hoverClass: 'hover:bg-emerald-500/20 hover:border-emerald-500/50',
    textClass: 'text-emerald-400',
    glowClass: 'shadow-emerald-500/20',
    kbd: '3',
  },
};

// Card face typography

/**
 * Type size and alignment for a face, by text length. The back is the educator's definition verbatim
 * (never truncated), so the card adapts to the text; long text left-aligns. `kind` describes the text
 * (prompt vs passage), not the face it sits on, since answer_first can swap them.
 */
function faceTypeClass(text: string, kind: 'prompt' | 'passage'): string {
  const len = text.length;

  if (kind === 'prompt') {
    if (len <= 260) return 'text-xl md:text-2xl leading-relaxed text-center';
    if (len <= 420) return 'text-lg md:text-xl leading-relaxed text-center';
    return 'text-base md:text-lg leading-relaxed text-left';
  }

  if (len <= 120) return 'text-xl md:text-2xl leading-relaxed text-center';
  if (len <= 260) return 'text-base md:text-lg leading-relaxed text-center';
  if (len <= 420) return 'text-sm md:text-base leading-relaxed text-left';
  return 'text-sm leading-snug text-left';
}

/** Fades the bottom edge so overflowing text visibly runs on. */
const FADE_MASK: React.CSSProperties = {
  maskImage: 'linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)',
};

/**
 * Whether a scroll box still has content below its edge, measured live (overflow depends on viewport
 * and type size) and updated on scroll so the last line isn't faded. Resets scroll when `content` changes.
 */
function useMoreBelow(content: string): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 1px slack for sub-pixel line heights.
    const measure = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1);

    el.scrollTop = 0;
    measure();

    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [content]);

  return [ref, moreBelow];
}

// Component

export default function FlashcardStudyView({
  cards,
  deckTitle,
  onExit,
  answerFirst = false,
  frontNoun = 'Term',
}: FlashcardStudyViewProps) {
  const { celebrate } = useBadges();

  /* The session walkthrough runs on first entry, when the card and rating buttons are on screen. */
  const { startTour } = useOnboarding();
  useEffect(() => {
    const t = setTimeout(() => startTour('tool_flashcards_study'), 700);
    return () => clearTimeout(t);
  }, [startTour]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState<CardSession[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  // Snapshot at mount so a mid-session refresh can't shrink the list under currentIndex.
  const [studyCards] = useState<Flashcard[]>(cards);
  const [isSaving, setIsSaving] = useState(false);
  // The rating chosen on the current card, for animation feedback
  const [selectedRating, setSelectedRating] = useState<EaseRating | null>(null);

  // Badge check at the end of the session, not per rating (ratings aren't awaited).
  useEffect(() => {
    if (isFinished) celebrate();
  }, [isFinished, celebrate]);
  // A rating the server refused; shown, not swallowed.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Hoisted above the results-screen return so the hooks below can read it.
  const currentCard = studyCards[currentIndex];

  // Which string goes on which face. answerFirst only decides which the student meets first; the *Kind
  // values and labels travel with the text.
  const promptText = answerFirst ? (currentCard?.back ?? '') : (currentCard?.front ?? '');
  const answerText = answerFirst ? (currentCard?.front ?? '') : (currentCard?.back ?? '');
  const promptKind = answerFirst ? 'passage' : 'prompt';
  const answerKind = answerFirst ? 'prompt' : 'passage';
  // Faces are labelled for what they hold (Term/Question/Definition).
  const promptLabel = answerFirst ? 'Definition' : frontNoun;
  const answerLabel = answerFirst ? frontNoun : 'Definition';

  // Each face fades while text remains below; keyed on the text so flipping sides re-measures.
  const [frontScrollRef, frontOverflows] = useMoreBelow(promptText);
  const [backScrollRef, backOverflows] = useMoreBelow(answerText);

  // Rating handler

  const handleRate = useCallback(async (rating: EaseRating) => {
    if (isAnimating || isFinished || !isFlipped) return;

    setIsAnimating(true);
    setSelectedRating(rating);
    setIsSaving(true);
    setSaveError(null);

    const card = studyCards[currentIndex];

    // The server decides whether it counts. Not awaited, so the session never stalls; failures are shown.
    const settle = (saved: NonNullable<CardSession['saved']>) =>
      setSessionResults(prev =>
        prev.map(r => (r.cardId === card.id && r.saved === undefined ? { ...r, saved } : r))
      );
    api.post<{ counted: boolean }>('/flashcards/rate', {
      flashcard_id: card.id,
      rating,
    }).then(res => {
      settle(res.data?.counted ? 'counted' : 'unchanged');
    }).catch((err: Error) => {
      settle('failed');
      setSaveError(err.message ?? 'That rating could not be saved.');
    });

    // Record the result; `saved` fills in when the server replies.
    setSessionResults(prev => [...prev, { cardId: card.id, rating }]);

    // Slide animation by rating
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
  }, [isAnimating, isFinished, isFlipped, currentIndex, studyCards]);

  // Flip handler

  const handleFlip = useCallback(() => {
    if (isAnimating || isFinished) return;
    setIsFlipped(prev => !prev);
  }, [isAnimating, isFinished]);

  // Keyboard shortcuts

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

  // Derived stats

  const easyCount = sessionResults.filter(r => r.rating === 'easy').length;
  const mediumCount = sessionResults.filter(r => r.rating === 'medium').length;
  const hardCount = sessionResults.filter(r => r.rating === 'hard').length;
  // A session tally of self-ratings, labelled "Session Score"; not BKT mastery.
  const sessionScore =
    studyCards.length > 0
      ? Math.round(((easyCount + mediumCount * 0.5) / studyCards.length) * 100)
      : 0;
  // Nothing is claimed about the schedule until pendingCount reaches zero.
  const countedCount = sessionResults.filter(r => r.saved === 'counted').length;
  const unchangedCount = sessionResults.filter(r => r.saved === 'unchanged').length;
  const failedCount = sessionResults.filter(r => r.saved === 'failed').length;
  const pendingCount = sessionResults.filter(r => r.saved === undefined).length;

  // Results screen

  if (isFinished) {
    const circumference = 2 * Math.PI * 54;
    const strokeDashoffset = circumference - (sessionScore / 100) * circumference;

    const getGradeColor = () => {
      if (sessionScore >= 80) return 'text-emerald-400';
      if (sessionScore >= 50) return 'text-amber-400';
      return 'text-red-400';
    };
    const getGradeRingColor = () => {
      if (sessionScore >= 80) return 'stroke-emerald-400';
      if (sessionScore >= 50) return 'stroke-amber-400';
      return 'stroke-red-400';
    };
    const getGradeMessage = () => {
      if (sessionScore >= 90) return "Outstanding! You knew almost all of these.";
      if (sessionScore >= 75) return "Great work! Keep reviewing the harder ones.";
      if (sessionScore >= 50) return "Good progress! The hard ones come back tomorrow.";
      return "Keep going — spaced repetition will help!";
    };

    return (
      <div className="fade-in duration-500 flex flex-col items-center justify-center py-6 sm:py-10">
        <div className="w-full max-w-lg bg-surface-container-lowest rounded-3xl border border-white/5 p-6 sm:p-10 text-center relative overflow-hidden shadow-2xl shadow-black/30">
          <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10">
            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-6">
              <Trophy className={`w-8 h-8 ${getGradeColor()}`} />
            </div>

            <h2 className="font-display text-2xl font-bold text-white mb-1">Session Complete</h2>
            <p className="font-sans text-sm text-slate-400 mb-8">{deckTitle}</p>

            {/* Session score ring */}
            <div className="relative w-36 h-36 mx-auto mb-4">
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
                <span className={`font-display text-4xl font-bold ${getGradeColor()}`}>{sessionScore}%</span>
                <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Session Score</span>
              </div>
            </div>

            <p className="font-sans text-[11px] text-slate-600 mb-6 max-w-xs mx-auto leading-relaxed">
              How you rated yourself in this session — not your overall mastery of the subject.
            </p>

            <p className="font-sans text-sm text-slate-300 mb-8">{getGradeMessage()}</p>

            {/* Rating breakdown */}
            {/* Readable interval text and padding that steps up from small screens. */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-8">
              {/* Hard */}
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="font-display text-2xl font-bold text-red-400">{hardCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-red-400/70 font-semibold">Hard</p>
                <p className="font-sans text-[11px] text-slate-500 mt-0.5">1 day</p>
              </div>
              {/* Medium */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="font-display text-2xl font-bold text-amber-400">{mediumCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-amber-400/70 font-semibold">Medium</p>
                <p className="font-sans text-[11px] text-slate-500 mt-0.5">3 days</p>
              </div>
              {/* Easy */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span className="font-display text-2xl font-bold text-emerald-400">{easyCount}</span>
                </div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-emerald-400/70 font-semibold">Easy</p>
                <p className="font-sans text-[11px] text-slate-500 mt-0.5">7 days</p>
              </div>
            </div>

            {/* What the schedule did, from the server's replies, once all are in. */}
            <div className={`flex items-start gap-3 rounded-xl p-4 mb-8 text-left border ${
              pendingCount === 0 && countedCount > 0
                ? 'bg-primary-fixed-dim/5 border-primary-fixed-dim/15'
                : 'bg-white/5 border-white/10'
            }`}>
              {pendingCount > 0 ? (
                <Spinner className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" label="Saving your ratings" />
              ) : (
                <Calendar className={`w-4 h-4 shrink-0 mt-0.5 ${countedCount > 0 ? 'text-primary-fixed-dim' : 'text-slate-500'}`} />
              )}
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                {pendingCount > 0 ? (
                  'Saving your ratings…'
                ) : (
                  <>
                    {countedCount > 0 ? (
                      <>
                        <span className="text-slate-200 font-semibold">
                          {countedCount} card{countedCount === 1 ? '' : 's'} rescheduled.
                        </span>{' '}
                        Cards you found hard come back in 1 day, medium in 3, easy in 7.
                      </>
                    ) : (
                      <span className="text-slate-200 font-semibold">Nothing was rescheduled.</span>
                    )}
                    {/* In a due-only session, an uncounted card was reviewed in another tab first. */}
                    {unchangedCount > 0 && (
                      <>
                        {' '}
                        {countedCount > 0 ? `The other ${unchangedCount}` : unchangedCount === 1 ? 'This card' : `These ${unchangedCount}`}{' '}
                        had already been reviewed, so {unchangedCount === 1 ? 'its date is' : 'their dates are'} unchanged.
                      </>
                    )}
                    {failedCount > 0 && (
                      <span className="block mt-1 text-rose-300">
                        {failedCount} rating{failedCount === 1 ? '' : 's'} didn't save. Any card still
                        due will be waiting in the deck.
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>

            {/* One way out: no drill or restart (those cards aren't due any more). */}
            <button
              onClick={onExit}
              className="w-full px-5 py-3 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px] shadow-primary-fixed-dim/20 hover:shadow-[0_0_30px] shadow-primary-fixed-dim/35 transition-all flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Deck
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Study view

  const ratingOrder: EaseRating[] = ['hard', 'medium', 'easy'];

  return (
    <div className="fade-in duration-300 flex flex-col items-center">

      {/* Progress header */}
      <div className="w-full max-w-3xl mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={onExit}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> Exit
          </button>

          <span className="hidden md:block font-display text-sm text-slate-400 truncate min-w-0 px-4">
            {deckTitle}
          </span>

          <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
            {/* Visible on phones too: it's the session tally. */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="flex items-center gap-1 font-sans text-xs text-red-400">
                <AlertTriangle className="w-3 h-3" />
                {hardCount}
              </span>
              <span className="flex items-center gap-1 font-sans text-xs text-amber-400">
                <Clock className="w-3 h-3" />
                {mediumCount}
              </span>
              <span className="flex items-center gap-1 font-sans text-xs text-emerald-400">
                <Zap className="w-3 h-3" />
                {easyCount}
              </span>
            </div>
            <span className="font-sans text-xs text-slate-500 tabular-nums">
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

      {/* Flashcard */}
      <div className="w-full max-w-3xl mb-6">
        {/* role="button" and tabIndex, but no onKeyDown: Space is bound window-wide and would flip twice. */}
        <div
          role="button"
          tabIndex={0}
          data-tour="fc-card"
          aria-pressed={isFlipped}
          aria-label={
            isFlipped
              ? `${answerLabel} shown. Press Space to hide.`
              : `${promptLabel} shown. Press Space to reveal the ${answerLabel.toLowerCase()}.`
          }
          onClick={handleFlip}
          className={`relative w-full h-72 sm:h-80 md:h-[23rem] cursor-pointer select-none transition-all duration-350 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-background
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
              className="absolute inset-0 rounded-3xl border border-white/10 bg-surface-container-lowest flex flex-col shadow-2xl shadow-black/20 overflow-hidden"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="flex items-baseline justify-between gap-3 px-6 pt-5 shrink-0">
                <span className="font-sans text-[10px] uppercase tracking-widest text-slate-600 font-bold">
                  {promptLabel}
                </span>
                {currentCard.source && (
                  <span className="font-sans text-[10px] text-slate-700 truncate min-w-0">
                    {currentCard.source}
                  </span>
                )}
              </div>
              {/* Scrolls rather than clipping. my-auto on the text, not items-center (see the back face). */}
              <div
                ref={frontScrollRef}
                className="flex-1 overflow-y-auto px-6 md:px-12 py-4 flex flex-col"
                style={frontOverflows ? FADE_MASK : undefined}
              >
                {/* Font and colour stay with the face; size and alignment follow the text. */}
                <p className={`my-auto font-display text-on-surface ${faceTypeClass(promptText, promptKind)}`}>
                  {promptText}
                </p>
              </div>
              <div className="shrink-0 pb-5 flex justify-center">
                <span className="text-[10px] uppercase tracking-widest text-slate-600 flex items-center gap-1.5 font-semibold animate-pulse">
                  <span className="hidden sm:inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px]">Space</span>
                  Tap to reveal
                </span>
              </div>
            </div>

            {/* Back face. Opaque background-color with the cyan as a background-image over it; keep the gradient direction. */}
            <div
              className="absolute inset-0 rounded-3xl border border-primary-fixed-dim/20 bg-surface-container-lowest bg-gradient-to-br from-primary-fixed-dim/[0.02] to-primary-fixed-dim/[0.08] flex flex-col shadow-2xl shadow-primary-fixed-dim/5 overflow-hidden"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="flex items-baseline justify-between gap-3 px-6 pt-5 shrink-0">
                <span className="font-sans text-[10px] uppercase tracking-widest text-primary-fixed-dim/50 font-bold">
                  {answerLabel}
                </span>
                {currentCard.source && (
                  <span className="font-sans text-[10px] text-slate-700 truncate min-w-0">
                    {currentCard.source}
                  </span>
                )}
              </div>
              {/* The definition can be long, so this scrolls. my-auto, never items-center: a centred overflowing item spills past the top, out of scroll reach. */}
              <div
                ref={backScrollRef}
                className="flex-1 overflow-y-auto px-6 md:px-12 py-4 flex flex-col"
                style={backOverflows ? FADE_MASK : undefined}
              >
                <p className={`my-auto font-sans text-primary-fixed font-medium ${faceTypeClass(answerText, answerKind)}`}>
                  {answerText}
                </p>
              </div>
              <div className="shrink-0 pb-5 flex justify-center items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-slate-600" />
                <span className="font-sans text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
                  How well did you know this?
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rating buttons: always rendered, disabled until flipped, so the layout never jumps. */}
      <div className="w-full max-w-3xl">
        <p className="text-center font-sans text-xs text-slate-500 uppercase tracking-widest mb-4 font-semibold transition-colors">
          {isFlipped ? 'Rate your recall' : 'Flip the card to rate it'}
        </p>

        <div data-tour="fc-rating" className={`grid grid-cols-3 gap-2 sm:gap-3 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-40'}`}>
          {ratingOrder.map((rating) => {
            const cfg = RATING_CONFIG[rating];
            const isSelected = selectedRating === rating;
            return (
              <button
                key={rating}
                onClick={() => handleRate(rating)}
                disabled={!isFlipped || isAnimating}
                aria-label={`${cfg.label} — ${cfg.sublabel}`}
                className={`
                  group relative flex flex-col items-center justify-center gap-1.5 sm:gap-2 px-2 py-3.5 sm:p-4 rounded-2xl border
                  transition-all duration-200 disabled:cursor-not-allowed
                  ${cfg.containerClass} ${cfg.borderClass} ${isFlipped ? cfg.hoverClass : ''}
                  ${isSelected ? `scale-95 shadow-lg ${cfg.glowClass}` : isFlipped ? 'hover:scale-[1.03]' : ''}
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
                  <p className="hidden sm:block font-sans text-[10px] text-slate-600 mt-0.5">
                    {cfg.sublabel}
                  </p>
                </div>

                {/* Keyboard hint */}
                <span className="hidden sm:block absolute top-2 right-2 w-5 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">
                  {cfg.kbd}
                </span>
              </button>
            );
          })}
        </div>

        {/* Keyboard hints, laptop only. */}
        <div className="hidden sm:flex items-center justify-center gap-6 mt-4">
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">Space</span>
            <span className="font-sans text-[10px] text-slate-600">Flip</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px] text-slate-600">1 / 2 / 3</span>
            <span className="font-sans text-[10px] text-slate-600">Rate</span>
          </div>
        </div>
      </div>

      {/* Saving indicator */}
      {isSaving && !saveError && (
        /* The shared Spinner. */
        <div className="mt-4 flex items-center gap-2 text-slate-600">
          <Spinner className="w-3 h-3" label="Saving your rating" />
          <span className="font-sans text-[10px] uppercase tracking-widest">Saving...</span>
        </div>
      )}

      {/* A rating that didn't reach the server. The session continues. */}
      {saveError && (
        <div className="mt-4 w-full max-w-3xl flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 fade-in duration-200">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="font-sans text-xs text-rose-300 leading-relaxed">
            That rating wasn't saved, so this card's next review date didn't change. You can keep
            studying — rate it again later to reschedule it.
            <span className="block text-rose-400/60 mt-1">{saveError}</span>
          </p>
        </div>
      )}
    </div>
  );
}
