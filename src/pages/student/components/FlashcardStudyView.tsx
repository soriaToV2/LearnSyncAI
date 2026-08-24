import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { RotateCcw, Trophy, ArrowLeft, Zap, Clock, AlertTriangle, Brain, Calendar, CheckCircle2 } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { api } from '../../../lib/api';
import { useBadges } from '../../../context/BadgeContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Flashcard {
  id: number | string;
  front: string;
  back: string;
  /** Material this card came from, shown as a quiet label. */
  source?: string;
}

type EaseRating = 'easy' | 'medium' | 'hard';

interface CardSession {
  cardId: number | string;
  rating: EaseRating;
  /** Whether the server actually rescheduled it — false when it wasn't due. */
  counted?: boolean;
}

interface FlashcardStudyViewProps {
  cards: Flashcard[];
  deckTitle: string;
  onExit: () => void;
  /**
   * A round the student chose to run over cards that are not due — "Practice
   * all", or re-drilling cards they just rated. Ratings are still sent (a
   * practice round can contain genuinely due cards, and those must schedule),
   * but the UI says up front that most of them will not count.
   */
  isPractice?: boolean;
}

// ─── Spaced Repetition Config ─────────────────────────────────────────────────
// Leitner tiers, matching REVIEW_INTERVALS in server/lib/reviewSchedule.ts and
// the interval_days CHECK constraint. Easy = 7, Medium = 3, Hard = 1.

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

// ─── Card face typography ─────────────────────────────────────────────────────

/**
 * Type size and alignment for a card face, derived from how much text it holds.
 *
 * The back is the educator's stored definition VERBATIM — never truncated,
 * never summarised — so the card has to adapt to the text rather than the
 * reverse. Measured over the concepts table: 162-character median and a 267
 * p90, but a term the document explains on two pages folds into one row and
 * reaches 643. One fixed size cannot serve both ends of that range. On the
 * current data 44 of 57 definitions land in the middle band and render exactly
 * as they did before; 6 short ones gain a size and 7 long ones lose one.
 *
 * Alignment flips independently of size and matters just as much. Centred text
 * is comfortable for two or three lines and hard to read past that, because
 * every line starts at a different x-position — and the longest definitions run
 * to fifteen lines on a phone.
 *
 * The two faces need different curves, which is why `kind` exists rather than
 * one shared table. A back is a passage; a FRONT is a prompt — a term (23
 * characters on average, 96 at the longest) or a one-sentence generated
 * question. Running the front down the back's curve would shrink a perfectly
 * ordinary question to passage size in a card with room to spare.
 */
function faceTypeClass(text: string, kind: 'front' | 'back'): string {
  const len = text.length;

  if (kind === 'front') {
    if (len <= 260) return 'text-xl md:text-2xl leading-relaxed text-center';
    if (len <= 420) return 'text-lg md:text-xl leading-relaxed text-center';
    return 'text-base md:text-lg leading-relaxed text-left';
  }

  if (len <= 120) return 'text-xl md:text-2xl leading-relaxed text-center';
  if (len <= 260) return 'text-base md:text-lg leading-relaxed text-center';
  if (len <= 420) return 'text-sm md:text-base leading-relaxed text-left';
  return 'text-sm leading-snug text-left';
}

/** Softens the bottom edge so text visibly runs on rather than stopping dead. */
const FADE_MASK: React.CSSProperties = {
  maskImage: 'linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 2.5rem), transparent)',
};

/**
 * Tracks whether a scrolling box still has content below its bottom edge, so a
 * face can fade its lower margin only while that is true.
 *
 * Measured rather than inferred from text length: whether a definition
 * overflows depends on viewport width and on the size faceTypeClass() picked,
 * so the same 300 characters fit on a laptop and overflow on a phone. A length
 * threshold would fade text that is entirely visible.
 *
 * It also has to follow scrolling, not just overflow. A fade that stayed on
 * once the student reached the end would wash out the last line of the answer —
 * the one part of a long definition they had to work to reach.
 *
 * `content` re-runs the effect when the card changes, which is also where the
 * box is scrolled back to the top: the DOM node is reused between cards, so
 * without that a long answer followed by another long answer would open
 * halfway down.
 */
