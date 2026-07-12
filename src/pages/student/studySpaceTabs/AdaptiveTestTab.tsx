import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, ArrowRight, BrainCircuit, BarChart2, Check, Play,
  HelpCircle, List, ToggleLeft, Edit3, GitMerge,
  Layers, Clock, ArrowLeft, Trophy, FileText
} from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';

// Types
export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'identification'
  | 'fill-in-the-blank'
  | 'matching';

interface ConceptMastery {
  name: string;
  probability: number;
  status: 'Mastered' | 'Reviewing' | 'Gaps Detected';
  /** Uploaded material this concept was extracted from. */
  resource?: string;
}

interface Flashcard {
  id: number;
  front: string;
  back: string;
}

interface FlashcardSet {
  id: number;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  isPublic: boolean;
}

interface AdaptiveTestTabProps {
  flashcardSets: FlashcardSet[];
  /** Matches what StudySpace passes down — the same shape the other study tabs receive. */
  availableResources: { id: string; title: string }[];
  courseConnected: boolean;
}

interface Question {
  id: number;
  type: QuestionType;
  section: string;
  prompt: string;
  options?: string[];
  correctIndex?: number;
  correctValue?: boolean;
  answer?: string;
  blank?: string;
  pairs?: { term: string; definition: string }[];
  explanation: string;
  concept: string;
}

interface UserAnswer {
  questionId: number;
  prompt: string;
  selected: any;
  correct: boolean;
  type: QuestionType;
  section: string;
  explanation: string;
  correctAnswerText: string;
}

interface PastTest {
  id: string;
  date: string;
  sourceTitle: string;
  totalQuestions: number;
  score: number;
  answers: UserAnswer[];
  masteryAfter: ConceptMastery[];
}

// ── Shared minimalist style tokens ──────────────────────────
const CARD = 'bg-surface-container-lowest/40 rounded-2xl';
const LABEL = 'font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider';
const SECTION = 'font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest';
const INPUT =
  'bg-surface-container/60 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-primary-fixed-dim transition-colors';

const QUESTION_TYPES_INFO: { id: QuestionType; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', desc: '4 choices', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True or False', desc: 'Decide correctness', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', desc: 'Exact terms', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', desc: 'Fill the missing word', icon: <Edit3 className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching Type', desc: 'Match pairs', icon: <GitMerge className="w-4 h-4" /> },
];

