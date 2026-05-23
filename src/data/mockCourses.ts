import { BrainCircuit, Sigma, Code2, FlaskConical, Globe2, Atom, BookOpen, Scale, Microscope, Cpu, Music, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CourseType = 'independent' | 'university-public' | 'university-private';
export type CourseCategory = 'STEM' | 'Humanities' | 'Law' | 'Arts' | 'Computer Science' | 'Medicine';

export interface Course {
  id: string;
  title: string;
  instructor: string;
  university: string | null; // null = independent
  type: CourseType;
  category: CourseCategory;
  description: string;
  enrollmentCount: number;
  rating: number;
  modules: number;
  durationWeeks: number;
  prerequisites: string[];
  syllabus: string[];
  icon: LucideIcon;
  accentColor: string; // tailwind color name for theming
  isEnrolled?: boolean;
  hasReviewed?: boolean;
  userRating?: number;
  userComment?: string;
}

export const MOCK_COURSES: Course[] = [
  // ─── ENROLLED (user's current courses) ───────────────────────────────────────
  {
    id: 'bio-301',
    title: 'Advanced Neurobiology',
    instructor: 'Prof. Elias Vance',
    university: 'MIT',
    type: 'university-public',
    category: 'STEM',
    description: 'A deep exploration of the nervous system — from single neurons to complex brain networks. Covers synaptic transmission, neuroplasticity, and cutting-edge cognitive neuroscience research.',
    enrollmentCount: 2840,
    rating: 4.9,
    modules: 14,
    durationWeeks: 16,
    prerequisites: ['Biology 101', 'General Chemistry'],
    syllabus: ['Neuroanatomy Foundations', 'Synaptic Transmission', 'Neuroplasticity & LTP', 'Brain Mapping Techniques', 'Disorders of the CNS'],
    icon: BrainCircuit,
    accentColor: 'primary-fixed-dim',
    isEnrolled: true,
  },
  {
    id: 'phys-401',
    title: 'Quantum Mechanics II',
    instructor: 'Prof. Sarah Chen',
    university: 'Stanford',
    type: 'university-public',
    category: 'STEM',
    description: 'An advanced treatment of quantum mechanics, covering perturbation theory, quantum field theory foundations, and the measurement problem.',
    enrollmentCount: 1560,
    rating: 4.8,
    modules: 12,
    durationWeeks: 14,
    prerequisites: ['Quantum Mechanics I', 'Linear Algebra', 'Calculus III'],
    syllabus: ['Perturbation Theory', 'Angular Momentum & Spin', 'Identical Particles', 'Introduction to QFT'],
    icon: Sigma,
    accentColor: 'indigo-400',
    isEnrolled: true,
  },
  {
    id: 'cs-202',
    title: 'Algorithms & Data Structures',
    instructor: 'Prof. Alan Turing',
    university: 'MIT',
    type: 'university-public',
    category: 'Computer Science',
    description: 'Fundamental algorithm design paradigms including divide-and-conquer, dynamic programming, and graph algorithms. Analysis of time and space complexity.',
    enrollmentCount: 5120,
    rating: 4.7,
    modules: 18,
    durationWeeks: 12,
    prerequisites: ['Introduction to Programming'],
    syllabus: ['Big-O Notation', 'Sorting & Searching', 'Graph Traversal (BFS/DFS)', 'Dynamic Programming', 'NP-Completeness'],
    icon: Code2,
    accentColor: 'emerald-400',
    isEnrolled: true,
  },

  // ─── GLOBAL / INDEPENDENT COURSES ─────────────────────────────────────────
  {
    id: 'ml-global-01',
    title: 'Machine Learning Fundamentals',
    instructor: 'Dr. Mia Hartwell',
    university: null,
    type: 'independent',
    category: 'Computer Science',
    description: 'A comprehensive, self-paced course covering the mathematical foundations of machine learning. From linear regression to deep neural networks, with hands-on projects.',
    enrollmentCount: 42000,
    rating: 4.9,
    modules: 22,
    durationWeeks: 10,
    prerequisites: ['Python basics', 'Statistics 101'],
    syllabus: ['Linear & Logistic Regression', 'Decision Trees & Random Forests', 'Neural Networks from Scratch', 'CNNs & Computer Vision', 'NLP Basics'],
    icon: Cpu,
    accentColor: 'violet-400',
    isEnrolled: false,
  },
  {
    id: 'phil-hum-01',
    title: 'Philosophy of the Mind',
    instructor: 'Dr. Nolan Greaves',
    university: null,
    type: 'independent',
    category: 'Humanities',
    description: 'Investigates the nature of consciousness, mental states, and the mind-body problem. Draws from analytic philosophy, phenomenology, and cognitive science.',
    enrollmentCount: 8800,
    rating: 4.6,
    modules: 10,
    durationWeeks: 8,
    prerequisites: [],
    syllabus: ['Dualism & Physicalism', 'Functionalism', 'Consciousness & Qualia', 'Free Will & Determinism'],
    icon: BookOpen,
    accentColor: 'amber-400',
    isEnrolled: false,
  },

  // ─── UNIVERSITY PUBLIC COURSES ─────────────────────────────────────────────
  {
    id: 'harv-law-101',
    title: 'Constitutional Law',
    instructor: 'Prof. Margaret Holloway',
    university: 'Harvard',
    type: 'university-public',
    category: 'Law',
    description: 'An introduction to the U.S. Constitution, landmark Supreme Court decisions, and the evolving interpretation of fundamental rights. Open to all Harvard students.',
    enrollmentCount: 3200,
    rating: 4.8,
    modules: 16,
    durationWeeks: 14,
    prerequisites: ['Introduction to Legal Studies'],
    syllabus: ['Foundations of Judicial Review', 'First Amendment Rights', 'Equal Protection Clause', 'Due Process & Privacy'],
    icon: Scale,
    accentColor: 'rose-400',
    isEnrolled: false,
  },
  {
    id: 'ucb-chem-301',
    title: 'Organic Chemistry III',
    instructor: 'Prof. Dmitri Volkov',
    university: 'UC Berkeley',
    type: 'university-public',
    category: 'STEM',
    description: 'Advanced organic chemistry focusing on spectroscopic methods, multi-step synthesis strategies, and modern coupling reactions.',
    enrollmentCount: 980,
    rating: 4.5,
    modules: 15,
    durationWeeks: 16,
    prerequisites: ['Organic Chemistry I', 'Organic Chemistry II'],
    syllabus: ['NMR Spectroscopy', 'Mass Spectrometry', 'Retrosynthetic Analysis', 'Pd-Catalyzed Cross-Coupling'],
    icon: FlaskConical,
    accentColor: 'lime-400',
    isEnrolled: false,
  },
  {
    id: 'stanford-ai-ethics',
    title: 'AI Ethics & Society',
    instructor: 'Prof. Lena Fischer',
    university: 'Stanford',
    type: 'university-public',
    category: 'Humanities',
    description: 'Explores the ethical, social, and policy implications of artificial intelligence. Covers bias in algorithms, privacy, autonomous systems, and the future of work.',
    enrollmentCount: 7400,
    rating: 4.7,
    modules: 12,
    durationWeeks: 10,
    prerequisites: [],
    syllabus: ['Introduction to AI Ethics', 'Algorithmic Bias & Fairness', 'Privacy & Surveillance', 'Autonomous Weapons', 'Policy & Governance'],
    icon: Globe2,
    accentColor: 'sky-400',
    isEnrolled: false,
  },
  {
    id: 'mit-bio-genetics',
    title: 'Molecular Genetics & Genomics',
    instructor: 'Prof. Clara Williams',
    university: 'MIT',
    type: 'university-public',
    category: 'STEM',
    description: 'Covers gene structure, expression, and regulation at the molecular level. Explores the latest genomics technologies including CRISPR and sequencing methodologies.',
    enrollmentCount: 2100,
    rating: 4.9,
    modules: 20,
    durationWeeks: 18,
    prerequisites: ['Molecular Biology 101', 'Biochemistry I'],
    syllabus: ['DNA Replication & Repair', 'Transcription & Translation', 'Gene Regulation', 'CRISPR-Cas9 Technology', 'Genome-Wide Association Studies'],
    icon: Microscope,
    accentColor: 'teal-400',
    isEnrolled: false,
  },
  {
    id: 'oxford-phys',
    title: 'Particle Physics & the Standard Model',
    instructor: 'Prof. Henry Atkinson',
    university: 'Oxford',
    type: 'university-public',
    category: 'STEM',
    description: 'A rigorous introduction to the Standard Model of particle physics. Topics include quark theory, force-carrier bosons, and the Higgs mechanism.',
    enrollmentCount: 1340,
    rating: 4.6,
    modules: 14,
    durationWeeks: 12,
    prerequisites: ['Quantum Mechanics I', 'Special Relativity'],
    syllabus: ['Symmetry & Conservation Laws', 'Quarks & Leptons', 'Electroweak Unification', 'QCD & Strong Force', 'Beyond the Standard Model'],
    icon: Atom,
    accentColor: 'cyan-400',
    isEnrolled: false,
  },
  {
    id: 'nyu-music-theory',
    title: 'Modern Music Theory',
    instructor: 'Prof. Isabelle Moreau',
    university: 'NYU',
    type: 'university-public',
    category: 'Arts',
    description: 'Covers tonal harmony, modal scales, post-tonal theory, and contemporary compositional techniques. Bridges classical foundations with modern electronic music.',
    enrollmentCount: 4200,
    rating: 4.7,
    modules: 11,
    durationWeeks: 10,
    prerequisites: [],
    syllabus: ['Tonal Harmony Review', 'Modal Scales & Jazz Theory', 'Serialism & Atonality', 'Electronic & Spectral Music'],
    icon: Music,
    accentColor: 'pink-400',
    isEnrolled: false,
  },
  {
    id: 'independent-ux',
    title: 'UX Design for Developers',
    instructor: 'Marco Reyes',
    university: null,
    type: 'independent',
    category: 'Arts',
    description: 'A practical, project-driven course teaching developers the core principles of user experience design, from wireframing to high-fidelity prototyping.',
    enrollmentCount: 18600,
    rating: 4.8,
    modules: 14,
    durationWeeks: 8,
    prerequisites: ['Basic HTML/CSS'],
    syllabus: ['Design Thinking', 'User Research Methods', 'Wireframing & Prototyping', 'Usability Testing', 'Design Systems'],
    icon: Palette,
    accentColor: 'orange-400',
    isEnrolled: false,
  },
];

export const UNIVERSITIES = ['All Universities', 'MIT', 'Stanford', 'Harvard', 'UC Berkeley', 'Oxford', 'NYU', 'Independent'];
export const CATEGORIES: (CourseCategory | 'All')[] = ['All', 'STEM', 'Computer Science', 'Humanities', 'Law', 'Arts', 'Medicine'];
export const COURSE_TYPES = ['All Types', 'Independent', 'University - Public', 'University - Private'];
