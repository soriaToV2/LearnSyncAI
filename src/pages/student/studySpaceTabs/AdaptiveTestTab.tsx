import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronRight,
  Play,
  Plus,
  RefreshCw,
} from 'lucide-react';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { CARD, SECTION, scoreTone, toneText } from '../../../components/ui/surfaces';
import TestSessionView from '../components/TestSessionView';
import TestResultsView from '../components/TestResultsView';
import {
  ALL_FORMATS,
  FORMAT_META,
  MATCH_OPTIONS_PER_BLOCK,
  MATCH_TERMS_PER_BLOCK,
  allocateConcepts,
  orderedFormats,
  scorePercent,
  sectionLabel,
  testApi,
  type GeneratedTest,
  type QuestionFormat,
  type TestResult,
  type TestSummary,
} from '../../../lib/testMode';

/**
 * Test Mode.
 *
 * Five screens, one union — overview, setup, generating, session, results. The
 * session and results screens take over the tab by early return, the same way
 * `FlashcardsTab` hands off to `FlashcardStudyView`.
 *
 * There is deliberately NO mastery panel. BKT is not implemented yet, so every
 * `latent_mastery` is still the 0.10 seed; the version of this tab being
 * replaced filled that gap with a hardcoded array of neuroscience concepts and
 * a concept→material mapping invented by `idx % availableResources.length`.
 * What is shown instead is real test outcomes, which exist without BKT. The
 * mastery panel arrives with the BKT engine.
 */

type Screen = 'overview' | 'setup' | 'generating' | 'session' | 'results';

interface AdaptiveTestTabProps {
  spaceId: string;
  availableResources: { id: string; title: string; concept_count: number }[];
}