/** Small numbered step heading used across the setup form. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded-md bg-white/5 text-slate-400 font-sans text-[10px] font-bold flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className={SECTION}>{children}</span>
    </div>
  );
}

const STATUS_COLOR: Record<ConceptMastery['status'], string> = {
  'Mastered': 'text-emerald-400',
  'Reviewing': 'text-amber-400',
  'Gaps Detected': 'text-red-400',
};

const STATUS_BADGE: Record<ConceptMastery['status'], string> = {
  'Mastered': 'bg-emerald-400/10 text-emerald-400',
  'Reviewing': 'bg-amber-400/10 text-amber-400',
  'Gaps Detected': 'bg-red-400/10 text-red-400',
};

interface ResourceMastery {
  resource: string;
  concepts: ConceptMastery[];
  average: number;
  counts: Record<ConceptMastery['status'], number>;
}

/** Mastery breakdown for a single uploaded resource. */
function ResourceMasteryCard({ group }: { group: ResourceMastery }) {
  const pct = Math.round(group.average * 100);

  return (
    <div className="bg-surface-container/40 rounded-xl p-4 space-y-4">
      {/* Resource header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileText className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="font-sans text-sm font-semibold text-white truncate">{group.resource}</span>
        </div>
        <span className="font-display text-lg font-bold text-primary-fixed-dim shrink-0 leading-none">
          {pct}%
        </span>
      </div>

      {/* Aggregate bar */}
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-fixed-dim transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status tally */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(group.counts) as ConceptMastery['status'][])
          .filter(status => group.counts[status] > 0)
          .map(status => (
            <span
              key={status}
              className={`px-2 py-0.5 rounded-md font-sans text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status]}`}
            >
              {group.counts[status]} {status}
            </span>
          ))}
      </div>

      {/* Concepts within this resource */}
      <div className="pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {group.concepts.map((concept, idx) => (
          <div key={idx} className="space-y-1.5">
            <div className="flex justify-between items-center gap-2 text-xs">
              <span className="text-slate-400 truncate">{concept.name}</span>
              <span className={`font-sans font-semibold shrink-0 ${STATUS_COLOR[concept.status]}`}>
                {(concept.probability * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-fixed-dim/60 transition-all duration-300"
                style={{ width: `${concept.probability * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


export default function AdaptiveTestTab({
  flashcardSets,
  availableResources,
  courseConnected
}: AdaptiveTestTabProps) {
  const [totalQuestions, setTotalQuestions] = useState<number>(10);
  const [sourceType, setSourceType] = useState<'flashcards' | 'resources'>('flashcards');
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [selectedResourceName, setSelectedResourceName] = useState<string>('');

  const [typesConfig, setTypesConfig] = useState<Record<QuestionType, { enabled: boolean; section: string; items: number }>>({
    'multiple-choice': { enabled: true, section: 'Test I', items: 10 },
    'true-false': { enabled: false, section: 'Test II', items: 0 },
    'identification': { enabled: false, section: 'Test III', items: 0 },
    'fill-in-the-blank': { enabled: false, section: 'Test IV', items: 0 },
    'matching': { enabled: false, section: 'Test V', items: 0 },
  });

  const redistributeAdaptiveItems = (
    prevConfig: Record<QuestionType, { enabled: boolean; section: string; items: number }>,
    total: number
  ): Record<QuestionType, { enabled: boolean; section: string; items: number }> => {
    const enabledKeys = (Object.keys(prevConfig) as QuestionType[]).filter(k => prevConfig[k].enabled);
    if (enabledKeys.length === 0) return prevConfig;

    const base = Math.floor(total / enabledKeys.length);
    const remainder = total % enabledKeys.length;

    const nextConfig = { ...prevConfig };
    (Object.keys(nextConfig) as QuestionType[]).forEach(k => {
      if (!nextConfig[k].enabled) {
        nextConfig[k].items = 0;
      }
    });

    enabledKeys.forEach((key, idx) => {
      nextConfig[key] = {
        ...nextConfig[key],
        items: base + (idx < remainder ? 1 : 0)
      };
    });
    return nextConfig;
  };

  const handleSetTotalQuestions = (count: number) => {
    setTotalQuestions(count);
    setTypesConfig(prev => redistributeAdaptiveItems(prev, count));
  };

  const toggleType = (tId: QuestionType) => {
    setTypesConfig(prev => {
      const isCurrentlyEnabled = prev[tId].enabled;

      const enabledKeys = (Object.keys(prev) as QuestionType[]).filter(k => prev[k].enabled);
      if (isCurrentlyEnabled && enabledKeys.length <= 1) {
        return prev;
      }

      const nextEnabled = !isCurrentlyEnabled;

      const updated = {
        ...prev,
        [tId]: { ...prev[tId], enabled: nextEnabled }
      };

      const nextConfig = redistributeAdaptiveItems(updated, totalQuestions);

      const activeKeys = (Object.keys(nextConfig) as QuestionType[]).filter(k => nextConfig[k].enabled);
      const limit = activeKeys.length;
      const allowedOptions = ['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'].slice(0, limit);

      activeKeys.forEach((key, idx) => {
        let label = nextConfig[key].section;
        if (!allowedOptions.includes(label)) {
          label = allowedOptions[idx] || allowedOptions[0];
        }
        nextConfig[key].section = label;
      });

      const usedLabels = new Set<string>();
      activeKeys.forEach((key) => {
        let label = nextConfig[key].section;
        if (usedLabels.has(label)) {
          label = allowedOptions.find(o => !usedLabels.has(o)) || allowedOptions[0];
        }
        usedLabels.add(label);
        nextConfig[key].section = label;
      });

      return nextConfig;
    });
  };

  // Screen flow: dashboard (default) → setup → quiz → results
  const [showSetup, setShowSetup] = useState(false);
  const [inQuiz, setInQuiz] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  // The test advances one section (Test I, Test II, …) at a time. Every question in the
  // current section is on screen at once, and nothing is graded until the very end.
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [matchingAnswers, setMatchingAnswers] = useState<Record<number, Record<string, string>>>({});
  const [quizAnswers, setQuizAnswers] = useState<UserAnswer[]>([]);
  const [quizFinished, setQuizFinished] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);

  const [pastTests, setPastTests] = useState<PastTest[]>([]);
  const [previewingPastTest, setPreviewingPastTest] = useState<PastTest | null>(null);
  const [resultsActiveTab, setResultsActiveTab] = useState<'all' | 'incorrect'>('all');

  const [masteryData, setMasteryData] = useState<ConceptMastery[]>([
    { name: 'Presynaptic Calcium Influx', probability: 0.82, status: 'Mastered' },
    { name: 'Vesicle Exocytosis Steps', probability: 0.74, status: 'Reviewing' },
    { name: 'Synaptic Cleft Diffusion', probability: 0.48, status: 'Reviewing' },
    { name: 'Postsynaptic Receptor Binding', probability: 0.35, status: 'Gaps Detected' }
  ]);

  useEffect(() => {
    if (flashcardSets.length > 0 && !selectedDeckId) {
      setSelectedDeckId(flashcardSets[0].id);
    }
    if (availableResources.length > 0 && !selectedResourceName) {
      setSelectedResourceName(availableResources[0].title);
    }
  }, [flashcardSets, availableResources]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('learnsync_test_history');
      if (saved) {
        setPastTests(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load past test history', e);
    }
  }, []);

  const validation = useMemo(() => {
    const enabledTypes = (Object.entries(typesConfig) as [string, { enabled: boolean; section: string; items: number }][]).filter(([_, conf]) => conf.enabled);

    const sumItems = enabledTypes.reduce((acc, [_, conf]) => acc + conf.items, 0);
    const overflow = sumItems > totalQuestions;
    const underflow = sumItems < totalQuestions;

    const sections = enabledTypes.map(([_, conf]) => conf.section);
    const duplicateSections = new Set(sections).size !== sections.length;

    const noneSelected = enabledTypes.length === 0;
    let sourceEmpty = false;
    if (sourceType === 'flashcards' && !selectedDeckId) sourceEmpty = true;
    if (sourceType === 'resources' && !selectedResourceName) sourceEmpty = true;

    return {
      sumItems,
      overflow,
      underflow,
      duplicateSections,
      noneSelected,
      sourceEmpty,
      isValid: sumItems === totalQuestions && !duplicateSections && !noneSelected && !sourceEmpty
    };
  }, [typesConfig, totalQuestions, sourceType, selectedDeckId, selectedResourceName]);

  const sectionOrderMap: Record<string, number> = {
    'Test I': 1,
    'Test II': 2,
    'Test III': 3,
    'Test IV': 4,
    'Test V': 5,
    'Test VI': 6,
  };

  const handleStartTest = () => {
    if (!validation.isValid) return;

    let sourceTitle = '';
    let cardsPool: Flashcard[] = [];

    if (sourceType === 'flashcards') {
      const deck = flashcardSets.find(s => s.id === selectedDeckId);
      sourceTitle = deck?.title || 'Selected Deck';
      cardsPool = deck?.cards || [];
    } else {
      sourceTitle = selectedResourceName;
      // Simulated resource cards
      cardsPool = [
        { id: 9001, front: 'What initiates neurotransmitter release at the synapse?', back: 'An influx of Calcium ions (Ca2+) into the presynaptic terminal, triggered by an action potential.' },
        { id: 9002, front: 'What is the synaptic cleft?', back: 'The tiny extracellular gap separating the presynaptic membrane from the postsynaptic membrane.' },
        { id: 9003, front: 'What is Excitatory Postsynaptic Potential (EPSP)?', back: 'A temporary depolarization of postsynaptic membrane potential caused by synaptic activation.' },
        { id: 9004, front: 'What is the primary function of the myelin sheath?', back: 'To insulate the axon and increase the speed at which electrical action potentials propagate.' },
        { id: 9005, front: 'Define action potential.', back: 'A rapid, temporary depolarization/repolarization change in neuronal membrane potential traveling down the axon.' },
        { id: 9006, front: 'What calcium sensor protein is responsible for vesicle fusion?', back: 'Synaptotagmin is the primary calcium sensor that binds calcium ions and triggers fusion.' },
        { id: 9007, front: 'Explain SNARE complexes.', back: 'SNARE protein complexes pull the vesicle membrane and presynaptic plasma membrane together for fusion.' },
        { id: 9008, front: 'What is primary difference between ionotropic and metabotropic receptors?', back: 'Ionotropic receptors are ligand-gated channels. Metabotropic receptors activate intracellular G-protein cascades.' }
      ];
    }

    // Fallback pool
    if (cardsPool.length === 0) {
      cardsPool = [
        { id: 1, front: 'Simulated Neuroscience Concept 1', back: 'Simulated explanation or definition of synapse activation.' },
        { id: 2, front: 'Simulated Neuroscience Concept 2', back: 'Simulated description of neurotransmitter release dynamics.' },
        { id: 3, front: 'Simulated Neuroscience Concept 3', back: 'Simulated recall response for cellular signal transduction.' }
      ];
    }

    const generatedQuestions: Question[] = [];
    let idCounter = 1;

    // Sort active types by section order
    const activeTypes = (Object.entries(typesConfig) as [string, { enabled: boolean; section: string; items: number }][])
      .filter(([_, conf]) => conf.enabled)
      .map(([typeId, conf]) => ({
        type: typeId as QuestionType,
        section: conf.section,
        count: conf.items
      }))
      .sort((a, b) => (sectionOrderMap[a.section] || 99) - (sectionOrderMap[b.section] || 99));

    // Generate questions per type
    activeTypes.forEach(tConfig => {
      // Pick cards for section
      for (let i = 0; i < tConfig.count; i++) {
        // Recycle cards if pool is smaller than requested count
        const cardIndex = (generatedQuestions.length + i) % cardsPool.length;
        const card = cardsPool[cardIndex];

        const otherCards = cardsPool.filter(c => c.id !== card.id);
        const distractors = otherCards.length > 0
          ? otherCards.map(c => c.back)
          : ['Alternative neuro-hypothesis 1', 'Alternative cell membrane interaction 2', 'Unrelated synapse response 3'];

        const conceptNode = masteryData[cardIndex % masteryData.length].name;

        switch (tConfig.type) {
          case 'multiple-choice': {
            // Shuffle options
            const options = [...distractors.slice(0, 3), card.back].sort(() => Math.random() - 0.5);
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: card.front,
              options,
              correctIndex: options.indexOf(card.back),
              explanation: `The correct answer is "${card.back}". This represents the established terminology mapping in synaptic dynamics.`,
              concept: conceptNode
            });
            break;
          }
          case 'true-false': {
            const isTrue = Math.random() > 0.5;
            const wrongBack = distractors[0] || 'mismatched neuro statement';
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: isTrue
                ? `Is this statement true? "${card.back}" is the definition for: ${card.front}`
                : `Is this statement true? "${wrongBack}" is the definition for: ${card.front}`,
              correctValue: isTrue,
              explanation: `This statement is ${isTrue ? 'True' : 'False'}. The definition of "${card.front}" is actually: "${card.back}".`,
              concept: conceptNode
            });
            break;
          }
          case 'identification': {
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: `Identify this concept: ${card.front}`,
              answer: card.back,
              explanation: `The correct term or response is "${card.back}".`,
              concept: conceptNode
            });
            break;
          }
          case 'fill-in-the-blank': {
            // Blank out a middle word
            const words = card.back.split(' ');
            const middleIdx = Math.floor(words.length / 2);
            const answerWord = words[middleIdx]?.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") || 'signal';
            const blankText = words.map((w, index) => index === middleIdx ? '_______' : w).join(' ');
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: `Fill in the missing word for: ${card.front}`,
              blank: blankText,
              answer: answerWord,
              explanation: `The missing word is "${answerWord}". Full text: "${card.back}".`,
              concept: conceptNode
            });
            break;
          }
          case 'matching': {
            // Build match pairs
            const matchIndex = cardIndex;
            const pairs = cardsPool.slice(matchIndex, matchIndex + 3).map(c => ({
              term: c.front,
              definition: c.back
            }));
            if (pairs.length < 2) {
              pairs.push({ term: card.front, definition: card.back });
              pairs.push({ term: 'Neurotransmitter vesicle', definition: 'Small membrane-bound sac storing signals.' });
            }
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: 'Match the synaptic structures on the left with their correct cognitive functions on the right:',
              pairs,
              explanation: 'The matching is generated by mapping each synaptic term to its corresponding definition from the curriculum.',
              concept: conceptNode
            });
            break;
          }
        }
      }
    });

    // Trim to requested total
    const finalQuestions = generatedQuestions.slice(0, totalQuestions);

    setQuestions(finalQuestions);
    setQuizAnswers([]);
    setCurrentSectionIdx(0);
    setAnswers({});
    setMatchingAnswers({});
    setQuizFinished(false);
    setInQuiz(true);
  };

  // ── Answer capture (no grading happens here) ──────────────
  const setAnswer = (questionId: number, value: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const setMatch = (questionId: number, term: string, definition: string) => {
    setMatchingAnswers(prev => ({
      ...prev,
      [questionId]: { ...(prev[questionId] || {}), [term]: definition },
    }));
  };

  /** A question counts as answered once it has a usable value (false is valid for true/false). */
  const isAnswered = (q: Question): boolean => {
    if (q.type === 'matching') {
      const picks = matchingAnswers[q.id] || {};
      return (q.pairs || []).every(p => Boolean(picks[p.term]));
    }
    const val = answers[q.id];
    return val !== undefined && val !== null && val !== '';
  };

  /** Grades one question against the student's stored answer. Pure — no state writes. */
  const gradeQuestion = (q: Question): UserAnswer => {
    let isCorrect = false;
    let selectedVal: any = answers[q.id];
    let correctAnswerText = '';

    switch (q.type) {
      case 'multiple-choice': {
        isCorrect = selectedVal === q.correctIndex;
        correctAnswerText = q.options ? q.options[q.correctIndex!] : '';
        break;
      }
      case 'true-false': {
        isCorrect = selectedVal === q.correctValue;
        correctAnswerText = q.correctValue ? 'TRUE' : 'FALSE';
        break;
      }
      case 'identification': {
        const userText = (selectedVal as string || '').trim().toLowerCase();
        const correctText = (q.answer || '').trim().toLowerCase();
        isCorrect = userText === correctText || correctText.includes(userText) && userText.length > 2;
        correctAnswerText = q.answer || '';
        break;
      }
      case 'fill-in-the-blank': {
        const userText = (selectedVal as string || '').trim().toLowerCase();
        const correctText = (q.answer || '').trim().toLowerCase();
        isCorrect = userText === correctText;
        correctAnswerText = q.answer || '';
        break;
      }
      case 'matching': {
        const picks = matchingAnswers[q.id] || {};
        selectedVal = picks;
        const allMatches = q.pairs || [];
        isCorrect = allMatches.every(p =>
          (picks[p.term] || '').trim().toLowerCase() === p.definition.toLowerCase()
        );
        correctAnswerText = allMatches.map(p => `${p.term} -> ${p.definition}`).join(', ');
        break;
      }
    }

    return {
      questionId: q.id,
      prompt: q.prompt,
      selected: selectedVal,
      correct: isCorrect,
      type: q.type,
      section: q.section,
      explanation: q.explanation,
      correctAnswerText,
    };
  };

  /** Grades the whole test at once, folds BKT mastery over every answer, then shows results. */
  const handleFinishTest = () => {
    const graded = questions.map(gradeQuestion);

    // Fold BKT updates across every answer, in order.
    const nextMastery = masteryData.map(m => ({ ...m }));
    questions.forEach((q, idx) => {
      const mastery = nextMastery.find(m => m.name === q.concept);
      if (!mastery) return;

      const correct = graded[idx].correct;
      mastery.probability = correct
        ? Math.min(0.99, mastery.probability + (1 - mastery.probability) * 0.35)
        : Math.max(0.1, mastery.probability - mastery.probability * 0.25);
      mastery.status =
        mastery.probability >= 0.8 ? 'Mastered'
          : mastery.probability >= 0.5 ? 'Reviewing'
            : 'Gaps Detected';
    });

    const finalScore = graded.filter(a => a.correct).length;
    const newTestHistory: PastTest = {
      id: 'test-' + Date.now(),
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      sourceTitle: sourceType === 'flashcards'
        ? (flashcardSets.find(s => s.id === selectedDeckId)?.title || 'Flashcards Deck')
        : selectedResourceName,
      totalQuestions: questions.length,
      score: finalScore,
      answers: graded,
      masteryAfter: nextMastery
    };

    const updatedHistory = [newTestHistory, ...pastTests];

    setMasteryData(nextMastery);
    setQuizAnswers(graded);
    setPastTests(updatedHistory);
    localStorage.setItem('learnsync_test_history', JSON.stringify(updatedHistory));
    setQuizFinished(true);
  };

  // Filter answers for review tabs
  const filteredAnswersReview = useMemo(() => {
    const activeTest = previewingPastTest || { answers: quizAnswers };
    if (resultsActiveTab === 'incorrect') {
      return activeTest.answers.filter(ans => !ans.correct);
    }
    return activeTest.answers;
  }, [resultsActiveTab, previewingPastTest, quizAnswers, quizFinished]);

  // Ordered section names (Test I, Test II, …) as they appear in the generated question list.
  const sections = useMemo(() => {
    const seen: string[] = [];
    questions.forEach(q => {
      if (!seen.includes(q.section)) seen.push(q.section);
    });
    return seen;
  }, [questions]);

  const currentSection = sections[currentSectionIdx];
  const currentSectionQuestions = questions.filter(q => q.section === currentSection);
  const isLastSection = currentSectionIdx >= sections.length - 1;
  const answeredInSection = currentSectionQuestions.filter(isAnswered).length;
  const sectionComplete = currentSectionQuestions.length > 0 && answeredInSection === currentSectionQuestions.length;

  // Returns to the dashboard from any other screen.
  const goToDashboard = () => {
    setInQuiz(false);
    setQuizFinished(false);
    setPreviewingPastTest(null);
    setShowSetup(false);
  };

  // Aggregate stats for the dashboard's mastery panel.
  const overallMastery = masteryData.length
    ? masteryData.reduce((sum, m) => sum + m.probability, 0) / masteryData.length
    : 0;
  const averageAccuracy = pastTests.length
    ? pastTests.reduce((sum, t) => sum + (t.totalQuestions ? t.score / t.totalQuestions : 0), 0) / pastTests.length
    : 0;

  // Group concept mastery under the resource each concept came from. Concepts without an
  // explicit `resource` are spread across the student's uploads so every material shows up.
  const masteryByResource = useMemo<ResourceMastery[]>(() => {
    const groups = new Map<string, ConceptMastery[]>();

    masteryData.forEach((concept, idx) => {
      const resource =
        concept.resource ??
        (availableResources.length > 0
          ? availableResources[idx % availableResources.length].title
          : 'Uploaded Material');

      const existing = groups.get(resource);
      if (existing) existing.push(concept);
      else groups.set(resource, [concept]);
    });

    return Array.from(groups.entries()).map(([resource, concepts]) => {
      const counts: Record<ConceptMastery['status'], number> = {
        'Mastered': 0,
        'Reviewing': 0,
        'Gaps Detected': 0,
      };
      concepts.forEach(c => { counts[c.status] += 1; });

      return {
        resource,
        concepts,
        average: concepts.reduce((sum, c) => sum + c.probability, 0) / concepts.length,
        counts,
      };
    });
  }, [masteryData, availableResources]);

  const onDashboard = !inQuiz && !quizFinished && !previewingPastTest && !showSetup;
  const onSetup = !inQuiz && !quizFinished && !previewingPastTest && showSetup;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* ─── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            <BrainCircuit className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-white tracking-tight">
              Adaptive Test
            </h2>
            <p className="font-sans text-xs text-slate-500 mt-0.5">
              Build a custom assessment. Bayesian Knowledge Tracing adjusts difficulty as you answer.
            </p>
          </div>
        </div>

        {inQuiz && (
          <>
            <button
              onClick={() => setShowExitConfirmModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 font-sans text-xs font-semibold transition-colors self-start sm:self-auto"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Exit Test
            </button>

            <Modal
              isOpen={showExitConfirmModal}
              onClose={() => setShowExitConfirmModal(false)}
              title="Exit Assessment?"
              maxWidth="max-w-sm"
            >
              <div className="space-y-6">
                <p className="font-sans text-sm text-slate-400 leading-relaxed">
                  Are you sure you want to exit the current test? Your progress will not be saved.
                </p>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowExitConfirmModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl hover:bg-white/5 text-slate-300 font-sans text-sm font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      goToDashboard();
                      setShowExitConfirmModal(false);
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 font-sans text-sm font-semibold transition-colors"
                  >
                    Exit Test
                  </button>
                </div>
              </div>
            </Modal>
          </>
        )}
      </div>

      {/* ─── Active quiz (one section at a time) ──────────────── */}
      {inQuiz && !quizFinished && (
        <div key="active-quiz" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">

          {/* Section column — every question in the section is on screen at once */}
          <div className="lg:col-span-2">
            <div key={currentSection} className={`${CARD} p-6 space-y-6 animate-in fade-in duration-300`}>

              {/* Section header */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="font-sans text-xs font-semibold text-primary-fixed-dim uppercase tracking-wider block">
                      {currentSection}
                    </span>
                    <span className="font-sans text-[11px] text-slate-500 block capitalize mt-0.5">
                      {currentSectionQuestions[0]?.type.replace(/-/g, ' ')} · {currentSectionQuestions.length} question{currentSectionQuestions.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="font-sans text-xs text-slate-500 font-medium shrink-0">
                    {answeredInSection} / {currentSectionQuestions.length} answered
                  </span>
                </div>

                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-fixed-dim transition-all duration-300"
                    style={{ width: `${currentSectionQuestions.length ? (answeredInSection / currentSectionQuestions.length) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Every question in this section */}
              <div className="space-y-8">
                {currentSectionQuestions.map(q => {
                  const number = questions.indexOf(q) + 1;
                  const value = answers[q.id];
                  const picks = matchingAnswers[q.id] || {};

                  return (
                    <div key={q.id} className="space-y-4 pt-6 border-t border-white/5 first:pt-0 first:border-0">

                      {/* Prompt */}
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded-md bg-white/5 text-slate-400 font-sans text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {number}
                        </span>
                        <div className="space-y-1 min-w-0">
                          <span className={LABEL}>{q.concept}</span>
                          <h3 className="font-display text-base font-medium text-white leading-relaxed">
                            {q.prompt}
                          </h3>
                        </div>
                      </div>

                      {/* Inputs — nothing is graded or revealed until the test is finished */}
                      <div className="pl-9">

                        {q.type === 'multiple-choice' && (
                          <div className="space-y-2">
                            {q.options?.map((opt, optIdx) => {
                              const isSelected = value === optIdx;
                              return (
                                <button
                                  key={optIdx}
                                  onClick={() => setAnswer(q.id, optIdx)}
                                  className={`w-full flex items-start gap-3 p-3.5 rounded-xl transition-colors text-left font-sans text-sm ${isSelected
                                    ? 'bg-primary-fixed-dim/10 text-white'
                                    : 'bg-surface-container/40 text-slate-300 hover:bg-surface-container/70'
                                    }`}
                                >
                                  <span className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${isSelected ? 'bg-primary-fixed-dim/20 text-primary-fixed-dim' : 'bg-white/5 text-slate-500'
                                    }`}>
                                    {String.fromCharCode(65 + optIdx)}
                                  </span>
                                  <span className="flex-1 leading-relaxed">{opt}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {q.type === 'true-false' && (
                          <div className="flex gap-3">
                            {[true, false].map(val => (
                              <button
                                key={String(val)}
                                onClick={() => setAnswer(q.id, val)}
                                className={`flex-1 py-3.5 rounded-xl font-sans text-sm font-semibold transition-colors text-center ${value === val
                                  ? 'bg-primary-fixed-dim/10 text-white'
                                  : 'bg-surface-container/40 text-slate-400 hover:bg-surface-container/70'
                                  }`}
                              >
                                {val ? 'True' : 'False'}
                              </button>
                            ))}
                          </div>
                        )}

                        {q.type === 'identification' && (
                          <input
                            type="text"
                            value={(value as string) || ''}
                            onChange={e => setAnswer(q.id, e.target.value)}
                            placeholder="Type the exact concept or term..."
                            className={`w-full ${INPUT}`}
                          />
                        )}

                        {q.type === 'fill-in-the-blank' && (
                          <div className="space-y-3">
                            <div className="p-4 bg-white/[0.03] text-slate-300 rounded-xl font-mono text-sm leading-relaxed">
                              {q.blank}
                            </div>
                            <input
                              type="text"
                              value={(value as string) || ''}
                              onChange={e => setAnswer(q.id, e.target.value)}
                              placeholder="Type the missing word..."
                              className={`w-full ${INPUT}`}
                            />
                          </div>
                        )}

                        {q.type === 'matching' && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-3 pb-1">
                              <span className={LABEL}>Term</span>
                              <span className={LABEL}>Match</span>
                            </div>
                            {q.pairs?.map((pair, pIdx) => (
                              <div key={pIdx} className="grid grid-cols-2 gap-3 items-center">
                                <div className="bg-surface-container/40 rounded-xl p-3">
                                  <span className="font-sans text-sm text-slate-200">{pair.term}</span>
                                </div>
                                <select
                                  value={picks[pair.term] ?? ''}
                                  onChange={e => setMatch(q.id, pair.term, e.target.value)}
                                  className="bg-surface-container/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm font-sans text-white outline-none focus:border-primary-fixed-dim transition-colors"
                                >
                                  <option value="">Select match...</option>
                                  {(q.pairs || []).map((p, defIdx) => (
                                    <option key={defIdx} value={p.definition}>
                                      {p.definition.length > 50 ? p.definition.slice(0, 50) + '...' : p.definition}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        )}


                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Section navigation */}
              <div className="flex items-center justify-between gap-3 pt-5 border-t border-white/5">
                <button
                  onClick={() => setCurrentSectionIdx(i => Math.max(0, i - 1))}
                  disabled={currentSectionIdx === 0}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 font-sans text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Previous
                </button>

                {!sectionComplete && (
                  <span className="font-sans text-xs text-amber-400/80 text-center">
                    Answer all {currentSectionQuestions.length} question{currentSectionQuestions.length !== 1 ? 's' : ''} to continue
                  </span>
                )}

                {isLastSection ? (
                  <button
                    onClick={handleFinishTest}
                    disabled={!sectionComplete}
                    className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Finish &amp; See Results
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentSectionIdx(i => i + 1)}
                    disabled={!sectionComplete}
                    className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    Next: {sections[currentSectionIdx + 1]}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

            </div>
          </div>

          {/* Test overview — jump between sections, see what's left */}
          <div>
            <div className={`${CARD} p-5 space-y-4`}>
              <div>
                <h4 className={`${SECTION} flex items-center gap-2`}>
                  <List className="w-3.5 h-3.5 text-primary-fixed-dim" /> Test Overview
                </h4>
                <p className="font-sans text-xs text-slate-500 leading-relaxed mt-2">
                  Your answers are graded once you finish the final section.
                </p>
              </div>

              <div className="space-y-1">
                {sections.map((section, idx) => {
                  const sectionQs = questions.filter(q => q.section === section);
                  const done = sectionQs.filter(isAnswered).length;
                  const isCurrent = idx === currentSectionIdx;

                  return (
                    <button
                      key={section}
                      onClick={() => setCurrentSectionIdx(idx)}
                      className={`w-full text-left p-3 rounded-xl transition-colors ${isCurrent ? 'bg-primary-fixed-dim/10' : 'hover:bg-white/[0.03]'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-sans text-sm font-semibold ${isCurrent ? 'text-primary-fixed-dim' : 'text-slate-300'}`}>
                          {section}
                        </span>
                        <span className="font-sans text-xs text-slate-500 shrink-0">
                          {done}/{sectionQs.length}
                        </span>
                      </div>
                      <span className="font-sans text-[11px] text-slate-500 capitalize">
                        {sectionQs[0]?.type.replace(/-/g, ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                <span className="font-sans text-xs text-slate-500">Total answered</span>
                <span className="font-sans text-xs text-slate-300 font-semibold">
                  {questions.filter(isAnswered).length} / {questions.length}
                </span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ─── Results screen ───────────────────────────────────── */}
      {(quizFinished || previewingPastTest) && (
        <div key="results-screen" className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">

          {/* Summary card */}
          <div className={`${CARD} p-6`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary-fixed-dim/10 text-primary-fixed-dim flex items-center justify-center shrink-0">
                  <Trophy className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    {previewingPastTest ? 'Quiz Review' : 'Test Complete'}
                  </h3>
                  <p className="font-sans text-xs text-slate-500 mt-0.5">
                    {previewingPastTest
                      ? `${previewingPastTest.sourceTitle} • ${previewingPastTest.date}`
                      : 'Your concept mastery has been updated.'}
                  </p>
                </div>
              </div>

              {/* Score */}
              <div className="flex items-center gap-8">
                <div>
                  <span className={`${LABEL} block`}>Score</span>
                  <span className="font-display text-2xl font-bold text-white">
                    {previewingPastTest
                      ? `${previewingPastTest.score} / ${previewingPastTest.totalQuestions}`
                      : `${quizAnswers.filter(a => a.correct).length} / ${questions.length}`}
                  </span>
                </div>
                <div>
                  <span className={`${LABEL} block`}>Accuracy</span>
                  <span className="font-display text-2xl font-bold text-primary-fixed-dim">
                    {previewingPastTest
                      ? `${((previewingPastTest.score / previewingPastTest.totalQuestions) * 100).toFixed(0)}%`
                      : `${((quizAnswers.filter(a => a.correct).length / questions.length) * 100).toFixed(0)}%`}
                  </span>
                </div>
              </div>

            </div>

            <div className="mt-6 pt-5 border-t border-white/5 flex justify-end">
              <button
                onClick={goToDashboard}
                className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all"
              >
                Back to Overview
              </button>
            </div>
          </div>

          {/* Question review */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className={SECTION}>Question Review</h4>

              {/* Segmented tabs */}
              <div className="inline-flex items-center gap-1 p-1 bg-surface-container-lowest/60 rounded-xl">
                <button
                  onClick={() => setResultsActiveTab('all')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-sans font-semibold transition-colors ${resultsActiveTab === 'all'
                    ? 'bg-surface-container-high text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  All
                </button>
                <button
                  onClick={() => setResultsActiveTab('incorrect')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-sans font-semibold transition-colors ${resultsActiveTab === 'incorrect'
                    ? 'bg-surface-container-high text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  Incorrect
                </button>
              </div>
            </div>

            {/* Answer list */}
            <div className="space-y-3">
              {filteredAnswersReview.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-sans text-sm">
                  {resultsActiveTab === 'incorrect'
                    ? 'Perfect score — no incorrect questions to review.'
                    : 'No questions generated.'}
                </div>
              ) : (
                filteredAnswersReview.map((ans, idx) => (
                  <div key={idx} className={`${CARD} p-5 space-y-4`}>
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <span className="font-sans text-[11px] font-semibold text-primary-fixed-dim uppercase tracking-wider">
                          {ans.section}
                        </span>
                        <h5 className="font-sans text-sm text-white font-medium mt-1 leading-relaxed">
                          {ans.prompt}
                        </h5>
                      </div>

                      {/* Result badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-sans font-semibold uppercase tracking-wider shrink-0 ${ans.correct
                        ? 'bg-emerald-400/10 text-emerald-400'
                        : 'bg-red-400/10 text-red-400'
                        }`}>
                        {ans.correct ? 'Correct' : 'Incorrect'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-sans">
                      <div>
                        <span className={`${LABEL} block mb-1.5`}>Your Answer</span>
                        <div className={`p-3 rounded-xl ${ans.correct ? 'bg-emerald-400/[0.06] text-emerald-300' : 'bg-red-400/[0.06] text-red-300'}`}>
                          {typeof ans.selected === 'object' && ans.selected !== null
                            ? Object.entries(ans.selected).map(([term, def]) => `${term} -> ${def}`).join(', ')
                            : String(ans.selected ?? 'None')}
                        </div>
                      </div>
                      <div>
                        <span className={`${LABEL} block mb-1.5`}>Correct Answer</span>
                        <div className="p-3 bg-white/[0.03] text-slate-300 rounded-xl">
                          {ans.correctAnswerText}
                        </div>
                      </div>
                    </div>

                    <p className="font-sans text-sm text-slate-400 leading-relaxed">{ans.explanation}</p>

                  </div>
                ))
              )}
            </div>

          </div>

        </div>
      )}

      {/* ─── Dashboard (default) ──────────────────────────────── */}
      {onDashboard && (
        <div key="dashboard" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">

          {/* Past tests — left (1/3) */}
          <div className="lg:col-span-1">
            <div className={`${CARD} p-5 flex flex-col h-full min-h-[420px]`}>
              <h3 className={`${SECTION} flex items-center gap-2 mb-4`}>
                <Clock className="w-3.5 h-3.5" /> Past Tests
              </h3>

              {pastTests.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-slate-500">
                  <BrainCircuit className="w-10 h-10 opacity-20" />
                  <span className="font-sans text-sm max-w-[260px] leading-relaxed">
                    No tests yet. Start a quiz to begin tracking your performance.
                  </span>
                </div>
              ) : (
                <div className="space-y-1 overflow-y-auto no-scrollbar flex-1">
                  {pastTests.map((test) => {
                    const pct = test.totalQuestions
                      ? Math.round((test.score / test.totalQuestions) * 100)
                      : 0;
                    return (
                      <button
                        key={test.id}
                        onClick={() => {
                          setPreviewingPastTest(test);
                          setResultsActiveTab('all');
                        }}
                        className="w-full text-left p-4 rounded-xl hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <span className="font-sans text-sm text-slate-200 font-medium truncate block">
                            {test.sourceTitle}
                          </span>
                          <span className="font-sans text-[11px] text-slate-500">{test.date}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-display text-base font-bold text-white block">
                            {test.score}/{test.totalQuestions}
                          </span>
                          <span className="font-sans text-[11px] text-slate-500">{pct}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Mastery stats + start button — right (2/3) */}
          <div className="lg:col-span-2">
            <div className={`${CARD} p-6 space-y-6 h-full`}>

              {/* Panel header + start button */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h3 className={`${SECTION} flex items-center gap-2`}>
                  <BarChart2 className="w-3.5 h-3.5 text-primary-fixed-dim" /> Learning Mastery
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSetup(true)}
                  className="px-5 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all flex items-center gap-2"
                >
                  <Play className="w-4 h-4" /> Start a Test
                </button>
              </div>

              {/* Headline stats */}
              <div className="grid grid-cols-3 gap-4 pb-6 border-b border-white/5">
                <div>
                  <span className={`${LABEL} block`}>Overall Mastery</span>
                  <span className="font-display text-2xl font-bold text-primary-fixed-dim">
                    {(overallMastery * 100).toFixed(0)}%
                  </span>
                </div>
                <div>
                  <span className={`${LABEL} block`}>Avg. Score</span>
                  <span className="font-display text-2xl font-bold text-white">
                    {pastTests.length ? `${(averageAccuracy * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
                <div>
                  <span className={`${LABEL} block`}>Tests Taken</span>
                  <span className="font-display text-2xl font-bold text-white">{pastTests.length}</span>
                </div>
              </div>

              {/* Per-resource breakdown */}
              <div className="space-y-3">
                <span className={LABEL}>Mastery by Resource</span>
                {masteryByResource.length === 0 ? (
                  <p className="font-sans text-sm text-slate-500 py-6 text-center">
                    Upload a resource to start tracking concept mastery.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {masteryByResource.map(group => (
                      <div key={group.resource}>
                        <ResourceMasteryCard group={group} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      )}

      {/* ─── Setup screen ─────────────────────────────────────── */}
      {onSetup && (
        <div key="setup-screen" className="max-w-3xl mx-auto space-y-4 animate-in fade-in duration-300">

          <button
            onClick={() => setShowSetup(false)}
            className="flex items-center gap-2 px-3 py-1.5 -ml-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 font-sans text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          {/* Config form */}
          <div>
            <div className={`${CARD} p-6 space-y-8`}>

              {/* 1. Total questions */}
              <div className="space-y-3">
                <Step n={1}>Total Items</Step>
                <div className="flex gap-2 flex-wrap items-center">
                  {[5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleSetTotalQuestions(n)}
                      className={`w-11 py-2 rounded-lg font-sans text-sm font-semibold transition-colors ${totalQuestions === n
                        ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim'
                        : 'bg-surface-container/40 text-slate-400 hover:bg-surface-container/70 hover:text-white'
                        }`}
                    >
                      {n}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 ml-2">
                    <span className="font-sans text-xs text-slate-500">Custom</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={totalQuestions}
                      onChange={e => {
                        const val = Math.max(1, Number(e.target.value) || 1);
                        handleSetTotalQuestions(val);
                      }}
                      className="w-16 px-2 py-2 rounded-lg bg-surface-container/60 border border-white/10 text-white font-sans text-sm outline-none text-center focus:border-primary-fixed-dim transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Source */}
              <div className="space-y-3">
                <Step n={2}>Assessment Source</Step>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                  {/* Flashcard decks */}
                  <button
                    type="button"
                    onClick={() => setSourceType('flashcards')}
                    className={`p-4 rounded-xl text-left transition-colors ${sourceType === 'flashcards'
                      ? 'bg-primary-fixed-dim/10'
                      : 'bg-surface-container/40 hover:bg-surface-container/70'
                      }`}
                  >
                    <Layers className={`w-4 h-4 mb-2.5 ${sourceType === 'flashcards' ? 'text-primary-fixed-dim' : 'text-slate-500'}`} />
                    <span className="font-sans font-semibold text-sm text-white block">Flashcard Deck</span>
                    <span className="font-sans text-xs text-slate-500 mt-0.5 block">Generate from your review decks.</span>
                  </button>

                  {/* Course resources */}
                  <button
                    type="button"
                    disabled={!courseConnected}
                    onClick={() => setSourceType('resources')}
                    className={`p-4 rounded-xl text-left transition-colors ${!courseConnected
                      ? 'opacity-40 cursor-not-allowed bg-surface-container/20'
                      : sourceType === 'resources'
                        ? 'bg-primary-fixed-dim/10'
                        : 'bg-surface-container/40 hover:bg-surface-container/70'
                      }`}
                  >
                    <FileText className={`w-4 h-4 mb-2.5 ${sourceType === 'resources' ? 'text-primary-fixed-dim' : 'text-slate-500'}`} />
                    <span className="font-sans font-semibold text-sm text-white block">Course Resources</span>
                    <span className="font-sans text-xs text-slate-500 mt-0.5 block">
                      {courseConnected ? 'Generate from connected files.' : 'Connect a course to unlock.'}
                    </span>
                  </button>

                </div>

                {/* Source sub-selectors */}
                {sourceType === 'flashcards' && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                    <span className={LABEL}>Select Deck</span>
                    {flashcardSets.length === 0 ? (
                      <p className="font-sans text-xs text-amber-400">No decks available. Create a flashcard deck first.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {flashcardSets.map(deck => (
                          <button
                            key={deck.id}
                            type="button"
                            onClick={() => setSelectedDeckId(deck.id)}
                            className={`p-3 rounded-xl text-left font-sans text-xs flex justify-between items-center gap-2 transition-colors ${selectedDeckId === deck.id
                              ? 'bg-primary-fixed-dim/10 text-white'
                              : 'bg-surface-container/40 text-slate-400 hover:bg-surface-container/70'
                              }`}
                          >
                            <span className="font-semibold truncate">{deck.title}</span>
                            <span className="text-slate-500 shrink-0">{deck.cardCount} cards</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {sourceType === 'resources' && courseConnected && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                    <span className={LABEL}>Select Resource</span>
                    <div className="grid grid-cols-1 gap-2">
                      {availableResources.map(res => (
                        <button
                          key={res.id}
                          type="button"
                          onClick={() => setSelectedResourceName(res.title)}
                          className={`p-3 rounded-xl text-left font-sans text-xs flex items-center justify-between gap-2 transition-colors ${selectedResourceName === res.title
                            ? 'bg-primary-fixed-dim/10 text-white font-semibold'
                            : 'bg-surface-container/40 text-slate-400 hover:bg-surface-container/70'
                            }`}
                        >
                          <span className="truncate">{res.title}</span>
                          <Check className={`w-3.5 h-3.5 text-primary-fixed-dim shrink-0 ${selectedResourceName === res.title ? 'opacity-100' : 'opacity-0'}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* 3. Question types */}
              <div className="space-y-3">
                <Step n={3}>Question Types</Step>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {QUESTION_TYPES_INFO.map(qt => {
                    const sel = typesConfig[qt.id].enabled;
                    return (
                      <button
                        key={qt.id}
                        type="button"
                        onClick={() => toggleType(qt.id)}
                        className={`p-3.5 rounded-xl text-left transition-colors flex flex-col justify-between h-[88px] ${sel
                          ? 'bg-primary-fixed-dim/10'
                          : 'bg-surface-container/40 hover:bg-surface-container/70'
                          }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={sel ? 'text-primary-fixed-dim' : 'text-slate-500'}>{qt.icon}</span>
                          {sel && <Check className="w-3.5 h-3.5 text-primary-fixed-dim" />}
                        </div>
                        <div>
                          <p className={`font-sans text-sm font-semibold leading-tight ${sel ? 'text-white' : 'text-slate-300'}`}>{qt.label}</p>
                          <p className="font-sans text-[11px] text-slate-500 mt-0.5">{qt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Per-type config */}
              <div className="space-y-3">
                <Step n={4}>Section Layout</Step>
                <div className="divide-y divide-white/5">
                  {(Object.keys(typesConfig) as QuestionType[]).map(key => {
                    const config = typesConfig[key];
                    if (!config.enabled) return null;
                    const qt = QUESTION_TYPES_INFO.find(x => x.id === key);
                    if (!qt) return null;

                    const enabledCount = Object.values(typesConfig).filter((t: any) => t.enabled).length;
                    const allowedOptions = ['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'].slice(0, enabledCount);

                    return (
                      <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 animate-in fade-in duration-200">
                        <div className="flex items-center gap-2.5">
                          <span className="text-slate-500">{qt.icon}</span>
                          <span className="font-sans text-sm text-slate-200">{qt.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Dropdown
                            value={config.section}
                            onChange={val => {
                              setTypesConfig(prev => ({
                                ...prev,
                                [key]: { ...prev[key], section: val }
                              }));
                            }}
                            options={allowedOptions}
                            className="w-28 text-left"
                          />
                          <div className="flex items-center gap-2">
                            <span className="font-sans text-xs text-slate-500">Items</span>
                            <input
                              type="number"
                              min={0}
                              max={totalQuestions}
                              value={config.items}
                              onChange={e => {
                                const val = Math.max(0, Number(e.target.value) || 0);
                                setTypesConfig(prev => ({
                                  ...prev,
                                  [key]: { ...prev[key], items: val }
                                }));
                              }}
                              className="w-16 px-2 py-2 rounded-lg bg-surface-container/60 border border-white/10 text-white font-sans text-sm outline-none text-center focus:border-primary-fixed-dim transition-colors"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Validation messages */}
              {validation.duplicateSections && (
                <div className="flex items-start gap-3 p-4 bg-red-400/10 text-red-400 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-sans text-sm font-semibold block">Duplicate sections</span>
                    <span className="font-sans text-xs text-slate-400 mt-0.5 block leading-relaxed">
                      Two question types share the same section header. Give each enabled type a unique section.
                    </span>
                  </div>
                </div>
              )}

              {validation.overflow && (
                <div className="flex items-start gap-3 p-4 bg-amber-400/10 text-amber-400 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-sans text-sm font-semibold block">Too many items</span>
                    <span className="font-sans text-xs text-slate-400 mt-0.5 block leading-relaxed">
                      Your sections add up to {validation.sumItems}, which exceeds the {totalQuestions} total. Reduce section items or raise the total.
                    </span>
                  </div>
                </div>
              )}

              {validation.underflow && (
                <div className="flex items-start gap-3 p-4 bg-amber-400/10 text-amber-400 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-sans text-sm font-semibold block">Not enough items</span>
                    <span className="font-sans text-xs text-slate-400 mt-0.5 block leading-relaxed">
                      Your sections add up to {validation.sumItems}, short of the {totalQuestions} total. Adjust items to match.
                    </span>
                  </div>
                </div>
              )}

              {validation.noneSelected && (
                <div className="flex items-start gap-3 p-4 bg-red-400/10 text-red-400 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-sans text-sm font-semibold block">No question types enabled</span>
                    <span className="font-sans text-xs text-slate-400 mt-0.5 block leading-relaxed">
                      Enable at least one question type to configure the test.
                    </span>
                  </div>
                </div>
              )}

              {/* Start button */}
              <button
                type="button"
                onClick={handleStartTest}
                disabled={!validation.isValid}
                className="w-full py-3 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Enter Test Mode
              </button>

            </div>
          </div>

        </div>
      )}

    </div>
  );
}
