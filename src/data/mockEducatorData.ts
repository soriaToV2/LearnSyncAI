// ─── Types ──────────────────────────────────────────────
export type QuestionType = 'multiple-choice' | 'true-false' | 'identification' | 'fill-in-the-blank' | 'essay' | 'matching';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type AssessmentStatus = 'draft' | 'ready' | 'deployed' | 'closed';
export type SubmissionStatus = 'submitted' | 'graded' | 'needs-review';
export type StudentStatus = 'active' | 'at-risk' | 'excelling';
export type CourseStatus = 'active' | 'archived' | 'draft';

export interface Question {
  id: string; type: QuestionType; question: string;
  options?: string[]; correctAnswer: string | string[]; points: number;
}
export interface Submission {
  studentId: string; studentName: string; studentAvatar: string;
  submittedAt: string; answers: { questionId: string; answer: string }[];
  autoScore: number; manualScore?: number; totalScore?: number;
  maxScore: number; status: SubmissionStatus; feedback?: string;
}
export interface Assessment {
  id: string; title: string; description: string; type: 'quiz' | 'exam';
  status: AssessmentStatus; questionCount: number; duration: number;
  deadline?: string; difficulty: Difficulty; isLockdown: boolean;
  questions: Question[]; submissions: Submission[];
}
export interface Resource {
  id: string; name: string; type: 'pdf' | 'video' | 'document' | 'model';
  size: string; uploadedAt: string;
}
export interface Badge {
  id: string; title: string; description: string;
  icon: string; color: string; issuedAt: string;
}
export interface EnrolledStudent {
  id: string; name: string; avatar: string; email: string; joinedAt: string;
  assessmentScores: { assessmentId: string; score: number; total: number }[];
  averageGrade: number; status: StudentStatus; badges: Badge[];
}
export interface EducatorCourse {
  id: string; title: string; description: string; iconName: string;
  color: string; university?: string; isPublic: boolean; courseCode: string;
  studentCount: number; status: CourseStatus; createdAt: string;
  resources: Resource[]; assessments: Assessment[]; students: EnrolledStudent[];
}
export interface ActivityItem {
  id: string; icon: string; label: string; time: string; accent: string; courseId?: string;
}

// ─── Profile ────────────────────────────────────────────
export const EDUCATOR_PROFILE = {
  name: 'Prof. Elias Vance', firstName: 'Elias', university: 'MIT',
  department: 'Neuroscience Dept', semester: 'Spring 2026',
  avatar: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&q=80&w=150',
};

