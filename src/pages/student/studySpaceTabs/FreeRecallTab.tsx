import { useMemo, useState, useEffect, useRef } from 'react';
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
import { masteryApi, masteryPercent } from '../../../lib/mastery';
import type { MaterialMasteryDetail } from '../../../lib/mastery';
import { byMaterialPriority } from '../../../lib/recommend';
import type { StudyIntent } from '../../../lib/studySpace';

interface FreeRecallTabProps {
  availableResources: { id: string; title: string }[];
  spaceId: string;
  /** A recommendation's destination. `conceptId` is ignored: Free Recall scores a whole material. */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
}

// Shape returned by GET /api/cognitive/history/:spaceId
interface CognitiveLog {
  id: string;
  mode: 'free_recall';
  user_input: string;
  similarity_score: number | null;
  ai_feedback: string | null; // JSON string — see ParsedFeedback
  /** The material scored against; attempts are compared only within the same material. */
  material_ids?: string[];
  created_at: string;
}

// Written coaching; null when generation failed (the score is still saved).
interface WrittenFeedback {
  /** One passage: what landed, what didn't, and a page-anchored action. Older rows use summary/next_steps (see feedbackText()). */
  feedback?: string;
  /** Statements contradicting the lesson's definitions; usually empty. */
  corrections?: string;

  /** @deprecated Read-only, for attempts stored before the fields were merged. */
  summary?: string;
  /** @deprecated Read-only, for attempts stored before the fields were merged. */
  next_steps?: string;
}

/** The passage to display, joining older summary/next_steps rows so History renders one card. */
function feedbackText(wf: WrittenFeedback): string {
  return wf.feedback ?? [wf.summary, wf.next_steps].filter(Boolean).join(' ');
}

// Parsed ai_feedback
interface ParsedFeedback {
  missed_concepts: string[];
  /** Stored but never displayed: fixed thresholds are meaningless across materials. Use progressLine(). */
  overall_verdict: 'strong' | 'partial' | 'needs_review';
  /** Absent on older attempts. */
  written_feedback?: WrittenFeedback | null;
  /** Absent on older attempts. */
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

/** Change in covered count needed before claiming a direction (extraction varies run to run; ~10%, at least 2). */
const meaningfulDelta = (total: number) => Math.max(2, Math.ceil(total * 0.1));

/**
 * The line under the count: a comparison with the student's previous attempt on the same material,
 * the only fair one. Not a quality judgement.
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
    // First attempt on this material, or the educator changed it (different denominator).
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
  // Amber, never red: dips between attempts are normal.
  return { text: `Down from ${was} last time.`, tone: 'mid' };
}

/** The headline: the count, or the percentage for older rows. */
function resultHeadline(f: ParsedFeedback, scorePercent: number): string {
  if (f.covered_count === undefined || f.total_concepts === undefined) {
    return `${scorePercent}% coverage`;
  }
  return `${f.covered_count} of ${f.total_concepts} ideas`;
}

export default function FreeRecallTab({
  availableResources,
  spaceId,
  preselect,
  onPreselectConsumed,
}: FreeRecallTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('study');
  /** Exactly one material. */
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  /** Per-lesson mastery for ordering and captioning the picker (read-only). On failure, keep the original order. */
  const [masteryByMaterial, setMasteryByMaterial] = useState<Map<string, MaterialMasteryDetail>>(
    () => new Map()
  );

  // Open on the recommended lesson, validated against availableResources (an unknown id shows the
  // placeholder while Evaluate stays live). Runs once: consumption nulls the prop.
  useEffect(() => {
    if (!preselect) return;
    if (preselect.materialId && availableResources.some((r) => r.id === preselect.materialId)) {
      setSelectedMaterialId(preselect.materialId);
    }
    onPreselectConsumed();
  }, [preselect, availableResources, onPreselectConsumed]);

  useEffect(() => {
    let cancelled = false;
    masteryApi
      .detail(spaceId)
      .then((d) => {
        if (cancelled) return;
        setMasteryByMaterial(new Map(d.by_material.map((m) => [m.material_id, m])));
      })
      .catch((err) => console.error('[FreeRecall] mastery load failed', err));
    return () => { cancelled = true; };
  }, [spaceId]);

  /** Weakest lesson first, then not started, then strongest, via rankOf() (not plain m_doc ascending). */
  const resourceOptions = useMemo(() => {
    const withMastery = availableResources.map((r) => {
      const m = masteryByMaterial.get(r.id);
      return {
        id: r.id,
        title: r.title,
        m_doc: m?.m_doc ?? 0,
        assessed_concept_count: m?.assessed_concept_count ?? 0,
      };
    });
    withMastery.sort(byMaterialPriority);
    // Keyed on material id: titles can repeat.
    return withMastery.map((r) => ({
      value: r.id,
      label: r.title,
      hint: r.assessed_concept_count > 0 ? `${masteryPercent(r.m_doc)}%` : 'not started',
    }));
  }, [availableResources, masteryByMaterial]);

  // Composer state
  const [recallText, setRecallText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Double-submit guard (see handleEvaluate).
  const inFlightRef = useRef(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Two selections: `resultLogId` (just submitted, shown in Study) and `historyLogId` (clicked in History).
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { celebrate } = useBadges();
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);

  // The result walkthrough runs once a result exists (it replaces the composer). It explains the coverage %.
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

  // Load history on mount
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

  // The API takes an array (older rows hold several); new submissions send one.
  const selectedMaterialIds = selectedMaterialId ? [selectedMaterialId] : [];

  const handleEvaluate = async () => {
    if (!recallText.trim() || selectedMaterialIds.length === 0) return;

    // Synchronous latch: `disabled` can't stop a same-tick double click, and two submissions would both
    // miss the memo and could score differently.
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

      // Shape the response like a log entry so it renders through the same path as past attempts.
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
        // The client already knows the material.
        material_ids: selectedMaterialIds,
        created_at: result.created_at ?? new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      // Stay in Study; the result replaces the composer.
      setResultLogId(newLog.id);
      setShowMissed(false);
      setShowAnswer(false);
      setRecallText('');
      // Both server paths log activity, so a resubmission can award a streak badge.
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
      // One fixed tone for every attempt: coverage isn't comparable across materials. See progressLine().
      scoreTone: 'good' as Tone,
      // The lesson, without which the score can't be interpreted.
      meta: materialLabel(log.material_ids, availableResources) ?? undefined,
      preview: log.user_input,
    };
  });

