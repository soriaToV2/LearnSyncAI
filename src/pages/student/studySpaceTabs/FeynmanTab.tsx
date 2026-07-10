import React, { useState, useEffect } from 'react';
import { Award, History, PenTool, RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Heart, Target, ChevronDown } from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import { api } from '../../../lib/api';

interface FeynmanTabProps {
  availableResources: { id: string; title: string }[];
}

interface Concept {
  id: string;
  term: string;
}

interface MockFeynmanLog {
  id: string;
  user_input: string;
  audience: '10yr_old' | 'self';
  simplicity_score: number;
  jargon_found: string[];
  feedback: string;
  analogy_idea: string;
  created_at: string;
}

const MOCK_HISTORY: MockFeynmanLog[] = [
  {
    id: '1',
    user_input: 'The action potential travels down the axon and causes depolarization at the terminal. This triggers calcium influx, which forces the synaptic vesicles to undergo exocytosis, releasing neurotransmitters into the cleft.',
    audience: '10yr_old',
    simplicity_score: 30,
    jargon_found: ['action potential', 'depolarization', 'calcium influx', 'synaptic vesicles', 'exocytosis', 'neurotransmitters'],
    feedback: 'Your explanation has a lot of big words! A 10-year-old would get confused by terms like action potential and depolarization. Try using a simple story or analogy.',
    analogy_idea: 'Think of the process like a row of falling dominoes that eventually hits a button, opening a gate to let a bunch of bouncy balls spill out into a small river.',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  }
];

