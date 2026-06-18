import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass, BrainCircuit, Sigma, Code2,
  ArrowUpRight, Calendar, Clock, BookOpen, Zap,
  CheckCircle2, Circle, Trophy, Target, ChevronRight,
  AlertTriangle, Award, UserPlus, Rocket, FileCheck, ClipboardCheck, Share2
} from 'lucide-react';
import { MOCK_STUDENTS } from '../../data/mockStudents';
import { useStudentTheme } from '../../context/ThemeContext';

// Updated: Reflects "Study Spaces" rather than generic courses
const studySpaces = [
  {
    id: 'bio-301', title: 'Advanced Neurobiology', prof: 'Prof. Elias Vance',
    progress: 84, color: '#22d3ee', icon: BrainCircuit, uni: 'PLP - CCS', courseCode: 'BIO-301',
    dueLabel: 'Adaptive Test', dueDate: 'May 12',
    modesActive: 4, completedSessions: 12,
  },
  {
    id: 'phys-401', title: 'Data Structures', prof: 'Prof. Sarah Chen',
    progress: 62, color: '#818cf8', icon: Sigma, uni: 'PLP - CCS', courseCode: 'IT-201',
    dueLabel: 'Free Recall', dueDate: 'May 15',
    modesActive: 3, completedSessions: 8,
  },
  {
    id: 'cs-202', title: 'Algorithms Design', prof: 'Prof. Alan Turing',
    progress: 45, color: '#34d399', icon: Code2, uni: 'PLP - CCS', courseCode: 'CS-202',
    dueLabel: 'Feynman Log', dueDate: 'May 20',
    modesActive: 4, completedSessions: 5,
  },
];

// Updated: Reflects specific LearnSync AI review modes and CollabShare actions
const agenda = [
  { title: 'BKT Adaptive Test — Neurobiology', date: 'Mon, May 12', type: 'adaptive', done: false },
  { title: 'Free Recall Evaluation — Data Structures', date: 'Thu, May 15', type: 'semantic', done: false },
  { title: 'CollabShare: Sync Peer Flashcards', date: 'Tue, May 20', type: 'peer-sync', done: false },
  { title: 'PlayMe Crossword — Algorithms', date: 'Fri, May 10', type: 'gamification', done: true },
];

const typeColors: Record<string, string> = {
  adaptive: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
  semantic: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'peer-sync': 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',
  gamification: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
};

const activityIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileCheck, Share2, Rocket, Trophy
};

