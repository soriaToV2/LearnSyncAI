import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BrainCircuit, Sigma, Code2, Plus, Users, ArrowUpRight,
  Globe, Lock, Search, Filter, Clock,
} from 'lucide-react';
import { EDUCATOR_COURSES, addCourse } from '../../data/mockEducatorData';
import CreateCourseModal from './course/components/CreateCourseModal';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = { BrainCircuit, Sigma, Code2 };

export default function CoursesList() {
  const [filter, setFilter] = useState<'all' | 'active' | 'archived' | 'draft'>('all');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [courses, setCourses] = useState([...EDUCATOR_COURSES]);

  const filtered = courses
    .filter(c => filter === 'all' || c.status === filter)
    .filter(c => c.title.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    all: courses.length,
    active: courses.filter(c => c.status === 'active').length,
    archived: courses.filter(c => c.status === 'archived').length,
    draft: courses.filter(c => c.status === 'draft').length,
  };

  return (
    <main className="flex-1 overflow-y-auto p-10 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <h2 className="font-display text-3xl font-bold text-on-surface mb-2">My Courses</h2>
          <p className="font-sans text-sm text-on-surface-variant">Manage your courses, resources, and assessments.</p>
        </div>
        <button onClick={() => setShowCreateModal(true)}
          className="shrink-0 px-6 py-3 bg-primary-container text-on-primary-container rounded-xl font-display text-sm font-semibold hover:bg-primary-fixed transition-all flex items-center gap-2 active:scale-95">
          <Plus className="w-5 h-5" /> Create Course
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-on-surface font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
        </div>
        <div className="flex gap-2">
          {(['all', 'active', 'archived', 'draft'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border ${filter === f
                ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
              }`}>
              {f} {counts[f] > 0 && <span className="ml-1 opacity-60">({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Course Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(c => {
          const Icon = iconMap[c.iconName] || BrainCircuit;
          const nextDue = c.assessments.find(a => a.deadline && (a.status === 'deployed' || a.status === 'ready'));
          return (
            <Link to={`/educator/course/${c.id}/resources`} key={c.id}
              className="group bg-surface-container rounded-xl p-6 border border-white/10 relative overflow-hidden hover:border-white/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-6 opacity-10">
                <Icon className="w-24 h-24 group-hover:scale-110 transition-transform duration-500" style={{ color: c.color }} />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10"
                    style={{ backgroundColor: `${c.color}15`, color: c.color }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex gap-1.5">
                    {c.isPublic ? (
                      <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 text-[9px] font-semibold uppercase border border-emerald-400/20">
                        <Globe className="w-2.5 h-2.5" /> Public
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-[9px] font-semibold uppercase border border-amber-400/20">
                        <Lock className="w-2.5 h-2.5" /> Restricted
                      </span>
                    )}
                  </div>
                </div>
                <h3 className="font-display text-xl font-semibold text-on-surface mb-1 group-hover:text-white transition-colors">{c.title}</h3>
                <p className="font-sans text-sm text-on-surface-variant mb-5 line-clamp-2">{c.description}</p>
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm">
                    <Users className="w-4 h-4" /> {c.studentCount} Students
                  </div>
                  {nextDue && (
                    <span className="flex items-center gap-1 text-amber-400 font-sans text-xs font-semibold">
                      <Clock className="w-3 h-3" /> {nextDue.deadline?.split('·')[0]}
                    </span>
                  )}
                  {!nextDue && c.status === 'active' && (
                    <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 font-sans font-semibold text-[10px] tracking-wider border border-green-500/20 uppercase">
                      Active
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}

        {/* New Course CTA */}
        <button onClick={() => setShowCreateModal(true)}
          className="rounded-xl p-6 border-2 border-dashed border-white/10 bg-surface-container-low/50 hover:bg-surface-container/50 hover:border-white/20 transition-all duration-300 flex flex-col items-center justify-center cursor-pointer min-h-[220px] group">
          <div className="w-12 h-12 rounded-full bg-surface-bright flex items-center justify-center mb-4 text-on-surface-variant group-hover:text-on-surface transition-colors">
            <Plus className="w-6 h-6" />
          </div>
          <span className="font-display text-xl font-medium text-on-surface-variant group-hover:text-on-surface transition-colors">New Course</span>
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl mt-4">
          <p className="text-slate-400 font-sans">No courses found matching your criteria.</p>
        </div>
      )}

      <CreateCourseModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onCreate={(data) => {
        addCourse(data);
        setCourses([...EDUCATOR_COURSES]);
      }} />
    </main>
  );
}
