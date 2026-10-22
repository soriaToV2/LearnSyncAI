import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronRight,
  ClipboardList,
  ListChecks,
  Play,
  Plus,
  TrendingUp
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { CARD, SECTION, scoreTone, toneText } from '../../../components/ui/surfaces';
import TestSessionView from '../components/TestSessionView';
import TestResultsView from '../components/TestResultsView';
import { useBadges } from '../../../context/BadgeContext';
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
import {
  masteryApi,
  masteryPercent,
  TIER_LABEL,
  TIER_TONE,
  type SpaceMastery,
  type SpaceMasteryDetail,
} from '../../../lib/mastery';
import type { StudyIntent } from '../../../lib/studySpace';

/**
 * Test Mode: overview, setup, generating, session, results (the last two take over the tab).
 * Mastery itself lives in the Analytics tab. Here it only drives the setup sentence stating the
 * reading and tier before generation (paper p. 98), shown once something is assessed.
 */

type Screen = 'overview' | 'setup' | 'generating' | 'session' | 'results';

/* TIER_TONE and TIER_LABEL live in src/lib/mastery.ts. */

interface AdaptiveTestTabProps {
  spaceId: string;
  availableResources: { id: string; title: string; concept_count: number }[];
  /** A recommendation's destination; only materialId applies here. */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
  /** Follow a recommendation from the results screen. A callback, not a <Link> (same-route links do nothing). */
  onNavigate: (intent: StudyIntent) => void;
}

