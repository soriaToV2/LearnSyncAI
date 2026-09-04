import { useState, useEffect, useRef } from 'react';
import { Brain, CheckCircle2, XCircle, AlertTriangle, PenTool, History, ChevronLeft } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { api } from '../../../lib/api';
import {
  CARD, LABEL, SECTION,
  CognitiveTabShell, VerdictBanner, FeedbackCard, Collapsible, AttemptsList,
  AttemptMaterial, materialLabel,
  type AttemptSummary, type Tone, type ViewMode,
  NoMaterialsNotice,
} from './cognitiveShared';
import { useBadges } from '../../../context/BadgeContext';
import { useOnboarding } from '../../../context/OnboardingContext';

interface FreeRecallTabProps {
  availableResources: { id: string; title: string }[];
  spaceId: string;
}

// The shape returned from GET /api/cognitive/history/:spaceId
interface CognitiveLog {
  id: string;
  mode: 'free_recall';
  user_input: string;
  similarity_score: number | null;
  ai_feedback: string | null; // JSON string — see ParsedFeedback
  /**
   * Which material this attempt was scored against. Needed to compare an attempt
   * only to earlier attempts on the SAME material — coverage denominators differ
   * per material, so a cross-material comparison would be meaningless.
   */
  material_ids?: string[];
  created_at: string;
}

// Written coaching on the attempt. Null when generation failed — the score is
// still saved, so the tab shows a note rather than treating it as an error.
interface WrittenFeedback {
  /**
   * The whole written response — what landed, what did not, and a closing
   * action naming its page. Optional only because attempts logged before the
   * merge carry `summary`/`next_steps` instead; see `feedbackText()`.
   */
  feedback?: string;
  /**
   * Statements that contradict the lesson's own definitions. Usually empty —
   * the backend is told silence is the right answer unless the lesson text
   * settles it.
   */
  corrections?: string;

  /** @deprecated Read-only, for attempts stored before the fields were merged. */
  summary?: string;
  /** @deprecated Read-only, for attempts stored before the fields were merged. */
  next_steps?: string;
}

/**
 * The passage to display, whichever shape the attempt was stored in.
 *
 * Older rows hold `summary` and `next_steps` as separate fields; joining them
 * reads as the single passage newer rows already are, so History renders one
 * card throughout and nothing needed migrating.
 */
function feedbackText(wf: WrittenFeedback): string {
  return wf.feedback ?? [wf.summary, wf.next_steps].filter(Boolean).join(' ');
}

// Parsed feedback from the ai_feedback JSON column
interface ParsedFeedback {
  missed_concepts: string[];
  /**
   * Stored by the backend, deliberately NOT displayed. It came from fixed
   * thresholds applied to a ratio whose denominator changes with the material,
   * so an 86% answer and a 36% one containing two factual errors both read
   * "strong". Use progressLine() instead — do not wire this back into the UI.
   */
  overall_verdict: 'strong' | 'partial' | 'needs_review';
  /** Absent on attempts logged before written feedback shipped. */
  written_feedback?: WrittenFeedback | null;
  /** Absent on attempts logged before the counts were recorded. */
  covered_count?: number;
  total_concepts?: number;
}

function parseFeedback(raw: string | null): ParsedFeedback {
  const fallback: ParsedFeedback = { missed_concepts: [], overall_verdict: 'partial', written_feedback: null };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as ParsedFeedback;
    return { ...parsed, written_feedback: parsed.written_feedback ?? null };
  } catch {
    return fallback;
  }
}

/**
 * How much the covered count must move before a direction is claimed.
 *
 * Free Recall's extraction step is a sampling call, so re-running the SAME text
 * gives a different answer: measured 14, 16 and 17 covered across three runs of
 * one material-6 submission — a spread of 3 on 28 concepts, about 11%. Calling a
 * 1-concept difference "improvement" would be reporting that noise back to the
 * student as progress they did not make.
 *
 * Proportional so it scales with the material: a 78-concept lesson has more room
 * to wobble in absolute terms than a 28-concept one.
 */
const meaningfulDelta = (total: number) => Math.max(2, Math.ceil(total * 0.1));

/**
 * The line under the count, and the only comparison this tab can honestly make.
 *
 * NOT a quality judgement. The old copy labelled attempts Strong / Partial /
 * Needs Review from fixed thresholds, but coverage is scored against whichever
 * material was selected, so the same standard of recall reads 86% on one lesson
 * and 36% on another — and both came back "Strong". A percentage is comparable
 * to ONE thing: the same student's earlier attempt at the same material, where
 * the denominator and the person are both held still.
 */
