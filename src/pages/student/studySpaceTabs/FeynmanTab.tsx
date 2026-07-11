import { useState, useEffect } from 'react';
import { Award, History, PenTool, RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Lightbulb, ChevronDown, XCircle, AlertTriangle } from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import { api } from '../../../lib/api';

interface FeynmanTabProps {
  availableResources: { id: string; title: string }[];
  spaceId: string;
}

interface Concept {
  id: string;
  term: string;
}

type Audience = '10yr_old' | 'self';
type Verdict = 'correct' | 'needs_improvement' | 'incorrect';

interface ConceptResult {
  concept_id: string;
  term: string;
  accuracy_score: number;
  simplicity_score: number;
  verdict: Verdict;
  jargon_found: string[];
  feedback: string;
  analogy_idea: string;
}

interface FeynmanFeedback {
  audience: Audience;
  accuracy_score: number;
  simplicity_score: number;
  overall_feedback: string;
  jargon_found: string[];
  concepts: ConceptResult[];
}

interface CognitiveLog {
  id: string;
  mode: string;
  user_input: string;
  similarity_score: number;
  ai_feedback: string;
  created_at: string;
}

/** `ai_feedback` is stored as a JSON string — parse defensively. */
function parseFeedback(raw: string): FeynmanFeedback | null {
  try {
    const parsed = JSON.parse(raw) as FeynmanFeedback;
    if (!Array.isArray(parsed?.concepts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const MIN_EXPLANATION_LENGTH = 10;

// ── Shared minimalist style tokens ──────────────────────────
const CARD = 'bg-surface-container-lowest/40 rounded-2xl';
const LABEL = 'font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider';
const SECTION = 'font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest';

const VERDICT_STYLES: Record<Verdict, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  correct: {
    label: 'Correct',
    className: 'text-emerald-400 bg-emerald-400/10',
    Icon: CheckCircle2,
  },
  needs_improvement: {
    label: 'Needs Improvement',
    className: 'text-amber-400 bg-amber-400/10',
    Icon: AlertTriangle,
  },
  incorrect: {
    label: 'Incorrect',
    className: 'text-red-400 bg-red-400/10',
    Icon: XCircle,
  },
};

function scoreColor(score: number) {
  return score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const CIRCUMFERENCE = 226.2; // 2π · 36
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0 w-[88px] h-[88px]">
        <svg className="w-full h-full -rotate-90">
          <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle
            cx="44" cy="44" r="36"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE - CIRCUMFERENCE * (score / 100)}
            className={scoreColor(score)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-2xl font-bold text-white">{score}</span>
        </div>
      </div>
      <div>
        <p className="font-sans text-sm font-semibold text-white">{label}</p>
        <p className={`font-sans text-xs mt-0.5 ${scoreColor(score)}`}>out of 100</p>
      </div>
    </div>
  );
}

export default function FeynmanTab({ availableResources, spaceId }: FeynmanTabProps) {
  const resourceOptions = availableResources.map(r => r.title);

  const [viewMode, setViewMode] = useState<'study' | 'history'>('study');
  const [selectedDocs, setSelectedDocs] = useState<string[]>(
    resourceOptions.length > 0 ? [resourceOptions[0]] : []
  );

  // Concept Fetching State
  const [availableConcepts, setAvailableConcepts] = useState<Concept[]>([]);
  const [selectedConceptTerms, setSelectedConceptTerms] = useState<string[]>([]);
  const [isFetchingConcepts, setIsFetchingConcepts] = useState(false);

  // Study State — explanations are keyed by concept_id, which is what the API grades against.
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState<Audience>('10yr_old');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [isAudienceDropdownOpen, setIsAudienceDropdownOpen] = useState(false);

  // History State
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const activeLog = historyLogs.find(log => log.id === activeLogId);
  const activeFeedback = activeLog ? parseFeedback(activeLog.ai_feedback) : null;

  const audiences = [
    { id: '10yr_old', name: '10-Year-Old', desc: 'No jargon, simple analogies' },
    { id: 'self', name: 'Myself', desc: 'Reflective, testing true understanding' }
  ] as const;

  const currentAudienceObj = audiences.find(a => a.id === audience);

  // Map selected titles back to material IDs
  const selectedMaterialIds = availableResources
    .filter(r => selectedDocs.includes(r.title))
    .map(r => r.id);

  // Map selected terms back to concept records
  const selectedConcepts = selectedConceptTerms
    .map(term => availableConcepts.find(c => c.term === term))
    .filter((c): c is Concept => Boolean(c));

  // ── Load history on mount ─────────────────────────────────
  useEffect(() => {
    async function fetchHistory() {
      setIsLoadingHistory(true);
      try {
        const res = await api.get<CognitiveLog[]>(`/cognitive/history/${spaceId}?mode=feynman`);
        setHistoryLogs(res.data ?? []);
      } catch (err) {
        console.error('[Feynman] Failed to load history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
    fetchHistory();
  }, [spaceId]);

  // Fetch concepts when selected materials change
  useEffect(() => {
    async function fetchConcepts() {
      if (selectedMaterialIds.length === 0) {
        setAvailableConcepts([]);
        setSelectedConceptTerms([]);
        return;
      }

      setIsFetchingConcepts(true);
      try {
        const res = await api.post<Concept[]>('/materials/concepts/batch', {
          material_ids: selectedMaterialIds
        });
        setAvailableConcepts(res.data || []);
      } catch (error) {
        console.error('[Feynman] Failed to fetch batch concepts', error);
      } finally {
        setIsFetchingConcepts(false);
      }
    }

    fetchConcepts();
  }, [JSON.stringify(selectedMaterialIds)]);

  const handleConceptChange = (newSelectedTerms: string[]) => {
    setSelectedConceptTerms(newSelectedTerms);
    setEvalError(null);
  };

  const switchView = (mode: 'study' | 'history') => {
    setViewMode(mode);
    setActiveLogId(null);
  };

  const wordCount = selectedConcepts
    .map(c => explanations[c.id] || '')
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  // Every selected concept needs a real explanation before we can submit.
  const incompleteConcepts = selectedConcepts.filter(
    c => (explanations[c.id] || '').trim().length < MIN_EXPLANATION_LENGTH
  );
  const canEvaluate =
    selectedMaterialIds.length > 0 &&
    selectedConcepts.length > 0 &&
    incompleteConcepts.length === 0 &&
    !isEvaluating;

  const handleEvaluate = async () => {
    if (!canEvaluate) return;
    setIsEvaluating(true);
    setEvalError(null);

    try {
      const res = await api.post<{ log_id: string; created_at: string } & FeynmanFeedback>(
        '/cognitive/feynman',
        {
          space_id: spaceId,
          material_ids: selectedMaterialIds,
          audience,
          explanations: selectedConcepts.map(c => ({
            concept_id: c.id,
            explanation: explanations[c.id].trim(),
          })),
        }
      );

      const { log_id, created_at, ...feedback } = res.data;

      const userInput = selectedConcepts
        .map(c => `Concept: ${c.term}\nExplanation: ${explanations[c.id].trim()}`)
        .join('\n\n');

      const newLog: CognitiveLog = {
        id: log_id,
        mode: 'feynman',
        user_input: userInput,
        similarity_score: feedback.accuracy_score / 100,
        ai_feedback: JSON.stringify(feedback),
        created_at,
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      setActiveLogId(newLog.id);
      setViewMode('history');
      setExplanations({});
      setSelectedConceptTerms([]);
    } catch (err) {
      console.error('[Feynman] Evaluation failed:', err);
      const raw = err instanceof Error ? err.message : '';
      // Never show a raw upstream payload to the student.
      const message = raw && !raw.trim().startsWith('{')
        ? raw
        : 'Failed to evaluate your explanation. Please try again.';
      setEvalError(message);
    } finally {
      setIsEvaluating(false);
    }
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="animate-in fade-in duration-300 h-[calc(100vh-140px)] flex flex-col">
      {/* ─── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            <Award className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-white tracking-tight">
              Feynman Technique
            </h2>
            <p className="font-sans text-xs text-slate-500 mt-0.5">
              Explain a concept in simple terms, as if teaching your audience.
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
            {/* Toolbar: Material · Audience · Concepts */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mb-6">
              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>Material</span>
                <MultiSelectDropdown
                  selectedValues={selectedDocs}
                  onChange={setSelectedDocs}
                  options={resourceOptions}
                  placeholder="Select materials..."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={LABEL}>Audience</span>
                <div className="relative">
                  <button
                    onClick={() => setIsAudienceDropdownOpen(!isAudienceDropdownOpen)}
                    className="inline-flex w-56 items-center justify-between gap-x-2 rounded-xl bg-surface-container/60 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-surface-container/85 transition-all"
                  >
                    <span className="truncate">{currentAudienceObj?.name}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 shrink-0 ${isAudienceDropdownOpen ? 'rotate-180 text-white' : ''}`} />
                  </button>

                  {isAudienceDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsAudienceDropdownOpen(false)} />
                      <div className="absolute top-full left-0 mt-2 w-64 bg-surface-container-high border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-150">
                        {audiences.map((aud) => (
                          <button
                            key={aud.id}
                            onClick={() => {
                              setAudience(aud.id);
                              setIsAudienceDropdownOpen(false);
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex flex-col ${
                              audience === aud.id ? 'bg-primary-fixed-dim/10' : ''
                            }`}
                          >
                            <span className={`font-sans text-sm font-semibold ${audience === aud.id ? 'text-primary-fixed-dim' : 'text-slate-200'}`}>
                              {aud.name}
                            </span>
                            <span className="font-sans text-xs text-slate-500 mt-0.5">{aud.desc}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={`${LABEL} flex items-center gap-1.5`}>
                  Concepts {isFetchingConcepts && <RefreshCw className="w-3 h-3 animate-spin" />}
                </span>
                <MultiSelectDropdown
                  selectedValues={selectedConceptTerms}
                  onChange={handleConceptChange}
                  options={availableConcepts.map(c => c.term)}
                  placeholder="Select concepts..."
                />
              </div>
            </div>

            {selectedConcepts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500">
                <PenTool className="w-10 h-10 mb-4 opacity-20" />
                <p className="font-sans text-sm max-w-md">
                  {selectedMaterialIds.length === 0
                    ? 'Select a learning material to load its concepts.'
                    : availableConcepts.length === 0 && !isFetchingConcepts
                      ? 'No concepts found. Make sure the material has finished processing.'
                      : 'Select one or more concepts above to start explaining them.'}
                </p>
              </div>
            ) : (
              <div className="flex-1 w-full overflow-y-auto no-scrollbar py-1 space-y-4">
                {selectedConcepts.map((concept, index) => (
                  <div key={concept.id} className={`${CARD} p-5`}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim shrink-0" />
                      <span className="font-sans text-sm font-semibold text-white">{concept.term}</span>
                    </div>
                    <textarea
                      value={explanations[concept.id] || ''}
                      onChange={(e) => setExplanations({ ...explanations, [concept.id]: e.target.value })}
                      placeholder={
                        audience === '10yr_old'
                          ? 'Explain as if teaching a 10-year-old. Use everyday analogies and avoid jargon...'
                          : "Explain it to yourself. Break down the mechanics to prove you aren't just reciting memorized words..."
                      }
                      className="w-full bg-transparent border-none outline-none font-sans text-base text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar min-h-[100px]"
                      autoFocus={index === 0}
                    />
                  </div>
                ))}
              </div>
            )}

            {evalError && (
              <div className="flex items-center gap-2 text-red-400 bg-red-400/10 px-4 py-3 rounded-xl mt-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-sans text-sm">{evalError}</span>
              </div>
            )}

            <div className="py-4 mt-2 border-t border-white/5 flex items-center justify-between shrink-0">
              <span className="font-sans text-xs text-slate-500 font-medium">
                {wordCount} words
                {selectedConcepts.length > 0 && incompleteConcepts.length > 0 && (
                  <span className="text-amber-400/80 ml-3">
                    {incompleteConcepts.length} concept{incompleteConcepts.length > 1 ? 's' : ''} still need{incompleteConcepts.length === 1 ? 's' : ''} an explanation
                  </span>
                )}
              </span>
              <button
                onClick={handleEvaluate}
                disabled={!canEvaluate}
                className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isEvaluating ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Evaluating...</>
                ) : (
                  'Evaluate Explanation'
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
                <h3 className={SECTION}>Past Explanations</h3>
                <span className="text-slate-500 text-xs font-medium">{historyLogs.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 pr-2 no-scrollbar">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center gap-2 text-slate-500 mt-10">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="font-sans text-sm">Loading history...</span>
                  </div>
                ) : historyLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 font-sans text-center mt-10">No past explanations yet.</p>
                ) : (
                  historyLogs.map(log => {
                    const feedback = parseFeedback(log.ai_feedback);
                    const accuracy = feedback?.accuracy_score ?? Math.round((log.similarity_score ?? 0) * 100);
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
                          <span className={`text-xs font-bold ${scoreColor(accuracy)}`}>
                            {accuracy}/100
                          </span>
                        </div>
                        <div className="text-[10px] font-semibold uppercase text-primary-fixed-dim/70 mb-1.5">
                          Target: {feedback?.audience ?? '—'}
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

                  {/* Score Overview — two independent axes */}
                  <div className={`${CARD} p-6`}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-8">
                      <ScoreRing score={activeFeedback.accuracy_score} label="Accuracy" />
                      <div className="hidden sm:block h-14 w-px bg-white/5" />
                      <ScoreRing score={activeFeedback.simplicity_score} label="Simplicity Index" />
                    </div>
                    <p className="font-sans text-xs text-slate-500 mt-5 pt-5 border-t border-white/5">
                      Audience: <span className="text-slate-300 uppercase font-semibold">{activeFeedback.audience}</span>
                    </p>
                  </div>

                  {/* Overall Feedback */}
                  {activeFeedback.overall_feedback && (
                    <div className="bg-primary-fixed-dim/[0.06] rounded-2xl p-5">
                      <h4 className="font-sans text-xs font-semibold text-primary-fixed-dim uppercase tracking-wider mb-2 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" /> Overall Feedback
                      </h4>
                      <p className="font-sans text-sm text-slate-200 leading-relaxed">
                        {activeFeedback.overall_feedback}
                      </p>
                    </div>
                  )}

                  {/* Jargon Flags (aggregate) */}
                  <div>
                    <h4 className={`${SECTION} mb-3`}>Academic Jargon Flagged</h4>
                    {activeFeedback.jargon_found.length === 0 ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 px-4 py-2.5 rounded-xl w-fit">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-sans text-sm font-medium">No complex jargon detected</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {activeFeedback.jargon_found.map((word, i) => (
                          <div key={i} className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-300 font-sans text-sm">
                            {word}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Per-Concept Breakdown */}
                  <div>
                    <h4 className={`${SECTION} mb-3`}>Concept Breakdown</h4>
                    <div className="space-y-3">
                      {activeFeedback.concepts.map((c) => {
                        const verdict = VERDICT_STYLES[c.verdict];
                        const VerdictIcon = verdict.Icon;
                        return (
                          <div key={c.concept_id} className={`${CARD} p-5 space-y-4`}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="font-sans text-sm font-semibold text-white">{c.term}</span>
                              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans text-xs font-semibold ${verdict.className}`}>
                                <VerdictIcon className="w-3.5 h-3.5" />
                                {verdict.label}
                              </div>
                            </div>

                            <div className="flex gap-8">
                              <div>
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Accuracy</span>
                                <p className={`font-display text-lg font-bold ${scoreColor(c.accuracy_score)}`}>{c.accuracy_score}</p>
                              </div>
                              <div>
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Simplicity</span>
                                <p className={`font-display text-lg font-bold ${scoreColor(c.simplicity_score)}`}>{c.simplicity_score}</p>
                              </div>
                            </div>

                            {c.feedback && (
                              <p className="font-sans text-sm text-slate-400 leading-relaxed">{c.feedback}</p>
                            )}

                            {c.jargon_found.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {c.jargon_found.map((word, i) => (
                                  <span key={i} className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 font-sans text-xs">
                                    {word}
                                  </span>
                                ))}
                              </div>
                            )}

                            {c.analogy_idea && (
                              <div className="bg-emerald-400/[0.06] p-4 rounded-xl">
                                <h5 className="font-sans text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                                  <Lightbulb className="w-3.5 h-3.5" /> Analogy Idea
                                </h5>
                                <p className="font-sans text-sm text-slate-200 leading-relaxed">{c.analogy_idea}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Original Input */}
                  <div>
                    <h4 className={`${SECTION} mb-3`}>Your Explanation</h4>
                    <div className={`${CARD} p-5`}>
                      <p className="font-sans text-sm leading-loose text-slate-400 whitespace-pre-wrap">
                        {activeLog.user_input}
                      </p>
                    </div>
                  </div>

                </div>
              ) : activeLog ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                  <AlertCircle className="w-10 h-10 mb-4 opacity-20" />
                  <p className="font-sans text-sm">This log's feedback could not be read.</p>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                  <History className="w-10 h-10 mb-4 opacity-20" />
                  <p className="font-sans text-sm">Select a past explanation to view your scores and feedback.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