export default function AdaptiveTestTab({
  spaceId,
  availableResources,
  preselect,
  onPreselectConsumed,
  onNavigate,
}: AdaptiveTestTabProps) {
  const { celebrate } = useBadges();
  const [screen, setScreen] = useState<Screen>('overview');
  const [summaries, setSummaries] = useState<TestSummary[]>([]);
  // detail(), not space(): the results screen's advice needs per-concept mastery for this test's lesson.
  const [mastery, setMastery] = useState<SpaceMasteryDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [activeTest, setActiveTest] = useState<GeneratedTest | null>(null);
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup: lesson and sections only; length is one question per concept.
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [formats, setFormats] = useState<QuestionFormat[]>(['multiple_choice', 'true_or_false']);

  /** Synchronous latch so a double-click can't trigger two generations. */
  const inFlightRef = useRef(false);

  const materialTitle = (id: string | undefined | null) =>
    availableResources.find((r) => r.id === id)?.title ?? null;

  /** Current mastery for the open result's lesson; refreshed with the list. Null while loading or on failure (no advice then). */
  const resultMaterialMastery = useMemo(() => {
    const id = activeResult?.test.material_id;
    if (!id) return null;
    return mastery?.by_material.find((m) => m.material_id === id) ?? null;
  }, [mastery, activeResult]);

  // A recommendation opens setup on its lesson and stops: generating is five model calls, so it must
  // never be one click from advice. The id is validated first.
  useEffect(() => {
    if (!preselect) return;
    if (preselect.materialId && availableResources.some((r) => r.id === preselect.materialId)) {
      openSetup(preselect.materialId);
    }
    onPreselectConsumed();
    // `openSetup` is a plain function redefined each render and only ever sets
    // state; including it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, availableResources, onPreselectConsumed]);

  // Refresh mastery with the list (including right after a submission); its own catch so a failure can't blank the list.
  const refreshList = async () => {
    setIsLoadingList(true);
    try {
      setSummaries(await testApi.list(spaceId));
    } catch (err) {
      console.error('[TestMode] Failed to load tests:', err);
    } finally {
      setIsLoadingList(false);
    }
    try {
      setMastery(await masteryApi.detail(spaceId));
    } catch (err) {
      console.error('[TestMode] Failed to load mastery:', err);
    }
  };

  useEffect(() => {
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Derived setup values

  const chosenFormats = useMemo(() => orderedFormats(formats), [formats]);
  const material = availableResources.find((r) => r.id === materialId) ?? null;
  const conceptCount = material?.concept_count ?? 0;
  const selectedMastery = mastery?.by_material.find((m) => m.material_id === materialId) ?? null;

  /** Matching needs six definitions, so six concepts minimum. */
  const matchingTooSmall =
    chosenFormats.includes('matching_type') &&
    conceptCount > 0 &&
    conceptCount < MATCH_OPTIONS_PER_BLOCK;

  /** Preview only; the server derives the real allocation. */
  const allocation = useMemo(
    () =>
      allocateConcepts(
        conceptCount,
        matchingTooSmall ? chosenFormats.filter((f) => f !== 'matching_type') : chosenFormats
      ),
    [conceptCount, chosenFormats, matchingTooSmall]
  );
  const total = allocation.covered;
  /** Matching-only rounds down to whole blocks. */
  const uncovered = conceptCount - total;
  const canGenerate = Boolean(materialId) && total > 0;

  const toggleFormat = (format: QuestionFormat) => {
    setFormats((prev) => {
      const next = prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format];
      return next.length === 0 ? prev : orderedFormats(next); // at least one section, always
    });
  };

  // Actions

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
      // Formats only; the server derives the length.
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

  // Takeover screens

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
          // Badge check here, not on the results screen (which also shows past tests); runs after PUT /complete resolved.
          celebrate();
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
        materialMastery={resultMaterialMastery}
        onNavigate={onNavigate}
        onBack={backToOverview}
        onRetake={() => {
          const from = activeResult.test.material_id;
          setActiveResult(null);
          openSetup(from);
        }}
      />
    );
  }

  // Generating

  if (screen === 'generating') {
    return (
      <div className="fade-in duration-300 max-w-lg mx-auto py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 flex items-center justify-center mx-auto mb-6">
          <Spinner className="w-6 h-6 text-primary-fixed-dim" />
        </div>
        <h2 className="font-display text-xl font-semibold text-white mb-2">Writing your test…</h2>
        {/* Typically a couple of seconds. */}
        <p className="font-sans text-sm text-slate-500 leading-relaxed">
          This usually takes a few seconds. The questions are being written from{' '}
          <span className="text-slate-300">{materialTitle(materialId)}</span>, so they only cover what
          your teacher uploaded.
        </p>
      </div>
    );
  }

  // Setup

  if (screen === 'setup') {
    return (
      <div className="fade-in duration-300 max-w-3xl mx-auto pb-10 px-2">
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
            {/* The mastery reading and tier before generation (Difficulty Alignment, p. 98), once there's evidence. */}
            {selectedMastery && selectedMastery.assessed_concept_count > 0 && (
              <p className="font-sans text-xs text-slate-400 mt-2">
                Your mastery here is{' '}
                <span className={`font-semibold ${toneText[TIER_TONE[selectedMastery.tier]]}`}>
                  {masteryPercent(selectedMastery.m_doc)}%
                </span>
                , so this test will be built at{' '}
                <span className={`font-semibold ${toneText[TIER_TONE[selectedMastery.tier]]}`}>
                  {TIER_LABEL[selectedMastery.tier].toLowerCase()}
                </span>{' '}
                level.
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
                    /* Toggles: state is announced (aria) and focusable, not colour alone. */
                    aria-pressed={on}
                    className={`flex items-start gap-3 text-left p-3.5 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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

          {/* Read-only: one question per concept. */}
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
                          <span className="font-sans text-[11px] font-medium text-slate-500 ml-1.5">
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
              className="w-full px-6 py-3 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

  // Overview

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
    <div className="fade-in duration-300 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            <BrainCircuit className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-white tracking-tight truncate">
              Test Mode
            </h2>
            {/* Past tense: difficulty is chosen once, when the test is built (paper p. 81). */}
            <p className="font-sans text-xs text-slate-500 mt-0.5 truncate">
              Practice tests built from your lesson materials, set to what you have already mastered.
            </p>
          </div>
        </div>

        {/* w-full on mobile so it doesn't sit orphaned under the subtitle. */}
        <button
          data-tour="at-new-test"
          onClick={() => openSetup()}
          disabled={noMaterials}
          className="w-full sm:w-auto px-5 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> New Test
        </button>
      </div>

      {error && (
        <div className="mt-5">
          <Note tone="poor">{error}</Note>
        </div>
      )}

      {/* Three test tiles; space mastery lives in the Analytics tab. */}
      <div data-tour="at-stats" className="grid grid-cols-3 gap-2.5 sm:gap-3 mt-6">
        <Stat icon={ClipboardList} label="Tests taken" value={String(completed.length)} />
        <Stat
          icon={TrendingUp}
          label="Average score"
          value={avgScore === null ? '—' : `${avgScore}%`}
          tone={avgScore === null ? undefined : scoreTone(avgScore)}
        />
        <Stat icon={ListChecks} label="Items answered" value={String(itemsAnswered)} />
      </div>

      <div data-tour="at-past-tests" className="mt-8">
        <h3 className={`${SECTION} mb-4`}>Past tests</h3>

        {isLoadingList ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="w-5 h-5 text-slate-500" />
          </div>
        ) : summaries.length === 0 ? (
          <div className={`${CARD} py-16 px-6 text-center animate-tab-in`}>
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
          /* Entrance on the loaded list, not the spinner. */
          <div className="space-y-2 animate-tab-in">
            {/* Keyed on a Fragment: without @types/react, `key` isn't an accepted prop of a local component. */}
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

/** p-3 on phones so three tiles fit 320px. The tinted icon distinguishes the numbers. */
function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string;
  tone?: ReturnType<typeof scoreTone>;
}) {
  return (
    <div className={`${CARD} border border-white/5 p-3 sm:p-4 text-center`}>
      <Icon className={`w-4 h-4 mx-auto mb-1.5 ${tone ? toneText[tone] : 'text-primary-fixed-dim'}`} />
      <p className={`font-display text-xl font-bold tabular-nums ${tone ? toneText[tone] : 'text-white'}`}>
        {value}
      </p>
      <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-1 leading-tight">
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
      className={`${CARD} w-full text-left p-4 flex items-center gap-3 sm:gap-4 border border-white/5 hover:border-white/15 hover:bg-surface-container-lowest/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
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
            <p className="font-sans text-[11px] text-slate-500 tabular-nums">
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
