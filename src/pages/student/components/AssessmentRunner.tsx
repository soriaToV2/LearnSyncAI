import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Flag,
  LayoutGrid,
  AlertTriangle
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import Modal from '../../../components/ui/Modal';
import { LABEL } from '../../../components/ui/surfaces';
import {
  assessmentApi,
  PHASE_LABEL,
  type AssessmentItem,
  type AssessmentPhase,
  type AssessmentResult,
} from '../../../lib/assessments';

/**
 * Sitting one pre-test or post-test — TEMPORARY research instrument.
 *
 * ⚠️ DELIBERATELY NOT `TestSessionView`, but deliberately SHAPED LIKE IT. That
 * component is 879 lines covering five question formats, matching blocks and
 * section navigation, and it calls `testApi.saveAnswer`/`testApi.complete`
 * directly rather than through props — so reusing it would mean threading an api
 * adapter through the verified adaptive-test path for a screen that renders
 * twenty multiple-choice questions. This feature is removed after the study; a
 * self-contained file deletes in one pass and cannot regress Test Mode.
 *
 * ⚠️ IT RENDERS IN FLOW, NOT AS A `fixed inset-0` TAKEOVER. The first version did
 * the latter and the study-space header won the z-order fight: the runner's own
 * header vanished and the question was clipped at the top of the scroll box with
 * no way to reach it. `TestSessionView` sits inside `<main>` for exactly this
 * reason, and the tab bar staying visible is correct anyway — a student sitting a
 * pre-test should still be able to see where they are.
 *
 * What it shares with Test Mode beyond layout: answers are the option TEXT,
 * latency accumulates per question, a save failure is a strip and never a block,
 * and the server owns correctness.
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface AssessmentRunnerProps {
  attemptId: string;
  phase: AssessmentPhase;
  materialTitle: string;
  items: AssessmentItem[];
  initialAnswers: Record<string, string>;
  onFinished: (result: AssessmentResult) => void;
  onExit: () => void;
}

export default function AssessmentRunner({
  attemptId,
  phase,
  materialTitle,
  items,
  initialAnswers,
  onFinished,
  onExit,
}: AssessmentRunnerProps) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const seeded: Record<number, string> = {};
    for (const [k, v] of Object.entries(initialAnswers)) seeded[Number(k)] = v;
    return seeded;
  });
  const [isFinishing, setIsFinishing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  /** Time spent on the question currently on screen. Reset on every move. */
  const enteredAt = useRef(Date.now());
  /** Synchronous latch — `isFinishing` is state and does not re-render before the
   *  handler yields, so a double-click would otherwise submit twice. */
  const inFlight = useRef(false);

  const item = items[current];
  const answered = Object.keys(answers).length;
  const unanswered = items.length - answered;

  /*
   * ⚠️ ACCIDENTAL-SKIP SAFETY NET — this is a measurement instrument, and RQ4
   * subtracts the pre-test score from the post-test score, so a question lost to
   * a stray tap is not a cosmetic problem: unanswered counts as wrong, which
   * pushes the baseline DOWN and inflates the apparent gain.
   *
   * `skipped` counts only questions the student has already moved PAST without
   * answering — not merely unanswered ones. That distinction is what makes it
   * usable as a persistent indicator: `unanswered` starts at 20 and would scream
   * on question one, whereas `skipped` is 0 until something is genuinely left
   * behind.
   *
   * It informs and offers a one-tap return. It must NEVER gate `Next` — that rule
   * is deliberate and documented below: blocking advance traps a student who
   * cannot answer, and a trapped student loses the whole sitting rather than one
   * item.
   */
  const skipped = useMemo(
    () => items.filter((q, i) => i < current && !answers[q.index]).length,
    [items, answers, current]
  );

  /** First unanswered question, for the jump-back controls. -1 when none. */
  const firstUnanswered = useMemo(
    () => items.findIndex((q) => !answers[q.index]),
    [items, answers]
  );

  useEffect(() => {
    enteredAt.current = Date.now();
  }, [current]);

  const choose = useCallback(
    (option: string) => {
      if (isFinishing || !item) return;
      setAnswers((prev) => ({ ...prev, [item.index]: option }));

      const latency = Math.max(0, Date.now() - enteredAt.current);
      enteredAt.current = Date.now();

      // Fire-and-forget: a slow network must never stall the student mid-test. The
      // strip below reports failures, and completion re-grades from whatever the
      // server holds, so a lost save costs one answer rather than the sitting.
      void assessmentApi
        .saveAnswer(attemptId, item.index, option, latency)
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    },
    [attemptId, isFinishing, item]
  );

  const goTo = useCallback(
    (next: number) => setCurrent(Math.min(items.length - 1, Math.max(0, next))),
    [items.length]
  );

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsFinishing(true);
    setShowConfirm(false);
    try {
      const { result } = await assessmentApi.complete(attemptId);
      onFinished(result);
    } catch (err) {
      setIsFinishing(false);
      inFlight.current = false;
      setSaveError(true);
      console.error('[Assessment] submit failed', err);
    }
  };

  // A–D to answer, arrows to move. Matches Test Mode's shortcuts so the two
  // screens do not teach different habits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showNav || showExit || showConfirm || isFinishing || !item) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (e.key === 'ArrowRight') { goTo(current + 1); return; }
      if (e.key === 'ArrowLeft') { goTo(current - 1); return; }

      const letter = LETTERS.indexOf(e.key.toUpperCase());
      const digit = Number(e.key) - 1;
      const pick = letter >= 0 ? letter : Number.isInteger(digit) ? digit : -1;
      if (pick >= 0 && pick < item.options.length) choose(item.options[pick]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, item, choose, goTo, showNav, showExit, showConfirm, isFinishing]);

  const nav = useMemo(
    () => (
      <AssessmentNav items={items} answers={answers} current={current} onJump={goTo} />
    ),
    [items, answers, current, goTo]
  );

  if (!item) return null;

  return (
    <div className="fade-in duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8 lg:items-start">
      <div className="flex flex-col items-center min-w-0">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="w-full max-w-3xl mb-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <button
              onClick={() => setShowExit(true)}
              className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest shrink-0"
            >
              <ArrowLeft className="w-4 h-4" /> Exit
            </button>

            <span className="font-display text-xs sm:text-sm text-slate-400 truncate min-w-0 px-2 text-center">
              <span className="text-primary-fixed-dim">{PHASE_LABEL[phase]}</span>
              <span className="hidden sm:inline"> · Multiple Choice</span>
            </span>

            <div className="flex items-center gap-1.5 shrink-0">
              {/*
                * The skip signal, and it is a BUTTON rather than a label — one tap
                * returns to the first question left behind. Appears on every
                * question, at every width, because the two existing signals both
                * failed on a phone: the unanswered warning showed only on the
                * FINAL question, and the progress bar encodes answered state as
                * `bg-primary-fixed-dim/40` against `bg-white/10`, which is
                * indistinguishable across twenty ~15px segments.
                *
                * Amber, not rose: leaving a question is recoverable and not an
                * error. Icon plus a bare number so it stays ~48px and does not
                * squeeze the phase label on a 320px screen.
                */}
              {skipped > 0 && firstUnanswered >= 0 && (
                <button
                  onClick={() => goTo(firstUnanswered)}
                  title={`${skipped} question${skipped === 1 ? '' : 's'} skipped — go back to the first one`}
                  aria-label={`${skipped} question${skipped === 1 ? '' : 's'} skipped. Go back to the first unanswered question.`}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-colors font-sans text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {skipped}
                </button>
              )}

              {/* Below lg the counter IS the way into the navigator; the rail
                  replaces it above lg, so there is never both. */}
              <button
                onClick={() => setShowNav(true)}
                className="lg:hidden flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 transition-colors font-sans text-xs text-slate-400 tabular-nums"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                {current + 1}/{items.length}
              </button>
              <span className="hidden lg:inline font-sans text-xs text-slate-500 tabular-nums shrink-0">
                {current + 1}/{items.length}
              </span>
            </div>
          </div>

          {/* One segment per question. Neutral by design — colouring by
              correctness would leak grading into the middle of the test, which on
              a pre-test would also leak the post-test's answers. */}
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex gap-0.5">
            {items.map((q, i) => (
              <div
                key={q.index}
                className={`flex-1 h-full rounded-full transition-colors duration-300 ${
                  i === current
                    ? 'bg-primary-fixed-dim'
                    : answers[q.index]
                      ? 'bg-primary-fixed-dim/40'
                      : 'bg-white/10'
                }`}
              />
            ))}
          </div>

          {materialTitle && (
            <div className="flex items-center gap-2 mt-3 min-w-0">
              <BookOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className={`${LABEL} truncate`} title={materialTitle}>{materialTitle}</span>
            </div>
          )}
        </div>

        {/* ── Question ────────────────────────────────────────────────────── */}
        <div className="w-full max-w-3xl">
          <div
            key={current}
            className="bg-surface-container-lowest rounded-3xl border border-white/10 p-5 sm:p-8 min-h-[20rem] fade-in duration-200"
          >
            <p className="font-display text-lg sm:text-xl text-white leading-relaxed mb-6">
              {item.prompt}
            </p>

            <div className="space-y-2.5">
              {item.options.map((option, i) => {
                const selected = answers[item.index] === option;
                return (
                  <button
                    key={option}
                    onClick={() => choose(option)}
                    disabled={isFinishing}
                    className={`w-full flex items-start gap-3 text-left p-3.5 rounded-xl border transition-all disabled:opacity-60 ${
                      selected
                        ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/60'
                        : 'bg-surface-container/30 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center font-display text-xs font-bold ${
                        selected ? 'bg-primary-fixed-dim text-black' : 'bg-white/5 text-slate-400'
                      }`}
                    >
                      {LETTERS[i]}
                    </span>
                    <span
                      className={`font-sans text-sm leading-relaxed ${selected ? 'text-white' : 'text-slate-300'}`}
                    >
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {saveError && (
            <div className="mt-3 flex items-start gap-2.5 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-rose-200 leading-relaxed">
                Couldn't save that answer just now. It's still recorded here and will be sent again
                when you finish — keep going.
              </p>
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 mt-5">
            <button
              onClick={() => goTo(current - 1)}
              disabled={current === 0}
              className="px-4 sm:px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Previous
            </button>

            {current < items.length - 1 ? (
              <button
                onClick={() => goTo(current + 1)}
                className="px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all flex items-center gap-2"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setShowConfirm(true)}
                disabled={isFinishing}
                className="px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isFinishing ? (
                  <><Spinner className="w-4 h-4" /> Checking…</>
                ) : (
                  <>
                    <Flag className="w-4 h-4" />
                    {/* "Previous" + "Finish & See Results" measures ~337px, which
                        overflows a 320px phone once the card's own padding is
                        taken — and 320px devices are realistic in the study
                        cohort. The label shortens rather than the row wrapping,
                        because a submit control that moves position between
                        devices is worse than one with a shorter name. */}
                    <span className="sm:hidden">Finish</span>
                    <span className="hidden sm:inline">Finish &amp; See Results</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Skipping is allowed on purpose — blocking Next means a stuck student
              can never reach the end. An unanswered item is simply wrong. */}
          {/* Actionable, not just informative. It named a problem the student had
              no control to act on — the navigator that fixes it is behind a modal
              on mobile, which you have to know to open. */}
          {current === items.length - 1 && unanswered > 0 && !isFinishing && firstUnanswered >= 0 && (
            <button
              onClick={() => goTo(firstUnanswered)}
              className="mt-2 w-full flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left hover:bg-amber-500/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="font-sans text-xs text-amber-200 leading-relaxed">
                {unanswered} question{unanswered === 1 ? '' : 's'} still unanswered, and unanswered
                questions are marked wrong.{' '}
                <span className="font-semibold underline">Go to the first one</span>
              </span>
            </button>
          )}

          <p className="hidden sm:block font-sans text-[11px] text-slate-600 text-center mt-6">
            Press A–D to choose · ← → to move between questions
          </p>
        </div>
      </div>

      {/* ── Navigator, desktop ──────────────────────────────────────────── */}
      {/* ⚠️ `9rem` is a BOUND, not a measurement — see the long note on the same
          literal in `TestSessionView.tsx`. Kept as a duplicate on purpose: this
          file is the temporary pre/post instrument and must delete without
          reaching into Test Mode. Erring large is free; `max-h` only caps. */}
      <aside className="hidden lg:block sticky top-0 max-h-[calc(100vh-9rem)] overflow-y-auto no-scrollbar">
        {nav}
      </aside>

      <Modal isOpen={showNav} onClose={() => setShowNav(false)} title="Jump to a question" maxWidth="max-w-md">
        {nav}
      </Modal>

      {/* Leaving is safe — answers save as they are chosen and the attempt
          resumes — so the copy says so rather than threatening data loss. What it
          must NOT hide is that the lesson stays locked meanwhile. */}
      <Modal isOpen={showExit} onClose={() => setShowExit(false)} title="Leave this test?" maxWidth="max-w-sm">
        <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
          Your answers so far are saved and you can carry on from where you left off. The lesson stays
          locked until you finish and submit.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowExit(false)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-container border border-white/10 text-on-surface font-sans text-sm font-semibold hover:bg-surface-container-high transition-colors"
          >
            Keep going
          </button>
          <button
            onClick={onExit}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-black font-sans text-sm font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface transition-colors"
          >
            Leave
          </button>
        </div>
      </Modal>

      {/* Test Mode finishes without confirming, and this one does not — the
          asymmetry is real: an adaptive test can be regenerated whenever you like,
          whereas UNIQUE (assessment_id, student_id, phase) means this is the only
          sitting the student will ever get. */}
      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Submit your answers?" maxWidth="max-w-sm">
        <p className="font-sans text-sm text-slate-400 leading-relaxed mb-2">
          {unanswered === 0
            ? `You have answered all ${items.length} questions.`
            : `${unanswered} question${unanswered === 1 ? ' is' : 's are'} still unanswered, and unanswered questions are marked wrong.`}
        </p>
        <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
          You can only take this test once, so you will not be able to change your answers afterwards.
        </p>
        {/*
          * Still two buttons, but the left one now DOES something when it matters.
          * "Keep working" only closed the dialog, dropping the student back on the
          * last question — the furthest possible point from the one they skipped,
          * with the navigator behind another modal. When anything is unanswered it
          * becomes "Answer them" and jumps to the first.
          *
          * Stacks below `sm`: three lines of copy plus two buttons is tight in a
          * `max-w-sm` dialog on a 320px screen, and Submit is irreversible here —
          * `UNIQUE (assessment_id, student_id, phase)` means one sitting only.
          */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              setShowConfirm(false);
              if (unanswered > 0 && firstUnanswered >= 0) goTo(firstUnanswered);
            }}
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-container border border-white/10 text-on-surface font-sans text-sm font-semibold hover:bg-surface-container-high transition-colors"
          >
            {unanswered > 0 ? 'Answer them' : 'Keep working'}
          </button>
          <button
            onClick={() => void submit()}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-black font-sans text-sm font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface transition-colors"
          >
            Submit
          </button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Jump to any question.
 *
 * Rendered twice from one definition — as a rail on `lg:` and inside a `Modal`
 * below it — so the two can never drift. Mirrors `QuestionNav` in
 * `TestSessionView`, minus the per-format grouping: every item here is multiple
 * choice, so there are no sections to group by.
 */
function AssessmentNav({
  items,
  answers,
  current,
  onJump,
}: {
  items: AssessmentItem[];
  answers: Record<number, string>;
  current: number;
  onJump: (index: number) => void;
}) {
  const unanswered = items.filter((q) => !answers[q.index]).length;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          <span className="text-primary-fixed-dim">All questions</span>
        </p>
        <div className="grid grid-cols-6 lg:grid-cols-5 gap-1.5">
          {items.map((q, i) => {
            const isCurrent = i === current;
            const isAnswered = Boolean(answers[q.index]);
            return (
              <button
                key={q.index}
                onClick={() => onJump(i)}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Question ${i + 1}${isAnswered ? ', answered' : ', not answered'}`}
                className={`h-8 rounded-lg font-display text-xs font-bold tabular-nums transition-all ${
                  isCurrent
                    ? 'bg-primary-fixed-dim text-black'
                    : isAnswered
                      ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim border border-primary-fixed-dim/40'
                      : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-white'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <p className="font-sans text-xs text-slate-500 pt-1 border-t border-white/5">
        {unanswered === 0 ? 'Every question answered.' : `${unanswered} left to answer.`}
      </p>
    </div>
  );
}
