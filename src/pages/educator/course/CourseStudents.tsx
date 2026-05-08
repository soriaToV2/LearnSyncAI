import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Filter, UserMinus, Award, ChevronDown, ChevronUp, Eye, TrendingUp, TrendingDown } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById } from '../../../data/mockEducatorData';
import BadgeCertificateModal from './components/BadgeCertificateModal';

const statusBadge: Record<string, { bg: string; text: string }> = {
  excelling: { bg: 'bg-emerald-400/10 border-emerald-400/20', text: 'text-emerald-400' },
  active: { bg: 'bg-slate-400/10 border-slate-400/20', text: 'text-slate-300' },
  'at-risk': { bg: 'bg-amber-400/10 border-amber-400/20', text: 'text-amber-400' },
};

export default function CourseStudents() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [tab, setTab] = useState<'all' | 'at-risk' | 'excelling'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [badgeStudent, setBadgeStudent] = useState<string | null>(null);

  const students = course?.students.filter(s => tab === 'all' || s.status === tab) || [];

  return (
    <CourseLayout>
      <div className="space-y-6">
        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['all', 'at-risk', 'excelling'] as const).map(f => (
              <button key={f} onClick={() => setTab(f)}
                className={`px-4 py-1.5 rounded-full font-sans font-semibold text-[11px] uppercase tracking-wider border transition-colors ${tab === f
                  ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                  : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
                }`}>{f === 'at-risk' ? 'At Risk' : f === 'excelling' ? 'Excelling' : 'All'}</button>
            ))}
          </div>
        </div>

        {/* Student Rows */}
        <div className="space-y-3">
          {students.map(s => {
            const isExpanded = expanded === s.id;
            const badge = statusBadge[s.status];
            return (
              <div key={s.id} className="rounded-xl glass-card hover:border-white/20 transition-all overflow-hidden">
                <div className="flex items-center justify-between p-4 group">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {s.avatar ? (
                        <img src={s.avatar} alt={s.name} className="w-12 h-12 rounded-full object-cover border-2 border-surface-container" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface font-display text-lg font-semibold border-2 border-surface-container">
                          {s.name.split(' ').map(n => n[0]).join('')}
                        </div>
                      )}
                      <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface-container ${s.status === 'at-risk' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    </div>
                    <div>
                      <h3 className="font-display text-base text-on-surface font-semibold">{s.name}</h3>
                      <p className="font-sans text-xs text-on-surface-variant">{s.email} · Joined {s.joinedAt}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className={`px-2.5 py-1 rounded-full font-sans text-[10px] font-semibold uppercase tracking-wider border ${badge.bg} ${badge.text}`}>
                      {s.status === 'at-risk' ? (
                        <><TrendingDown className="w-3 h-3 inline mr-1" />At Risk</>
                      ) : s.status === 'excelling' ? (
                        <><TrendingUp className="w-3 h-3 inline mr-1" />Excelling</>
                      ) : 'Active'}
                    </span>
                    <div className="text-right hidden sm:block">
                      <p className="font-sans text-xs text-on-surface-variant">Avg Grade</p>
                      <p className={`font-display text-lg font-medium ${s.averageGrade >= 90 ? 'text-emerald-400' : s.averageGrade >= 75 ? 'text-on-surface' : 'text-amber-400'}`}>{s.averageGrade}%</p>
                    </div>
                    <div className="w-px h-8 bg-white/10 hidden sm:block" />
                    <button onClick={() => setBadgeStudent(s.id)}
                      className="px-3 py-2 rounded-lg border border-amber-400/20 text-amber-400 hover:bg-amber-400/10 transition-all font-sans text-xs flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <Award className="w-3.5 h-3.5" /> Badge
                    </button>
                    <button className="px-3 py-2 rounded-lg border border-error/20 text-error hover:bg-error/10 hover:border-error/40 transition-all font-sans text-xs flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <UserMinus className="w-3.5 h-3.5" /> Kick
                    </button>
                    <button onClick={() => setExpanded(isExpanded ? null : s.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded: Per-assessment breakdown */}
                {isExpanded && (
                  <div className="border-t border-white/5 px-4 py-4 bg-white/[0.01]">
                    <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3">Assessment Breakdown</p>
                    {s.assessmentScores.length > 0 ? (
                      <div className="space-y-2">
                        {s.assessmentScores.map(as => {
                          const assessment = course?.assessments.find(a => a.id === as.assessmentId);
                          const pct = Math.round((as.score / as.total) * 100);
                          return (
                            <div key={as.assessmentId} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                              <span className="font-sans text-sm text-slate-300">{assessment?.title || as.assessmentId}</span>
                              <div className="flex items-center gap-3">
                                <div className="w-24 bg-white/5 rounded-full h-1.5">
                                  <div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-emerald-400' : pct >= 75 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="font-mono text-xs text-white font-semibold w-16 text-right">{as.score}/{as.total}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="font-sans text-sm text-slate-500 italic">No assessment data yet.</p>
                    )}
                    {s.badges.length > 0 && (
                      <div className="mt-4">
                        <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2">Badges</p>
                        <div className="flex gap-2 flex-wrap">
                          {s.badges.map(b => (
                            <span key={b.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-sans text-xs font-semibold border"
                              style={{ backgroundColor: `${b.color}15`, borderColor: `${b.color}30`, color: b.color }}>
                              <Award className="w-3.5 h-3.5" /> {b.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {students.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans">No students match this filter.</p>
          </div>
        )}
      </div>

      <BadgeCertificateModal
        isOpen={!!badgeStudent}
        onClose={() => setBadgeStudent(null)}
        studentName={course?.students.find(s => s.id === badgeStudent)?.name || ''}
        courseName={course?.title || ''}
      />
    </CourseLayout>
  );
}
