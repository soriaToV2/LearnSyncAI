import { useState } from 'react';
import {
  X, CheckCircle2, XCircle, AlertCircle, Send, User, Clock,
  ChevronDown, ChevronUp, Award, BarChart2, FileText,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Assessment, Submission } from '../../../../data/mockEducatorData';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  assessment: Assessment;
  submission: Submission;
  onSubmit: (submissionId: string, manualScore: number, feedback: string) => void;
}

function Avatar({ name, src }: { name: string; src: string }) {
  return src ? (
    <img src={src} alt={name} className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-xs font-bold text-white border border-white/10 shrink-0">
      {name.split(' ').map(n => n[0]).join('')}
    </div>
  );
}

export default function GradeStudentModal({ isOpen, onClose, assessment, submission, onSubmit }: Props) {
  const essayQuestions = assessment.questions.filter(q => q.type === 'essay');
  const autoQuestions  = assessment.questions.filter(q => q.type !== 'essay');

  const [scores, setScores]   = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    auto: true,
    essay: true,
    answers: false,
  });

  if (!isOpen) return null;

  const manualTotal = essayQuestions.reduce((sum, q) => sum + (scores[q.id] ?? 0), 0);
  const essayMax    = essayQuestions.reduce((sum, q) => sum + q.points, 0);
  const finalTotal  = submission.autoScore + manualTotal;
  const pct         = Math.round((finalTotal / submission.maxScore) * 100);

  const getStudentAnswer = (qId: string) =>
    submission.answers.find(a => a.questionId === qId)?.answer || '';

  const isAlreadyGraded = submission.status === 'graded';
  const scoreColor = pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-primary-fixed-dim' : pct >= 60 ? 'text-amber-400' : 'text-red-400';
  const barColor   = pct >= 90 ? 'bg-emerald-400' : pct >= 75 ? 'bg-primary-fixed-dim' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';

  const toggle = (key: string) =>
    setExpandedSections(p => ({ ...p, [key]: !p[key] }));

  const handleSubmit = () => {
    onSubmit(submission.studentId, manualTotal, feedback);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={submission.studentName} src={submission.studentAvatar} />
              <div>
                <h2 className="font-display text-lg font-semibold text-white">{submission.studentName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <FileText className="w-3 h-3 text-slate-500" />
                  <p className="font-sans text-xs text-slate-400">{assessment.title}</p>
                  <span className="text-white/10">·</span>
                  <Clock className="w-3 h-3 text-slate-500" />
                  <p className="font-sans text-xs text-slate-400">Submitted {submission.submittedAt}</p>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Score bar */}
          <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Auto-Graded</p>
                  <p className="font-display text-xl font-bold text-emerald-400">{submission.autoScore}</p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Manual</p>
                  <p className="font-display text-xl font-bold text-amber-400">{manualTotal}</p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Total</p>
                  <p className={`font-display text-xl font-bold ${scoreColor}`}>
                    {finalTotal}<span className="text-sm text-slate-500">/{submission.maxScore}</span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-display text-3xl font-bold ${scoreColor}`}>{pct}%</p>
                <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Score</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar space-y-4">

          {/* ── Auto-graded section ── */}
          {autoQuestions.length > 0 && (
            <div className="bg-surface-container rounded-xl border border-white/5 overflow-hidden">
              <button
                onClick={() => toggle('auto')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-emerald-400" />
                  <p className="font-sans text-xs text-slate-300 font-semibold uppercase tracking-widest">
                    Auto-Graded Questions
                  </p>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 text-[10px] font-bold">
                    {autoQuestions.length}
                  </span>
                </div>
                {expandedSections.auto
                  ? <ChevronUp className="w-4 h-4 text-slate-500" />
                  : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {expandedSections.auto && (
                <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                  {autoQuestions.map((q, i) => {
                    const studentAns = getStudentAnswer(q.id);
                    const isCorrect = studentAns
                      ? (Array.isArray(q.correctAnswer)
                          ? q.correctAnswer.includes(studentAns)
                          : q.correctAnswer.toLowerCase() === studentAns.toLowerCase())
                      : false; // no answer = wrong
                    return (
                      <div key={q.id} className="rounded-lg bg-white/[0.03] border border-white/[0.04] overflow-hidden">
                        <div className="flex items-start gap-3 p-3">
                          {isCorrect
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-sans text-xs text-slate-400 mb-0.5">Q{i + 1} · <span className="capitalize">{q.type}</span></p>
                            <p className="font-sans text-sm text-white leading-snug">{q.question}</p>
                          </div>
                          <span className={`font-mono text-xs font-bold shrink-0 ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isCorrect ? q.points : 0}/{q.points}
                          </span>
                        </div>
                        {/* Show student answer vs correct */}
                        <div className="px-3 pb-3 pl-10 grid grid-cols-2 gap-2">
                          <div className="rounded-md bg-white/5 px-2 py-1.5">
                            <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Student</p>
                            <p className={`font-sans text-xs font-medium ${isCorrect ? 'text-emerald-300' : 'text-red-300'}`}>
                              {studentAns || <span className="text-slate-600 italic">No answer</span>}
                            </p>
                          </div>
                          <div className="rounded-md bg-emerald-400/5 border border-emerald-400/10 px-2 py-1.5">
                            <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Correct</p>
                            <p className="font-sans text-xs font-medium text-emerald-300">
                              {Array.isArray(q.correctAnswer) ? q.correctAnswer.join(' / ') : q.correctAnswer}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Essay / Manual grading ── */}
          {essayQuestions.length > 0 && (
            <div className="bg-surface-container rounded-xl border border-white/5 overflow-hidden">
              <button
                onClick={() => toggle('essay')}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <p className="font-sans text-xs text-amber-400 font-semibold uppercase tracking-widest">
                    Needs Manual Grading
                  </p>
                  <span className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[10px] font-bold">
                    {essayQuestions.length}
                  </span>
                </div>
                {expandedSections.essay
                  ? <ChevronUp className="w-4 h-4 text-slate-500" />
                  : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {expandedSections.essay && (
                <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
                  {essayQuestions.map((q, i) => (
                    <div key={q.id} className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/5">
                        <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-1">
                          Q{autoQuestions.length + i + 1} · Essay · {q.points} pts max
                        </p>
                        <p className="font-sans text-sm text-white font-medium">{q.question}</p>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div>
                          <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-2">Student's Answer</p>
                          <div className="p-3 rounded-lg bg-white/5 border border-white/5 min-h-[60px]">
                            <p className="font-sans text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                              {getStudentAnswer(q.id) || <span className="text-slate-600 italic">No answer provided.</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="shrink-0">
                            <label className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-1 block">Points</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number" min={0} max={q.points}
                                value={scores[q.id] ?? ''}
                                onChange={e => setScores(p => ({ ...p, [q.id]: Math.min(Number(e.target.value), q.points) }))}
                                className="w-20 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 text-center"
                                placeholder="0"
                              />
                              <span className="font-sans text-sm text-slate-500">/ {q.points}</span>
                            </div>
                          </div>
                          {/* Mini score bar */}
                          <div className="flex-1">
                            <label className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-1 block">Score</label>
                            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-all duration-300"
                                style={{ width: `${((scores[q.id] ?? 0) / q.points) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── No essays ── */}
          {essayQuestions.length === 0 && (
            <div className="text-center py-8 rounded-xl border border-emerald-400/10 bg-emerald-400/5">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="font-sans text-sm text-slate-300">All questions are auto-graded.</p>
              <p className="font-sans text-xs text-slate-500 mt-1">No manual review needed.</p>
            </div>
          )}

          {/* ── Overall feedback ── */}
          <div className="space-y-2">
            <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold block">
              Overall Feedback <span className="text-slate-600 normal-case">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Leave a comment for the student…"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none"
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {isAlreadyGraded ? (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-sans text-sm font-semibold">Already Graded — Score: {submission.totalScore}/{submission.maxScore}</span>
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={essayQuestions.some(q => scores[q.id] === undefined)}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" /> Submit Grades
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