function progressLine(
  current: ParsedFeedback,
  previous: ParsedFeedback | null
): { text: string; tone: Tone } {
  const covered = current.covered_count;
  const total = current.total_concepts;

  if (covered === undefined || total === undefined) {
    return { text: 'Scored against the ideas in this material.', tone: 'neutral' };
  }
  if (!previous || previous.covered_count === undefined || previous.total_concepts !== total) {
    // Either their first go at this material, or the educator has since edited
    // it — a changed denominator makes the two numbers incomparable.
    return { text: 'This is your first attempt at this material.', tone: 'neutral' };
  }

  const before = previous.covered_count;
  const delta = covered - before;
  const was = `${before} of ${total}`;

  if (Math.abs(delta) < meaningfulDelta(total)) {
    return { text: `About the same as last time (${was}).`, tone: 'neutral' };
  }
  if (delta > 0) {
    return { text: `Up from ${was} last time.`, tone: 'good' };
  }
  // Amber, never red. A dip between attempts is ordinary in retrieval practice
  // and telling a student they have failed for it would be both wrong and unkind.
  return { text: `Down from ${was} last time.`, tone: 'mid' };
}

/** The headline: the honest count, or the percentage for rows predating it. */
function resultHeadline(f: ParsedFeedback, scorePercent: number): string {
  if (f.covered_count === undefined || f.total_concepts === undefined) {
    return `${scorePercent}% coverage`;
  }
  return `${f.covered_count} of ${f.total_concepts} ideas`;
}

