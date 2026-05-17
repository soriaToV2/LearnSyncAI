import { useState } from 'react';
import {
  X, Award, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Shield, Sparkles, AlertCircle, GraduationCap, Settings,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import type { EducatorCourse, EnrolledStudent } from '../../../../data/mockEducatorData';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  course: EducatorCourse;
  onIssueCertificate: (studentId: string) => void;
}

interface CriteriaCfg {
  minPassPct: number;         // minimum % score on each assessment
  requireAllAssessments: boolean; // must have submitted all deployed/closed assessments
  minAvgGrade: number;        // minimum average grade across all assessments
}

function Avatar({ name, src }: { name: string; src: string }) {
  return src
    ? <img src={src} alt={name} className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0" />
    : <div className="w-9 h-9 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-white border border-white/10 shrink-0">
        {name.split(' ').map(n => n[0]).join('')}
      </div>;
}

function CriterionRow({ met, label, detail }: { met: boolean; label: string; detail: string }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${met ? 'bg-emerald-400/5 border-emerald-400/10' : 'bg-red-400/5 border-red-400/10'}`}>
      {met
        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className={`font-sans text-xs font-semibold ${met ? 'text-emerald-300' : 'text-red-300'}`}>{label}</p>
        <p className="font-sans text-[11px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

export default function CertificationModal({ isOpen, onClose, course, onIssueCertificate }: Props) {
  const [criteria, setCriteria] = useState<CriteriaCfg>({
    minPassPct: 75,
    requireAllAssessments: true,
    minAvgGrade: 70,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [issuedIds, setIssuedIds] = useState<Set<string>>(new Set(
    course.students.filter(s => s.hasCertificate).map(s => s.id)
  ));

  if (!isOpen) return null;

  // All assessments that have been deployed or closed
  const activeAssessments = course.assessments.filter(a => a.status === 'deployed' || a.status === 'closed');

  /** Compute eligibility criteria for a single student */
  function checkStudent(student: EnrolledStudent) {
    const results: { label: string; detail: string; met: boolean }[] = [];

    // 1. All assessments submitted
    let allSubmitted = true;
    for (const assessment of activeAssessments) {
      const sub = assessment.submissions.find(s => s.studentId === student.id);
      if (!sub) { allSubmitted = false; break; }
    }
    if (criteria.requireAllAssessments) {
      results.push({
        label: 'All Assessments Submitted',
        detail: `${activeAssessments.filter(a => a.submissions.some(s => s.studentId === student.id)).length}/${activeAssessments.length} completed`,
        met: allSubmitted,
      });
    }

    // 2. Minimum pass % on each assessment
    let allPass = true;
    const failedAssessments: string[] = [];
    for (const assessment of activeAssessments) {
      const sub = assessment.submissions.find(s => s.studentId === student.id);
      if (!sub) { allPass = false; failedAssessments.push(assessment.title); continue; }
      const score = sub.totalScore ?? sub.autoScore;
      const pct = sub.maxScore > 0 ? Math.round((score / sub.maxScore) * 100) : 0;
      if (pct < criteria.minPassPct) { allPass = false; failedAssessments.push(assessment.title); }
    }
    results.push({
      label: `Min ${criteria.minPassPct}% on Each Assessment`,
      detail: failedAssessments.length === 0 ? 'All assessments passed' : `Failed: ${failedAssessments.slice(0, 2).join(', ')}${failedAssessments.length > 2 ? '…' : ''}`,
      met: allPass,
    });

    // 3. Minimum average grade
    const avgMet = student.averageGrade >= criteria.minAvgGrade;
    results.push({
      label: `Min Average Grade ${criteria.minAvgGrade}%`,
      detail: `Current average: ${student.averageGrade}%`,
      met: avgMet,
    });

    const eligible = results.every(r => r.met);
    return { eligible, results };
  }

  const studentEligibility = course.students.map(s => ({
    student: s,
    ...checkStudent(s),
  }));

  const eligible   = studentEligibility.filter(e => e.eligible);
  const ineligible = studentEligibility.filter(e => !e.eligible);

  const handleIssue = (studentId: string) => {
    onIssueCertificate(studentId);
    setIssuedIds(prev => new Set([...prev, studentId]));
  };

  const handleIssueAll = () => {
    eligible.forEach(e => {
      if (!issuedIds.has(e.student.id)) handleIssue(e.student.id);
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
                <GraduationCap className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Issue Certifications</h2>
                <p className="font-sans text-xs text-slate-400 mt-0.5 truncate max-w-xs">{course.title}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar space-y-5">

          {/* Criteria config */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <button
              onClick={() => setShowConfig(c => !c)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary-fixed-dim" />
                <p className="font-sans text-sm font-semibold text-white">Certification Criteria</p>
              </div>
              {showConfig
                ? <ChevronUp className="w-4 h-4 text-slate-500" />
                : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {showConfig && (
              <div className="px-4 pb-4 border-t border-white/5 space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1.5 block">
                      Min Pass Score (%)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={0} max={100} step={5}
                        value={criteria.minPassPct}
                        onChange={e => setCriteria(c => ({ ...c, minPassPct: Number(e.target.value) }))}
                        className="flex-1 accent-primary-fixed-dim"
                      />
                      <span className="font-mono text-sm text-primary-fixed-dim font-bold w-10 text-right">{criteria.minPassPct}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1.5 block">
                      Min Average Grade (%)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={0} max={100} step={5}
                        value={criteria.minAvgGrade}
                        onChange={e => setCriteria(c => ({ ...c, minAvgGrade: Number(e.target.value) }))}
                        className="flex-1 accent-primary-fixed-dim"
                      />
                      <span className="font-mono text-sm text-primary-fixed-dim font-bold w-10 text-right">{criteria.minAvgGrade}%</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setCriteria(c => ({ ...c, requireAllAssessments: !c.requireAllAssessments }))}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                    criteria.requireAllAssessments
                      ? 'border-primary-fixed-dim bg-primary-fixed-dim/10'
                      : 'border-white/10 bg-surface-container hover:border-white/20'
                  }`}
                >
                  <div className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-all ${criteria.requireAllAssessments ? 'bg-primary-fixed-dim justify-end' : 'bg-white/10 justify-start'}`}>
                    <div className="w-4 h-4 rounded-full bg-white shadow" />
                  </div>
                  <div>
                    <p className={`font-sans text-sm font-semibold ${criteria.requireAllAssessments ? 'text-primary-fixed' : 'text-white'}`}>
                      Require All Assessments Submitted
                    </p>
                    <p className="font-sans text-xs text-slate-400">Students must complete every deployed/closed assessment</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Summary badges */}
          <div className="flex gap-3">
            <div className="flex-1 p-3 rounded-xl bg-emerald-400/5 border border-emerald-400/10 text-center">
              <p className="font-display text-2xl font-bold text-emerald-400">{eligible.length}</p>
              <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest">Eligible</p>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-red-400/5 border border-red-400/10 text-center">
              <p className="font-display text-2xl font-bold text-red-400">{ineligible.length}</p>
              <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest">Not Eligible</p>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-amber-400/5 border border-amber-400/10 text-center">
              <p className="font-display text-2xl font-bold text-amber-400">{issuedIds.size}</p>
              <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest">Issued</p>
            </div>
          </div>

          {/* ── Eligible students ── */}
          {eligible.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Eligible Students
                </p>
                {eligible.some(e => !issuedIds.has(e.student.id)) && (
                  <button
                    onClick={handleIssueAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-bold hover:bg-amber-400/20 transition-all active:scale-95"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Issue All
                  </button>
                )}
              </div>
              {eligible.map(({ student, results }) => {
                const issued = issuedIds.has(student.id);
                const expanded = expandedStudentId === student.id;
                return (
                  <div key={student.id} className="rounded-xl border border-white/5 bg-surface-container overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      <Avatar name={student.name} src={student.avatar} />
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm font-semibold text-white">{student.name}</p>
                        <p className="font-sans text-xs text-slate-400">Avg grade: {student.averageGrade}%</p>
                      </div>
                      <button
                        onClick={() => setExpandedStudentId(expanded ? null : student.id)}
                        className="p-1.5 text-slate-500 hover:text-white transition-colors"
                      >
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {issued ? (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-xs font-bold">
                          <Shield className="w-3.5 h-3.5" /> Issued
                        </span>
                      ) : (
                        <button
                          onClick={() => handleIssue(student.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 text-black text-xs font-bold hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-amber-400/20"
                        >
                          <Award className="w-3.5 h-3.5" /> Issue
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 border-t border-white/5 pt-3 space-y-2">
                        {results.map((r, ri) => (
                          <div key={ri}>
                            <CriterionRow met={r.met} label={r.label} detail={r.detail} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Ineligible students ── */}
          {ineligible.length > 0 && (
            <div className="space-y-3">
              <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" /> Not Eligible
              </p>
              {ineligible.map(({ student, results }) => {
                const expanded = expandedStudentId === student.id;
                return (
                  <div key={student.id} className="rounded-xl border border-white/5 bg-surface-container overflow-hidden opacity-70">
                    <div className="flex items-center gap-3 p-3">
                      <Avatar name={student.name} src={student.avatar} />
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm font-semibold text-white">{student.name}</p>
                        <p className="font-sans text-xs text-red-400">{results.filter(r => !r.met).length} criteria not met</p>
                      </div>
                      <button
                        onClick={() => setExpandedStudentId(expanded ? null : student.id)}
                        className="p-1.5 text-slate-500 hover:text-white transition-colors"
                      >
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-500 text-xs font-bold">
                        <XCircle className="w-3.5 h-3.5" /> Ineligible
                      </span>
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 border-t border-white/5 pt-3 space-y-2">
                        {results.map((r, ri) => (
                          <div key={ri}>
                            <CriterionRow met={r.met} label={r.label} detail={r.detail} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* No students */}
          {course.students.length === 0 && (
            <div className="text-center py-14 border-2 border-dashed border-white/10 rounded-2xl">
              <GraduationCap className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="font-sans text-sm text-slate-500">No enrolled students found.</p>
            </div>
          )}

          {/* Certificate preview */}
          <div className="rounded-xl border border-white/10 p-5 bg-gradient-to-br from-white/[0.03] to-transparent text-center space-y-2">
            <Shield className="w-10 h-10 text-primary-fixed-dim mx-auto" />
            <p className="font-sans text-[10px] text-slate-500 uppercase tracking-[0.3em]">Certificate of Completion</p>
            <h3 className="font-display text-xl font-bold text-white">{course.title}</h3>
            <p className="font-sans text-xs text-slate-400">
              Awarded to eligible students who meet the configured criteria. Certificates appear in each student's profile achievement section.
            </p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 flex items-center justify-between">
          <p className="font-sans text-xs text-slate-500">
            {issuedIds.size} certificate{issuedIds.size !== 1 ? 's' : ''} issued
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-white/5 border border-white/10 text-slate-300 rounded-xl font-sans text-sm font-semibold hover:bg-white/10 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
