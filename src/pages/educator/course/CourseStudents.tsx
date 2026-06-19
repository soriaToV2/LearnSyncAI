import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserMinus, Search } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById, type EnrolledStudent } from '../../../data/mockEducatorData';

export default function CourseStudents() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [localStudents, setLocalStudents] = useState<EnrolledStudent[]>([...(course?.students || [])]);
  const [searchQuery, setSearchQuery] = useState('');
  const [studentToKick, setStudentToKick] = useState<EnrolledStudent | null>(null);

  const confirmKick = () => {
    if (!studentToKick) return;
    const studentId = studentToKick.id;
    if (course) {
      course.students = course.students.filter(s => s.id !== studentId);
      course.studentCount = course.students.length;
    }
    setLocalStudents(prev => prev.filter(s => s.id !== studentId));
    showToast(`${studentToKick.name} has been kicked from the course.`);
    window.dispatchEvent(new CustomEvent('learnSyncAI_courseUpdated'));
    setStudentToKick(null);
  };

  const filteredStudents = localStudents.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <CourseLayout>
      <div className="space-y-6">
        {/* Header row with Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-bold text-white tracking-tight">Students</h3>
            <p className="font-sans text-xs text-slate-400 mt-1">Manage and monitor students enrolled in this course.</p>
          </div>

          <div className="relative w-full sm:w-72 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search students by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl font-sans text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Student Rows */}
        <div className="space-y-3">
          {filteredStudents.map(s => {
            return (
              <div key={s.id} className="rounded-xl glass-card border border-white/5 hover:border-white/10 bg-white/[0.01] transition-all overflow-hidden animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4.5 gap-4">
                  <div className="flex items-center gap-4">
                    {s.avatar ? (
                      <img src={s.avatar} alt={s.name} className="w-12 h-12 rounded-full object-cover border-2 border-white/5 shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-slate-300 font-display text-lg font-semibold border-2 border-white/5 shrink-0">
                        {s.name.split(' ').map(n => n[0]).join('')}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-display text-base text-white font-semibold truncate">{s.name}</h3>
                      <p className="font-sans text-xs text-slate-400 mt-0.5 truncate">{s.email} · Joined {s.joinedAt}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      onClick={() => setStudentToKick(s)}
                      className="w-full sm:w-auto px-4.5 py-2.5 rounded-xl border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:bg-rose-500/10 active:scale-[0.98] transition-all font-sans text-xs flex items-center justify-center gap-2 font-bold uppercase tracking-wider"
                    >
                      <UserMinus className="w-3.5 h-3.5" /> Kick Student
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredStudents.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans font-medium">
              {searchQuery ? 'No matching students found.' : 'No students enrolled in this course.'}
            </p>
          </div>
        )}
      </div>

      {/* Kick Confirmation Modal */}
      {studentToKick && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-card w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-6 text-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <UserMinus className="w-5 h-5" />
            </div>
            
            <div className="space-y-2">
              <h4 className="font-display text-lg font-bold text-white tracking-tight">Remove Student?</h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Are you sure you want to remove <span className="text-white font-semibold">{studentToKick.name}</span> from this course? This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setStudentToKick(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmKick}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-bold uppercase transition-all shadow-lg shadow-rose-600/20"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </CourseLayout>
  );
}

function showToast(msg: string) {
  const ev = new CustomEvent('learnSyncAI_toast', { detail: msg });
  window.dispatchEvent(ev);
}
