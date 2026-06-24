import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  PlusCircle, Calendar, ListOrdered, Rocket, Clock, Shield,
  FileCheck, ChevronDown, BookOpen, ArrowRight, CheckCircle2,
  XCircle, GraduationCap, Users, Grid, Plus,
} from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import {
  getCourseById, addAssessment, gradeSubmission,
  updateAssessmentStatus, updateAssessmentQuestions,
  type Assessment, type AssessmentStatus, type Question, type Submission,
} from '../../../data/mockEducatorData';
import CreateAssessmentModal from './components/CreateAssessmentModal';
import GradeStudentModal from './components/GradeStudentModal';
import ManageAssessmentModal from './components/ManageAssessmentModal';
import SubmissionsModal from './components/SubmissionsModal';
import SeatingGridModal from './components/SeatingGridModal';
import Modal from '../../../components/ui/Modal';

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft: { label: 'Draft', dot: 'bg-slate-400', bg: 'bg-surface-bright', text: 'text-slate-300', border: 'border-white/10' },
  ready: { label: 'Ready', dot: 'bg-primary-fixed-dim shadow-[0_0_5px_rgba(0,218,243,0.5)]', bg: 'bg-primary-fixed-dim/20', text: 'text-primary-fixed-dim', border: 'border-primary-fixed-dim/30' },
  deployed: { label: 'Deployed', dot: 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]', bg: 'bg-emerald-400/20', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  closed: { label: 'Closed', dot: 'bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]', bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
};

const STATUS_FLOW: AssessmentStatus[] = ['draft', 'ready', 'deployed', 'closed'];
const STATUS_ACTIONS: Record<string, { label: string; icon: typeof Rocket; color: string }> = {
  draft: { label: 'Mark as Ready', icon: CheckCircle2, color: 'text-primary-fixed-dim border-primary-fixed-dim/40 hover:bg-primary-fixed-dim/10' },
  ready: { label: 'Deploy', icon: Rocket, color: 'text-emerald-400 border-emerald-400/40 hover:bg-emerald-400/10' },
  deployed: { label: 'Close Assessment', icon: XCircle, color: 'text-slate-400 border-slate-400/40 hover:bg-slate-400/10' },
  closed: { label: 'Reopen as Ready', icon: ArrowRight, color: 'text-amber-400 border-amber-400/40 hover:bg-amber-400/10' },
};
const DIFF_COLOR: Record<string, string> = { easy: 'text-emerald-400', medium: 'text-amber-400', hard: 'text-red-400' };

