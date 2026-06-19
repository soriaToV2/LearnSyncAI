import React, { useState } from 'react';
import { Brain, Sparkles, BookOpen, PenTool, RefreshCw, AlertTriangle, CheckCircle2, Lightbulb, ChevronRight } from 'lucide-react';
import Dropdown from '../../../components/ui/Dropdown';

interface FreeRecallTabProps {
  availableResources: string[];
}

export default function FreeRecallTab({ availableResources }: FreeRecallTabProps) {
  const [selectedDoc, setSelectedDoc] = useState(availableResources[0] || 'Synaptic_Pathways_Ch4.pdf');
  const [recallText, setRecallText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<any | null>(null);

  const handleEvaluate = () => {
    if (!recallText.trim()) return;
    setIsEvaluating(true);

    // Simulate AI analysis
    setTimeout(() => {
      // Mock keyword scoring
      const textLower = recallText.toLowerCase();
      const hasCalcium = textLower.includes('calcium') || textLower.includes('ca2+');
      const hasSynaptic = textLower.includes('synaptic') || textLower.includes('cleft');
      const hasNeuro = textLower.includes('neurotransmitter') || textLower.includes('vesicle');
      const hasPost = textLower.includes('postsynaptic') || textLower.includes('receptor');
      const hasAction = textLower.includes('action potential') || textLower.includes('depolarization');

      let score = 25;
      const mastered = [];
      const missing = [];

      if (hasAction) {
        score += 15;
        mastered.push({ concept: 'Action Potential Propagation', desc: 'Described action potential arrival at the presynaptic terminal.' });
      } else {
        missing.push({ concept: 'Action Potential Arrival', desc: 'Mention the depolarization that triggers the voltage-gated channels.' });
      }

      if (hasCalcium) {
        score += 15;
        mastered.push({ concept: 'Calcium Influx', desc: 'Linked Ca2+ entry to vesicle fusion and neurotransmitter release.' });
      } else {
        missing.push({ concept: 'Voltage-gated Calcium Channels', desc: 'Specify that Calcium ions enter the terminal to trigger exocytosis.' });
      }

      if (hasNeuro || hasSynaptic) {
        score += 15;
        mastered.push({ concept: 'Neurotransmitter Exocytosis', desc: 'Identified synaptic vesicles releasing chemicals into the synaptic cleft.' });
      } else {
        missing.push({ concept: 'Synaptic Vesicle Exocytosis', desc: 'Explain how vesicles fuse with the membrane to release chemicals.' });
      }

      if (hasPost) {
        score += 15;
        mastered.push({ concept: 'Postsynaptic Receptor Binding', desc: 'Identified transmitters binding to postsynaptic membrane receptors.' });
      } else {
        missing.push({ concept: 'Receptor Activation', desc: 'Clarify that neurotransmitters bind to specific receptors to trigger potential changes.' });
      }

      // Bonus for length
      score += Math.min(15, Math.floor(recallText.length / 50));
      score = Math.min(95, score);

      setEvaluationResult({
        score,
        mastered,
        missing,
        wordCount: recallText.split(/\s+/).filter(Boolean).length,
        feedback: score >= 70 
          ? "Excellent coverage of the core process. You have a solid grasp of presynaptic and postsynaptic events."
          : score >= 45 
            ? "Good initial attempt. You've captured the main concepts but missed critical steps in the synaptic transmission sequence."
            : "Review the material and try again. Focus on detailing the step-by-step sequence of neurotransmitter release."
      });
      setIsEvaluating(false);
    }, 2000);
  };

  const handleReset = () => {
    setRecallText('');
    setEvaluationResult(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2.5">
            <Brain className="w-6 h-6 text-primary-fixed-dim" />
            Free Recall AI Evaluation
          </h2>
          <p className="font-sans text-sm text-slate-400 mt-1">
            Write down everything you remember about a resource. AI compares your recall against reference vectors to spot gaps.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-sans text-xs font-semibold text-slate-400">Reference Material:</span>
          <Dropdown
            value={selectedDoc}
            onChange={setSelectedDoc}
            options={availableResources}
          />
        </div>
      </div>

      {!evaluationResult ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Editor Area */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
              <div className="flex justify-between items-center mb-3">
                <span className="font-sans text-xs font-semibold text-primary-fixed-dim flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5" /> Write Your Summary
                </span>
                <span className="font-sans text-xs text-slate-500">
                  {recallText.length} characters
                </span>
              </div>
              <textarea
                value={recallText}
                onChange={(e) => setRecallText(e.target.value)}
                placeholder="Type everything you can remember about this topic here... (e.g. 'Action potential arrives at terminal. Voltage calcium channels open. Calcium influx causes vesicle fusion...')"
                className="w-full min-h-[280px] bg-transparent text-white placeholder-slate-600 focus:outline-none text-sm leading-relaxed resize-y font-sans"
              />
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRecallText('')}
                disabled={!recallText || isEvaluating}
                className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-400 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                onClick={handleEvaluate}
                disabled={!recallText.trim() || isEvaluating}
                className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isEvaluating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Evaluating Recall...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Evaluate Recall
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Instructions panel */}
          <div className="space-y-6">
            <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
              <h4 className="font-display text-sm font-bold text-white uppercase tracking-wider">How to Practice Free Recall</h4>
              <ul className="space-y-3 font-sans text-xs text-slate-400 leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-primary-fixed-dim font-bold">1.</span>
                  <span>Close your notes and slides. Select your target document from the dropdown.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-fixed-dim font-bold">2.</span>
                  <span>Write down the core pathway, key vocabulary, and steps in your own words.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-fixed-dim font-bold">3.</span>
                  <span>Click Evaluate. The AI model checks vector overlaps with the textbook reference.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-fixed-dim font-bold">4.</span>
                  <span>Missing concepts will be flagged so you know exactly what to review next.</span>
                </li>
              </ul>
              <div className="pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-emerald-400/80 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>BKT Vector Synchronization Enabled</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Results view */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Score Card */}
            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-6 backdrop-blur-md space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-white">Semantic Match Analysis</h3>
                  <p className="font-sans text-xs text-slate-500 mt-1">Based on semantic vector similarity thresholds (`pgvector` cosine similarity)</p>
                </div>
                <div className="flex items-center gap-4 bg-white/5 px-4 py-2.5 rounded-xl border border-white/5 shrink-0">
                  <div className="text-right">
                    <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">Word Count</span>
                    <span className="font-mono text-sm font-bold text-white">{evaluationResult.wordCount}</span>
                  </div>
                  <div className="w-px h-8 bg-white/10"></div>
                  <div className="text-right">
                    <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">BKT Status</span>
                    <span className="font-mono text-xs font-bold text-emerald-400">LOGGED</span>
                  </div>
                </div>
              </div>

              {/* Progress and Score */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="font-sans text-sm font-semibold text-slate-300">Concept Coverage Score</span>
                  <span className="font-mono text-3xl font-black text-primary-fixed-dim">{evaluationResult.score}%</span>
                </div>
                <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-primary-fixed-dim to-indigo-500 transition-all duration-1000"
                    style={{ width: `${evaluationResult.score}%` }}
                  />
                </div>
              </div>

              <div className="flex gap-3 bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 p-4 rounded-xl">
                <Lightbulb className="w-5 h-5 text-primary-fixed-dim shrink-0" />
                <p className="font-sans text-xs text-slate-300 leading-relaxed">
                  <strong>Evaluator Feedback:</strong> {evaluationResult.feedback}
                </p>
              </div>
            </div>

            {/* Concept lists */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Mastered concepts */}
              <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
                <h4 className="font-display text-sm font-bold text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> Mastered Concepts ({evaluationResult.mastered.length})
                </h4>
                {evaluationResult.mastered.length > 0 ? (
                  <div className="space-y-3">
                    {evaluationResult.mastered.map((c: any, i: number) => (
                      <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl space-y-1">
                        <span className="block font-sans text-xs font-bold text-emerald-300">{c.concept}</span>
                        <p className="font-sans text-[10px] text-slate-400">{c.desc}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-slate-500">No core concepts successfully matched yet.</p>
                )}
              </div>

              {/* Missing concepts */}
              <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
                <h4 className="font-display text-sm font-bold text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> Missing Concepts ({evaluationResult.missing.length})
                </h4>
                {evaluationResult.missing.length > 0 ? (
                  <div className="space-y-3">
                    {evaluationResult.missing.map((c: any, i: number) => (
                      <div key={i} className="bg-amber-500/5 border border-amber-500/10 p-3 rounded-xl space-y-1">
                        <span className="block font-sans text-xs font-bold text-amber-300">{c.concept}</span>
                        <p className="font-sans text-[10px] text-slate-400">{c.desc}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-slate-500">Incredible! You captured all major concepts.</p>
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar results panel */}
          <div className="space-y-6">
            <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
              <h4 className="font-display text-sm font-bold text-white uppercase tracking-wider">Review Action Path</h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Your BKT mastery vectors have been updated. Your missing concepts suggest focusing your study efforts on these target flashcards:
              </p>
              
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 cursor-pointer group transition-colors">
                  <span className="font-sans text-xs text-white truncate pr-2">Presynaptic Calcium Influx</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-primary-fixed-dim transition-colors shrink-0" />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 cursor-pointer group transition-colors">
                  <span className="font-sans text-xs text-white truncate pr-2">Neurotransmitter Vesicle Fusion</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-primary-fixed-dim transition-colors shrink-0" />
                </div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-sans text-xs font-bold transition-all active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Try Free Recall Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
