import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Flag,
  LayoutGrid,
  RefreshCw,
  X,
} from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { LABEL } from '../../../components/ui/surfaces';
import {
  FORMAT_META,
  buildScreens,
  screenFormat,
  screenIndices,
  sectionLabel,
  splitBlank,
  testApi,
  type ChoiceQuestion,
  type GeneratedTest,
  type MatchingQuestion,
  type QuestionFormat,
  type TestQuestion,
  type TestResult,
  type TestScreen,
} from '../../../lib/testMode';

/**
 * Taking a test.
 *
 * Takes over the tab by an early return from `AdaptiveTestTab`, the same way
 * `FlashcardStudyView` does — not a portal, not `position: fixed`. The study
 * space header and tab bar stay where they are.
 *
 * ONE QUESTION PER SCREEN, except matching, where the block of terms shares one
 * screen because the six definitions are a single pool. `ARCHITECTURE.md` §7
 * has the frontend record `latency_ms` as the student answers, which only means
 * anything if one question is on screen at a time.
 *
 * NOTHING here knows whether an answer is right. `TestQuestion` carries no
 * answer key by construction; correctness arrives once, from `complete()`.
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface TestSessionViewProps {
  test: GeneratedTest;
  materialTitle: string | null;
  onExit: () => void;
  onFinish: (result: TestResult) => void;
}

export default function TestSessionView({
  test,
  materialTitle,
  onExit,
  onFinish,
}: TestSessionViewProps) {
  const screens = useMemo(() => buildScreens(test.questions), [test]);

  const [screenIdx, setScreenIdx] = useState(() => {
    // Resuming lands on the first screen with something still unanswered.
    const first = buildScreens(test.questions).findIndex((s) =>
      screenIndices(s).some((i) => !test.answers[i])
    );
    return first < 0 ? 0 : first;
  });
  const [answers, setAnswers] = useState<Record<number, string>>(() => ({ ...test.answers }));
  const [saveError, setSaveError] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  /** question index → the screen that shows it. A matching block's four terms all map to one. */
  const screenOf = useMemo(() => {
    const map = new Map<number, number>();
    screens.forEach((s, i) => screenIndices(s).forEach((qi) => map.set(qi, i)));
    return map;
  }, [screens]);

  const dirtyRef = useRef<Set<number>>(new Set());
  const enteredAtRef = useRef<number>(Date.now());
  /**
   * Saves are queued onto this chain rather than awaited by the navigation
   * handler — a student pressing Next must not wait on a round trip. Finish
   * awaits the chain, so everything typed has landed before the test is graded.
   */
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  /** Synchronous latch. `disabled` reads state that has not re-rendered yet, so a
   *  double-click would otherwise complete the same test twice. */
  const finishingRef = useRef(false);

  const screen = screens[screenIdx];
  const answeredCount = test.questions.filter((q) => answers[q.index]).length;
  const unanswered = test.questions.length - answeredCount;

  // ── Saving ────────────────────────────────────────────────────────────────

  /**
   * Persists whatever changed on the screen being left. Answers are saved per
   * screen rather than per keystroke, and the screen's dwell time is split
   * across the questions it answered.
   */
  const flush = useCallback(
    async (indices: number[], current: Record<number, string>) => {
      const dirty = indices.filter((i) => dirtyRef.current.has(i));
      if (dirty.length === 0) return;
      const each = Math.round((Date.now() - enteredAtRef.current) / dirty.length);
      dirty.forEach((i) => dirtyRef.current.delete(i));
      try {
        await Promise.all(dirty.map((i) => testApi.saveAnswer(test.id, i, current[i] ?? '', each)));
        setSaveError(false);
      } catch {
        // Non-blocking: the answer is still held in component state and is sent
        // again at Finish. Stopping the student mid-test over a failed write
        // would cost them the whole attempt.
        setSaveError(true);
        dirty.forEach((i) => dirtyRef.current.add(i));
      }
    },
    [test.id]
  );

  const queueFlush = (indices: number[], current: Record<number, string>) => {
    pendingRef.current = pendingRef.current.then(() => flush(indices, current));
    return pendingRef.current;
  };

  const setAnswer = (index: number, value: string) => {
    dirtyRef.current.add(index);
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const goTo = (next: number) => {
    if (next === screenIdx || next < 0 || next >= screens.length) return;
    void queueFlush(screenIndices(screen), answers);
    enteredAtRef.current = Date.now();
    setScreenIdx(next);
  };

  const handleFinish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setIsFinishing(true);
    try {
      await queueFlush(screenIndices(screen), answers);
      // Anything an earlier save failed to write, retried once before grading.
      const stragglers = [...dirtyRef.current];
      if (stragglers.length > 0) await flush(stragglers, answers);
      const result = await testApi.complete(test.id);
      onFinish(result);
    } catch {
      setSaveError(true);
      setIsFinishing(false);
    } finally {
      finishingRef.current = false;
    }
  };

  const handleExit = async () => {
    await queueFlush(screenIndices(screen), answers);
    onExit();
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (showExit || isFinishing) return;

      if (e.key === 'ArrowRight') { goTo(screenIdx + 1); return; }
      if (e.key === 'ArrowLeft') { goTo(screenIdx - 1); return; }
      if (screen?.kind !== 'single') return;

      const q = screen.question;
      if (q.format === 'multiple_choice') {
        const at = LETTERS.indexOf(e.key.toUpperCase());
        const num = Number(e.key) - 1;
        const pick = at >= 0 && at < q.options.length ? at : num >= 0 && num < q.options.length ? num : -1;
        if (pick >= 0) setAnswer(q.index, q.options[pick]);
      } else if (q.format === 'true_or_false') {
        if (e.key.toLowerCase() === 't') setAnswer(q.index, 'true');
        if (e.key.toLowerCase() === 'f') setAnswer(q.index, 'false');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!screen) return null;

  const format = screenFormat(screen);
  const indices = screenIndices(screen);
  const positionLabel =
    indices.length === 1
      ? `${indices[0] + 1} / ${test.questions.length}`
      : `${indices[0] + 1}–${indices[indices.length - 1] + 1} / ${test.questions.length}`;

  const nav = (
    <QuestionNav
      questions={test.questions}
      formats={test.formats}
      answers={answers}
      screenOf={screenOf}
      current={indices}
      onJump={(to) => {
        goTo(to);
        setShowNav(false);
      }}
    />
  );

  return (
    <div className="animate-in fade-in duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8 lg:items-start">
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
            <span className="text-primary-fixed-dim">{sectionLabel(test.formats, format)}</span>
            <span className="hidden sm:inline"> · {FORMAT_META[format].label}</span>
          </span>

          {/* Below lg: the counter IS the way into the navigator — it is already
              the thing a student looks at to ask "where am I?". The rail replaces
              it above lg, so there is never both. */}
          <button
            onClick={() => setShowNav(true)}
            className="lg:hidden flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 transition-colors font-sans text-xs text-slate-400 tabular-nums"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {positionLabel}
          </button>
          <span className="hidden lg:inline font-sans text-xs text-slate-500 tabular-nums shrink-0">
            {positionLabel}
          </span>
        </div>

        {/* One segment per QUESTION. Neutral by design — colouring by
            correctness here would leak grading into the middle of the test. */}
        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex gap-0.5">
          {test.questions.map((q) => {
            const onScreen = indices.includes(q.index);
            return (
              <div
                key={q.index}
                className={`flex-1 h-full rounded-full transition-colors duration-300 ${
                  onScreen
                    ? 'bg-primary-fixed-dim'
                    : answers[q.index]
                      ? 'bg-primary-fixed-dim/40'
                      : 'bg-white/10'
                }`}
              />
            );
          })}
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
          key={screenIdx}
          className="bg-surface-container-lowest rounded-3xl border border-white/10 p-5 sm:p-8 min-h-[20rem] animate-in fade-in duration-200"
        >
          {screen.kind === 'matching' ? (
            <MatchingBlock screen={screen} answers={answers} onAnswer={setAnswer} />
          ) : (
            <SingleQuestion
              question={screen.question}
              value={answers[screen.question.index] ?? ''}
              onAnswer={(v) => setAnswer(screen.question.index, v)}
            />
          )}
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
            onClick={() => goTo(screenIdx - 1)}
            disabled={screenIdx === 0}
            className="px-4 sm:px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Previous
          </button>

          {screenIdx < screens.length - 1 ? (
            <button
              onClick={() => goTo(screenIdx + 1)}
              className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all flex items-center gap-2"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => void handleFinish()}
              disabled={isFinishing}
              className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isFinishing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Checking…</>
              ) : (
                <><Flag className="w-4 h-4" /> Finish &amp; See Results</>
              )}
            </button>
          )}
        </div>

        {/* Skipping is allowed on purpose — blocking Next means a stuck student
            can never reach the end. An unanswered item is simply wrong. */}
        {screenIdx === screens.length - 1 && unanswered > 0 && !isFinishing && (
          <p className="font-sans text-xs text-amber-400/80 text-right mt-2">
            {unanswered} question{unanswered === 1 ? '' : 's'} still unanswered — these will be
            marked wrong.
          </p>
        )}

        <p className="hidden sm:block font-sans text-[11px] text-slate-600 text-center mt-6">
          {format === 'multiple_choice' && 'Press A–D to choose · '}
          {format === 'true_or_false' && 'Press T or F · '}
          ← → to move between questions
        </p>
        </div>
      </div>

      {/* ── Navigator, desktop ──────────────────────────────────────────── */}
      <aside className="hidden lg:block sticky top-0 max-h-[calc(100vh-9rem)] overflow-y-auto no-scrollbar">
        {nav}
      </aside>

      <Modal
        isOpen={showNav}
        onClose={() => setShowNav(false)}
        title="Jump to a question"
        maxWidth="max-w-md"
      >
        {nav}
      </Modal>

      <Modal isOpen={showExit} onClose={() => setShowExit(false)} title="Leave this test?" maxWidth="max-w-sm">
        <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
          Your answers so far are saved. You can pick this test up again from the Test Mode list.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowExit(false)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-container border border-white/10 text-on-surface font-sans text-sm font-semibold hover:bg-surface-container-high transition-colors"
          >
            Keep going
          </button>
          <button
            onClick={() => void handleExit()}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white text-black font-sans text-sm font-semibold hover:bg-slate-200 transition-colors"
          >
            Leave
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jump to any question. A 29-item test behind only Next/Previous means going
 * back to question 4 from question 29 is twenty-five clicks, and it makes
 * "6 unanswered" a warning the student cannot act on.
 *
 * Rendered twice from one definition — as a rail on `lg:` and inside a `Modal`
 * below it — so the two can never drift.
 *
 * Grouped by section because that is how the test is organised; the grouping is
 * also the only place the exam's shape is visible while working through it.
 *
 * A matching block contributes FOUR cells that all jump to the same screen.
 * Each term is separately answerable and separately scored, so four cells is the
 * truthful count — collapsing them to one would misreport progress.
 */
