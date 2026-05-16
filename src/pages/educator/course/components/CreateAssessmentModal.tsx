import React, { useState, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Zap, Flame, Snowflake, Shield, List, ToggleLeft, HelpCircle, Edit3, GitMerge, AlignLeft, FileText, PenTool, Sparkles, Plus, Trash2, Save } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props { isOpen: boolean; onClose: () => void; courseResources: string[]; onCreate: (data: any) => void; }
type QType = 'multiple-choice' | 'true-false' | 'identification' | 'fill-in-the-blank' | 'essay' | 'matching';
type Diff = 'easy' | 'medium' | 'hard';

interface GenQuestion {
  id: string;
  text: string;
  type: QType;
  options: string[];
  correct: number;
  answerText: string;
  matchingPairs: { left: string; right: string }[];
  editing: boolean;
}

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

const makeQuestion = (i: number, types: QType[]): GenQuestion => {
  const type = types[i % types.length] || 'multiple-choice';
  return {
    id: `q-${Date.now()}-${i}`,
    text: `AI-generated question ${i + 1}: What is the primary concept described in the selected resource?`,
    type,
    options: type === 'true-false' ? ['True', 'False'] : ['Option A', 'Option B', 'Option C', 'Option D'],
    correct: 0,
    answerText: 'Correct Answer',
    matchingPairs: [{ left: 'Term 1', right: 'Definition 1' }, { left: 'Term 2', right: 'Definition 2' }],
    editing: false,
  };
};

