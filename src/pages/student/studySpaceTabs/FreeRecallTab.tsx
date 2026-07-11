import React, { useState, useEffect } from 'react';
import { Brain, History, PenTool, RefreshCw, Target, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import { api } from '../../../lib/api';

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
  ai_feedback: string | null; // Stored as JSON string: { missed_concepts: string[], overall_verdict: string }
  created_at: string;
}

// Parsed feedback from the ai_feedback JSON column
interface ParsedFeedback {
  missed_concepts: string[];
  overall_verdict: 'strong' | 'partial' | 'needs_review';
}

function parseFeedback(raw: string | null): ParsedFeedback {
  if (!raw) return { missed_concepts: [], overall_verdict: 'partial' };
  try {
    return JSON.parse(raw) as ParsedFeedback;
  } catch {
    return { missed_concepts: [], overall_verdict: 'partial' };
  }
}

// ── Shared minimalist style tokens ──────────────────────────
const CARD = 'bg-surface-container-lowest/40 rounded-2xl';
const LABEL = 'font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider';
const SECTION = 'font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest';

export default function FreeRecallTab({ availableResources, spaceId }: FreeRecallTabProps) {
  const resourceOptions = availableResources.map(r => r.title);

  const [viewMode, setViewMode] = useState<'study' | 'history'>('study');
  const [selectedDocs, setSelectedDocs] = useState<string[]>(
    resourceOptions.length > 0 ? [resourceOptions[0]] : []
  );

  // Study State
  const [recallText, setRecallText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // History / Logs State
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const activeLog = historyLogs.find(log => log.id === activeLogId);
  const activeFeedback = activeLog ? parseFeedback(activeLog.ai_feedback) : null;

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

  // ── Resolve selected titles → material IDs ───────────────
  const selectedMaterialIds = availableResources
    .filter(r => selectedDocs.includes(r.title))
    .map(r => r.id);

  // ── Evaluate recall via real API ─────────────────────────
  const handleEvaluate = async () => {
    if (!recallText.trim() || selectedMaterialIds.length === 0) return;
    setIsEvaluating(true);
    setEvalError(null);

    try {
      const res = await api.post<{
        log_id: string;
        similarity_score: number;
        score_percent: number;
        missed_concepts: string[];
        overall_verdict: 'strong' | 'partial' | 'needs_review';
        created_at: string;
      }>('/cognitive/free-recall', {
        space_id: spaceId,
        material_ids: selectedMaterialIds,
        user_input: recallText,
      });

      const result = res.data;

      // Build a CognitiveLog entry matching the API shape so we can display it immediately
      const newLog: CognitiveLog = {
        id: result.log_id,
        mode: 'free_recall',
        user_input: recallText,
        similarity_score: result.similarity_score,
        ai_feedback: JSON.stringify({
          missed_concepts: result.missed_concepts,
          overall_verdict: result.overall_verdict,
        }),
        created_at: result.created_at ?? new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      setActiveLogId(newLog.id);
      setViewMode('history');
      setRecallText('');
    } catch (err: any) {
      const message = err?.response?.data?.error ?? err?.message ?? 'Something went wrong.';
      setEvalError(message);
    } finally {
      setIsEvaluating(false);
    }
  };

  const switchView = (mode: 'study' | 'history') => {
    setViewMode(mode);
    setActiveLogId(null);
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const verdictLabel: Record<string, string> = {
    strong: 'Strong Coverage',
    partial: 'Partial Coverage',
    needs_review: 'Needs Review',
  };

  const verdictColor = (verdict: string) =>
    verdict === 'strong' ? 'text-emerald-400' :
    verdict === 'partial' ? 'text-amber-400' :
    'text-red-400';

  return (
    <div className="animate-in fade-in duration-300 h-[calc(100vh-140px)] flex flex-col">
      {/* ─── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-white tracking-tight">
              Free Recall
            </h2>
            <p className="font-sans text-xs text-slate-500 mt-0.5">
              Type everything you remember; AI computes the concept coverage gap.
            </p>
          </div>
        </div>

        {/* Segmented Study / History control */}
        <div className="inline-flex items-center gap-1 p-1 bg-surface-container-lowest/60 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => switchView('study')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors ${
              viewMode === 'study' ? 'bg-surface-container-high text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" /> Study
          </button>
          <button
            onClick={() => switchView('history')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors ${
              viewMode === 'history' ? 'bg-surface-container-high text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" /> History
          </button>
        </div>
      </div>

      {/* ─── Main Content Area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 pt-6">
        {viewMode === 'study' ? (
          // STUDY MODE (Minimalist Editor)
          <div className="h-full flex flex-col max-w-4xl mx-auto animate-in fade-in">
            {/* Toolbar: Material */}
            <div className="flex flex-col items-start gap-1.5 mb-4">
              <span className={LABEL}>Material</span>
              <MultiSelectDropdown
                selectedValues={selectedDocs}
                onChange={setSelectedDocs}
                options={resourceOptions}
                placeholder="Select materials..."
              />
            </div>

            {evalError && (
              <div className="mb-4 flex items-center gap-2 bg-red-500/10 rounded-xl px-4 py-3 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {evalError}
              </div>
            )}

            <div className={`${CARD} flex-1 flex flex-col min-h-0 p-5`}>
              <textarea
                value={recallText}
                onChange={(e) => setRecallText(e.target.value)}
                placeholder={selectedMaterialIds.length === 0 ? 'Select a material above to begin your recall...' : 'Start typing everything you remember...'}
                disabled={isEvaluating}
                className="flex-1 w-full bg-transparent border-none outline-none font-sans text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar disabled:opacity-50"
                autoFocus
              />
            </div>

            <div className="py-4 flex items-center justify-between shrink-0">
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
        ) : (
          // HISTORY MODE
          <div className="h-full flex gap-6 animate-in fade-in">
            {/* Sidebar List */}
            <div className="w-[300px] flex flex-col border-r border-white/5 pr-6 h-full shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className={SECTION}>Past Attempts</h3>
                <span className="text-slate-500 text-xs font-medium">{historyLogs.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 pr-2 no-scrollbar">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center mt-10">
                    <RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
                  </div>
                ) : historyLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 font-sans text-center mt-10">No past attempts yet.</p>
                ) : (
                  historyLogs.map(log => {
                    const feedback = parseFeedback(log.ai_feedback);
                    const score = log.similarity_score ?? 0;
                    return (
                      <button
                        key={log.id}
                        onClick={() => setActiveLogId(log.id)}
                        className={`w-full text-left p-3.5 rounded-xl transition-colors ${
                          activeLogId === log.id
                            ? 'bg-primary-fixed-dim/10'
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            {formatDate(log.created_at)}
                          </span>
                          <span className={`text-xs font-bold ${verdictColor(feedback.overall_verdict)}`}>
                            {Math.round(score * 100)}%
                          </span>
                        </div>
                        <p className="font-sans text-sm text-slate-400 line-clamp-2 leading-relaxed">
                          {log.user_input}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Detail View */}
            <div className="flex-1 h-full overflow-y-auto no-scrollbar pb-10">
              {activeLog && activeFeedback ? (
                <div className="max-w-3xl animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">

                  {/* Score Overview */}
                  <div className={`${CARD} p-6 flex items-center gap-6`}>
                    <div className="relative shrink-0 flex items-center justify-center w-[88px] h-[88px]">
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                        <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
                        <circle
                          cx="44" cy="44" r="36"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray={226.2}
                          strokeDashoffset={226.2 - (226.2 * (activeLog.similarity_score ?? 0))}
                          className={verdictColor(activeFeedback.overall_verdict)}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-2xl font-bold text-white">
                          {Math.round((activeLog.similarity_score ?? 0) * 100)}<span className="text-sm text-slate-400">%</span>
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-sans text-base font-semibold text-white flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary-fixed-dim" />
                        Concept Coverage Score
                      </h3>
                      <p className={`font-sans text-sm font-semibold mt-1 ${verdictColor(activeFeedback.overall_verdict)}`}>
                        {verdictLabel[activeFeedback.overall_verdict]}
                      </p>
                      <p className="font-sans text-xs text-slate-500 mt-1">
                        Based on cosine similarity against your material's concepts.
                      </p>
                    </div>
                  </div>

                  {/* Missed Concepts */}
                  <div>
                    <h4 className={`${SECTION} mb-3`}>Missed Concepts</h4>
                    {activeFeedback.missed_concepts.length === 0 ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-4 py-2.5 rounded-xl w-fit">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-sans text-sm font-medium">All concepts covered</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {activeFeedback.missed_concepts.map((concept, i) => (
                          <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl bg-red-500/5">
                            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                            <span className="font-sans text-sm text-slate-300 font-medium">{concept}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Original Input */}
                  <div>
                    <h4 className={`${SECTION} mb-3`}>Your Recall</h4>
                    <div className={`${CARD} p-5`}>
                      <p className="font-sans text-sm leading-loose text-slate-400 whitespace-pre-wrap">
                        {activeLog.user_input}
                      </p>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                  <History className="w-10 h-10 mb-4 opacity-20" />
                  <p className="font-sans text-sm">Select a past attempt to view its concept coverage and missed terms.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
