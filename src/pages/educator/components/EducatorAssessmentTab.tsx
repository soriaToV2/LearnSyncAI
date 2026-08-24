import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { toCsv } from '../../../lib/csvAccounts';
import {
  assessmentApi,
  type AssessmentResults,
  type EducatorAssessmentView,
} from '../../../lib/assessments';

/**
 * The material's Pre / Post Test tab — TEMPORARY research instrument.
 *
 * Removed after the school study, along with the tab entry in `MaterialDetail`
 * that mounts it. It serves paper RQ4 (p. 55): the significance of the difference
 * between a student's standard pre-test score and their post-test score.
 *
 * Mounted only while active, so entering the tab refetches — the same
 * freshness-by-construction `ClassPerformance` gets, and the reason there is no
 * cache and no refresh button here either.
 */

interface AssessmentTabProps {
  materialId: string;
  materialTitle: string;
  conceptCount: number;
  parsedStatus: string;
}

const MIN_CONCEPTS = 5;
const THIN_CONCEPTS = 10;

export default function EducatorAssessmentTab({
  materialId,
  materialTitle,
  conceptCount,
  parsedStatus,
}: AssessmentTabProps) {
  const [view, setView] = useState<EducatorAssessmentView | null>(null);
  const [results, setResults] = useState<AssessmentResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'generate' | 'pre' | 'post' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, rows] = await Promise.all([
        assessmentApi.forMaterial(materialId),
        assessmentApi.results(materialId).catch(() => null),
      ]);
      setView(next);
      setResults(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the test.');
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assessment = view?.assessment ?? null;
  const attempts = view?.attempts ?? { pre: 0, post: 0, total: 0 };
  const frozen = attempts.total > 0;

  const generate = async () => {
    setBusy('generate');
    setError(null);
    try {
      setView(await assessmentApi.generate(materialId));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (phase: 'pre' | 'post', next: boolean) => {
    setBusy(phase);
    setError(null);
    try {
      await assessmentApi.release(materialId, { [`${phase}_released`]: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change who can see this test.');
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = () => {
    if (!results) return;
    // csvCell()/toCsv() rather than a join: a surname like "Dela Cruz, Jr." would
    // otherwise split into two columns and shift every score one cell across.
    const rows = results.students.map((s) => [
      s.last_name,
      s.first_name,
      String(s.grade_level),
      s.pre_correct === null ? '' : String(s.pre_correct),
      s.post_correct === null ? '' : String(s.post_correct),
      s.gain === null ? '' : String(s.gain),
      String(results.item_count),
    ]);
    const csv = toCsv(
      ['last_name', 'first_name', 'grade_level', 'pre_score', 'post_score', 'gain', 'total_items'],
      rows
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prepost-${materialTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const started = useMemo(
    () => results?.students.filter((s) => s.pre_correct !== null).length ?? 0,
    [results]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="font-sans text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {!assessment ? (
        <EmptyState
          conceptCount={conceptCount}
          parsedStatus={parsedStatus}
          busy={busy === 'generate'}
          onGenerate={() => void generate()}
        />
      ) : (
        <>
          {/* ── Release controls ── */}
          <section className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="font-display text-base text-white">
                  {assessment.item_count} questions, two versions
                </h3>
                <p className="font-sans text-xs text-slate-400 mt-1 max-w-lg leading-relaxed">
                  Both tests ask about the same {assessment.item_count} concepts with the same answers
                  and the same four choices. Only the wording and the order of the choices differ, so
                  the two scores can be compared directly.
                </p>
              </div>
              <button
                onClick={() => void generate()}
                disabled={frozen || busy !== null}
                title={
                  frozen
                    ? 'Students have already answered these questions. Changing them now would make the before-and-after scores meaningless.'
                    : 'Write a fresh set of questions'
                }
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container/60 border border-white/10 text-slate-300 font-sans text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:border-white/25 transition-colors"
              >
                {busy === 'generate' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Regenerate
              </button>
            </div>

            {/* ⚠️ STATUS FIRST, ADVICE SECOND.
                Generating and releasing are two steps, and the gap between them is
                where this screen was misread: an educator who has just watched a
                36-second spinner finish reasonably assumes the test is live. It is
                not — nothing is visible to a student and no lesson is locked until
                a phase is released. So the screen states what students can see
                RIGHT NOW, before it gives any advice about when to release. */}
            {!assessment.pre_released_at ? (
              <p className="mt-4 font-sans text-xs text-slate-300 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 leading-relaxed flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-white">No student can see this test yet</strong>, and the
                  lesson is not locked. The questions are written and saved — open the pre-test below
                  when you are ready for the class to take it.
                </span>
              </p>
            ) : (
              <p className="mt-4 font-sans text-xs text-emerald-200/80 bg-emerald-500/[0.07] border border-emerald-500/20 rounded-lg px-3 py-2.5 leading-relaxed flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  The <strong className="text-emerald-100">
                    {assessment.post_released_at ? 'post-test' : 'pre-test'}
                  </strong>{' '}
                  is open. Students in this grade must finish it before they can open the lesson.
                </span>
              </p>
            )}

            {/* Operational copy, and it closes the one real hole in the lock: a
                material is visible to students the moment it is uploaded, so an
                educator who uploads at 9:00 and releases at 9:10 has ten minutes
                of contaminated baseline. */}
            <p className="mt-2 font-sans text-xs text-amber-200/70 bg-amber-500/[0.07] border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
              Release the pre-test <strong className="text-amber-200">before</strong> you tell students
              the lesson is available. Until they finish it they cannot open the PDF, use the chatbot,
              or study this lesson with any of the tools — which is what makes their score a fair
              starting point. If the lesson is already out, Archive it while you set this up.
            </p>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              {/* The pre-test cannot be closed while the post-test is open, so the
                  control says why in advance instead of letting the educator click
                  and read a 422. Same rule, stated before the attempt. */}
              <ReleaseCard
                label="Pre-Test"
                blurb="Before they study. Locks the lesson until taken."
                releasedAt={assessment.pre_released_at}
                takenCount={attempts.pre}
                busy={busy === 'pre'}
                disabled={busy !== null || Boolean(assessment.post_released_at)}
                disabledHint={
                  assessment.post_released_at
                    ? 'Open · close the post-test before closing this'
                    : undefined
                }
                onToggle={(next) => void toggle('pre', next)}
              />
              <ReleaseCard
                label="Post-Test"
                blurb="After they have studied. Same questions, reworded."
                releasedAt={assessment.post_released_at}
                takenCount={attempts.post}
                busy={busy === 'post'}
                disabled={busy !== null || !assessment.pre_released_at}
                disabledHint={
                  !assessment.pre_released_at ? 'Release the pre-test first.' : undefined
                }
                onToggle={(next) => void toggle('post', next)}
              />
            </div>
          </section>

          {/* ── Results ── */}
          {results && results.students.length > 0 && (
            <section className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 p-5">
              <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                <div>
                  <h3 className="font-display text-base text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    Scores
                  </h3>
                  {/* Names the denominator, like classCaption() on Class Performance.
                      Students who have started nothing are LISTED, not filtered —
                      "nineteen of twenty have not sat this" is the finding. */}
                  <p className="font-sans text-xs text-slate-500 mt-1">
                    {started} of {results.students.length} students have taken the pre-test · out of{' '}
                    {results.item_count}
                  </p>
                </div>
                <button
                  onClick={downloadCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-xs font-semibold hover:bg-primary-fixed-dim/15 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                </button>
              </div>

              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full min-w-[30rem] text-left">
                  <thead>
                    <tr className="font-sans text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="pb-2 pr-3 font-semibold">Student</th>
                      <th className="pb-2 px-3 font-semibold text-right">Pre</th>
                      <th className="pb-2 px-3 font-semibold text-right">Post</th>
                      <th className="pb-2 pl-3 font-semibold text-right">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.students.map((s) => (
                      <tr key={s.student_id} className="border-t border-white/5">
                        <td className="py-2 pr-3">
                          <p className="font-sans text-sm text-slate-200 truncate">
                            {s.last_name}, {s.first_name}
                          </p>
                          <p className="font-sans text-[10px] text-slate-500">Grade {s.grade_level}</p>
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-sm text-slate-300 tabular-nums">
                          {s.pre_correct ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-sm text-slate-300 tabular-nums">
                          {s.post_correct ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2 pl-3 text-right font-sans text-sm tabular-nums">
                          {s.gain === null ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <span
                              className={
                                s.gain > 0
                                  ? 'text-emerald-400'
                                  : s.gain < 0
                                    ? 'text-amber-400'
                                    : 'text-slate-400'
                              }
                            >
                              {s.gain > 0 ? '+' : ''}
                              {s.gain}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Item preview ──
              INLINE, not in a Modal. Twenty items with two wordings each runs to
              roughly sixty rows, and `Modal` has no max-height with an
              overflow-hidden panel inside an items-center wrapper — it would
              overflow both edges, exactly as it did for ImportAccountsModal. */}
          <section className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 p-5">
            <h3 className="font-display text-base text-white mb-1">The questions</h3>
            <p className="font-sans text-xs text-slate-500 mb-4">
              Students never see the answer. Check that each pair describes the same idea in genuinely
              different words.
            </p>

            <div className="space-y-3">
              {assessment.items.map((item) => (
                <div key={item.index} className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="w-5 h-5 shrink-0 rounded-md bg-white/5 text-slate-400 flex items-center justify-center font-sans text-[10px] font-bold">
                      {item.index + 1}
                    </span>
                    <span className="font-sans text-xs font-semibold text-emerald-400 truncate">
                      {item.answer}
                    </span>
                    <span className="font-sans text-[10px] text-slate-500 truncate">
                      also offered: {item.options_pre.filter((o) => o !== item.answer).join(' · ')}
                    </span>
                  </div>
                  <dl className="space-y-1.5">
                    <div className="flex gap-2.5">
                      <dt className="shrink-0 font-sans text-[10px] font-bold uppercase tracking-wider text-slate-500 w-9 pt-0.5">
                        Pre
                      </dt>
                      <dd className="font-sans text-xs text-slate-300 leading-relaxed">{item.pre_stem}</dd>
                    </div>
                    <div className="flex gap-2.5">
                      <dt className="shrink-0 font-sans text-[10px] font-bold uppercase tracking-wider text-slate-500 w-9 pt-0.5">
                        Post
                      </dt>
                      <dd className="font-sans text-xs text-slate-300 leading-relaxed">{item.post_stem}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState({
  conceptCount,
  parsedStatus,
  busy,
  onGenerate,
}: {
  conceptCount: number;
  parsedStatus: string;
  busy: boolean;
  onGenerate: () => void;
}) {
  const notReady = parsedStatus !== 'completed';
  const tooFew = conceptCount < MIN_CONCEPTS;
  const thin = !tooFew && conceptCount < THIN_CONCEPTS;
  const willWrite = Math.min(20, conceptCount);

  return (
    <div className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 p-8 text-center">
      <ClipboardList className="w-8 h-8 text-slate-600 mx-auto mb-3" />
      <h3 className="font-display text-base text-white">No pre-test or post-test yet</h3>

      <p className="font-sans text-sm text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
        {notReady
          ? 'This material is still being read. Once concept extraction finishes you can write its tests here.'
          : tooFew
            ? `This material has ${conceptCount} concept${conceptCount === 1 ? '' : 's'}. A test needs at least ${MIN_CONCEPTS}, because every question offers four different terms to choose from.`
            : `This material has ${conceptCount} concepts. Generating will write ${willWrite} multiple-choice question${willWrite === 1 ? '' : 's'}, spread across the whole lesson — as a pre-test and a matching post-test in one go.`}
      </p>

      {thin && !notReady && (
        <p className="font-sans text-xs text-amber-200/70 mt-3 max-w-md mx-auto leading-relaxed">
          With only {conceptCount} concepts the test will be short, so each question moves the score by
          a lot. Add concepts on the Concepts tab first if you want a finer measurement.
        </p>
      )}

      <button
        onClick={onGenerate}
        disabled={notReady || tooFew || busy}
        className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-black font-display text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? 'Writing questions — please wait…' : 'Generate pre-test & post-test'}
      </button>

      {/* MEASURED, NOT ESTIMATED: 36.1s for 20 items on a 30-concept material.
          Forty sentences is a lot of output even at MINIMAL thinking. "A few
          seconds" was the estimate and it was wrong by an order of magnitude —
          which matters, because an educator who thinks it has hung will reload
          the page and pay for a second generation. */}
      {!notReady && !tooFew && (
        <p className="font-sans text-[11px] text-slate-600 mt-3">
          {busy
            ? 'This takes about half a minute. Do not close this page.'
            : 'Takes about half a minute.'}
        </p>
      )}
    </div>
  );
}

/**
 * One phase's release switch.
 *
 * Un-releasing is offered deliberately: a released phase locks the lesson until
 * the student completes it, so this toggle is the only way back for a student who
 * will not sit the test. It destroys no attempts — the same property archiving
 * and re-grading rely on — and the copy says so.
 */
function ReleaseCard({
  label,
  blurb,
  releasedAt,
  takenCount,
  busy,
  disabled,
  disabledHint,
  onToggle,
}: {
  label: string;
  blurb: string;
  releasedAt: string | null;
  takenCount: number;
  busy: boolean;
  disabled: boolean;
  disabledHint?: string;
  onToggle: (next: boolean) => void;
}) {
  const released = !!releasedAt;
  return (
    <div
      className={`rounded-xl border p-3.5 ${released ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${released ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-slate-500'}`}
        >
          {released ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-white">{label}</p>
          <p className="font-sans text-[11px] text-slate-500 mt-0.5 leading-relaxed">{blurb}</p>
          {/* A hint wins over the plain status, in BOTH directions. It used to be
              shown only when unreleased, which silently swallowed the reason the
              pre-test cannot be closed while the post-test is open. */}
          <p className="font-sans text-[11px] text-slate-400 mt-1.5">
            {disabled && disabledHint
              ? disabledHint
              : released
                ? `Open · ${takenCount} student${takenCount === 1 ? '' : 's'} taken`
                : 'Hidden from students — nothing is locked'}
          </p>
        </div>
      </div>

      <button
        onClick={() => onToggle(!released)}
        disabled={disabled}
        className={`w-full mt-3 px-3 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          released
            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
            : 'bg-primary-fixed-dim text-black'
        }`}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
        ) : released ? (
          'Close it again'
        ) : (
          `Open the ${label.toLowerCase()}`
        )}

      </button>
    </div>
  );
}
