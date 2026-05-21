import React from 'react';
import { Link } from 'react-router-dom';
import {
  BrainCircuit, Sigma, Code2, Plus, Users, ArrowUpRight,
  Calendar, AlertTriangle, FileCheck, UserPlus, Rocket, Award,
  Clock, Zap, Target, ChevronRight, ClipboardCheck,
} from 'lucide-react';
import {
  EDUCATOR_PROFILE, EDUCATOR_COURSES, RECENT_ACTIVITY,
  getAtRiskStudents, getUpcomingDeadlines, getPendingReviewCount,
} from '../../data/mockEducatorData';
import { useEducatorTheme } from '../../context/ThemeContext';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = { BrainCircuit, Sigma, Code2 };
const actIconMap: Record<string, React.ComponentType<{ className?: string }>> = { FileCheck, UserPlus, Rocket, Award };

export default function Dashboard() {
  const activeCourses = EDUCATOR_COURSES.filter(c => c.status === 'active');
  const totalStudents = EDUCATOR_COURSES.reduce((a, c) => a + c.studentCount, 0);
  const pendingReviews = getPendingReviewCount();
  const deadlines = getUpcomingDeadlines();
  const atRisk = getAtRiskStudents();
  const { theme } = useEducatorTheme();

  return (
    <main className="flex-1 overflow-y-auto bg-page relative">
      {/* Premium Ambient Aura Blurs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '8s', backgroundColor: theme.accentSoft.replace('0.1', '0.12') }} />
        <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '12s', backgroundColor: theme.accentSoft.replace('0.1', '0.06') }} />
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '45px 45px' }} />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-12 pb-16 w-full">
        {/* Header Section */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-primary-fixed-dim animate-ping shrink-0"></span>
            <p className="font-mono text-xs text-slate-400 tracking-widest uppercase">
              academic.dashboard · system.online
            </p>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold text-white tracking-tight flex items-center gap-3">
            Dashboard <span className="bg-gradient-to-r from-primary-fixed-dim to-indigo-400 bg-clip-text text-transparent">Overview</span>
          </h1>
          <p className="font-sans text-base text-slate-400 font-medium mt-2 max-w-xl">
            Manage modules, evaluate student coursework, and track real-time classroom statistics.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12">
          {[
            { icon: Users, val: String(totalStudents), label: 'Active Students', desc: 'Across all modules', color: '#22d3ee' },
            { icon: Target, val: String(activeCourses.length), label: 'Live Modules', desc: 'Currently lecturing', color: '#34d399' },
            { icon: ClipboardCheck, val: String(pendingReviews), label: 'Pending Reviews', desc: 'Require manual score', color: pendingReviews > 0 ? '#fbbf24' : '#34d399' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="group relative rounded-2xl bg-white/[0.02] border border-white/5 p-6 backdrop-blur-md transition-all duration-500 hover:bg-white/[0.04] hover:border-white/10 hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(0,0,0,0.5)] overflow-hidden">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                  style={{ background: `radial-gradient(circle at 100% 0%, ${s.color}12 0%, transparent 65%)` }} />
                
                <div className="flex items-center justify-between mb-4">
                  <span className="font-sans text-xs text-slate-400 font-extrabold uppercase tracking-wider">{s.label}</span>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10"
                    style={{ backgroundColor: `${s.color}15`, color: s.color }}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                <p className="font-display text-4xl font-black text-white tracking-tight">{s.val}</p>
                <p className="font-sans text-xs text-slate-500 mt-1">{s.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Dashboard Columns */}
        <div className="grid grid-cols-12 gap-8">
          {/* Left Column (8 cols) */}
          <div className="col-span-12 xl:col-span-8 flex flex-col gap-8">
            
            {/* Active Courses */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded bg-primary-fixed-dim"></div>
                  <h2 className="font-display text-xl font-extrabold text-white tracking-tight">Active Modules</h2>
                </div>
                <Link to="/educator/courses" className="font-sans text-sm text-primary-fixed-dim hover:text-white flex items-center gap-1.5 transition-colors font-semibold">
                  View course catalog <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {activeCourses.map(c => {
                  const Icon = iconMap[c.iconName] || BrainCircuit;
                  const nextDue = c.assessments.find(a => a.deadline && (a.status === 'deployed' || a.status === 'ready'));
                  return (
                    <Link to={`/educator/course/${c.id}/resources`} key={c.id}
                      className="group relative rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/10 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col justify-between min-h-[200px]">
                      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: c.color }} />
                      
                      <div className="p-6 flex flex-col flex-1 justify-between gap-6 relative">
                        <div className="absolute top-0 right-0 p-6 opacity-[0.02] pointer-events-none">
                          <Icon className="w-24 h-24 group-hover:scale-110 transition-transform duration-700" style={{ color: c.color }} />
                        </div>
                        
                        <div className="relative z-10">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 shrink-0"
                              style={{ backgroundColor: `${c.color}15`, color: c.color }}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <span className="font-mono text-[10px] text-slate-500 tracking-wider uppercase border border-white/5 px-2.5 py-0.5 rounded bg-white/[0.02]">
                              {c.courseCode}
                            </span>
                          </div>
                          
                          <h3 className="font-display text-lg font-bold text-white group-hover:text-primary-fixed-dim transition-colors line-clamp-1 mb-1">{c.title}</h3>
                          <p className="font-sans text-xs text-slate-400">{c.university || 'MIT Department'}</p>
                        </div>
                        
                        <div className="flex items-center justify-between pt-4 border-t border-white/5 relative z-10 shrink-0">
                          <span className="font-sans text-xs text-slate-300 flex items-center gap-1.5 font-semibold">
                            <Users className="w-4 h-4 text-slate-500" /> {c.studentCount} Students
                          </span>
                          {nextDue && (
                            <span className="font-sans text-xs text-amber-400 flex items-center gap-1 font-bold">
                              <Clock className="w-3.5 h-3.5" /> {nextDue.deadline?.split('·')[0]}
                            </span>
                          )}
                          {!nextDue && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-sans font-bold text-[9px] tracking-wider border border-emerald-500/20 uppercase">
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Upcoming Deadlines */}
            {deadlines.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 backdrop-blur-md shadow-xl relative overflow-hidden">
                <div className="absolute inset-0 opacity-0.01 bg-gradient-to-br from-amber-500/10 to-transparent pointer-events-none" />
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1.5 h-6 rounded bg-amber-500"></div>
                  <h3 className="font-display text-lg font-bold text-white tracking-tight">Active Deadlines</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {deadlines.map(d => (
                    <div key={d.assessment.id} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-3 h-3 rounded-full shrink-0 shadow-lg" style={{ backgroundColor: d.courseColor, boxShadow: `0 0 10px ${d.courseColor}40` }} />
                        <div className="min-w-0">
                          <p className="font-sans text-sm text-slate-100 font-bold truncate">{d.assessment.title}</p>
                          <p className="font-sans text-xs text-slate-500 mt-0.5 truncate">{d.courseName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-xs text-amber-300 font-bold border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 rounded-md">
                          {d.assessment.deadline?.split('·')[0]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column (4 cols) */}
          <div className="col-span-12 xl:col-span-4 flex flex-col gap-6">
            
            {/* Action Center */}
            <div className="relative rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.02] p-6 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
              
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded bg-indigo-500"></div>
                  <h3 className="font-display text-lg font-bold text-white tracking-tight">Action Center</h3>
                </div>
                <span className="font-mono text-[10px] text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded font-bold uppercase shrink-0">
                  {pendingReviews + atRisk.length} Alerts
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {/* Pending Reviews widget */}
                {pendingReviews > 0 && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-3 mb-2 text-indigo-400 font-sans text-sm font-bold">
                      <ClipboardCheck className="w-4 h-4" /> Grading Required
                    </div>
                    <p className="font-sans text-xs text-slate-300 leading-relaxed mb-3">
                      You have <span className="text-white font-bold">{pendingReviews} student submissions</span> that require manual grading and custom feedback.
                    </p>
                    <Link to={`/educator/course/bio-301/assessments`}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-indigo-400/10 border border-indigo-400/20 text-indigo-400 font-sans text-xs font-bold hover:bg-indigo-400/20 transition-all">
                      Grade Papers <ArrowUpRight className="w-4 h-4" />
                    </Link>
                  </div>
                )}

                {/* Needs Attention widget */}
                {atRisk.length > 0 && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-3 mb-3 text-rose-400 font-sans text-sm font-bold">
                      <AlertTriangle className="w-4 h-4 text-rose-500" /> Academic Risk Alerts
                    </div>
                    <div className="flex flex-col gap-3">
                      {atRisk.slice(0, 3).map(({ student, courseName }) => (
                        <div key={student.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.01] border border-white/5">
                          <div className="flex items-center gap-3 min-w-0">
                            <img src={student.avatar} alt={student.name} className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-sans text-xs text-slate-200 truncate font-semibold">{student.name}</p>
                              <p className="font-sans text-[10px] text-slate-500 truncate mt-0.5">{courseName}</p>
                            </div>
                          </div>
                          <span className="font-mono text-xs text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded font-bold border border-rose-500/20">{student.averageGrade}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 backdrop-blur-md shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1.5 h-6 rounded bg-indigo-500"></div>
                <h3 className="font-display text-lg font-bold text-white tracking-tight">Dashboard Activity</h3>
              </div>
              <div className="flex flex-col gap-4 relative pl-3 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5">
                {RECENT_ACTIVITY.slice(0, 5).map(a => {
                  const Icon = actIconMap[a.icon] || FileCheck;
                  return (
                    <div key={a.id} className="flex items-start gap-4 relative">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-surface-deep border border-white/10 z-10 shrink-0 ${a.accent}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="font-sans text-xs text-slate-300 font-medium leading-relaxed">{a.label}</p>
                        <span className="font-mono text-[9px] text-slate-500 block mt-1 tracking-wider">{a.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
