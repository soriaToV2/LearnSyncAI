import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Globe, Lock, Building, RefreshCw, Sparkles, Check } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props { isOpen: boolean; onClose: () => void; }

const CATEGORIES = ['Computer Science', 'Biology', 'Physics', 'Mathematics', 'Chemistry', 'Engineering', 'Psychology', 'Literature', 'Other'];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function CreateCourseModal({ isOpen, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tiedToUni, setTiedToUni] = useState(true);
  const [university, setUniversity] = useState('MIT');
  const [isPublic, setIsPublic] = useState(true);
  const [courseCode, setCourseCode] = useState(generateCode());

  if (!isOpen) return null;

  const canProceed0 = title.trim().length > 0 && category.length > 0;

  const handleCreate = () => {
    alert(`Course "${title}" created!\nCode: ${courseCode}\nVisibility: ${isPublic ? 'Public' : 'Restricted'}\nUniversity: ${tiedToUni ? university : 'Independent'}`);
    setStep(0); setTitle(''); setDescription(''); setCategory('');
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Create Course</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">
              Step {step + 1} of 3 — {step === 0 ? 'Basic Info' : step === 1 ? 'Visibility & Access' : 'Review'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex h-1">
          {[0, 1, 2].map(i => (
            <div key={i} className={`flex-1 transition-all duration-500 ${i <= step ? 'bg-primary-fixed-dim' : 'bg-white/5'}`} />
          ))}
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto no-scrollbar">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Title *</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Advanced Neurobiology"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What will students learn?"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none" />
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Category *</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setCategory(c)}
                      className={`px-3 py-1.5 rounded-lg font-sans text-xs font-semibold border transition-all ${category === c
                        ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/20'
                      }`}>{c}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3 block">University Affiliation</label>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setTiedToUni(true)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${tiedToUni ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                    <Building className={`w-5 h-5 mb-2 ${tiedToUni ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                    <p className={`font-sans text-sm font-semibold ${tiedToUni ? 'text-primary-fixed' : 'text-white'}`}>University Course</p>
                    <p className="font-sans text-xs text-slate-400 mt-1">Tied to your institution</p>
                  </button>
                  <button onClick={() => setTiedToUni(false)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${!tiedToUni ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                    <Sparkles className={`w-5 h-5 mb-2 ${!tiedToUni ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                    <p className={`font-sans text-sm font-semibold ${!tiedToUni ? 'text-primary-fixed' : 'text-white'}`}>Independent</p>
                    <p className="font-sans text-xs text-slate-400 mt-1">Not tied to any university</p>
                  </button>
                </div>
                {tiedToUni && (
                  <input type="text" value={university} onChange={e => setUniversity(e.target.value)} placeholder="University name"
                    className="mt-3 w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                )}
              </div>

              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3 block">Visibility</label>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setIsPublic(true)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${isPublic ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                    <Globe className={`w-5 h-5 mb-2 ${isPublic ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <p className={`font-sans text-sm font-semibold ${isPublic ? 'text-emerald-300' : 'text-white'}`}>Public</p>
                    <p className="font-sans text-xs text-slate-400 mt-1">Discoverable in catalog</p>
                  </button>
                  <button onClick={() => setIsPublic(false)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${!isPublic ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                    <Lock className={`w-5 h-5 mb-2 ${!isPublic ? 'text-amber-400' : 'text-slate-400'}`} />
                    <p className={`font-sans text-sm font-semibold ${!isPublic ? 'text-amber-300' : 'text-white'}`}>Restricted</p>
                    <p className="font-sans text-xs text-slate-400 mt-1">Code required to join</p>
                  </button>
                </div>
              </div>

              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Code</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 font-mono text-lg text-white tracking-[0.3em] text-center">
                    {courseCode}
                  </div>
                  <button onClick={() => setCourseCode(generateCode())}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <p className="font-sans text-xs text-slate-500 mt-2">Students will use this code to join your course.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <p className="font-sans text-sm text-slate-300">Review your course details before creating.</p>
              <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                {[
                  { label: 'Title', value: title },
                  { label: 'Category', value: category },
                  { label: 'University', value: tiedToUni ? university : 'Independent' },
                  { label: 'Visibility', value: isPublic ? 'Public' : 'Restricted' },
                  { label: 'Course Code', value: courseCode },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-5 py-4">
                    <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">{r.label}</span>
                    <span className="font-sans text-sm text-white font-medium">{r.value || '—'}</span>
                  </div>
                ))}
              </div>
              {description && (
                <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                  <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2">Description</p>
                  <p className="font-sans text-sm text-slate-300">{description}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 2 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={step === 0 && !canProceed0}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleCreate}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] hover:shadow-[0_0_30px_rgba(0,218,243,0.5)] transition-all">
              <Check className="w-4 h-4" /> Create Course
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
