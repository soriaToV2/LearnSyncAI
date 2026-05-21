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
    <main className="flex-1 overflow-y-auto bg-page">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-10 w-full">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">My Courses</h1>
          <p className="font-sans text-base text-slate-300 font-medium">Manage your courses, resources, and assessments.</p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
          <div className="relative flex-1 max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-base placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'archived', 'draft'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full font-sans font-bold text-xs md:text-sm uppercase tracking-wider transition-colors border ${filter === f
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
          {/* New Course CTA */}
          <button onClick={() => setShowCreateModal(true)}
            className="rounded-2xl p-6 border-2 border-dashed border-white/10 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/20 transition-all duration-300 flex flex-col items-center justify-center cursor-pointer min-h-[220px] group hover:-translate-y-1">
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-4 text-slate-400 group-hover:text-white group-hover:bg-white/10 transition-all duration-300">
              <Plus className="w-7 h-7" />
            </div>
            <span className="font-display text-2xl font-bold text-slate-400 group-hover:text-slate-200 transition-colors">New Course</span>
          </button>

          {filtered.map(c => {
            const Icon = iconMap[c.iconName] || BrainCircuit;
            const nextDue = c.assessments.find(a => a.deadline && (a.status === 'deployed' || a.status === 'ready'));
            return (
              <Link to={`/educator/course/${c.id}/resources`} key={c.id}
                className="group bg-white/[0.02] rounded-2xl overflow-hidden border border-white/5 relative hover:border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(0,0,0,0.6)] flex flex-col justify-between min-h-[220px]">
                <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: c.color }} />
                <div className="p-6 flex flex-col flex-1 justify-between relative">
                  <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
                    <Icon className="w-28 h-28 group-hover:scale-110 transition-transform duration-500" style={{ color: c.color }} />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center border border-white/10 shrink-0"
                        style={{ backgroundColor: `${c.color}15`, color: c.color }}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="flex gap-1.5">
                        {c.isPublic ? (
                           <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-400/10 text-emerald-400 text-xs font-bold uppercase border border-emerald-400/20">
                             <Globe className="w-3.5 h-3.5" /> Public
                           </span>
                        ) : (
                           <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400/10 text-amber-400 text-xs font-bold uppercase border border-amber-400/20">
                             <Lock className="w-3.5 h-3.5" /> Restricted
                           </span>
                        )}
                      </div>
                    </div>
                    <h3 className="font-display text-2xl font-bold text-white mb-2 group-hover:text-primary-fixed-dim transition-colors line-clamp-1">{c.title}</h3>
                    <p className="font-sans text-base text-slate-300 mb-6 line-clamp-2 leading-relaxed">{c.description}</p>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/5 pt-4 relative z-10 shrink-0">
                    <div className="flex items-center gap-2 text-slate-300 font-sans text-base font-semibold">
                      <Users className="w-5 h-5 text-slate-500" /> {c.studentCount} Students
                    </div>
                    {nextDue && (
                      <span className="flex items-center gap-1.5 text-amber-400 font-sans text-sm font-bold">
                        <Clock className="w-4 h-4" /> {nextDue.deadline?.split('·')[0]}
                      </span>
                    )}
                    {!nextDue && c.status === 'active' && (
                      <span className="px-2.5 py-1 rounded bg-green-500/10 text-green-400 font-sans font-bold text-xs tracking-wider border border-green-500/20 uppercase">
                        Active
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl mt-4">
            <p className="text-slate-400 font-sans">No courses found matching your criteria.</p>
          </div>
        )}
      </div>

      <CreateCourseModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onCreate={(data) => {
        addCourse(data);
        setCourses([...EDUCATOR_COURSES]);
      }} />
    </main>
  );
}
