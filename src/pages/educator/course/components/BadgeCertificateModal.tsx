import { useState } from 'react';
import { X, Award, Medal, Trophy, Star, Shield, Sparkles, Check } from 'lucide-react';
import { createPortal } from 'react-dom';

interface Props {
  isOpen: boolean; onClose: () => void;
  studentName: string; courseName: string;
}

const BADGE_TEMPLATES = [
  { id: 'top-scorer', title: 'Top Scorer', desc: 'Achieved highest score', icon: Trophy, color: '#f59e0b' },
  { id: 'perfect-attendance', title: 'Perfect Attendance', desc: 'Never missed an assessment', icon: Star, color: '#22d3ee' },
  { id: 'most-improved', title: 'Most Improved', desc: 'Significant grade improvement', icon: Medal, color: '#34d399' },
  { id: 'excellence', title: 'Excellence Award', desc: 'Outstanding performance', icon: Award, color: '#818cf8' },
  { id: 'completion', title: 'Course Completion', desc: 'Completed all course requirements', icon: Shield, color: '#f472b6' },
];

export default function BadgeCertificateModal({ isOpen, onClose, studentName, courseName }: Props) {
  const [tab, setTab] = useState<'badge' | 'certificate'>('badge');
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  if (!isOpen) return null;

  const handleIssue = () => {
    if (tab === 'badge') {
      const badge = useCustom ? customTitle : BADGE_TEMPLATES.find(b => b.id === selectedBadge)?.title;
      alert(`Badge "${badge}" issued to ${studentName}!`);
    } else {
      alert(`Certificate of Completion issued to ${studentName} for "${courseName}"!`);
    }
    onClose();
  };

  const canIssue = tab === 'certificate' || (useCustom ? customTitle.trim().length > 0 : selectedBadge !== null);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Issue Recognition</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">For {studentName} · {courseName}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button onClick={() => setTab('badge')}
            className={`flex-1 py-3 font-display text-sm font-semibold transition-colors border-b-2 ${tab === 'badge' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-slate-400 border-transparent hover:text-white'}`}>
            <Award className="w-4 h-4 inline mr-2" />Badge
          </button>
          <button onClick={() => setTab('certificate')}
            className={`flex-1 py-3 font-display text-sm font-semibold transition-colors border-b-2 ${tab === 'certificate' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-slate-400 border-transparent hover:text-white'}`}>
            <Shield className="w-4 h-4 inline mr-2" />Certificate
          </button>
        </div>

        <div className="p-6 max-h-[55vh] overflow-y-auto no-scrollbar">
          {tab === 'badge' && (
            <div className="space-y-4">
              {/* Templates */}
              <div className="space-y-2">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Select a Badge</p>
                <div className="grid grid-cols-1 gap-2">
                  {BADGE_TEMPLATES.map(b => {
                    const sel = !useCustom && selectedBadge === b.id;
                    const Icon = b.icon;
                    return (
                      <button key={b.id} onClick={() => { setSelectedBadge(b.id); setUseCustom(false); }}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${sel ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${b.color}20`, color: b.color }}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <p className={`font-sans text-sm font-semibold ${sel ? 'text-primary-fixed' : 'text-white'}`}>{b.title}</p>
                          <p className="font-sans text-xs text-slate-400">{b.desc}</p>
                        </div>
                        {sel && <Check className="w-4 h-4 text-primary-fixed-dim shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom */}
              <div>
                <button onClick={() => setUseCustom(!useCustom)}
                  className={`w-full p-3 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${useCustom ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                  <Sparkles className={`w-5 h-5 ${useCustom ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-sans text-sm font-semibold ${useCustom ? 'text-primary-fixed' : 'text-white'}`}>Custom Badge</p>
                </button>
                {useCustom && (
                  <div className="mt-3 space-y-3 pl-1">
                    <input type="text" value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Badge title"
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                    <input type="text" value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Description (optional)"
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'certificate' && (
            <div className="space-y-5">
              {/* Certificate preview */}
              <div className="rounded-xl border border-white/10 p-6 bg-gradient-to-br from-white/[0.04] to-transparent text-center">
                <Shield className="w-12 h-12 text-primary-fixed-dim mx-auto mb-3" />
                <p className="font-sans text-[10px] text-slate-500 uppercase tracking-[0.3em]">Certificate of Completion</p>
                <h3 className="font-display text-2xl font-bold text-white mt-2 mb-1">{courseName}</h3>
                <p className="font-sans text-sm text-slate-400">Awarded to</p>
                <p className="font-display text-lg font-semibold text-primary-fixed-dim mt-1">{studentName}</p>
                <div className="mt-4 w-32 mx-auto border-t border-white/10 pt-3">
                  <p className="font-sans text-xs text-slate-500">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
              <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-xl p-4">
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  This certificate will appear in the student's profile achievements section and can be shared publicly.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleIssue} disabled={!canIssue}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 text-black rounded-xl font-sans text-sm font-bold shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            <Award className="w-4 h-4" /> Issue {tab === 'badge' ? 'Badge' : 'Certificate'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
