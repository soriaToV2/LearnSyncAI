import { useState } from 'react';
import {
  CheckCircle2, AlertCircle, Clock, User, BarChart2,
  ChevronRight, Award, Search, SlidersHorizontal,
} from 'lucide-react';
import Modal from '../../../../components/ui/Modal';
import type { Assessment, Submission } from '../../../../data/mockEducatorData';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment;
  onGrade: (submission: Submission) => void;
}

const STATUS_CFG = {
  graded: { label: 'Graded', dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  'needs-review': { label: 'Needs Review', dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  submitted: { label: 'Submitted', dot: 'bg-slate-400', text: 'text-slate-300', bg: 'bg-white/5', border: 'border-white/10' },
};

function Avatar({ name, src, size = 8 }: { name: string; src: string; size?: number }) {
  const cls = `w-${size} h-${size} rounded-full object-cover border border-white/10 shrink-0`;
  return src
    ? <img src={src} alt={name} className={cls} />
    : <div className={`w-${size} h-${size} rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-white border border-white/10 shrink-0`}>
      {name.split(' ').map(n => n[0]).join('')}
    </div>;
}

export default function SubmissionsModal({ isOpen, onClose, assessment, onGrade }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'graded' | 'needs-review'>('all');

  if (!isOpen) return null;

  const subs = assessment.submissions.filter(s => {
    const matchSearch = s.studentName.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || s.status === filter;
    return matchSearch && matchFilter;
  });

  const total = assessment.submissions.length;
  const graded = assessment.submissions.filter(s => s.status === 'graded').length;
  const needsReview = assessment.submissions.filter(s => s.status === 'needs-review').length;
  const avgScore = total > 0
    ? Math.round(assessment.submissions.reduce((sum, s) => sum + (s.totalScore ?? s.autoScore), 0) / total)
    : 0;
  const maxScore = assessment.submissions[0]?.maxScore ?? 0;
  const pct = maxScore > 0 ? Math.round((avgScore / maxScore) * 100) : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex flex-col gap-1 items-start">
          <span className="font-display text-base sm:text-lg font-semibold text-white">Submissions</span>
          <p className="font-sans text-xs text-slate-400 font-normal normal-case truncate max-w-xs">{assessment.title}</p>
        </div>
      }
      maxWidth="max-w-2xl"
      noPadding={true}
    >
      <div className="flex flex-col max-h-[75vh] landscape:max-h-[60vh] sm:max-h-[80vh] md:max-h-[85vh]">
        {/* Stats Row & Avg Score Bar (originally after header) */}
        <div className="px-6 py-4 border-b border-white/10 shrink-0 bg-surface-container/20">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Submitted', value: total, color: 'text-white' },
              { label: 'Graded', value: graded, color: 'text-emerald-400' },
              { label: 'Pending', value: needsReview, color: needsReview > 0 ? 'text-amber-400' : 'text-slate-400' },
              { label: 'Avg Score', value: `${pct}%`, color: pct >= 75 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/5 rounded-xl p-3 text-center border border-white/5">
                <p className={`font-display text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Class Average</p>
                <p className="font-sans text-xs text-slate-300 font-semibold">{avgScore}/{maxScore}</p>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${pct >= 75 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Search + filter */}
        <div className="px-6 py-3 border-b border-white/5 shrink-0 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search students…"
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto py-1">
            <SlidersHorizontal className="w-4 h-4 text-slate-500 shrink-0" />
            {(['all', 'graded', 'needs-review'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg font-sans text-[11px] font-semibold uppercase tracking-wider transition-colors shrink-0 ${filter === f
                  ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border border-primary-fixed-dim/30'
                  : 'text-slate-500 border border-white/5 hover:text-white'
                  }`}
              >
                {f === 'needs-review' ? 'Pending' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Submission list */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar min-h-0">
          <div key={filter} className="space-y-3 animate-in fade-in duration-300">
            {subs.length === 0 && (
              <div className="text-center py-14 border-2 border-dashed border-white/10 rounded-2xl">
                <User className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="font-sans text-sm text-slate-500">No submissions match your filter.</p>
              </div>
            )}

            {subs.map(s => {
              const cfg = STATUS_CFG[s.status];
              const score = s.totalScore ?? s.autoScore;
              const scorePct = s.maxScore > 0 ? Math.round((score / s.maxScore) * 100) : 0;
              const scoreBarColor = scorePct >= 90 ? 'bg-emerald-400' : scorePct >= 75 ? 'bg-primary-fixed-dim' : scorePct >= 60 ? 'bg-amber-400' : 'bg-red-400';
              const scoreTextColor = scorePct >= 90 ? 'text-emerald-400' : scorePct >= 75 ? 'text-primary-fixed-dim' : scorePct >= 60 ? 'text-amber-400' : 'text-red-400';

              return (
                <div
                  key={s.studentId}
                  className="bg-surface-container rounded-xl border border-white/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-white/10 transition-all group"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0 w-full">
                    <Avatar name={s.studentName} src={s.studentAvatar} />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-sans text-sm font-semibold text-white truncate">{s.studentName}</p>
                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className={`h-full rounded-full ${scoreBarColor} transition-all`} style={{ width: `${scorePct}%` }} />
                        </div>
                        <span className={`font-mono text-xs font-bold shrink-0 ${scoreTextColor}`}>
                          {score}/{s.maxScore} <span className="text-slate-500 font-normal">({scorePct}%)</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Clock className="w-3 h-3" />
                        <p className="font-sans text-[11px]">Submitted {s.submittedAt}</p>
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <button
                    type="button"
                    onClick={() => onGrade(s)}
                    className={`w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-sans text-xs font-semibold transition-all border ${s.status === 'needs-review'
                      ? 'bg-amber-400/10 border-amber-400/20 text-amber-400 hover:bg-amber-400/20'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                      }`}
                  >
                    {s.status === 'needs-review'
                      ? <><AlertCircle className="w-3.5 h-3.5" /> Grade</>
                      : <><BarChart2 className="w-3.5 h-3.5" /> Review</>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface-container-lowest">
          <p className="font-sans text-xs text-slate-500 text-center sm:text-left">
            {graded}/{total} graded · {needsReview} pending
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-white/5 border border-white/10 text-slate-300 rounded-xl font-sans text-sm font-semibold hover:bg-white/10 transition-all text-center"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
