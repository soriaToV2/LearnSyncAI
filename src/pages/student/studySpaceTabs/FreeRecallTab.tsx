import React, { useState } from 'react';
import { Brain, History, PenTool, RefreshCw, ChevronLeft, Calendar, Target, Plus, CheckCircle2, XCircle } from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';

interface FreeRecallTabProps {
  availableResources: { id: string; title: string }[];
}

interface CognitiveLog {
  id: string;
  mode: 'free_recall';
  user_input: string;
  similarity_score: number;
  ai_feedback: string[]; // List of missed keywords/concepts
  created_at: string;
}

// Mock initial history data
const MOCK_HISTORY: CognitiveLog[] = [
  {
    id: '1',
    mode: 'free_recall',
    user_input: 'Synaptic transmission starts when an action potential arrives at the presynaptic terminal. This causes neurotransmitters to be released into the cleft and bind to receptors on the postsynaptic side.',
    similarity_score: 0.65,
    ai_feedback: [
      'Voltage-gated Calcium Channels',
      'Calcium Influx',
      'Synaptic Vesicle Exocytosis'
    ],
    created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
  }
];

export default function FreeRecallTab({ availableResources }: FreeRecallTabProps) {
  const resourceOptions = availableResources.map(r => r.title);

  const [viewMode, setViewMode] = useState<'study' | 'history'>('study');
  const [selectedDocs, setSelectedDocs] = useState<string[]>(
    resourceOptions.length > 0 ? [resourceOptions[0]] : []
  );
  
  // Study State
  const [recallText, setRecallText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  // History / Logs State
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>(MOCK_HISTORY);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const activeLog = historyLogs.find(log => log.id === activeLogId);

  const handleEvaluate = () => {
    if (!recallText.trim()) return;
    setIsEvaluating(true);

    // Simulate AI analysis and database vector similarity check
    setTimeout(() => {
      const textLower = recallText.toLowerCase();
      const hasCalcium = textLower.includes('calcium') || textLower.includes('ca2+');
      const hasVesicle = textLower.includes('vesicle');
      
      let score = 0.45;
      const missedConcepts: string[] = [];

      if (hasCalcium) {
        score += 0.25;
      } else {
        missedConcepts.push('Voltage-gated Calcium Channels');
        missedConcepts.push('Calcium Influx');
      }

      if (hasVesicle) {
        score += 0.25;
      } else {
        missedConcepts.push('Synaptic Vesicle Exocytosis');
      }

      // Bonus for length
      score += Math.min(0.05, (recallText.length / 500) * 0.05);
      
      const finalScore = Math.min(1.0, Number(score.toFixed(2)));

      const newLog: CognitiveLog = {
        id: Date.now().toString(),
        mode: 'free_recall',
        user_input: recallText,
        similarity_score: finalScore,
        ai_feedback: missedConcepts,
        created_at: new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      setActiveLogId(newLog.id);
      setViewMode('history');
      setRecallText('');
      setIsEvaluating(false);
    }, 1500);
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

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
            Type everything you remember from memory. AI computes the similarity gap.
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
            <textarea
              value={recallText}
              onChange={(e) => setRecallText(e.target.value)}
              placeholder="Start typing your recall here..."
              className="flex-1 w-full bg-transparent border-none outline-none font-sans text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar py-4"
              autoFocus
            />
            <div className="py-4 border-t border-white/5 flex items-center justify-between shrink-0">
              <span className="font-sans text-xs text-slate-500 font-medium">
                {recallText.split(/\s+/).filter(Boolean).length} words
              </span>
              <button
                onClick={handleEvaluate}
                disabled={!recallText.trim() || isEvaluating || selectedDocs.length === 0}
                className="px-8 py-3 bg-white text-black hover:bg-slate-200 rounded-full font-sans text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
              >
                {isEvaluating ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing vectors...</>
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
                {historyLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 font-sans text-center mt-10">No past attempts yet.</p>
                ) : (
                  historyLogs.map(log => (
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
                        <span className={`text-xs font-bold ${log.similarity_score >= 0.75 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {Math.round(log.similarity_score * 100)}%
                        </span>
                      </div>
                      <p className="font-sans text-sm text-slate-300 line-clamp-2 leading-relaxed">
                        {log.user_input}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Detail View */}
            <div className="flex-1 h-full overflow-y-auto no-scrollbar pb-10">
              {activeLog ? (
                <div className="max-w-3xl animate-in fade-in slide-in-from-right-4 duration-300 space-y-8">
                  
                  {/* Score Overview */}
                  <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 flex items-center gap-6">
                    <div className="relative shrink-0 flex items-center justify-center w-24 h-24">
                      {/* Circle indicator */}
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                        <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-container-high" />
                        <circle 
                          cx="48" cy="48" r="40" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="8" 
                          strokeLinecap="round"
                          strokeDasharray={251.2}
                          strokeDashoffset={251.2 - (251.2 * activeLog.similarity_score)}
                          className={activeLog.similarity_score >= 0.75 ? 'text-emerald-400' : 'text-amber-400'} 
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-2xl font-bold text-white">
                          {Math.round(activeLog.similarity_score * 100)}<span className="text-sm text-slate-400">%</span>
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-sans text-lg font-semibold text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary-fixed-dim" />
                        Cosine Similarity Score
                      </h3>
                      <p className="font-sans text-sm text-slate-400 mt-1">
                        {activeLog.similarity_score >= 0.75 
                          ? 'Excellent semantic coverage. Your response aligns closely with the reference materials.' 
                          : 'Semantic gap detected. Your response is missing some core concepts from the text.'}
                      </p>
                    </div>
                  </div>

                  {/* Missing Terms (Minimalist List) */}
                  <div>
                    <h4 className="font-sans text-sm font-semibold text-slate-200 uppercase tracking-widest mb-4">
                      Missed Concepts
                    </h4>
                    {activeLog.ai_feedback.length === 0 ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-4 py-3 rounded-xl w-fit">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-sans text-sm font-medium">No missing concepts detected.</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {activeLog.ai_feedback.map((concept, i) => (
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
                  <p className="font-sans text-sm">Select a past attempt to view its similarity score and missing terms.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
