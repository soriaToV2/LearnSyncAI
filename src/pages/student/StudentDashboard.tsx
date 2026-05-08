import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Compass, BrainCircuit, Sigma, Code2,
  ArrowUpRight, Calendar, Clock, BookOpen, Zap,
  CheckCircle2, Circle, Trophy, Target,
} from 'lucide-react';

const courses = [
  {
    id: 'bio-301', title: 'Advanced Neurobiology', prof: 'Prof. Elias Vance',
    progress: 45, color: '#22d3ee', icon: BrainCircuit, uni: 'MIT',
    dueLabel: 'Essay due', dueDate: 'May 12',
    modules: 12, completed: 5,
  },
  {
    id: 'phys-401', title: 'Quantum Mechanics II', prof: 'Prof. Sarah Chen',
    progress: 80, color: '#818cf8', icon: Sigma, uni: 'Stanford',
    dueLabel: 'Problem set', dueDate: 'May 15',
    modules: 10, completed: 8,
  },
  {
    id: 'cs-202', title: 'Algorithms & DS', prof: 'Prof. Alan Turing',
    progress: 15, color: '#34d399', icon: Code2, uni: 'MIT',
    dueLabel: 'Quiz', dueDate: 'May 20',
    modules: 15, completed: 2,
  },
];

const agenda = [
  { title: 'Midterm Exam — Neurobiology', date: 'Mon, May 12', type: 'exam', done: false },
  { title: 'Problem Set 6 — Quantum', date: 'Thu, May 15', type: 'assignment', done: false },
  { title: 'Quiz — Algorithms', date: 'Tue, May 20', type: 'quiz', done: false },
  { title: 'Essay Draft — Neurobiology', date: 'Fri, May 10', type: 'assignment', done: true },
];

const typeColors: Record<string, string> = {
  exam: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
  assignment: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  quiz: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',
};

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({ 3: true });

  return (
    <>
      <main className="flex-1 overflow-y-auto">
        {/* Full-width greeting banner */}
        <div className="relative bg-[#080f1e] border-b border-white/5 px-10 py-8 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-0 w-[500px] h-full opacity-30"
              style={{ background: 'linear-gradient(to left, #818cf820, transparent)' }} />
            {/* Grid lines */}
            <div className="absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          </div>
          <div className="relative z-10 max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <p className="font-mono text-xs text-slate-500 mb-2 tracking-widest uppercase">// student.portal · v2.6.1</p>
              <h1 className="font-display text-5xl font-black text-white tracking-tighter mb-1">
                Sarah <span className="font-light text-slate-400">Kim</span>
              </h1>
              <p className="font-sans text-sm text-slate-400">MIT · Computer Science · Sophomore</p>
            </div>
            <div className="hidden md:flex items-center gap-10">
              {[
                { icon: Trophy, val: '12', label: 'Badges', color: '#f59e0b' },
                { icon: Target, val: '94%', label: 'Avg Score', color: '#34d399' },
                { icon: Zap, val: '7', label: 'Day Streak', color: '#818cf8' },
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
              <Link to="/student/catalog"
                className="flex items-center gap-2 px-5 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-white font-display text-sm font-semibold hover:bg-white/[0.07] transition-all active:scale-95 ml-4">
                <Compass className="w-4 h-4" /> Explore
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-10 py-8">
          <div className="grid grid-cols-12 gap-8">

            {/* COURSE CARDS — 7 cols */}
            <div className="col-span-12 lg:col-span-7">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-on-surface">Active Courses</h2>
                <Link to="/student/catalog" className="font-sans text-xs text-slate-500 hover:text-white flex items-center gap-1 transition-colors">
                  Browse more <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="flex flex-col gap-4">
                {courses.map(c => {
                  const Icon = c.icon;
                  return (
                    <div key={c.id} className="group rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/10 transition-all duration-200">
                      {/* Color top strip */}
                      <div className="h-1 w-full" style={{ backgroundColor: c.color }} />
                      <div className="p-5">
                        <div className="flex items-start gap-4">
                          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                            style={{ backgroundColor: `${c.color}12`, color: c.color }}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h3 className="font-display text-base font-bold text-on-surface group-hover:text-white transition-colors">{c.title}</h3>
                                <p className="font-sans text-xs text-slate-500">{c.prof} · {c.uni}</p>
                              </div>
                              <Link to={`/student/course/${c.id}`}
                                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all">
                                <ArrowUpRight className="w-4 h-4" />
                              </Link>
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-3">
                              <div className="bg-white/5 rounded-xl p-3">
                                <p className="font-display text-lg font-bold text-white">{c.progress}%</p>
                                <p className="font-sans text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Progress</p>
                              </div>
                              <div className="bg-white/5 rounded-xl p-3">
                                <p className="font-display text-lg font-bold" style={{ color: c.color }}>{c.completed}/{c.modules}</p>
                                <p className="font-sans text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Modules</p>
                              </div>
                              <div className="bg-white/5 rounded-xl p-3">
                                <p className="font-display text-sm font-bold text-amber-400">{c.dueDate}</p>
                                <p className="font-sans text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{c.dueLabel}</p>
                              </div>
                            </div>
                            <div className="mt-3 w-full bg-white/5 rounded-full h-1">
                              <div className="h-1 rounded-full" style={{ width: `${c.progress}%`, backgroundColor: c.color }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT COLUMN — 5 cols */}
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">

              {/* Agenda / To-do */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <h3 className="font-display text-base font-bold text-on-surface">Upcoming</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {agenda.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => setCheckedItems(prev => ({ ...prev, [i]: !prev[i] }))}
                      className={`flex items-start gap-3 p-3 rounded-xl text-left transition-all hover:bg-white/5 ${checkedItems[i] ? 'opacity-40' : ''}`}
                    >
                      {checkedItems[i]
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        : <Circle className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={`font-sans text-sm text-slate-200 leading-snug ${checkedItems[i] ? 'line-through' : ''}`}>{item.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-slate-600" />
                          <span className="font-sans text-[10px] text-slate-500">{item.date}</span>
                          <span className={`font-sans text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider ${typeColors[item.type]}`}>{item.type}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Study Hours This Week */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-400" />
                    <h3 className="font-display text-base font-bold text-on-surface">Study Hours</h3>
                  </div>
                  <span className="font-mono text-xs text-emerald-400 font-semibold">+12h this week</span>
                </div>
                <div className="flex items-end gap-2 h-20 mt-2">
                  {[
                    { day: 'M', h: 2 }, { day: 'T', h: 4.5 }, { day: 'W', h: 3 },
                    { day: 'T', h: 5 }, { day: 'F', h: 1.5 }, { day: 'S', h: 0 }, { day: 'S', h: 2 },
                  ].map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex flex-col justify-end" style={{ height: '64px' }}>
                        <div
                          className="w-full rounded-md transition-all"
                          style={{
                            height: `${(d.h / 5) * 100}%`,
                            background: d.h > 0 ? 'linear-gradient(to top, #22d3ee80, #818cf840)' : undefined,
                            backgroundColor: d.h === 0 ? 'rgba(255,255,255,0.03)' : undefined,
                          }}
                        />
                      </div>
                      <span className="font-sans text-[9px] text-slate-600 uppercase">{d.day}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
