import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, X, SlidersHorizontal, Globe, Building, ShieldCheck,
  Users, Star, BookOpen, Clock, ChevronRight, ArrowRight,
  CheckCircle2, Lock, Sparkles, ChevronDown, Key,
} from 'lucide-react';
import clsx from 'clsx';
import {
  MOCK_COURSES,
  UNIVERSITIES,
  CATEGORIES,
  Course,
  CourseCategory,
} from '../../data/mockCourses';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const TYPE_LABELS: Record<string, string> = {
  independent: 'Independent',
  'university-public': 'Public',
  'university-private': 'Private',
};

function getTypeBadge(course: Course) {
  if (course.type === 'independent') {
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-semibold text-[10px] tracking-widest uppercase">
        <Globe className="w-3 h-3" />
        Independent
      </span>
    );
  }
  if (course.type === 'university-public') {
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-bright border border-white/5 text-on-surface-variant font-sans font-semibold text-[10px] tracking-widest uppercase">
        <ShieldCheck className="w-3 h-3 text-emerald-400" />
        Public
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 font-sans font-semibold text-[10px] tracking-widest uppercase">
      <Lock className="w-3 h-3" />
      Private
    </span>
  );
}

// ─── Course Details Modal ────────────────────────────────────────────────────

interface ModalProps {
  course: Course | null;
  onClose: () => void;
  onEnroll: (id: string) => void;
}

