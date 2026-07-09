import React, { useState, useEffect } from 'react';
import { Brain, History, PenTool, RefreshCw, Calendar, Target, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
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
      {/* ─── Header & Top Controls ───────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5 shrink-0">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2.5 tracking-tight">
            <Brain className="w-6 h-6 text-primary-fixed-dim" />
            Free Recall
          </h2>
          <p className="font-sans text-sm text-slate-400 mt-1">
            Type everything you remember from memory. AI computes the concept coverage gap.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Context:</span>
            <div className="w-[200px]">
              <MultiSelectDropdown
                selectedValues={selectedDocs}
                onChange={setSelectedDocs}
                options={resourceOptions}
                placeholder="Select materials..."
              />
            </div>
          </div>

          <div className="h-8 w-px bg-white/10 mx-2" />

          <button
            onClick={() => {
              setViewMode(viewMode === 'study' ? 'history' : 'study');
              setActiveLogId(null);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 hover:bg-surface-container transition-colors text-slate-300 font-sans text-sm font-medium"
          >
            {viewMode === 'study' ? (
              <><History className="w-4 h-4" /> Past Recalls</>
            ) : (
              <><PenTool className="w-4 h-4" /> Write New Recall</>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main Content Area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 pt-6">
        {viewMode === 'study' ? (
          // STUDY MODE (Minimalist Editor)
          <div className="h-full flex flex-col max-w-4xl mx-auto animate-in fade-in">
            {evalError && (
              <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {evalError}
              </div>
            )}
            <textarea
              value={recallText}
              onChange={(e) => setRecallText(e.target.value)}
              placeholder={selectedMaterialIds.length === 0 ? 'Select a material above to begin your recall...' : 'Start typing your recall here...'}
              disabled={isEvaluating}
              className="flex-1 w-full bg-transparent border-none outline-none font-sans text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar py-4 disabled:opacity-50"
              autoFocus
            />
            <div className="py-4 border-t border-white/5 flex items-center justify-between shrink-0">
              <span className="font-sans text-xs text-slate-500 font-medium">
                {recallText.split(/\s+/).filter(Boolean).length} words
              </span>
              <button
                onClick={handleEvaluate}
                disabled={!recallText.trim() || isEvaluating || selectedMaterialIds.length === 0}
                className="px-8 py-3 bg-white text-black hover:bg-slate-200 rounded-full font-sans text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
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
            <div className="w-[320px] flex flex-col border-r border-white/5 pr-6 h-full shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-sans font-semibold text-slate-200 text-sm">Past Attempts</h3>
                <span className="bg-surface-container text-slate-400 text-xs px-2 py-0.5 rounded-full font-medium">
                  {historyLogs.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2 no-scrollbar">
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
                        className={`w-full text-left p-4 rounded-xl transition-all border ${
                          activeLogId === log.id
                            ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30'
                            : 'bg-surface-container/30 border-transparent hover:bg-surface-container'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            <Calendar className="w-3 h-3" />
                            {formatDate(log.created_at)}
                          </span>
                          <span className={`text-xs font-bold ${verdictColor(feedback.overall_verdict)}`}>
                            {Math.round(score * 100)}%
                          </span>
                        </div>
                        <p className="font-sans text-sm text-slate-300 line-clamp-2 leading-relaxed">
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
                <div className="max-w-3xl animate-in fade-in slide-in-from-right-4 duration-300 space-y-8">

                  {/* Score Overview */}
                  <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 flex items-center gap-6">
                    <div className="relative shrink-0 flex items-center justify-center w-24 h-24">
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                        <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-container-high" />
                        <circle
                          cx="48" cy="48" r="40"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={251.2}
                          strokeDashoffset={251.2 - (251.2 * (activeLog.similarity_score ?? 0))}
                          className={verdictColor(activeFeedback.overall_verdict).replace('text-', 'text-')}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-2xl font-bold text-white">
                          {Math.round((activeLog.similarity_score ?? 0) * 100)}<span className="text-sm text-slate-400">%</span>
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-sans text-lg font-semibold text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary-fixed-dim" />
                        Concept Coverage Score
                      </h3>
                      <p className={`font-sans text-sm font-semibold mt-1 ${verdictColor(activeFeedback.overall_verdict)}`}>
                        {verdictLabel[activeFeedback.overall_verdict]}
                      </p>
                      <p className="font-sans text-xs text-slate-500 mt-1">
                        Based on cosine similarity against your uploaded material's concepts.
                      </p>
                    </div>
                  </div>

                  {/* Missed Concepts */}
                  <div>
                    <h4 className="font-sans text-sm font-semibold text-slate-200 uppercase tracking-widest mb-4">
                      Missed Concepts
                    </h4>
                    {activeFeedback.missed_concepts.length === 0 ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-4 py-3 rounded-xl w-fit">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-sans text-sm font-medium">All concepts covered!</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {activeFeedback.missed_concepts.map((concept, i) => (
                          <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-red-500/10 bg-red-500/5">
                            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                            <span className="font-sans text-sm text-slate-200 font-medium">{concept}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Original Input */}
                  <div>
                    <h4 className="font-sans text-sm font-semibold text-slate-200 uppercase tracking-widest mb-4">
                      Your Recall
                    </h4>
                    <div className="bg-surface-container-lowest/50 border border-white/5 rounded-2xl p-6">
                      <p className="font-sans text-base leading-loose text-slate-300 whitespace-pre-wrap">
                        {activeLog.user_input}
                      </p>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                  <History className="w-12 h-12 mb-4 opacity-20" />
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
