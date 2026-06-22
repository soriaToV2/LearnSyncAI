import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Key, X, Sparkles, GraduationCap } from 'lucide-react';
import { MOCK_COURSES, Course } from '../../data/mockCourses';

function CourseCard({ course, onEnroll }: { key?: React.Key; course: Course; onEnroll: (id: string) => void }) {
  const navigate = useNavigate();

  const colorMap: Record<string, string> = {
    'primary-fixed-dim': 'from-cyan-500/20 to-blue-600/10 text-cyan-400 border-cyan-500/20',
    'indigo-400': 'from-indigo-500/20 to-purple-600/10 text-indigo-400 border-indigo-500/20',
    'emerald-400': 'from-emerald-500/20 to-teal-600/10 text-emerald-400 border-emerald-500/20',
    'violet-400': 'from-violet-500/20 to-fuchsia-600/10 text-violet-400 border-violet-500/20',
    'amber-400': 'from-amber-500/20 to-orange-600/10 text-amber-400 border-amber-500/20',
    'rose-400': 'from-rose-500/20 to-pink-600/10 text-rose-400 border-rose-500/20',
    'lime-400': 'from-lime-500/20 to-emerald-600/10 text-lime-400 border-lime-500/20',
    'sky-400': 'from-sky-500/20 to-indigo-600/10 text-sky-400 border-sky-500/20',
    'teal-400': 'from-teal-500/20 to-cyan-600/10 text-teal-400 border-teal-500/20',
    'cyan-400': 'from-cyan-500/20 to-blue-600/10 text-cyan-400 border-cyan-500/20',
    'pink-400': 'from-pink-500/20 to-rose-600/10 text-pink-400 border-pink-500/20',
    'orange-400': 'from-orange-500/20 to-red-600/10 text-orange-400 border-orange-500/20',
  };

  const gradientClass = colorMap[course.accentColor] || colorMap['primary-fixed-dim'];

  const handleClick = () => {
    if (course.isEnrolled) {
      navigate(`/student/course/${course.id}`);
    } else {
      onEnroll(course.id);
      navigate(`/student/course/${course.id}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="group bg-surface-container-lowest border border-white/5 rounded-2xl overflow-hidden hover:border-white/15 hover:-translate-y-1 transition-all duration-300 shadow-xl cursor-pointer flex flex-col h-[180px] justify-between relative"
    >
      <div className={`p-6 bg-gradient-to-br ${gradientClass} flex-1 flex flex-col justify-between relative overflow-hidden`}>
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />

        <div className="flex items-center gap-1.5 flex-wrap relative z-10">
          {course.courseCode && (
            <span className="font-mono text-[9px] text-white/80 tracking-wider uppercase border border-white/20 px-2 py-0.5 rounded bg-white/5 font-semibold">
              {course.courseCode}
            </span>
          )}
          {course.section && (
            <span className="font-sans text-[9px] text-white tracking-wider uppercase border border-white/20 px-2 py-0.5 rounded bg-white/10 font-bold">
              Section {course.section}
            </span>
          )}
        </div>

        <div>
          <h3 className="font-display text-xl font-bold text-white leading-tight group-hover:text-white/90 transition-colors line-clamp-1">
            {course.title}
          </h3>
          <p className="font-sans text-xs text-white/75 mt-1 font-medium">
            {course.instructor}
          </p>
        </div>
      </div>

      {/* Card footer */}
      <div className="p-4 bg-surface-container/30 border-t border-white/5 flex items-center justify-between">
        <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {course.isEnrolled ? 'Enrolled' : 'Explore'}
        </span>
        <span className="font-display text-xs font-semibold flex items-center gap-1 text-slate-400 group-hover:text-white transition-colors">
          {course.isEnrolled ? 'Open Class' : 'Enroll & Open'}
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
        </span>
      </div>
    </div>
  );
}

export default function CourseCatalog() {
  const navigate = useNavigate();
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [courses, setCourses] = useState<Course[]>(MOCK_COURSES);

  const handleEnroll = (id: string) => {
    const globalMatch = MOCK_COURSES.find(c => c.id === id);
    if (globalMatch) {
      globalMatch.isEnrolled = true;
    }
    setCourses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isEnrolled: true } : c))
    );
  };

  const enrolledCourses = courses.filter((c) => c.isEnrolled);

  return (
    <div className="flex-1 flex flex-col">
      <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
        <div className="relative mb-10 rounded-2xl border border-white/5 bg-surface-container overflow-hidden p-6 md:p-8">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-0 w-72 h-72 bg-primary-fixed-dim/10 rounded-full blur-[80px] -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-secondary-container/10 rounded-full blur-[60px] -ml-16 -mb-16" />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-bold text-on-surface mb-2 tracking-tight">
                My Classes
              </h1>
              <p className="font-sans text-sm text-on-surface-variant max-w-xl">
                Access your enrolled learning streams, participate in interactive modules, and track assignments.
              </p>
            </div>

            <button
              onClick={() => setShowJoinModal(true)}
              className="group flex flex-col items-center justify-center gap-1.5 px-6 py-4 rounded-xl bg-gradient-to-b from-primary-fixed-dim/20 to-primary-fixed-dim/5 border border-primary-fixed-dim/30 text-primary-fixed-dim hover:from-primary-fixed-dim/30 hover:to-primary-fixed-dim/10 transition-all duration-300 active:scale-95 shrink-0 shadow-[0_0_20px_rgba(0,218,243,0.1)] hover:shadow-[0_0_30px_rgba(0,218,243,0.2)]"
            >
              <div className="w-10 h-10 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center mb-0.5 group-hover:scale-110 transition-transform duration-300">
                <Key className="w-5 h-5" />
              </div>
              <span className="font-display text-sm font-bold tracking-wide">Join Class</span>
              <span className="font-sans text-[11px] text-primary-fixed-dim/70">Enter class enrollment code</span>
            </button>
          </div>
        </div>

        {/* Enrolled courses */}
        <div className="mb-12">
          <h2 className="font-display text-2xl font-bold text-on-surface mb-6 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-primary-fixed-dim" />
            Enrolled
          </h2>
          {enrolledCourses.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {enrolledCourses.map((course) => (
                <CourseCard key={course.id} course={course} onEnroll={handleEnroll} />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 font-sans border border-dashed border-white/10 rounded-2xl bg-surface-container/10">
              You are not enrolled in any classes yet. Join a class or enroll below.
            </div>
          )}
        </div>
      </main>

      {/* Join code modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md flex flex-col rounded-2xl border border-white/10 bg-surface-container overflow-hidden p-6 shadow-[0_0_40px_rgba(0,218,243,0.1)]">
            <button
              onClick={() => {
                setShowJoinModal(false);
                setJoinError('');
                setJoinCode('');
              }}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 text-primary-fixed-dim">
                <Key className="w-5 h-5" />
              </div>
              <h2 className="font-display text-xl font-bold text-on-surface">Join Class</h2>
            </div>

            <p className="font-sans text-sm text-slate-400 mb-6 leading-relaxed">
              Enter the class link or class code provided by your educator to enroll in their course stream.
            </p>

            <input
              type="text"
              placeholder="e.g. BIO-301 or https://learnsync.ai/join/bio-301"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                setJoinError('');
              }}
              className="w-full bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 font-sans text-on-surface placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 mb-2"
            />
            {joinError && <p className="text-rose-400 text-xs font-sans mb-4">{joinError}</p>}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinError('');
                  setJoinCode('');
                }}
                className="flex-1 py-3 rounded-xl border border-white/10 font-display font-semibold text-sm text-slate-300 hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const rawInput = joinCode.trim();
                  let cleanedCode = rawInput;

                  if (rawInput.includes('/') || rawInput.includes('.')) {
                    try {
                      const urlParts = rawInput.split('/').filter(Boolean);
                      cleanedCode = urlParts[urlParts.length - 1] || rawInput;
                    } catch (e) {
                      cleanedCode = rawInput;
                    }
                  }

                  cleanedCode = cleanedCode.toUpperCase();

                  if (cleanedCode.length < 3) {
                    setJoinError('Please enter a valid class code or link.');
                  } else {
                    // Find matching course
                    const match = courses.find(
                      (c) => c.id.toUpperCase() === cleanedCode ||
                        c.id.replace(/-/g, '').toUpperCase() === cleanedCode.replace(/-/g, '')
                    );
                    if (match) {
                      handleEnroll(match.id);
                      setShowJoinModal(false);
                      setJoinCode('');
                      navigate(`/student/course/${match.id}`);
                    } else {
                      setJoinError('Class not found. Please verify the link or code with your educator.');
                    }
                  }
                }}
                className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-display font-semibold text-sm hover:bg-primary-container transition-all active:scale-95"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
