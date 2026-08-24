import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Lock,
  PlayCircle
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { CARD, LABEL, SECTION, scoreTone, toneText, type Tone } from '../../../components/ui/surfaces';
import { scorePercent } from '../../../lib/testMode';
import AssessmentRunner from '../components/AssessmentRunner';
import {
  assessmentApi,
  PHASE_LABEL,
  type AssessmentItem,
  type AssessmentPhase,
  type AssessmentResult,
  type AssessmentSummary,
} from '../../../lib/assessments';

/**
 * The Pre-Test / Post-Test tab — TEMPORARY research instrument.
 *
 * ══ WHICH TEST TAB IS THIS? THERE ARE THREE, AND TWO USED TO SHARE A FILENAME ══
 *   · THIS FILE — the STUDENT half of the pre/post instrument: sit the test.
 *     Mounted TWICE by `StudySpace`, once per phase. Temporary.
 *   · `educator/components/EducatorAssessmentTab.tsx` — the EDUCATOR half of this
 *     same instrument: writes the items and releases each phase. Temporary.
 *   · `AdaptiveTestTab.tsx`, its NEIGHBOUR IN THIS VERY FOLDER — "Test Mode". A
 *     different, PERMANENT feature and no relation, despite sitting next to this
 *     one in the same tab bar. The distinction that matters:
 *
 *       Test Mode asks "how are you doing?"  — adapts to BKT mastery, unlimited
 *         retakes, five question formats, WRITES `bkt_mastery`.
 *       This asks "did the platform work?"   — never adapts (a standard pre-test
 *         must not), ONE attempt per phase, MCQ only, writes NOTHING that feeds
 *         the platform — not even `activity_logs`, so it cannot extend a streak.
 *
 * Both halves were named `AssessmentTab.tsx` until the filenames were split, which
 * made them indistinguishable in an editor tab bar and in a code review.
 *
 * ONE component, `phase`-flipped, rather than two near-identical files. The only
 * behavioural difference between the phases is what the results screen may show,
 * and that is decided by the SERVER (`studentResult()` withholds the review on a
 * pre-test), so a second component would duplicate everything and vary nothing.
 *
 * Removed after the school study along with the two tab entries that mount it.
 */

interface StudentAssessmentTabProps {
  spaceId: string;
  phase: AssessmentPhase;
  /** The parent's lock-map refetch. Completing a test unlocks a material, and the
   *  material pickers in the other tabs read that map — so not calling this would
   *  leave the lesson locked until a full page reload. */
  onLocksChanged: () => void;
}

interface OpenAttempt {
  attemptId: string;
  materialTitle: string;
  items: AssessmentItem[];
  answers: Record<string, string>;
}