export default function StudentDashboard() {
  const currentStudent = MOCK_STUDENTS[0];
  const { theme } = useStudentTheme();

  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({ 3: true });

  const activeDeadlines = agenda.filter(item => !item.done && !checkedItems[agenda.indexOf(item)]);
  const pendingAlertCount = activeDeadlines.length;

  // Updated: Reflects BKT updates, CollabShare cloning, and PlayMe XP
  const studentActivities = [
    { id: 1, label: 'Earned 500 XP in PlayMe Term Matching', time: '2 hours ago', icon: 'Trophy', accent: 'text-yellow-400', color: 'bg-yellow-500/10' },
    { id: 2, label: 'Cloned peer workspace via CollabShare (Read-Only)', time: '5 hours ago', icon: 'Share2', accent: 'text-indigo-400', color: 'bg-indigo-500/10' },
    { id: 3, label: 'BKT Mastery Vector updated to 84% in BIO-301', time: 'Yesterday', icon: 'Rocket', accent: 'text-cyan-400', color: 'bg-cyan-500/10' },
    { id: 4, label: 'Generated AI Flashcard deck from uploaded PDF', time: '2 days ago', icon: 'FileCheck', accent: 'text-emerald-400', color: 'bg-emerald-500/10' },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-page relative">
      {/* Premium Ambient Aura Blurs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '8s', backgroundColor: theme.accentSoft.replace('0.1', '0.12') }} />
        <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '12s', backgroundColor: theme.accentSoft.replace('0.1', '0.06') }} />
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '45px 45px' }} />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-8 md:pt-12 pb-16 w-full">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="font-display text-4xl md:text-5xl font-extrabold text-white tracking-tight flex items-center gap-3">
              Cognitive <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">Overview</span>
            </h1>
            <p className="font-sans text-base text-slate-400 font-medium mt-2 max-w-xl">
              Track latent mastery vectors, manage active study spaces, and sync peer resources.
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12">
          {[
            { icon: Trophy, val: '2,450 XP', label: 'Experience Points', desc: 'PlayMe gamification scaling', color: '#fbbf24' },
            { icon: Target, val: '84%', label: 'BKT Mastery Level', desc: 'Latent concept tracking', color: '#34d399' },
            { icon: Zap, val: '7 Days', label: 'Study Streak', desc: 'Consecutive 48-hour logins', color: '#818cf8' },
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
                <p className="font-display text-3xl font-black text-white tracking-tight">{s.val}</p>
                <p className="font-sans text-xs text-slate-500 mt-1">{s.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Columns Grid */}
        <div className="grid grid-cols-12 gap-8">

          {/* Left Column (8 cols) */}
          <div className="col-span-12 xl:col-span-8 flex flex-col gap-8">

            {/* Active Study Spaces */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded bg-cyan-400"></div>
                  <h2 className="font-display text-xl font-extrabold text-white tracking-tight">Active Study Spaces</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {studySpaces.map(c => {
                  const Icon = c.icon;
                  return (
                    <Link to={`/student/course/${c.id}`} key={c.id}
                      className="group relative rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/10 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col justify-between min-h-[210px]">
                      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: c.color }} />

                      <div className="p-6 flex flex-col flex-1 justify-between gap-5 relative">
                        <div className="absolute top-0 right-0 p-6 opacity-[0.02] pointer-events-none">
                          <Icon className="w-24 h-24 group-hover:scale-110 transition-transform duration-700" style={{ color: c.color }} />
                        </div>

                        <div className="relative z-10">
                          <div className="flex items-center justify-between mb-3">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 shrink-0"
                              style={{ backgroundColor: `${c.color}15`, color: c.color }}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <span className="font-mono text-[10px] text-slate-500 tracking-wider uppercase border border-white/5 px-2.5 py-0.5 rounded bg-white/[0.02]">
                              {c.courseCode}
                            </span>
                          </div>

                          <h3 className="font-display text-lg font-bold text-white group-hover:text-cyan-400 transition-colors line-clamp-1 mb-0.5">{c.title}</h3>
                          <p className="font-sans text-xs text-slate-400">{c.uni}</p>
                        </div>

                        <div className="relative z-10">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="font-sans text-[11px] text-slate-500 font-bold uppercase tracking-wider">BKT Mastery Level</span>
                            <span className="font-mono text-xs font-bold text-white">{c.progress}%</span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-1.5 relative overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${c.progress}%`, backgroundColor: c.color }} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/5 relative z-10 shrink-0">
                          <span className="font-sans text-xs text-slate-300 flex items-center gap-1.5 font-semibold">
                            <BookOpen className="w-4 h-4 text-slate-500" /> {c.modesActive}/4 Study Modes
                          </span>
                          <span className="font-sans text-xs text-amber-400 flex items-center gap-1 font-bold">
                            <Clock className="w-3.5 h-3.5" /> {c.dueLabel}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Upcoming Agenda / To-do */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 backdrop-blur-md shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-[0.01] bg-gradient-to-br from-indigo-500/10 to-transparent pointer-events-none" />
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1.5 h-6 rounded bg-indigo-500"></div>
                <h3 className="font-display text-lg font-bold text-white tracking-tight">Practice Agenda</h3>
              </div>
              <div className="flex flex-col gap-3">
                {agenda.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => setCheckedItems(prev => ({ ...prev, [i]: !prev[i] }))}
                    className={`flex items-center justify-between p-4 rounded-xl text-left bg-white/[0.01] border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300 ${checkedItems[i] ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="shrink-0">
                        {checkedItems[i]
                          ? <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                          : <Circle className="w-5 h-5 text-slate-600 mt-0.5 shrink-0" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className={`font-sans text-sm text-slate-100 font-bold truncate ${checkedItems[i] ? 'line-through' : ''}`}>{item.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span className="font-sans text-xs text-slate-500">{item.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center shrink-0">
                      <span className={`font-sans text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${typeColors[item.type]}`}>{item.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Right Column (4 cols) */}
          <div className="col-span-12 xl:col-span-4 flex flex-col gap-6">

            {/* Action Center */}
            <div className="relative rounded-2xl border border-cyan-500/10 bg-cyan-500/[0.02] p-6 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded bg-cyan-500"></div>
                  <h3 className="font-display text-lg font-bold text-white tracking-tight">System Alerts</h3>
                </div>
                <span className="font-mono text-[10px] text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 rounded font-bold uppercase shrink-0">
                  {pendingAlertCount} Alerts
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {pendingAlertCount > 0 && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-3 mb-2 text-cyan-400 font-sans text-sm font-bold">
                      <AlertTriangle className="w-4 h-4" /> Pending Interventions
                    </div>
                    <p className="font-sans text-xs text-slate-300 leading-relaxed mb-3">
                      Your BKT routing indicates you have <span className="text-white font-bold">{pendingAlertCount} active practice modules</span> requiring review.
                    </p>
                    <Link to="/student/spaces"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 font-sans text-xs font-bold hover:bg-cyan-400/20 transition-all">
                      Go to Study Spaces <ArrowUpRight className="w-4 h-4" />
                    </Link>
                  </div>
                )}

                {/* CollabShare Alert */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center gap-3 mb-2 text-indigo-400 font-sans text-sm font-bold">
                    <Share2 className="w-4 h-4" /> CollabShare Request
                  </div>
                  <p className="font-sans text-xs text-slate-300 leading-relaxed mb-3">
                    A peer has published a new <span className="text-white font-bold">Free Recall Archive</span> in Data Structures.
                  </p>
                  <button
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-white/5 border border-white/10 text-white font-sans text-xs font-bold hover:bg-white/10 transition-all">
                    Clone Workspace
                  </button>
                </div>
              </div>
            </div>

            {/* Academic Activity (Student timeline logs) */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 backdrop-blur-md shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1.5 h-6 rounded bg-[#22d3ee]"></div>
                <h3 className="font-display text-lg font-bold text-white tracking-tight">Session History</h3>
              </div>
              <div className="flex flex-col gap-4 relative pl-3 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5">
                {studentActivities.map(a => {
                  const Icon = activityIconMap[a.icon] || FileCheck;
                  return (
                    <div key={a.id} className="flex items-start gap-4 relative">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-surface-deep border border-white/10 z-10 shrink-0 ${a.color} ${a.accent}`}>
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