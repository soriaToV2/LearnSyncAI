import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Compass, BrainCircuit, Sigma, Code2,
  Building, Globe, ShieldCheck, TrendingUp, Calendar, Award,
  Zap, BookOpen, Clock, Target, ChevronRight, Activity,
} from 'lucide-react';

const courses = [
  { id: 'bio-301', title: 'Advanced Neurobiology', prof: 'Prof. Elias Vance', progress: 45, color: 'cyan', icon: BrainCircuit, uni: 'MIT', type: 'Internal' },
  { id: 'phys-401', title: 'Quantum Mechanics II', prof: 'Prof. Sarah Chen', progress: 80, color: 'indigo', icon: Sigma, uni: 'Stanford', type: 'Global' },
  { id: 'cs-202', title: 'Algorithms & Data Structures', prof: 'Prof. Alan Turing', progress: 15, color: 'emerald', icon: Code2, uni: 'MIT', type: 'Internal' },
];

const colorMap: Record<string, string> = {
  cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20 group-hover:border-cyan-400/50',
  indigo: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20 group-hover:border-indigo-400/50',
  emerald: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20 group-hover:border-emerald-400/50',
};
const barMap: Record<string, string> = { cyan: 'bg-cyan-400', indigo: 'bg-indigo-400', emerald: 'bg-emerald-400' };
const hoverMap: Record<string, string> = { cyan: 'group-hover:text-cyan-400', indigo: 'group-hover:text-indigo-400', emerald: 'group-hover:text-emerald-400' };

const activity = [
  { icon: Award, label: 'Earned "Deep Learner" badge', time: '2h ago', accent: 'text-yellow-400' },
  { icon: BookOpen, label: 'Completed Module 7 in Quantum Mech.', time: '5h ago', accent: 'text-indigo-400' },
  { icon: Target, label: 'Quiz Score: 94% — Neurobiology', time: 'Yesterday', accent: 'text-cyan-400' },
  { icon: Zap, label: 'Study streak: 7 days running!', time: 'Yesterday', accent: 'text-emerald-400' },
];

export default function StudentDashboardV1() {
  const navigate = useNavigate();


  return (
    <>


      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">

        {/* Hero */}
        <div className="relative rounded-2xl overflow-hidden mb-8 bg-gradient-to-br from-surface-container to-[#0a1628] border border-white/5 p-10">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-20 -right-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[100px]" />
            <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-indigo-500/8 rounded-full blur-[80px]" />
          </div>
          {/* Animated dot grid */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <p className="font-sans text-xs text-cyan-400/80 uppercase tracking-[0.2em] mb-3 font-semibold">
                MIT · Student Portal · Spring 2026
              </p>
              <h1 className="font-display text-5xl font-bold text-white mb-2 tracking-tight">
                Good evening, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">Sarah.</span>
              </h1>
              <p className="font-sans text-base text-slate-400">You have 2 assignments due this week. Keep the streak alive.</p>
            </div>
            <div className="flex flex-col items-end gap-4 shrink-0">
              <div className="flex items-center gap-6">
                {[{ val: '3', label: 'Active Courses', color: 'text-cyan-400' }, { val: '12', label: 'Badges', color: 'text-yellow-400' }, { val: '7d', label: 'Streak', color: 'text-emerald-400' }].map(s => (
                  <div key={s.label} className="text-right">
                    <p className={`font-display text-3xl font-bold ${s.color}`}>{s.val}</p>
                    <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <Link to="/student/catalog" className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 font-display text-sm font-semibold hover:bg-cyan-400/20 transition-all active:scale-95">
                <Compass className="w-4 h-4" /> Browse Catalog
              </Link>
            </div>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-12 gap-6 mb-8">
          {/* Progress Summary — spans 8 */}
          <div className="col-span-12 lg:col-span-8 bg-surface-container rounded-2xl border border-white/5 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-lg font-semibold text-on-surface flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" /> My Courses
              </h2>
              <Link to="/student/catalog" className="text-xs font-sans text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                View all <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              {courses.map(c => {
                const Icon = c.icon;
                return (
                  <Link to={`/student/course/${c.id}`} key={c.id}
                    className={`group flex items-center gap-4 p-4 rounded-xl border border-white/5 hover:bg-white/[0.02] transition-all duration-200`}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${colorMap[c.color]}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className={`font-display text-sm font-semibold text-on-surface truncate ${hoverMap[c.color]} transition-colors`}>{c.title}</p>
                        <span className="font-sans text-xs text-slate-500 shrink-0 ml-2">{c.progress}%</span>
                      </div>
                      <p className="font-sans text-xs text-slate-500 mb-2">{c.prof}</p>
                      <div className="w-full bg-white/5 rounded-full h-1">
                        <div className={`h-1 rounded-full transition-all ${barMap[c.color]}`} style={{ width: `${c.progress}%` }} />
                      </div>
                    </div>
                    <ArrowRight className={`w-4 h-4 text-slate-600 ${hoverMap[c.color]} transition-colors shrink-0`} />
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Quick Stats — spans 4 */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            <div className="flex-1 bg-surface-container rounded-2xl border border-white/5 p-6 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <h3 className="font-display text-sm font-semibold text-on-surface">Weekly Progress</h3>
              </div>
              <div className="flex items-end gap-1.5 h-20">
                {[30, 60, 45, 80, 55, 90, 70].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div className="rounded-sm bg-gradient-to-t from-cyan-400 to-indigo-400 opacity-80 hover:opacity-100 transition-opacity"
                      style={{ height: `${h}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <span key={i} className="flex-1 text-center font-sans text-[9px] text-slate-600 uppercase">{d}</span>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-500/10 to-cyan-500/5 rounded-2xl border border-indigo-400/20 p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <h3 className="font-display text-sm font-semibold text-on-surface">Upcoming</h3>
              </div>
              {[{ label: 'Midterm — Neurobiology', date: 'May 12' }, { label: 'Quiz — Quantum Mech.', date: 'May 15' }].map(ev => (
                <div key={ev.label} className="flex justify-between items-center text-xs font-sans">
                  <span className="text-slate-300 truncate">{ev.label}</span>
                  <span className="text-indigo-300 font-semibold ml-2 shrink-0">{ev.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-surface-container rounded-2xl border border-white/5 p-6">
          <h2 className="font-display text-lg font-semibold text-on-surface mb-5 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" /> Recent Activity
          </h2>
          <div className="flex flex-col gap-3">
            {activity.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.02] transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 ${a.accent}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="font-sans text-sm text-slate-300 flex-1">{a.label}</p>
                  <span className="font-sans text-xs text-slate-600 shrink-0">{a.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
