import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  PlusCircle, Calendar, ListOrdered, Rocket, Clock, Shield,
  FileCheck, ChevronDown, BookOpen, ArrowRight, CheckCircle2,
  XCircle, GraduationCap, Users,
} from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import {
  getCourseById, addAssessment, gradeSubmission,
  updateAssessmentStatus, updateAssessmentQuestions, issueCertificate,
  type Assessment, type AssessmentStatus, type Question, type Submission,
} from '../../../data/mockEducatorData';
import CreateAssessmentModal from './components/CreateAssessmentModal';
import GradeStudentModal from './components/GradeStudentModal';
import ManageAssessmentModal from './components/ManageAssessmentModal';
import SubmissionsModal from './components/SubmissionsModal';
import CertificationModal from './components/CertificationModal';

// ─── Status config ──────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft:    { label: 'Draft',    dot: 'bg-slate-400',                                              bg: 'bg-surface-bright',        text: 'text-slate-300',         border: 'border-white/10' },
  ready:    { label: 'Ready',    dot: 'bg-primary-fixed-dim shadow-[0_0_5px_rgba(0,218,243,0.5)]', bg: 'bg-primary-fixed-dim/20',  text: 'text-primary-fixed-dim', border: 'border-primary-fixed-dim/30' },
  deployed: { label: 'Deployed', dot: 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]',     bg: 'bg-emerald-400/20',        text: 'text-emerald-400',       border: 'border-emerald-400/30' },
  closed:   { label: 'Closed',   dot: 'bg-slate-500',                                              bg: 'bg-slate-500/10',          text: 'text-slate-400',         border: 'border-slate-500/20' },
};

const STATUS_FLOW: AssessmentStatus[] = ['draft', 'ready', 'deployed', 'closed'];
const STATUS_ACTIONS: Record<string, { label: string; icon: typeof Rocket; color: string }> = {
  draft:    { label: 'Mark as Ready',    icon: CheckCircle2, color: 'text-primary-fixed-dim border-primary-fixed-dim/40 hover:bg-primary-fixed-dim/10' },
  ready:    { label: 'Deploy',           icon: Rocket,       color: 'text-emerald-400 border-emerald-400/40 hover:bg-emerald-400/10' },
  deployed: { label: 'Close Assessment', icon: XCircle,      color: 'text-slate-400 border-slate-400/40 hover:bg-slate-400/10' },
  closed:   { label: 'Reopen as Ready',  icon: ArrowRight,   color: 'text-amber-400 border-amber-400/40 hover:bg-amber-400/10' },
};
const DIFF_COLOR: Record<string, string> = { easy: 'text-emerald-400', medium: 'text-amber-400', hard: 'text-red-400' };

// ─── Status dropdown ────────────────────────────────────────────────────────
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
        <div className="absolute top-full left-0 mt-1.5 z-30 bg-surface-container-high rounded-xl border border-white/10 shadow-2xl shadow-black/40 overflow-hidden min-w-[140px]">
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

