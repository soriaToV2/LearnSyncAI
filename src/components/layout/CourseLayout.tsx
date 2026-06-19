import React from 'react';
import { NavLink, useParams, Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Users as UsersIcon, Copy, Check, Archive } from 'lucide-react';
import clsx from 'clsx';
import { getCourseById } from '../../data/mockEducatorData';
import Modal from '../ui/Modal';

export default function CourseLayout({ children }: { children: React.ReactNode }) {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [updater, setUpdater] = React.useState(0);

  React.useEffect(() => {
    const handleUpdate = () => setUpdater(prev => prev + 1);
    window.addEventListener('learnSyncAI_courseUpdated', handleUpdate);
    return () => window.removeEventListener('learnSyncAI_courseUpdated', handleUpdate);
  }, []);

  const course = getCourseById(courseId || '');
  const [copied, setCopied] = React.useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = React.useState(false);

  const handleCopy = () => {
    if (course) {
      navigator.clipboard.writeText(course.courseCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!course) {
    return <div className="p-10 text-white">Course not found.</div>;
  }

  const titleParts = course.title.split(' - ');
  let displayCode = '';
  let displayTitle = '';
  if (titleParts.length > 1) {
    displayCode = titleParts[0];
    displayTitle = titleParts.slice(1).join(' - ');
  } else {
    displayCode = course.id.toUpperCase();
    displayTitle = course.title;
  }

  const handleArchive = () => {
    setIsArchiveOpen(true);
  };

  return (
    <>
      <div className="p-4 md:p-10 max-w-7xl mx-auto w-full min-w-0">
        <div className="flex items-center gap-2 text-slate-400 font-sans text-xs mb-6">
          <Link to="/educator/courses" className="hover:text-primary-fixed-dim transition-colors">Courses</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-300">{displayTitle}</span>
        </div>

        {/* Course Header */}
        <div className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-full bg-surface-variant text-on-surface font-sans font-semibold text-[11px] tracking-[0.1em] border border-white/5 uppercase">
                {displayCode}
              </span>
              {course.section && (
                <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 font-sans font-semibold text-[11px] tracking-[0.1em] border border-indigo-500/20 uppercase">
                  Section {course.section}
                </span>
              )}
              <span className="px-2.5 py-1 rounded-full font-sans font-semibold text-[11px] tracking-[0.1em] border uppercase"
                style={{ backgroundColor: `${course.color}15`, color: course.color, borderColor: `${course.color}30` }}>
                {course.status === 'active' ? 'Active Term' : course.status}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl md:text-[38px] font-bold text-on-surface mb-1 tracking-tight leading-tight break-words">{displayTitle}</h1>
            <p className="font-sans text-sm text-on-surface-variant max-w-2xl leading-relaxed">{course.description}</p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto shrink-0 flex-wrap">
            <button onClick={handleCopy} title="Copy Class Invite Code" className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-sans text-xs hover:bg-white/10 transition-all active:scale-[0.98]">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>Class Code: <span className="font-mono font-bold text-white tracking-wider">{course.courseCode}</span></span>
            </button>
            <div className="w-full sm:w-auto flex items-center justify-center gap-2 text-on-surface-variant font-sans text-xs bg-surface-container-high px-4 py-2.5 rounded-xl border border-white/5">
              <UsersIcon className="w-4 h-4 text-indigo-400" />
              <span>{course.students ? course.students.length : course.studentCount} Students</span>
            </div>
            {course.status === 'active' && (
              <button onClick={handleArchive} title="Archive Course" className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-sans text-xs font-bold hover:bg-amber-500/20 transition-all active:scale-[0.98]">
                <Archive className="w-3.5 h-3.5" />
                <span>Archive</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar w-full shrink-0">
          <NavLink
            to={`/educator/course/${courseId}/resources`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Learning Resources
          </NavLink>
          <NavLink
            to={`/educator/course/${courseId}/mastery`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Mastery
          </NavLink>
          <NavLink
            to={`/educator/course/${courseId}/assessments`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Quizzes & Exams
          </NavLink>
          <NavLink
            to={`/educator/course/${courseId}/students`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Students
          </NavLink>
          <NavLink
            to={`/educator/course/${courseId}/announcements`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Announcements
          </NavLink>
        </div>

        {children}
      </div>

      {/* Archive Course Confirmation Modal */}
      {isArchiveOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Archive className="w-5 h-5" />
            </div>
            
            <div className="space-y-2">
              <h4 className="font-display text-lg font-bold text-white tracking-tight">Archive Course?</h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Are you sure you want to archive <span className="text-white font-semibold">{displayTitle}</span>? Archiving will remove this course from your active dashboard.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsArchiveOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (course) {
                    course.status = 'archived';
                    course.archivedAt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    setIsArchiveOpen(false);
                    navigate('/educator/courses');
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-sans text-xs font-bold uppercase transition-all shadow-lg shadow-amber-600/20"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
