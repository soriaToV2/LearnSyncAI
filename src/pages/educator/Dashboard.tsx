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

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = { BrainCircuit, Sigma, Code2 };
const actIconMap: Record<string, React.ComponentType<{ className?: string }>> = { FileCheck, UserPlus, Rocket, Award };

export default function Dashboard() {
  const activeCourses = EDUCATOR_COURSES.filter(c => c.status === 'active');
  const totalStudents = EDUCATOR_COURSES.reduce((a, c) => a + c.studentCount, 0);
  const pendingReviews = getPendingReviewCount();
  const deadlines = getUpcomingDeadlines();
  const atRisk = getAtRiskStudents();

  return (
    <main className="flex-1 overflow-y-auto">
      {/* Greeting Banner */}
      <div className="relative bg-[#080f1e] border-b border-white/5 px-10 py-8 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[500px] h-full opacity-30"
            style={{ background: 'linear-gradient(to left, #22d3ee20, transparent)' }} />
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        </div>
        <div className="relative z-10 max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-slate-500 mb-2 tracking-widest uppercase">
              // educator.console · {EDUCATOR_PROFILE.semester}
            </p>
            <h1 className="font-display text-4xl font-black text-white tracking-tighter mb-1">
              Good evening, <span className="font-light text-slate-400">{EDUCATOR_PROFILE.firstName}.</span>
            </h1>
            <p className="font-sans text-sm text-slate-400">{EDUCATOR_PROFILE.university} · {EDUCATOR_PROFILE.department}</p>
          </div>
          <div className="hidden md:flex items-center gap-8">
            {[
              { icon: Users, val: String(totalStudents), label: 'Students', color: '#22d3ee' },
              { icon: Target, val: String(activeCourses.length), label: 'Courses', color: '#34d399' },
              { icon: ClipboardCheck, val: String(pendingReviews), label: 'To Grade', color: pendingReviews > 0 ? '#f59e0b' : '#34d399' },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="text-center">
                  <div className="flex justify-center mb-1"><Icon className="w-5 h-5" style={{ color: s.color }} /></div>
                  <p className="font-display text-3xl font-black text-white">{s.val}</p>
                  <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">{s.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-10 py-8">
        <div className="grid grid-cols-12 gap-8">

          {/* LEFT COLUMN — 7 cols */}
          <div className="col-span-12 lg:col-span-7 flex flex-col gap-8">

            {/* Active Courses */}
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-on-surface">Active Courses</h2>
                <Link to="/educator/courses" className="font-sans text-xs text-slate-500 hover:text-white flex items-center gap-1 transition-colors">
                  View all <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeCourses.map(c => {
                  const Icon = iconMap[c.iconName] || BrainCircuit;
                  const nextDue = c.assessments.find(a => a.deadline && (a.status === 'deployed' || a.status === 'ready'));
                  return (
                    <Link to={`/educator/course/${c.id}/resources`} key={c.id}
                      className="group rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/10 transition-all duration-200">
                      <div className="h-1 w-full" style={{ backgroundColor: c.color }} />
                      <div className="p-5">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                            style={{ backgroundColor: `${c.color}12`, color: c.color }}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-display text-sm font-bold text-on-surface group-hover:text-white transition-colors truncate">{c.title}</h3>
                            <p className="font-sans text-xs text-slate-500">{c.university || 'Independent'}</p>
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors shrink-0" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs text-slate-500 flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> {c.studentCount}
                          </span>
                          {nextDue && (
                            <span className="font-sans text-[10px] text-amber-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {nextDue.deadline?.split('·')[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}

                {/* Create course card */}
                <Link to="/educator/courses"
                  className="rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.01] flex flex-col items-center justify-center p-6 hover:border-white/20 hover:bg-white/[0.03] transition-all group min-h-[140px]">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-2 group-hover:bg-white/10 transition-colors">
                    <Plus className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                  </div>
                  <span className="font-display text-sm font-semibold text-slate-500 group-hover:text-slate-300 transition-colors">New Course</span>
                </Link>
              </div>
            </div>

            {/* Upcoming Deadlines */}
            {deadlines.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <h3 className="font-display text-base font-bold text-on-surface">Upcoming Deadlines</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {deadlines.map(d => (
                    <div key={d.assessment.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.courseColor }} />
                        <div>
                          <p className="font-sans text-sm text-slate-200">{d.assessment.title}</p>
                          <p className="font-sans text-xs text-slate-500">{d.courseName}</p>
                        </div>
                      </div>
                      <span className="font-sans text-xs text-amber-400 font-semibold shrink-0">{d.assessment.deadline?.split('·')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — 5 cols */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">

            {/* Recent Activity */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="font-display text-base font-bold text-on-surface">Recent Activity</h3>
              </div>
              <div className="flex flex-col gap-1">
                {RECENT_ACTIVITY.slice(0, 5).map(a => {
                  const Icon = actIconMap[a.icon] || FileCheck;
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 ${a.accent}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <p className="font-sans text-xs text-slate-300 flex-1 truncate">{a.label}</p>
                      <span className="font-sans text-[10px] text-slate-600 shrink-0">{a.time}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Students Needing Attention */}
            {atRisk.length > 0 && (
              <div className="rounded-2xl border border-amber-400/10 bg-amber-400/[0.03] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="font-display text-base font-bold text-on-surface">Needs Attention</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {atRisk.map(({ student, courseName }) => (
                    <div key={student.id} className="flex items-center gap-3">
                      {student.avatar ? (
                        <img src={student.avatar} alt={student.name} className="w-8 h-8 rounded-full object-cover border border-white/10" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-white border border-white/10">
                          {student.name.split(' ').map(n => n[0]).join('')}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm text-slate-200 truncate">{student.name}</p>
                        <p className="font-sans text-xs text-slate-500">{courseName} · {student.averageGrade}% avg</p>
                      </div>
                      <span className="font-sans text-xs text-amber-400 font-semibold">{student.averageGrade}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Reviews */}
            {pendingReviews > 0 && (
              <div className="rounded-2xl border border-indigo-400/10 bg-indigo-400/[0.03] p-5">
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardCheck className="w-4 h-4 text-indigo-400" />
                  <h3 className="font-display text-base font-bold text-on-surface">Pending Reviews</h3>
                </div>
                <p className="font-sans text-sm text-slate-400 mb-3">
                  You have <span className="text-indigo-400 font-semibold">{pendingReviews} submissions</span> that need manual grading.
                </p>
                <Link to={`/educator/course/bio-301/assessments`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-indigo-400/10 border border-indigo-400/20 text-indigo-400 font-sans text-sm font-semibold hover:bg-indigo-400/20 transition-all">
                  Review Now <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
