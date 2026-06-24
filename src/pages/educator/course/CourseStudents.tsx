import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { UserMinus, Search, Loader2 } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';

export interface EnrolledStudent {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  joinedAt: string;
}

export default function CourseStudents() {
  const { courseId } = useParams();
  const [localStudents, setLocalStudents] = useState<EnrolledStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [studentToKick, setStudentToKick] = useState<EnrolledStudent | null>(null);

  useEffect(() => {
    async function fetchStudents() {
      if (!courseId) return;
      setIsLoading(true);
      try {
        const res = await api.get<{ data: any[] }>(`/courses/${courseId}/students`);
        const rawData = res.data;
        const data = Array.isArray(rawData?.data) ? rawData.data : (Array.isArray(rawData) ? rawData : []);
        
        const mapped = data.map((enrollment: any) => {
          const p = enrollment.profiles;
          return {
            id: p?.id || 'unknown',
            name: p ? `${p.first_name} ${p.last_name}` : 'Unknown Student',
            email: 'student@example.com', // Profiles doesn't expose email by default
            joinedAt: new Date(enrollment.enrolled_at || Date.now()).toLocaleDateString(),
          };
        });
        setLocalStudents(mapped);
      } catch (error) {
        console.error("Failed to load students:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchStudents();
  }, [courseId]);

  const [isKicking, setIsKicking] = useState(false);

  const confirmKick = async () => {
    if (!studentToKick || !courseId) return;
    const studentId = studentToKick.id;
    
    setIsKicking(true);
    try {
      await api.delete(`/courses/${courseId}/students/${studentId}`);
      // Optimistic UI update
      setLocalStudents(prev => prev.filter(s => s.id !== studentId));
      showToast(`${studentToKick.name} has been kicked from the course.`);
      setStudentToKick(null);
    } catch (error: any) {
      console.error("Failed to kick student:", error);
      showToast(`Failed to kick student: ${error.message || 'Unknown error'}`);
    } finally {
      setIsKicking(false);
    }
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
          {isLoading ? (
            <div className="flex justify-center items-center py-20 gap-3 text-slate-400 bg-surface-container/10 border border-white/5 rounded-2xl">
              <Loader2 className="w-6 h-6 animate-spin text-primary-fixed-dim" />
              <span className="font-sans text-sm">Loading students...</span>
            </div>
          ) : (
            filteredStudents.map(s => {
              return (
                <div key={s.id} className="rounded-xl glass-card border border-white/5 hover:border-white/10 bg-white/[0.01] transition-all overflow-hidden animate-in fade-in duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4.5 gap-4">
                    <div className="flex items-center gap-4">
                      {s.avatar ? (
                        <img src={s.avatar} alt={s.name} className="w-12 h-12 rounded-full object-cover border-2 border-white/5 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-slate-300 font-display text-lg font-semibold border-2 border-white/5 shrink-0 uppercase">
                          {s.name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-display text-base text-white font-semibold truncate">{s.name}</h3>
                        <p className="font-sans text-xs text-slate-400 mt-0.5 truncate">Joined {s.joinedAt}</p>
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
            })
          )}
        </div>

        {!isLoading && filteredStudents.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans font-medium">
              {searchQuery ? 'No matching students found.' : 'No students enrolled in this course.'}
            </p>
          </div>
        )}
      </div>

      {/* Kick Confirmation Modal */}
      <Modal
        isOpen={!!studentToKick}
        onClose={() => setStudentToKick(null)}
        title="Remove Student?"
        maxWidth="max-w-sm"
      >
        {studentToKick && (
          <div className="space-y-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <UserMinus className="w-5 h-5" />
            </div>
            
            <p className="font-sans text-sm text-slate-300 leading-relaxed">
              Are you sure you want to remove <span className="text-white font-semibold">{studentToKick.name}</span> from this course? This action cannot be undone.
            </p>

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
                disabled={isKicking}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-bold uppercase transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isKicking && <Loader2 className="w-4 h-4 animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        )}
      </Modal>
    </CourseLayout>
  );
}

function showToast(msg: string) {
  const ev = new CustomEvent('learnSyncAI_toast', { detail: msg });
  window.dispatchEvent(ev);
}