function useMoreBelow(content: string): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 1px of slack — sub-pixel line heights leave a fractional remainder on
    // text that visually fits exactly.
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlashcardStudyView({
  cards,
  deckTitle,
  onExit,
  isPractice = false,
}: FlashcardStudyViewProps) {
  const { celebrate } = useBadges();
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

  /*
   * Badge check, at the END of the session rather than per rating.
   *
   * Two reasons. The rating POST is deliberately un-awaited, so a per-card check
   * would open a modal over whatever card the student had already moved on to.
   * And a thirty-card session would fire thirty requests to answer a question
   * that only changes at the end.
   *
   * On `isFinished` rather than at the `setIsFinished(true)` call site, so
   * "Restart Entire Set" correctly re-arms it for the next run.
   */
  useEffect(() => {
    if (isFinished) celebrate();
  }, [isFinished, celebrate]);
  // A rating the server refused. Shown to the student rather than swallowed —
  // silently dropping it would leave them believing the card was scheduled.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Starts from the prop, but a retry round turns it on: those cards were rated
  // moments ago, so they are no longer due and can no longer count.
  const [practiceRound, setPracticeRound] = useState(isPractice);

  // The card on screen. Hoisted above the results-screen return further down so
  // the face hooks below can read it — a hook cannot run after an early return.
  const currentCard = studyCards[currentIndex];

  // Each face fades its bottom edge while it still has text below the fold.
  const [frontScrollRef, frontOverflows] = useMoreBelow(currentCard?.front ?? '');
  const [backScrollRef, backOverflows] = useMoreBelow(currentCard?.back ?? '');

  // ── Rating handler ──────────────────────────────────────────────────────────

  const handleRate = useCallback(async (rating: EaseRating) => {
    if (isAnimating || isFinished || !isFlipped) return;

    setIsAnimating(true);
    setSelectedRating(rating);
    setIsSaving(true);
    setSaveError(null);

    const card = studyCards[currentIndex];

    // Every rating is posted, even in a practice round — a practice session can
    // still contain genuinely due cards, and those must be scheduled. The server
    // owns the decision and answers `counted`; the client only reports it.
    //
    // Not awaited — the card advances immediately either way, so a slow network
    // never stalls the session. The student is told if it did not save.
    api.post<{ counted: boolean }>('/flashcards/rate', {
      flashcard_id: card.id,
      rating,
    }).then(res => {
      if (res.data?.counted) {
        setSessionResults(prev =>
          prev.map(r => (r.cardId === card.id && r.counted === undefined ? { ...r, counted: true } : r))
        );
      }
    }).catch((err: Error) => {
      setSaveError(err.message ?? 'That rating could not be saved.');
    });

    // Record session result. `counted` is filled in when the server replies.
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
  }, [isAnimating, isFinished, isFlipped, currentIndex, studyCards]);

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
    setSaveError(null);
    // These cards were rated seconds ago, so they are no longer due. Say so
    // rather than letting the student believe a second pass moves anything.
    setPracticeRound(true);
  };

  const handleRestartAll = () => {
    setStudyCards(cards);
    setSessionResults([]);
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsFinished(false);
    setSaveError(null);
    setPracticeRound(true);
  };

  // ── Derived stats ───────────────────────────────────────────────────────────

  const easyCount = sessionResults.filter(r => r.rating === 'easy').length;
  const mediumCount = sessionResults.filter(r => r.rating === 'medium').length;
  const hardCount = sessionResults.filter(r => r.rating === 'hard').length;
  // How this session went — NOT BKT mastery. BKT mastery is a per-concept
  // probability owned by the backend; this is a tally of self-ratings, so it is
  // labelled "Session Score" wherever it appears.
  const sessionScore =
    studyCards.length > 0
      ? Math.round(((easyCount + mediumCount * 0.5) / studyCards.length) * 100)
      : 0;
  // How many ratings the server actually acted on. Anything else was a card
  // that was not due — reviewed, but not rescheduled.
  const countedCount = sessionResults.filter(r => r.counted).length;

  // ════════════════════════════════════════════════════════════════════════════
  // RESULTS SCREEN
  // ════════════════════════════════════════════════════════════════════════════

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
      if (sessionScore >= 50) return "Good progress! Focus on the hard cards.";
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
            {/* `text-[9px]` on the interval line was unreadable, and at three
                columns on a 320px phone `p-4` left the numbers touching their
                borders. Padding steps up instead of starting large. */}
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

            {/* What the schedule actually did. Claiming reviews were scheduled
                unconditionally was false after a practice round. */}
            <div className={`flex items-start gap-3 rounded-xl p-4 mb-8 text-left border ${
              countedCount > 0
                ? 'bg-primary-fixed-dim/5 border-primary-fixed-dim/15'
                : 'bg-white/5 border-white/10'
            }`}>
              <Calendar className={`w-4 h-4 shrink-0 mt-0.5 ${countedCount > 0 ? 'text-primary-fixed-dim' : 'text-slate-500'}`} />
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                {countedCount > 0 ? (
                  <>
                    <span className="text-slate-200 font-semibold">
                      {countedCount} card{countedCount === 1 ? '' : 's'} rescheduled.
                    </span>{' '}
                    Cards you found hard come back in 1 day, medium in 3, easy in 7.
                    {countedCount < sessionResults.length && (
                      <> The other {sessionResults.length - countedCount} weren't due yet, so their dates are unchanged.</>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-slate-200 font-semibold">Nothing was rescheduled.</span>{' '}
                    These cards weren't due yet, so this was practice — your review dates are unchanged.
                  </>
                )}
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

  const ratingOrder: EaseRating[] = ['hard', 'medium', 'easy'];

  return (
    <div className="fade-in duration-300 flex flex-col items-center">

      {/* Said up front, not discovered at the end: these cards are not due, so
          rating them is for the student's own benefit and nothing else. */}
      {practiceRound && (
        <div className="w-full max-w-3xl mb-4 flex items-start gap-2.5 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10">
          <Brain className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-semibold">Practice round.</span>{' '}
            These cards aren't due yet, so your ratings won't change their review dates.
          </p>
        </div>
      )}

      {/* ── Progress header ─────────────────────────────────────────── */}
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
            {/*
              * Visible on phones now. It was `hidden sm:flex`, and since the deck
              * title is `hidden md:block`, a phone was left with nothing in this
              * row but "3 / 12" — the running tally of how the session is actually
              * going disappeared on the smallest screen, which is where the card
              * itself already shows the least context. Three icon+number pairs
              * cost ~90px, which fits beside Exit and the counter at 375px.
              */}
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

      {/* ── Flashcard ───────────────────────────────────────────────── */}
      <div className="w-full max-w-3xl mb-6">
        {/*
          * `role="button"` + `tabIndex` give the card a focus stop and screen-reader
          * semantics it had none of — but deliberately NO `onKeyDown`. Space is
          * already bound window-wide in the effect above, so a key handler here
          * would fire alongside it and flip the card twice, i.e. not at all. Enter
          * is therefore unbound on purpose; Space is the documented shortcut and it
          * works whether or not this element holds focus.
          */}
        <div
          role="button"
          tabIndex={0}
          aria-pressed={isFlipped}
          aria-label={isFlipped ? 'Answer shown. Press Space to hide.' : 'Question shown. Press Space to reveal the answer.'}
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
                  Question
                </span>
                {currentCard.source && (
                  <span className="font-sans text-[10px] text-slate-700 truncate min-w-0">
                    {currentCard.source}
                  </span>
                )}
              </div>
              {/* Scrolls rather than clipping — some definitions run long.
                  `my-auto` on the text, NOT `items-center` here: see the back
                  face below for why that distinction is the whole fix. */}
              <div
                ref={frontScrollRef}
                className="flex-1 overflow-y-auto px-6 md:px-12 py-4 flex flex-col"
                style={frontOverflows ? FADE_MASK : undefined}
              >
                <p className={`my-auto font-display text-on-surface ${faceTypeClass(currentCard.front, 'front')}`}>
                  {currentCard.front}
                </p>
              </div>
              <div className="shrink-0 pb-5 flex justify-center">
                <span className="text-[10px] uppercase tracking-widest text-slate-600 flex items-center gap-1.5 font-semibold animate-pulse">
                  <span className="hidden sm:inline-block px-2 h-5 rounded bg-white/5 border border-white/10 text-center leading-5 font-mono text-[9px]">Space</span>
                  Tap to reveal
                </span>
              </div>
            </div>

            {/* Back face.

                ⚠️ SAME FIX AS THE DECK-GRID CARD, DIFFERENT SHAPE OF THE SAME
                BUG. This was `bg-gradient-to-br from-surface-container-lowest
                to-primary-fixed-dim/5`: opaque at the top-left corner and 95%
                TRANSPARENT at the bottom-right, so the answer card faded into
                the page across its own diagonal. Now the surface is an opaque
                `background-color` and the cyan is a `background-image` over it,
                which keeps the original look and stops the card disappearing.
                Keep the gradient's direction — the tint deepening toward the
                bottom-right is what distinguishes this face from the front. */}
            <div
              className="absolute inset-0 rounded-3xl border border-primary-fixed-dim/20 bg-surface-container-lowest bg-gradient-to-br from-primary-fixed-dim/[0.02] to-primary-fixed-dim/[0.08] flex flex-col shadow-2xl shadow-primary-fixed-dim/5 overflow-hidden"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="flex items-baseline justify-between gap-3 px-6 pt-5 shrink-0">
                <span className="font-sans text-[10px] uppercase tracking-widest text-primary-fixed-dim/50 font-bold">
                  Answer
                </span>
                {currentCard.source && (
                  <span className="font-sans text-[10px] text-slate-700 truncate min-w-0">
                    {currentCard.source}
                  </span>
                )}
              </div>
              {/* The answer is the educator's definition verbatim and can run to
                  ~800 characters, so this face has to scroll.

                  `my-auto` on the text rather than `items-center` here is not a
                  style preference — it is the fix for a real bug. A CENTRED flex
                  item taller than its container overflows both edges, and the
                  overflow past the TOP is outside the scrollable region, so no
                  scrolling reaches it. Long answers silently began mid-sentence
                  with the scrollbar already at its top. An auto margin centres
                  identically when there is room and collapses to 0 when there is
                  not, clipping nothing. Do not put `items-center` back. */}
              <div
                ref={backScrollRef}
                className="flex-1 overflow-y-auto px-6 md:px-12 py-4 flex flex-col"
                style={backOverflows ? FADE_MASK : undefined}
              >
                <p className={`my-auto font-sans text-primary-fixed font-medium ${faceTypeClass(currentCard.back, 'back')}`}>
                  {currentCard.back}
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

      {/* ── Rating buttons ──────────────────────────────────────────────
          Always rendered, disabled until the card is flipped. Swapping them in
          on flip made the whole page jump on every single card. */}
      <div className="w-full max-w-3xl">
        <p className="text-center font-sans text-xs text-slate-500 uppercase tracking-widest mb-4 font-semibold transition-colors">
          {isFlipped ? 'Rate your recall' : 'Flip the card to rate it'}
        </p>

        <div className={`grid grid-cols-3 gap-2 sm:gap-3 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-40'}`}>
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

        {/* Keyboard hints — laptop only, there is no keyboard on a phone. */}
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
        /* Was a hand-rolled `border-t-transparent` ring — the app's THIRD
           spinner design, on a screen a student sees on every card. See
           `components/ui/Spinner.tsx`. */
        <div className="mt-4 flex items-center gap-2 text-slate-600">
          <Spinner className="w-3 h-3" label="Saving your rating" />
          <span className="font-sans text-[10px] uppercase tracking-widest">Saving...</span>
        </div>
      )}

      {/* A rating that did not reach the server. The session continues — losing
          one schedule update must not cost the student their place. */}
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
