import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PlusCircle, Calendar, ListOrdered, Rocket, Edit3, MoreVertical, Lock, Clock, Shield, FileCheck, Eye } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById, addAssessment, gradeSubmission, type Assessment } from '../../../data/mockEducatorData';
import CreateAssessmentModal from './components/CreateAssessmentModal';
import GradeStudentModal from './components/GradeStudentModal';

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft: { label: 'Draft', dot: 'bg-slate-400', bg: 'bg-surface-bright', text: 'text-slate-300', border: 'border-white/10' },
  ready: { label: 'Ready', dot: 'bg-primary-fixed-dim shadow-[0_0_5px_rgba(0,218,243,0.5)]', bg: 'bg-primary-fixed-dim/20', text: 'text-primary-fixed-dim', border: 'border-primary-fixed-dim/30' },
  deployed: { label: 'Deployed', dot: 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]', bg: 'bg-emerald-400/20', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  closed: { label: 'Closed', dot: 'bg-slate-500', bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
};
const diffColor: Record<string, string> = { easy: 'text-emerald-400', medium: 'text-amber-400', hard: 'text-red-400' };

export default function CourseAssessments() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [gradingSubmission, setGradingSubmission] = useState<{ assessment: Assessment; submissionIdx: number } | null>(null);

  const [localAssessments, setLocalAssessments] = useState<Assessment[]>([...(course?.assessments || [])]);
  const assessments = localAssessments.filter(a => filter === 'all' || a.status === filter) || [];

  return (
    <CourseLayout>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-2">
          {['all', 'draft', 'ready', 'deployed', 'closed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border ${filter === f
                ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
              }`}>{f}</button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="shrink-0 px-5 py-2.5 bg-primary-container text-on-primary-container rounded-lg font-display text-sm font-semibold hover:bg-primary-fixed transition-all flex items-center gap-2 active:scale-95">
          <PlusCircle className="w-4 h-4" /> Create Assessment
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {assessments.map(a => {
          const st = statusConfig[a.status];
          const needsGrading = a.submissions.filter(s => s.status === 'needs-review').length;
          const submitted = a.submissions.length;
          return (
            <article key={a.id} className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-white/20 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
              <div>
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${st.bg} ${st.text} font-sans font-semibold text-[11px] border ${st.border} uppercase tracking-[0.1em]`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {a.isLockdown && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-rose-400/10 text-rose-400 font-sans text-[9px] font-semibold uppercase border border-rose-400/20">
                        <Shield className="w-3 h-3" /> Lockdown
                      </span>
                    )}
                    <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <h3 className="font-display text-xl font-semibold text-on-surface mb-2 group-hover:text-white transition-colors relative z-10">{a.title}</h3>
                <p className="font-sans text-sm text-on-surface-variant mb-5 line-clamp-2 relative z-10">{a.description}</p>
                <div className="flex flex-col gap-2 mb-5 relative z-10">
                  {a.deadline && (
                    <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                      <Calendar className="w-4 h-4 text-primary-fixed-dim" />
                      <span>Deadline: {a.deadline}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                    <ListOrdered className="w-4 h-4 text-primary-fixed-dim" />
                    <span>{a.questionCount} Questions · {a.duration} min</span>
                  </div>
                  <div className="flex items-center gap-3 font-sans text-sm">
                    <Clock className="w-4 h-4 text-primary-fixed-dim" />
                    <span className={diffColor[a.difficulty]}>Difficulty: <span className="capitalize font-semibold">{a.difficulty}</span></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto relative z-10">
                {a.status === 'deployed' || a.status === 'closed' ? (
                  <div className="flex items-center gap-3">
                    <span className="font-sans text-xs text-slate-400">
                      <FileCheck className="w-3.5 h-3.5 inline mr-1" />{submitted} submitted
                    </span>
                    {needsGrading > 0 && (
                      <span className="font-sans text-xs text-amber-400 font-semibold">{needsGrading} need grading</span>
                    )}
                  </div>
                ) : (
                  <div />
                )}

                <div className="flex gap-2">
                  {a.status === 'draft' && (
                    <button className="px-4 py-2 bg-white/5 text-on-surface hover:bg-white/10 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2 border border-white/10">
                      <Edit3 className="w-4 h-4" /> Edit
                    </button>
                  )}
                  {a.status === 'ready' && (
                    <button className="px-4 py-2 bg-transparent border border-primary-fixed-dim text-primary-fixed-dim hover:bg-primary-fixed-dim/10 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2">
                      <Rocket className="w-4 h-4" /> Deploy
                    </button>
                  )}
                  {needsGrading > 0 && (
                    <button onClick={() => {
                      const sub = a.submissions.findIndex(s => s.status === 'needs-review');
                      if (sub >= 0) setGradingSubmission({ assessment: a, submissionIdx: sub });
                    }}
                      className="px-4 py-2 bg-amber-400/10 border border-amber-400/20 text-amber-400 hover:bg-amber-400/20 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2">
                      <Eye className="w-4 h-4" /> Grade
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {assessments.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl mt-4">
          <p className="text-slate-400 font-sans">No assessments found.</p>
        </div>
      )}

      <CreateAssessmentModal isOpen={showCreate} onClose={() => setShowCreate(false)} courseResources={course?.resources.map(r => r.name) || []} onCreate={(data) => {
        if (courseId) {
          addAssessment(courseId, data);
          setLocalAssessments([...(course?.assessments || [])]);
        }
      }} />
      {gradingSubmission && (
        <GradeStudentModal
          isOpen={true}
          onClose={() => setGradingSubmission(null)}
          assessment={gradingSubmission.assessment}
          submission={gradingSubmission.assessment.submissions[gradingSubmission.submissionIdx]}
          onSubmit={(submissionId, manualScore) => {
            if (courseId) {
              gradeSubmission(courseId, gradingSubmission.assessment.id, submissionId, manualScore);
              setLocalAssessments([...(course?.assessments || [])]);
            }
          }}
        />
      )}
    </CourseLayout>
  );
}
