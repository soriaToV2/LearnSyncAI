//ETO YUNG PAGE SA LOOB NG courses > select 1 enrolled course > this page will load

import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bell, ChevronRight, CheckCircle2, Box, PlayCircle, FileText, ArrowRight, Megaphone, Clock, Star, X, ClipboardList, HelpCircle, Award, AlertCircle, Lock, ShieldAlert, Timer, Check, Activity, Sparkles, LayoutGrid } from 'lucide-react';
import clsx from 'clsx';
import { MOCK_COURSES } from '../../data/mockCourses';

interface Resource {
  id: string;
  type: 'pdf' | 'video' | 'ar';
  title: string;
  meta: string;
  hasReviewed?: boolean;
  userRating?: number;
  userComment?: string;
}

const INITIAL_RESOURCES: Resource[] = [
  { id: '1', type: 'pdf', title: 'Synaptic Pathways Ch.4', meta: '2.4 MB • Required Reading' },
  { id: '2', type: 'video', title: 'Lecture: Neuroplasticity', meta: '45 mins • Video Lecture' },
  { id: '3', type: 'ar', title: 'Human Brain Model', meta: '.gltf Interactive' },
];

interface QuizQuestion {
  id: number;
  type: 'multiple-choice' | 'essay';
  questionText: string;
  options?: string[];
  correctAnswer?: string;
  studentAnswer?: string;
  points: number;
  maxPoints: number;
  feedback?: string;
}

interface Assessment {
  id: string;
  title: string;
  description: string;
  status: 'Pending' | 'Completed';
  score?: string;
  date?: string;
  openDate: string;
  questions: QuizQuestion[];
  setQuestionsMap?: Record<string, any[]>;
  numberOfSets?: number;
}

const INITIAL_ASSESSMENTS: Assessment[] = [
  {
    id: 'midterm-1',
    title: 'Midterm: Neural Firing',
    description: 'Covers chapters 1-4. Complete this assessment to verify your understanding of nerve impulse generation and propagation.',
    status: 'Pending',
    openDate: '2026-06-18T08:00:00',
    questions: [
      {
        id: 1,
        type: 'multiple-choice',
        questionText: 'Which of the following ions is primarily responsible for the depolarization phase of an action potential?',
        options: ['Potassium (K+)', 'Sodium (Na+)', 'Calcium (Ca2+)', 'Chloride (Cl-)'],
        correctAnswer: 'Sodium (Na+)',
        points: 0,
        maxPoints: 5,
      },
      {
        id: 2,
        type: 'essay',
        questionText: 'Describe the role of myelin sheaths in neuronal conduction. What consequences arise when myelin is degraded, as seen in Multiple Sclerosis?',
        points: 0,
        maxPoints: 10,
      }
    ]
  },
  {
    id: 'quiz-2-locked',
    title: 'Quiz 2: Synaptic Transmission',
    description: 'Covers neurotransmitter release mechanisms, receptor channels, and postsynaptic potentials.',
    status: 'Pending',
    openDate: '2026-06-25T09:00:00',
    questions: [
      {
        id: 1,
        type: 'multiple-choice',
        questionText: 'Which neurotransmitter is primarily active at the neuromuscular junction?',
        options: ['Dopamine', 'Serotonin', 'Acetylcholine', 'Glutamate'],
        correctAnswer: 'Acetylcholine',
        points: 0,
        maxPoints: 5,
      }
    ]
  },
  {
    id: 'quiz-1',
    title: 'Quiz 1: Fundamentals',
    description: 'Covers neuroanatomy basics, structural subdivisions of the nervous system, and cranial nerves.',
    status: 'Completed',
    score: '93%',
    date: 'Oct 1, 2023',
    openDate: '2023-09-30T08:00:00',
    questions: [
      {
        id: 1,
        type: 'multiple-choice',
        questionText: 'Which brain region is chiefly associated with the coordination of voluntary movement and motor learning?',
        options: ['Cerebellum', 'Hippocampus', 'Amygdala', 'Occipital Lobe'],
        correctAnswer: 'Cerebellum',
        studentAnswer: 'Cerebellum',
        points: 5,
        maxPoints: 5,
      },
      {
        id: 2,
        type: 'essay',
        questionText: 'Contrast the functions of the sympathetic and parasympathetic nervous systems.',
        studentAnswer: 'The sympathetic nervous system prepares the body for fight-or-flight responses by increasing heart rate, dilating airways, and inhibiting digestion. The parasympathetic nervous system governs rest-and-digest, conserving energy and reducing heart rate.',
        points: 9,
        maxPoints: 10,
        feedback: 'Excellent breakdown of functional contrasts. The distinctions regarding autonomic responses are clear. Incorporating specific neurotransmitters involved in each pathway would make this a perfect response.',
      }
    ]
  }
];