  /** The previous attempt on the same material (history is newest-first). */
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

  // The result view, shared by Study (after submitting) and History.
  const resultView = (log: CognitiveLog, feedback: ParsedFeedback, showWriteAnother: boolean) => {
    const activeFeedback = feedback;
    const activeLog = log;
    const scorePercent = Math.round((activeLog.similarity_score ?? 0) * 100);
    const progress = progressLine(activeFeedback, previousAttempt(activeLog));
    return (
            /* Keyed on the attempt id so React mounts a new node and the entrance animation replays. */
            <div key={activeLog.id} className="space-y-5 animate-tab-in">
              {/* Lesson name first: the score only makes sense against it. */}
              <AttemptMaterial label={materialLabel(activeLog.material_ids, availableResources)} />
              {/* The ring keeps a fixed tone; never scoreTone(), whose cutoffs are absolute. Meaning lives on the progress line. */}
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
                  {/* Not emerald: the passage covers both what landed and what didn't. */}
                  {feedbackText(activeFeedback.written_feedback) && (
                    <FeedbackCard
                      icon={<Brain className="w-3.5 h-3.5" />}
                      label="How you did"
                      tone="text-slate-300"
                    >
                      {feedbackText(activeFeedback.written_feedback)}
                    </FeedbackCard>
                  )}
                  {/* After the passage: what they managed comes first. */}
                  {activeFeedback.written_feedback.corrections && (
                    <FeedbackCard
                      icon={<AlertTriangle className="w-3.5 h-3.5" />}
                      label="Worth double-checking"
                      tone="text-rose-400"
                    >
                      {activeFeedback.written_feedback.corrections}
                      {/* Coverage measures whether you wrote about an idea, not whether you were right. */}
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

  // No lessons at all: show NoMaterialsNotice rather than an empty dropdown.
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
        // px-2 is required: overflow-y-auto also clips x, which sliced off the dropdown's border and shadow.
        <div className="max-w-3xl mx-auto h-full overflow-y-auto no-scrollbar pb-10 px-2">
          {activeLog && activeFeedback ? resultView(activeLog, activeFeedback, true) : composer}
        </div>
      ) : (
        /* Master/detail: one pane at a time below lg (avoids nested scroll regions); historyLogId drives it. */
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

          {/* Same horizontal-clip rule as the study pane. */}
          <div
            className={`flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10 px-2 ${
              historyLogId ? 'block' : 'hidden lg:block'
            }`}
          >
            {activeLog && activeFeedback ? (
              <div className="max-w-3xl">
                {/* Mobile only: the way back to the list. */}
                <button
                  onClick={() => setHistoryLogId(null)}
                  className="lg:hidden mb-4 inline-flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
                >
                  <ChevronLeft className="w-4 h-4" /> All attempts
                </button>
                {resultView(activeLog, activeFeedback, false)}
              </div>
            ) : (
              /* lg-only: below it the list itself is the empty state. */
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
