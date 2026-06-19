import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Play, RefreshCw, CheckCircle2, AlertTriangle,
  ArrowRight, BrainCircuit, BarChart2, Star, Check, X,
  HelpCircle, List, ToggleLeft, Edit3, AlignLeft, GitMerge,
  BookOpen, Layers, Clock, ArrowLeft, Trophy, FileText
} from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';

// Types
export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'identification'
  | 'fill-in-the-blank'
  | 'matching'
  | 'essay';

interface ConceptMastery {
  name: string;
  probability: number;
  status: 'Mastered' | 'Reviewing' | 'Gaps Detected';
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
  availableResources: string[];
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
  sampleAnswer?: string;
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

const QUESTION_TYPES_INFO: { id: QuestionType; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', desc: '4 choices', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True or False', desc: 'Decide correctness', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', desc: 'Exact terms', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', desc: 'Fill the missing word', icon: <Edit3 className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching Type', desc: 'Match pairs', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'essay', label: 'Essay (Self-Graded)', desc: 'Short explanation', icon: <AlignLeft className="w-4 h-4" /> },
];

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
    'essay': { enabled: false, section: 'Test VI', items: 0 },
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

  const [inQuiz, setInQuiz] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<any>(null);
  const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
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
      setSelectedResourceName(availableResources[0]);
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
          case 'essay': {
            generatedQuestions.push({
              id: idCounter++,
              type: tConfig.type,
              section: tConfig.section,
              prompt: `Describe the neurological significance of: ${card.front}`,
              sampleAnswer: card.back,
              explanation: `An ideal response should detail: ${card.back}`,
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
    setCurrentQuestionIdx(0);
    setSelectedOption(null);
    setMatchingAnswers({});
    setShowExplanation(false);
    setQuizFinished(false);
    setInQuiz(true);
  };

  // Grade answer
  const handleGradeAnswer = () => {
    const q = questions[currentQuestionIdx];
    let isCorrect = false;
    let selectedVal: any = selectedOption;
    let correctAnswerText = '';

    switch (q.type) {
      case 'multiple-choice': {
        isCorrect = selectedOption === q.correctIndex;
        correctAnswerText = q.options ? q.options[q.correctIndex!] : '';
        break;
      }
      case 'true-false': {
        isCorrect = selectedOption === q.correctValue;
        correctAnswerText = q.correctValue ? 'TRUE' : 'FALSE';
        break;
      }
      case 'identification': {
        const userText = (selectedOption as string || '').trim().toLowerCase();
        const correctText = (q.answer || '').trim().toLowerCase();
        isCorrect = userText === correctText || correctText.includes(userText) && userText.length > 2;
        correctAnswerText = q.answer || '';
        break;
      }
      case 'fill-in-the-blank': {
        const userText = (selectedOption as string || '').trim().toLowerCase();
        const correctText = (q.answer || '').trim().toLowerCase();
        isCorrect = userText === correctText;
        correctAnswerText = q.answer || '';
        break;
      }
      case 'matching': {
        selectedVal = matchingAnswers;
        // Verify all matches
        const allMatches = q.pairs || [];
        const correctMatches = allMatches.every(p =>
          (matchingAnswers[p.term] || '').trim().toLowerCase() === p.definition.toLowerCase()
        );
        isCorrect = correctMatches;
        correctAnswerText = allMatches.map(p => `${p.term} -> ${p.definition}`).join(', ');
        break;
      }
      case 'essay': {
        // Essays auto-pass (self-graded)
        isCorrect = true;
        correctAnswerText = q.sampleAnswer || '';
        break;
      }
    }

    // Record answer
    const newAns: UserAnswer = {
      questionId: q.id,
      prompt: q.prompt,
      selected: selectedVal,
      correct: isCorrect,
      type: q.type,
      section: q.section,
      explanation: q.explanation,
      correctAnswerText
    };

    setQuizAnswers(prev => [...prev, newAns]);

    // Update BKT mastery
    setMasteryData(prev => prev.map(mastery => {
      if (mastery.name === q.concept) {
        let newProb = mastery.probability;
        if (isCorrect) {
          newProb = Math.min(0.99, newProb + (1 - newProb) * 0.35);
        } else {
          newProb = Math.max(0.1, newProb - newProb * 0.25);
        }
        return {
          ...mastery,
          probability: newProb,
          status: newProb >= 0.8 ? 'Mastered' : newProb >= 0.5 ? 'Reviewing' : 'Gaps Detected'
        };
      }
      return mastery;
    }));

    setShowExplanation(true);
  };

  const handleNextQuestion = () => {
    setSelectedOption(null);
    setMatchingAnswers({});
    setShowExplanation(false);

    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1);
    } else {
      // Save finished test to history
      const finalScore = quizAnswers.filter(a => a.correct).length;
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
        answers: quizAnswers,
        masteryAfter: [...masteryData]
      };

      const updatedHistory = [newTestHistory, ...pastTests];
      setPastTests(updatedHistory);
      localStorage.setItem('learnsync_test_history', JSON.stringify(updatedHistory));

      setQuizFinished(true);
    }
  };

  // Filter answers for review tabs
  const filteredAnswersReview = useMemo(() => {
    const activeTest = previewingPastTest || { answers: quizAnswers };
    if (resultsActiveTab === 'incorrect') {
      return activeTest.answers.filter(ans => !ans.correct);
    }
    return activeTest.answers;
  }, [resultsActiveTab, previewingPastTest, quizAnswers, quizFinished]);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2.5">
            <BrainCircuit className="w-6 h-6 text-primary-fixed-dim" />
            Adaptive Test Mode
          </h2>
          <p className="font-sans text-sm text-slate-400 mt-1">
            Build custom assessments using cards or course files. Bayesian Knowledge Tracing adjusts difficulty dynamically.
          </p>
        </div>
        {inQuiz && (
          <>
            <button
              onClick={() => setShowExitConfirmModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl font-sans text-sm font-semibold transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Exit Test
            </button>

            <Modal
              isOpen={showExitConfirmModal}
              onClose={() => setShowExitConfirmModal(false)}
              title="Exit Assessment"
            >
              <div className="space-y-6">
                <div className="flex items-start gap-3.5 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="font-sans text-sm text-slate-300 leading-relaxed">
                    Are you sure you want to exit the current test? Your progress will not be saved.
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowExitConfirmModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white font-sans text-sm font-semibold transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setInQuiz(false);
                      setQuizFinished(false);
                      setPreviewingPastTest(null);
                      setShowExitConfirmModal(false);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-sans text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-red-500/15"
                  >
                    Exit Test
                  </button>
                </div>
              </div>
            </Modal>
          </>
        )}
      </div>

      {/* Active quiz */}
      {inQuiz && !quizFinished && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Question column */}
          <div className="lg:col-span-2 space-y-6">

            {/* Question card */}
            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-8 backdrop-blur-md space-y-6">

              {/* Progress header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <span className="font-display text-sm font-bold text-primary-fixed-dim block uppercase tracking-wider">
                    {questions[currentQuestionIdx]?.section || 'Test I'}
                  </span>
                  <span className="font-sans text-[11px] text-slate-500 block capitalize mt-0.5">
                    Question Type: {questions[currentQuestionIdx]?.type.replace(/-/g, ' ')}
                  </span>
                </div>
                <span className="font-mono text-sm text-slate-400 font-bold bg-white/5 border border-white/10 px-3 py-1 rounded-lg">
                  {currentQuestionIdx + 1} / {questions.length}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-fixed-dim to-primary transition-all duration-300"
                  style={{ width: `${((currentQuestionIdx) / questions.length) * 100}%` }}
                />
              </div>

              {/* Prompt */}
              <div className="space-y-4 pt-2">
                <span className="font-sans text-[10px] text-slate-500 uppercase tracking-wider font-bold block bg-white/5 border border-white/5 px-2.5 py-1 rounded w-fit">
                  Concept: {questions[currentQuestionIdx]?.concept}
                </span>
                <h3 className="font-display text-lg font-medium text-white leading-relaxed">
                  {questions[currentQuestionIdx]?.prompt}
                </h3>
              </div>

              {/* Question inputs */}
              <div className="pt-2">

                {/* Multiple Choice */}
                {questions[currentQuestionIdx]?.type === 'multiple-choice' && (
                  <div className="space-y-3">
                    {questions[currentQuestionIdx]?.options?.map((opt, optIdx) => {
                      const isSelected = selectedOption === optIdx;
                      const correct = showExplanation && optIdx === questions[currentQuestionIdx].correctIndex;
                      const wrong = showExplanation && isSelected && optIdx !== questions[currentQuestionIdx].correctIndex;

                      return (
                        <button
                          key={optIdx}
                          disabled={showExplanation}
                          onClick={() => setSelectedOption(optIdx)}
                          className={`w-full flex items-start gap-3.5 p-4 rounded-xl border transition-all text-left font-sans text-sm ${correct
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-400'
                            : wrong
                              ? 'border-red-500/35 bg-red-500/10 text-red-400'
                              : isSelected
                                ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-white'
                                : 'border-white/5 bg-surface-container/50 text-slate-300 hover:border-white/10 hover:text-white'
                            }`}
                        >
                          <span className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 ${isSelected ? 'border-primary-fixed-dim text-primary-fixed-dim' : 'border-white/20 text-slate-400'
                            }`}>
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <span className="flex-1 leading-relaxed">{opt}</span>
                          {correct && <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 ml-auto" />}
                          {wrong && <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* True or False */}
                {questions[currentQuestionIdx]?.type === 'true-false' && (
                  <div className="flex gap-4">
                    {[true, false].map((val) => {
                      const isSelected = selectedOption === val;
                      const correct = showExplanation && val === questions[currentQuestionIdx].correctValue;
                      const wrong = showExplanation && isSelected && val !== questions[currentQuestionIdx].correctValue;

                      return (
                        <button
                          key={String(val)}
                          disabled={showExplanation}
                          onClick={() => setSelectedOption(val)}
                          className={`flex-1 py-5 rounded-xl border-2 font-display text-lg font-bold transition-all text-center ${correct
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : wrong
                              ? 'border-red-500/40 bg-red-500/10 text-red-400'
                              : isSelected
                                ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-white'
                                : 'border-white/10 bg-surface-container/50 text-slate-400 hover:border-white/20 hover:text-white'
                            }`}
                        >
                          {val ? 'TRUE' : 'FALSE'}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Identification */}
                {questions[currentQuestionIdx]?.type === 'identification' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      disabled={showExplanation}
                      value={selectedOption as string || ''}
                      onChange={e => setSelectedOption(e.target.value)}
                      placeholder="Type the exact concept or term..."
                      className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all"
                    />
                  </div>
                )}

                {/* Fill in the Blank */}
                {questions[currentQuestionIdx]?.type === 'fill-in-the-blank' && (
                  <div className="space-y-4">
                    <div className="p-4 bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 text-primary-fixed rounded-xl font-mono text-sm">
                      {questions[currentQuestionIdx]?.blank}
                    </div>
                    <input
                      type="text"
                      disabled={showExplanation}
                      value={selectedOption as string || ''}
                      onChange={e => setSelectedOption(e.target.value)}
                      placeholder="Type the missing word..."
                      className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all"
                    />
                  </div>
                )}

                {/* Matching */}
                {questions[currentQuestionIdx]?.type === 'matching' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 pb-1">
                      <span className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">Synapse Node</span>
                      <span className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">Select Function Mapping</span>
                    </div>
                    {questions[currentQuestionIdx]?.pairs?.map((pair, pIdx) => {
                      const availableDefs = questions[currentQuestionIdx].pairs?.map(p => p.definition) || [];
                      const isMatchCorrect = showExplanation && (matchingAnswers[pair.term] || '').trim().toLowerCase() === pair.definition.toLowerCase();

                      return (
                        <div key={pIdx} className="grid grid-cols-2 gap-3 items-center">
                          <div className="bg-surface-container/40 border border-white/5 rounded-lg p-3">
                            <span className="font-sans text-sm text-white font-medium">{pair.term}</span>
                          </div>
                          <select
                            disabled={showExplanation}
                            value={matchingAnswers[pair.term] ?? ''}
                            onChange={e => setMatchingAnswers(prev => ({ ...prev, [pair.term]: e.target.value }))}
                            className={`bg-surface-container border rounded-lg px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 transition-all ${showExplanation
                              ? isMatchCorrect
                                ? 'border-emerald-500/35 text-emerald-400'
                                : 'border-red-500/35 text-red-400'
                              : 'border-white/10 text-white'
                              }`}
                          >
                            <option value="">Select match...</option>
                            {availableDefs.map((def, defIdx) => (
                              <option key={defIdx} value={def}>{def.length > 50 ? def.slice(0, 50) + '...' : def}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Essay */}
                {questions[currentQuestionIdx]?.type === 'essay' && (
                  <div className="space-y-3">
                    <textarea
                      disabled={showExplanation}
                      rows={5}
                      value={selectedOption as string || ''}
                      onChange={e => setSelectedOption(e.target.value)}
                      placeholder="Explain the physiological action..."
                      className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all resize-none"
                    />
                    {showExplanation && (
                      <div className="p-4 bg-emerald-500/5 border border-emerald-500/25 rounded-xl space-y-1">
                        <span className="font-display text-xs text-emerald-400 font-bold uppercase tracking-wider block">Ideal Concept Mapping</span>
                        <p className="font-sans text-xs text-slate-300 leading-relaxed">{questions[currentQuestionIdx]?.sampleAnswer}</p>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Explanation */}
              {showExplanation && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2 animate-in slide-in-from-bottom-2">
                  <div className="flex justify-between items-center">
                    <span className="font-display text-xs font-bold text-white uppercase tracking-wider">BKT Diagnostic Feedback</span>
                    {questions[currentQuestionIdx]?.type !== 'essay' && (
                      <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-sans font-bold tracking-wider ${quizAnswers[quizAnswers.length - 1]?.correct
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                        }`}>
                        {quizAnswers[quizAnswers.length - 1]?.correct ? 'Correct Answer' : 'Incorrect'}
                      </span>
                    )}
                  </div>
                  <p className="font-sans text-xs text-slate-300 leading-relaxed">
                    {questions[currentQuestionIdx]?.explanation}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end pt-2 border-t border-white/5">
                {!showExplanation ? (
                  <button
                    onClick={handleGradeAnswer}
                    disabled={
                      (questions[currentQuestionIdx]?.type === 'matching' && Object.keys(matchingAnswers).length === 0) ||
                      (questions[currentQuestionIdx]?.type !== 'matching' && (selectedOption === null || selectedOption === ''))
                    }
                    className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Submit Answer
                  </button>
                ) : (
                  <button
                    onClick={handleNextQuestion}
                    className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg hover:bg-primary-container transition-all active:scale-95 flex items-center gap-2"
                  >
                    {currentQuestionIdx >= questions.length - 1 ? 'Finish Test' : 'Next Question'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

            </div>

          </div>

          {/* BKT panel */}
          <div className="space-y-6">
            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-6 backdrop-blur-md space-y-4">
              <h4 className="font-display text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary-fixed-dim" /> Cognitive Telemetry
              </h4>
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                As you submit answers, BKT recalculates your concept mastery probabilities.
              </p>

              <div className="space-y-3 pt-2">
                {masteryData.map((mastery, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300 truncate pr-2 font-medium">{mastery.name}</span>
                      <span className="font-mono font-bold text-primary-fixed-dim">{(mastery.probability * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-fixed-dim transition-all duration-300"
                        style={{ width: `${mastery.probability * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Results screen */}
      {(quizFinished || previewingPastTest) && (
        <div className="max-w-4xl mx-auto space-y-8 animate-in scale-in duration-300">

          {/* Summary card */}
          <div className="bg-surface-container-lowest/30 border border-white/10 rounded-3xl p-8 backdrop-blur-md relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 to-transparent pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">

              <div className="text-center md:text-left space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed flex items-center justify-center mx-auto md:mx-0">
                  <Trophy className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-display text-2xl font-semibold text-white">
                    {previewingPastTest ? 'Quiz Review' : 'Test Complete!'}
                  </h3>
                  <p className="font-sans text-xs text-slate-400 mt-1">
                    {previewingPastTest
                      ? `Source: ${previewingPastTest.sourceTitle} • Completed ${previewingPastTest.date}`
                      : 'Your cognitive profile has been updated.'}
                  </p>
                </div>
              </div>

              {/* Score */}
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">Total Score</span>
                  <span className="font-mono text-3xl font-black text-white">
                    {previewingPastTest
                      ? `${previewingPastTest.score} / ${previewingPastTest.totalQuestions}`
                      : `${quizAnswers.filter(a => a.correct).length} / ${questions.length}`}
                  </span>
                </div>
                <div className="text-center border-l border-white/10 pl-6">
                  <span className="block font-sans text-[10px] text-slate-400 uppercase font-semibold">Accuracy</span>
                  <span className="font-mono text-3xl font-black text-primary-fixed-dim">
                    {previewingPastTest
                      ? `${((previewingPastTest.score / previewingPastTest.totalQuestions) * 100).toFixed(0)}%`
                      : `${((quizAnswers.filter(a => a.correct).length / questions.length) * 100).toFixed(0)}%`}
                  </span>
                </div>
              </div>

            </div>

            <div className="mt-8 flex gap-3 border-t border-white/5 pt-6 justify-end">
              <button
                onClick={() => {
                  setInQuiz(false);
                  setQuizFinished(false);
                  setPreviewingPastTest(null);
                }}
                className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-sans text-sm font-bold transition-all active:scale-95 flex items-center gap-2"
              >
                Return to Setup Dashboard
              </button>
            </div>

          </div>

          {/* Question review */}
          <div className="bg-surface-container-lowest/30 border border-white/10 rounded-3xl p-8 backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h4 className="font-display text-lg font-semibold text-white">Question Review</h4>

              {/* Tabs */}
              <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl">
                <button
                  onClick={() => setResultsActiveTab('all')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-sans font-semibold transition-all ${resultsActiveTab === 'all'
                    ? 'bg-primary-fixed-dim text-on-primary-fixed shadow-md'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  All Questions
                </button>
                <button
                  onClick={() => setResultsActiveTab('incorrect')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-sans font-semibold transition-all ${resultsActiveTab === 'incorrect'
                    ? 'bg-primary-fixed-dim text-on-primary-fixed shadow-md'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  Incorrect Questions
                </button>
              </div>
            </div>

            {/* Answer list */}
            <div className="space-y-6">
              {filteredAnswersReview.length === 0 ? (
                <div className="text-center py-10 text-slate-500 font-sans text-sm">
                  {resultsActiveTab === 'incorrect'
                    ? 'Perfect score! No incorrect questions to review.'
                    : 'No questions generated.'}
                </div>
              ) : (
                filteredAnswersReview.map((ans, idx) => (
                  <div key={idx} className="border border-white/5 bg-surface-container/20 rounded-2xl p-6 space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <span className="font-display text-xs text-primary-fixed font-bold uppercase tracking-wider">
                          {ans.section}
                        </span>
                        <h5 className="font-display text-base text-white font-medium mt-1 leading-relaxed">
                          {ans.prompt}
                        </h5>
                      </div>

                      {/* Result badge */}
                      <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-sans font-bold uppercase tracking-wider shrink-0 ${ans.correct
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                        }`}>
                        {ans.correct ? 'Correct' : 'Incorrect'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans pt-2 border-t border-white/5">
                      <div>
                        <span className="text-slate-500 block mb-1">Your Answer</span>
                        <div className={`p-3 rounded-lg font-medium ${ans.correct ? 'bg-emerald-500/5 text-emerald-300' : 'bg-red-500/5 text-red-300'}`}>
                          {typeof ans.selected === 'object' && ans.selected !== null
                            ? Object.entries(ans.selected).map(([term, def]) => `${term} -> ${def}`).join(', ')
                            : String(ans.selected ?? 'None')}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-1">Correct Answer Reference</span>
                        <div className="p-3 bg-white/5 text-slate-300 rounded-lg font-medium">
                          {ans.correctAnswerText}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
                      <span className="font-display text-xs font-semibold text-slate-400 block mb-1">Feedback Explanation</span>
                      <p className="font-sans text-xs text-slate-300 leading-relaxed">{ans.explanation}</p>
                    </div>

                  </div>
                ))
              )}
            </div>

          </div>

        </div>
      )}

      {/* Setup screen */}
      {!inQuiz && !quizFinished && !previewingPastTest && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Config form */}
          <div className="lg:col-span-2 space-y-6">

            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-6 backdrop-blur-md space-y-6">

              <h3 className="font-display text-lg font-semibold text-white border-b border-white/10 pb-3">
                New Test Setup
              </h3>

              {/* 1. Total questions */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="font-sans text-xs text-slate-300 uppercase tracking-widest font-semibold">
                    1. Total Items (Number of Questions)
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  {[5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleSetTotalQuestions(n)}
                      className={`px-4 py-2.5 rounded-xl border font-sans text-sm font-bold transition-all ${totalQuestions === n
                        ? 'border-primary-fixed-dim bg-primary-fixed-dim/15 text-primary-fixed shadow-[0_0_15px_rgba(0,218,243,0.15)]'
                        : 'border-white/10 bg-surface-container text-slate-400 hover:border-white/20 hover:text-white'
                        }`}
                    >
                      {n}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 pl-3 border-l border-white/10 ml-2">
                    <span className="font-sans text-xs text-slate-400 font-semibold">Custom:</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={totalQuestions}
                      onChange={e => {
                        const val = Math.max(1, Number(e.target.value) || 1);
                        handleSetTotalQuestions(val);
                      }}
                      className="w-16 px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/10 text-white font-sans text-xs outline-none text-center focus:border-primary-fixed-dim"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Source */}
              <div className="space-y-4">
                <label className="font-sans text-xs text-slate-300 uppercase tracking-widest font-semibold block">
                  2. Select Assessment Source
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Flashcard decks */}
                  <button
                    type="button"
                    onClick={() => setSourceType('flashcards')}
                    className={`p-4 rounded-xl border text-left transition-all ${sourceType === 'flashcards'
                      ? 'border-primary-fixed-dim bg-primary-fixed-dim/5'
                      : 'border-white/10 bg-surface-container/50 hover:border-white/20'
                      }`}
                  >
                    <Layers className={`w-5 h-5 mb-2.5 ${sourceType === 'flashcards' ? 'text-primary-fixed' : 'text-slate-400'}`} />
                    <span className="font-display font-semibold text-sm text-white block">Active Flashcard Deck</span>
                    <span className="font-sans text-xs text-slate-500 mt-1 block">Generate questions from custom review decks.</span>
                  </button>

                  {/* Course resources */}
                  <button
                    type="button"
                    disabled={!courseConnected}
                    onClick={() => setSourceType('resources')}
                    className={`p-4 rounded-xl border text-left transition-all ${!courseConnected
                      ? 'opacity-40 cursor-not-allowed border-white/5 bg-surface-container/20'
                      : sourceType === 'resources'
                        ? 'border-primary-fixed-dim bg-primary-fixed-dim/5'
                        : 'border-white/10 bg-surface-container/50 hover:border-white/20'
                      }`}
                  >
                    <FileText className={`w-5 h-5 mb-2.5 ${sourceType === 'resources' ? 'text-primary-fixed' : 'text-slate-400'}`} />
                    <span className="font-display font-semibold text-sm text-white block">Course Resources</span>
                    <span className="font-sans text-xs text-slate-500 mt-1 block">
                      {courseConnected ? 'Generate questions from connected syllabus files.' : 'Connect a course first to unlock.'}
                    </span>
                  </button>

                </div>

                {/* Source sub-selectors */}
                {sourceType === 'flashcards' && (
                  <div className="space-y-2 pt-2 animate-in slide-in-from-top-1 duration-200">
                    <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest block font-bold">Select Deck Title</span>
                    {flashcardSets.length === 0 ? (
                      <p className="text-xs text-amber-400">No decks available. Create a flashcard deck first.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {flashcardSets.map(deck => (
                          <button
                            key={deck.id}
                            type="button"
                            onClick={() => setSelectedDeckId(deck.id)}
                            className={`p-3 rounded-xl border text-left font-sans text-xs flex justify-between items-center transition-all ${selectedDeckId === deck.id
                              ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-white'
                              : 'border-white/5 bg-surface-container-high/40 text-slate-400 hover:border-white/10'
                              }`}
                          >
                            <span className="font-semibold truncate pr-2">{deck.title}</span>
                            <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-[10px] shrink-0">{deck.cardCount} Cards</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {sourceType === 'resources' && courseConnected && (
                  <div className="space-y-2 pt-2 animate-in slide-in-from-top-1 duration-200">
                    <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest block font-bold">Select Resource Document</span>
                    <div className="grid grid-cols-1 gap-2">
                      {availableResources.map(res => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setSelectedResourceName(res)}
                          className={`p-3.5 rounded-xl border text-left font-sans text-xs flex items-center justify-between transition-all ${selectedResourceName === res
                            ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-white font-semibold'
                            : 'border-white/5 bg-surface-container-high/40 text-slate-400 hover:border-white/10'
                            }`}
                        >
                          <span className="truncate">{res}</span>
                          <Check className={`w-3.5 h-3.5 text-primary-fixed-dim ${selectedResourceName === res ? 'opacity-100' : 'opacity-0'}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* 3. Question types */}
              <div className="space-y-3">
                <label className="font-sans text-xs text-slate-300 uppercase tracking-widest font-semibold block">
                  3. Question Types Selection
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {QUESTION_TYPES_INFO.map(qt => {
                    const sel = typesConfig[qt.id].enabled;
                    return (
                      <button
                        key={qt.id}
                        type="button"
                        onClick={() => toggleType(qt.id)}
                        className={`p-3.5 rounded-xl border-2 text-left transition-all flex flex-col justify-between h-24 ${sel
                          ? 'border-primary-fixed-dim bg-primary-fixed-dim/10'
                          : 'border-white/10 bg-surface-container hover:border-white/20'
                          }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={sel ? 'text-primary-fixed-dim' : 'text-slate-400'}>{qt.icon}</span>
                          {sel && <Check className="w-3.5 h-3.5 text-primary-fixed-dim" />}
                        </div>
                        <div>
                          <p className={`font-sans text-sm font-bold leading-tight ${sel ? 'text-primary-fixed' : 'text-white'}`}>{qt.label}</p>
                          <p className="font-sans text-[10px] text-slate-500 mt-0.5 leading-none">{qt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Per-type config */}
              <div className="space-y-3">
                <label className="font-sans text-xs text-slate-300 uppercase tracking-widest font-semibold block">
                  4. Test Configurations
                </label>
                <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                  {(Object.keys(typesConfig) as QuestionType[]).map(key => {
                    const config = typesConfig[key];
                    if (!config.enabled) return null;
                    const qt = QUESTION_TYPES_INFO.find(x => x.id === key);
                    if (!qt) return null;

                    const enabledCount = Object.values(typesConfig).filter((t: any) => t.enabled).length;
                    const allowedOptions = ['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'].slice(0, enabledCount);

                    return (
                      <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 animate-in fade-in duration-200">
                        <div className="flex items-center gap-2">
                          <span className="text-primary-fixed-dim">{qt.icon}</span>
                          <span className="font-sans text-sm font-semibold text-white">{qt.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Section label */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-xs text-slate-400">Designation:</span>
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
                          </div>
                          {/* Item count */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-xs text-slate-400">Items:</span>
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
                              className="w-16 px-2 py-1.5 rounded-lg bg-surface-container border border-white/10 text-white font-sans text-xs outline-none text-center focus:border-primary-fixed-dim"
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
                <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl animate-in shake duration-300">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-display text-sm font-bold block leading-tight">Duplicate Sections Detected</span>
                    <span className="font-sans text-xs text-slate-400 mt-1 block">
                      Multiple question types are mapped to the same section header (e.g., both are Test I). Please ensure each enabled type has a unique section order.
                    </span>
                  </div>
                </div>
              )}

              {validation.overflow && (
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl animate-in slide-in-from-bottom-2">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-display text-sm font-bold block leading-tight">Item Count Overflow</span>
                    <span className="font-sans text-xs text-slate-400 mt-1 block">
                      The sum of questions in your sections ({validation.sumItems}) exceeds the Total Questions count ({totalQuestions}). Please reduce individual section items or increase Total Questions at the top.
                    </span>
                  </div>
                </div>
              )}

              {validation.underflow && (
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl animate-in slide-in-from-bottom-2">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-display text-sm font-bold block leading-tight">Configured Items Mismatch</span>
                    <span className="font-sans text-xs text-slate-400 mt-1 block">
                      Total configured items ({validation.sumItems}) is less than the requested {totalQuestions} questions. Please adjust items to match.
                    </span>
                  </div>
                </div>
              )}

              {validation.noneSelected && (
                <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-display text-sm font-bold block leading-tight">No Question Types Enabled</span>
                    <span className="font-sans text-xs text-slate-400 mt-1 block">
                      You must enable at least one question type (checkbox) to configure the test sections.
                    </span>
                  </div>
                </div>
              )}

              {/* BKT difficulty info */}
              <div className="p-4 bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 rounded-xl flex items-start gap-3">
                <BrainCircuit className="w-5 h-5 text-primary-fixed-dim shrink-0 mt-0.5" />
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  <strong className="text-white block mb-0.5">BKT Cognitive Difficulty Adjustment</strong>
                  The difficulty level of this test is dynamically controlled by Bayesian Knowledge Tracing (BKT). The system evaluates your responses in real time to calibrate the complexity of subsequent questions automatically.
                </p>
              </div>

              {/* Start button */}
              <button
                type="button"
                onClick={handleStartTest}
                disabled={!validation.isValid}
                className="w-full py-3.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.2)] hover:shadow-[0_0_30px_rgba(0,218,243,0.35)] transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start Test Loop
              </button>

            </div>

          </div>

          {/* History panel */}
          <div className="space-y-6">

            <div className="bg-surface-container-lowest/30 border border-white/10 rounded-2xl p-6 backdrop-blur-md space-y-4 flex flex-col h-full min-h-[400px]">

              <h3 className="font-display text-lg font-semibold text-white border-b border-white/10 pb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" /> Past Test History
              </h3>

              {pastTests.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <BrainCircuit className="w-10 h-10 text-slate-600 animate-pulse" />
                  <span className="font-sans text-xs text-slate-500 leading-relaxed block">
                    No tests taken yet. Start a new test loop to begin compiling performance telemetry.
                  </span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 no-scrollbar flex-1">
                  {pastTests.map((test) => (
                    <div
                      key={test.id}
                      className="p-3.5 bg-white/5 border border-white/5 rounded-xl space-y-2 hover:border-white/10 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-display text-xs text-white font-semibold truncate max-w-[150px]">
                          {test.sourceTitle}
                        </span>
                        <span className="font-mono text-xs text-primary-fixed font-bold">
                          {test.score} / {test.totalQuestions}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {test.date}</span>
                        <button
                          onClick={() => {
                            setPreviewingPastTest(test);
                            setResultsActiveTab('all');
                          }}
                          className="text-primary-fixed-dim hover:text-primary-fixed font-sans font-semibold underline transition-colors"
                        >
                          Review Test
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>

          </div>

        </div>
      )}

    </div>
  );
}