interface ReviewModalProps {
  resource: Resource | null;
  onClose: () => void;
  onSubmit: (id: string, rating: number, comment: string) => void;
}

function ReviewModal({ resource, onClose, onSubmit }: ReviewModalProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (resource) {
      setRating(resource.userRating ?? 0);
      setComment(resource.userComment ?? '');
    }
  }, [resource]);

  if (!resource) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg flex flex-col rounded-2xl border border-white/10 bg-surface-container overflow-hidden p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="font-display text-xl font-bold text-on-surface mb-1">
          {resource.hasReviewed ? 'Edit your review' : 'Review this material'}
        </h2>
        <p className="font-sans text-sm text-slate-400 mb-6">{resource.title}</p>

        <div className="flex justify-center mb-6 gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
              className="transition-transform hover:scale-110 focus:outline-none"
            >
              <Star
                className={clsx(
                  "w-10 h-10 transition-colors",
                  (hoverRating ? star <= hoverRating : star <= rating)
                    ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                    : "text-slate-600"
                )}
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your feedback on this material..."
          className="w-full h-32 bg-surface-container-high border border-white/10 rounded-xl p-4 font-sans text-sm text-on-surface placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 resize-none mb-6"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-white/10 font-display font-semibold text-sm text-slate-300 hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            disabled={rating === 0}
            onClick={() => {
              onSubmit(resource.id, rating, comment);
              onClose();
            }}
            className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-display font-semibold text-sm hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            Submit Review
          </button>
        </div>
      </div>
    </div>
  );
}

// Quiz Taking Modal
interface QuizTakingModalProps {
  assessment: Assessment | null;
  onClose: () => void;
  onSubmit: (id: string, answers: Record<number, string>) => void;
  courseId: string;
}