function CourseDetailsModal({ course, onClose, onEnroll }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!course) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [course, onClose]);

  if (!course) return null;

  const Icon = course.icon;
  const accentVar = `var(--color-${course.accentColor.replace('primary-fixed-dim', 'primary-fixed-dim')})`;
  // For tailwind dynamic class — use inline style for glow
  const glowStyle = { boxShadow: `0 0 40px ${accentVar}22` };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-surface-container overflow-hidden"
        style={glowStyle}
      >
        {/* Header */}
        <div className="relative shrink-0 p-8 pb-6 border-b border-white/10 overflow-hidden">
          <div
            className="absolute top-0 right-0 w-64 h-64 rounded-full blur-[80px] -mr-20 -mt-20 opacity-20 pointer-events-none"
            style={{ background: accentVar }}
          />
          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-5 relative z-10">
            <div
              className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center border border-white/10"
              style={{ background: `${accentVar}18` }}
            >
              <Icon className="w-8 h-8" style={{ color: accentVar }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-2">
                {course.university && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary-container/10 text-secondary-container border border-secondary-container/20 font-sans font-semibold text-[10px] tracking-widest uppercase">
                    <Building className="w-3 h-3" />
                    {course.university}
                  </span>
                )}
                {getTypeBadge(course)}
                <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-400 font-sans font-semibold text-[10px] tracking-widest uppercase">
                  {course.category}
                </span>
              </div>
              <h2 className="font-display text-2xl font-bold text-on-surface leading-tight">{course.title}</h2>
              <p className="font-sans text-sm text-on-surface-variant mt-1">{course.instructor}</p>
            </div>
          </div>

          {/* Stats row */}
          <div className="relative z-10 flex items-center gap-6 mt-5 text-sm font-sans">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Star className="w-4 h-4 fill-amber-400" />
              <span className="font-semibold">{course.rating}</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Users className="w-4 h-4" />
              {formatNumber(course.enrollmentCount)} enrolled
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <BookOpen className="w-4 h-4" />
              {course.modules} modules
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <Clock className="w-4 h-4" />
              {course.durationWeeks} weeks
            </span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
          {/* Description */}
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">About</h3>
            <p className="font-sans text-sm text-on-surface-variant leading-relaxed">{course.description}</p>
          </div>

          {/* Prerequisites */}
          {course.prerequisites.length > 0 && (
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Prerequisites</h3>
              <ul className="space-y-1.5">
                {course.prerequisites.map((p) => (
                  <li key={p} className="flex items-center gap-2 font-sans text-sm text-on-surface-variant">
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {course.prerequisites.length === 0 && (
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Prerequisites</h3>
              <p className="font-sans text-sm text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> None — open to everyone
              </p>
            </div>
          )}

          {/* Syllabus */}
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Syllabus Overview</h3>
            <ol className="space-y-2">
              {course.syllabus.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg bg-surface-container-high/60 border border-white/5 font-sans text-sm text-on-surface"
                >
                  <span
                    className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center font-display text-xs font-bold"
                    style={{ background: `${accentVar}22`, color: accentVar }}
                  >
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 p-6 border-t border-white/10 bg-surface-container-lowest/50">
          {course.isEnrolled ? (
            <Link
              to={`/student/course/${course.id}`}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-display font-semibold text-base text-on-primary-fixed bg-primary-fixed-dim hover:bg-primary-container transition-all duration-200 active:scale-95 shadow-[0_0_20px_rgba(0,218,243,0.2)]"
            >
              Open Course <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <button
              onClick={() => onEnroll(course.id)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-display font-semibold text-base transition-all duration-200 active:scale-95"
              style={{
                background: `${accentVar}22`,
                border: `1px solid ${accentVar}44`,
                color: accentVar,
              }}
            >
              <Sparkles className="w-4 h-4" />
              Confirm Enrollment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Course Card ─────────────────────────────────────────────────────────────

interface CardProps {
  course: Course;
  onClick: (course: Course) => void;
}

function CourseCard({ course, onClick }: CardProps) {
  const Icon = course.icon;
  // We cannot use dynamic Tailwind classes, so use inline styles for accent
  const accentVar = course.accentColor.startsWith('primary')
    ? '#00daf3'
    : `var(--tw-color-${course.accentColor})`;

  // Hardcoded palette map for safety
  const colorMap: Record<string, string> = {
    'primary-fixed-dim': '#00daf3',
    'indigo-400': '#818cf8',
    'emerald-400': '#34d399',
    'violet-400': '#a78bfa',
    'amber-400': '#fbbf24',
    'rose-400': '#fb7185',
    'lime-400': '#a3e635',
    'sky-400': '#38bdf8',
    'teal-400': '#2dd4bf',
    'cyan-400': '#22d3ee',
    'pink-400': '#f472b6',
    'orange-400': '#fb923c',
  };
  const accent = colorMap[course.accentColor] ?? '#00daf3';

  return (
    <button
      onClick={() => onClick(course)}
      className="text-left w-full glass-card rounded-xl p-6 relative overflow-hidden group transition-all duration-300 hover:border-white/20 active:scale-[0.98] cursor-pointer"
      style={{ borderColor: course.isEnrolled ? `${accent}33` : undefined }}
    >
      {/* Glow */}
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `${accent}22` }}
      />

      {/* Top badges */}
      <div className="relative z-10 flex items-start justify-between mb-4 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {course.university ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary-container/10 text-secondary-container border border-secondary-container/20 font-sans font-semibold text-[10px] tracking-widest uppercase">
              <Building className="w-3 h-3" />
              {course.university}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 font-sans font-semibold text-[10px] tracking-widest uppercase">
              <Globe className="w-3 h-3" />
              Independent
            </span>
          )}
          {getTypeBadge(course)}
        </div>

        {course.isEnrolled && (
          <span className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-sans font-bold text-[10px] tracking-widest uppercase">
            <CheckCircle2 className="w-3 h-3" />
            Enrolled
          </span>
        )}
      </div>

      {/* Icon + Title */}
      <div className="relative z-10">
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 border"
          style={{ background: `${accent}18`, borderColor: `${accent}33` }}
        >
          <Icon className="w-6 h-6" style={{ color: accent }} />
        </div>
        <h3
          className="font-display text-xl font-medium text-on-surface mb-1 transition-colors duration-200 group-hover:text-white"
          style={{ color: course.isEnrolled ? accent : undefined }}
        >
          {course.title}
        </h3>
        <p className="font-sans text-sm text-on-surface-variant mb-3">{course.instructor}</p>
        <p className="font-sans text-sm text-slate-500 leading-relaxed line-clamp-2">{course.description}</p>
      </div>

      {/* Bottom stats */}
      <div className="relative z-10 mt-5 flex items-center gap-4 text-xs font-sans text-slate-500">
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          <span className="font-semibold text-slate-400">{course.rating}</span>
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />
          {formatNumber(course.enrollmentCount)}
        </span>
        <span className="flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5" />
          {course.modules} modules
        </span>
      </div>

      {/* CTA footer */}
      <div
        className="relative z-10 mt-4 pt-4 border-t border-white/5 flex items-center justify-between"
      >
        <span className="font-sans text-[11px] uppercase tracking-widest font-semibold text-slate-500">{course.category}</span>
        <span
          className="flex items-center gap-1 font-display text-xs font-semibold transition-colors"
          style={{ color: accent }}
        >
          {course.isEnrolled ? 'Open Course' : 'View Details'}
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </button>
  );
}

// ─── Select Dropdown ─────────────────────────────────────────────────────────
interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  icon?: React.ReactNode;
}
function FilterSelect({ value, onChange, options, icon }: SelectProps) {
  return (
    <div className="relative">
      {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'appearance-none bg-surface-container border border-white/10 rounded-lg py-2.5 pr-8 text-sm font-sans text-on-surface-variant focus:outline-none focus:border-primary-fixed-dim/50 transition-colors',
          icon ? 'pl-9' : 'pl-4'
        )}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-surface-container">
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CourseCatalog() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [university, setUniversity] = useState('All Universities');
  const [category, setCategory] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [showFilters, setShowFilters] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courses, setCourses] = useState<Course[]>(MOCK_COURSES);

  const handleEnroll = (id: string) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isEnrolled: true } : c))
    );
    setSelectedCourse((prev) => (prev?.id === id ? { ...prev, isEnrolled: true } : prev));
  };

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      const q = query.toLowerCase();
      const matchesQuery =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q) ||
        (c.university ?? '').toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q);

      const matchesUniversity =
        university === 'All Universities' ||
        (university === 'Independent' ? c.university === null : c.university === university);

      const matchesCategory = category === 'All' || c.category === (category as CourseCategory);

      const matchesType =
        typeFilter === 'All Types' ||
        (typeFilter === 'Independent' && c.type === 'independent') ||
        (typeFilter === 'University - Public' && c.type === 'university-public') ||
        (typeFilter === 'University - Private' && c.type === 'university-private');

      return matchesQuery && matchesUniversity && matchesCategory && matchesType;
    });
  }, [courses, query, university, category, typeFilter]);

  const enrolledCount = courses.filter((c) => c.isEnrolled).length;
  const globalCount = courses.filter((c) => c.type === 'independent').length;

  return (
    <>
      {/* Page Content */}
      <div className="flex-1 flex flex-col">
        <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
          {/* Hero */}
          <div className="relative mb-10 rounded-2xl border border-white/5 bg-surface-container overflow-hidden p-10">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 right-0 w-96 h-96 bg-primary-fixed-dim/10 rounded-full blur-[100px] -mr-40 -mt-40" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-container/10 rounded-full blur-[80px] -ml-20 -mb-20" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[11px] tracking-widest uppercase">
                    <Sparkles className="w-3.5 h-3.5" />
                    Global Network
                  </span>
                </div>
                <h1 className="font-display text-4xl md:text-5xl font-bold text-on-surface mb-3 tracking-tight">
                  Discover Courses
                </h1>
                <p className="font-sans text-base text-on-surface-variant max-w-xl">
                  Explore courses from top universities worldwide or from independent educators — no restrictions.
                  Enroll in anything that sparks your curiosity.
                </p>

                <div className="flex items-center gap-6 mt-8">
                  <div className="text-left">
                    <p className="font-display text-2xl font-bold text-primary-fixed-dim">{courses.length}</p>
                    <p className="font-sans text-xs text-slate-500 uppercase tracking-widest mt-0.5">Total Courses</p>
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <div className="text-left">
                    <p className="font-display text-2xl font-bold text-emerald-400">{enrolledCount}</p>
                    <p className="font-sans text-xs text-slate-500 uppercase tracking-widest mt-0.5">Enrolled</p>
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <div className="text-left">
                    <p className="font-display text-2xl font-bold text-violet-400">{globalCount}</p>
                    <p className="font-sans text-xs text-slate-500 uppercase tracking-widest mt-0.5">Independent</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowJoinModal(true)}
                className="group flex flex-col items-center justify-center gap-2 px-8 py-6 rounded-2xl bg-gradient-to-b from-primary-fixed-dim/20 to-primary-fixed-dim/5 border border-primary-fixed-dim/30 text-primary-fixed-dim hover:from-primary-fixed-dim/30 hover:to-primary-fixed-dim/10 transition-all duration-300 active:scale-95 shrink-0 shadow-[0_0_30px_rgba(0,218,243,0.15)] hover:shadow-[0_0_40px_rgba(0,218,243,0.25)]"
              >
                <div className="w-12 h-12 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform duration-300">
                  <Key className="w-6 h-6" />
                </div>
                <span className="font-display text-base font-bold tracking-wide">Join Private Course</span>
                <span className="font-sans text-xs text-primary-fixed-dim/70">Enter university access code</span>
              </button>
            </div>
          </div>

          {/* Controls Toolbar */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1 relative flex items-center focus-within:ring-1 focus-within:ring-primary-fixed-dim/50 rounded-xl bg-surface-container px-4 py-3 border border-white/5">
              <Search className="text-on-surface-variant w-5 h-5 mr-3 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses, instructors, universities..."
                className="bg-transparent border-none focus:ring-0 text-on-surface font-sans text-base w-full placeholder:text-on-surface-variant/50 outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="ml-2 text-slate-500 hover:text-slate-300 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={clsx(
                'flex items-center gap-2 px-6 py-3 rounded-xl border font-display text-sm font-semibold transition-all duration-200 shrink-0',
                showFilters
                  ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/40 text-primary-fixed-dim'
                  : 'bg-surface-container border-white/10 text-slate-300 hover:text-white hover:border-white/20 hover:bg-white/5'
              )}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mb-6 p-5 rounded-xl border border-white/10 bg-surface-container flex flex-wrap gap-4 items-center">
              <FilterSelect
                value={university}
                onChange={setUniversity}
                options={UNIVERSITIES}
                icon={<Building className="w-4 h-4" />}
              />
              <FilterSelect
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
                icon={<BookOpen className="w-4 h-4" />}
              />
              <FilterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={['All Types', 'Independent', 'University - Public', 'University - Private']}
                icon={<Globe className="w-4 h-4" />}
              />
              <button
                onClick={() => { setUniversity('All Universities'); setCategory('All'); setTypeFilter('All Types'); }}
                className="ml-auto text-sm font-display text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Clear filters
              </button>
            </div>
          )}

          {/* Results count */}
          <div className="flex items-center justify-between mb-6">
            <p className="font-sans text-sm text-slate-500">
              {filtered.length === 0 ? 'No courses found' : `${filtered.length} course${filtered.length !== 1 ? 's' : ''} found`}
              {query && <span className="text-primary-fixed-dim"> for &ldquo;{query}&rdquo;</span>}
            </p>
          </div>

          {/* Grid */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map((course) => (
                <div key={course.id}>
                  <CourseCard course={course} onClick={setSelectedCourse} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
                <Search className="w-7 h-7 text-slate-600" />
              </div>
              <h2 className="font-display text-xl font-medium text-white mb-2">No courses found</h2>
              <p className="font-sans text-sm text-slate-500 max-w-sm">
                Try adjusting your search query or clearing the active filters.
              </p>
              <button
                onClick={() => { setQuery(''); setUniversity('All Universities'); setCategory('All'); setTypeFilter('All Types'); }}
                className="mt-5 px-5 py-2.5 rounded-lg bg-surface-container border border-white/10 text-slate-300 font-display text-sm hover:border-white/20 transition-all"
              >
                Reset all
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Join Code Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md flex flex-col rounded-2xl border border-white/10 bg-surface-container overflow-hidden p-6 shadow-[0_0_40px_rgba(0,218,243,0.1)]">
            <button
              onClick={() => { setShowJoinModal(false); setJoinError(''); setJoinCode(''); }}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 text-primary-fixed-dim">
                <Key className="w-5 h-5" />
              </div>
              <h2 className="font-display text-xl font-bold text-on-surface">Join Private Course</h2>
            </div>
            
            <p className="font-sans text-sm text-slate-400 mb-6 leading-relaxed">
              Enter the access code provided by your professor to enroll in a restricted university course.
            </p>
            
            <input
              type="text"
              placeholder="e.g. CS202-FALL26"
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value); setJoinError(''); }}
              className="w-full bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 font-sans text-on-surface placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 mb-2 uppercase"
            />
            {joinError && <p className="text-rose-400 text-xs font-sans mb-4">{joinError}</p>}
            
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setShowJoinModal(false); setJoinError(''); setJoinCode(''); }}
                className="flex-1 py-3 rounded-xl border border-white/10 font-display font-semibold text-sm text-slate-300 hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (joinCode.trim().length < 5) {
                    setJoinError('Please enter a valid course code (min. 5 characters).');
                  } else {
                    // Simulate successful join
                    setShowJoinModal(false);
                    setJoinCode('');
                    alert(`Successfully enrolled using code: ${joinCode.toUpperCase()}`);
                  }
                }}
                className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-display font-semibold text-sm hover:bg-primary-container transition-all active:scale-95"
              >
                Join Course
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details Modal */}
      <CourseDetailsModal
        course={selectedCourse}
        onClose={() => setSelectedCourse(null)}
        onEnroll={handleEnroll}
      />
    </>
  );
}