export default function FeynmanTab({ availableResources }: FeynmanTabProps) {
  const resourceOptions = availableResources.map(r => r.title);

  const [viewMode, setViewMode] = useState<'study' | 'history'>('study');
  const [selectedDocs, setSelectedDocs] = useState<string[]>(
    resourceOptions.length > 0 ? [resourceOptions[0]] : []
  );
  
  // Concept Fetching State
  const [availableConcepts, setAvailableConcepts] = useState<Concept[]>([]);
  const [selectedConceptTerms, setSelectedConceptTerms] = useState<string[]>([]);
  const [isFetchingConcepts, setIsFetchingConcepts] = useState(false);

  // Study State
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState<'10yr_old' | 'self'>('10yr_old');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isAudienceDropdownOpen, setIsAudienceDropdownOpen] = useState(false);
  
  // History State
  const [historyLogs, setHistoryLogs] = useState<MockFeynmanLog[]>(MOCK_HISTORY);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const activeLog = historyLogs.find(log => log.id === activeLogId);

  const audiences = [
    { id: '10yr_old', name: '10-Year-Old', desc: 'No jargon, simple analogies' },
    { id: 'self', name: 'Myself', desc: 'Reflective, testing true understanding' }
  ] as const;

  const currentAudienceObj = audiences.find(a => a.id === audience);

  // Map selected titles back to material IDs
  const selectedMaterialIds = availableResources
    .filter(r => selectedDocs.includes(r.title))
    .map(r => r.id);

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
  };

  const getCombinedText = () => {
    if (selectedConceptTerms.length === 0) {
      return explanations['__general__'] || '';
    }
    return selectedConceptTerms
      .map(t => `Concept: ${t}\nExplanation: ${explanations[t] || ''}`)
      .join('\n\n');
  };

  const handleEvaluate = () => {
    const combinedText = getCombinedText();
    if (!combinedText.trim()) return;
    setIsEvaluating(true);

    // Simulate AI analysis
    setTimeout(() => {
      const textLower = combinedText.toLowerCase();
      
      const jargonFound = [];
      if (textLower.includes('exocytosis')) jargonFound.push('Exocytosis');
      if (textLower.includes('postsynaptic')) jargonFound.push('Postsynaptic');
      if (textLower.includes('depolarization')) jargonFound.push('Depolarization');
      if (textLower.includes('calcium')) jargonFound.push('Calcium');
      if (textLower.includes('action potential')) jargonFound.push('Action potential');
      if (textLower.includes('presynaptic')) jargonFound.push('Presynaptic');

      let simplicityScore = 90;
      let feedback = "";
      let analogyIdea = "";

      if (audience === '10yr_old') {
        simplicityScore -= jargonFound.length * 15;
        if (jargonFound.length > 2) {
          simplicityScore = Math.max(30, simplicityScore);
          feedback = "Your explanation has a lot of big words! Try using a simple story or analogy.";
          analogyIdea = "Think of neurotransmitter release like bubble packages carrying letters across a small river to mailboxes on the other side.";
        } else if (jargonFound.length > 0) {
          simplicityScore = Math.max(65, simplicityScore);
          feedback = "Very close! Just explain " + jargonFound[0] + " in a simpler way.";
          analogyIdea = "Compare synaptic vesicles to tiny cargo ships unloading cargo at a dock.";
        } else {
          simplicityScore = 95;
          feedback = "Excellent! You explained this concept beautifully without using scary jargon.";
          analogyIdea = "";
        }
      } else {
        // Self
        simplicityScore = Math.max(80, 100 - jargonFound.length * 5);
        feedback = "Good self-reflection. You've detailed the steps, but make sure you aren't just reciting memorized jargon without understanding the 'why'.";
        analogyIdea = "Try breaking down the mechanics of the process one level deeper to prove to yourself you know how it works.";
      }

      const newLog: MockFeynmanLog = {
        id: Date.now().toString(),
        user_input: combinedText,
        audience: audience,
        simplicity_score: Math.max(0, Math.min(100, simplicityScore)),
        jargon_found: jargonFound,
        feedback,
        analogy_idea: analogyIdea,
        created_at: new Date().toISOString(),
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      setActiveLogId(newLog.id);
      setViewMode('history');
      setExplanations({});
      setSelectedConceptTerms([]);
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
            <Award className="w-6 h-6 text-primary-fixed-dim" />
            Feynman Technique
          </h2>
          <p className="font-sans text-sm text-slate-400 mt-1">
            Explain a concept in simple terms as if you're teaching your target audience. The application will evaluate your explanation and provide feedback.
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
              <><History className="w-4 h-4" /> Past Explanations</>
            ) : (
              <><PenTool className="w-4 h-4" /> New Explanation</>
            )}
          </button>
        </div>
      </div>

      {/* ─── Main Content Area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 pt-6">
        {viewMode === 'study' ? (
          // STUDY MODE (Minimalist Editor)
          <div className="h-full flex flex-col max-w-4xl mx-auto animate-in fade-in">
            {/* Minimalist Audience Selector & Concept Picker */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 mb-6">
              <div className="flex items-center gap-4 shrink-0">
                <span className="font-sans text-xs font-semibold text-slate-500 uppercase tracking-wider">Audience:</span>
                <div className="relative">
                  <button
                    onClick={() => setIsAudienceDropdownOpen(!isAudienceDropdownOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-container/50 hover:bg-surface-container border border-white/5 rounded-xl font-sans text-sm text-slate-200 font-medium transition-colors"
                  >
                    {currentAudienceObj?.name}
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </button>
                  
                  {isAudienceDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsAudienceDropdownOpen(false)} />
                      <div className="absolute top-full left-0 mt-2 w-64 bg-surface-container-high border border-white/10 rounded-xl shadow-xl overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-200">
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

              {/* Concepts Picker */}
              <div className="flex flex-col gap-2">
                <span className="font-sans text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  {isFetchingConcepts && <RefreshCw className="w-3 h-3 animate-spin" />} Concepts to Explain:
                </span>
                <div className="w-[250px] relative z-10">
                  <MultiSelectDropdown
                    selectedValues={selectedConceptTerms}
                    onChange={handleConceptChange}
                    options={availableConcepts.map(c => c.term)}
                    placeholder="Select concepts..."
                  />
                </div>
              </div>
            </div>

            {selectedConceptTerms.length === 0 ? (
              <textarea
                value={explanations['__general__'] || ''}
                onChange={(e) => setExplanations({ ...explanations, __general__: e.target.value })}
                placeholder={
                  audience === '10yr_old'
                    ? "Select concepts above, or explain as if teaching a 10-year-old. Use everyday analogies and completely avoid jargon..."
                    : "Select concepts above, or explain the concept to yourself. Break down the true mechanics to prove you aren't just reciting memorized words..."
                }
                className="flex-1 w-full bg-transparent border-none outline-none font-sans text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar py-4"
                autoFocus
              />
            ) : (
              <div className="flex-1 w-full overflow-y-auto no-scrollbar py-4 space-y-6">
                {selectedConceptTerms.map((term, index) => (
                  <div key={term} className="bg-surface-container-lowest/50 border border-white/5 rounded-2xl p-6 space-y-4">
                    <div className="font-sans text-sm font-semibold text-primary-fixed-dim tracking-wider uppercase">
                      Concept: <span className="text-white normal-case text-base ml-1">{term}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-wider">Explanation:</span>
                      <textarea
                        value={explanations[term] || ''}
                        onChange={(e) => setExplanations({ ...explanations, [term]: e.target.value })}
                        placeholder="Type your explanation here..."
                        className="w-full bg-transparent border-none outline-none font-sans text-lg text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar min-h-[120px]"
                        autoFocus={index === 0}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="py-4 border-t border-white/5 flex items-center justify-between shrink-0">
              <span className="font-sans text-xs text-slate-500 font-medium">
                {getCombinedText().split(/\s+/).filter(Boolean).length} words
              </span>
              <button
                onClick={handleEvaluate}
                disabled={!getCombinedText().trim() || isEvaluating || selectedDocs.length === 0}
                className="px-8 py-3 bg-white text-black hover:bg-slate-200 rounded-full font-sans text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
              >
                {isEvaluating ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Auditing Jargon...</>
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
            <div className="w-[320px] flex flex-col border-r border-white/5 pr-6 h-full shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-sans font-semibold text-slate-200 text-sm">Past Explanations</h3>
                <span className="bg-surface-container text-slate-400 text-xs px-2 py-0.5 rounded-full font-medium">
                  {historyLogs.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-2 no-scrollbar">
                {historyLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 font-sans text-center mt-10">No past explanations yet.</p>
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
                          {formatDate(log.created_at)}
                        </span>
                        <span className={`text-xs font-bold ${log.simplicity_score >= 80 ? 'text-emerald-400' : log.simplicity_score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                          {log.simplicity_score}/100
                        </span>
                      </div>
                      <div className="text-[10px] font-semibold uppercase text-primary-fixed-dim/80 mb-2">
                        Target: {log.audience}
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
                  <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-6">
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
                          strokeDashoffset={251.2 - (251.2 * (activeLog.simplicity_score / 100))}
                          className={activeLog.simplicity_score >= 80 ? 'text-emerald-400' : activeLog.simplicity_score >= 60 ? 'text-amber-400' : 'text-red-400'} 
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-2xl font-bold text-white">
                          {activeLog.simplicity_score}
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-sans text-lg font-semibold text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary-fixed-dim" />
                        Simplicity Index
                      </h3>
                      <p className="font-sans text-sm text-slate-400 mt-1">
                        Audience: <strong className="text-white uppercase">{activeLog.audience}</strong>
                      </p>
                    </div>
                  </div>

                  {/* Feedback Area */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 p-5 rounded-2xl">
                      <h4 className="font-sans text-xs font-semibold text-primary-fixed-dim uppercase tracking-wider mb-2 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" /> AI Feedback
                      </h4>
                      <p className="font-sans text-sm text-slate-200 leading-relaxed">
                        {activeLog.feedback}
                      </p>
                    </div>

                    {activeLog.analogy_idea && (
                      <div className="bg-emerald-400/5 border border-emerald-400/20 p-5 rounded-2xl">
                        <h4 className="font-sans text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Heart className="w-4 h-4" /> Analogy Idea
                        </h4>
                        <p className="font-sans text-sm text-slate-200 leading-relaxed">
                          {activeLog.analogy_idea}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Jargon Flags */}
                  <div>
                    <h4 className="font-sans text-sm font-semibold text-slate-200 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400" /> Academic Jargon Flagged
                    </h4>
                    {activeLog.jargon_found.length === 0 ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-4 py-3 rounded-xl w-fit">
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="font-sans text-sm font-medium">No complex jargon detected!</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {activeLog.jargon_found.map((word, i) => (
                          <div key={i} className="px-3 py-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 font-sans text-sm font-medium">
                            {word}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Original Input */}
                  <div>
                    <h4 className="font-sans text-sm font-semibold text-slate-200 uppercase tracking-widest mb-4">
                      Your Explanation
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
                  <p className="font-sans text-sm">Select a past explanation to view your simplicity score and feedback.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
