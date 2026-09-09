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
 * Test Mode.
 *
 * Five screens, one union — overview, setup, generating, session, results. The
 * session and results screens take over the tab by early return, the same way
 * `FlashcardsTab` hands off to `FlashcardStudyView`.
 *
 * MASTERY IS NOT REPORTED HERE — the Analytics tab owns it, with the per-lesson
 * and per-concept breakdown behind it. A space-wide mastery tile briefly sat in
 * the stat row and was removed as a second readout of a figure that already had
 * a home; two of them can only ever agree or be a bug.
 *
 * What mastery IS still used for in this tab is the sentence on the setup
 * screen, and that is not a duplicate: it states the reading and the tier BEFORE
 * a test is generated, which is what makes the adaptation visible to a human and
 * is exactly the paper's Difficulty Alignment check (p. 98). It is shown only
 * once `assessed_concept_count > 0`, because every unassessed concept counts as
 * the P(L₀) = 0.10 prior inside EQ(4) — so a student who has done nothing still
 * averages 0.10, and printing that as "10%" would tell them they know a tenth of
 * a lesson they have never touched.
 */

type Screen = 'overview' | 'setup' | 'generating' | 'session' | 'results';

/* `TIER_TONE` and `TIER_LABEL` moved to `src/lib/mastery.ts` when the Analytics
   tab became a second consumer — mastery is fed by flashcards as well as tests,
   so it is not a Test Mode concept. The reasoning for `foundational` being
   NEUTRAL rather than `poor` travelled with them. */

interface AdaptiveTestTabProps {
  spaceId: string;
  availableResources: { id: string; title: string; concept_count: number }[];
  /** A recommendation's destination. Only `materialId` means anything here. */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
  /**
   * Follow a recommendation from the results screen.
   *
   * ⚠️ A CALLBACK, NOT A `<Link>`. This tab renders inside `StudySpace`, so a
   * link carrying `?tab=feynman` would be a same-route navigation: the URL would
   * change and the tab would not.
   */
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
  /*
   * ⚠️ `detail()`, NOT `space()`, SINCE THE RESULTS SCREEN STARTED RECOMMENDING.
   * The summary carries no concepts, and the advice on that screen is keyed on
   * the mastery of the concepts THIS TEST asked about — including when a student
   * reopens the test days later, where the completion payload is long gone.
   *
   * This does not contradict "`/mastery` is Test Mode's hot path — do not widen
   * it": that rule protects the ENDPOINT's shape for its other callers. Switching
   * which endpoint this caller uses leaves the lean one lean. `SpaceMasteryDetail`
   * is a superset of `SpaceMastery`, so the setup screen's tier sentence is
   * unchanged. Measured 10.7 KB for 57 concepts — the Analytics tab already pays
   * this on every mount.
   */
  const [mastery, setMastery] = useState<SpaceMasteryDetail | null>(null);
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

  /**
   * Current mastery for whichever lesson the open result belongs to — the
   * results screen's source for its lesson-scoped recommendation.
   *
   * Recomputed whenever `refreshList()` lands, so it is fresh on mount, after a
   * submission, and on returning to the overview. Null while loading, or if the
   * mastery read failed, in which case the results screen shows no advice rather
   * than guessing.
   */
  const resultMaterialMastery = useMemo(() => {
    const id = activeResult?.test.material_id;
    if (!id) return null;
    return mastery?.by_material.find((m) => m.material_id === id) ?? null;
  }, [mastery, activeResult]);

  /*
   * A recommendation sent the student here to be tested on one lesson.
   *
   * ⚠️ IT OPENS THE SETUP SCREEN AND STOPS THERE. It deliberately does not
   * generate: one test is five `gemini-3.6-flash` calls against a bucket that is
   * ~20/day on a free key and is shared with concept extraction, Feynman grading,
   * flashcard fronts and every game. A recommender is a quota amplifier by
   * construction, so the one-click path from advice to five model calls is the
   * one it must not have.
   *
   * `openSetup()` already existed and already takes a preset lesson — this is a
   * new caller, not new behaviour. The id is validated first for the same reason
   * the other tabs validate theirs: `SingleSelectDropdown` resolves by `.find`,
   * so an unknown id would show the placeholder while `materialId` was set.
   */
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

  /*
   * Mastery is refreshed HERE rather than on its own, so it reloads at every
   * point the list already does — including straight after a test is submitted,
   * which is the one moment the number has just changed and the student is
   * looking at it. A separate fetch would go stale exactly then.
   *
   * A mastery failure must not blank the past-tests list, so it has its own
   * catch: the list is real data the student can still use.
   */
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

  // ── Derived setup values ──────────────────────────────────────────────────

  const chosenFormats = useMemo(() => orderedFormats(formats), [formats]);
  const material = availableResources.find((r) => r.id === materialId) ?? null;
  const conceptCount = material?.concept_count ?? 0;
  const selectedMastery = mastery?.by_material.find((m) => m.material_id === materialId) ?? null;

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
          // Here and not on the results screen itself: `openSummary` also lands
          // there when a student opens a PAST test, and re-celebrating a badge
          // every time they review an old score would be nonsense. `onFinish`
          // runs only after PUT /complete resolved, which is also the point the
          // badge has certainly been written.
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

  // ── Generating ────────────────────────────────────────────────────────────

  if (screen === 'generating') {
    return (
      <div className="fade-in duration-300 max-w-lg mx-auto py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 flex items-center justify-center mx-auto mb-6">
          <Spinner className="w-6 h-6 text-primary-fixed-dim" />
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
            {/* The one place the adaptivity is visible to a human, and precisely
                what the paper's Difficulty Alignment check (p. 98) is about:
                the mastery reading, and the tier it produces, BEFORE the prompt
                is written. Shown only once there is evidence — at a cold start
                the tier is foundational for everyone, which says nothing. */}
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
                    /* These are toggles, and the on/off state was carried only by
                       background colour — nothing announced it, and there was no
                       focus ring, so the setup screen's main control could not be
                       operated or understood without sight. */
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
            {/* PAST TENSE, deliberately. Difficulty is chosen once, when the
                test is BUILT, from a mastery snapshot taken at that moment —
                paper p. 81 calls it session-based adaptation. An older version
                of this copy claimed the test adapted mid-session, which it has
                never done. */}
            <p className="font-sans text-xs text-slate-500 mt-0.5 truncate">
              Practice tests built from your lesson materials, set to what you have already mastered.
            </p>
          </div>
        </div>

        {/* `w-full` on mobile: the header stacks below `sm`, and at its natural
            width this sat left-aligned and orphaned under the subtitle. */}
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

      {/* Three tiles, all of them about TESTS. A space-wide mastery figure used
          to sit here as a fourth; it moved to the Analytics tab, which shows the
          same number with the per-lesson and per-concept breakdown behind it.
          Two readouts of one figure invite them to disagree. What stays in this
          tab is the mastery sentence on the setup screen, which is not a
          duplicate — it explains why the test about to be generated is the
          difficulty it is. */}
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
          /* Entrance on the loaded list, not on the spinner above it — the
             spinner is what is on screen while `animate-page-fade` would be
             running, so an entrance up there is over before a single past test
             arrives. Same rule everywhere in the app. */
          <div className="space-y-2 animate-tab-in">
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

/**
 * `p-3` on phones, not `p-4`. Three tiles across a 320px screen leave ~88px each,
 * and `p-4` cut that to 56px of content — narrower than "ANSWERED" renders at 10px
 * with `tracking-widest`. The tinted icon is what stops the row reading as three
 * interchangeable numbers; only Average score was ever coloured, and only then
 * because it happens to carry a tone.
 */
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