export default function StudentAssessmentTab({ spaceId, phase, onLocksChanged }: StudentAssessmentTabProps) {
  const [rows, setRows] = useState<AssessmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenAttempt | null>(null);
  const [justFinished, setJustFinished] = useState<{ title: string; result: AssessmentResult } | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await assessmentApi.forSpace(spaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your tests.');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async (row: AssessmentSummary) => {
    setStarting(row.assessment_id);
    setError(null);
    try {
      const attempt = await assessmentApi.start(row.assessment_id, phase);
      if (attempt.status === 'completed') {
        // Somebody finished it in another tab. Show the score rather than an error.
        setJustFinished({ title: row.material_title, result: attempt.result });
        await load();
        onLocksChanged();
        return;
      }
      setOpen({
        attemptId: attempt.attempt_id,
        materialTitle: row.material_title,
        items: attempt.items,
        answers: attempt.answers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the test.');
    } finally {
      setStarting(null);
    }
  };

  const finish = (title: string, result: AssessmentResult) => {
    setOpen(null);
    setJustFinished({ title, result });
    void load();
    onLocksChanged();
  };

  // Takeover, exactly as Test Mode does it: the results screen replaces the list
  // rather than sitting above it, so a student is not reading their score with a
  // "Start" button for the same test still on screen.
  if (justFinished) {
    return (
      <ResultsView
        title={justFinished.title}
        phase={phase}
        result={justFinished.result}
        onDone={() => setJustFinished(null)}
      />
    );
  }

  if (open) {
    return (
      <AssessmentRunner
        attemptId={open.attemptId}
        phase={phase}
        materialTitle={open.materialTitle}
        items={open.items}
        initialAnswers={open.answers}
        onFinished={(result) => finish(open.materialTitle, result)}
        onExit={() => {
          setOpen(null);
          void load();
        }}
      />
    );
  }

  const available = rows.filter((r) => r[phase].released);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="w-5 h-5 text-slate-500" />
      </div>
    );
  }

  /* `animate-tab-in` on the LOADED content, never on the loading branch above —
     the entrance has to fire on the transition the reader sees. See the TAB
     PANEL entrance note in `index.css`. */
  return (
    <div className="max-w-3xl animate-tab-in">
      <header className="mb-6">
        <h2 className="font-display text-xl text-white flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary-fixed-dim" />
          {PHASE_LABEL[phase]}
        </h2>
        <p className="font-sans text-sm text-slate-400 mt-1 leading-relaxed">
          {phase === 'pre'
            ? 'A short check of what you already know, before you start studying. You are not expected to know the answers yet — that is the point.'
            : 'The same lessons again, now that you have studied them. Same number of questions, worded differently.'}
        </p>
      </header>

      {error && (
        <p className="mb-4 font-sans text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {available.length === 0 ? (
        <div className={`${CARD} p-8 text-center`}>
          <ClipboardList className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="font-display text-sm text-slate-300">
            No {PHASE_LABEL[phase].toLowerCase()} yet
          </p>
          <p className="font-sans text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
            {phase === 'pre'
              ? 'Your teacher has not opened a pre-test for any lesson in this study space.'
              : 'Your teacher opens the post-test after you have had time to study. It will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={SECTION}>
            {available.length} lesson{available.length === 1 ? '' : 's'}
          </p>
          {available.map((row) => {
            const state = row[phase];
            const busy = starting === row.assessment_id;
            // The post-test needs a completed pre-test — the server refuses
            // otherwise (409). Saying so here means the student reads an
            // instruction instead of an error.
            const needsPre = phase === 'post' && !row.pre.taken;
            return (
              /*
               * Stacks on phones. As a single `flex items-center` row the icon,
               * the gaps and the Start button took ~150px of a 375px screen, so
               * the status line — "20 questions · this lesson stays locked until
               * you finish" — wrapped to three lines in the ~158px left over,
               * beside a button. This is the entry point to the research
               * instrument, so it is the one row that must read cleanly: below
               * `sm` the text gets the full width and Start becomes a full-width
               * control under it.
               */
              <div
                key={row.assessment_id}
                className={`${CARD} p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 border ${
                  state.taken || needsPre ? 'border-white/5' : 'border-primary-fixed-dim/30'
                }`}
              >
                <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  <div
                    className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
                      state.taken
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : needsPre
                          ? 'bg-white/5 text-slate-500'
                          : 'bg-primary-fixed-dim/10 text-primary-fixed-dim'
                    }`}
                  >
                    {state.taken ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm text-white truncate">{row.material_title}</p>
                    <p className="font-sans text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {state.taken ? (
                        <>
                          Done — {state.correct_count ?? 0} of {row.item_count} correct
                          {state.completed_at ? ` · ${formatDate(state.completed_at)}` : ''}
                        </>
                      ) : needsPre ? (
                        <span className="text-amber-400/80">
                          Take the pre-test for this lesson first
                        </span>
                      ) : (
                        <>
                          {row.item_count} questions · this lesson stays locked until you finish
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {!state.taken && (
                  <button
                    onClick={() => void start(row)}
                    disabled={busy || needsPre}
                    title={needsPre ? 'The pre-test comes first — it is your starting score.' : undefined}
                    className="w-full sm:w-auto shrink-0 px-3.5 py-2.5 sm:py-2 rounded-lg bg-primary-fixed-dim text-black font-display text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {busy ? <Spinner className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                    Start
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/**
 * The results view — same shape as `TestResultsView` in Test Mode: exit link,
 * score ring, stat row, then the per-question review.
 *
 * ⚠️ THE PRE-TEST SHOWS A SCORE AND NOTHING ELSE, and the SERVER enforces it —
 * `result.review` is simply absent on a pre-test, so there is no per-question
 * breakdown to render even if this file asked for one. Pre and post share every
 * answer; a pre-test review would hand over the post-test's key weeks early.
 *
 * ⚠️ THE PRE-TEST RING IS A FIXED NEUTRAL TONE, never `scoreTone()`. Test Mode
 * colours by score because there the score is an achievement. A pre-test score is
 * a BASELINE taken before the student has studied — 4/20 is the expected result,
 * not a failure, and painting it red tells a student something untrue about
 * themselves before they have begun. The post-test is a real attainment measure
 * and colours normally.
 */
function ResultsView({
  title,
  phase,
  result,
  onDone,
}: {
  title: string;
  phase: AssessmentPhase;
  result: AssessmentResult;
  onDone: () => void;
}) {
  const percent = scorePercent(result.score);
  const tone: Tone = phase === 'pre' ? 'neutral' : scoreTone(result.score);
  const circumference = 2 * Math.PI * 54;
  const missed = result.total - result.correct_count;

  return (
    <div className="fade-in duration-300 max-w-3xl mx-auto space-y-5 pb-10">
      <button
        onClick={onDone}
        className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs sm:text-sm uppercase tracking-widest"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* ── Score ─────────────────────────────────────────────────────────── */}
      <div className={`${CARD} p-6 sm:p-8 text-center relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-5">
            <ClipboardList className={`w-7 h-7 ${toneText[tone]}`} />
          </div>

          <h2 className="font-display text-2xl font-bold text-white mb-1">
            {PHASE_LABEL[phase]} submitted
          </h2>
          <div className="flex items-center justify-center gap-2 mb-6">
            <BookOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className={`${LABEL} truncate`} title={title}>{title}</span>
          </div>

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
                {phase === 'pre' ? 'Starting Point' : 'Post-Test'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto mb-5">
            <div className="bg-surface-container/40 rounded-xl px-3 py-2.5">
              <p className="font-display text-lg text-white tabular-nums">
                {result.correct_count}/{result.total}
              </p>
              <p className={LABEL}>Correct</p>
            </div>
            <div className="bg-surface-container/40 rounded-xl px-3 py-2.5">
              <p className="font-display text-lg text-white tabular-nums">{missed}</p>
              <p className={LABEL}>Missed</p>
            </div>
          </div>

          <p className="font-sans text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
            {phase === 'pre'
              ? 'This is your starting point, not a grade — you had not studied the lesson yet. The lesson is unlocked now, so go and study it.'
              : 'Well done. This asked about the same lessons you were checked on before you started.'}
          </p>
        </div>
      </div>

      {/* ── Review — POST-TEST ONLY, and only because the server sent it ──── */}
      {result.review && (
        <div className={`${CARD} p-5`}>
          <p className={`${SECTION} mb-4`}>Your answers</p>
          <div className="space-y-3">
            {result.review.map((row) => (
              <div
                key={row.index}
                className={`rounded-xl border p-3.5 ${
                  row.is_correct
                    ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                    : 'border-rose-500/20 bg-rose-500/[0.04]'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center font-display text-xs font-bold ${
                      row.is_correct ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                    }`}
                  >
                    {row.index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-sans text-sm text-slate-200 leading-relaxed">{row.prompt}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                      <span
                        className={`font-sans text-xs ${
                          row.is_correct ? 'text-emerald-400' : 'text-slate-500 line-through'
                        }`}
                      >
                        {row.student_answer ?? 'Not answered'}
                      </span>
                      {!row.is_correct && (
                        <span className="font-sans text-xs text-emerald-400">{row.correct_answer}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full px-6 py-3 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all"
      >
        Done
      </button>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