function QuizTakingModal({ assessment, onClose, onSubmit, courseId }: QuizTakingModalProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState(1800); // default 30 min
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    if (assessment) {
      setAnswers({});
      setCurrentIdx(0);
      const minutes = assessment.questions.length * 10;
      setTimeLeft(minutes * 60);
    }
  }, [assessment]);

  useEffect(() => {
    if (!assessment) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [assessment]);

  const assignedSet = React.useMemo(() => {
    const storageKey = `learnSyncAI_seating_grid_${courseId}`;
    const saved = localStorage.getItem(storageKey);
    if (!saved) return 'Set A';
    try {
      const seats = JSON.parse(saved);
      if (!Array.isArray(seats)) return 'Set A';

      const numSets = assessment?.numberOfSets || 3;
      const SET_KEYS = ['Set A', 'Set B', 'Set C', 'Set D', 'Set E'];

      let maxR = 5, maxC = 7;
      seats.forEach((s: any) => {
        if (s.row > maxR) maxR = s.row;
        if (s.col > maxC) maxC = s.col;
      });
      const gridRows = maxR + 1;
      const gridCols = maxC + 1;

      let presentIndex = 0;
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          const seat = seats.find((s: any) => s.row === r && s.col === c);
          if (seat && seat.studentId !== null && !seat.isAbsent) {
            if (seat.studentId === 'student') {
              return SET_KEYS[presentIndex % numSets] || 'Set A';
            }
            presentIndex++;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
    return 'Set A';
  }, [courseId, assessment]);

  // Group questions by section
  const sections = React.useMemo(() => {
    if (!assessment) return [];
    const uniqueTypesInQuiz = Array.from(new Set(assessment.questions.map(item => item.type)));
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI'];

    return uniqueTypesInQuiz.map((type, typeIndex) => {
      const typeQuestions = assessment.questions
        .map((q, idx) => ({ q, originalIdx: idx }))
        .filter(item => item.q.type === type);

      const roman = romanNumerals[typeIndex] || 'I';
      const label = `Test ${roman}`;
      const count = typeQuestions.length;

      return {
        key: type,
        label,
        count,
        questions: typeQuestions
      };
    });
  }, [assessment]);

  if (!assessment) return null;

  const isFormValid = assessment.questions.every(q => {
    const val = answers[q.id];
    return val && val.trim().length > 0;
  });

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const answeredCount = assessment.questions.filter(q => answers[q.id] && answers[q.id].trim().length > 0).length;
  const totalQuestions = assessment.questions.length;
  const percentComplete = Math.round((answeredCount / totalQuestions) * 100);
  const isLowTime = timeLeft < 300;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 overflow-hidden flex flex-col animate-in fade-in duration-300">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] bg-primary-fixed-dim/10 animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] bg-indigo-500/5 animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      <div className="w-full max-w-[1400px] mx-auto flex-1 flex flex-col h-full border-x border-white/5 bg-slate-950/80 backdrop-blur-md overflow-hidden relative z-10">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-slate-950/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/15 border border-primary-fixed-dim/30 flex items-center justify-center text-primary-fixed shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-primary-fixed font-bold uppercase tracking-widest border border-primary-fixed/30 bg-primary-fixed/10 px-2 py-0.5 rounded">
                  Active
                </span>
                <span className="font-mono text-[9px] text-indigo-400 font-bold uppercase tracking-widest border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded">
                  {assignedSet}
                </span>
              </div>
              <h2 className="font-display text-lg md:text-2xl font-bold text-white mt-1 truncate">{assessment.title}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={clsx(
              "lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs font-bold shrink-0",
              isLowTime
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse"
                : "bg-white/5 border-white/10 text-slate-350"
            )}>
              <Timer className="w-3.5 h-3.5" />
              <span>{formatTime(timeLeft)}</span>
            </div>

            <button
              onClick={() => setIsMobileNavOpen(true)}
              className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all active:scale-95 border border-white/10 shrink-0"
              title="Show question navigator"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col justify-between no-scrollbar">
            <div className="max-w-3xl mx-auto w-full space-y-6">
              {(() => {
                const q = assessment.questions[currentIdx];
                if (!q) return null;
                const uniqueTypesInQuiz = Array.from(new Set(assessment.questions.map(item => item.type)));
                const typeIndex = uniqueTypesInQuiz.indexOf(q.type);
                const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI'];
                const sectionLabel = `Test ${romanNumerals[typeIndex] || 'I'}: ${q.type === 'multiple-choice' ? 'Multiple Choice' : 'Essay Response'}`;

                return (
                  <div
                    key={q.id}
                    className="p-6 md:p-10 rounded-3xl bg-white/[0.01] border border-white/5 hover:border-white/10 transition-all duration-300 space-y-8 shadow-[0_4px_30px_rgba(0,0,0,0.2)] animate-in fade-in zoom-in-95 duration-200"
                  >
                    <div className="flex items-start gap-4">
                      <span className="w-10 h-10 rounded-full bg-primary-fixed-dim/15 border border-primary-fixed-dim/30 flex items-center justify-center font-display text-sm font-bold text-primary-fixed shrink-0">
                        {currentIdx + 1}
                      </span>
                      <div className="space-y-1.5 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-sans text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left">
                            {sectionLabel} • {q.maxPoints} Points
                          </span>
                        </div>
                        <h3 className="font-sans text-lg md:text-xl text-white font-medium leading-relaxed text-left">
                          {q.questionText}
                        </h3>
                      </div>
                    </div>

                    {q.type === 'multiple-choice' && q.options && (
                      <div className="grid grid-cols-1 gap-4 pt-2">
                        {q.options.map((option, optIdx) => {
                          const isSelected = answers[q.id] === option;
                          const letter = ['A', 'B', 'C', 'D'][optIdx] || '';
                          return (
                            <button
                              key={option}
                              onClick={() => setAnswers(prev => ({ ...prev, [q.id]: option }))}
                              className={clsx(
                                "flex items-center text-left p-4 rounded-2xl border transition-all duration-300 group select-none active:scale-[0.99]",
                                isSelected
                                  ? "bg-primary-fixed-dim/10 border-primary-fixed-dim text-white shadow-[0_0_25px_rgba(0,218,243,0.12)]"
                                  : "bg-white/[0.01] border-white/5 text-slate-350 hover:bg-white/[0.03] hover:border-white/15"
                              )}
                            >
                              <div className={clsx(
                                "w-8 h-8 rounded-xl flex items-center justify-center font-mono text-xs font-bold mr-4 border transition-colors shrink-0",
                                isSelected
                                  ? "bg-primary-fixed-dim text-slate-950 border-primary-fixed-dim"
                                  : "bg-white/5 border-white/10 text-slate-400 group-hover:border-white/20 group-hover:text-white"
                              )}>
                                {letter}
                              </div>
                              <span className="font-sans text-sm font-semibold leading-normal">{option}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {q.type === 'essay' && (
                      <div className="space-y-3 pt-2">
                        <textarea
                          rows={8}
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder="Provide a detailed explanation..."
                          className="w-full bg-white/[0.01] border border-white/10 focus:border-primary-fixed-dim/50 rounded-2xl p-5 text-white font-sans text-sm resize-none outline-none transition-all placeholder:text-slate-600 focus:bg-white/[0.02] leading-relaxed"
                        />
                        <div className="flex justify-between items-center text-[11px] text-slate-500 font-sans px-1">
                          <span className="flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-slate-600 animate-pulse" /> Focus on structure and relevant neural pathways
                          </span>
                          <span className="font-mono bg-white/5 px-2.5 py-0.5 rounded text-[10px]">
                            {answers[q.id] ? answers[q.id].trim().split(/\s+/).filter(Boolean).length : 0} words
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-between items-center max-w-3xl mx-auto w-full pt-4 border-t border-white/5 mt-6">
              <button
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx(prev => prev - 1)}
                className="px-5 py-2.5 rounded-xl border border-white/10 font-sans text-xs font-bold text-slate-300 hover:bg-white/5 transition-all disabled:opacity-20 disabled:pointer-events-none"
              >
                ← Previous
              </button>
              <button
                disabled={currentIdx === totalQuestions - 1}
                onClick={() => setCurrentIdx(prev => prev + 1)}
                className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-sans text-xs font-bold text-white transition-all disabled:opacity-20 disabled:pointer-events-none"
              >
                Next →
              </button>
            </div>
          </div>

          <div className="hidden lg:flex lg:w-80 border-l border-white/10 p-6 bg-slate-950/40 backdrop-blur-md flex-col justify-between shrink-0">
            <div className="space-y-6">
              <div className={clsx(
                "p-4 rounded-xl border flex items-center gap-4 transition-colors duration-300",
                isLowTime
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-450 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                  : "bg-white/[0.02] border-white/5 text-slate-350"
              )}>
                <div className={clsx(
                  "w-10 h-10 rounded-lg flex items-center justify-center border",
                  isLowTime ? "bg-rose-500/20 border-rose-500/30" : "bg-white/5 border-white/10"
                )}>
                  <Timer className={clsx("w-5 h-5", isLowTime && "animate-pulse")} />
                </div>
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Remaining Time</p>
                  <p className={clsx(
                    "font-mono text-2xl font-black tracking-tight mt-0.5",
                    isLowTime ? "text-rose-400" : "text-white"
                  )}>
                    {formatTime(timeLeft)}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 space-y-3">
                <div className="flex justify-between items-center text-xs font-sans">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Assessment Progress</span>
                  <span className="text-white font-extrabold">{answeredCount} of {totalQuestions}</span>
                </div>
                <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-primary-fixed-dim to-indigo-400 h-full transition-all duration-300"
                    style={{ width: `${percentComplete}%` }}
                  />
                </div>
              </div>

              <div className="space-y-5">
                {sections.map((sec) => (
                  <div key={sec.key} className="space-y-2">
                    <h4 className="font-display text-[10px] font-bold text-slate-450 uppercase tracking-widest">
                      {sec.label} — {sec.count} {sec.count === 1 ? 'Item' : 'Items'}
                    </h4>
                    <div className="grid grid-cols-5 gap-2">
                      {sec.questions.map(({ q, originalIdx }) => {
                        const isAnswered = answers[q.id] && answers[q.id].trim().length > 0;
                        const isActive = currentIdx === originalIdx;
                        return (
                          <button
                            key={q.id}
                            onClick={() => setCurrentIdx(originalIdx)}
                            className={clsx(
                              "h-9 rounded-lg flex items-center justify-center font-display text-xs font-bold border transition-all duration-300 hover:-translate-y-0.5 active:scale-95",
                              isActive
                                ? "bg-primary-fixed border-primary-fixed text-slate-950 font-black shadow-[0_0_15px_rgba(0,218,243,0.3)]"
                                : isAnswered
                                  ? "bg-primary-fixed-dim/20 border-primary-fixed-dim/40 text-primary-fixed shadow-[0_0_15px_rgba(0,218,243,0.05)]"
                                  : "bg-transparent border-white/10 text-slate-450 hover:border-white/20 hover:text-white"
                            )}
                          >
                            {originalIdx + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isMobileNavOpen && (
            <div className="lg:hidden fixed inset-0 z-[110] flex justify-end animate-in fade-in duration-200">
              <div
                className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300"
                onClick={() => setIsMobileNavOpen(false)}
              />

              <div className="relative w-80 max-w-[85vw] h-full bg-slate-900 border-l border-white/10 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300">
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                    <h3 className="font-display text-base font-bold text-white">Assessment Panel</h3>
                    <button
                      onClick={() => setIsMobileNavOpen(false)}
                      className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-6 flex-1 overflow-y-auto pr-1 no-scrollbar pb-6">
                    <div className={clsx(
                      "p-4 rounded-xl border flex items-center gap-4 transition-colors duration-300",
                      isLowTime
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-450 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                        : "bg-white/[0.02] border-white/5 text-slate-350"
                    )}>
                      <div className={clsx(
                        "w-10 h-10 rounded-lg flex items-center justify-center border",
                        isLowTime ? "bg-rose-500/20 border-rose-500/30" : "bg-white/5 border-white/10"
                      )}>
                        <Timer className={clsx("w-5 h-5", isLowTime && "animate-pulse")} />
                      </div>
                      <div>
                        <p className="font-sans text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Remaining Time</p>
                        <p className={clsx(
                          "font-mono text-2xl font-black tracking-tight mt-0.5",
                          isLowTime ? "text-rose-400" : "text-white"
                        )}>
                          {formatTime(timeLeft)}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 space-y-3">
                      <div className="flex justify-between items-center text-xs font-sans">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Assessment Progress</span>
                        <span className="text-white font-extrabold">{answeredCount} of {totalQuestions}</span>
                      </div>
                      <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-primary-fixed-dim to-indigo-400 h-full transition-all duration-300"
                          style={{ width: `${percentComplete}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-5">
                      {sections.map((sec) => (
                        <div key={sec.key} className="space-y-2">
                          <h4 className="font-display text-[10px] font-bold text-slate-450 uppercase tracking-widest">
                            {sec.label} — {sec.count} {sec.count === 1 ? 'Item' : 'Items'}
                          </h4>
                          <div className="grid grid-cols-5 gap-2">
                            {sec.questions.map(({ q, originalIdx }) => {
                              const isAnswered = answers[q.id] && answers[q.id].trim().length > 0;
                              const isActive = currentIdx === originalIdx;
                              return (
                                <button
                                  key={q.id}
                                  onClick={() => {
                                    setCurrentIdx(originalIdx);
                                    setIsMobileNavOpen(false);
                                  }}
                                  className={clsx(
                                    "h-9 rounded-lg flex items-center justify-center font-display text-xs font-bold border transition-all duration-300 hover:-translate-y-0.5 active:scale-95",
                                    isActive
                                      ? "bg-primary-fixed border-primary-fixed text-slate-950 font-black shadow-[0_0_15px_rgba(0,218,243,0.3)]"
                                      : isAnswered
                                        ? "bg-primary-fixed-dim/20 border-primary-fixed-dim/40 text-primary-fixed shadow-[0_0_15px_rgba(0,218,243,0.05)]"
                                        : "bg-transparent border-white/10 text-slate-450 hover:border-white/20 hover:text-white"
                                  )}
                                >
                                  {originalIdx + 1}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 bg-slate-950/40 flex justify-between items-center">
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              disabled={!isFormValid}
              onClick={() => onSubmit(assessment.id, answers)}
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-primary-fixed-dim text-slate-950 font-sans font-black text-sm hover:bg-primary-container transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shadow-[0_0_20px_rgba(0,218,243,0.15)]"
            >
              Submit Exam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Quiz Results Modal
interface QuizResultsModalProps {
  assessment: Assessment | null;
  onClose: () => void;
}

function QuizResultsModal({ assessment, onClose }: QuizResultsModalProps) {
  if (!assessment) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-surface-container overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-surface-container-high/40">
          <div>
            <span className="font-sans text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
              <Award className="w-3.5 h-3.5" /> Assessment Results
            </span>
            <h2 className="font-display text-xl font-bold text-white mt-0.5">{assessment.title}</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-primary-fixed-dim/15 border border-primary-fixed-dim/30 px-3.5 py-1.5 rounded-lg text-center font-display text-lg font-bold text-primary-fixed-dim">
              Score: {assessment.score}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Results */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
          <div className="flex items-center justify-between p-4 bg-surface-container-lowest border border-white/5 rounded-xl text-sm font-sans text-slate-400">
            <span>Status: <span className="text-emerald-400 font-semibold">Completed</span></span>
            <span>Date Submitted: {assessment.date}</span>
          </div>

          {assessment.questions.map((q, idx) => {
            const isCorrect = q.type === 'multiple-choice' ? q.studentAnswer === q.correctAnswer : q.points >= (q.maxPoints * 0.75);

            return (
              <div key={q.id} className="space-y-4 border-b border-white/5 pb-6 last:border-b-0 last:pb-0">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-surface-container-high border border-white/5 flex items-center justify-center font-display text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <p className="font-sans text-base text-white font-medium leading-relaxed pt-0.5">
                      {q.questionText}
                    </p>
                  </div>
                  <span className={clsx(
                    "px-2.5 py-1 rounded-md font-sans text-[10px] font-bold uppercase tracking-wider border shrink-0",
                    isCorrect
                      ? "bg-emerald-400/10 border-emerald-400/20 text-emerald-400"
                      : "bg-amber-400/10 border-amber-400/20 text-amber-400"
                  )}>
                    {q.points} / {q.maxPoints} pts
                  </span>
                </div>

                <div className="pl-9 space-y-3">
                  {/* Answers Display */}
                  <div className="p-4 rounded-xl bg-surface-container-lowest border border-white/5 space-y-2">
                    <p className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">
                      Your Answer:
                    </p>
                    <p className={clsx("font-sans text-sm", isCorrect ? "text-emerald-400" : "text-amber-400")}>
                      {q.studentAnswer || '(No response recorded)'}
                    </p>

                    {q.type === 'multiple-choice' && !isCorrect && (
                      <>
                        <div className="h-px bg-white/5 my-2" />
                        <p className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">
                          Correct Answer:
                        </p>
                        <p className="font-sans text-sm text-emerald-400">
                          {q.correctAnswer}
                        </p>
                      </>
                    )}

                    {q.type === 'essay' && (
                      <>
                        <div className="h-px bg-white/5 my-2.5" />
                        <p className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary-fixed-dim" />
                          Educator Feedback:
                        </p>
                        <div className="p-3.5 bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 rounded-lg">
                          <p className="font-sans text-xs text-slate-350 leading-relaxed italic">
                            "{q.feedback || 'Excellent breakdown of functional contrasts. The distinctions regarding autonomic responses are clear. Incorporating specific neurotransmitters involved in each pathway would make this a perfect response.'}"
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-surface-container-lowest/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-surface-container-high border border-white/10 hover:bg-white/10 text-white font-sans text-sm font-semibold transition-all active:scale-95"
          >
            Close Results
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ resource, onReview }: { key?: React.Key; resource: Resource; onReview: () => void }) {
  const isAr = resource.type === 'ar';

  if (isAr) {
    return (
      <div className="bg-surface-container rounded-xl p-5 border border-primary-fixed-dim/30 hover:border-primary-fixed-dim/60 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(0,218,243,0.1)] flex items-start gap-4 group relative overflow-hidden cursor-pointer">
        <div className="absolute top-0 right-0 w-24 h-24 bg-primary-fixed-dim/10 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none"></div>
        <div className="w-12 h-12 rounded-lg bg-primary-fixed-dim/20 flex items-center justify-center shrink-0 shadow-inner">
          <Box className="text-primary-fixed-dim w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0 relative z-10 flex flex-col justify-center h-12">
          <div className="flex items-center justify-between mb-0.5">
            <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">{resource.title}</h4>
            <button onClick={(e) => { e.stopPropagation(); onReview(); }} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-400 transition-colors">
              <Star className={clsx("w-3 h-3", resource.hasReviewed && "fill-amber-400 text-amber-400")} />
              <span className="text-[10px] font-sans font-semibold uppercase tracking-widest">{resource.hasReviewed ? 'Reviewed' : 'Rate'}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <p className="font-sans text-sm text-on-surface-variant truncate">{resource.meta}</p>
            <span className="px-1.5 py-0.5 rounded bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[9px] tracking-[0.1em]">AR-READY</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group cursor-pointer">
      <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center shrink-0">
        {resource.type === 'pdf' ? (
          <FileText className="text-error w-6 h-6" />
        ) : (
          <PlayCircle className="text-indigo-400 w-6 h-6" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center h-12">
        <div className="flex items-center justify-between mb-0.5">
          <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">{resource.title}</h4>
          <button onClick={(e) => { e.stopPropagation(); onReview(); }} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-400 transition-colors">
            <Star className={clsx("w-3 h-3", resource.hasReviewed && "fill-amber-400 text-amber-400")} />
            <span className="text-[10px] font-sans font-semibold uppercase tracking-widest">{resource.hasReviewed ? 'Reviewed' : 'Rate'}</span>
          </button>
        </div>
        <p className="font-sans text-sm text-on-surface-variant truncate">{resource.meta}</p>
      </div>
    </div>
  );
}

export default function StudentCourseView() {
  const { courseId } = useParams();
  const [activeTab, setActiveTab] = useState<'resources' | 'quizzes' | 'announcements'>('resources');
  const [resources, setResources] = useState<Resource[]>(INITIAL_RESOURCES);
  const [reviewingResource, setReviewingResource] = useState<Resource | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>(INITIAL_ASSESSMENTS);
  const [takingQuiz, setTakingQuiz] = useState<Assessment | null>(null);
  const [viewingResults, setViewingResults] = useState<Assessment | null>(null);

  const handleReviewSubmit = (id: string, rating: number, comment: string) => {
    setResources(prev =>
      prev.map(r =>
        r.id === id ? { ...r, hasReviewed: true, userRating: rating, userComment: comment } : r
      )
    );
  };

  const handleQuizSubmit = (quizId: string, studentAnswers: Record<number, string>) => {
    setAssessments(prev =>
      prev.map(quiz => {
        if (quiz.id !== quizId) return quiz;

        const updatedQuestions = quiz.questions.map(q => {
          const ans = studentAnswers[q.id] || '';
          let pts = 0;
          let feedback = '';

          if (q.type === 'multiple-choice') {
            const isCorrect = ans.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase();
            pts = isCorrect ? q.maxPoints : 0;
            feedback = isCorrect ? 'Correct. Excellent understanding of membrane potential dynamics.' : `Incorrect. The correct answer was ${q.correctAnswer}.`;
          } else {
            const length = ans.trim().split(/\s+/).length;
            if (length > 25) {
              pts = 9;
              feedback = 'Very detailed and scientifically sound explanation. Your description of saltatory conduction is correct.';
            } else if (length > 5) {
              pts = 7;
              feedback = 'Partially correct. Expand on the physiological mechanism of saltatory conduction for full credit.';
            } else {
              pts = 3;
              feedback = 'Response too short. Explain myelin role and demyelination consequences.';
            }
          }

          return {
            ...q,
            studentAnswer: ans,
            points: pts,
            feedback
          };
        });

        const totalPoints = updatedQuestions.reduce((acc, curr) => acc + curr.points, 0);
        const maxPoints = updatedQuestions.reduce((acc, curr) => acc + curr.maxPoints, 0);
        const scorePercentage = Math.round((totalPoints / maxPoints) * 100);

        return {
          ...quiz,
          status: 'Completed',
          score: `${scorePercentage}%`,
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          questions: updatedQuestions
        };
      })
    );

    setTakingQuiz(null);
  };

  const course = MOCK_COURSES.find(c => c.id === courseId);
  const courseTitle = course ? course.title : 'Course Overview';
  const educator = course ? course.instructor : 'Prof. Elias Vance';
  const courseCode = course ? course.courseCode : undefined;
  const section = course ? course.section : undefined;

  return (
    <>
      <header className="sticky top-16 md:top-0 w-full border-b border-white/10 bg-page-50 backdrop-blur-md shadow-none flex justify-between items-center h-16 px-4 md:px-8 z-40">
        <div className="flex items-center gap-4 text-slate-400 font-sans text-[13px]">
          <Link to="/student/catalog" className="hover:text-primary-fixed-dim cursor-pointer transition-colors">Courses</Link>
          <ChevronRight className="w-4 h-4" />
          <span>{courseTitle}</span>
        </div>

        <div className="hidden md:flex items-center gap-4 text-slate-400">
          <button className="hover:text-primary-fixed-dim transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 ml-2">
            <img
              src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150"
              alt="Student Profile Avatar"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </header>

      <main className="p-4 md:p-10 max-w-7xl mx-auto w-full">
        {/* Course Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {courseCode && (
                <span className="px-2.5 py-1 rounded-full bg-surface-variant text-on-surface font-sans font-semibold text-[11px] tracking-[0.1em] border border-white/5 uppercase">
                  {courseCode}
                </span>
              )}
              {section && (
                <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 font-sans font-semibold text-[11px] tracking-[0.1em] border border-indigo-500/20 uppercase">
                  Section {section}
                </span>
              )}
            </div>
            <h1 className="font-display text-[42px] font-bold text-on-surface mb-2 tracking-tight leading-tight">{courseTitle}</h1>
            <p className="font-sans text-lg text-on-surface-variant max-w-2xl">
              Educator: <span className="text-on-surface">{educator}</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar gap-4 md:gap-8">
          <button
            onClick={() => setActiveTab('resources')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            <span className="hidden sm:inline">Learning </span>Resources
          </button>
          <button
            onClick={() => setActiveTab('quizzes')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'quizzes' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            Quiz/Exam
          </button>
          <button
            onClick={() => setActiveTab('announcements')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'announcements' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            Announcements
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'resources' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map(resource => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onReview={() => setReviewingResource(resource)}
              />
            ))}
          </div>
        )}

        {activeTab === 'quizzes' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {assessments.map((assessment) => {
              const now = new Date();
              const openTime = new Date(assessment.openDate);
              const isLocked = assessment.status === 'Pending' && now < openTime;

              return (
                <article
                  key={assessment.id}
                  className={clsx(
                    "glass-card rounded-xl p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-300",
                    assessment.status === 'Completed' ? 'opacity-80' : 'hover:border-primary-fixed-dim/30 hover:shadow-lg hover:shadow-primary-fixed-dim/5'
                  )}
                >
                  <div>
                    <div className="flex justify-between items-start mb-4 relative z-10">
                      <span className={clsx(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-sans font-semibold text-[11px] border uppercase tracking-[0.1em]",
                        assessment.status === 'Completed'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : isLocked
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/20'
                      )}>
                        {assessment.status === 'Completed' ? 'Completed' : isLocked ? 'Locked' : 'Open'}
                      </span>
                    </div>
                    <h3 className="font-display text-[22px] font-medium text-on-surface mb-2 relative z-10">
                      {assessment.title}
                    </h3>
                    <p className="font-sans text-sm text-on-surface-variant mb-6 line-clamp-2 relative z-10">
                      {assessment.status === 'Completed'
                        ? `Score: ${assessment.score} • Submitted ${assessment.date}`
                        : assessment.description}
                    </p>
                    {isLocked && (
                      <p className="font-sans text-xs text-amber-400/80 font-medium flex items-center gap-1.5 mb-4 relative z-10">
                        <Clock className="w-3.5 h-3.5" />
                        Opens: {openTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-end pt-4 border-t border-white/5 mt-auto relative z-10">
                    {assessment.status === 'Pending' ? (
                      isLocked ? (
                        <button
                          disabled
                          className="px-5 py-2.5 bg-white/5 border border-white/5 text-slate-500 rounded-lg font-display text-sm font-semibold flex items-center gap-2 cursor-not-allowed"
                        >
                          <Lock className="w-4 h-4" />
                          Locked
                        </button>
                      ) : (
                        <button
                          onClick={() => setTakingQuiz(assessment)}
                          className="px-5 py-2.5 bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 text-primary-fixed-dim hover:bg-primary-fixed-dim hover:text-on-primary-fixed rounded-lg font-display text-sm font-semibold transition-all duration-300 flex items-center gap-2"
                        >
                          <ClipboardList className="w-4 h-4" />
                          Start Quiz
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => setViewingResults(assessment)}
                        className="px-5 py-2 bg-transparent text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm flex items-center gap-2"
                      >
                        View Results <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {activeTab === 'announcements' && (
          <div className="space-y-6 max-w-3xl">
            <article className="glass-card rounded-xl p-6 relative overflow-hidden border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center shrink-0">
                  <Megaphone className="w-6 h-6 text-primary-fixed-dim" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-display text-lg font-semibold text-on-surface">Midterm Exam Details</h3>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 font-sans">
                      <Clock className="w-3 h-3" /> 2 days ago
                    </span>
                  </div>
                  <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                    Hello class, just a reminder that our midterm exam is scheduled for next Tuesday. Please ensure you have reviewed chapters 1 through 4. Good luck!
                  </p>
                </div>
              </div>
            </article>

            <article className="glass-card rounded-xl p-6 relative overflow-hidden border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-surface-variant flex items-center justify-center shrink-0">
                  <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=150" alt="Educator" className="w-full h-full object-cover rounded-full" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-display text-lg font-semibold text-on-surface">New Reading Material Uploaded</h3>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 font-sans">
                      <Clock className="w-3 h-3" /> Last week
                    </span>
                  </div>
                  <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-3">
                    I've uploaded the new interactive AR model for the human brain. Please take a look at it before our next lecture as we will be using it for our discussion on neuroplasticity.
                  </p>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high border border-white/5 text-sm font-sans text-on-surface cursor-pointer hover:bg-white/5 transition-colors">
                    <Box className="w-4 h-4 text-primary-fixed-dim" />
                    Human Brain Model.gltf
                  </div>
                </div>
              </div>
            </article>
          </div>
        )}
      </main>

      <ReviewModal
        resource={reviewingResource}
        onClose={() => setReviewingResource(null)}
        onSubmit={handleReviewSubmit}
      />

      <QuizTakingModal
        assessment={takingQuiz}
        onClose={() => setTakingQuiz(null)}
        onSubmit={handleQuizSubmit}
        courseId={courseId || ''}
      />

      <QuizResultsModal
        assessment={viewingResults}
        onClose={() => setViewingResults(null)}
      />
    </>
  );
}
