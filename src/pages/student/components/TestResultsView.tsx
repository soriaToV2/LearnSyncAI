import { Fragment, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Minus, RotateCcw,
  Sparkles, Target, TrendingDown, TrendingUp, Trophy, X,
} from 'lucide-react';
import { CARD, LABEL, SECTION, scoreTone, toneText } from '../../../components/ui/surfaces';
import MeterBar from '../../../components/ui/MeterBar';
import {
  FORMAT_META,
  displayAnswer,
  formatElapsed,
  orderedFormats,
  scorePercent,
  sectionLabel,
  type QuestionFormat,
  type MasteryChange,
  type QuestionResult,
  type TestResult,
} from '../../../lib/testMode';
import { masteryPercent } from '../../../lib/mastery';
import type { MaterialMasteryDetail } from '../../../lib/mastery';
import { materialBand, recommendMaterial } from '../../../lib/recommend';
import type { StudyIntent } from '../../../lib/studySpace';

/**
 * The result of a test — used both immediately after finishing and when
 * reopening a past one from the list. One layout, two entry points.
 *
 * The ring says **Test Score**, never "Mastery". Mastery is the per-concept
 * probability in `bkt_mastery`, owned by the backend and moved only by the BKT
 * update; a percentage of questions answered correctly in one sitting is a
 * different quantity, and using one word for both invites a reader to mistake
 * this figure for the paper's.
 *
 * Unlike Free Recall's coverage ratio, this percentage IS comparable across
 * materials — it is correct-out-of-asked — so `scoreTone()`'s absolute
 * thresholds are appropriate here.
 */

/**
 * Local depth on top of the shared `CARD`, which stays flat because the session
 * view and the cognitive tabs reuse it. Same arrangement as the dashboard and the
 * Analytics tab. Every colour here is one `[data-theme="white"]` already patches.
 */
const PANEL = `${CARD} border border-white/5 shadow-lg shadow-black/20`;

interface TestResultsViewProps {
  result: TestResult;
  materialTitle: string | null;
  onBack: () => void;
  onRetake: () => void;
  /** Immediately after finishing, versus reopening from the list. */
  justFinished: boolean;
  /**
   * Current mastery for the lesson this test was built from, or null while it is
   * still loading.
   *
   * ⚠️ CURRENT, NOT AS-OF-THIS-TEST, AND THAT IS WHAT LETS THE ADVICE SURVIVE A
   * REVISIT. A student reopening a test a week later has done flashcards since;
   * the advice must reflect where they are now, not where this test left them.
   */
  materialMastery: MaterialMasteryDetail | null;
  /**
   * Follow the recommendation.
   *
   * ⚠️ A CALLBACK, NOT A `<Link>`. This component renders inside `StudySpace`,
   * so a link carrying `?tab=feynman` would be a same-route navigation:
   * `location.search` would change, `StudySpace` would not unmount, and its tab
   * was seeded once at mount — the URL would move and the screen would not.
   */
  onNavigate: (intent: StudyIntent) => void;
}

