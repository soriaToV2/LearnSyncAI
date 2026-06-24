import React, { useState } from 'react';
import { Award, Sparkles, BookOpen, PenTool, RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Heart } from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';

interface FeynmanTabProps {
  availableResources: string[];
}

export default function FeynmanTab({ availableResources }: FeynmanTabProps) {
  const [selectedDocs, setSelectedDocs] = useState<string[]>(
    availableResources.length > 0 ? [availableResources[0]] : []
  );
  const [explanationText, setExplanationText] = useState('');
  const [audience, setAudience] = useState<'child' | 'teenager' | 'peer'>('child');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<any | null>(null);

  const concepts = [
    'Neurotransmitter Release',
    'Action Potentials',
    'Synaptic Cleft Transmission',
    'Myelin Sheath Propagation'
  ];

  const handleEvaluate = () => {
    if (!explanationText.trim()) return;
    setIsEvaluating(true);

    // Simulate AI analysis
    setTimeout(() => {
      const textLower = explanationText.toLowerCase();
      
      // Detect jargon
      const jargonFound = [];
      if (textLower.includes('exocytosis')) jargonFound.push('Exocytosis');
      if (textLower.includes('postsynaptic')) jargonFound.push('Postsynaptic');
      if (textLower.includes('depolarization')) jargonFound.push('Depolarization');
      if (textLower.includes('calcium influx')) jargonFound.push('Calcium influx');
      if (textLower.includes('action potential')) jargonFound.push('Action potential');
      if (textLower.includes('presynaptic')) jargonFound.push('Presynaptic');

      let simplicityScore = 90; // 100 = simplest
      let feedback = "";
      let analogyIdea = "";

      if (audience === 'child') {
        simplicityScore -= jargonFound.length * 15;
        if (jargonFound.length > 2) {
          simplicityScore = Math.max(30, simplicityScore);
          feedback = "Your explanation has a lot of big words! A 5-year-old would get confused by terms like " + jargonFound.slice(0, 2).join(' and ') + ". Try using a simple story or analogy.";
          analogyIdea = "Think of neurotransmitter release like bubble packages carrying letters across a small river to mailboxes on the other side.";
        } else if (jargonFound.length > 0) {
          simplicityScore = Math.max(65, simplicityScore);
          feedback = "Very close! Just explain " + jargonFound[0] + " in a simpler way (e.g. 'unloading bubbles' instead of 'exocytosis').";
          analogyIdea = "Compare synaptic vesicles to tiny cargo ships unloading cargo at a dock.";
        } else {
          simplicityScore = 95;
          feedback = "Excellent! You explained this concept beautifully without using scary jargon. This level of clarity shows you truly understand the core mechanism.";
          analogyIdea = "Perfect analogy used!";
        }
      } else if (audience === 'teenager') {
        simplicityScore -= jargonFound.length * 8;
        if (jargonFound.length > 4) {
          simplicityScore = Math.max(45, simplicityScore);
          feedback = "A bit too academic. Try to break down the technical process into logical, everyday concepts.";
          analogyIdea = "Think of the electrical charge like a wave in a stadium that forces gates to open at the exit.";
        } else {
          simplicityScore = Math.max(75, simplicityScore);
          feedback = "Great explanation. Suitable for a teenager or beginner biology student. Good job balancing accuracy and simplicity.";
          analogyIdea = "Compare neurotransmitter channels to keys unlocking a door.";
        }
      } else {
        // Peer audience
        simplicityScore = Math.max(80, 100 - jargonFound.length * 2);
        feedback = "Perfect level for a university peer. You've detailed the steps with precise medical/biology vocabulary.";
        analogyIdea = "No analogies needed for peer review, focus on step sequence accuracy.";
      }

      setEvaluationResult({
        score: simplicityScore,
        jargon: jargonFound,
        feedback,
        analogy: analogyIdea,
        gradeLevel: simplicityScore >= 80 ? 'Grade 3 (Simple)' : simplicityScore >= 60 ? 'Grade 7 (Moderate)' : 'Undergraduate (Complex)',
        wordCount: explanationText.split(/\s+/).filter(Boolean).length
      });
      setIsEvaluating(false);
    }, 2000);
  };

  const handleReset = () => {
    setExplanationText('');
    setEvaluationResult(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2.5">
            <Award className="w-6 h-6 text-primary-fixed-dim" />
            Feynman Technique Core
          </h2>
          <p className="font-sans text-sm text-slate-400 mt-1">
            Explain a complex concept in simple terms. The system audits your explanation for jargon to verify deep cognitive mastery.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-sans text-xs font-semibold text-slate-400">Reference Materials:</span>
          <MultiSelectDropdown
            selectedValues={selectedDocs}
            onChange={setSelectedDocs}
            options={availableResources}
            placeholder="Select resources..."
          />
        </div>
      </div>

      {!evaluationResult ? (
        <div key="workspace" className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
          {/* Main workspace */}
          <div className="lg:col-span-2 space-y-6">
            {/* Audience selectors */}
            <div className="space-y-2">
              <label className="font-sans text-xs font-semibold text-slate-400 block">Simulate Audience Level:</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: 'child', name: '5-Year-Old Child', desc: 'Zero jargon, pure analogies' },
                  { id: 'teenager', name: 'High Schooler', desc: 'Light terms, simple concepts' },
                  { id: 'peer', name: 'University Peer', desc: 'Technical terms, full detail' }
                ].map((aud) => (
                  <button
                    key={aud.id}
                    type="button"
                    onClick={() => setAudience(aud.id as any)}
                    className={`p-3.5 rounded-xl border font-sans text-left transition-all active:scale-97 ${
                      audience === aud.id
                        ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim text-white'
                        : 'bg-surface-container border-white/5 text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="block font-bold text-xs">{aud.name}</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">{aud.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
              <div className="flex justify-between items-center mb-3">
                <span className="font-sans text-xs font-semibold text-primary-fixed-dim flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5" /> Simple Explanation Workspace
                </span>
                <span className="font-sans text-xs text-slate-500">
                  {explanationText.length} characters
                </span>
              </div>
              <textarea
                value={explanationText}
                onChange={(e) => setExplanationText(e.target.value)}
                placeholder={
                  audience === 'child'
                    ? "Explain as if to a child, using simple analogies... e.g. 'Inside the brain, tiny bubbles carry letters across a small river to trigger mailboxes on the other side...'"
                    : audience === 'teenager'
                      ? "Explain as if to a high school student... e.g. 'An electric signal reaches the nerve end, causing bubbles to release chemicals that travel to the next cell...'"
                      : "Explain as if to an undergraduate peer... e.g. 'The depolarizing potential activates calcium channels. Calcium influx triggers SNARE proteins to fuse vesicles...'"
                }
                className="w-full min-h-[250px] bg-transparent text-white placeholder-slate-600 focus:outline-none text-sm leading-relaxed resize-y font-sans"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setExplanationText('')}
                disabled={!explanationText || isEvaluating}
                className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-400 hover:bg-white/5 transition-colors disabled:opacity-30"
              >
                Clear
              </button>
              <button
                onClick={handleEvaluate}
                disabled={!explanationText.trim() || isEvaluating || selectedDocs.length === 0}
                className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                {isEvaluating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing Clarity...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Evaluate Explanation
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right guidance panel */}
          <div className="space-y-6">
            <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
              <h4 className="font-display text-sm font-bold text-white uppercase tracking-wider">The Feynman Rule</h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Nobel physicist Richard Feynman suggested that if you cannot explain a concept to a young child without using complex jargon, you do not fully understand it yourself.
              </p>
              <div className="bg-white/5 p-4 rounded-xl border border-white/5 font-sans text-xs text-slate-300 italic leading-relaxed">
                "Simple explanations build strong neural links. Removing jargon forces your brain to capture the structural logic."
              </div>
              <div className="pt-2 flex items-center gap-2 text-[10px] text-emerald-400/80 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Simplicity Auditor Active</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Evaluation Results View */
        <div key="result" className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-6 backdrop-blur-md space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-white">Audience Simplicity Check</h3>
                  <p className="font-sans text-xs text-slate-500 mt-1">Simulated Audience: <strong className="text-white uppercase font-bold">{audience}</strong></p>
                  {selectedDocs.length > 0 && (
                    <p className="font-sans text-xs text-slate-400 mt-2">
                      Reference Materials: <strong className="text-white">{selectedDocs.join(', ')}</strong>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4 bg-white/5 px-4 py-2.5 rounded-xl border border-white/5 shrink-0">
                  <div className="text-right">
                    <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">Simplicity Index</span>
                    <span className="font-mono text-sm font-bold text-white">{evaluationResult.score} / 100</span>
                  </div>
                  <div className="w-px h-8 bg-white/10"></div>
                  <div className="text-right">
                    <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">Audited Grade</span>
                    <span className="font-mono text-xs font-bold text-primary-fixed-dim">{evaluationResult.gradeLevel}</span>
                  </div>
                </div>
              </div>

              {/* Progress and Score */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="font-sans text-sm font-semibold text-slate-300">Audience Clarity Percentage</span>
                  <span className="font-mono text-3xl font-black text-primary-fixed-dim">{evaluationResult.score}%</span>
                </div>
                <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-primary-fixed-dim to-emerald-400 transition-all duration-1000"
                    style={{ width: `${evaluationResult.score}%` }}
                  />
                </div>
              </div>

              <div className="flex gap-3 bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 p-4 rounded-xl">
                <MessageSquare className="w-5 h-5 text-primary-fixed-dim shrink-0" />
                <p className="font-sans text-xs text-slate-300 leading-relaxed">
                  <strong>Audience Auditor Feedback:</strong> {evaluationResult.feedback}
                </p>
              </div>
            </div>

            {/* Jargon flags and analogies */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Jargon flagged */}
              <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
                <h4 className="font-display text-sm font-bold text-amber-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> Academic Jargon Flagged ({evaluationResult.jargon.length})
                </h4>
                {evaluationResult.jargon.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {evaluationResult.jargon.map((word: string, i: number) => (
                      <span key={i} className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 font-sans text-xs font-semibold">
                        {word}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-slate-400 leading-relaxed">Perfect simplicity! No complex terms detected for this audience level.</p>
                )}
              </div>

              {/* Analogy suggestion */}
              <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
                <h4 className="font-display text-sm font-bold text-emerald-400 flex items-center gap-2">
                  <Heart className="w-4 h-4 shrink-0" /> Analogy Suggestions
                </h4>
                {evaluationResult.analogy ? (
                  <p className="font-sans text-xs text-slate-300 leading-relaxed bg-emerald-500/5 border border-emerald-500/10 p-3.5 rounded-xl">
                    {evaluationResult.analogy}
                  </p>
                ) : (
                  <p className="font-sans text-xs text-slate-400">Your explanation is already concrete and clean.</p>
                )}
              </div>
            </div>
          </div>

          {/* Right action panel */}
          <div className="space-y-6">
            <div className="bg-surface-container/30 border border-white/5 rounded-2xl p-6 space-y-4">
              <h4 className="font-display text-sm font-bold text-white uppercase tracking-wider font-semibold">Simplification Logged</h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Simplifying complex subjects forces active mental reconstruction. This concept breakdown has been archived to your personal study dashboard.
              </p>
              
              <div className="pt-4 border-t border-white/5">
                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-sans text-xs font-bold transition-all active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Explain Another Concept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