export default function FreeRecallTab({ availableResources, spaceId }: FreeRecallTabProps) {
  // Keyed on material id, not title — two materials may share a title.
  const resourceOptions = availableResources.map(r => ({ value: r.id, label: r.title }));

  const [viewMode, setViewMode] = useState<ViewMode>('study');
  /** Exactly one material. The coverage ratio is scored against one lesson. */
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  // Composer state
  const [recallText, setRecallText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Guards against a double-click submitting twice; see handleEvaluate.
  const inFlightRef = useRef(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Two separate selections, deliberately. `resultLogId` is the attempt you
  // just submitted and is shown inside Study, so submitting never moves you
  // somewhere else. `historyLogId` is whatever you clicked in the History
  // list. Sharing one variable would make the two views fight over it.
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { celebrate } = useBadges();
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);

  /*
   * ⚠️ THE RESULT WALKTHROUGH IS DEFERRED TO HERE, AND IT HAS TO BE. The composer
   * and the results panel are mutually exclusive siblings in one slot, so the
   * walkthrough that taught the text box could not have gone on to point at the
   * score — it did not exist yet, and by the time it does the text box is gone.
   *
   * That is not a compromise. The coverage percentage is the single most misread
   * number in this app, and this explains it at the exact moment a student is
   * staring at it wondering why it says 31%. `startTour` is a no-op once seen.
   */
  const { startTour } = useOnboarding();
  useEffect(() => {
    if (viewMode !== 'study' || !resultLogId) return;
    const t = setTimeout(() => startTour('tool_free_recall_result'), 700);
    return () => clearTimeout(t);
  }, [viewMode, resultLogId, startTour]);
  const [showMissed, setShowMissed] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const activeLogId = viewMode === 'study' ? resultLogId : historyLogId;
  const activeLog = historyLogs.find(log => log.id === activeLogId);
  const activeFeedback = activeLog ? parseFeedback(activeLog.ai_feedback) : null;

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'history') setHistoryLogId(null);
    setShowMissed(false);
    setShowAnswer(false);
  };

  // ── Load history on mount ─────────────────────────────────
  useEffect(() => {
    async function fetchHistory() {
      setIsLoadingHistory(true);
      try {
        const res = await api.get<CognitiveLog[]>(`/cognitive/history/${spaceId}`);
        setHistoryLogs(res.data ?? []);
      } catch (err) {
        console.error('[FreeRecall] Failed to load history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
    fetchHistory();
  }, [spaceId]);

  // The API still takes an array — cognitive_logs.material_ids is UUID[] and older
  // attempts span several — but new submissions carry exactly one.
  const selectedMaterialIds = selectedMaterialId ? [selectedMaterialId] : [];

  const handleEvaluate = async () => {
    if (!recallText.trim() || selectedMaterialIds.length === 0) return;

    // Synchronous latch — the button's `disabled={isEvaluating}` cannot stop
    // this on its own. React does not re-render until this handler yields, so
    // two clicks in the same tick both see `isEvaluating === false` and both
    // submit. Two identical submissions then run their memo lookups before
    // either has written its row, so both miss it, both spend model calls, and
    // the same answer can come back with two different scores.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setIsEvaluating(true);
    setEvalError(null);

    try {
      const res = await api.post<{
        log_id: string;
        similarity_score: number;
        score_percent: number;
        covered_count: number;
        total_concepts: number;
        missed_concepts: string[];
        overall_verdict: 'strong' | 'partial' | 'needs_review';
        written_feedback: WrittenFeedback | null;
        feedback_unavailable: boolean;
        created_at: string;
      }>('/cognitive/free-recall', {
        space_id: spaceId,
        material_ids: selectedMaterialIds,
        user_input: recallText,
      });

      const result = res.data;

      // Mirror the API shape into a log entry so the result renders from the
      // same code path as a past attempt — one layout, not two.
      const newLog: CognitiveLog = {
        id: result.log_id,
        mode: 'free_recall',
        user_input: recallText,
        similarity_score: result.similarity_score,
        ai_feedback: JSON.stringify({
          missed_concepts: result.missed_concepts,
          overall_verdict: result.overall_verdict,
          written_feedback: result.written_feedback ?? null,
          covered_count: result.covered_count,
          total_concepts: result.total_concepts,
        }),
        // The POST response does not echo this back, and does not need to — the
        // client chose the material a moment ago.
        material_ids: selectedMaterialIds,
        created_at: result.created_at ?? new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      // Stays in Study — the result replaces the composer where the student
      // is already looking, rather than moving them into History.
      setResultLogId(newLog.id);
      setShowMissed(false);
      setShowAnswer(false);
      setRecallText('');
      // Both the fresh and the memo-hit server paths log activity, so a
      // resubmission can award a streak badge just as a first attempt can.
      celebrate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setEvalError(message);
    } finally {
      inFlightRef.current = false;
      setIsEvaluating(false);
    }
  };

  const startNewAttempt = () => {
    setResultLogId(null);
    setEvalError(null);
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const attempts: AttemptSummary[] = historyLogs.map(log => {
    const f = parseFeedback(log.ai_feedback);
    return {
      id: log.id,
      dateLabel: formatDate(log.created_at),
      scoreLabel: `${Math.round((log.similarity_score ?? 0) * 100)}%`,
      // One fixed tone for every attempt, matching the ring. A coverage
      // percentage is not comparable between materials, so a varying colour
      // would rank these attempts on a scale that does not exist — an attempt
      // on a coarse material would outrank a better one on a granular material
      // purely because of how the document was split. See progressLine().
      scoreTone: 'good' as Tone,
      // Which lesson this was graded against. A space can hold attempts on
      // several materials, whose denominators differ, so a bare score in this
      // list is not interpretable without it.
      meta: materialLabel(log.material_ids, availableResources) ?? undefined,
      preview: log.user_input,
    };
  });

  /**
   * The attempt immediately before `log` on the SAME material.
   *
   * `historyLogs` is newest-first, so the first older entry that matches is the
   * one to compare against. Matching on material is the whole point: a space can
   * hold attempts against several materials whose coverage denominators differ.
   */
  const previousAttempt = (log: CognitiveLog): ParsedFeedback | null => {
    const materials = (log.material_ids ?? []).join(',');
    if (!materials) return null;
    const idx = historyLogs.findIndex(l => l.id === log.id);
    if (idx < 0) return null;
    const earlier = historyLogs
      .slice(idx + 1)
      .find(l => (l.material_ids ?? []).join(',') === materials);
    return earlier ? parseFeedback(earlier.ai_feedback) : null;
  };

  // The result view, shared by both places it can appear: inside Study right
  // after submitting, and inside History when an attempt is selected.
  const resultView = (log: CognitiveLog, feedback: ParsedFeedback, showWriteAnother: boolean) => {
    const activeFeedback = feedback;
    const activeLog = log;
    const scorePercent = Math.round((activeLog.similarity_score ?? 0) * 100);
    const progress = progressLine(activeFeedback, previousAttempt(activeLog));
    return (
            /*
              ⚠️ `key` ON THE ATTEMPT ID, WHICH IS WHAT MAKES THE ENTRANCE FIRE
              AT ALL. This root always carried a fade, but clicking a different
              attempt in the History rail renders the same element type in the
              same position — so React reuses the DOM node, the class never
              changes, and a CSS animation only runs on mount. The result
              therefore swapped instantly with no transition, which reads as the
              page not having responded to the click. Keying on the log id makes
              each attempt its own node.

              It is correct in Study mode too: a new submission is a new log id,
              so the result animates in there exactly as before.
            */
            <div key={activeLog.id} className="space-y-5 animate-tab-in">
              {/* Named before the score, because the score cannot be read
                  without it: the denominator, the missed list and the progress
                  line all belong to one lesson. */}
              <AttemptMaterial label={materialLabel(activeLog.material_ids, availableResources)} />
              {/* The ring keeps the percentage — it is still the figure the
                  scoring produces — at a FIXED tone.

                  Constant is the requirement, not the particular colour: a tone
                  that VARIES with this percentage would re-assert the
                  cross-material judgement the verdict bands got wrong, because
                  the same standard of recall reads 86% on one material and 36%
                  on another. One unchanging colour ranks nothing. Do not swap
                  this for `scoreTone()` — its 80/60 cutoffs are absolute too.
                  The meaning lives on the progress line below, which compares
                  like with like. */}
              <div data-tour="fr-score">
              <VerdictBanner
                score={scorePercent}
                scoreSuffix="%"
                tone="good"
                verdictLabel={resultHeadline(activeFeedback, scorePercent)}
                description={progress.text}
                descriptionTone={progress.tone}
              />
              </div>

              {activeFeedback.written_feedback ? (
                <div className="space-y-3">
                  <h4 className={SECTION}>Feedback</h4>
                  {/* Deliberately NOT emerald. This one passage carries both
                      what landed and what did not, so a success colour would
                      misrepresent half of it. */}
                  {feedbackText(activeFeedback.written_feedback) && (
                    <FeedbackCard
                      icon={<Brain className="w-3.5 h-3.5" />}
                      label="How you did"
                      tone="text-slate-300"
                    >
                      {feedbackText(activeFeedback.written_feedback)}
                    </FeedbackCard>
                  )}
                  {/* Sits after the passage, not first: a 14-year-old should read
                      what they managed before what they got wrong. */}
                  {activeFeedback.written_feedback.corrections && (
                    <FeedbackCard
                      icon={<AlertTriangle className="w-3.5 h-3.5" />}
                      label="Worth double-checking"
                      tone="text-rose-400"
                    >
                      {activeFeedback.written_feedback.corrections}
                      {/* Said plainly, because the tally above will still count
                          the concept as covered — coverage measures whether you
                          wrote about an idea, not whether you had it right. */}
                      <p className="mt-2 text-xs text-slate-500">
                        This doesn't change your score — it's here so you can fix it before the next test.
                      </p>
                    </FeedbackCard>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2.5 bg-white/[0.03] rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <p className="font-sans text-sm text-slate-400 leading-relaxed">
                    Your score is saved. The written feedback couldn't be generated this time —
                    submit again if you'd like to try for it.
                  </p>
                </div>
              )}

              <div data-tour="fr-missed">
              <Collapsible
                title="Ideas you didn't mention"
                count={activeFeedback.missed_concepts.length}
                open={showMissed}
                onToggle={() => setShowMissed(v => !v)}
              >
                {activeFeedback.missed_concepts.length === 0 ? (
                  <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-4 py-2.5 rounded-xl w-fit">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-sans text-sm font-medium">All concepts covered</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeFeedback.missed_concepts.map((concept, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5">
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        <span className="font-sans text-sm text-slate-300 font-medium">{concept}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>
              </div>

              <Collapsible
                title="Your answer"
                open={showAnswer}
                onToggle={() => setShowAnswer(v => !v)}
              >
                <div className={`${CARD} p-5`}>
                  <p className="font-sans text-sm leading-loose text-slate-400 whitespace-pre-wrap">
                    {activeLog.user_input}
                  </p>
                </div>
              </Collapsible>

              {showWriteAnother && (
                <div className="pt-2">
                  <button
                    onClick={startNewAttempt}
                    className="w-full sm:w-auto px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    <PenTool className="w-4 h-4" /> Write another
                  </button>
                </div>
              )}
            </div>
    );
  };

  // Guarded on there being any lesson at all: without this the material
  // dropdown simply renders empty and the tab explains nothing. See
  // `NoMaterialsNotice`.
  const composer = availableResources.length === 0 ? <NoMaterialsNotice /> : (
            <div className="fade-in">
              <div data-tour="fr-material" className="flex flex-col items-start gap-1.5 mb-4">
                <span className={LABEL}>Material</span>
                <SingleSelectDropdown
                  selectedValue={selectedMaterialId}
                  onChange={setSelectedMaterialId}
                  options={resourceOptions}
                  placeholder="Select a material..."
                />
              </div>

              {evalError && (
                <div className="mb-4 flex items-start gap-2 bg-red-500/10 rounded-xl px-4 py-3 text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-sans">{evalError}</span>
                </div>
              )}

              <div data-tour="fr-input" className={`${CARD} p-5`}>
                <textarea
                  value={recallText}
                  onChange={(e) => setRecallText(e.target.value)}
                  placeholder={
                    selectedMaterialIds.length === 0
                      ? 'Select a material above to begin your recall...'
                      : 'Start typing everything you remember...'
                  }
                  disabled={isEvaluating}
                  className="w-full min-h-[45vh] bg-transparent border-none outline-none font-sans text-base sm:text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar disabled:opacity-50"
                  autoFocus
                />
              </div>

              <div className="py-4 flex items-center justify-between gap-4">
                <span className="font-sans text-xs text-slate-500 font-medium">
                  {recallText.split(/\s+/).filter(Boolean).length} words
                </span>
                <button
                  data-tour="fr-submit"
                  onClick={handleEvaluate}
                  disabled={!recallText.trim() || isEvaluating || selectedMaterialIds.length === 0}
                  className="px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isEvaluating ? (
                    <><Spinner className="w-4 h-4" /> Analyzing...</>
                  ) : (
                    'Evaluate Recall'
                  )}
                </button>
              </div>
            </div>
  );

  return (
    <CognitiveTabShell
      icon={<Brain className="w-5 h-5 text-primary-fixed-dim" />}
      title="Free Recall"
      subtitle="Write everything you remember, without looking."
      viewMode={viewMode}
      onViewModeChange={switchView}
    >
      {viewMode === 'study' ? (
        // `px-2` is load-bearing, not spacing. `overflow-y-auto` makes CSS
        // compute `overflow-x` to `auto` as well — a box cannot scroll one axis
        // and overflow visibly on the other — so this clips horizontally at its
        // content edge. The material dropdown sits flush at x=0, and its border,
        // ring and shadow were being sliced off. The padding keeps anything with
        // a shadow away from that edge.
        <div className="max-w-3xl mx-auto h-full overflow-y-auto no-scrollbar pb-10 px-2">
          {activeLog && activeFeedback ? resultView(activeLog, activeFeedback, true) : composer}
        </div>
      ) : (
        /*
         * ⚠️ ONE PANE AT A TIME BELOW `lg` — this is master/detail, and stacking
         * both on a phone gave the student TWO nested scroll regions: scroll the
         * attempts list, then scroll the attempt inside it. Neither could show
         * much, and it was not obvious which one a swipe would move.
         *
         * So under `lg` the list is the screen until an attempt is picked, then the
         * attempt is the screen until "All attempts" comes back. No new state does
         * this — `historyLogId` already records exactly that choice. From `lg` up
         * there is room for the real two-column layout, and both panes scroll
         * independently as before.
         */
        <div className="h-full flex flex-col lg:flex-row gap-5 lg:gap-6 fade-in">
          <AttemptsList
            title="Past Attempts"
            attempts={attempts}
            activeId={historyLogId}
            isLoading={isLoadingHistory}
            emptyLabel="No past attempts yet."
            onSelect={(id) => {
              setHistoryLogId(id);
              setShowMissed(false);
              setShowAnswer(false);
            }}
            className={historyLogId ? 'hidden lg:flex' : 'flex'}
          />

          {/* Same horizontal-clip rule as the study pane above. */}
          <div
            className={`flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10 px-2 ${
              historyLogId ? 'block' : 'hidden lg:block'
            }`}
          >
            {activeLog && activeFeedback ? (
              <div className="max-w-3xl">
                {/* Mobile only: the list is off-screen, so this is the way back.
                    On `lg` it is redundant — the list is sitting right there. */}
                <button
                  onClick={() => setHistoryLogId(null)}
                  className="lg:hidden mb-4 inline-flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
                >
                  <ChevronLeft className="w-4 h-4" /> All attempts
                </button>
                {resultView(activeLog, activeFeedback, false)}
              </div>
            ) : (
              /* `lg`-only by construction: below it this pane is hidden whenever
                 nothing is selected, because the list itself is the empty state. */
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-20">
                <History className="w-10 h-10 mb-4 opacity-20" />
                <p className="font-sans text-sm">Select a past attempt to view its score and feedback.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </CognitiveTabShell>
  );
}