// ─── Main component ─────────────────────────────────────────────────────────
export default function CourseAssessments() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');

  // State
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [managingAssessment, setManagingAssessment] = useState<Assessment | null>(null);
  const [viewingSubmissions, setViewingSubmissions] = useState<Assessment | null>(null);
  const [gradingSubmission, setGradingSubmission] = useState<{ assessment: Assessment; submission: Submission } | null>(null);
  const [showCertification, setShowCertification] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    assessmentId: string; newStatus: AssessmentStatus; title: string;
  } | null>(null);

  const [localAssessments, setLocalAssessments] = useState<Assessment[]>([...(course?.assessments || [])]);
  const refresh = () => setLocalAssessments([...(course?.assessments || [])]);

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

  // Status advance (1-click)
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

  // Certifications
  const handleIssueCertificate = (studentId: string) => {
    if (!courseId) return;
    issueCertificate(courseId, studentId);
    refresh();
    const student = course?.students.find(s => s.id === studentId);
    showToast(`Certificate issued to ${student?.name ?? 'student'}!`);
  };

  // When GradeStudentModal opens from SubmissionsModal, keep viewingSubmissions open
  const openGradeFromSubmissions = (assessment: Assessment, submission: Submission) => {
    setGradingSubmission({ assessment, submission });
  };

  return (
    <CourseLayout>

      {/* ── Toast ── */}
      {toastMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4">
          <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-sans font-medium text-sm">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setConfirmDialog(null)} />
          <div className="relative w-full max-w-md bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl p-6 animate-in zoom-in-95 duration-200">
            <h3 className="font-display text-lg font-semibold text-white mb-2">Change Assessment Status?</h3>
            <p className="font-sans text-sm text-slate-300 mb-6 leading-relaxed">
              Update <strong>"{confirmDialog.title}"</strong> to{' '}
              <span className="font-semibold text-primary-fixed-dim uppercase tracking-wider">
                {STATUS_CONFIG[confirmDialog.newStatus].label}
              </span>?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button onClick={executeStatusChange} className="px-5 py-2 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all active:scale-95">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-2 flex-wrap">
          {['all', 'draft', 'ready', 'deployed', 'closed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border ${filter === f
                ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/30'
                : 'text-slate-400 border-white/10 hover:text-white hover:border-white/20'
              }`}>{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Certify shortcut — always visible */}
          <button
            onClick={() => setShowCertification(true)}
            className="shrink-0 px-4 py-2.5 border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 rounded-lg font-display text-sm font-semibold transition-all flex items-center gap-2 active:scale-95"
          >
            <GraduationCap className="w-4 h-4" /> Certify Students
          </button>
          <button onClick={() => setShowCreate(true)}
            className="shrink-0 px-5 py-2.5 bg-primary-container text-on-primary-container rounded-lg font-display text-sm font-semibold hover:bg-primary-fixed transition-all flex items-center gap-2 active:scale-95">
            <PlusCircle className="w-4 h-4" /> Create Assessment
          </button>
        </div>
      </div>

      {/* ── Cards grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filtered.map(a => {
          const needsGrading = a.submissions.filter(s => s.status === 'needs-review').length;
          const submitted = a.submissions.length;
          const graded    = a.submissions.filter(s => s.status === 'graded').length;
          const action    = STATUS_ACTIONS[a.status];
          const ActionIcon = action.icon;
          const hasSubmissions = submitted > 0;

          return (
            <article key={a.id}
              className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-white/20 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />

              <div>
                {/* Status + type badges */}
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <StatusDropdown
                    current={a.status}
                    onChange={s => requestStatusChange(a.id, s, a.title)}
                  />
                  <div className="flex items-center gap-2">
                    {a.isLockdown && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-rose-400/10 text-rose-400 font-sans text-[9px] font-semibold uppercase border border-rose-400/20">
                        <Shield className="w-3 h-3" /> Lockdown
                      </span>
                    )}
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
                      <span>Deadline: {a.deadline}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                    <ListOrdered className="w-4 h-4 text-primary-fixed-dim" />
                    <span>{a.questionCount} Questions · {a.duration} min</span>
                  </div>
                  <div className="flex items-center gap-3 font-sans text-sm">
                    <Clock className="w-4 h-4 text-primary-fixed-dim" />
                    <span className={DIFF_COLOR[a.difficulty]}>
                      Difficulty: <span className="capitalize font-semibold">{a.difficulty}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Footer actions ── */}
              <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto relative z-10 gap-2 flex-wrap">

                {/* Submission summary chip */}
                {hasSubmissions ? (
                  <button
                    onClick={() => setViewingSubmissions(a)}
                    className="flex items-center gap-1.5 text-xs font-sans text-slate-400 hover:text-white transition-colors"
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
                ) : (
                  <div />
                )}

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  {/* Manage Questions — for draft/ready */}
                  {(a.status === 'draft' || a.status === 'ready') && (
                    <button
                      onClick={() => setManagingAssessment(a)}
                      className="px-3 py-2 bg-white/5 text-on-surface hover:bg-white/10 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2 border border-white/10"
                    >
                      <BookOpen className="w-4 h-4" /> Questions
                    </button>
                  )}

                  {/* Submissions — for deployed / closed (with submissions) */}
                  {(a.status === 'deployed' || a.status === 'closed') && hasSubmissions && (
                    <button
                      onClick={() => setViewingSubmissions(a)}
                      className={`px-3 py-2 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2 border ${
                        needsGrading > 0
                          ? 'bg-amber-400/10 border-amber-400/20 text-amber-400 hover:bg-amber-400/20'
                          : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      {needsGrading > 0 ? `Grade (${needsGrading})` : 'Submissions'}
                    </button>
                  )}

                  {/* Status advance */}
                  <button
                    onClick={() => advanceStatus(a)}
                    className={`px-3 py-2 rounded-lg font-display text-sm font-medium transition-all flex items-center gap-2 border ${action.color}`}
                  >
                    <ActionIcon className="w-4 h-4" />
                    {action.label}
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

      {/* ════ Modals ════ */}

      {/* Create */}
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
          onCertify={() => { setViewingSubmissions(null); setShowCertification(true); }}
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
            // re-open submissions panel with refreshed data
            const updated = getCourseById(courseId || '')?.assessments.find(a => a.id === gradingSubmission.assessment.id);
            if (updated) setViewingSubmissions(updated);
          }}
        />
      )}

      {/* Certifications */}
      {showCertification && course && (
        <CertificationModal
          isOpen={true}
          onClose={() => setShowCertification(false)}
          course={course}
          onIssueCertificate={handleIssueCertificate}
        />
      )}
    </CourseLayout>
  );
}
