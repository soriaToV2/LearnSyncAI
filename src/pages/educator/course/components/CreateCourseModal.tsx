import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, RefreshCw, Check, Copy } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props { isOpen: boolean; onClose: () => void; onCreate: (data: any) => void; }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function CreateCourseModal({ isOpen, onClose, onCreate }: Props) {
  const [step, setStep] = useState(0);
  const [subjectCode, setSubjectCode] = useState('');
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [description, setDescription] = useState('');
  const [tiedToUni, setTiedToUni] = useState(false);
  const [university, setUniversity] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [courseCode, setCourseCode] = useState(generateCode());
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  const canProceed0 = subjectCode.trim().length > 0 && title.trim().length > 0;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(courseCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${courseCode}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreate = () => {
    const combinedTitle = `${subjectCode.trim().toUpperCase()} - ${title.trim()}`;
    onCreate({
      title: combinedTitle,
      description,
      tiedToUni,
      university: tiedToUni ? university : undefined,
      isPublic,
      courseCode,
      section: section.trim() || undefined
    });
    setStep(0); setSubjectCode(''); setTitle(''); setSection(''); setDescription('');
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4 p-0 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface-container-high sm:rounded-2xl rounded-none border border-white/10 shadow-2xl overflow-hidden h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Create Course</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">
              Step {step + 1} of 3 — {step === 0 ? 'Basic Info' : step === 1 ? 'Course Access' : 'Review'}
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

        <div className="p-6 flex-1 overflow-y-auto no-scrollbar">
          {step === 0 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-1">
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Code *</label>
                  <input type="text" value={subjectCode} onChange={e => setSubjectCode(e.target.value)} placeholder="e.g. CS201"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
                <div className="sm:col-span-2">
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Title *</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Computer Algorithm"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
                <div className="sm:col-span-1">
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Section</label>
                  <input type="text" value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. A"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What will students learn?"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Class Join Code</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 font-mono text-lg text-white tracking-[0.3em] text-center font-bold">
                    {courseCode}
                  </div>
                  <button onClick={() => setCourseCode(generateCode())}
                    title="Regenerate Code"
                    className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={handleCopyCode}
                    title="Copy Code"
                    className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1.5 min-w-[44px] justify-center">
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="font-sans text-xs text-slate-400 mt-2">Students can use this unique code to manually join the course.</p>
              </div>

              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Class Invite Link</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 font-sans text-sm text-slate-300 truncate select-all">
                    {`${window.location.origin}/join/${courseCode}`}
                  </div>
                  <button onClick={handleCopyLink}
                    title="Copy Link"
                    className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1.5 min-w-[44px] justify-center">
                    {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="font-sans text-xs text-slate-400 mt-2 font-medium">Students clicking this link will be automatically enrolled and redirected to the class.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <p className="font-sans text-sm text-slate-300">Review your course details before creating.</p>
              <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                {[
                  { label: 'Title', value: `${subjectCode.trim().toUpperCase()} - ${title.trim()}` },
                  { label: 'Section', value: section.trim() || '—' },
                  { label: 'Class Join Code', value: courseCode },
                  { label: 'Class Invite Link', value: `${window.location.origin}/join/${courseCode}` },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-5 py-4 gap-4">
                    <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold shrink-0">{r.label}</span>
                    <span className="font-sans text-sm text-white font-medium truncate max-w-[280px]">{r.value || '—'}</span>
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
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
