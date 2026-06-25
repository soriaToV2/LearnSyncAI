import React, { useState, useEffect } from 'react';
import { Trophy, Gamepad2, BrainCircuit, Zap, Award, RefreshCw, CheckCircle2, XCircle, ArrowRight, Hourglass, HelpCircle, Sparkles, TrendingUp, AlertCircle, Layers, ChevronDown, FlaskConical, Code, Brain, FileText, Check, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import Modal from '../../components/ui/Modal';
import { MOCK_COURSES, Course } from '../../data/mockCourses';

interface Question {
  question: string;
  options: string[];
  correct: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface TermItem {
  term: string;
  definition: string;
}

interface CrosswordCell {
  r: number;
  c: number;
  correctLetter: string;
  label?: string;
}

interface CourseGameData {
  courseName: string;
  terms: TermItem[];
  trivia: Question[];
  crossword: CrosswordCell[];
  crosswordClues: {
    across1: string;
    across2: string;
    down1: string;
  };
  boggleGrid: string[][];
  boggleWords: string[];
}

const COURSE_DATABASE: Record<string, CourseGameData> = {
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
    boggleGrid: [
      ['S', 'O', 'M', 'A'],
      ['T', 'E', 'X', 'P'],
      ['I', 'O', 'N', 'S'],
      ['G', 'L', 'I', 'A']
    ],
    boggleWords: ['SOMA', 'ION', 'IONS', 'GLIA', 'AXON', 'SOMA', 'SOIL', 'AXIS', 'ATOM', 'ONIONS', 'LION']
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
    boggleGrid: [
      ['B', 'O', 'N', 'D'],
      ['A', 'C', 'I', 'D'],
      ['B', 'A', 'S', 'E'],
      ['L', 'I', 'N', 'K']
    ],
    boggleWords: ['BOND', 'ACID', 'BASE', 'LINK', 'COIN', 'BASES', 'BONS', 'CASE', 'DISK']
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
    boggleGrid: [
      ['W', 'A', 'V', 'E'],
      ['M', 'A', 'S', 'S'],
      ['W', 'O', 'R', 'K'],
      ['J', 'O', 'U', 'L']
    ],
    boggleWords: ['WAVE', 'MASS', 'WORK', 'JOULE', 'SAVE', 'SAME', 'WORK', 'SOUL', 'VOLE']
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
    boggleGrid: [
      ['H', 'T', 'M', 'L'],
      ['N', 'O', 'D', 'E'],
      ['C', 'O', 'D', 'E'],
      ['L', 'I', 'N', 'K']
    ],
    boggleWords: ['HTML', 'NODE', 'CODE', 'LINK', 'MODE', 'LINE', 'LINK', 'LIME', 'MOTE']
  }
};

interface CardItem {
  id: string;
  type: 'term' | 'definition';
  text: string;
  matchId: string;
}

const getCourseDisplayInfo = (course: { id: string; title: string; category: string }) => {
  const idLower = course.id.toLowerCase();
  const titleLower = course.title.toLowerCase();
  const catLower = course.category.toLowerCase();

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

const getCourseResources = (courseId: string): string[] => {
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

export default function PlayMeGames() {
  const enrolledCourses = MOCK_COURSES.filter(c => c.isEnrolled);

  // Selected course
  const [selectedCourse, setSelectedCourse] = useState<string>(() => {
    return enrolledCourses[0]?.id || 'bio-301';
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // XP & progression
  const [totalXp, setTotalXp] = useState(2450);
  const [streak, setStreak] = useState(5);
  const [gameLevel, setGameLevel] = useState(4);
  const [activeGame, setActiveGame] = useState<'selection' | 'matching' | 'trivia' | 'crossword' | 'boggle'>('selection');

  // Game Setup Modal states
  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState<'matching' | 'crossword' | 'trivia' | 'boggle' | null>(null);
  const [modalSelectedCourse, setModalSelectedCourse] = useState<string>(selectedCourse);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [finalConnectedResources, setFinalConnectedResources] = useState<string[]>([]);

  useEffect(() => {
    if (isBuildModalOpen && modalSelectedCourse) {
      setSelectedResources(getCourseResources(modalSelectedCourse));
    }
  }, [modalSelectedCourse, isBuildModalOpen]);

  // AI adaptation states
  const [currentMastery, setCurrentMastery] = useState(68);
  const [aiDifficulty, setAiDifficulty] = useState<'Adaptive-Easy' | 'Adaptive-Medium' | 'Adaptive-Hard'>('Adaptive-Medium');
  const [aiLogs, setAiLogs] = useState<string[]>([
    'AI Engine initialized: Analyzing recent student quiz response latencies...',
    'Dynamic assessment patterns matched. Mastery level estimated at 68%.',
    'Adaptive Difficulty: Set to Adaptive-Medium.'
  ]);
  const [recentLatency, setRecentLatency] = useState<number | null>(null);

  const currentCourse = MOCK_COURSES.find(c => c.id === selectedCourse) || enrolledCourses[0] || MOCK_COURSES[0];
  const displayInfo = getCourseDisplayInfo(currentCourse);
  const activeData = COURSE_DATABASE[displayInfo.gameKey];

  // Helper
  const logAiAction = (msg: string) => {
    setAiLogs(prev => [msg, ...prev.slice(0, 10)]);
  };

  // Switch course
  const handleCourseChange = (courseId: string) => {
    setSelectedCourse(courseId);
    setActiveGame('selection');
    const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || currentCourse;
    const targetInfo = getCourseDisplayInfo(targetCourse);
    const targetData = COURSE_DATABASE[targetInfo.gameKey];
    logAiAction(`AI Generation Triggered: Loaded syllabus vocabulary & study material for [${targetCourse.title}].`);
    logAiAction(`AI Tuning: Formulated dynamic crossword maps & Boggle matching dictionaries for [${targetData.courseName}].`);
  };

  // Matching game state
  const [matchingCards, setMatchingCards] = useState<CardItem[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [failedPair, setFailedPair] = useState<[string, string] | null>(null);
  const [matchingVictory, setMatchingVictory] = useState(false);
  const [matcherClueId, setMatcherClueId] = useState<string | null>(null);

  // Trivia game state
  const [triviaQueue, setTriviaQueue] = useState<Question[]>([]);
  const [currentTriviaIdx, setCurrentTriviaIdx] = useState(0);
  const [triviaSelected, setTriviaSelected] = useState<string | null>(null);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaFinished, setTriviaFinished] = useState(false);
  const [triviaCorrectStreak, setTriviaCorrectStreak] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState<number>(0);
  const [triviaTimeLeft, setTriviaTimeLeft] = useState(5);

  const handleTriviaTimeout = () => {
    setTriviaSelected('TIMEOUT_EXPIRED');
    setTriviaCorrectStreak(0);
    setCurrentMastery(prev => Math.max(prev - 6, 10));
    logAiAction("Time's up! Question answered incorrectly due to timeout. Trivia Blast complete.");

    setTimeout(() => {
      setTriviaFinished(true);
      setTriviaScore(score => {
        setTotalXp(xp => xp + (score * 100));
        return score;
      });
    }, 1500);
  };

  useEffect(() => {
    if (activeGame !== 'trivia' || triviaFinished || triviaSelected !== null) return;

    const timer = setInterval(() => {
      setTriviaTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTriviaTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeGame, triviaFinished, triviaSelected, currentTriviaIdx, triviaQueue]);

  // Crossword game state
  const [crosswordAnswers, setCrosswordAnswers] = useState<Record<string, string>>({});
  const [crosswordChecked, setCrosswordChecked] = useState(false);
  const [crosswordVictory, setCrosswordVictory] = useState(false);
  const [crosswordCluesUsed, setCrosswordCluesUsed] = useState(0);

  // Boggle game state
  const [boggleSelection, setBoggleSelection] = useState<{ r: number; c: number }[]>([]);
  const [boggleFoundWords, setBoggleFoundWords] = useState<string[]>([]);
  const [boggleTimeLeft, setBoggleTimeLeft] = useState(60);
  const [boggleActive, setBoggleActive] = useState(false);
  const [boggleFinished, setBoggleFinished] = useState(false);
  const [boggleMessage, setBoggleMessage] = useState<{ text: string; success: boolean } | null>(null);

  const startMatchingGame = (courseId = selectedCourse) => {
    setActiveGame('matching');
    setSelectedCardId(null);
    setMatchedIds([]);
    setFailedPair(null);
    setMatchingVictory(false);
    setMatcherClueId(null);

    const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || currentCourse;
    const targetInfo = getCourseDisplayInfo(targetCourse);
    const targetData = COURSE_DATABASE[targetInfo.gameKey];

    // Shuffle cards
    const cards: CardItem[] = [];
    targetData.terms.forEach((item, idx) => {
      const matchId = `pair-${idx}`;
      cards.push({ id: `term-${idx}`, type: 'term', text: item.term, matchId });
      cards.push({ id: `def-${idx}`, type: 'definition', text: item.definition, matchId });
    });
    cards.sort(() => Math.random() - 0.5);
    setMatchingCards(cards);

    logAiAction('Term Matcher launched. AI tracking matching mistakes to offer visual cues.');
  };

  const startTriviaGame = (courseId = selectedCourse) => {
    setActiveGame('trivia');
    setCurrentTriviaIdx(0);
    setTriviaSelected(null);
    setTriviaScore(0);
    setTriviaFinished(false);
    setTriviaCorrectStreak(0);
    setQuestionStartTime(Date.now());
    setTriviaTimeLeft(5);

    const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || currentCourse;
    const targetInfo = getCourseDisplayInfo(targetCourse);
    const targetData = COURSE_DATABASE[targetInfo.gameKey];

    // Build rapid queue of exactly 10 questions by cycling course trivia questions
    const courseTrivia = targetData.trivia;
    const initialQueue: Question[] = [];
    for (let i = 0; i < 10; i++) {
      initialQueue.push(courseTrivia[i % courseTrivia.length]);
    }

    setTriviaQueue(initialQueue);
    logAiAction(`Trivia Blast launched with 10 questions. Speed Mode active (5s limit).`);
  };

  const startCrosswordGame = (courseId = selectedCourse) => {
    setActiveGame('crossword');
    setCrosswordAnswers({});
    setCrosswordChecked(false);
    setCrosswordVictory(false);
    setCrosswordCluesUsed(0);
    logAiAction('Crossword grid loaded. Clue hints affect dynamic accuracy scores.');
  };

  const startBoggleGame = (courseId = selectedCourse) => {
    setActiveGame('boggle');
    setBoggleSelection([]);
    setBoggleFoundWords([]);

    // Scale timer by mastery
    const dynamicTime = currentMastery > 80 ? 45 : currentMastery < 50 ? 80 : 60;
    setBoggleTimeLeft(dynamicTime);
    setBoggleActive(true);
    setBoggleFinished(false);
    setBoggleMessage(null);

    logAiAction(`Boggle active. Timer set to ${dynamicTime}s based on mastery.`);
  };

  const handleBuildAndLaunchGame = () => {
    if (selectedResources.length === 0 || !selectedGameType) return;

    setSelectedCourse(modalSelectedCourse);
    setFinalConnectedResources(selectedResources);
    setIsBuildModalOpen(false);

    if (selectedGameType === 'matching') {
      startMatchingGame(modalSelectedCourse);
    } else if (selectedGameType === 'crossword') {
      startCrosswordGame(modalSelectedCourse);
    } else if (selectedGameType === 'trivia') {
      startTriviaGame(modalSelectedCourse);
    } else if (selectedGameType === 'boggle') {
      startBoggleGame(modalSelectedCourse);
    }
  };

  const handleCardClick = (id: string) => {
    if (matchedIds.includes(id) || failedPair) return;

    if (!selectedCardId) {
      setSelectedCardId(id);
      setMatcherClueId(null);
      return;
    }

    if (selectedCardId === id) {
      setSelectedCardId(null);
      return;
    }

    const firstCard = matchingCards.find(c => c.id === selectedCardId)!;
    const secondCard = matchingCards.find(c => c.id === id)!;

    if (firstCard.matchId === secondCard.matchId && firstCard.type !== secondCard.type) {
      const newMatched = [...matchedIds, firstCard.id, secondCard.id];
      setMatchedIds(newMatched);
      setSelectedCardId(null);
      setMatcherClueId(null);

      setCurrentMastery(prev => Math.min(prev + 3, 100));
      logAiAction(`Correct match: ${firstCard.text}! Mastery increased.`);

      if (newMatched.length === matchingCards.length) {
        setMatchingVictory(true);
        setTotalXp(prev => prev + 400);
        logAiAction('Term Matcher cleared. Efficacy rate 100%.');
      }

    } else {
      setFailedPair([firstCard.id, secondCard.id]);

      const partner = matchingCards.find(c => c.matchId === firstCard.matchId && c.id !== firstCard.id)!;
      setMatcherClueId(partner.id);

      setCurrentMastery(prev => Math.max(prev - 4, 10));
      logAiAction(`Mismatch error. AI enabled target highlighter for card partner.`);

      setTimeout(() => {
        setFailedPair(null);
        setSelectedCardId(null);
      }, 1000);
    }
  };

  const handleTriviaAnswer = (option: string) => {
    if (triviaSelected) return;
    setTriviaSelected(option);

    const isCorrect = option === triviaQueue[currentTriviaIdx].correct;
    const latency = (Date.now() - questionStartTime) / 1000;
    setRecentLatency(latency);

    if (isCorrect) {
      setTriviaScore(prev => prev + 1);
      const newStreak = triviaCorrectStreak + 1;
      setTriviaCorrectStreak(newStreak);

      setCurrentMastery(prev => Math.min(prev + 5, 100));
      logAiAction(`Correct answer. Latency: ${latency.toFixed(1)}s. Streak: ${newStreak}.`);
    } else {
      setTriviaCorrectStreak(0);
      setCurrentMastery(prev => Math.max(prev - 6, 10));
      logAiAction(`Incorrect response. Latency: ${latency.toFixed(1)}s. Trivia Blast complete.`);
    }

    setTimeout(() => {
      if (isCorrect) {
        if (currentTriviaIdx < triviaQueue.length - 1) {
          setCurrentTriviaIdx(prev => prev + 1);
          setTriviaSelected(null);
          setTriviaTimeLeft(5);
          setQuestionStartTime(Date.now());
        } else {
          setTriviaFinished(true);
          setTriviaScore(score => {
            setTotalXp(xp => xp + (score * 100));
            return score;
          });
        }
      } else {
        // Incorrect answer ends the game immediately
        setTriviaFinished(true);
        setTriviaScore(score => {
          setTotalXp(xp => xp + (score * 100));
          return score;
        });
      }
    }, 1500);
  };

  const handleCrosswordInput = (r: number, c: number, val: string) => {
    const key = `${r}-${c}`;
    setCrosswordAnswers(prev => ({
      ...prev,
      [key]: val.toUpperCase().slice(-1)
    }));
    setCrosswordChecked(false);
  };

  const useCrosswordHint = () => {
    const emptyCell = activeData.crossword.find(cell => {
      const key = `${cell.r}-${cell.c}`;
      return crosswordAnswers[key] !== cell.correctLetter;
    });

    if (emptyCell) {
      const key = `${emptyCell.r}-${emptyCell.c}`;
      setCrosswordAnswers(prev => ({
        ...prev,
        [key]: emptyCell.correctLetter
      }));
      setCrosswordCluesUsed(prev => prev + 1);
      setCurrentMastery(prev => Math.max(prev - 5, 15));
      logAiAction(`AI Clue trigger: filled cell (${emptyCell.r}, ${emptyCell.c}). Mastery calibrated.`);
    }
  };

  const checkCrosswordAnswers = () => {
    let allCorrect = true;
    activeData.crossword.forEach((cell) => {
      const key = `${cell.r}-${cell.c}`;
      if (crosswordAnswers[key] !== cell.correctLetter) {
        allCorrect = false;
      }
    });

    setCrosswordChecked(true);
    if (allCorrect) {
      setCrosswordVictory(true);
      setTotalXp(prev => prev + 400);
      logAiAction('Crossword verification success. Full schema matching completed.');
    } else {
      logAiAction('Crossword checking: errors found. Review empty or red cells.');
    }
  };

  const handleBoggleCellClick = (r: number, c: number) => {
    if (!boggleActive) return;

    const last = boggleSelection[boggleSelection.length - 1];
    const isSelected = boggleSelection.some(cell => cell.r === r && cell.c === c);

    if (isSelected) {
      if (last && last.r === r && last.c === c) {
        setBoggleSelection(prev => prev.slice(0, -1));
      }
      return;
    }

    if (last) {
      const isAdjacent = Math.abs(r - last.r) <= 1 && Math.abs(c - last.c) <= 1;
      if (!isAdjacent) {
        setBoggleMessage({ text: 'Letters must be adjacent!', success: false });
        setTimeout(() => setBoggleMessage(null), 1500);
        return;
      }
    }

    setBoggleSelection(prev => [...prev, { r, c }]);
    setBoggleMessage(null);
  };

  const getBoggleSpelledWord = () => {
    return boggleSelection.map(cell => activeData.boggleGrid[cell.r][cell.c]).join('');
  };

  const submitBoggleWord = () => {
    const word = getBoggleSpelledWord();
    if (word.length < 3) {
      setBoggleMessage({ text: 'Word must be at least 3 letters long!', success: false });
      return;
    }

    if (boggleFoundWords.includes(word)) {
      setBoggleMessage({ text: 'Already found that word!', success: false });
      return;
    }

    if (activeData.boggleWords.includes(word)) {
      const updatedWords = [...boggleFoundWords, word];
      setBoggleFoundWords(updatedWords);
      setBoggleSelection([]);
      setBoggleMessage({ text: `Found: ${word}! (+100 XP)`, success: true });

      setCurrentMastery(prev => Math.min(prev + 4, 100));
      logAiAction(`Vocabulary hit: ${word}. Recalibrating memory nodes.`);
    } else {
      setBoggleMessage({ text: 'Not a valid course word!', success: false });
    }

    setTimeout(() => setBoggleMessage(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Header / Stats Panel */}
      <header className="relative md:sticky md:top-0 w-full border-b border-white/10 bg-page-80 backdrop-blur-md shadow-sm z-40 px-4 md:px-8 py-5 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <Gamepad2 className="w-9 h-9 text-primary-fixed-dim mt-1 shrink-0" />
            <div>
              <h1 className="text-2xl font-display font-bold text-on-background flex items-center gap-2">
                PlayMe Games
              </h1>
              <p className="text-sm font-sans text-slate-400 mt-1">
                Reinforce course topics dynamically through interactive study games and earn XP.
              </p>
            </div>
          </div>

          {/* Gamification stats */}
          <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 sm:gap-4 bg-surface-container-high/40 p-2 sm:p-2.5 rounded-xl border border-white/5 shadow-inner w-full sm:w-auto">
            <div className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-1 bg-white/5 border border-white/5 rounded-lg">
              <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-semibold text-white whitespace-nowrap">{totalXp} XP</span>
            </div>
            <div className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-1 bg-white/5 border border-white/5 rounded-lg">
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
                {streak} Day<span className="hidden sm:inline"> Streak</span>
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-1 bg-white/5 border border-white/5 rounded-lg">
              <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400 shrink-0" />
              <span className="font-display text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
                <span className="sm:hidden">Lvl </span><span className="hidden sm:inline">Level </span>{gameLevel}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-6xl mx-auto w-full">

        {activeGame === 'selection' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Game 1 Card: Term Matcher */}
              <div className="glass-card rounded-2xl border border-white/5 hover:border-primary-fixed-dim/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-primary-fixed-dim/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary-fixed-dim/5 rounded-full blur-2xl group-hover:bg-primary-fixed-dim/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 text-primary-fixed-dim mb-4 group-hover:scale-110 transition-transform">
                    <BrainCircuit className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">Term Matcher</h3>
                  <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
                    Connect core course terms to their exact scientific definitions. Match them all with zero errors to secure maximum XP!
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedGameType('matching');
                    setModalSelectedCourse(selectedCourse);
                    setIsBuildModalOpen(true);
                  }}
                  className="w-full py-3 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 text-primary-fixed-dim font-display font-semibold hover:bg-primary-fixed-dim hover:text-on-primary-fixed transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
                >
                  Play Game <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Game 2 Card: Crossword */}
              <div className="glass-card rounded-2xl border border-white/5 hover:border-amber-400/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-amber-400/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/5 rounded-full blur-2xl group-hover:bg-amber-400/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-amber-400/10 flex items-center justify-center border border-amber-400/20 text-amber-400 mb-4 group-hover:scale-110 transition-transform">
                    <HelpCircle className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">Crossword</h3>
                  <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
                    Solve course cross-clues inside an interactive grid. Read the horizontal and vertical hints to identify core structures.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedGameType('crossword');
                    setModalSelectedCourse(selectedCourse);
                    setIsBuildModalOpen(true);
                  }}
                  className="w-full py-3 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-400 font-display font-semibold hover:bg-amber-400 hover:text-black transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
                >
                  Play Game <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Game 3 Card: Trivia Blast */}
              <div className="glass-card rounded-2xl border border-white/5 hover:border-cyan-400/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-cyan-400/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-400/5 rounded-full blur-2xl group-hover:bg-cyan-400/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-cyan-400/10 flex items-center justify-center border border-cyan-400/20 text-cyan-400 mb-4 group-hover:scale-110 transition-transform">
                    <Zap className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">Trivia Blast</h3>
                  <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
                    Test your memory under time constraints with rapid-fire questions covering course modules. Earn XP multiplier streaks!
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedGameType('trivia');
                    setModalSelectedCourse(selectedCourse);
                    setIsBuildModalOpen(true);
                  }}
                  className="w-full py-3 rounded-xl bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 font-display font-semibold hover:bg-cyan-400 hover:text-black transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
                >
                  Play Game <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Game 4 Card: Boggle */}
              <div className="glass-card rounded-2xl border border-white/5 hover:border-indigo-400/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-indigo-400/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-400/5 rounded-full blur-2xl group-hover:bg-indigo-400/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-indigo-400/10 flex items-center justify-center border border-indigo-400/20 text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                    <Hourglass className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">Word Boggle</h3>
                  <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
                    Spell course terms by linking adjacent letter blocks in any direction. Discover words before the timer runs out.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedGameType('boggle');
                    setModalSelectedCourse(selectedCourse);
                    setIsBuildModalOpen(true);
                  }}
                  className="w-full py-3 rounded-xl bg-indigo-400/10 border border-indigo-400/30 text-indigo-400 font-display font-semibold hover:bg-indigo-450 hover:text-black transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
                >
                  Play Game <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Term Matching */}
        {activeGame === 'matching' && (
          <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
            <div className="flex flex-wrap gap-4 justify-between items-center">
              <button
                onClick={() => setActiveGame('selection')}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
              >
                ← Back to Games
              </button>
              {finalConnectedResources.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
                  <span className="font-semibold text-slate-350">Connected Materials:</span>
                  {finalConnectedResources.map((res) => (
                    <span key={res} className="px-2 py-0.5 bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 rounded text-primary-fixed-dim text-[11px] flex items-center gap-1 font-medium">
                      <FileText className="w-3 h-3" />
                      {res}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => startMatchingGame(selectedCourse)}
                className="flex items-center gap-1.5 px-4 py-2 text-primary-fixed-dim hover:text-white transition-all font-sans text-sm font-semibold"
              >
                <RefreshCw className="w-4 h-4" /> Reset Grid
              </button>
            </div>

            {matchingVictory ? (
              <div className="glass-card rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-10 text-center space-y-6 animate-modal-in">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">Grid Cleared!</h2>
                  <p className="font-sans text-slate-350 text-sm mt-2 max-w-sm mx-auto">
                    Outstanding memory recall! You matched every term correctly.
                  </p>
                </div>
                <div className="inline-block px-4 py-1.5 bg-emerald-500/20 rounded-full font-display font-semibold text-emerald-400 border border-emerald-500/35">
                  +400 XP Awarded
                </div>
                <div className="pt-4 flex gap-4 justify-center">
                  <button
                    onClick={() => setActiveGame('selection')}
                    className="px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
                  >
                    Close Game
                  </button>
                  <button
                    onClick={startMatchingGame}
                    className="px-6 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans font-bold text-sm hover:bg-primary-container transition-all active:scale-95"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {matchingCards.map((card) => {
                  const isSelected = selectedCardId === card.id;
                  const isMatched = matchedIds.includes(card.id);
                  const isFailed = failedPair?.includes(card.id);
                  const isClued = matcherClueId === card.id;

                  return (
                    <button
                      key={card.id}
                      onClick={() => handleCardClick(card.id)}
                      disabled={isMatched}
                      className={clsx(
                        "p-5 rounded-2xl border text-left font-sans text-sm leading-relaxed transition-all duration-300 flex items-start gap-3 h-auto min-h-[7rem] md:h-28 outline-none active:scale-[0.99] group select-none relative overflow-hidden",
                        isMatched
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400/70 cursor-not-allowed opacity-50"
                          : isFailed
                            ? "bg-rose-500/20 border-rose-500/60 text-rose-350 animate-shake"
                            : isSelected
                              ? "bg-primary-fixed-dim/20 border-primary-fixed-dim text-white shadow-[0_0_20px_rgba(0,218,243,0.1)] scale-[1.01]"
                              : isClued
                                ? "bg-cyan-500/10 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)] animate-pulse"
                                : "bg-surface-container border-white/5 text-slate-300 hover:bg-surface-container-high hover:border-white/15"
                      )}
                    >
                      <span className={clsx(
                        "w-5 h-5 rounded-full shrink-0 flex items-center justify-center font-display text-[10px] font-bold border mt-0.5",
                        isMatched
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                          : isSelected
                            ? "bg-primary-fixed-dim border-primary-fixed-dim text-black"
                            : isClued
                              ? "bg-cyan-400 border-cyan-400 text-black font-extrabold"
                              : "bg-white/5 border-white/10 text-slate-450 group-hover:border-white/20"
                      )}>
                        {card.type === 'term' ? 'T' : 'D'}
                      </span>
                      <span className="font-medium">{card.text}</span>
                      {isClued && (
                        <span className="absolute bottom-1 right-2.5 text-[8px] font-sans font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-0.5">
                          <AlertCircle className="w-2.5 h-2.5" /> AI Hint
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Mini Crossword */}
        {activeGame === 'crossword' && (
          <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
            <div className="flex flex-wrap gap-4 justify-between items-center">
              <button
                onClick={() => setActiveGame('selection')}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
              >
                ← Back to Games
              </button>
              {finalConnectedResources.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center bg-amber-400/5 border border-amber-400/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
                  <span className="font-semibold text-slate-350">Connected Materials:</span>
                  {finalConnectedResources.map((res) => (
                    <span key={res} className="px-2 py-0.5 bg-amber-400/10 border border-amber-400/20 rounded text-amber-400 text-[11px] flex items-center gap-1 font-medium">
                      <FileText className="w-3 h-3" />
                      {res}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={useCrosswordHint}
                  className="px-3.5 py-2 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 rounded-lg font-sans text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" /> AI Assist Hint
                </button>
                <button
                  onClick={() => startCrosswordGame(selectedCourse)}
                  className="flex items-center gap-1.5 px-4 py-2 text-amber-400 hover:text-white transition-all font-sans text-sm font-semibold"
                >
                  <RefreshCw className="w-4 h-4" /> Reset Grid
                </button>
              </div>
            </div>

            {crosswordVictory ? (
              <div className="glass-card rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-10 text-center space-y-6 animate-modal-in">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">Crossword Solved!</h2>
                  <p className="font-sans text-slate-350 text-sm mt-2 max-w-sm mx-auto">
                    Outstanding! You successfully filled out every grid block correctly.
                  </p>
                </div>
                <div className="inline-block px-4 py-1.5 bg-emerald-500/20 rounded-full font-display font-semibold text-emerald-400 border border-emerald-500/35">
                  +{Math.max(400 - crosswordCluesUsed * 50, 100)} XP Awarded
                </div>
                <div className="pt-4 flex gap-4 justify-center">
                  <button
                    onClick={() => setActiveGame('selection')}
                    className="px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
                  >
                    Close Game
                  </button>
                  <button
                    onClick={startCrosswordGame}
                    className="px-6 py-2.5 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-350 transition-all active:scale-95"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* Grid Visual */}
                <div className="flex justify-center bg-surface-container/30 p-6 rounded-2xl border border-white/5">
                  <div className="grid grid-cols-5 gap-1.5 bg-slate-950 p-3 rounded-xl">
                    {Array.from({ length: 5 }).map((_, r) => (
                      <React.Fragment key={r}>
                        {Array.from({ length: 5 }).map((_, c) => {
                          const cellData = activeData.crossword.find(cell => cell.r === r && cell.c === c);
                          const key = `${r}-${c}`;
                          const userVal = crosswordAnswers[key] || '';
                          const isIncorrect = crosswordChecked && userVal !== cellData?.correctLetter;

                          if (!cellData) {
                            return (
                              <div key={key} className="w-12 h-12 bg-slate-900 border border-slate-950 rounded-md" />
                            );
                          }

                          return (
                            <div key={key} className="relative w-12 h-12 bg-surface-container-high border border-white/10 rounded-md flex items-center justify-center focus-within:border-amber-400/70 transition-all">
                              {cellData.label && (
                                <span className="absolute top-0.5 left-0.5 text-[8px] font-sans font-bold text-slate-500">{cellData.label}</span>
                              )}
                              <input
                                type="text"
                                maxLength={1}
                                value={userVal}
                                onChange={(e) => handleCrosswordInput(r, c, e.target.value)}
                                className={clsx(
                                  "w-full h-full text-center bg-transparent outline-none uppercase font-display font-semibold text-lg text-white",
                                  isIncorrect && "text-rose-400 border border-rose-500/50 rounded-md bg-rose-500/5"
                                )}
                              />
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Clues */}
                <div className="space-y-6 bg-surface-container-low/40 p-6 rounded-2xl border border-white/5">
                  <div>
                    <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">Across Clues</h3>
                    <div className="space-y-3 mt-3">
                      <div className="flex gap-2.5 items-start text-sm">
                        <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">1</span>
                        <p className="text-slate-300 font-sans">{activeData.crosswordClues.across1}</p>
                      </div>
                      <div className="flex gap-2.5 items-start text-sm">
                        <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">2</span>
                        <p className="text-slate-300 font-sans">{activeData.crosswordClues.across2}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">Down Clues</h3>
                    <div className="space-y-3 mt-3">
                      <div className="flex gap-2.5 items-start text-sm">
                        <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-display text-xs font-bold shrink-0">1</span>
                        <p className="text-slate-300 font-sans">{activeData.crosswordClues.down1}</p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={checkCrosswordAnswers}
                    className="w-full py-2.5 rounded-xl bg-amber-400 text-black font-sans font-bold text-sm hover:bg-amber-350 transition-all active:scale-95"
                  >
                    Check Answers
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Trivia Blast */}
        {activeGame === 'trivia' && (
          <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300">
            <div className="flex flex-wrap gap-4 justify-between items-center">
              <button
                onClick={() => setActiveGame('selection')}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
              >
                ← Back to Games
              </button>
              {finalConnectedResources.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center bg-cyan-400/5 border border-cyan-400/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
                  <span className="font-semibold text-slate-350">Connected Materials:</span>
                  {finalConnectedResources.map((res) => (
                    <span key={res} className="px-2 py-0.5 bg-cyan-400/10 border border-cyan-400/20 rounded text-cyan-400 text-[11px] flex items-center gap-1 font-medium">
                      <FileText className="w-3 h-3" />
                      {res}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {triviaFinished ? (
              <div className="glass-card rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-10 text-center space-y-6 animate-modal-in">
                <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mx-auto shadow-lg shadow-cyan-500/10">
                  <Trophy className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">Trivia Complete!</h2>
                  <p className="font-sans text-slate-350 text-sm mt-2">
                    You scored {triviaScore} out of {triviaQueue.length} correct.
                  </p>
                </div>
                <div className="inline-block px-4 py-1.5 bg-cyan-500/20 rounded-full font-display font-semibold text-cyan-400 border border-cyan-500/35">
                  +{triviaScore * 100} XP Awarded
                </div>
                <div className="pt-4 flex gap-4 justify-center">
                  <button
                    onClick={() => setActiveGame('selection')}
                    className="px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
                  >
                    Close Game
                  </button>
                  <button
                    onClick={() => startTriviaGame(selectedCourse)}
                    className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-sans font-bold text-sm transition-all active:scale-95 shadow-lg shadow-cyan-500/10"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            ) : (
              triviaQueue[currentTriviaIdx] && (
                <div className="glass-card rounded-2xl border border-white/5 p-6 md:p-8 space-y-6">
                  <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-widest text-slate-500 font-sans border-b border-white/5 pb-4">
                    <span>Question {currentTriviaIdx + 1} of {triviaQueue.length}</span>
                    <span className={clsx(
                      "flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-lg border transition-all duration-300 font-sans",
                      triviaTimeLeft <= 2
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse scale-105"
                        : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                    )}>
                      <Hourglass className="w-3.5 h-3.5" />
                      Time Left: {triviaTimeLeft}s
                    </span>
                  </div>

                  <h3 className="font-display text-xl md:text-2xl font-bold text-white leading-relaxed">
                    {triviaQueue[currentTriviaIdx].question}
                  </h3>

                  <div className="grid grid-cols-1 gap-3 pt-4">
                    {triviaQueue[currentTriviaIdx].options.map((option) => {
                      const isSelected = triviaSelected === option;
                      const isCorrect = option === triviaQueue[currentTriviaIdx].correct;
                      const showsAnswer = triviaSelected !== null;

                      return (
                        <button
                          key={option}
                          onClick={() => handleTriviaAnswer(option)}
                          disabled={showsAnswer}
                          className={clsx(
                            "w-full p-4 rounded-xl border transition-all duration-300 flex items-center justify-between outline-none select-none text-left font-sans text-sm font-medium",
                            showsAnswer
                              ? isCorrect
                                ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold"
                                : isSelected
                                  ? "bg-rose-500/10 border-rose-500 text-rose-400"
                                  : "bg-white/2 border-white/2 text-slate-500 cursor-default"
                              : "bg-surface-container-lowest border-white/5 text-slate-300 hover:bg-surface-container-high/50 hover:border-white/10 active:scale-[0.99]"
                          )}
                        >
                          <span>{option}</span>
                          {showsAnswer && isCorrect && (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                          )}
                          {showsAnswer && isSelected && !isCorrect && (
                            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Word Boggle */}
        {activeGame === 'boggle' && (
          <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
            <div className="flex flex-wrap gap-4 justify-between items-center">
              <button
                onClick={() => setActiveGame('selection')}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 font-sans text-sm font-semibold text-slate-300 transition-all"
              >
                ← Back to Games
              </button>
              {finalConnectedResources.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center bg-indigo-400/5 border border-indigo-400/10 rounded-xl px-3 py-1.5 text-xs font-sans text-slate-400">
                  <span className="font-semibold text-slate-350">Connected Materials:</span>
                  {finalConnectedResources.map((res) => (
                    <span key={res} className="px-2 py-0.5 bg-indigo-400/10 border border-indigo-400/20 rounded text-indigo-400 text-[11px] flex items-center gap-1 font-medium">
                      <FileText className="w-3 h-3" />
                      {res}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400 font-sans font-bold text-sm">
                <Hourglass className="w-4 h-4" />
                <span>Timer: {boggleTimeLeft}s</span>
              </div>
            </div>

            {boggleFinished ? (
              <div className="glass-card rounded-2xl border border-indigo-500/20 bg-indigo-950/20 p-10 text-center space-y-6 animate-modal-in">
                <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/10">
                  <Hourglass className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">Time's Up!</h2>
                  <p className="font-sans text-slate-350 text-sm mt-2">
                    You found {boggleFoundWords.length} words inside the grid.
                  </p>
                </div>
                <div className="inline-block px-4 py-1.5 bg-indigo-500/20 rounded-full font-display font-semibold text-indigo-400 border border-indigo-500/35">
                  +{boggleFoundWords.length * 100} XP Awarded
                </div>
                <div className="pt-4 flex gap-4 justify-center">
                  <button
                    onClick={() => setActiveGame('selection')}
                    className="px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
                  >
                    Close Game
                  </button>
                  <button
                    onClick={() => startBoggleGame(selectedCourse)}
                    className="px-6 py-2.5 rounded-xl bg-indigo-500 text-white font-sans font-bold text-sm hover:bg-indigo-450 transition-all active:scale-95"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* 4x4 Grid Selection */}
                <div className="flex flex-col items-center gap-4 bg-surface-container/30 p-6 rounded-2xl border border-white/5">
                  <div className="grid grid-cols-4 gap-2 bg-slate-950 p-4 rounded-xl">
                    {activeData.boggleGrid.map((row, r) => (
                      <React.Fragment key={r}>
                        {row.map((letter, c) => {
                          const isSelectedIndex = boggleSelection.findIndex(cell => cell.r === r && cell.c === c);
                          const isSelected = isSelectedIndex !== -1;
                          const isLast = boggleSelection[boggleSelection.length - 1]?.r === r && boggleSelection[boggleSelection.length - 1]?.c === c;

                          return (
                            <button
                              key={`${r}-${c}`}
                              onClick={() => handleBoggleCellClick(r, c)}
                              className={clsx(
                                "w-14 h-14 rounded-lg flex items-center justify-center font-display text-xl font-bold border transition-all active:scale-95 outline-none relative",
                                isSelected
                                  ? isLast
                                    ? "bg-indigo-500 border-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)] animate-pulse"
                                    : "bg-indigo-500/30 border-indigo-500/50 text-indigo-300"
                                  : "bg-surface-container-high border-white/5 text-slate-300 hover:bg-surface-container-highest hover:border-white/15"
                              )}
                            >
                              {letter}
                              {isSelected && (
                                <span className="absolute bottom-1 right-1.5 text-[8px] font-sans font-bold text-white/50">{isSelectedIndex + 1}</span>
                              )}
                            </button>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Word spelled box */}
                  <div className="w-full text-center space-y-2 mt-2">
                    <p className="text-xs font-sans text-slate-500 uppercase tracking-widest">Spelled Word</p>
                    <h2 className="font-display text-2xl font-extrabold text-white tracking-widest min-h-[2rem]">
                      {getBoggleSpelledWord() || '---'}
                    </h2>
                  </div>

                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => setBoggleSelection([])}
                      className="flex-1 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
                    >
                      Clear
                    </button>
                    <button
                      onClick={submitBoggleWord}
                      disabled={boggleSelection.length === 0}
                      className="flex-1 py-2.5 rounded-xl bg-indigo-500 text-white font-sans font-bold text-sm hover:bg-indigo-450 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Submit Word
                    </button>
                  </div>

                  {boggleMessage && (
                    <p className={clsx(
                      "text-xs font-semibold font-sans mt-2",
                      boggleMessage.success ? "text-emerald-400 animate-pulse" : "text-rose-450"
                    )}>
                      {boggleMessage.text}
                    </p>
                  )}
                </div>

                {/* Words List */}
                <div className="space-y-4 bg-surface-container-low/40 p-6 rounded-2xl border border-white/5 h-full">
                  <div>
                    <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-slate-450 border-b border-white/5 pb-2">
                      Found Words ({boggleFoundWords.length})
                    </h3>
                    {boggleFoundWords.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {boggleFoundWords.map((word) => (
                          <span
                            key={word}
                            className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 font-sans font-semibold text-xs animate-in zoom-in-95 duration-100"
                          >
                            {word}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Hourglass className="w-8 h-8 text-slate-650 mb-2" />
                        <p className="text-xs font-sans text-slate-500">
                          Connect adjacent grid letter blocks to spell terms matching your course syllabus.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Game Build / Resource Selection Modal */}
      <Modal
        isOpen={isBuildModalOpen && !!selectedGameType}
        onClose={() => setIsBuildModalOpen(false)}
        title={`Build ${selectedGameType === 'matching' ? 'Term Matcher' : selectedGameType === 'crossword' ? 'Mini Crossword' : selectedGameType === 'trivia' ? 'Trivia Blast' : 'Word Boggle'} Game`}
        maxWidth="max-w-lg"
      >
        <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">
          {/* Header Section */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center">
                <Gamepad2 className="w-5 h-5 text-primary-fixed-dim" />
              </div>
              <div>
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">
                  Setup Game Content
                </p>
                <p className="font-sans text-xs text-slate-500">Connect reference materials to formulate custom game content.</p>
              </div>
            </div>
          </div>

          {/* Course Selector (Single Selection) */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans block">
              Target Course (Select 1)
            </label>
            <div className="grid grid-cols-1 gap-2.5">
              {enrolledCourses.map((c) => {
                const isSelected = modalSelectedCourse === c.id;
                const info = getCourseDisplayInfo(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setModalSelectedCourse(c.id)}
                    className={clsx(
                      "w-full flex items-center gap-3 p-3 rounded-xl border font-sans text-left transition-all active:scale-[0.99]",
                      isSelected
                        ? "bg-primary-fixed-dim/10 border-primary-fixed-dim text-white shadow-[0_0_15px_rgba(0,218,243,0.15)]"
                        : "bg-surface-container border-white/5 text-slate-350 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <div className={`p-2 rounded-lg ${info.bg}`}>
                      <info.icon className={`w-4 h-4 ${info.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block font-semibold text-sm truncate">{c.title}</span>
                      <span className="block text-[10px] text-slate-500">{c.courseCode} • {c.instructor}</span>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary-fixed-dim flex items-center justify-center text-black">
                        <Check className="w-3.5 h-3.5 font-bold" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Learning Materials Selector (Multiple Selection) */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans">
                Learning Materials (Select Multiple)
              </label>
              {getCourseResources(modalSelectedCourse).length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allRes = getCourseResources(modalSelectedCourse);
                    if (selectedResources.length === allRes.length) {
                      setSelectedResources([]);
                    } else {
                      setSelectedResources(allRes);
                    }
                  }}
                  className="text-[10px] font-sans font-bold text-primary-fixed-dim hover:underline"
                >
                  {selectedResources.length === getCourseResources(modalSelectedCourse).length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className="bg-slate-950/50 border border-white/5 rounded-xl p-3 max-h-48 overflow-y-auto space-y-2.5">
              {getCourseResources(modalSelectedCourse).map((res) => {
                const isChecked = selectedResources.includes(res);
                return (
                  <button
                    key={res}
                    type="button"
                    onClick={() => {
                      if (isChecked) {
                        setSelectedResources(prev => prev.filter(r => r !== res));
                      } else {
                        setSelectedResources(prev => [...prev, res]);
                      }
                    }}
                    className={clsx(
                      "w-full flex items-center gap-3 p-2.5 rounded-lg border font-sans text-xs text-left transition-all",
                      isChecked
                        ? "bg-white/5 border-white/10 text-white"
                        : "bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <div className={clsx(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                      isChecked ? "bg-primary-fixed-dim border-primary-fixed-dim text-black" : "border-white/20 bg-white/5"
                    )}>
                      {isChecked && <Check className="w-3.5 h-3.5 font-bold" />}
                    </div>
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate flex-1 font-medium">{res}</span>
                  </button>
                );
              })}
            </div>

            {selectedResources.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-rose-450 bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Please select at least one learning material to launch the game.</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsBuildModalOpen(false)}
              className="flex-1 py-3 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBuildAndLaunchGame}
              disabled={selectedResources.length === 0}
              className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans font-bold text-sm hover:bg-primary-container transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-lg shadow-primary-fixed-dim/20"
            >
              Build & Launch Game
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
