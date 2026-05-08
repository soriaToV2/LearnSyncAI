import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Compass, BrainCircuit, Sigma, Code2,
  ArrowRight, Award, BookOpen, Target, Zap, Clock,
  Building, Globe, ShieldCheck, Flame, Star, BarChart3,
} from 'lucide-react';

const courses = [
  { id: 'bio-301', title: 'Advanced Neurobiology', prof: 'Prof. Elias Vance', progress: 45, accent: '#22d3ee', icon: BrainCircuit, uni: 'MIT', next: 'Chapter 8: Synaptic Plasticity' },
  { id: 'phys-401', title: 'Quantum Mechanics II', prof: 'Prof. Sarah Chen', progress: 80, accent: '#818cf8', icon: Sigma, uni: 'Stanford', next: 'Problem Set 6 due May 15' },
  { id: 'cs-202', title: 'Algorithms & DS', prof: 'Prof. Alan Turing', progress: 15, accent: '#34d399', icon: Code2, uni: 'MIT', next: 'Module 2: Sorting Algorithms' },
];

const badges = [
  { label: 'Deep Learner', color: '#f59e0b', desc: '7-day streak' },
  { label: 'Top Scorer', color: '#818cf8', desc: '94% quiz avg' },
  { label: 'Explorer', color: '#22d3ee', desc: '3 global courses' },
];

export default function StudentDashboardV2() {
  const navigate = useNavigate();


  return (
    <>


      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">

          {/* Left-Right Split Layout */}
          <div className="flex flex-col xl:flex-row gap-8">

            {/* LEFT COLUMN */}
            <div className="flex-1 flex flex-col gap-6">

              {/* Greeting */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-5 h-5 text-orange-400" />
                  <span className="font-sans text-xs text-orange-400 font-semibold uppercase tracking-widest">7-Day Streak</span>
                </div>
                <h1 className="font-display text-4xl font-bold text-white tracking-tight">
                  Welcome back, <span style={{ color: '#818cf8' }}>Sarah</span>
                </h1>
                <p className="font-sans text-sm text-slate-400 mt-1">Thursday, May 8 · Spring Semester 2026</p>
              </div>

              {/* Continue Learning */}
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Continue Learning</h2>
                <div className="flex flex-col gap-3">
                  {courses.map(c => {
                    const Icon = c.icon;
                    return (
                      <Link to={`/student/course/${c.id}`} key={c.id}
                        className="group flex items-start gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-200">
                        {/* Accent bar */}
                        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: c.accent }} />
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                          style={{ backgroundColor: `${c.accent}15`, color: c.accent }}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-display text-base font-semibold text-on-surface group-hover:text-white transition-colors truncate">{c.title}</p>
                            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors ml-2 shrink-0" />
                          </div>
                          <p className="font-sans text-xs text-slate-500 mb-3">{c.prof} · {c.uni}</p>
                          {/* Progress */}
                          <div className="w-full bg-white/5 rounded-full h-1.5 mb-2">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${c.progress}%`, backgroundColor: c.accent }} />
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="font-sans text-xs text-slate-500">{c.next}</p>
                            <span className="font-mono text-xs font-bold" style={{ color: c.accent }}>{c.progress}%</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
                <Link to="/student/catalog"
                  className="mt-3 flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-slate-500 font-sans text-sm hover:text-slate-300 hover:border-white/20 transition-all">
                  <Compass className="w-4 h-4" /> Discover more courses
                </Link>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="w-full xl:w-72 flex flex-col gap-6 shrink-0">

              {/* XP / Level Card */}
              <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-transparent border border-indigo-400/20 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-sans text-xs text-indigo-300 uppercase tracking-widest font-semibold">Level Progress</p>
                    <p className="font-display text-2xl font-bold text-white mt-0.5">Level <span className="text-indigo-400">7</span></p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-indigo-400/10 border border-indigo-400/30 flex items-center justify-center">
                    <Star className="w-6 h-6 text-indigo-400" />
                  </div>
                </div>
                <div className="w-full bg-white/5 rounded-full h-2 mb-1">
                  <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-400" style={{ width: '68%' }} />
                </div>
                <div className="flex justify-between font-sans text-xs text-slate-500">
                  <span>680 XP</span><span>1000 XP</span>
                </div>
              </div>

              {/* Badges */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="w-4 h-4 text-yellow-400" />
                  <h3 className="font-display text-sm font-semibold text-on-surface">Earned Badges</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {badges.map(b => (
                    <div key={b.label} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border"
                        style={{ backgroundColor: `${b.color}15`, borderColor: `${b.color}30`, color: b.color }}>★</div>
                      <div>
                        <p className="font-display text-sm font-semibold text-on-surface">{b.label}</p>
                        <p className="font-sans text-xs text-slate-500">{b.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-display text-sm font-semibold text-on-surface">Stats</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { val: '42h', label: 'Study time', color: 'text-cyan-400' },
                    { val: '94%', label: 'Quiz avg', color: 'text-emerald-400' },
                    { val: '3', label: 'Courses', color: 'text-indigo-400' },
                    { val: '12', label: 'Badges', color: 'text-yellow-400' },
                  ].map(s => (
                    <div key={s.label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className={`font-display text-xl font-bold ${s.color}`}>{s.val}</p>
                      <p className="font-sans text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{s.label}</p>
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
