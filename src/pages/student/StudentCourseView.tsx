import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bell, ChevronRight, CheckCircle2, Box, PlayCircle, FileText, ArrowRight, Megaphone, Clock, Star, X, ClipboardList, HelpCircle, Award, AlertCircle, Lock } from 'lucide-react';
import clsx from 'clsx';

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
}

const INITIAL_ASSESSMENTS: Assessment[] = [
  {
    id: 'midterm-1',
    title: 'Midterm: Neural Firing',
    description: 'Covers chapters 1-4. Complete this assessment to verify your understanding of nerve impulse generation and propagation.',
    status: 'Pending',
    openDate: '2026-06-18T08:00:00', // Open (simulate past date/time)
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
    openDate: '2026-06-25T09:00:00', // Future date (locked)
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

// ─── Quiz Taking Modal ─────────────────────────────────────────────────────────
interface QuizTakingModalProps {
  assessment: Assessment | null;
  onClose: () => void;
  onSubmit: (id: string, answers: Record<number, string>) => void;
}

function QuizTakingModal({ assessment, onClose, onSubmit }: QuizTakingModalProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  
  useEffect(() => {
    if (assessment) {
      setAnswers({});
    }
  }, [assessment]);

  if (!assessment) return null;

  const isFormValid = assessment.questions.every(q => {
    const val = answers[q.id];
    return val && val.trim().length > 0;
  });

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 overflow-hidden flex flex-col animate-in fade-in duration-200">
      {/* Centered container for standard reading width */}
      <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col h-full border-x border-white/5 bg-surface-container overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-surface-container-high/40">
          <div>
            <span className="font-sans text-[10px] font-bold text-primary-fixed-dim uppercase tracking-widest">Active Assessment</span>
            <h2 className="font-display text-2xl font-bold text-white mt-0.5">{assessment.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all active:scale-95"
            title="Exit quiz"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Questions list */}
        <div className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
          {assessment.questions.map((q, idx) => (
            <div key={q.id} className="space-y-5">
              <div className="flex items-start gap-4">
                <span className="w-8 h-8 rounded-full bg-primary-fixed-dim/20 border border-primary-fixed-dim/30 flex items-center justify-center font-display text-sm font-bold text-primary-fixed shrink-0">
                  {idx + 1}
                </span>
                <p className="font-sans text-lg text-white font-medium leading-relaxed pt-0.5">
                  {q.questionText}
                </p>
              </div>

              {q.type === 'multiple-choice' && q.options && (
                <div className="pl-12 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {q.options.map((option) => (
                    <label
                      key={option}
                      className={clsx(
                        "flex items-center p-4 rounded-xl border transition-all cursor-pointer select-none",
                        answers[q.id] === option
                          ? "bg-primary-fixed-dim/10 border-primary-fixed-dim text-white shadow-[0_0_20px_rgba(0,218,243,0.08)]"
                          : "bg-surface-container-lowest border-white/5 text-slate-350 hover:bg-surface-container-high/50 hover:border-white/10"
                      )}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={answers[q.id] === option}
                        onChange={() => setAnswers(prev => ({ ...prev, [q.id]: option }))}
                        className="w-4 h-4 text-primary-fixed-dim border-white/20 bg-transparent focus:ring-primary-fixed-dim/50 focus:ring-offset-background"
                      />
                      <span className="ml-3 font-sans text-sm font-medium">{option}</span>
                    </label>
                  ))}
                </div>
              )}

              {q.type === 'essay' && (
                <div className="pl-12">
                  <textarea
                    rows={6}
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="Type your essay explanation here..."
                    className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary-fixed-dim/50 rounded-xl p-4 text-white font-sans text-sm resize-none outline-none transition-colors placeholder:text-slate-650"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-surface-container-lowest/30 flex justify-between items-center">
          <p className="font-sans text-xs text-slate-500">
            {isFormValid ? 'All questions answered' : 'Please complete all questions before submitting'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
            >
              Exit
            </button>
            <button
              disabled={!isFormValid}
              onClick={() => onSubmit(assessment.id, answers)}
              className="px-6 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans font-bold text-sm hover:bg-primary-container transition-all disabled:opacity-50 disabled:pointer-events-none active:scale-95 shadow-lg shadow-primary-fixed-dim/10"
            >
              Submit Quiz
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quiz Results Modal ────────────────────────────────────────────────────────
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

  // Assessments and testing state
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
            // Essay question auto-grader simulation (always award decent score for realistic response)
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

  const courseTitle = courseId === 'bio-301' ? 'Advanced Neurobiology' : 'Course Overview';
  const educator = 'Prof. Elias Vance';

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
        {/* Course Header - simplified Google Classroom style, no MIT or license badges */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
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
            Quizzes<span className="hidden sm:inline"> &amp; Exams</span>
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
      />

      <QuizResultsModal
        assessment={viewingResults}
        onClose={() => setViewingResults(null)}
      />
    </>
  );
}