export default function CreateAssessmentModal({ isOpen, onClose, courseResources, onCreate }: Props) {
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
  const [questions, setQuestions] = useState<GenQuestion[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const totalSteps = method === 'ai' ? 5 : 3;
  const toggleType = (t: QType) => setSelectedTypes(p => p.includes(t) ? (p.length > 1 ? p.filter(x => x !== t) : p) : [...p, t]);
  const canProceed0 = title.trim().length > 0;
  const canProceed1 = method === 'manual' || selectedResources.length > 0;

  const diffColorMap: Record<string, { sel: string; unsel: string }> = {
    emerald: { sel: 'border-emerald-400 bg-emerald-400/10 text-emerald-300', unsel: 'border-white/10 text-slate-400' },
    amber: { sel: 'border-amber-400 bg-amber-400/10 text-amber-300', unsel: 'border-white/10 text-slate-400' },
    red: { sel: 'border-red-400 bg-red-400/10 text-red-300', unsel: 'border-white/10 text-slate-400' },
  };

  const handleNextFromReview = () => {
    if (method === 'ai' && step === 3) {
      setQuestions(Array.from({ length: questionCount }, (_, i) => makeQuestion(i, selectedTypes)));
    }
    setStep(s => s + 1);
  };

  const handleSave = (status: 'draft' | 'ready') => {
    onCreate({ title, type: assessType, isLockdown, duration, deadline, method, selectedResources, selectedTypes, difficulty, questionCount, questions, status });
    setStep(0); setTitle(''); setQuestions([]); onClose();
  };

  // Question editor helpers
  const updateQ = (id: string, patch: Partial<GenQuestion>) =>
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q));
  const deleteQ = (id: string) => setQuestions(qs => qs.filter(q => q.id !== id));
  const addQuestion = () => {
    setQuestions(qs => [...qs, { ...makeQuestion(qs.length, selectedTypes), text: '', editing: true }]);
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }, 100);
  };

  const isLastStep = (method === 'manual' && step === 2) || (method === 'ai' && step === 4);
  const isGenerateStep = method === 'ai' && step === 3;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Create Assessment</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">
              Step {step + 1} of {totalSteps} — {['Details', 'Method', method === 'ai' ? 'Configure AI' : 'Review', 'Review Config', 'Edit Questions'][step]}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        {/* Progress bar */}
        <div className="flex h-1 shrink-0">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`flex-1 transition-all duration-500 ${i <= step ? 'bg-primary-fixed-dim' : 'bg-white/5'}`} />
          ))}
        </div>

        {/* Body */}
        <div ref={scrollRef} className="p-6 overflow-y-auto flex-1 no-scrollbar scroll-smooth relative">

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
                <button onClick={() => setMethod('manual')} className={`p-5 rounded-xl border-2 text-left transition-all ${method === 'manual' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                  <PenTool className={`w-6 h-6 mb-3 ${method === 'manual' ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-sans text-sm font-semibold ${method === 'manual' ? 'text-primary-fixed' : 'text-white'}`}>Manual</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">Write questions yourself</p>
                </button>
                <button onClick={() => setMethod('ai')} className={`p-5 rounded-xl border-2 text-left transition-all ${method === 'ai' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
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

          {/* Step 2 AI: Configure */}
          {step === 2 && method === 'ai' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Question Types</p>
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

          {/* Review Config */}
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
                  {method === 'ai' ? 'Click Generate to create questions from your selected resources. You can edit them in the next step.' : 'The assessment will be saved as a draft. You can add questions manually from the editor.'}
                </p>
              </div>
            </div>
          )}

          {/* Step 4 AI: Editable Questions */}
          {step === 4 && method === 'ai' && (
            <div className="space-y-4">
              <div className="sticky top-[-24px] z-20 bg-surface-container-high py-4 -mx-6 px-6 border-b border-white/10 flex items-center justify-between mb-2 shadow-sm">
                <div>
                  <p className="font-sans text-sm text-slate-300 font-medium">Review & Edit Questions</p>
                  <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">{questions.length} total questions</p>
                </div>
                <button onClick={addQuestion}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 text-primary-fixed-dim text-xs font-bold hover:bg-primary-fixed-dim/20 transition-all active:scale-95 shadow-lg shadow-primary-fixed-dim/5">
                  <Plus className="w-4 h-4" /> Add Question
                </button>
              </div>
              <div className="space-y-3 pb-6">
                {questions.map((q, idx) => (
                  <div key={q.id} className="bg-surface-container rounded-xl border border-white/5 overflow-hidden">
                    {q.editing ? (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded">Q{idx + 1}</span>
                          <select value={q.type} onChange={e => updateQ(q.id, { type: e.target.value as QType })}
                            className="bg-surface-container-high border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-sans outline-none">
                            {Q_TYPES.map(qt => <option key={qt.id} value={qt.id}>{qt.label}</option>)}
                          </select>
                        </div>
                        <textarea value={q.text} onChange={e => updateQ(q.id, { text: e.target.value })}
                          placeholder="Enter question text…"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none min-h-[60px]" />
                        {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                          <div className="space-y-2">
                            {q.type === 'multiple-choice' && <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Options & Correct Answer</p>}
                            {q.type === 'true-false' && <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Select Correct Answer</p>}
                            {q.options.map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-2">
                                <button onClick={() => updateQ(q.id, { correct: oi })}
                                  className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${q.correct === oi ? 'border-emerald-400 bg-emerald-400' : 'border-white/20'}`}>
                                  {q.correct === oi && <Check className="w-3 h-3 text-black" />}
                                </button>
                                {q.type === 'multiple-choice' ? (
                                  <input value={opt} onChange={e => { const opts = [...q.options]; opts[oi] = e.target.value; updateQ(q.id, { options: opts }); }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                ) : (
                                  <span className="text-sm text-white font-sans">{opt}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                          <div className="space-y-1.5">
                            <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Correct Answer</p>
                            <input value={q.answerText} onChange={e => updateQ(q.id, { answerText: e.target.value })}
                              placeholder="Type the exact correct answer..."
                              className="w-full bg-white/5 border border-emerald-400/50 rounded-lg px-3 py-2 text-sm text-emerald-100 font-sans outline-none focus:ring-1 focus:ring-emerald-400/50" />
                          </div>
                        )}
                        {q.type === 'matching' && (
                          <div className="space-y-2">
                            <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Matching Pairs</p>
                            {q.matchingPairs.map((pair, pi) => (
                              <div key={pi} className="flex items-center gap-2">
                                <input value={pair.left} onChange={e => { const pairs = [...q.matchingPairs]; pairs[pi].left = e.target.value; updateQ(q.id, { matchingPairs: pairs }); }}
                                  placeholder="Term"
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                <span className="text-slate-500">-</span>
                                <input value={pair.right} onChange={e => { const pairs = [...q.matchingPairs]; pairs[pi].right = e.target.value; updateQ(q.id, { matchingPairs: pairs }); }}
                                  placeholder="Definition"
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                <button onClick={() => { const pairs = q.matchingPairs.filter((_, i) => i !== pi); updateQ(q.id, { matchingPairs: pairs }); }}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-400/10">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                            <button onClick={() => updateQ(q.id, { matchingPairs: [...q.matchingPairs, { left: '', right: '' }] })}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs font-semibold hover:bg-white/10 transition-colors w-full justify-center mt-2">
                              <Plus className="w-3.5 h-3.5" /> Add Pair
                            </button>
                          </div>
                        )}
                        {q.type === 'essay' && (
                          <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                            <p className="text-xs text-slate-400 font-sans italic">Essay questions will be manually graded by the educator.</p>
                          </div>
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={() => updateQ(q.id, { editing: false })}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-colors flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Done
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 flex items-start gap-3 group">
                        <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded shrink-0 mt-0.5">Q{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm text-white leading-relaxed">{q.text || <span className="text-slate-500 italic">No question text</span>}</p>
                          
                          {/* Answer Preview */}
                          <div className="mt-2 text-xs font-sans">
                            {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                              <span className="text-emerald-400 font-medium">Answer: {q.options[q.correct]}</span>
                            )}
                            {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                              <span className="text-emerald-400 font-medium">Answer: {q.answerText || 'Not set'}</span>
                            )}
                            {q.type === 'matching' && (
                              <span className="text-emerald-400 font-medium">{q.matchingPairs.length} pairs</span>
                            )}
                            {q.type === 'essay' && (
                              <span className="text-slate-400 italic">Manual Grading</span>
                            )}
                          </div>
                          
                          <span className="font-sans text-[10px] text-slate-500 uppercase tracking-wider mt-2 block">{q.type}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={() => updateQ(q.id, { editing: true })}
                            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Edit">
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteQ(q.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {isLastStep ? (
            <div className="flex items-center gap-3">
              <button onClick={() => handleSave('draft')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-sans text-sm font-bold border border-white/20 text-slate-300 hover:bg-white/5 transition-all">
                <Save className="w-4 h-4" /> Save as Draft
              </button>
              <button onClick={() => handleSave('ready')}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all hover:opacity-90">
                <Sparkles className="w-4 h-4" /> Save as Ready
              </button>
            </div>
          ) : (
            <button onClick={isGenerateStep ? handleNextFromReview : () => setStep(s => s + 1)}
              disabled={(step === 0 && !canProceed0) || (step === 1 && !canProceed1)}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {isGenerateStep ? <><Sparkles className="w-4 h-4" /> Generate</> : <>Next <ChevronRight className="w-4 h-4" /></>}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
