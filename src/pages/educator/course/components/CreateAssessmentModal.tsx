import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Zap, Flame, Snowflake, Shield, List, ToggleLeft, HelpCircle, Edit3, GitMerge, AlignLeft, FileText, PenTool, Sparkles, Clock, Calendar } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props { isOpen: boolean; onClose: () => void; courseResources: string[]; }

type QType = 'multiple-choice' | 'true-false' | 'identification' | 'fill-in-the-blank' | 'essay' | 'matching';
type Diff = 'easy' | 'medium' | 'hard';

const Q_TYPES: { id: QType; label: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True / False', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', icon: <Edit3 className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'essay', label: 'Essay', icon: <AlignLeft className="w-4 h-4" /> },
];
const DIFFS: { id: Diff; label: string; color: string; icon: React.ReactNode }[] = [
  { id: 'easy', label: 'Easy', color: 'emerald', icon: <Snowflake className="w-4 h-4" /> },
  { id: 'medium', label: 'Medium', color: 'amber', icon: <Zap className="w-4 h-4" /> },
  { id: 'hard', label: 'Hard', color: 'red', icon: <Flame className="w-4 h-4" /> },
];
const Q_COUNTS = [5, 10, 15, 20, 25, 30, 40, 50];

export default function CreateAssessmentModal({ isOpen, onClose, courseResources }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [assessType, setAssessType] = useState<'quiz' | 'exam'>('quiz');
  const [isLockdown, setIsLockdown] = useState(false);
  const [duration, setDuration] = useState(30);
  const [deadline, setDeadline] = useState('');
  const [method, setMethod] = useState<'manual' | 'ai'>('ai');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<QType[]>(['multiple-choice']);
  const [difficulty, setDifficulty] = useState<Diff>('medium');
  const [questionCount, setQuestionCount] = useState(10);

  if (!isOpen) return null;

  const toggleType = (t: QType) => setSelectedTypes(p => p.includes(t) ? (p.length > 1 ? p.filter(x => x !== t) : p) : [...p, t]);
  const canProceed0 = title.trim().length > 0;
  const canProceed1 = method === 'manual' || selectedResources.length > 0;

  const handleCreate = () => {
    if (method === 'manual') {
      alert(`Assessment "${title}" created as Draft. You can now add questions manually.`);
    } else {
      alert(`AI is generating ${questionCount} questions from ${selectedResources.length} resource(s).\nYou can review and edit them before deploying.`);
    }
    setStep(0); setTitle(''); onClose();
  };

  const diffColorMap: Record<string, { sel: string; unsel: string }> = {
    emerald: { sel: 'border-emerald-400 bg-emerald-400/10 text-emerald-300', unsel: 'border-white/10 text-slate-400' },
    amber: { sel: 'border-amber-400 bg-amber-400/10 text-amber-300', unsel: 'border-white/10 text-slate-400' },
    red: { sel: 'border-red-400 bg-red-400/10 text-red-300', unsel: 'border-white/10 text-slate-400' },
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Create Assessment</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">
              Step {step + 1} of {method === 'ai' ? 4 : 3} — {step === 0 ? 'Details' : step === 1 ? 'Generation Method' : step === 2 ? (method === 'ai' ? 'Configure AI' : 'Review') : 'Review'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex h-1">
          {Array.from({ length: method === 'ai' ? 4 : 3 }).map((_, i) => (
            <div key={i} className={`flex-1 transition-all duration-500 ${i <= step ? 'bg-primary-fixed-dim' : 'bg-white/5'}`} />
          ))}
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto no-scrollbar">
          {/* Step 0: Details */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Title *</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Midterm Exam"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3 block">Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['quiz', 'exam'] as const).map(t => (
                    <button key={t} onClick={() => setAssessType(t)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${assessType === t ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                      <p className={`font-sans text-sm font-semibold capitalize ${assessType === t ? 'text-primary-fixed' : 'text-white'}`}>{t}</p>
                      <p className="font-sans text-xs text-slate-400 mt-1">{t === 'quiz' ? 'Short assessment' : 'Comprehensive exam'}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Duration (min)</label>
                  <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} min={5} max={240}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
                <div>
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Deadline</label>
                  <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
              </div>
              <button onClick={() => setIsLockdown(!isLockdown)}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${isLockdown ? 'border-rose-400 bg-rose-400/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                <Shield className={`w-5 h-5 ${isLockdown ? 'text-rose-400' : 'text-slate-400'}`} />
                <div>
                  <p className={`font-sans text-sm font-semibold ${isLockdown ? 'text-rose-300' : 'text-white'}`}>Lockdown Browser</p>
                  <p className="font-sans text-xs text-slate-400">Prevents tab-switching during the assessment</p>
                </div>
                <div className={`ml-auto w-10 h-6 rounded-full flex items-center px-1 transition-all ${isLockdown ? 'bg-rose-400 justify-end' : 'bg-white/10 justify-start'}`}>
                  <div className="w-4 h-4 rounded-full bg-white shadow" />
                </div>
              </button>
            </div>
          )}

          {/* Step 1: Method */}
          {step === 1 && (
            <div className="space-y-5">
              <p className="font-sans text-sm text-slate-300">How would you like to create questions?</p>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setMethod('manual')}
                  className={`p-5 rounded-xl border-2 text-left transition-all ${method === 'manual' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                  <PenTool className={`w-6 h-6 mb-3 ${method === 'manual' ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-sans text-sm font-semibold ${method === 'manual' ? 'text-primary-fixed' : 'text-white'}`}>Manual</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">Write questions yourself</p>
                </button>
                <button onClick={() => setMethod('ai')}
                  className={`p-5 rounded-xl border-2 text-left transition-all ${method === 'ai' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                  <Sparkles className={`w-6 h-6 mb-3 ${method === 'ai' ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-sans text-sm font-semibold ${method === 'ai' ? 'text-primary-fixed' : 'text-white'}`}>AI-Assisted</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">Generate from resources</p>
                </button>
              </div>
              {method === 'ai' && (
                <div className="space-y-2">
                  <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Select Source Resources</p>
                  {courseResources.map(res => {
                    const sel = selectedResources.includes(res);
                    return (
                      <button key={res} onClick={() => setSelectedResources(p => p.includes(res) ? p.filter(r => r !== res) : [...p, res])}
                        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${sel ? 'border-primary-fixed-dim/50 bg-primary-fixed-dim/10' : 'border-white/5 bg-surface-container hover:border-white/20'}`}>
                        <div className="flex items-center gap-3">
                          <FileText className={`w-5 h-5 ${sel ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                          <p className={`font-sans text-sm font-semibold ${sel ? 'text-primary-fixed' : 'text-white'}`}>{res}</p>
                        </div>
                        {sel && <Check className="w-4 h-4 text-primary-fixed-dim shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 2: AI Config (only if AI method) */}
          {step === 2 && method === 'ai' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Question Types <span className="text-slate-600 normal-case">(select all)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  {Q_TYPES.map(qt => {
                    const sel = selectedTypes.includes(qt.id);
                    return (
                      <button key={qt.id} onClick={() => toggleType(qt.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all flex items-center gap-2 ${sel ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                        <span className={sel ? 'text-primary-fixed-dim' : 'text-slate-400'}>{qt.icon}</span>
                        <p className={`font-sans text-sm font-semibold ${sel ? 'text-primary-fixed' : 'text-white'}`}>{qt.label}</p>
                        {sel && <Check className="w-3.5 h-3.5 text-primary-fixed-dim ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Difficulty</p>
                <div className="grid grid-cols-3 gap-3">
                  {DIFFS.map(d => {
                    const sel = difficulty === d.id;
                    const cm = diffColorMap[d.color];
                    return (
                      <button key={d.id} onClick={() => setDifficulty(d.id)}
                        className={`p-3 rounded-xl border-2 text-center transition-all bg-surface-container ${sel ? cm.sel : cm.unsel}`}>
                        <span className="flex justify-center mb-1">{d.icon}</span>
                        <p className="font-sans text-sm font-bold">{d.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Number of Questions</p>
                <div className="flex gap-2 flex-wrap">
                  {Q_COUNTS.map(n => (
                    <button key={n} onClick={() => setQuestionCount(n)}
                      className={`px-4 py-2 rounded-xl border-2 font-sans text-sm font-bold transition-all ${questionCount === n ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-primary-fixed' : 'border-white/10 bg-surface-container text-slate-400 hover:border-white/20'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Review Step */}
          {((step === 2 && method === 'manual') || (step === 3 && method === 'ai')) && (
            <div className="space-y-5">
              <p className="font-sans text-sm text-slate-300">Review your assessment configuration.</p>
              <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                {[
                  { label: 'Title', value: title },
                  { label: 'Type', value: assessType },
                  { label: 'Duration', value: `${duration} min` },
                  { label: 'Lockdown', value: isLockdown ? 'Yes' : 'No' },
                  { label: 'Method', value: method === 'ai' ? 'AI-Assisted' : 'Manual' },
                  ...(method === 'ai' ? [
                    { label: 'Resources', value: `${selectedResources.length} selected` },
                    { label: 'Difficulty', value: difficulty },
                    { label: 'Questions', value: String(questionCount) },
                  ] : []),
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-5 py-3">
                    <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">{r.label}</span>
                    <span className="font-sans text-sm text-white font-medium capitalize">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 rounded-xl p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary-fixed-dim mt-0.5 shrink-0" />
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  {method === 'ai'
                    ? 'Questions will be generated from your selected resources. You can review, edit, and reorder them before deploying.'
                    : 'The assessment will be saved as a draft. You can add questions manually from the editor.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {((method === 'manual' && step < 2) || (method === 'ai' && step < 3)) ? (
            <button onClick={() => setStep(s => s + 1)}
              disabled={(step === 0 && !canProceed0) || (step === 1 && !canProceed1)}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleCreate}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all">
              <Sparkles className="w-4 h-4" /> {method === 'ai' ? 'Generate & Review' : 'Save as Draft'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