// ─── Courses ────────────────────────────────────────────
export const EDUCATOR_COURSES: EducatorCourse[] = [
  {
    id: 'bio-301', title: 'Advanced Neurobiology',
    description: 'Advanced study of nervous system function, cellular physiology, and neural networks.',
    iconName: 'BrainCircuit', color: '#22d3ee', university: 'MIT',
    isPublic: true, courseCode: 'BIO-301-XK9', studentCount: 42,
    status: 'active', createdAt: '2026-01-15',
    resources: [
      { id: 'r1', name: 'Synaptic Pathways Ch.4', type: 'pdf', size: '2.4 MB', uploadedAt: '2 days ago' },
      { id: 'r2', name: 'Lecture: Neuroplasticity', type: 'video', size: '145 MB', uploadedAt: 'Yesterday' },
      { id: 'r3', name: 'Human Brain Model', type: 'model', size: '12 MB', uploadedAt: 'Today' },
      { id: 'r4', name: 'Ion Channels Overview', type: 'pdf', size: '1.8 MB', uploadedAt: '5 days ago' },
    ],
    assessments: [
      {
        id: 'a1', title: 'Midterm: Neural Firing', type: 'exam', status: 'deployed',
        description: 'Comprehensive assessment covering chapters 1-4.',
        questionCount: 45, duration: 90, deadline: 'May 12, 2026 · 11:59 PM',
        difficulty: 'hard', isLockdown: true,
        questions: [
          { id: 'q1', type: 'multiple-choice', question: 'Which ion is primarily responsible for the depolarization phase?', options: ['Na+', 'K+', 'Ca2+', 'Cl-'], correctAnswer: 'Na+', points: 2 },
          { id: 'q2', type: 'true-false', question: 'Myelination increases signal propagation speed.', correctAnswer: 'true', points: 1 },
          { id: 'q3', type: 'identification', question: 'Name the gap between two neurons.', correctAnswer: 'synaptic cleft', points: 2 },
          { id: 'q4', type: 'essay', question: 'Explain synaptic plasticity and its role in learning.', correctAnswer: '', points: 10 },
          { id: 'q5', type: 'multiple-choice', question: 'What produces cerebrospinal fluid?', options: ['Choroid plexus', 'Arachnoid villi', 'Dura mater', 'Pia mater'], correctAnswer: 'Choroid plexus', points: 2 },
        ],
        submissions: [
          { studentId: 's1', studentName: 'Sarah Jenkins', studentAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150', submittedAt: '2h ago', answers: [{ questionId: 'q4', answer: 'Synaptic plasticity is the ability of synapses to strengthen or weaken over time based on increases or decreases in their activity...' }], autoScore: 76, maxScore: 100, status: 'needs-review' },
          { studentId: 's2', studentName: 'Marcus Thorne', studentAvatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=150', submittedAt: '5h ago', answers: [], autoScore: 82, manualScore: 9, totalScore: 91, maxScore: 100, status: 'graded' },
          { studentId: 's4', studentName: 'Aisha Patel', studentAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150', submittedAt: '1h ago', answers: [{ questionId: 'q4', answer: 'Plasticity refers to the brain\'s remarkable capacity to reorganize itself...' }], autoScore: 90, maxScore: 100, status: 'needs-review' },
        ],
      },
      {
        id: 'a2', title: 'Quiz 2: Synaptic Pathways', type: 'quiz', status: 'draft',
        description: 'Neurotransmitter release and receptor binding.',
        questionCount: 12, duration: 20, difficulty: 'medium', isLockdown: false,
        questions: [
          { id: 'q6', type: 'multiple-choice', question: 'Which neurotransmitter is involved in muscle contraction?', options: ['Acetylcholine', 'Dopamine', 'Serotonin', 'GABA'], correctAnswer: 'Acetylcholine', points: 2 },
          { id: 'q7', type: 'true-false', question: 'GABA is an excitatory neurotransmitter.', correctAnswer: 'false', points: 1 },
        ],
        submissions: [],
      },
      {
        id: 'a3', title: 'Quiz 1: Intro to Neuroscience', type: 'quiz', status: 'closed',
        description: 'Foundational neuroscience concepts.',
        questionCount: 15, duration: 25, difficulty: 'easy', isLockdown: false,
        questions: [], submissions: [
          { studentId: 's1', studentName: 'Sarah Jenkins', studentAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150', submittedAt: 'Apr 20', answers: [], autoScore: 14, totalScore: 14, maxScore: 15, status: 'graded' },
          { studentId: 's2', studentName: 'Marcus Thorne', studentAvatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=150', submittedAt: 'Apr 20', answers: [], autoScore: 12, totalScore: 12, maxScore: 15, status: 'graded' },
          { studentId: 's3', studentName: 'Elena Rostova', studentAvatar: '', submittedAt: 'Apr 21', answers: [], autoScore: 10, totalScore: 10, maxScore: 15, status: 'graded' },
          { studentId: 's4', studentName: 'Aisha Patel', studentAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150', submittedAt: 'Apr 20', answers: [], autoScore: 15, totalScore: 15, maxScore: 15, status: 'graded' },
        ],
      },
    ],
    students: [
      { id: 's1', name: 'Sarah Jenkins', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150', email: 'sarah.j@mit.edu', joinedAt: 'Jan 16', assessmentScores: [{ assessmentId: 'a3', score: 14, total: 15 }], averageGrade: 94, status: 'excelling', badges: [] },
      { id: 's2', name: 'Marcus Thorne', avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=150', email: 'marcus.t@mit.edu', joinedAt: 'Jan 16', assessmentScores: [{ assessmentId: 'a3', score: 12, total: 15 }], averageGrade: 88, status: 'active', badges: [] },
      { id: 's3', name: 'Elena Rostova', avatar: '', email: 'elena.r@mit.edu', joinedAt: 'Jan 18', assessmentScores: [{ assessmentId: 'a3', score: 10, total: 15 }], averageGrade: 72, status: 'at-risk', badges: [] },
      { id: 's4', name: 'Aisha Patel', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150', email: 'aisha.p@mit.edu', joinedAt: 'Jan 17', assessmentScores: [{ assessmentId: 'a3', score: 15, total: 15 }], averageGrade: 98, status: 'excelling', badges: [{ id: 'b1', title: 'Top Scorer', description: 'Highest score on Quiz 1', icon: 'Award', color: '#f59e0b', issuedAt: 'Apr 22' }] },
    ],
  },
  {
    id: 'phys-401', title: 'Quantum Mechanics II',
    description: 'Wave mechanics, quantum entanglement, and advanced operator theory.',
    iconName: 'Sigma', color: '#818cf8', university: 'Stanford',
    isPublic: true, courseCode: 'PHYS-401-M3P', studentCount: 28,
    status: 'active', createdAt: '2026-01-10',
    resources: [
      { id: 'r6', name: 'Wave Function Collapse', type: 'pdf', size: '3.1 MB', uploadedAt: '3 days ago' },
      { id: 'r7', name: 'Lecture: Entanglement', type: 'video', size: '210 MB', uploadedAt: 'Yesterday' },
    ],
    assessments: [
      { id: 'a4', title: 'Problem Set 6', type: 'quiz', status: 'deployed', description: 'Operator theory and eigenvalue problems.', questionCount: 8, duration: 45, deadline: 'May 15, 2026 · 11:59 PM', difficulty: 'hard', isLockdown: false, questions: [], submissions: [
        { studentId: 's5', studentName: 'James Liu', studentAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150', submittedAt: '3h ago', answers: [], autoScore: 35, totalScore: 35, maxScore: 40, status: 'graded' },
      ] },
    ],
    students: [
      { id: 's5', name: 'James Liu', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150', email: 'james.l@stanford.edu', joinedAt: 'Jan 12', assessmentScores: [{ assessmentId: 'a4', score: 35, total: 40 }], averageGrade: 91, status: 'excelling', badges: [] },
    ],
  },
  {
    id: 'cs-202', title: 'Algorithms & Data Structures',
    description: 'Analysis and design of efficient algorithms and data structures.',
    iconName: 'Code2', color: '#34d399', university: 'MIT',
    isPublic: false, courseCode: 'CS-202-7FQ', studentCount: 64,
    status: 'active', createdAt: '2026-01-12',
    resources: [
      { id: 'r8', name: 'Sorting Algorithms Cheat Sheet', type: 'pdf', size: '890 KB', uploadedAt: '1 week ago' },
      { id: 'r9', name: 'Lecture: Graph Traversal', type: 'video', size: '180 MB', uploadedAt: '2 days ago' },
    ],
    assessments: [
      { id: 'a5', title: 'Quiz: Sorting Algorithms', type: 'quiz', status: 'ready', description: 'Merge sort, quick sort, and heap sort.', questionCount: 10, duration: 15, difficulty: 'medium', isLockdown: true, questions: [
        { id: 'q8', type: 'multiple-choice', question: 'Average time complexity of Quick Sort?', options: ['O(n log n)', 'O(n²)', 'O(n)', 'O(log n)'], correctAnswer: 'O(n log n)', points: 2 },
        { id: 'q9', type: 'true-false', question: 'Merge Sort is an in-place sorting algorithm.', correctAnswer: 'false', points: 1 },
      ], submissions: [] },
    ],
    students: [],
  },
];

export const RECENT_ACTIVITY: ActivityItem[] = [
  { id: 'act1', icon: 'FileCheck', label: 'Sarah Jenkins submitted Midterm', time: '2h ago', accent: 'text-emerald-400', courseId: 'bio-301' },
  { id: 'act2', icon: 'FileCheck', label: 'Aisha Patel submitted Midterm', time: '1h ago', accent: 'text-emerald-400', courseId: 'bio-301' },
  { id: 'act3', icon: 'UserPlus', label: '3 new students enrolled in CS-202', time: '5h ago', accent: 'text-cyan-400', courseId: 'cs-202' },
  { id: 'act4', icon: 'Rocket', label: 'Midterm deployed — Neurobiology', time: 'Yesterday', accent: 'text-indigo-400', courseId: 'bio-301' },
  { id: 'act5', icon: 'Award', label: 'Badge issued to Aisha Patel', time: 'Yesterday', accent: 'text-amber-400', courseId: 'bio-301' },
  { id: 'act6', icon: 'FileCheck', label: 'James Liu submitted Problem Set 6', time: '3h ago', accent: 'text-emerald-400', courseId: 'phys-401' },
];

// ─── Helpers ────────────────────────────────────────────
export const getCourseById = (id: string) => EDUCATOR_COURSES.find(c => c.id === id);
export const getAtRiskStudents = () => {
  const r: { student: EnrolledStudent; courseName: string }[] = [];
  EDUCATOR_COURSES.forEach(c => c.students.filter(s => s.status === 'at-risk').forEach(s => r.push({ student: s, courseName: c.title })));
  return r;
};
export const getUpcomingDeadlines = () => {
  const r: { assessment: Assessment; courseName: string; courseColor: string }[] = [];
  EDUCATOR_COURSES.forEach(c => c.assessments.filter(a => a.deadline && (a.status === 'deployed' || a.status === 'ready')).forEach(a => r.push({ assessment: a, courseName: c.title, courseColor: c.color })));
  return r;
};
export const getPendingReviewCount = () => {
  let n = 0;
  EDUCATOR_COURSES.forEach(c => c.assessments.forEach(a => { n += a.submissions.filter(s => s.status === 'needs-review').length; }));
  return n;
};
