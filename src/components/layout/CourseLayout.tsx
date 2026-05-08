import React from 'react';
import { NavLink, useParams, Link } from 'react-router-dom';
import { ChevronRight, Users as UsersIcon, Copy, Check, Globe, Lock } from 'lucide-react';
import clsx from 'clsx';
import { getCourseById } from '../../data/mockEducatorData';

export default function CourseLayout({ children }: { children: React.ReactNode }) {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [copied, setCopied] = React.useState(false);

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

  return (
    <>
      <div className="p-10 max-w-7xl mx-auto w-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-slate-400 font-sans text-xs mb-6">
          <Link to="/educator/courses" className="hover:text-primary-fixed-dim transition-colors">Courses</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-300">{course.title}</span>
        </div>

        {/* Course Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-full bg-surface-variant text-on-surface font-sans font-semibold text-[11px] tracking-[0.1em] border border-white/5 uppercase">
                {course.id.toUpperCase()}
              </span>
              <span className="px-2.5 py-1 rounded-full font-sans font-semibold text-[11px] tracking-[0.1em] border uppercase"
                style={{ backgroundColor: `${course.color}15`, color: course.color, borderColor: `${course.color}30` }}>
                {course.status === 'active' ? 'Active Term' : course.status}
              </span>
              {course.isPublic ? (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-400/10 text-emerald-400 font-sans font-semibold text-[11px] border border-emerald-400/20 uppercase tracking-[0.1em]">
                  <Globe className="w-3 h-3" /> Public
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400/10 text-amber-400 font-sans font-semibold text-[11px] border border-amber-400/20 uppercase tracking-[0.1em]">
                  <Lock className="w-3 h-3" /> Restricted
                </span>
              )}
            </div>
            <h1 className="font-display text-[38px] font-bold text-on-surface mb-1 tracking-tight leading-tight">{course.title}</h1>
            <p className="font-sans text-sm text-on-surface-variant max-w-2xl">{course.description}</p>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <button onClick={handleCopy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-mono text-xs hover:bg-white/10 transition-all">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {course.courseCode}
            </button>
            <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm bg-surface-container-high px-4 py-2 rounded-full border border-white/5">
              <UsersIcon className="w-4 h-4" />
              <span>{course.studentCount} Students</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar">
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
        </div>

        {children}
      </div>
    </>
  );
}
