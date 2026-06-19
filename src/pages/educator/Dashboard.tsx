import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BrainCircuit, Sigma, Code2, Plus, Users, ArrowUpRight,
  Calendar, AlertTriangle, FileCheck, UserPlus, Rocket, Award,
  Clock, Zap, Target, ChevronRight, ClipboardCheck, BookOpen,
  Sparkles, Mail, MessageSquare, CheckCircle2, Circle
} from 'lucide-react';
import {
  EDUCATOR_PROFILE, EDUCATOR_COURSES, RECENT_ACTIVITY,
  getAtRiskStudents, getUpcomingDeadlines, getPendingReviewCount,
} from '../../data/mockEducatorData';
import { useEducatorTheme } from '../../context/ThemeContext';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = { BrainCircuit, Sigma, Code2 };
const actIconMap: Record<string, React.ComponentType<{ className?: string }>> = { FileCheck, UserPlus, Rocket, Award };

const taskColors: Record<string, string> = {
  grading: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',
  content: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  seating: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
  announcement: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
};

export default function Dashboard() {
  const activeCourses = EDUCATOR_COURSES.filter(c => c.status === 'active');
  const totalStudents = EDUCATOR_COURSES.reduce((a, c) => a + c.studentCount, 0);
  const pendingReviews = getPendingReviewCount();
  const deadlines = getUpcomingDeadlines();
  const atRisk = getAtRiskStudents();
  const { theme } = useEducatorTheme();

  // Calculate overall class average dynamically across all active courses
  const totalAvgSum = activeCourses.reduce((acc, c) => {
    const courseAvg = c.students.reduce((sAcc, s) => sAcc + s.averageGrade, 0) / (c.students.length || 1);
    return acc + courseAvg;
  }, 0);
  const overallClassAvg = Math.round(totalAvgSum / (activeCourses.length || 1));

  // State for interactive task agenda
  const [curriculumTasks, setCurriculumTasks] = useState([
    { id: 1, title: 'Grade BIO-301 Midterm Submissions', type: 'grading', date: 'Today', done: false },
    { id: 2, title: 'Upload Human Brain Model resource', type: 'content', date: 'Tomorrow', done: false },
    { id: 3, title: 'Configure seating grid for CS-202 test', type: 'seating', date: 'In 2 days', done: false },
    { id: 4, title: 'Publish study guide announcements', type: 'announcement', date: 'In 3 days', done: true },
  ]);

  const toggleTask = (id: number) => {
    setCurriculumTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const pendingTasksCount = curriculumTasks.filter(t => !t.done).length;

  // AI Concept Insights data based on students BKT Concept Mastery indicators
  const aiConceptInsights = [
    {
      courseId: 'bio-301',
      courseName: 'Advanced Neurobiology',
      concept: 'Synaptic Transmission',
      mastery: 58,
      recommendation: 'Class mastery vector has fallen below target 70%. Deploy a targeted reading resource or adaptive practice.',
    },
    {
      courseId: 'cs-202',
      courseName: 'Algorithms Design',
      concept: 'Dynamic Programming',
      mastery: 64,
      recommendation: 'Latent vectors reveal recursion subproblem gaps. Suggest auto-generating isomorphic review sets.',
    }
  ];

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleActionToast = (msg: string) => {
    setToastMessage(msg);
    const ev = new CustomEvent('learnSyncAI_toast', { detail: msg });
    window.dispatchEvent(ev);

    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Helper to calculate course specific average
  const getCourseAvg = (students: any[]) => {
    if (!students || students.length === 0) return 0;
    const sum = students.reduce((acc, s) => acc + s.averageGrade, 0);
    return Math.round(sum / students.length);
  };

  // Helper to count student statuses (Excelling, At Risk)
  const getStatusCounts = (students: any[]) => {
    let excelling = 0;
    let atRisk = 0;
    if (students) {
      students.forEach(s => {
        if (s.status === 'excelling') excelling++;
        else if (s.status === 'at-risk') atRisk++;
      });
    }
    return { excelling, atRisk };
  };

  return (
    <main className="flex-1 overflow-y-auto bg-page relative">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '8s', backgroundColor: theme.accentSoft.replace('0.1', '0.12') }} />
        <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '12s', backgroundColor: theme.accentSoft.replace('0.1', '0.06') }} />
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '45px 45px' }} />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-8 md:pt-12 pb-16 w-full">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-primary-fixed-dim animate-ping shrink-0"></span>
              <p className="font-mono text-xs text-slate-400 tracking-widest uppercase">
                {EDUCATOR_PROFILE.university} · {EDUCATOR_PROFILE.department} · {EDUCATOR_PROFILE.semester}
              </p>
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-extrabold text-white tracking-tight">
              Welcome back,{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(to right, ${theme.accent}, ${theme.accentDim || '#818cf8'})` }}
              >
                {EDUCATOR_PROFILE.firstName}
              </span>
            </h1>
            <p className="font-sans text-base text-slate-400 font-medium mt-2 max-w-xl">
              Track concept mastery vectors, manage active courses, and review real-time classroom insights.
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12">
          {[
            { icon: Users, val: String(totalStudents), label: 'Active Students', desc: 'Across all modules', color: '#22d3ee' },
            { icon: Award, val: `${overallClassAvg}%`, label: 'Class Average', desc: 'Syllabus mastery level', color: '#34d399' },
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
          <div className="col-span-12 xl:col-span-8 flex flex-col gap-8">
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
                  const courseAvg = getCourseAvg(c.students);
                  const { excelling, atRisk } = getStatusCounts(c.students);

                  return (
                    <Link to={`/educator/course/${c.id}/resources`} key={c.id}
                      className="group relative rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/10 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col justify-between min-h-[250px]">
                      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: c.color }} />

                      <div className="p-6 flex flex-col flex-1 justify-between gap-5 relative">
                        <div className="absolute top-0 right-0 p-6 opacity-[0.02] pointer-events-none">
                          <Icon className="w-24 h-24 group-hover:scale-110 transition-transform duration-700" style={{ color: c.color }} />
                        </div>

                        <div className="relative z-10">
                          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 shrink-0"
                              style={{ backgroundColor: `${c.color}15`, color: c.color }}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[10px] text-slate-500 tracking-wider uppercase border border-white/5 px-2.5 py-0.5 rounded bg-white/[0.02]">
                                {c.courseCode}
                              </span>
                              {c.section && (
                                <span className="font-sans text-[10px] text-indigo-400 tracking-wider uppercase border border-indigo-500/20 px-2.5 py-0.5 rounded bg-indigo-500/5 font-semibold">
                                  Section {c.section}
                                </span>
                              )}
                            </div>
                          </div>

                          <h3 className="font-display text-lg font-bold text-white group-hover:text-primary-fixed-dim transition-colors line-clamp-1 mb-0.5">{c.title}</h3>
                          <p className="font-sans text-xs text-slate-400 mb-4">{c.university || 'MIT Department'}</p>

                          {/* Student Health breakdown */}
                          <div className="flex items-center gap-2 mb-4">
                            {excelling > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-sans font-bold text-[9px] uppercase tracking-wider border border-emerald-500/20">
                                {excelling} Excelling
                              </span>
                            )}
                            {atRisk > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-sans font-bold text-[9px] uppercase tracking-wider border border-rose-500/20">
                                {atRisk} At Risk
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Class Average progress bar */}
                        <div className="relative z-10 mb-2">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="font-sans text-[11px] text-slate-500 font-bold uppercase tracking-wider">Class Average Grade</span>
                            <span className="font-mono text-xs font-bold text-white">{courseAvg}%</span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-1.5 relative overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${courseAvg}%`, backgroundColor: c.color }} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/5 relative z-10 shrink-0">
                          <span className="font-sans text-xs text-slate-300 flex items-center gap-1.5 font-semibold">
                            <Users className="w-4 h-4 text-slate-500" /> {c.studentCount} Students
                          </span>
                          {nextDue && (
                            <span className="font-sans text-xs text-amber-400 flex items-center gap-1 font-bold animate-pulse">
                              <Clock className="w-3.5 h-3.5 text-amber-500" /> {nextDue.deadline?.split('·')[0]}
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

            {/* Curriculum Agenda Checklist */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 backdrop-blur-md shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-[0.01] bg-gradient-to-br from-indigo-500/10 to-transparent pointer-events-none" />
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded bg-indigo-500"></div>
                  <h3 className="font-display text-lg font-bold text-white tracking-tight">Curriculum Tasks</h3>
                </div>
                <span className="font-mono text-[10px] text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded font-bold uppercase shrink-0">
                  {pendingTasksCount} Tasks Pending
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {curriculumTasks.map((task, i) => (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className={`flex items-center justify-between p-4 rounded-xl text-left bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300 ${task.done ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="shrink-0">
                        {task.done
                          ? <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                          : <Circle className="w-5 h-5 text-slate-600 mt-0.5 shrink-0" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className={`font-sans text-sm text-slate-100 font-bold truncate ${task.done ? 'line-through' : ''}`}>{task.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span className="font-sans text-xs text-slate-500">Due {task.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center shrink-0">
                      <span className={`font-sans text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${taskColors[task.type] || 'text-slate-400'}`}>
                        {task.type}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-12 xl:col-span-4 flex flex-col gap-6">
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

                {atRisk.length > 0 && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-3 mb-3 text-rose-400 font-sans text-sm font-bold">
                      <AlertTriangle className="w-4 h-4 text-rose-500" /> Academic Risk Alerts
                    </div>
                    <div className="flex flex-col gap-3">
                      {atRisk.slice(0, 3).map(({ student, courseName }) => (
                        <div key={student.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.01] border border-white/5 hover:border-white/10 transition-all">
                          <div className="flex items-center gap-3 min-w-0">
                            <img src={student.avatar} alt={student.name} className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-sans text-xs text-slate-200 truncate font-semibold">{student.name}</p>
                              <p className="font-sans text-[10px] text-slate-500 truncate mt-0.5">{courseName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="font-mono text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded font-bold border border-rose-500/20 mr-1">{student.averageGrade}%</span>
                            <button
                              onClick={() => handleActionToast(`Opening remediation email draft for ${student.name}...`)}
                              title="Email Student"
                              className="p-1 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                              <Mail className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleActionToast(`Initiating direct chat thread with ${student.name}...`)}
                              title="Message Student"
                              className="p-1 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                              <MessageSquare className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI Concept Insights (Cognitive advisor notice) */}
            <div className="relative rounded-2xl border border-cyan-500/10 bg-cyan-500/[0.02] p-6 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />

              <div className="flex items-center gap-3 mb-6">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <h3 className="font-display text-lg font-bold text-white tracking-tight">AI Concept Insights</h3>
              </div>

              <div className="flex flex-col gap-4">
                {aiConceptInsights.map((insight, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 transition-all">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="min-w-0">
                        <span className="font-sans text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider">{insight.concept}</span>
                        <p className="font-sans text-[11px] text-slate-400 truncate mt-0.5">{insight.courseName}</p>
                      </div>
                      <span className="font-mono text-xs font-bold text-cyan-300 border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 rounded shrink-0">
                        {insight.mastery}% Mastery
                      </span>
                    </div>

                    {/* Mastery slider bar */}
                    <div className="w-full bg-white/5 rounded-full h-1 relative overflow-hidden mb-3">
                      <div className="h-1 rounded-full bg-cyan-400" style={{ width: `${insight.mastery}%` }} />
                    </div>

                    <p className="font-sans text-xs text-slate-400 leading-relaxed mb-3.5">
                      {insight.recommendation}
                    </p>

                    <button
                      onClick={() => handleActionToast(`Generating cognitive review package for '${insight.concept}'...`)}
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 font-sans text-[11px] font-bold hover:bg-cyan-400/20 transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Auto-Generate Intervention
                    </button>
                  </div>
                ))}
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
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-2xl border border-white/10 flex items-center gap-2.5 animate-fade-in backdrop-blur-md">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-sans font-semibold text-sm">{toastMessage}</span>
        </div>
      )}
    </main>
  );
}
