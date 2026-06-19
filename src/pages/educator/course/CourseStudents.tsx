import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserMinus } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById, type EnrolledStudent } from '../../../data/mockEducatorData';

export default function CourseStudents() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [localStudents, setLocalStudents] = useState<EnrolledStudent[]>([...(course?.students || [])]);

  const handleKick = (studentId: string) => {
    const student = localStudents.find(s => s.id === studentId);
    if (!student) return;
    
    if (window.confirm(`Are you sure you want to remove ${student.name} from this course?`)) {
      if (course) {
        course.students = course.students.filter(s => s.id !== studentId);
        course.studentCount = course.students.length;
      }
      setLocalStudents(prev => prev.filter(s => s.id !== studentId));
      showToast(`${student.name} has been kicked from the course.`);
      window.dispatchEvent(new CustomEvent('learnSyncAI_courseUpdated'));
    }
  };

  return (
    <CourseLayout>
      <div className="space-y-6">

        {/* Student Rows */}
        <div className="space-y-3">
          {localStudents.map(s => {
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
                      onClick={() => handleKick(s.id)}
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

        {localStudents.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans font-medium">No students enrolled in this course.</p>
          </div>
        )}
      </div>
    </CourseLayout>
  );
}

function showToast(msg: string) {
  const ev = new CustomEvent('learnSyncAI_toast', { detail: msg });
  window.dispatchEvent(ev);
}
