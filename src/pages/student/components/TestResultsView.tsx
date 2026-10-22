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
 * Test result screen, after finishing or when reopening a past test. The ring says "Test Score", never
 * "Mastery" (a different quantity). Unlike Free Recall coverage, this % is comparable across
 * materials, so scoreTone() applies.
 */

/** Local depth on top of the shared flat CARD. */
const PANEL = `${CARD} border border-white/5 shadow-lg shadow-black/20`;

interface TestResultsViewProps {
  result: TestResult;
  materialTitle: string | null;
  onBack: () => void;
  onRetake: () => void;
  /** Immediately after finishing, versus reopening from the list. */
  justFinished: boolean;
  /** Current mastery for this test's lesson (null while loading); current, so advice stays right on a revisit. */
  materialMastery: MaterialMasteryDetail | null;
  /** Follow a recommendation. A callback, not a <Link>: a same-route link inside StudySpace does nothing. */
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

  // What this submission did to mastery: only right after finishing, sorted by weakest after-value.
  const masteryChanges: MasteryChange[] = useMemo(() => {
    if (!justFinished || !result.mastery_changes) return [];
    return [...result.mastery_changes].sort(
      (a, b) => a.after - b.after || a.term.localeCompare(b.term)
    );
  }, [justFinished, result.mastery_changes]);

  // Advice for this lesson (not the single weakest concept: an all-wrong test yields few distinct
  // mastery values). Not gated on justFinished. Renders nothing until the material row shows assessed
  // concepts, which can lag just after finishing.
  const nextUp = useMemo(() => {
    if (!materialMastery) return null;
    if (materialMastery.assessed_concept_count === 0) return null;

    const band = materialBand(materialMastery);
    // Nothing to add for advanced (and "take a test" would be absurd here).
    if (band === 'advanced') return null;

    return {
      rec: recommendMaterial({
        title: materialMastery.title,
        band,
        m_doc: materialMastery.m_doc,
      }),
      // The same chips listed in "Concepts to revisit".
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
      {/* Exit at the top so leaving needs no scrolling. */}
      <button
        onClick={onBack}
        className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
      >
        <ArrowLeft className="w-4 h-4" /> Exit
      </button>

      {/* Score */}
      {/* The hero card gets the theme-glow lift. */}
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

      {/* Section breakdown */}
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
                {/* MeterBar toned by score (a test % means the same on any material). The fraction stays beside it. */}
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

      {/* Concepts to revisit */}
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
                {/* Only when asked > 1 (currently every concept is asked once). */}
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

      {/* Mastery updated: shown only on the request that completed the test, separate from the score ring. */}
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
            {/* Keyed on a Fragment: without @types/react, `key` isn't an accepted prop of a local component. */}
            {masteryChanges.map((c) => (
              <Fragment key={c.concept_id}>
                <MasteryRow change={c} />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* What to do next */}
      {nextUp && (
        <div className={`${PANEL} p-4 sm:p-5`}>
          <h3 className={`${SECTION} mb-1 flex items-center gap-2`}>
            <Target className="w-3.5 h-3.5 text-primary-fixed-dim" /> What to do next
          </h3>
          <p className="font-sans text-xs text-slate-500 mb-4">{nextUp.rec.steps[0].why}</p>

          {/* No step is accented: nothing tracks progress through the steps, so the order is the recommendation. */}
          <div className="flex flex-col gap-2">
            {nextUp.rec.steps.map((s) => {
              /* Feynman and Flashcards steps carry the missed concepts (with a count); with none missed, neutral wording. */
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

          {/* Once per card, never per row. */}
          <p className="font-sans text-[11px] text-slate-600 mt-3 leading-relaxed">
            {nextUp.rec.honesty}
          </p>
        </div>
      )}

      {/* Question review */}
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
            {/* Keyed on a Fragment (see above). */}
            {shown.map((r) => (
              <Fragment key={r.index}>
                <ReviewRow result={r} formats={result.test.formats} />
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
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
 * One concept's before/after. When this test was the first evidence, `before` is P(L₀), so the row
 * reads "Not measured before". A drop is amber, never red.
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
      {/* tracking-wider so "Correct" doesn't wrap at 375px. */}
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
        /* Border only: CARD already sets a background, and two would resolve by CSS source order. */
        r.is_correct ? 'border-white/5' : 'border-rose-500/25'
      }`}
    >
      {/* items-start and min-w-0: long terms wrap, and centring would float the badge. */}
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
