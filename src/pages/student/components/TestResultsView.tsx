import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, RotateCcw, Target, Trophy, X } from 'lucide-react';
import { CARD, LABEL, SECTION, scoreTone, toneText } from '../../../components/ui/surfaces';
import {
  FORMAT_META,
  displayAnswer,
  formatElapsed,
  orderedFormats,
  scorePercent,
  sectionLabel,
  type QuestionFormat,
  type QuestionResult,
  type TestResult,
} from '../../../lib/testMode';

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

interface TestResultsViewProps {
  result: TestResult;
  materialTitle: string | null;
  onBack: () => void;
  onRetake: () => void;
  /** Immediately after finishing, versus reopening from the list. */
  justFinished: boolean;
}

export default function TestResultsView({
  result,
  materialTitle,
  onBack,
  onRetake,
  justFinished,
}: TestResultsViewProps) {
  const [filter, setFilter] = useState<'all' | 'incorrect'>('all');

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
    `px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors ${
      filter === mode ? 'bg-surface-container-high text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="animate-in fade-in duration-300 max-w-3xl mx-auto space-y-5 pb-10">
      {/* Leaving must not require scrolling past 29 review cards to reach the
          footer. Same placement and styling as the session view's exit. */}
      <button
        onClick={onBack}
        className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest"
      >
        <ArrowLeft className="w-4 h-4" /> Exit
      </button>

      {/* ── Score ─────────────────────────────────────────────────────────── */}
      <div className={`${CARD} p-6 sm:p-8 text-center relative overflow-hidden`}>
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
              <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
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
      <div className={`${CARD} p-5`}>
        <h3 className={`${SECTION} mb-4`}>By section</h3>
        <div className="space-y-3">
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
                  <span className="font-display text-xs font-bold text-slate-300 tabular-nums shrink-0">
                    {correct}/{total}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary-fixed-dim/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Concepts to revisit ───────────────────────────────────────────── */}
      {result.missed_concepts.length > 0 && (
        <div className={`${CARD} p-5`}>
          <h3 className={`${SECTION} mb-1 flex items-center gap-2`}>
            <Target className="w-3.5 h-3.5" /> Concepts to revisit
          </h3>
          <p className="font-sans text-xs text-slate-500 mb-4">
            Worked out from the questions you missed — these are the parts of the lesson to go back to.
          </p>
          <div className="flex flex-wrap gap-2">
            {result.missed_concepts.map((c) => (
              <span
                key={c.concept_id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
              >
                <span className="font-sans text-xs font-semibold text-slate-200">{c.term}</span>
                <span className="font-sans text-[10px] text-slate-500 tabular-nums">
                  {c.wrong} of {c.asked} wrong
                </span>
              </span>
            ))}
          </div>
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
          <div className={`${CARD} p-8 text-center`}>
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
          className="flex-1 px-5 py-3 rounded-xl bg-white text-black font-sans text-sm font-semibold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> New test on this lesson
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 py-3">
      <p className="font-display text-lg font-bold text-white tabular-nums">{value}</p>
      <p className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-0.5">
        {label}
      </p>
    </div>
  );
}

function ReviewRow({ result: r, formats }: { result: QuestionResult; formats: QuestionFormat[] }) {
  return (
    <div className={`${CARD} p-4 sm:p-5 border ${r.is_correct ? 'border-white/5' : 'border-rose-500/20'}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {sectionLabel(formats, r.format)} · Q{r.index + 1} · {r.concept_term}
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 ${
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