export default function AdaptiveTestTab({ spaceId, availableResources }: AdaptiveTestTabProps) {
  const [screen, setScreen] = useState<Screen>('overview');
  const [summaries, setSummaries] = useState<TestSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [activeTest, setActiveTest] = useState<GeneratedTest | null>(null);
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup form. The student picks a lesson and which sections to include — the
  // length is not theirs to choose, it is one question per concept.
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [formats, setFormats] = useState<QuestionFormat[]>(['multiple_choice', 'true_or_false']);

  /** Synchronous latch — `disabled` reads state that has not re-rendered yet, so
   *  a double-click would fire two generations and burn two model calls. */
  const inFlightRef = useRef(false);

  const materialTitle = (id: string | undefined | null) =>
    availableResources.find((r) => r.id === id)?.title ?? null;

  const refreshList = async () => {
    setIsLoadingList(true);
    try {
      setSummaries(await testApi.list(spaceId));
    } catch (err) {
      console.error('[TestMode] Failed to load tests:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // ── Derived setup values ──────────────────────────────────────────────────

  const chosenFormats = useMemo(() => orderedFormats(formats), [formats]);
  const material = availableResources.find((r) => r.id === materialId) ?? null;
  const conceptCount = material?.concept_count ?? 0;

  /** Matching needs six definitions for its option pool, so six concepts minimum. */
  const matchingTooSmall =
    chosenFormats.includes('matching_type') &&
    conceptCount > 0 &&
    conceptCount < MATCH_OPTIONS_PER_BLOCK;

  /**
   * The preview. Recomputed server-side in Phase 2 from the real concept count —
   * this only tells the student what they are about to sit.
   */
  const allocation = useMemo(
    () =>
      allocateConcepts(
        conceptCount,
        matchingTooSmall ? chosenFormats.filter((f) => f !== 'matching_type') : chosenFormats
      ),
    [conceptCount, chosenFormats, matchingTooSmall]
  );
  const total = allocation.covered;
  /** Matching-only rounds down to whole blocks, so a few concepts get no question. */
  const uncovered = conceptCount - total;
  const canGenerate = Boolean(materialId) && total > 0;

  const toggleFormat = (format: QuestionFormat) => {
    setFormats((prev) => {
      const next = prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format];
      return next.length === 0 ? prev : orderedFormats(next); // at least one section, always
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  const openSetup = (presetMaterialId?: string) => {
    setError(null);
    if (presetMaterialId) setMaterialId(presetMaterialId);
    else if (!materialId && availableResources.length === 1) setMaterialId(availableResources[0].id);
    setScreen('setup');
  };

  const handleGenerate = async () => {
    if (!materialId || !canGenerate) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setScreen('generating');
    try {
      // Formats only. The server counts concepts and re-derives the length —
      // `allocation` here is the preview, not the instruction.
      const test = await testApi.generate({
        space_id: spaceId,
        material_id: materialId,
        formats: allocation.items.map((i) => i.format),
      });
      setActiveTest(test);
      setScreen('session');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build this test. Try again.');
      setScreen('setup');
    } finally {
      inFlightRef.current = false;
    }
  };

  const openSummary = async (summary: TestSummary) => {
    setError(null);
    try {
      if (summary.status === 'in_progress') {
        setActiveTest(await testApi.resume(summary.id));
        setScreen('session');
      } else {
        setActiveResult(await testApi.fetchResult(summary.id));
        setJustFinished(false);
        setScreen('results');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that test.');
    }
  };

  const backToOverview = () => {
    setActiveTest(null);
    setActiveResult(null);
    setScreen('overview');
    void refreshList();
  };

  // ── Takeover screens ──────────────────────────────────────────────────────

  if (screen === 'session' && activeTest) {
    return (
      <TestSessionView
        test={activeTest}
        materialTitle={materialTitle(activeTest.material_id)}
        onExit={backToOverview}
        onFinish={(result) => {
          setActiveResult(result);
          setActiveTest(null);
          setJustFinished(true);
          setScreen('results');
          void refreshList();
        }}
      />
    );
  }

  if (screen === 'results' && activeResult) {
    return (
      <TestResultsView
        result={activeResult}
        materialTitle={materialTitle(activeResult.test.material_id)}
        justFinished={justFinished}
        onBack={backToOverview}
        onRetake={() => {
          const from = activeResult.test.material_id;
          setActiveResult(null);
          openSetup(from);
        }}
      />
    );
  }

  // ── Generating ────────────────────────────────────────────────────────────

  if (screen === 'generating') {
    return (
      <div className="animate-in fade-in duration-300 max-w-lg mx-auto py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 flex items-center justify-center mx-auto mb-6">
          <RefreshCw className="w-6 h-6 text-primary-fixed-dim animate-spin" />
        </div>
        <h2 className="font-display text-xl font-semibold text-white mb-2">Writing your test…</h2>
        {/* Measured 1.6s for a 29-question test across all five sections. The
            earlier 17-21s readings were Groq's rate-limit backoff, not writing. */}
        <p className="font-sans text-sm text-slate-500 leading-relaxed">
          This usually takes a few seconds. The questions are being written from{' '}
          <span className="text-slate-300">{materialTitle(materialId)}</span>, so they only cover what
          your teacher uploaded.
        </p>
      </div>
    );
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  if (screen === 'setup') {
    return (
      <div className="animate-in fade-in duration-300 max-w-3xl mx-auto pb-10 px-2">
        <button
          onClick={() => setScreen('overview')}
          className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-xs uppercase tracking-widest mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className={`${CARD} p-5 sm:p-7 space-y-8`}>
          <Step n={1} title="Lesson">
            <SingleSelectDropdown
              selectedValue={materialId}
              onChange={setMaterialId}
              options={availableResources.map((r) => ({ value: r.id, label: r.title }))}
              placeholder="Select a lesson..."
            />
            {material && (
              <p className="font-sans text-xs text-slate-500 mt-2">
                {conceptCount} concept{conceptCount === 1 ? '' : 's'} available in this lesson.
              </p>
            )}
          </Step>

          <Step n={2} title="Question types">
            <div className="grid sm:grid-cols-2 gap-2.5">
              {ALL_FORMATS.map((format) => {
                const meta = FORMAT_META[format];
                const on = chosenFormats.includes(format);
                const Icon = meta.icon;
                return (
                  <button
                    key={format}
                    onClick={() => toggleFormat(format)}
                    className={`flex items-start gap-3 text-left p-3.5 rounded-xl border transition-all ${
                      on
                        ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/50'
                        : 'bg-surface-container/30 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${
                        on ? 'bg-primary-fixed-dim/20' : 'bg-white/5'
                      }`}
                    >
                      {on ? (
                        <Check className="w-4 h-4 text-primary-fixed-dim" />
                      ) : (
                        <Icon className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`font-sans text-sm font-semibold ${on ? 'text-white' : 'text-slate-300'}`}>
                        {meta.label}
                      </p>
                      <p className="font-sans text-xs text-slate-500 leading-relaxed mt-0.5">{meta.blurb}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* Read-only on purpose. The length is one question per concept — see
              allocateConcepts(). A picker meant repeating concepts to fill it. */}
          <Step n={3} title="Your test">
            {!material ? (
              <p className="font-sans text-sm text-slate-500">Pick a lesson to see your test.</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2.5 mb-1">
                  <span className="font-display text-3xl font-bold text-white tabular-nums">{total}</span>
                  <span className="font-sans text-sm text-slate-400">
                    question{total === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="font-sans text-xs text-slate-500 mb-5">
                  One for every concept in this lesson — so nothing gets asked twice.
                </p>

                <div className="space-y-2">
                  {allocation.items.map(({ format, count }) => (
                    <div
                      key={format}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-container/20 border border-white/5"
                    >
                      <span className="font-display text-xs font-bold text-primary-fixed-dim w-16 shrink-0">
                        {sectionLabel(
                          allocation.items.map((i) => i.format),
                          format
                        )}
                      </span>
                      <span className="font-sans text-sm text-slate-300 flex-1 min-w-0 truncate">
                        {FORMAT_META[format].label}
                      </span>
                      <span className="font-display text-sm font-bold text-slate-300 tabular-nums shrink-0">
                        {count}
                        {format === 'matching_type' && (
                          <span className="font-sans text-[10px] font-medium text-slate-500 ml-1.5">
                            {count / MATCH_TERMS_PER_BLOCK} block
                            {count / MATCH_TERMS_PER_BLOCK === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Step>

          {(matchingTooSmall || allocation.matchingDropped || uncovered > 0 || error) && (
            <div className="space-y-2">
              {matchingTooSmall && (
                <Note tone="poor">
                  Matching needs {MATCH_OPTIONS_PER_BLOCK} concepts to fill its list of choices, and
                  this lesson has {conceptCount}. It has been left out of this test.
                </Note>
              )}
              {allocation.matchingDropped && !matchingTooSmall && (
                <Note tone="mid">
                  Matching works in groups of {MATCH_TERMS_PER_BLOCK}, and there aren't enough
                  concepts left for a full group once the other sections take theirs. It has been
                  left out of this test.
                </Note>
              )}
              {uncovered > 0 && (
                <Note tone="mid">
                  Matching works in groups of {MATCH_TERMS_PER_BLOCK}, so this test covers {total} of
                  the {conceptCount} concepts. Add another question type to cover the rest.
                </Note>
              )}
              {error && <Note tone="poor">{error}</Note>}
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              className="w-full px-6 py-3 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              {total > 0 ? `Start Test · ${total} question${total === 1 ? '' : 's'}` : 'Start Test'}
            </button>
            <p className="font-sans text-[11px] text-slate-600 text-center mt-2.5">
              Usually takes a few seconds to write.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  const completed = summaries.filter((s) => s.status === 'completed');
  const avgScore =
    completed.length > 0
      ? Math.round(
          (completed.reduce((sum, s) => sum + (s.score ?? 0), 0) / completed.length) * 100
        )
      : null;
  const itemsAnswered = summaries.reduce((sum, s) => sum + s.answered, 0);
  const noMaterials = availableResources.length === 0;

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            <BrainCircuit className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-white tracking-tight truncate">
              Test Mode
            </h2>
            {/* Says nothing about BKT on purpose. It is not implemented, and when
                it is, difficulty is chosen when the test is BUILT from a mastery
                snapshot — the old copy claimed it adapted mid-test. */}
            <p className="font-sans text-xs text-slate-500 mt-0.5 truncate">
              Practice tests built from your lesson materials.
            </p>
          </div>
        </div>

        <button
          onClick={() => openSetup()}
          disabled={noMaterials}
          className="px-5 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> New Test
        </button>
      </div>

      {error && (
        <div className="mt-5">
          <Note tone="poor">{error}</Note>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Tests taken" value={String(completed.length)} />
        <Stat
          label="Average score"
          value={avgScore === null ? '—' : `${avgScore}%`}
          tone={avgScore === null ? undefined : scoreTone(avgScore)}
        />
        <Stat label="Items answered" value={String(itemsAnswered)} />
      </div>

      <div className="mt-8">
        <h3 className={`${SECTION} mb-4`}>Past tests</h3>

        {isLoadingList ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
          </div>
        ) : summaries.length === 0 ? (
          <div className={`${CARD} py-16 px-6 text-center`}>
            <BrainCircuit className="w-10 h-10 text-slate-500 opacity-20 mx-auto mb-4" />
            <p className="font-sans text-sm text-slate-400 mb-1">
              {noMaterials ? 'No lessons in this study space yet.' : 'No tests yet.'}
            </p>
            <p className="font-sans text-xs text-slate-600">
              {noMaterials
                ? 'Add a lesson from the Learning Resources tab to build a test from it.'
                : 'Generate one from a lesson to see how much has stuck.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Keyed on a Fragment, not on SummaryRow: this project has no
                `@types/react`, so a locally-declared component's props are
                enforced exactly and `key` is not among them. */}
            {summaries.map((s) => (
              <Fragment key={s.id}>
                <SummaryRow
                  summary={s}
                  materialTitle={materialTitle(s.material_id)}
                  onOpen={() => void openSummary(s)}
                />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-5 h-5 rounded-md bg-white/5 flex items-center justify-center font-display text-[11px] font-bold text-slate-400">
          {n}
        </span>
        <h3 className={SECTION}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Note({ tone, children }: { tone: 'mid' | 'poor'; children: ReactNode }) {
  const styles =
    tone === 'poor'
      ? 'bg-rose-500/10 border-rose-500/20 text-rose-200'
      : 'bg-amber-500/10 border-amber-500/20 text-amber-200';
  return (
    <div className={`flex items-start gap-2.5 px-4 py-2.5 rounded-xl border ${styles}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <p className="font-sans text-xs leading-relaxed">{children}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: ReturnType<typeof scoreTone> }) {
  return (
    <div className={`${CARD} p-4 text-center`}>
      <p className={`font-display text-xl font-bold tabular-nums ${tone ? toneText[tone] : 'text-white'}`}>
        {value}
      </p>
      <p className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-1">
        {label}
      </p>
    </div>
  );
}

function SummaryRow({
  summary,
  materialTitle,
  onOpen,
}: {
  summary: TestSummary;
  materialTitle: string | null;
  onOpen: () => void;
}) {
  const inProgress = summary.status === 'in_progress';
  const percent = summary.score === null ? null : scorePercent(summary.score);

  return (
    <button
      onClick={onOpen}
      className={`${CARD} w-full text-left p-4 flex items-center gap-4 hover:bg-surface-container-lowest/70 transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-sans text-sm font-semibold text-white truncate">
            {materialTitle ?? summary.title}
          </span>
          {inProgress && (
            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider shrink-0">
              In progress
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-sans text-[11px] text-slate-500">{formatDate(summary.created_at)}</span>
          <span className="text-slate-700">·</span>
          {orderedFormats(summary.formats).map((f) => (
            <span
              key={f}
              className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] font-semibold text-slate-400"
              title={FORMAT_META[f].label}
            >
              {FORMAT_META[f].short}
            </span>
          ))}
        </div>
      </div>

      <div className="text-right shrink-0">
        {inProgress ? (
          <span className="font-sans text-xs font-semibold text-primary-fixed-dim">
            {summary.answered}/{summary.total} answered
          </span>
        ) : (
          <>
            <p className={`font-display text-lg font-bold ${toneText[scoreTone(percent ?? 0)]}`}>
              {percent}%
            </p>
            <p className="font-sans text-[10px] text-slate-500 tabular-nums">
              {summary.total} items
            </p>
          </>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
    </button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