function QuestionNav({
  questions,
  formats,
  answers,
  screenOf,
  current,
  onJump,
}: {
  questions: TestQuestion[];
  formats: QuestionFormat[];
  answers: Record<number, string>;
  screenOf: Map<number, number>;
  current: number[];
  onJump: (screenIdx: number) => void;
}) {
  const groups: { format: QuestionFormat; items: TestQuestion[] }[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.format === q.format) last.items.push(q);
    else groups.push({ format: q.format, items: [q] });
  }

  const unanswered = questions.filter((q) => !answers[q.index]).length;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={`${group.format}-${group.items[0].index}`}>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            <span className="text-primary-fixed-dim">{sectionLabel(formats, group.format)}</span>
            {' · '}
            {FORMAT_META[group.format].label}
          </p>
          <div className="grid grid-cols-6 lg:grid-cols-5 gap-1.5">
            {group.items.map((q) => {
              const isCurrent = current.includes(q.index);
              const isAnswered = Boolean(answers[q.index]);
              return (
                <button
                  key={q.index}
                  onClick={() => onJump(screenOf.get(q.index) ?? 0)}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`Question ${q.index + 1}${isAnswered ? ', answered' : ', not answered'}`}
                  className={`h-8 rounded-lg font-display text-xs font-bold tabular-nums transition-all ${
                    isCurrent
                      ? 'bg-primary-fixed-dim text-black'
                      : isAnswered
                        ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim border border-primary-fixed-dim/40'
                        : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {q.index + 1}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="font-sans text-xs text-slate-500 pt-1 border-t border-white/5">
        {unanswered === 0
          ? 'Every question answered.'
          : `${unanswered} left to answer.`}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-format renderers
// ─────────────────────────────────────────────────────────────────────────────

const INPUT =
  'w-full bg-surface-container/60 border border-white/10 rounded-xl px-4 py-3 text-white font-sans text-base outline-none focus:border-primary-fixed-dim transition-colors placeholder:text-slate-600';

function SingleQuestion({
  question,
  value,
  onAnswer,
}: {
  question: Exclude<TestQuestion, { format: 'matching_type' }>;
  value: string;
  onAnswer: (value: string) => void;
}) {
  if (question.format === 'multiple_choice') {
    return (
      <>
        <p className="font-display text-lg sm:text-xl text-white leading-relaxed mb-6">{question.prompt}</p>
        <ChoiceList question={question} value={value} onAnswer={onAnswer} />
      </>
    );
  }

  if (question.format === 'true_or_false') {
    return (
      <>
        <p className={`${LABEL} mb-3`}>True or false?</p>
        <p className="font-display text-lg sm:text-xl text-white leading-relaxed mb-7">{question.prompt}</p>
        <div className="grid grid-cols-2 gap-3">
          {(['true', 'false'] as const).map((option) => {
            const selected = value === option;
            return (
              <button
                key={option}
                onClick={() => onAnswer(option)}
                className={`py-4 rounded-xl border font-display text-base font-semibold transition-all ${
                  selected
                    ? 'bg-primary-fixed-dim/15 border-primary-fixed-dim text-primary-fixed-dim'
                    : 'bg-surface-container/40 border-white/10 text-slate-300 hover:border-white/25 hover:text-white'
                }`}
              >
                {option === 'true' ? 'True' : 'False'}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  if (question.format === 'identification') {
    return (
      <>
        <p className={`${LABEL} mb-3`}>What is being described?</p>
        <p className="font-sans text-base sm:text-lg text-slate-200 leading-relaxed mb-7">{question.prompt}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder="Type the term…"
          className={INPUT}
        />
      </>
    );
  }

  const [before, after] = splitBlank(question.prompt);
  return (
    <>
      <p className={`${LABEL} mb-4`}>Complete the sentence</p>
      <p className="font-sans text-base sm:text-lg text-slate-200 leading-loose">
        {before}
        <input
          autoFocus
          value={value}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder="…"
          className="inline-block align-baseline mx-1 min-w-[7rem] max-w-full bg-transparent border-b-2 border-white/20 focus:border-primary-fixed-dim px-2 py-0.5 text-white font-semibold outline-none transition-colors"
        />
        {after}
      </p>
    </>
  );
}

function ChoiceList({
  question,
  value,
  onAnswer,
}: {
  question: ChoiceQuestion;
  value: string;
  onAnswer: (value: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      {question.options.map((option, i) => {
        const selected = value === option;
        return (
          <button
            key={option}
            onClick={() => onAnswer(option)}
            className={`w-full flex items-start gap-3 text-left p-3.5 rounded-xl border transition-all ${
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
            <span className={`font-sans text-sm leading-relaxed ${selected ? 'text-white' : 'text-slate-300'}`}>
              {option}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A matching block you actually drag.
 *
 * **The TERM is the thing that moves, not the definition** — and that follows
 * from the data, not from taste. Measured over the live `concepts` table: terms
 * run to a median of 18 characters (p90 40), definitions to a median of 162
 * (p90 267, max 643). A classic two-column "draw a line across" layout needs
 * both sides short; a 267-character definition in a half-width column is
 * unreadable before a single line is drawn. So the short thing becomes a
 * draggable chip and the long thing gets full width as the drop target.
 *
 * TWO WAYS TO ANSWER, one model. Press a chip and drag it onto a definition, or
 * tap the chip and then tap the definition. The tap path is not a fallback for
 * neatness — dragging fails whenever the chip and its target are not on screen
 * together, which on a phone is most of the time with definitions this long, and
 * it is the only path a keyboard can take.
 *
 * SLOTS ARE EXCLUSIVE. One definition holds at most one term, and dropping onto
 * an occupied slot bumps the previous term back to the tray. Real matching type
 * works that way, and the two definitions left empty at the end are exactly the
 * two distractors — which makes the 4-against-6 shape visible instead of
 * something the student has to infer.
 *
 * What is stored is still the definition TEXT (`onAnswer(index, option)`), never
 * a slot position, so grading is unaffected by any of this.
 */
function MatchingBlock({
  screen,
  answers,
  onAnswer,
}: {
  screen: Extract<TestScreen, { kind: 'matching' }>;
  answers: Record<number, string>;
  onAnswer: (index: number, value: string) => void;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef({ active: false, moved: false, reselect: false });

  const holderOf = (option: string) =>
    screen.questions.find((q) => answers[q.index] === option) ?? null;
  const unplaced = screen.questions.filter((q) => !answers[q.index]);
  const heldQuestion = screen.questions.find((q) => q.index === held) ?? null;

  const place = (qIndex: number, option: string) => {
    const occupant = holderOf(option);
    if (occupant && occupant.index !== qIndex) onAnswer(occupant.index, '');
    onAnswer(qIndex, option);
    setHeld(null);
  };

  /** What is under the pointer: a definition slot, the tray, or neither. */
  const targetAt = (x: number, y: number): { option: string } | 'tray' | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest('[data-option]') as HTMLElement | null;
    if (row?.dataset.option) return { option: row.dataset.option };
    return el?.closest('[data-tray]') ? 'tray' : null;
  };

  // No dependency array: the handlers close over `held` and `answers`, and both
  // change while a drag is in flight. They only exist while something is held.
  useEffect(() => {
    if (held === null) return;

    const move = (e: PointerEvent) => {
      if (!drag.current.active) return;
      drag.current.moved = true;
      setGhost({ x: e.clientX, y: e.clientY });
      const target = targetAt(e.clientX, e.clientY);
      setHover(target === 'tray' ? 'tray' : (target?.option ?? null));
    };
    const finish = (e: PointerEvent) => {
      if (!drag.current.active) return;
      if (drag.current.moved) {
        const target = targetAt(e.clientX, e.clientY);
        if (target === 'tray') {
          onAnswer(held, ''); // dragged back out of its slot
          setHeld(null);
        } else if (target) {
          place(held, target.option);
        } else {
          setHeld(null); // dropped on nothing
        }
      } else if (drag.current.reselect) {
        setHeld(null); // tapped the chip that was already picked up
      }
      drag.current.active = false;
      setGhost(null);
      setHover(null);
    };
    const cancel = () => {
      drag.current.active = false;
      setGhost(null);
      setHover(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
  });

  const chip = (q: MatchingQuestion, placed: boolean) => {
    const isHeld = held === q.index;
    return (
      <button
        // `touch-action: none` or the browser claims the gesture for scrolling
        // and fires pointercancel the moment a finger moves.
        style={{ touchAction: 'none' }}
        onPointerDown={() => {
          drag.current = { active: true, moved: false, reselect: held === q.index };
          setHeld(q.index);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-pressed={isHeld}
        className={`inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg font-sans text-xs font-semibold cursor-grab active:cursor-grabbing select-none transition-all ${
          isHeld
            ? 'bg-primary-fixed-dim text-black shadow-lg shadow-primary-fixed-dim/20 scale-105'
            : placed
              ? 'bg-primary-fixed-dim/15 border border-primary-fixed-dim/40 text-primary-fixed-dim'
              : 'bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 hover:border-white/25'
        }`}
      >
        <span
          className={`font-display text-[10px] tabular-nums ${isHeld ? 'text-black/50' : 'text-slate-500'}`}
        >
          {q.index + 1}
        </span>
        <span className="text-left">{q.prompt}</span>
        {placed && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${q.prompt}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAnswer(q.index, '');
            }}
            className="ml-0.5 text-primary-fixed-dim/60 hover:text-white transition-colors"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <p className={`${LABEL} mb-1.5`}>Match each term to its definition</p>
      <p className="font-sans text-xs text-slate-500 mb-4 leading-relaxed">
        Drag a term onto the definition it belongs to — or tap the term, then tap its definition.
        Two definitions are left over.
      </p>

      {/* ── Tray. Also a drop target, so a placed term can be dragged back out. ── */}
      <div
        data-tray
        onClick={() => {
          if (held !== null && answers[held]) {
            onAnswer(held, '');
            setHeld(null);
          }
        }}
        className={`rounded-2xl border border-dashed p-3 mb-5 min-h-[3.75rem] flex flex-wrap items-center gap-2 transition-colors ${
          hover === 'tray'
            ? 'border-primary-fixed-dim bg-primary-fixed-dim/10'
            : unplaced.length > 0
              ? 'border-white/15 bg-surface-container/20'
              : 'border-white/5'
        }`}
      >
        {unplaced.length === 0 ? (
          <p className="font-sans text-xs text-slate-600 px-1">
            All {screen.questions.length} terms placed.
          </p>
        ) : (
          unplaced.map((q) => <Fragment key={q.index}>{chip(q, false)}</Fragment>)
        )}
      </div>

      {/* ── Definitions ───────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {screen.options.map((option) => {
          const holder = holderOf(option);
          const isTarget = held !== null && hover === option;
          return (
            <div
              key={option}
              data-option={option}
              onClick={() => {
                if (held !== null) place(held, option);
              }}
              className={`flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 p-3 rounded-xl border transition-all ${
                isTarget
                  ? 'border-primary-fixed-dim bg-primary-fixed-dim/10'
                  : held !== null
                    ? 'border-white/20 bg-surface-container/30 cursor-pointer hover:border-white/40'
                    : 'border-white/5 bg-surface-container/20'
              }`}
            >
              <div className="w-full sm:w-40 shrink-0">
                {holder ? (
                  chip(holder, true)
                ) : (
                  <span
                    className={`inline-flex items-center justify-center w-full sm:w-auto sm:min-w-[7rem] px-3 py-1.5 rounded-lg border border-dashed font-sans text-[11px] transition-colors ${
                      isTarget
                        ? 'border-primary-fixed-dim text-primary-fixed-dim'
                        : 'border-white/15 text-slate-600'
                    }`}
                  >
                    {held !== null ? 'Drop here' : 'Empty'}
                  </span>
                )}
              </div>
              <p className="font-sans text-xs sm:text-sm text-slate-300 leading-relaxed min-w-0 flex-1">
                {option}
              </p>
            </div>
          );
        })}
      </div>

      {/* Follows the pointer during a drag. pointer-events:none so it never
          becomes the element under the cursor when we hit-test. */}
      {ghost && heldQuestion && (
        <div
          className="fixed z-[200] pointer-events-none -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-primary-fixed-dim text-black font-sans text-xs font-semibold shadow-2xl"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {heldQuestion.prompt}
        </div>
      )}
    </>
  );
}
