import { Link } from 'react-router-dom';
import {
  Flame, Clock, Award, TrendingUp, Layers, ArrowRight, Lock,
  Gamepad2, PenLine, ClipboardList, BookOpen, Sparkles,
} from 'lucide-react';
import { MOCK_STUDENTS } from '../../data/mockStudents';

/* ------------------------------------------------------------------
   Static placeholder data (UI only — no backend wiring yet).
   Shapes mirror the tables these will eventually come from:
   gamification_profiles, bkt_mastery, study_spaces, flashcards,
   user_badges, cognitive_logs / practice_tests / game_sessions.
------------------------------------------------------------------- */

const stats = [
  { label: 'Overall Progress', value: '72%', hint: 'Across all your topics', icon: TrendingUp, color: '#22d3ee' },
  { label: 'Day Streak', value: '7 days', hint: 'Keep it going!', icon: Flame, color: '#fb923c' },
  { label: 'Study Time', value: '14.5 hrs', hint: 'Total so far', icon: Clock, color: '#818cf8' },
  { label: 'Badges Earned', value: '4', hint: 'Out of 8', icon: Award, color: '#fbbf24' },
];

const spaces = [
  { id: '1', title: 'Biology — Cell Structure', progress: 84, materials: 3, lastStudied: 'Studied today' },
  { id: '2', title: 'Math — Quadratic Equations', progress: 61, materials: 2, lastStudied: 'Studied yesterday' },
  { id: '3', title: 'History — World War II', progress: 38, materials: 4, lastStudied: 'Studied 3 days ago' },
];

const topics = [
  { term: 'Photosynthesis', space: 'Biology', mastery: 91 },
  { term: 'Mitosis', space: 'Biology', mastery: 76 },
  { term: 'Completing the Square', space: 'Math', mastery: 54 },
  { term: 'The Treaty of Versailles', space: 'History', mastery: 32 },
  { term: 'Discriminant', space: 'Math', mastery: 21 },
];

const badges = [
  { name: 'First Upload', earned: true },
  { name: '7-Day Streak', earned: true },
  { name: 'Flashcard Pro', earned: true },
  { name: 'Game Champ', earned: true },
  { name: '10-Day Streak', earned: false },
  { name: 'Test Master', earned: false },
];

const activity = [
  { text: 'You scored 8 out of 10 on a practice test in Biology.', time: '2 hours ago', icon: ClipboardList, color: '#34d399' },
  { text: 'You reviewed 12 flashcards in Math.', time: '5 hours ago', icon: Layers, color: '#22d3ee' },
  { text: 'You explained "Mitosis" in your own words.', time: 'Yesterday', icon: PenLine, color: '#818cf8' },
  { text: 'You played Term Matching and got 90% correct.', time: '2 days ago', icon: Gamepad2, color: '#fbbf24' },
];

/** Turns a 0–100 score into words a Grade 10 student can act on. */
function masteryLabel(mastery: number) {
  if (mastery >= 80) return { text: 'Strong', color: '#34d399' };
  if (mastery >= 50) return { text: 'Getting there', color: '#fbbf24' };
  return { text: 'Needs practice', color: '#fb7185' };
}