function StatusDropdown({ current, onChange }: { current: AssessmentStatus; onChange: (s: AssessmentStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const st = STATUS_CONFIG[current];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${st.bg} ${st.text} font-sans font-semibold text-[11px] border ${st.border} uppercase tracking-[0.1em] hover:opacity-80 transition-opacity`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
        {st.label}
        <ChevronDown className={`w-3 h-3 ml-0.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 rounded-xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden min-w-[140px] isolate transform translate-z-0 backdrop-blur-none"
          style={{ backgroundColor: 'var(--color-surface-container-high)' }}
        >
          {STATUS_FLOW.map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors ${s === current ? 'bg-white/5' : ''}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                <span className={`font-sans text-xs font-semibold uppercase tracking-wider ${s === current ? cfg.text : 'text-slate-300'}`}>{cfg.label}</span>
                {s === current && <span className="ml-auto text-[10px] text-slate-500">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CourseAssessments() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [managingAssessment, setManagingAssessment] = useState<Assessment | null>(null);
  const [viewingSubmissions, setViewingSubmissions] = useState<Assessment | null>(null);
  const [gradingSubmission, setGradingSubmission] = useState<{ assessment: Assessment; submission: Submission } | null>(null);
  const [seatingAssessment, setSeatingAssessment] = useState<Assessment | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    assessmentId: string; newStatus: AssessmentStatus; title: string;
  } | null>(null);

  useEffect(() => {
    const handleCustomToast = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg) showToast(msg);
    };
    window.addEventListener('learnSyncAI_toast', handleCustomToast);
    return () => window.removeEventListener('learnSyncAI_toast', handleCustomToast);
  }, []);

  const [localAssessments, setLocalAssessments] = useState<Assessment[]>([...(course?.assessments || [])]);
  const refresh = () => setLocalAssessments([...(course?.assessments || [])]);

  useEffect(() => {
    setLocalAssessments([...(course?.assessments || [])]);
  }, [courseId, course]);

  const filtered = localAssessments.filter(a => filter === 'all' || a.status === filter);

  // Toast
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Status change with confirm
  const requestStatusChange = (assessmentId: string, status: AssessmentStatus, title: string) => {
    setConfirmDialog({ assessmentId, newStatus: status, title });
  };
  const executeStatusChange = () => {
    if (!courseId || !confirmDialog) return;
    updateAssessmentStatus(courseId, confirmDialog.assessmentId, confirmDialog.newStatus);
    refresh();
    showToast(`"${confirmDialog.title}" status updated to ${STATUS_CONFIG[confirmDialog.newStatus].label}.`);
    setConfirmDialog(null);
  };

  // Questions
  const handleQuestionsSave = (assessmentId: string, questions: Question[]) => {
    if (!courseId) return;
    updateAssessmentQuestions(courseId, assessmentId, questions);
    refresh();
  };

  // Status advance
  const advanceStatus = (a: Assessment) => {
    const idx = STATUS_FLOW.indexOf(a.status);
    const next: AssessmentStatus = a.status === 'closed' ? 'ready' : STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)];
    requestStatusChange(a.id, next, a.title);
  };

  // Grading
  const handleGradeSubmission = (assessmentId: string, submissionId: string, manualScore: number, feedback: string) => {
    if (!courseId) return;
    gradeSubmission(courseId, assessmentId, submissionId, manualScore);
    refresh();
    showToast('Grades submitted successfully!');
  };

  // When GradeStudentModal opens from SubmissionsModal, keep viewingSubmissions open
  const openGradeFromSubmissions = (assessment: Assessment, submission: Submission) => {
    setGradingSubmission({ assessment, submission });
  };

  return (
    <CourseLayout>

      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4">
          <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-sans font-medium text-sm">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <Modal
          isOpen={!!confirmDialog}
          onClose={() => setConfirmDialog(null)}
          title="Change Status?"
          maxWidth="max-w-sm"
        >
          <div className="space-y-6 text-center">
            {/* Status-specific Icon */}
            {(() => {
              const status = confirmDialog.newStatus;
              let IconComponent = Shield;
              let iconColorClass = "text-primary-fixed-dim";
              let iconBgClass = "bg-primary-fixed-dim/10 border-primary-fixed-dim/20";
              
              if (status === 'deployed') {
                IconComponent = Rocket;
                iconColorClass = "text-emerald-400";
                iconBgClass = "bg-emerald-500/10 border-emerald-500/20";
              } else if (status === 'ready') {
                IconComponent = CheckCircle2;
                iconColorClass = "text-primary-fixed-dim";
                iconBgClass = "bg-primary-fixed-dim/10 border-primary-fixed-dim/20";
              } else if (status === 'closed') {
                IconComponent = XCircle;
                iconColorClass = "text-rose-400";
                iconBgClass = "bg-rose-500/10 border-rose-500/20";
              } else if (status === 'draft') {
                IconComponent = Clock;
                iconColorClass = "text-slate-400";
                iconBgClass = "bg-slate-500/10 border-slate-500/20";
              }
              
              return (
                <div className={`w-12 h-12 rounded-full border flex items-center justify-center mx-auto ${iconBgClass} ${iconColorClass}`}>
                  <IconComponent className="w-5 h-5" />
                </div>
              );
            })()}

            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Are you sure you want to update <span className="text-white font-semibold">"{confirmDialog.title}"</span> to <span className="text-white font-semibold uppercase tracking-wider">{STATUS_CONFIG[confirmDialog.newStatus].label}</span>?
            </p>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeStatusChange}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-fixed-dim hover:bg-primary-fixed-dim/80 text-on-primary-fixed font-sans text-xs font-bold uppercase transition-all shadow-lg shadow-primary-fixed-dim/20"
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Toolbar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap w-full sm:w-auto">
          {['all', 'draft', 'ready', 'deployed', 'closed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border ${filter === f
                ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
                }`}>{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={() => setShowCreate(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-display text-sm font-semibold hover:bg-primary-container transition-all active:scale-95">
            <Plus className="w-4 h-4" /> Create Assessment
          </button>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filtered.map(a => {
          const needsGrading = a.submissions.filter(s => s.status === 'needs-review').length;
          const submitted = a.submissions.length;
          const graded = a.submissions.filter(s => s.status === 'graded').length;
          const action = STATUS_ACTIONS[a.status];
          const ActionIcon = action.icon;
          const hasSubmissions = submitted > 0;

          return (
            <article key={a.id}
              className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-white/20 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />

              <div>
                {/* Status + type badges */}
                <div className="flex justify-between items-start mb-4 relative z-20">
                  <StatusDropdown
                    current={a.status}
                    onChange={s => requestStatusChange(a.id, s, a.title)}
                  />
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-slate-400 font-sans text-[9px] font-semibold uppercase border border-white/10 capitalize">
                      {a.type}
                    </span>
                  </div>
                </div>

                {/* Title & description */}
                <h3 className="font-display text-xl font-semibold text-on-surface mb-2 group-hover:text-white transition-colors relative z-10">
                  {a.title}
                </h3>
                <p className="font-sans text-sm text-on-surface-variant mb-5 line-clamp-2 relative z-10">{a.description}</p>

                {/* Meta */}
                <div className="flex flex-col gap-2 mb-5 relative z-10">
                  {a.deadline && (
                    <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                      <Calendar className="w-4 h-4 text-primary-fixed-dim" />
                      <span>Start Time: {a.deadline}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                    <ListOrdered className="w-4 h-4 text-primary-fixed-dim" />
                    <span>{a.questionCount} Questions · {a.duration} min</span>
                  </div>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex flex-col gap-3 pt-4 border-t border-white/5 mt-auto relative z-10">
                {hasSubmissions && (
                  <button
                    onClick={() => setViewingSubmissions(a)}
                    className="flex items-center gap-1.5 text-xs font-sans text-slate-400 hover:text-white transition-colors self-start"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{graded}/{submitted} graded</span>
                    {needsGrading > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-semibold text-[10px]">
                        {needsGrading} pending
                      </span>
                    )}
                    <FileCheck className="w-3 h-3 ml-1 opacity-50" />
                  </button>
                )}

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                  {/* Manage Questions — for draft/ready */}
                  {(a.status === 'draft' || a.status === 'ready') && (
                    <button
                      onClick={() => setManagingAssessment(a)}
                      className="flex-1 px-3 py-2 bg-white/5 text-on-surface hover:bg-white/10 rounded-lg font-display text-sm font-medium transition-all flex items-center justify-center gap-2 border border-white/10"
                    >
                      <BookOpen className="w-4 h-4 shrink-0" /> <span className="truncate">Questions</span>
                    </button>
                  )}

                  {/* Seating Layout — for draft/ready/deployed */}
                  {(a.status === 'draft' || a.status === 'ready' || a.status === 'deployed') && (
                    <button
                      onClick={() => setSeatingAssessment(a)}
                      className="flex-1 px-3 py-2 bg-white/5 text-on-surface hover:bg-white/10 rounded-lg font-display text-sm font-medium transition-all flex items-center justify-center gap-2 border border-white/10"
                      title="Manage Seating & Attendance Grid"
                    >
                      <Grid className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Seating</span>
                    </button>
                  )}

                  {/* Submissions — for deployed / closed (with submissions) */}
                  {(a.status === 'deployed' || a.status === 'closed') && hasSubmissions && (
                    <button
                      onClick={() => setViewingSubmissions(a)}
                      className={`flex-1 px-3 py-2 rounded-lg font-display text-sm font-medium transition-all flex items-center justify-center gap-2 border ${needsGrading > 0
                        ? 'bg-amber-400/10 border-amber-400/20 text-amber-400 hover:bg-amber-400/20'
                        : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                    >
                      <Users className="w-4 h-4 shrink-0" />
                      <span className="truncate">{needsGrading > 0 ? `Grade (${needsGrading})` : 'Submissions'}</span>
                    </button>
                  )}

                  {/* Status advance */}
                  <button
                    onClick={() => advanceStatus(a)}
                    className={`flex-1 px-3 py-2 rounded-lg font-display text-sm font-medium transition-all flex items-center justify-center gap-2 border ${action.color}`}
                  >
                    <ActionIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{action.label}</span>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl mt-4">
          <p className="text-slate-400 font-sans">No assessments found.</p>
        </div>
      )}

      {/* Create modal */}
      <CreateAssessmentModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        courseResources={course?.resources.map(r => r.name) || []}
        onCreate={data => {
          if (courseId) { addAssessment(courseId, data); refresh(); showToast('Assessment created!'); }
        }}
      />

      {/* Manage Questions */}
      {managingAssessment && (
        <ManageAssessmentModal
          isOpen={true}
          onClose={() => setManagingAssessment(null)}
          assessmentTitle={managingAssessment.title}
          questions={managingAssessment.questions}
          onSave={(questions, saveMode) => {
            handleQuestionsSave(managingAssessment.id, questions);
            if (saveMode === 'ready') {
              updateAssessmentStatus(courseId!, managingAssessment.id, 'ready');
              showToast('Questions saved and assessment marked as Ready!');
            } else {
              showToast('Questions saved successfully!');
            }
            refresh();
            setManagingAssessment(null);
          }}
        />
      )}

      {/* Submissions list */}
      {viewingSubmissions && (
        <SubmissionsModal
          isOpen={true}
          onClose={() => setViewingSubmissions(null)}
          assessment={viewingSubmissions}
          onGrade={sub => openGradeFromSubmissions(viewingSubmissions, sub)}
        />
      )}

      {/* Seating & Attendance Grid */}
      {seatingAssessment && (
        <SeatingGridModal
          isOpen={true}
          onClose={() => setSeatingAssessment(null)}
          courseId={courseId || ''}
          students={course?.students || []}
          assessment={seatingAssessment}
          onDeploy={() => {
            if (courseId) {
              updateAssessmentStatus(courseId, seatingAssessment.id, 'deployed');
              refresh();
              showToast(`"${seatingAssessment.title}" has been deployed successfully!`);
            }
          }}
        />
      )}

      {/* Grade individual student */}
      {gradingSubmission && (
        <GradeStudentModal
          isOpen={true}
          onClose={() => setGradingSubmission(null)}
          assessment={gradingSubmission.assessment}
          submission={gradingSubmission.submission}
          onSubmit={(submissionId, manualScore, feedback) => {
            handleGradeSubmission(gradingSubmission.assessment.id, submissionId, manualScore, feedback);
            setGradingSubmission(null);
            const updated = getCourseById(courseId || '')?.assessments.find(a => a.id === gradingSubmission.assessment.id);
            if (updated) setViewingSubmissions(updated);
          }}
        />
      )}
    </CourseLayout>
  );
}
