import { useState } from 'react';
import { X, CheckCircle2, XCircle, AlertCircle, Send } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Assessment, Submission } from '../../../../data/mockEducatorData';

interface Props {
  isOpen: boolean; onClose: () => void;
  assessment: Assessment; submission: Submission;
  onSubmit: (submissionId: string, manualScore: number) => void;
}

export default function GradeStudentModal({ isOpen, onClose, assessment, submission, onSubmit }: Props) {
  const essayQuestions = assessment.questions.filter(q => q.type === 'essay');
  const autoQuestions = assessment.questions.filter(q => q.type !== 'essay');

  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const manualTotal = (Object.values(scores) as number[]).reduce((a, b) => a + b, 0);
  const finalTotal = submission.autoScore + manualTotal;

  const handleSubmit = () => {
    onSubmit(submission.studentId, manualTotal);
    onClose();
  };

  // Find student answer for essay questions
  const getStudentAnswer = (qId: string) => {
    return submission.answers.find(a => a.questionId === qId)?.answer || 'No answer provided.';
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {submission.studentAvatar ? (
                <img src={submission.studentAvatar} alt={submission.studentName} className="w-10 h-10 rounded-full object-cover border border-white/10" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-xs font-bold text-white border border-white/10">
                  {submission.studentName.split(' ').map(n => n[0]).join('')}
                </div>
              )}
              <div>
                <h2 className="font-display text-lg font-semibold text-white">{submission.studentName}</h2>
                <p className="font-sans text-xs text-slate-400">{assessment.title} · Submitted {submission.submittedAt}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Auto-score summary */}
          <div className="mt-3 flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/5">
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
              <p className="font-display text-xl font-bold text-white">{finalTotal}<span className="text-sm text-slate-500">/{submission.maxScore}</span></p>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          {/* Auto-graded questions summary */}
          {autoQuestions.length > 0 && (
            <div className="mb-6">
              <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3">Auto-Graded Questions</p>
              <div className="space-y-1.5">
                {autoQuestions.map((q, i) => (
                  <div key={q.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-sans text-sm text-slate-300 truncate max-w-[350px]">Q{i + 1}: {q.question}</span>
                    </div>
                    <span className="font-mono text-xs text-white font-semibold shrink-0">{q.points}/{q.points}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual grading section */}
          {essayQuestions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <p className="font-sans text-xs text-amber-400 uppercase tracking-widest font-semibold">Needs Manual Grading</p>
              </div>
              <div className="space-y-5">
                {essayQuestions.map((q, i) => (
                  <div key={q.id} className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden">
                    <div className="p-4 border-b border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-sans text-xs text-slate-500">Question {autoQuestions.length + i + 1} · Essay · {q.points} pts</span>
                      </div>
                      <p className="font-sans text-sm text-white font-medium">{q.question}</p>
                    </div>
                    <div className="p-4 bg-white/[0.02]">
                      <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-2">Student's Answer</p>
                      <div className="p-3 rounded-lg bg-white/5 border border-white/5 mb-4">
                        <p className="font-sans text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{getStudentAnswer(q.id)}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <label className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-1 block">Points</label>
                          <div className="flex items-center gap-2">
                            <input type="number" min={0} max={q.points}
                              value={scores[q.id] || ''}
                              onChange={e => setScores(p => ({ ...p, [q.id]: Math.min(Number(e.target.value), q.points) }))}
                              className="w-20 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-mono text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 text-center"
                              placeholder="0" />
                            <span className="font-sans text-sm text-slate-500">/ {q.points}</span>
                          </div>
                        </div>
                        <div className="flex-[2]">
                          <label className="font-sans text-[10px] text-slate-500 uppercase tracking-widest mb-1 block">Feedback (optional)</label>
                          <input type="text"
                            value={feedbacks[q.id] || ''}
                            onChange={e => setFeedbacks(p => ({ ...p, [q.id]: e.target.value }))}
                            placeholder="Add a comment..."
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {essayQuestions.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="font-sans text-sm text-slate-300">All questions are auto-graded. No manual review needed.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 flex items-center justify-between">
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all">
            <Send className="w-4 h-4" /> Submit Grades
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