export default function StudentDashboard() {
  const student = MOCK_STUDENTS[0];
  const firstName = student.name.split(' ')[0];

  const dueToday = 12;
  const weeklyMinutes = [30, 45, 0, 60, 25, 50, 40];
  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const peakMinutes = Math.max(...weeklyMinutes);

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* Greeting */}
        <header className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight">
            Hi, {firstName}
          </h1>
          <p className="font-sans text-sm text-slate-400 mt-1.5">
            Here's how your studying is going.
          </p>
        </header>

        {/* Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 transition-colors hover:bg-white/[0.04]"
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${stat.color}1a`, color: stat.color }}
                >
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <p className="font-display text-2xl font-bold text-white tracking-tight">{stat.value}</p>
                <p className="font-sans text-sm text-slate-300 font-medium mt-0.5">{stat.label}</p>
                <p className="font-sans text-xs text-slate-500 mt-0.5">{stat.hint}</p>
              </div>
            );
          })}
        </section>

        <div className="grid grid-cols-12 gap-6">

          {/* ---------------- Main column ---------------- */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">

            {/* Study spaces */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-white">Your Study Spaces</h2>
                <Link
                  to="/student/spaces"
                  className="font-sans text-xs text-cyan-400 font-semibold flex items-center gap-1 hover:gap-1.5 transition-all"
                >
                  See all <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="flex flex-col gap-3">
                {spaces.map(space => (
                  <Link
                    key={space.id}
                    to={`/student/space/${space.id}`}
                    className="group flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-cyan-400/10 text-cyan-400 flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-sm font-semibold text-white truncate group-hover:text-cyan-400 transition-colors">
                        {space.title}
                      </p>
                      <p className="font-sans text-xs text-slate-500 mt-0.5">
                        {space.materials} files · {space.lastStudied}
                      </p>
                    </div>

                    <div className="w-28 shrink-0 hidden sm:block">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-sans text-[11px] text-slate-500">Progress</span>
                        <span className="font-sans text-[11px] font-bold text-white">{space.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan-400"
                          style={{ width: `${space.progress}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            {/* Topics */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="mb-5">
                <h2 className="font-display text-lg font-bold text-white">What to Study Next</h2>
                <p className="font-sans text-xs text-slate-500 mt-1">
                  Topics at the bottom need the most practice.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {[...topics].sort((a, b) => b.mastery - a.mastery).map(topic => {
                  const label = masteryLabel(topic.mastery);
                  return (
                    <div key={topic.term} className="flex items-center gap-4">
                      <div className="w-40 sm:w-52 shrink-0 min-w-0">
                        <p className="font-sans text-sm text-white font-medium truncate">{topic.term}</p>
                        <p className="font-sans text-xs text-slate-500">{topic.space}</p>
                      </div>

                      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${topic.mastery}%`, backgroundColor: label.color }}
                        />
                      </div>

                      <span
                        className="font-sans text-[11px] font-semibold w-28 text-right shrink-0"
                        style={{ color: label.color }}
                      >
                        {label.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* This week */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h2 className="font-display text-lg font-bold text-white">This Week</h2>
                  <p className="font-sans text-xs text-slate-500 mt-1">How long you studied each day.</p>
                </div>
                <p className="font-sans text-xs text-slate-400">
                  <span className="text-white font-bold">4 hrs 10 min</span> total
                </p>
              </div>

              <div className="flex items-end justify-between gap-2 sm:gap-4 h-32">
                {weeklyMinutes.map((minutes, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <span className="font-sans text-[10px] text-slate-500">
                      {minutes > 0 ? `${minutes}m` : '—'}
                    </span>
                    <div
                      className="w-full rounded-md bg-cyan-400/70 min-h-[4px] transition-all"
                      style={{ height: `${(minutes / peakMinutes) * 100}%` }}
                    />
                    <span className="font-sans text-[11px] text-slate-500 font-medium">{weekDays[i]}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ---------------- Side column ---------------- */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">

            {/* Flashcards due */}
            <section className="rounded-2xl bg-cyan-400/[0.06] border border-cyan-400/20 p-6">
              <div className="w-9 h-9 rounded-lg bg-cyan-400/15 text-cyan-400 flex items-center justify-center mb-4">
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <h2 className="font-display text-lg font-bold text-white">
                {dueToday} flashcards to review
              </h2>
              <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                These are ready for you today. Reviewing them now helps you remember them longer.
              </p>
              <Link
                to="/student/spaces"
                className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-cyan-400 text-page font-sans text-sm font-bold hover:bg-cyan-300 transition-colors"
              >
                Start Reviewing <ArrowRight className="w-4 h-4" />
              </Link>
            </section>

            {/* Badges */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-white">Badges</h2>
                <span className="font-sans text-xs text-slate-500">
                  {badges.filter(b => b.earned).length} of {badges.length}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {badges.map(badge => (
                  <div
                    key={badge.name}
                    className={`flex flex-col items-center text-center gap-2 p-3 rounded-xl border ${
                      badge.earned
                        ? 'bg-amber-400/[0.08] border-amber-400/20'
                        : 'bg-white/[0.02] border-white/5'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center ${
                        badge.earned ? 'bg-amber-400/15 text-amber-400' : 'bg-white/5 text-slate-600'
                      }`}
                    >
                      {badge.earned ? <Award className="w-4.5 h-4.5" /> : <Lock className="w-4 h-4" />}
                    </div>
                    <span
                      className={`font-sans text-[11px] font-medium leading-tight ${
                        badge.earned ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      {badge.name}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Recent activity */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <h2 className="font-display text-lg font-bold text-white mb-5">Recent Activity</h2>

              <div className="flex flex-col gap-4">
                {activity.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${item.color}1a`, color: item.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-sans text-xs text-slate-300 leading-relaxed">{item.text}</p>
                        <span className="font-sans text-[11px] text-slate-500">{item.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
