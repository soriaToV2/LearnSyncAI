import { Brain, FlaskConical, Zap, Code, Trophy, Flame, BrainCircuit } from 'lucide-react';

export interface Question {
  question: string;
  options: string[];
  correct: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface TermItem {
  term: string;
  definition: string;
}

export interface CrosswordCell {
  r: number;
  c: number;
  correctLetter: string;
  label?: string;
}

export interface CourseGameData {
  courseName: string;
  terms: TermItem[];
  trivia: Question[];
  crossword: CrosswordCell[];
  crosswordClues: {
    across1: string;
    across2: string;
    down1: string;
  };
}

export const COURSE_DATABASE: Record<string, CourseGameData> = {
  neuroscience: {
    courseName: 'Introduction to Neuroscience',
    terms: [
      { term: 'Action Potential', definition: 'A rapid change in membrane potential that propagates along the axon.' },
      { term: 'Cerebellum', definition: 'Brain structure associated with coordination of voluntary movement.' },
      { term: 'Myelin Sheath', definition: 'Lipid-rich layer around axons that accelerates impulse transmission.' },
      { term: 'Acetylcholine', definition: 'The primary neurotransmitter active at the neuromuscular junction.' }
    ],
    trivia: [
      { question: 'What is the main cell body of a neuron called?', options: ['Soma', 'Axon', 'Dendrite', 'Synapse'], correct: 'Soma', difficulty: 'easy' },
      { question: 'Which structure acts as the protective cover and insulator for neuron axons?', options: ['Myelin Sheath', 'Synaptic Cleft', 'Soma', 'Dendrite'], correct: 'Myelin Sheath', difficulty: 'easy' },
      { question: 'Which ion is primarily responsible for triggering neurotransmitter vesicle release?', options: ['Calcium (Ca2+)', 'Sodium (Na+)', 'Potassium (K+)', 'Chloride (Cl-)'], correct: 'Calcium (Ca2+)', difficulty: 'medium' },
      { question: 'What is the typical resting membrane potential of a neuron?', options: ['+30 mV', '-55 mV', '0 mV', '-70 mV'], correct: '-70 mV', difficulty: 'medium' },
      { question: 'Which protein complex mediates the docking and fusion of synaptic vesicles to the presynaptic membrane?', options: ['SNARE complex', 'Sodium-Potassium ATPase', 'Myosin complex', 'G-protein receptor'], correct: 'SNARE complex', difficulty: 'hard' },
      { question: 'Which brain structure acts as the primary sensory relay station, routing inputs to the cortex?', options: ['Thalamus', 'Hypothalamus', 'Corpus Callosum', 'Hippocampus'], correct: 'Thalamus', difficulty: 'hard' }
    ],
    crossword: [
      { r: 0, c: 0, correctLetter: 'S', label: '1' },
      { r: 0, c: 1, correctLetter: 'O' },
      { r: 0, c: 2, correctLetter: 'M' },
      { r: 0, c: 3, correctLetter: 'A' },
      { r: 1, c: 0, correctLetter: 'P' },
      { r: 2, c: 0, correctLetter: 'A', label: '2' },
      { r: 3, c: 0, correctLetter: 'C' },
      { r: 4, c: 0, correctLetter: 'E' },
      { r: 2, c: 1, correctLetter: 'X' },
      { r: 2, c: 2, correctLetter: 'O' },
      { r: 2, c: 3, correctLetter: 'N' }
    ],
    crosswordClues: {
      across1: 'The cell body of a neuron containing the nucleus. (4 letters)',
      across2: 'Long cable-like projection carrying electrical impulses away. (4 letters)',
      down1: 'The tiny gaps/pathways where neurotransmitters flow. (5 letters)'
    },
  },
  chemistry: {
    courseName: 'Organic Chemistry I',
    terms: [
      { term: 'Covalent Bond', definition: 'A chemical bond that involves the sharing of electron pairs between atoms.' },
      { term: 'Isomer', definition: 'Molecules with the same molecular formula but different chemical structures.' },
      { term: 'Catalyst', definition: 'A substance that increases the rate of a chemical reaction without being consumed.' },
      { term: 'Benzene', definition: 'An aromatic hydrocarbon with a ring structure of six carbon atoms.' }
    ],
    trivia: [
      { question: 'Which element is the fundamental backbone of all organic molecules?', options: ['Carbon', 'Oxygen', 'Nitrogen', 'Hydrogen'], correct: 'Carbon', difficulty: 'easy' },
      { question: 'What type of bond involves the sharing of electron pairs between atoms?', options: ['Covalent', 'Ionic', 'Hydrogen', 'Metallic'], correct: 'Covalent', difficulty: 'easy' },
      { question: 'What compounds have the same chemical formula but different structural arrangements?', options: ['Isomers', 'Isotopes', 'Allotropes', 'Monomers'], correct: 'Isomers', difficulty: 'medium' },
      { question: 'Which functional group is characterized by a carbon double-bonded to oxygen (-C=O)?', options: ['Carbonyl', 'Hydroxyl', 'Carboxyl', 'Amino'], correct: 'Carbonyl', difficulty: 'medium' },
      { question: 'What is the name of the reaction that converts an ester into an alcohol and a carboxylic acid salt?', options: ['Saponification', 'Esterification', 'Hydration', 'Polymerization'], correct: 'Saponification', difficulty: 'hard' },
      { question: 'Which molecular orbital theory explains the extra stability of benzene?', options: ['Resonance/Delocalization', 'Hybridization', 'Van der Waals forces', 'Ionic interaction'], correct: 'Resonance/Delocalization', difficulty: 'hard' }
    ],
    crossword: [
      { r: 0, c: 0, correctLetter: 'B', label: '1' },
      { r: 0, c: 1, correctLetter: 'O' },
      { r: 0, c: 2, correctLetter: 'N' },
      { r: 0, c: 3, correctLetter: 'D' },
      { r: 1, c: 0, correctLetter: 'A' },
      { r: 2, c: 0, correctLetter: 'S', label: '2' },
      { r: 3, c: 0, correctLetter: 'E' },
      { r: 4, c: 0, correctLetter: 'S' },
      { r: 2, c: 1, correctLetter: 'A' },
      { r: 2, c: 2, correctLetter: 'L' },
      { r: 2, c: 3, correctLetter: 'T' }
    ],
    crosswordClues: {
      across1: 'A chemical connection formed by sharing or transferring electrons. (4 letters)',
      across2: 'An ionic compound formed by neutralization of an acid and a base. (4 letters)',
      down1: 'Chemical species that donate electrons or accept protons. (5 letters)'
    },
  },
  physics: {
    courseName: 'General Physics II',
    terms: [
      { term: 'Inertia', definition: 'The resistance of any physical object to any change in its velocity.' },
      { term: 'Entropy', definition: 'A thermodynamic quantity representing the unavailability of a system\'s energy for work.' },
      { term: 'Velocity', definition: 'The rate of change of an object\'s position with respect to a frame of reference and time.' },
      { term: 'Kinetic Energy', definition: 'The energy that an object possesses due to its motion.' }
    ],
    trivia: [
      { question: 'What is the standard unit of force in the SI system?', options: ['Newton', 'Joule', 'Watt', 'Pascal'], correct: 'Newton', difficulty: 'easy' },
      { question: 'Which law states that for every action, there is an equal and opposite reaction?', options: ['Newton\'s Third Law', 'Newton\'s First Law', 'Ohm\'s Law', 'Faraday\'s Law'], correct: 'Newton\'s Third Law', difficulty: 'easy' },
      { question: 'What thermodynamic variable measures the degree of disorder or randomness in a system?', options: ['Entropy', 'Enthalpy', 'Temperature', 'Pressure'], correct: 'Entropy', difficulty: 'medium' },
      { question: 'What is the rate of change of velocity over time called?', options: ['Acceleration', 'Momentum', 'Friction', 'Torque'], correct: 'Acceleration', difficulty: 'medium' },
      { question: 'Which constant represents the speed of light in a vacuum?', options: ['c', 'G', 'h', 'k'], correct: 'c', difficulty: 'hard' },
      { question: 'What principle states that it is impossible to simultaneously measure both position and momentum of a particle?', options: ['Heisenberg Uncertainty Principle', 'Pauli Exclusion Principle', 'Schrodinger Theorem', 'Bragg\'s Law'], correct: 'Heisenberg Uncertainty Principle', difficulty: 'hard' }
    ],
    crossword: [
      { r: 0, c: 0, correctLetter: 'W', label: '1' },
      { r: 0, c: 1, correctLetter: 'A' },
      { r: 0, c: 2, correctLetter: 'V' },
      { r: 0, c: 3, correctLetter: 'E' },
      { r: 1, c: 0, correctLetter: 'O' },
      { r: 2, c: 0, correctLetter: 'R', label: '2' },
      { r: 3, c: 0, correctLetter: 'K' },
      { r: 4, c: 0, correctLetter: 'S' },
      { r: 2, c: 1, correctLetter: 'A' },
      { r: 2, c: 2, correctLetter: 'T' },
      { r: 2, c: 3, correctLetter: 'E' }
    ],
    crosswordClues: {
      across1: 'A disturbance that transfers energy through matter or space. (4 letters)',
      across2: 'Amount of energy output or speed measured in watts. (4 letters)',
      down1: 'Activities where force creates physical displacement. (5 letters)'
    },
  },
  webdev: {
    courseName: 'Full-Stack Web Development',
    terms: [
      { term: 'React State', definition: 'An internal data storage object that holds component memory and updates dynamically.' },
      { term: 'Closure', definition: 'A function that retains access to its outer lexical scope even when executed outside.' },
      { term: 'Endpoint', definition: 'A specific destination URL on an API server where resources can be accessed.' },
      { term: 'Flexbox', definition: 'A CSS layout model designed for laying out items in a single dimension.' }
    ],
    trivia: [
      { question: 'Which programming language defines the structural blueprint of a web page?', options: ['HTML', 'CSS', 'JavaScript', 'SQL'], correct: 'HTML', difficulty: 'easy' },
      { question: 'What does CSS stand for?', options: ['Cascading Style Sheets', 'Complex Style Syntax', 'Creative Style Sheets', 'Computer State System'], correct: 'Cascading Style Sheets', difficulty: 'easy' },
      { question: 'Which hook is used to handle side effects in functional React components?', options: ['useEffect', 'useState', 'useContext', 'useReducer'], correct: 'useEffect', difficulty: 'medium' },
      { question: 'What JavaScript keyword is used to declare a variable scoped to the block?', options: ['let', 'var', 'global', 'def'], correct: 'let', difficulty: 'medium' },
      { question: 'What is the terminology for execution context containing variables referenced by inner functions?', options: ['Closure', 'Event Loop', 'Prototype Chain', 'Call Stack'], correct: 'Closure', difficulty: 'hard' },
      { question: 'Which mechanism prevents layout shifting by reserving dimensions during rendering?', options: ['Aspect Ratio sizing', 'Flex basis auto', 'Lazy loading without bounds', 'Repaint triggers'], correct: 'Aspect Ratio sizing', difficulty: 'hard' }
    ],
    crossword: [
      { r: 0, c: 0, correctLetter: 'H', label: '1' },
      { r: 0, c: 1, correctLetter: 'T' },
      { r: 0, c: 2, correctLetter: 'M' },
      { r: 0, c: 3, correctLetter: 'L' },
      { r: 1, c: 0, correctLetter: 'T' },
      { r: 2, c: 0, correctLetter: 'T', label: '2' },
      { r: 3, c: 0, correctLetter: 'P' },
      { r: 4, c: 0, correctLetter: 'S' },
      { r: 2, c: 1, correctLetter: 'E' },
      { r: 2, c: 2, correctLetter: 'S' },
      { r: 2, c: 3, correctLetter: 'T' }
    ],
    crosswordClues: {
      across1: 'The standard markup language for creating web pages. (4 letters)',
      across2: 'An evaluation validation block or API testing interface. (4 letters)',
      down1: 'Secure transfer protocols executing on port 443. (5 letters)'
    },
  }
};

export const getCourseDisplayInfo = (course: { id: string; title: string; category: string }) => {
  const idLower = course.id.toLowerCase();
  const titleLower = course.title.toLowerCase();

  if (titleLower.includes('neuro') || titleLower.includes('biology') || idLower.includes('bio')) {
    return {
      gameKey: 'neuroscience' as const,
      icon: Brain,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10'
    };
  }
  if (titleLower.includes('chemistry') || idLower.includes('chem')) {
    return {
      gameKey: 'chemistry' as const,
      icon: FlaskConical,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10'
    };
  }
  if (titleLower.includes('physics') || titleLower.includes('quantum') || idLower.includes('phys')) {
    return {
      gameKey: 'physics' as const,
      icon: Zap,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10'
    };
  }
  return {
    gameKey: 'webdev' as const,
    icon: Code,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10'
  };
};

export const getCourseResources = (courseId: string): string[] => {
  const normalized = courseId.toLowerCase();
  if (normalized.includes('bio') || normalized.includes('neuro')) {
    return [
      'Synaptic_Pathways_Ch4.pdf',
      'Lecture_03_Action_Potentials.pptx',
      'Study_Guide_Midterm.docx',
      'Neuroanatomy_Handout.pdf'
    ];
  }
  if (normalized.includes('phys') || normalized.includes('quantum')) {
    return [
      'Perturbation_Theory_Intro.pdf',
      'Lecture_07_Angular_Momentum.pptx',
      'Quantum_Field_Theory_Foundations.pdf',
      'Spin_Calculations_Sheet.docx'
    ];
  }
  if (normalized.includes('cs') || normalized.includes('algorithm')) {
    return [
      'Big_O_CheatSheet.pdf',
      'Sorting_Algorithms_Visualized.pptx',
      'Graph_Traversals_BFS_DFS.docx',
      'Dynamic_Programming_Practice.pdf'
    ];
  }
  return [
    'Course_Syllabus_Overview.pdf',
    'Lecture_Slides_Week1.pptx',
    'Recommended_Readings.docx',
    'Practice_Quiz_Questions.pdf'
  ];
};

export const BADGES = [
  { id: 'first-win', icon: Trophy, label: 'First Win', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', earned: true },
  { id: 'hot-streak', icon: Flame, label: '5-Day Streak', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20', earned: true },
  { id: 'master-mind', icon: BrainCircuit, label: 'Mastermind', color: 'text-violet-400', bg: 'bg-violet-400/10', border: 'border-violet-400/20', earned: false },
  { id: 'trivia-ace', icon: Zap, label: 'Trivia Ace', color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20', earned: true },
];