export default function TestResultsView({
  result,
  materialTitle,
  onBack,
  onRetake,
  justFinished,
  materialMastery,
  onNavigate,
}: TestResultsViewProps) {
  const [filter, setFilter] = useState<'all' | 'incorrect'>('all');

  /**
   * What this submission did to the student's mastery.
   *
   * ⚠️ GATED ON `justFinished`, AND THAT IS NOT COSMETIC. This same screen is
   * reopened from the past-tests list, where `mastery_changes` is absent anyway
   * (`GET /:id/result` re-grades and reports no movement) — but a double-submit
   * also reaches `complete()` and gets nothing back, so the gate states the rule
   * rather than relying on the field being missing.
   *
   * ⚠️ AND SORTED WEAKEST-AFTER FIRST, NOT BIGGEST-MOVE FIRST. The student is
   * looking for what still needs work, not for the largest number on the screen.
   */
  const masteryChanges: MasteryChange[] = useMemo(() => {
    if (!justFinished || !result.mastery_changes) return [];
    return [...result.mastery_changes].sort(
      (a, b) => a.after - b.after || a.term.localeCompare(b.term)
    );
  }, [justFinished, result.mastery_changes]);

  /**
   * The one thing to do next, for the weakest concept this test asked about.
   *
   * ⚠️ NOT GATED ON `justFinished`. The mastery BLOCK above is a fact about one
   * submission and cannot be rebuilt later; this is advice about a concept, and
   * it is just as true — arguably more useful — when a student reopens the test
   * to review. Gating both together was a convenience, not a reason.
   *
   * Keyed on mastery rather than on `missed_concepts`, which counts wrong
   * answers in this one sitting: a concept missed once but sitting at 70% needs
   * less attention than one answered correctly by luck and still at 25%. Mastery
   * is the quantity the recommendation is about.
   *
   * ⚠️ TWO SOURCES, AND THE ORDER BETWEEN THEM MATTERS. `conceptMastery` is the
   * live read and is the base. `mastery_changes` overrides it where present,
   * because `refreshList()` is fired without being awaited when a test finishes
   * — so on the first render after submitting, the live map can still hold the
   * PRE-test values and would advise against a number the screen above has
   * already superseded. The two agree once the fetch lands.
   *
   * ⚠️ ASSESSED ONLY, so P(L₀) can never drive a recommendation. Plain ascending
   * mastery is correct here for the same reason it is on "Focus next" — every
   * candidate is a real measurement, so `rankOf()`'s unknown-in-the-middle rule
   * has nothing to do.
   */
  /**
   * What to do next about THIS LESSON.
   *
   * ⚠️ LESSON-SCOPED, NOT ONE CONCEPT, AND THE REASON IS ARITHMETIC RATHER THAN
   * TASTE. It used to promote the single weakest concept — but BKT's
   * all-incorrect posterior depends only on the question's FORMAT
   * (`GUESS_KEY_BY_FORMAT`, five P(G) values), so a test the student got wrong
   * throughout yields at most five distinct mastery values across every concept
   * in it. The comparator then fell through to `localeCompare`, and the screen
   * promoted whichever term happened to sort first alphabetically. Reported from
   * a real 34-concept test, where it picked "ADVANCED SYSTEM INTEGRATION" for no
   * reason a student could see, while listing 33 other problems directly above.
   *
   * ⚠️ NOT GATED ON `justFinished`. The mastery block above is a fact about one
   * submission and cannot be rebuilt later; this is advice about a lesson, and it
   * is just as true — more useful, even — when a student reopens the test to
   * review. That is why it reads CURRENT mastery rather than this test's deltas.
   *
   * ⚠️ AND NOTHING RENDERS WHILE THAT READ IS STALE. `refreshList()` is fired
   * un-awaited when a test finishes, so for a beat afterwards the material row
   * can still say `assessed_concept_count === 0` — which `materialBand()`
   * correctly calls `unassessed`, producing "Nothing in X has been measured yet"
   * immediately after a test measured it. A card that arrives a moment late
   * beats one that is briefly wrong. There is no `mastery_changes` override
   * available here the way there is per concept: this needs a document mean, and
   * `documentMastery()` on the server is the only place that may compute one.
   */
  const nextUp = useMemo(() => {
    if (!materialMastery) return null;
    if (materialMastery.assessed_concept_count === 0) return null;

    const band = materialBand(materialMastery);
    // Nothing urgent to say — and "take a test on it" would be absurd on the
    // screen reporting the test they just took.
    if (band === 'advanced') return null;

    return {
      rec: recommendMaterial({
        title: materialMastery.title,
        band,
        m_doc: materialMastery.m_doc,
      }),
      // Exactly the chips listed in "Concepts to revisit" directly above, so the
      // Feynman step ticks precisely what the screen has just named.
      missedIds: result.missed_concepts.map((c) => c.concept_id),
    };
  }, [materialMastery, result.missed_concepts]);

  const percent = scorePercent(result.score);
  const tone = scoreTone(percent);
  const circumference = 2 * Math.PI * 54;

  const byFormat = useMemo(() => {
    const map = new Map<QuestionFormat, { correct: number; total: number }>();
    for (const r of result.results) {
      const entry = map.get(r.format) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (r.is_correct) entry.correct += 1;
      map.set(r.format, entry);
    }
    return orderedFormats([...map.keys()]).map((format) => ({ format, ...map.get(format)! }));
  }, [result.results]);

  const shown = filter === 'all' ? result.results : result.results.filter((r) => !r.is_correct);
  const wrongCount = result.total - result.correct;

  const tab = (mode: 'all' | 'incorrect') =>
    `px-3 sm:px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] ${
      filter === mode ? 'bg-surface-container-high text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="fade-in duration-300 max-w-3xl mx-auto space-y-5 pb-10">
      {/* Leaving must not require scrolling past 29 review cards to reach the
          footer. Same placement and styling as the session view's exit. */}
      <button
        onClick={onBack}
        className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
      >
        <ArrowLeft className="w-4 h-4" /> Exit
      </button>

      {/* ── Score ─────────────────────────────────────────────────────────── */}
      {/* The hero card, so it gets the one theme-glow lift on this screen —
          `--theme-glow` is the token the design system defines for exactly this
          and the dashboard's mastery card is its other consumer. */}
      <div
        className={`${PANEL} p-6 sm:p-8 text-center relative overflow-hidden shadow-[0_10px_25px_-8px_rgba(0,0,0,0.35),0_0_45px_-12px_var(--theme-glow)]`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Trophy className={`w-7 h-7 ${toneText[tone]}`} />
          </div>

          <h2 className="font-display text-2xl font-bold text-white mb-1">
            {justFinished ? 'Test Complete' : result.test.title}
          </h2>
          {materialTitle && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <BookOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className={`${LABEL} truncate`} title={materialTitle}>{materialTitle}</span>
            </div>
          )}

          <div className="relative w-36 h-36 mx-auto mb-5">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
              <circle
                cx="60" cy="60" r="54" fill="none" strokeWidth="6" strokeLinecap="round" stroke="currentColor"
                className={toneText[tone]}
                strokeDasharray={circumference}
                strokeDashoffset={circumference - (percent / 100) * circumference}
                style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-display text-4xl font-bold ${toneText[tone]}`}>{percent}%</span>
              <span className="font-sans text-[11px] text-slate-500 uppercase tracking-widest font-semibold">
                Test Score
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
            <Stat label="Correct" value={`${result.correct}/${result.total}`} />
            <Stat label="Missed" value={String(wrongCount)} />
            <Stat label="Time" value={formatElapsed(result.elapsed_ms)} />
          </div>
        </div>
      </div>

      {/* ── Section breakdown ─────────────────────────────────────────────── */}
      <div className={`${PANEL} p-4 sm:p-5`}>
        <h3 className={`${SECTION} mb-4`}>By section</h3>
        <div className="space-y-3.5">
          {byFormat.map(({ format, correct, total }) => {
            const pct = Math.round((correct / Math.max(1, total)) * 100);
            const Icon = FORMAT_META[format].icon;
            return (
              <div key={format}>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="flex items-center gap-2 font-sans text-xs text-slate-300 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-primary-fixed-dim font-semibold shrink-0">
                      {sectionLabel(result.test.formats, format)}
                    </span>
                    <span className="truncate">{FORMAT_META[format].label}</span>
                  </span>
                  <span
                    className={`font-display text-xs font-bold tabular-nums shrink-0 ${toneText[scoreTone(pct)]}`}
                  >
                    {correct}/{total}
                  </span>
                </div>
                {/*
                 * `MeterBar` rather than the eighth hand-rolled `h-1.5
                 * rounded-full bg-white/5` track in this codebase — that
                 * duplication is what the component was extracted to end.
                 *
                 * Toned by score, which the header comment on this file already
                 * licenses: a test percentage is correct-out-of-asked and so
                 * means the same thing on any material, unlike Free Recall's
                 * coverage ratio. It replaces a flat `primary-fixed-dim/70`, so
                 * a weak section is now visible without reading every fraction.
                 * Small denominators make a single section's tone coarse — 3/5
                 * is 'mid' — which is why the fraction stays beside it.
                 */}
                <MeterBar
                  value={pct / 100}
                  tone={scoreTone(pct)}
                  label={`${FORMAT_META[format].label}: ${correct} of ${total} correct`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Concepts to revisit ───────────────────────────────────────────── */}
      {result.missed_concepts.length > 0 && (
        <div className={`${PANEL} p-4 sm:p-5`}>
          <h3 className={`${SECTION} mb-1 flex items-center gap-2`}>
            <Target className="w-3.5 h-3.5 text-amber-400" /> Concepts to revisit
          </h3>
          <p className="font-sans text-xs text-slate-500 mb-4">
            Worked out from the questions you missed — these are the parts of the lesson to go back to.
          </p>
          <div className="flex flex-wrap gap-2">
            {result.missed_concepts.map((c) => (
              <span
                key={c.concept_id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-400/5 border border-amber-400/20"
              >
                <span className="font-sans text-xs font-semibold text-slate-200">{c.term}</span>
                {/* ⚠️ ONLY WHEN IT CAN SAY SOMETHING. `allocateConcepts()` deals
                    each concept to exactly one question and the dealing cursor
                    never rewinds, so `asked` is 1 on every chip of every test and
                    this read "1 of 1 wrong" thirty-four times on one screen.
                    Kept conditional rather than deleted: it costs one comparison
                    and stays correct if the allocator ever changes. */}
                {c.asked > 1 && (
                  <span className="font-sans text-[11px] text-amber-400/70 tabular-nums">
                    {c.wrong} of {c.asked} wrong
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Mastery updated ───────────────────────────────────────────────
          The one screen in the app that shows mastery MOVING. The server has
          always computed the pair and always threw it away; `mastery_changes`
          is it, and it rides only on the request that actually completed the
          test. Kept visually separate from the score ring above, which says
          "Test Score" and means a different quantity. */}
      {masteryChanges.length > 0 && (
        <div className={`${PANEL} p-4 sm:p-5`}>
          <h3 className={`${SECTION} mb-1 flex items-center gap-2`}>
            <Sparkles className="w-3.5 h-3.5 text-primary-fixed-dim" /> Mastery updated
          </h3>
          <p className="font-sans text-xs text-slate-500 mb-4">
            How much the app now thinks you know each idea. This is not your test score — it builds
            up across every test and flashcard you do.
          </p>
          <div className="flex flex-col gap-1">
            {/* Keyed on a Fragment, not on MasteryRow — same reason as the
                review rows below: no `@types/react`, so a locally-declared
                component's props are enforced exactly and `key` is not one. */}
            {masteryChanges.map((c) => (
              <Fragment key={c.concept_id}>
                <MasteryRow change={c} />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── What to do next ──────────────────────────────────────────────── */}
      {nextUp && (
        <div className={`${PANEL} p-4 sm:p-5`}>
          <h3 className={`${SECTION} mb-1 flex items-center gap-2`}>
            <Target className="w-3.5 h-3.5 text-primary-fixed-dim" /> What to do next
          </h3>
          <p className="font-sans text-xs text-slate-500 mb-4">{nextUp.rec.steps[0].why}</p>

          {/* ⚠️ EVERY STEP LOOKS THE SAME. The first used to be accented, which
              read as "you are on this one" — a progress marker for progress
              nothing tracks. There is no record of whether a student read the
              lesson or wrote an explanation, so on a revisit the accent would
              still sit on step one however much they had done. The ORDER is the
              recommendation, and the sentence above already says which comes
              first; do not reintroduce an active state without something that
              actually observes it. */}
          <div className="flex flex-col gap-2">
            {nextUp.rec.steps.map((s) => {
              /*
               * Two steps carry the missed concepts — every chip in "Concepts to
               * revisit" above. Feynman TICKS them for explaining; Flashcards
               * MARKS the matching cards in the deck and offers to drill them.
               * The other two open on the lesson and ignore them.
               *
               * The count is shown because it is consequential in both places:
               * ticking 34 concepts opens 34 text boxes, and marking 34 cards
               * reorders a deck. On a test with nothing missed — reachable, since
               * a first all-correct test still leaves a lesson `foundational` —
               * "Explain what you missed" would be a lie, so it falls back to
               * neutral wording and carries nothing.
               */
              const carriesIds = s.action === 'feynman' || s.action === 'flashcards';
              const carries = carriesIds ? nextUp.missedIds : [];
              const label =
                s.action === 'feynman' && carries.length === 0
                  ? 'Explain it in your own words'
                  : s.cta;

              return (
              <button
                key={s.action}
                onClick={() =>
                  onNavigate({
                    tab: s.tab,
                    materialId: result.test.material_id,
                    conceptIds: carries,
                  })
                }
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] text-left transition-colors hover:bg-white/5 hover:border-white/10"
              >
                <span className="font-sans text-sm font-semibold text-slate-300">{label}</span>
                {carries.length > 0 && (
                  <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 border border-white/10 rounded px-1.5 py-0.5">
                    {carries.length} idea{carries.length === 1 ? '' : 's'}
                  </span>
                )}
                {s.movesMastery && (
                  <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 border border-white/10 rounded px-1.5 py-0.5">
                    moves mastery
                  </span>
                )}
                <ChevronRight className="w-4 h-4 ml-auto shrink-0 text-slate-500" />
              </button>
              );
            })}
          </div>

          {/* ⚠️ ONCE PER CARD, NEVER PER ROW — see `Recommendation.honesty`. It
              is the sentence that stops the app promising that explaining a
              concept moves a number only flashcards and tests can move. */}
          <p className="font-sans text-[11px] text-slate-600 mt-3 leading-relaxed">
            {nextUp.rec.honesty}
          </p>
        </div>
      )}

      {/* ── Question review ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className={SECTION}>Question review</h3>
          <div className="inline-flex items-center gap-1 p-1 bg-surface-container-lowest/60 rounded-xl shrink-0">
            <button onClick={() => setFilter('all')} className={tab('all')}>
              All {result.total}
            </button>
            <button onClick={() => setFilter('incorrect')} className={tab('incorrect')}>
              Missed {wrongCount}
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className={`${PANEL} p-8 text-center`}>
            <Check className="w-8 h-8 text-emerald-400/40 mx-auto mb-3" />
            <p className="font-sans text-sm text-slate-400">
              Nothing missed — every question in this test was correct.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Keyed on a Fragment, not on ReviewRow: this project has no
                `@types/react`, so a locally-declared component's props are
                enforced exactly and `key` is not among them. */}
            {shown.map((r) => (
              <Fragment key={r.index}>
                <ReviewRow result={r} formats={result.test.formats} />
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 px-5 py-3 rounded-xl bg-surface-container border border-white/10 text-on-surface font-sans text-sm font-semibold hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
        <button
          onClick={onRetake}
          className="flex-1 px-5 py-3 rounded-xl bg-primary-fixed-dim text-black font-sans text-sm font-semibold hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface transition-colors flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> New test on this lesson
        </button>
      </div>
    </div>
  );
}

/**
 * One concept's before/after.
 *
 * ⚠️ THE `assessed_before` BRANCH IS THE POINT OF THIS COMPONENT. When this test
 * was a concept's first evidence, `before` is exactly P(L₀) = 0.10 — the engine's
 * initialisation constant, not something the app found out about this student.
 * Printing "10% → 33%" states an assumption as a measurement, which is the one
 * thing the whole analytics surface is built to prevent. It reads "Not measured
 * before" instead, and that row is the common case on a first test.
 *
 * A DROP is `mid`/amber, never `poor`/red. Mastery falling after a wrong answer
 * is the model working, and on a two-week study most students will see several;
 * red would read as a punishment for taking the test.
 */
function MasteryRow({ change }: { change: MasteryChange }) {
  const after = masteryPercent(change.after);
  const before = masteryPercent(change.before);
  const delta = change.assessed_before ? after - before : null;

  const Icon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone =
    delta === null || delta === 0
      ? 'text-slate-500'
      : delta > 0
        ? 'text-emerald-400'
        : 'text-amber-400';

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5">
      <span className="font-sans text-xs font-semibold text-slate-200 min-w-0 flex-1 truncate">
        {change.term}
      </span>
      <span className="font-sans text-[11px] text-slate-500 tabular-nums shrink-0">
        {change.assessed_before ? `${before}%` : 'Not measured before'}
      </span>
      <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
      <span className="font-sans text-xs font-bold text-slate-200 tabular-nums shrink-0 w-10 text-right">
        {after}%
      </span>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 py-2.5 sm:py-3 px-1">
      <p className="font-display text-base sm:text-lg font-bold text-white tabular-nums">{value}</p>
      {/* `tracking-wider`, not `tracking-widest`: at 375px these three tiles are
          ~90px wide and "Correct" at the wider tracking is the first thing to
          wrap. */}
      <p className="font-sans text-[11px] uppercase tracking-wider text-slate-500 font-semibold mt-0.5">
        {label}
      </p>
    </div>
  );
}

function ReviewRow({ result: r, formats }: { result: QuestionResult; formats: QuestionFormat[] }) {
  return (
    <div
      className={`${CARD} p-4 sm:p-5 border shadow-lg shadow-black/20 ${
        /* Border only, never a background tint: `CARD` already sets a
           background-color, and a second one on the same element is resolved by
           CSS source order rather than class order — so which wins would be
           whatever Tailwind happened to emit first. */
        r.is_correct ? 'border-white/5' : 'border-rose-500/25'
      }`}
    >
      {/* `items-start` and `min-w-0`: the left label carries the concept term,
          which runs to 45 characters on real data ("SECURE SOFTWARE DEVELOPMENT
          LIFE CYCLE (SSDLC)") and wraps to two or three lines on a phone. With
          `items-center` the badge then floated to the middle of that block. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-slate-500 min-w-0">
          {sectionLabel(formats, r.format)} · Q{r.index + 1} · {r.concept_term}
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider shrink-0 ${
            r.is_correct ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
          }`}
        >
          {r.is_correct ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          {r.is_correct ? 'Correct' : 'Missed'}
        </span>
      </div>

      <p className="font-sans text-sm text-slate-200 leading-relaxed mb-4">{r.prompt}</p>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <p className={`${LABEL} mb-1`}>Your answer</p>
          <p className={`font-sans text-sm ${r.is_correct ? 'text-emerald-400' : 'text-rose-400'}`}>
            {displayAnswer(r.format, r.student_answer)}
          </p>
        </div>
        {!r.is_correct && (
          <div>
            <p className={`${LABEL} mb-1`}>Correct answer</p>
            <p className="font-sans text-sm text-emerald-400">
              {displayAnswer(r.format, r.correct_answer)}
            </p>
          </div>
        )}
      </div>

      {r.explanation && (
        <p className="font-sans text-xs text-slate-400 leading-relaxed pt-3 border-t border-white/5">
          {r.explanation}
        </p>
      )}
    </div>
  );
}
