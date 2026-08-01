import { useState, useEffect } from 'react';
import { Brain, RefreshCw, Target, CheckCircle2, XCircle, AlertTriangle, Sparkles, PenTool, History } from 'lucide-react';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { api } from '../../../lib/api';
import {
  CARD, LABEL, SECTION,
  CognitiveTabShell, VerdictBanner, FeedbackCard, Collapsible, AttemptsList,
  type AttemptSummary, type Tone, type ViewMode,
} from './cognitiveShared';

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
  created_at: string;
}

// Written coaching on the attempt. Null when generation failed — the score is
// still saved, so the tab shows a note rather than treating it as an error.
interface WrittenFeedback {
  strengths: string;
  gaps: string;
  next_steps: string;
}

// Parsed feedback from the ai_feedback JSON column
interface ParsedFeedback {
  missed_concepts: string[];
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

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  strong: { label: 'Strong Coverage', tone: 'good' },
  partial: { label: 'Partial Coverage', tone: 'mid' },
  needs_review: { label: 'Needs Review', tone: 'poor' },
};

/**
 * Plain sentence under the verdict.
 *
 * The old copy read "Based on cosine similarity against your material's
 * concepts", which tells a Junior High student nothing. The counts do the
 * explaining instead: 23% reads very differently next to "15 of 78 ideas".
 */
function verdictDescription(f: ParsedFeedback, verdict: string): string {
  const covered = f.covered_count;
  const total = f.total_concepts;
  const counts = covered !== undefined && total !== undefined
    ? `You covered ${covered} of the ${total} ideas in this material. `
    : '';

  if (verdict === 'strong') return `${counts}You recalled the main ideas of this lesson well.`;
  if (verdict === 'partial') return `${counts}You remembered a fair amount — there is more to pick up.`;
  return `${counts}Not much of this lesson came back yet. That is what practice is for.`;
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
  const [evalError, setEvalError] = useState<string | null>(null);

  // Two separate selections, deliberately. `resultLogId` is the attempt you
  // just submitted and is shown inside Study, so submitting never moves you
  // somewhere else. `historyLogId` is whatever you clicked in the History
  // list. Sharing one variable would make the two views fight over it.
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);
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
        created_at: result.created_at ?? new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      // Stays in Study — the result replaces the composer where the student
      // is already looking, rather than moving them into History.
      setResultLogId(newLog.id);
      setShowMissed(false);
      setShowAnswer(false);
      setRecallText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setEvalError(message);
    } finally {
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
      scoreTone: VERDICT[f.overall_verdict]?.tone ?? 'mid',
      preview: log.user_input,
    };
  });

  // The result view, shared by both places it can appear: inside Study right
  // after submitting, and inside History when an attempt is selected.
  const resultView = (log: CognitiveLog, feedback: ParsedFeedback, showWriteAnother: boolean) => {
    const activeFeedback = feedback;
    const activeLog = log;
    return (
            <div className="space-y-5 animate-in fade-in duration-300">
              <VerdictBanner
                score={Math.round((activeLog.similarity_score ?? 0) * 100)}
                scoreSuffix="%"
                tone={VERDICT[activeFeedback.overall_verdict]?.tone ?? 'mid'}
                verdictLabel={VERDICT[activeFeedback.overall_verdict]?.label ?? 'Result'}
                description={verdictDescription(activeFeedback, activeFeedback.overall_verdict)}
              />

              {activeFeedback.written_feedback ? (
                <div className="space-y-3">
                  <h4 className={SECTION}>Feedback</h4>
                  {activeFeedback.written_feedback.strengths && (
                    <FeedbackCard
                      icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      label="What you recalled well"
                      tone="text-emerald-400"
                    >
                      {activeFeedback.written_feedback.strengths}
                    </FeedbackCard>
                  )}
                  {activeFeedback.written_feedback.gaps && (
                    <FeedbackCard
                      icon={<Target className="w-3.5 h-3.5" />}
                      label="What to look at again"
                      tone="text-amber-400"
                    >
                      {activeFeedback.written_feedback.gaps}
                    </FeedbackCard>
                  )}
                  {activeFeedback.written_feedback.next_steps && (
                    <FeedbackCard
                      icon={<Sparkles className="w-3.5 h-3.5" />}
                      label="Try this next"
                      tone="text-primary-fixed-dim"
                    >
                      {activeFeedback.written_feedback.next_steps}
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
                    className="w-full sm:w-auto px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    <PenTool className="w-4 h-4" /> Write another
                  </button>
                </div>
              )}
            </div>
    );
  };

  const composer = (
            <div className="animate-in fade-in">
              <div className="flex flex-col items-start gap-1.5 mb-4">
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

              <div className={`${CARD} p-5`}>
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
                  onClick={handleEvaluate}
                  disabled={!recallText.trim() || isEvaluating || selectedMaterialIds.length === 0}
                  className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isEvaluating ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing...</>
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
        <div className="max-w-3xl mx-auto h-full overflow-y-auto no-scrollbar pb-10">
          {activeLog && activeFeedback ? resultView(activeLog, activeFeedback, true) : composer}
        </div>
      ) : (
        <div className="h-full flex flex-col sm:flex-row gap-6 animate-in fade-in">
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
          />

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10">
            {activeLog && activeFeedback ? (
              <div className="max-w-3xl">{resultView(activeLog, activeFeedback, false)}</div>
            ) : (
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
