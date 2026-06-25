import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Check, Zap, Flame, Snowflake, Shield, List, ToggleLeft, HelpCircle, Edit3, GitMerge, AlignLeft, FileText, PenTool, Sparkles, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../../../lib/api';
import Dropdown from '../../../../components/ui/Dropdown';
import Modal from '../../../../components/ui/Modal';

interface Props { isOpen: boolean; onClose: () => void; courseResources: string[]; onCreate: (data: any) => void; }
type QType = 'multiple-choice' | 'true-false' | 'identification' | 'fill-in-the-blank' | 'essay' | 'matching';
type Diff = 'easy' | 'medium' | 'hard';

interface TypeConfig {
  typeId: QType;
  testLabel: string;
  itemCount: number;
  pointsPerItem?: number;
}

interface GenQuestion {
  id: string;
  text: string;
  type: QType;
  options: string[];
  correct: number;
  answerText: string;
  matchingPairs: { left: string; right: string }[];
  points: number;
  editing: boolean;
}

const Q_TYPES: { id: QType; label: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True / False', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', icon: <Edit3 className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'essay', label: 'Essay', icon: <AlignLeft className="w-4 h-4" /> },
];
const DIFFS: { id: Diff; label: string; color: string; icon: React.ReactNode }[] = [
  { id: 'easy', label: 'Easy', color: 'emerald', icon: <Snowflake className="w-4 h-4" /> },
  { id: 'medium', label: 'Medium', color: 'amber', icon: <Zap className="w-4 h-4" /> },
  { id: 'hard', label: 'Hard', color: 'red', icon: <Flame className="w-4 h-4" /> },
];
const Q_COUNTS = [5, 10, 15, 20, 25, 30, 40, 50];

const makeQuestion = (i: number, types: QType[]): GenQuestion => {
  const type = types[i % types.length] || 'multiple-choice';
  return {
    id: `q-${Date.now()}-${i}`,
    text: `AI-generated question ${i + 1}: What is the primary concept described in the selected resource?`,
    type,
    options: type === 'true-false' ? ['True', 'False'] : ['Option A', 'Option B', 'Option C', 'Option D'],
    correct: 0,
    answerText: 'Correct Answer',
    matchingPairs: [{ left: 'Term 1', right: 'Definition 1' }, { left: 'Term 2', right: 'Definition 2' }],
    points: type === 'essay' ? 5 : 2,
    editing: false,
  };
};

const redistributeItems = (configs: TypeConfig[], total: number): TypeConfig[] => {
  if (configs.length === 0) return configs;
  const base = Math.floor(total / configs.length);
  const remainder = total % configs.length;
  return configs.map((c, idx) => ({
    ...c,
    itemCount: base + (idx < remainder ? 1 : 0)
  }));
};

export default function CreateAssessmentModal({ isOpen, onClose, courseResources, onCreate }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [assessType, setAssessType] = useState<'quiz' | 'exam'>('quiz');
  const [duration, setDuration] = useState(30);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const method = 'ai';
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<QType[]>(['multiple-choice']);
  const [difficulty, setDifficulty] = useState<Diff>('medium');
  const [questionCount, setQuestionCount] = useState(10);
  const [questions, setQuestions] = useState<GenQuestion[]>([]);
  const [setQuestionsMap, setSetQuestionsMap] = useState<Record<string, GenQuestion[]>>({});
  const [activeSet, setActiveSet] = useState<string>('Set A');
  const [numberOfSets, setNumberOfSets] = useState(3);
  const [typeConfigs, setTypeConfigs] = useState<TypeConfig[]>(() => [
    { typeId: 'multiple-choice', testLabel: 'Test I', itemCount: 10, pointsPerItem: 2 }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { courseId } = useParams();
  const [dbResources, setDbResources] = useState<string[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);

  useEffect(() => {
    if (isOpen && courseId) {
      setLoadingResources(true);
      api.get<any[]>(`/courses/${courseId}/materials`)
        .then(res => {
          const names = (res.data || [])
            .filter(m => m.parsed_status === 'completed')
            .map(m => m.title);
          setDbResources(names);
        })
        .catch(err => console.error('Error fetching materials:', err))
        .finally(() => setLoadingResources(false));
    }
  }, [isOpen, courseId]);

  if (!isOpen) return null;

  const totalSteps = 5;
  const toggleType = (t: QType) => {
    setTypeConfigs(prev => {
      const exists = prev.some(x => x.typeId === t);
      let next: TypeConfig[];
      if (exists) {
        if (prev.length <= 1) return prev;
        next = prev.filter(x => x.typeId !== t);
      } else {
        const currentLabels = prev.map(x => x.testLabel);
        const options = ['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'];
        const unusedLabel = options.find(o => !currentLabels.includes(o)) || `Test ${prev.length + 1}`;
        next = [...prev, { typeId: t, testLabel: unusedLabel, itemCount: 0, pointsPerItem: t === 'essay' ? 5 : 2 }];
      }

      // Ensure designations are unique and strictly up to Test Roman(N)
      const limit = next.length;
      const allowedOptions = ['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'].slice(0, limit);
      const cleaned: TypeConfig[] = [];
      next.forEach(cfg => {
        let label = cfg.testLabel;
        if (!allowedOptions.includes(label) || cleaned.some(x => x.testLabel === label)) {
          label = allowedOptions.find(o => !cleaned.some(x => x.testLabel === o)) || allowedOptions[0];
        }
        cleaned.push({ ...cfg, testLabel: label });
      });

      return redistributeItems(cleaned, questionCount);
    });
  };
  const handleSetQuestionCount = (count: number) => {
    setQuestionCount(count);
    setTypeConfigs(prev => redistributeItems(prev, count));
  };

  const canProceed0 = title.trim().length > 0 && startDate !== '' && startTime !== '';
  const canProceed1 = selectedResources.length > 0;

  const sumItems = typeConfigs.reduce((s, c) => s + c.itemCount, 0);
  const hasDuplicateLabels = new Set(typeConfigs.map(c => c.testLabel)).size !== typeConfigs.length;
  const isSumOver = sumItems > questionCount;
  const isSumUnder = sumItems < questionCount;
  const canProceed2 = !hasDuplicateLabels && sumItems === questionCount;

  const diffColorMap: Record<string, { sel: string; unsel: string }> = {
    emerald: { sel: 'border-emerald-400 bg-emerald-400/10 text-emerald-300', unsel: 'border-white/10 text-slate-400' },
    amber: { sel: 'border-amber-400 bg-amber-400/10 text-amber-300', unsel: 'border-white/10 text-slate-400' },
    red: { sel: 'border-red-400 bg-red-400/10 text-red-300', unsel: 'border-white/10 text-slate-400' },
  };

  const handleNextFromReview = () => {
    if (step === 3) {
      const generatedTypes: QType[] = [];
      typeConfigs.forEach(cfg => {
        for (let j = 0; j < cfg.itemCount; j++) {
          generatedTypes.push(cfg.typeId);
        }
      });
      if (generatedTypes.length === 0) {
        generatedTypes.push('multiple-choice');
      }

      const baseQuestions = Array.from({ length: questionCount }, (_, i) => {
        const type = generatedTypes[i] || generatedTypes[generatedTypes.length - 1];
        const cfg = typeConfigs.find(c => c.typeId === type);
        const pts = cfg?.pointsPerItem ?? (type === 'essay' ? 5 : 2);
        return {
          ...makeQuestion(i, [type]),
          points: pts,
        };
      });

      const newSets: Record<string, GenQuestion[]> = {};
      const setLetters = ['A', 'B', 'C', 'D', 'E'].slice(0, numberOfSets);

      setLetters.forEach((letter, idx) => {
        const setLabel = `Set ${letter}`;
        let questionsForSet = baseQuestions.map(q => {
          let text = q.text;
          if (letter !== 'A') {
            text = text.replace(
              'What is the primary concept described in the selected resource?',
              `Identify the core principle detailed within the resource (Isomorphic Option ${letter}).`
            );
          }
          return {
            ...q,
            id: `${q.id}-set-${letter}`,
            text,
          };
        });

        if (letter !== 'A') {
          questionsForSet = [...questionsForSet].sort(() => Math.random() - 0.5);
        }

        newSets[setLabel] = questionsForSet;
      });

      setSetQuestionsMap(newSets);
      setQuestions(baseQuestions);
      setActiveSet('Set A');
    }
    setStep(s => s + 1);
  };

  const handleSave = (status: 'draft' | 'ready') => {
    let deadlineStr = '';
    if (startDate) {
      const formattedDate = new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
      if (startTime) {
        const [hours, minutes] = startTime.split(':');
        const ampm = Number(hours) >= 12 ? 'PM' : 'AM';
        const formattedHours = Number(hours) % 12 || 12;
        deadlineStr = `${formattedDate} · ${formattedHours}:${minutes} ${ampm}`;
      } else {
        deadlineStr = formattedDate;
      }
    }

    const mapToQuestionSchema = (q: GenQuestion) => {
      let correctAnswer: string | string[] = '';
      let options: string[] | undefined;

      if (q.type === 'multiple-choice') {
        options = q.options;
        correctAnswer = q.options[q.correct] ?? '';
      } else if (q.type === 'true-false') {
        options = ['True', 'False'];
        correctAnswer = q.correct === 0 ? 'true' : 'false';
      } else if (q.type === 'identification' || q.type === 'fill-in-the-blank') {
        correctAnswer = q.answerText;
      } else if (q.type === 'matching') {
        correctAnswer = q.matchingPairs.map((p) => `${p.left} → ${p.right}`);
      }

      return {
        id: q.id,
        type: q.type,
        question: q.text,
        options,
        correctAnswer,
        points: q.points || 2
      };
    };

    const finalQuestions = (setQuestionsMap['Set A'] || questions || []).map(mapToQuestionSchema);
    const finalSetMap: Record<string, any[]> = {};
    Object.keys(setQuestionsMap).forEach(k => {
      finalSetMap[k] = (setQuestionsMap[k] || []).map(mapToQuestionSchema);
    });

    onCreate({
      title,
      type: assessType,
      isLockdown: false,
      duration,
      deadline: deadlineStr,
      method,
      selectedResources,
      selectedTypes: typeConfigs.map(c => c.typeId),
      typeConfigs,
      numberOfSets,
      difficulty,
      questionCount,
      questions: finalQuestions,
      setQuestionsMap: finalSetMap,
      status
    });
    setStep(0);
    setTitle('');
    setQuestions([]);
    setSetQuestionsMap({});
    setActiveSet('Set A');
    onClose();
  };

  // Question editor helpers
  const updateQ = (id: string, patch: Partial<GenQuestion>) => {
    setSetQuestionsMap(prev => {
      const currentList = prev[activeSet] || [];
      const updatedList = currentList.map(q => q.id === id ? { ...q, ...patch } : q);
      return { ...prev, [activeSet]: updatedList };
    });
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q));
  };

  const deleteQ = (id: string) => {
    setSetQuestionsMap(prev => {
      const currentList = prev[activeSet] || [];
      const updatedList = currentList.filter(q => q.id !== id);
      return { ...prev, [activeSet]: updatedList };
    });
    setQuestions(qs => qs.filter(q => q.id !== id));
  };

  const addQuestion = () => {
    const defaultType = typeConfigs[0]?.typeId || 'multiple-choice';
    const cfg = typeConfigs.find(x => x.typeId === defaultType);
    const pts = cfg?.pointsPerItem ?? (defaultType === 'essay' ? 5 : 2);
    const newQ = { ...makeQuestion(questions.length, [defaultType]), text: '', points: pts, editing: true };
    setSetQuestionsMap(prev => {
      const currentList = prev[activeSet] || [];
      return { ...prev, [activeSet]: [...currentList, newQ] };
    });
    setQuestions(qs => [...qs, newQ]);
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }, 100);
  };

  const isLastStep = step === 4;
  const isGenerateStep = step === 3;

  const resourcesList = dbResources.length > 0
    ? dbResources
    : (courseResources.length > 0 ? courseResources : ["Course Syllabus & Introduction.pdf"]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Assessment"
      maxWidth="max-w-2xl"
    >
      <div className="flex flex-col gap-4 sm:gap-6 max-h-[75vh] landscape:max-h-[60vh] sm:max-h-[80vh] md:max-h-[90vh] overflow-y-auto pr-1 no-scrollbar">
        {/* Step Indicator */}
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs font-sans text-slate-400">
            <span className="font-semibold uppercase tracking-wider">Step {step + 1} of {totalSteps}</span>
            <span className="text-slate-500">{['Details', 'Select Resources', 'Configure AI', 'Review Config', 'Edit Questions'][step]}</span>
          </div>
          <div className="flex h-1.5 gap-1 bg-white/5 rounded-full overflow-hidden">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`flex-1 transition-all duration-500 rounded-full ${i <= step ? 'bg-primary-fixed-dim' : 'bg-transparent'}`} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 scroll-smooth relative">

          {/* Step 0: Details */}
          {step === 0 && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Title *</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Midterm Exam"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-3 block">Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['quiz', 'exam'] as const).map(t => (
                    <button key={t} onClick={() => setAssessType(t)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${assessType === t ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                      <p className={`font-sans text-sm font-semibold capitalize ${assessType === t ? 'text-primary-fixed' : 'text-white'}`}>{t}</p>
                      <p className="font-sans text-xs text-slate-400 mt-1">{t === 'quiz' ? 'Short assessment' : 'Comprehensive exam'}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Start Date *</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
                <div>
                  <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Start Time *</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                </div>
              </div>
              <div>
                <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Duration (minutes)</label>
                <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} min={5} max={240}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
              </div>
            </div>
          )}

          {/* Step 1: Select Resources */}
          {step === 1 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 rounded-xl p-4 items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary-fixed-dim mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-display text-sm font-semibold text-white">AI-Powered Isomorphic Questions</h4>
                  <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                    All assessments are automatically generated by the AI assistant using isomorphic question templates.
                    This ensures that each student receives structurally equivalent yet unique questions to prevent cheating and promote fairness.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Select Source Resources</p>
                {loadingResources ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 border border-white/5 bg-white/5 rounded-2xl animate-pulse">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-fixed-dim" />
                    <span className="font-sans text-sm text-slate-400">Loading course materials...</span>
                  </div>
                ) : resourcesList.map(res => {
                  const sel = selectedResources.includes(res);
                  return (
                    <button key={res} onClick={() => setSelectedResources(p => p.includes(res) ? p.filter(r => r !== res) : [...p, res])}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${sel ? 'border-primary-fixed-dim/50 bg-primary-fixed-dim/10' : 'border-white/5 bg-surface-container hover:border-white/20'}`}>
                      <div className="flex items-center gap-3">
                        <FileText className={`w-5 h-5 ${sel ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                        <p className={`font-sans text-sm font-semibold ${sel ? 'text-primary-fixed' : 'text-white'}`}>{res}</p>
                      </div>
                      {sel && <Check className="w-4 h-4 text-primary-fixed-dim shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Number of Questions (Total Items)</p>
                <div className="flex gap-2 flex-wrap items-center">
                  {Q_COUNTS.map(n => (
                    <button key={n} type="button" onClick={() => handleSetQuestionCount(n)}
                      className={`px-4 py-2 rounded-xl border-2 font-sans text-sm font-bold transition-all ${questionCount === n ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-primary-fixed' : 'border-white/10 bg-surface-container text-slate-400 hover:border-white/20'}`}>
                      {n}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 pl-3 border-l border-white/10 ml-2">
                    <span className="font-sans text-xs text-slate-400 font-semibold">Custom:</span>
                    <input type="number" min={1} max={100} value={questionCount}
                      onChange={e => {
                        const val = Math.max(1, Number(e.target.value));
                        handleSetQuestionCount(val);
                      }}
                      className="w-16 px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/10 text-white font-sans text-xs outline-none text-center focus:border-primary-fixed-dim" />
                  </div>
                </div>
              </div>

              {/* Question Types Selector */}
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Question Types</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Q_TYPES.map(qt => {
                    const sel = typeConfigs.some(x => x.typeId === qt.id);
                    return (
                      <button key={qt.id} type="button" onClick={() => toggleType(qt.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all flex items-center gap-2 ${sel ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}>
                        <span className={sel ? 'text-primary-fixed-dim' : 'text-slate-400'}>{qt.icon}</span>
                        <p className={`font-sans text-sm font-semibold ${sel ? 'text-primary-fixed' : 'text-white'}`}>{qt.label}</p>
                        {sel && <Check className="w-3.5 h-3.5 text-primary-fixed-dim ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Test Configurations */}
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Test Configurations</p>
                <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                  {typeConfigs.map(config => {
                    const qt = Q_TYPES.find(x => x.id === config.typeId);
                    if (!qt) return null;
                    return (
                      <div key={config.typeId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 animate-fade-in">
                        <div className="flex items-center gap-2">
                          <span className="text-primary-fixed-dim">{qt.icon}</span>
                          <span className="font-sans text-sm font-semibold text-white">{qt.label}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                          {/* Test Label Selection */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-xs text-slate-400">Designation:</span>
                            <Dropdown
                              value={config.testLabel}
                              onChange={val => {
                                setTypeConfigs(prev => prev.map(x => x.typeId === config.typeId ? { ...x, testLabel: val } : x));
                              }}
                              options={['Test I', 'Test II', 'Test III', 'Test IV', 'Test V', 'Test VI'].slice(0, typeConfigs.length).map(o => ({ label: o, value: o }))}
                              className="w-24 text-left font-sans text-xs"
                            />
                          </div>
                          {/* Item Count Selection */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-xs text-slate-400">Items:</span>
                            <input type="number" min={0} max={questionCount} value={config.itemCount}
                              onChange={e => {
                                const val = Math.max(0, Number(e.target.value));
                                setTypeConfigs(prev => prev.map(x => x.typeId === config.typeId ? { ...x, itemCount: val } : x));
                              }}
                              className="w-16 px-2 py-1 rounded-lg bg-surface-container border border-white/10 text-white font-sans text-xs outline-none text-center" />
                          </div>
                          {/* Points per Item */}
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-xs text-slate-400">Pts/Item:</span>
                            <input type="number" min={1} max={100} value={config.pointsPerItem || (config.typeId === 'essay' ? 5 : 2)}
                              onChange={e => {
                                const val = Math.max(1, Number(e.target.value));
                                setTypeConfigs(prev => prev.map(x => x.typeId === config.typeId ? { ...x, pointsPerItem: val } : x));
                              }}
                              className="w-14 px-2 py-1 rounded-lg bg-surface-container border border-white/10 text-white font-sans text-xs outline-none text-center" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Validation messages */}
                {hasDuplicateLabels && (
                  <p className="font-sans text-xs text-rose-400 font-semibold mt-1">
                    Duplicate test designation found. Each question type must have a unique Designation (e.g. Test I, Test II).
                  </p>
                )}
                {isSumOver && (
                  <p className="font-sans text-xs text-rose-400 font-semibold mt-1">
                    Total configured items ({sumItems}) exceeds the max limit of {questionCount} questions.
                  </p>
                )}
                {isSumUnder && (
                  <p className="font-sans text-xs text-amber-400 font-semibold mt-1">
                    Total configured items ({sumItems}) is less than the total {questionCount} questions. Please adjust items to match.
                  </p>
                )}
              </div>

              {/* Isomorphic Exam Sets */}
              <div className="space-y-3 pt-2">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Isomorphic Exam Sets</p>
                <div className="bg-primary-fixed-dim/5 border border-primary-fixed-dim/10 rounded-xl p-4 space-y-4">
                  <div className="block">
                    <p className="font-sans text-xs text-slate-400 leading-relaxed">
                      Select the number of isomorphic sets to generate. Question ordering is scrambled and definitions vary between sets (e.g. Set A meaning differs from Set B) to prevent student cheating.
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-sans text-xs font-semibold text-slate-300">Number of Sets:</span>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map(s => (
                        <button key={s} type="button" onClick={() => setNumberOfSets(s)}
                          className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center font-sans text-sm font-bold transition-all ${numberOfSets === s ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-primary-fixed' : 'border-white/10 bg-surface-container text-slate-400 hover:border-white/20'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {Array.from({ length: numberOfSets }).map((_, i) => (
                      <span key={i} className="px-3 py-1 rounded-lg bg-surface-container border border-white/5 font-sans text-[10px] uppercase font-bold text-slate-300 animate-fade-in">
                        Set {String.fromCharCode(65 + i)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Review Config */}
          {step === 3 && (
            <div className="space-y-5 animate-fade-in">
              <p className="font-sans text-sm text-slate-300">Review your assessment configuration.</p>
              <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                {[
                  { label: 'Title', value: title },
                  { label: 'Type', value: assessType },
                  { label: 'Start Date', value: startDate },
                  { label: 'Start Time', value: startTime },
                  { label: 'Duration', value: `${duration} min` },
                  { label: 'Generation', value: 'AI Isomorphic' },
                  { label: 'Sets', value: `${numberOfSets} (${Array.from({ length: numberOfSets }).map((_, i) => String.fromCharCode(65 + i)).join(', ')})` },
                  { label: 'Resources', value: `${selectedResources.length} selected` },
                  { label: 'Questions', value: `${questionCount} items` },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-5 py-3">
                    <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">{r.label}</span>
                    <span className="font-sans text-sm text-white font-medium capitalize">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="hidden sm:flex bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 rounded-xl p-4 items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary-fixed-dim mt-0.5 shrink-0" />
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  Click Generate to create isomorphic questions from your selected resources. You can edit them in the next step.
                </p>
              </div>
            </div>
          )}
          {/* Step 4: Editable Questions */}
          {step === 4 && (() => {
            const questionsList = setQuestionsMap[activeSet] || questions || [];
            const totalPoints = questionsList.reduce((sum, q) => sum + (q.points || 2), 0);
            return (
              <div className="space-y-4 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                  <div>
                    <p className="font-sans text-sm text-slate-300 font-medium">Review & Edit Questions</p>
                    <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">
                      {questionsList.length} questions · <span className="text-indigo-400 font-bold">{totalPoints} Points Total</span> ({activeSet})
                    </p>
                  </div>
                  {/* Set Tabs Selector */}
                  {Object.keys(setQuestionsMap).length > 1 && (
                    <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/10 overflow-x-auto w-full sm:w-auto no-scrollbar shrink-0">
                      {Object.keys(setQuestionsMap).map(setLabel => (
                        <button
                          key={setLabel}
                          onClick={() => setActiveSet(setLabel)}
                          className={`flex-1 sm:flex-initial text-center px-4 py-1.5 rounded-lg font-sans text-xs font-bold transition-all ${activeSet === setLabel
                            ? 'bg-primary-fixed-dim text-on-primary-fixed shadow-md'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                          {setLabel}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Description of Isomorphic scrambler */}
                <div className="block bg-surface-container-lowest p-3.5 rounded-xl border border-white/5">
                  <p className="font-sans text-[11px] text-slate-400 leading-relaxed">
                    <span className="text-primary-fixed-dim font-bold uppercase tracking-wider block mb-1">Isomorphic Set Configuration ({activeSet})</span>
                    Questions in this set are jumbled and isomorphic variations are applied (meaning changes per set, but the core answers remain identical). Profs can check, test, and edit questions in each set below before the exam opens to ensure clarity.
                  </p>
                </div>

                <div className="space-y-3 pb-6">
                  {questionsList.map((q, idx) => (
                    <div key={q.id} className="bg-surface-container rounded-xl border border-white/5 overflow-hidden">
                      {q.editing ? (
                        <div key="edit" className="p-3 sm:p-4 space-y-3 animate-fade-in">
                          <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded shrink-0">Q{idx + 1}</span>
                              <span className="font-sans text-xs font-semibold text-slate-400 bg-white/5 border border-white/10 px-2.5 py-1 rounded-xl truncate">
                                {Q_TYPES.find(qt => qt.id === q.type)?.label || q.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-sans text-[10px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Points:</span>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={q.points || 2}
                                onChange={e => updateQ(q.id, { points: Math.max(1, Number(e.target.value)) })}
                                className="w-12 sm:w-16 px-1.5 py-1 rounded bg-white/5 border border-white/10 text-white font-sans text-xs text-center outline-none focus:border-primary-fixed-dim"
                              />
                            </div>
                          </div>
                          <textarea value={q.text} onChange={e => updateQ(q.id, { text: e.target.value })}
                            placeholder="Enter question text…"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none min-h-[60px]" />
                          {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                            <div className="space-y-2">
                              {q.type === 'multiple-choice' && <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Options & Correct Answer</p>}
                              {q.type === 'true-false' && <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Select Correct Answer</p>}
                              {q.options.map((opt, oi) => (
                                <div key={oi} className="flex items-center gap-2">
                                  <button onClick={() => updateQ(q.id, { correct: oi })}
                                    className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${q.correct === oi ? 'border-emerald-400 bg-emerald-400' : 'border-white/20'}`}>
                                    {q.correct === oi && <Check className="w-3 h-3 text-black" />}
                                  </button>
                                  {q.type === 'multiple-choice' ? (
                                    <input value={opt} onChange={e => { const opts = [...q.options]; opts[oi] = e.target.value; updateQ(q.id, { options: opts }); }}
                                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                  ) : (
                                    <span className="text-sm text-white font-sans">{opt}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                            <div className="space-y-1.5">
                              <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Correct Answer</p>
                              <input value={q.answerText} onChange={e => updateQ(q.id, { answerText: e.target.value })}
                                placeholder="Type the exact correct answer..."
                                className="w-full bg-white/5 border border-emerald-400/50 rounded-lg px-3 py-2 text-sm text-emerald-100 font-sans outline-none focus:ring-1 focus:ring-emerald-400/50" />
                            </div>
                          )}
                          {q.type === 'matching' && (
                            <div className="space-y-2">
                              <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Matching Pairs</p>
                              {q.matchingPairs.map((pair, pi) => (
                                <div key={pi} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white/5 p-2 rounded-xl border border-white/5 sm:bg-transparent sm:p-0 sm:border-0">
                                  <div className="flex-1 flex items-center gap-2">
                                    <input value={pair.left} onChange={e => { const pairs = [...q.matchingPairs]; pairs[pi].left = e.target.value; updateQ(q.id, { matchingPairs: pairs }); }}
                                      placeholder="Term"
                                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                    <span className="text-slate-500 hidden sm:inline">-</span>
                                  </div>
                                  <div className="flex-1 flex items-center gap-2">
                                    <input value={pair.right} onChange={e => { const pairs = [...q.matchingPairs]; pairs[pi].right = e.target.value; updateQ(q.id, { matchingPairs: pairs }); }}
                                      placeholder="Definition"
                                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40" />
                                    <button onClick={() => { const pairs = q.matchingPairs.filter((_, i) => i !== pi); updateQ(q.id, { matchingPairs: pairs }); }}
                                      className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all shrink-0"
                                      title="Remove pair">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                              <button onClick={() => updateQ(q.id, { matchingPairs: [...q.matchingPairs, { left: '', right: '' }] })}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs font-semibold hover:bg-white/10 transition-colors w-full justify-center mt-2">
                                <Plus className="w-3.5 h-3.5" /> Add Pair
                              </button>
                            </div>
                          )}
                          {q.type === 'essay' && (
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                              <p className="text-xs text-slate-400 font-sans italic">Essay questions will be manually graded by the educator.</p>
                            </div>
                          )}
                          <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => updateQ(q.id, { editing: false })}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-colors flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> Done
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div key="preview" className="p-3 sm:p-4 flex items-start gap-3 group animate-fade-in">
                          <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded shrink-0 mt-0.5">Q{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="font-sans text-[10px] text-slate-500 uppercase tracking-wider font-semibold bg-white/5 border border-white/10 px-2 py-0.5 rounded">{q.type}</span>
                              <span className="font-sans text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-bold">{q.points || 2} Points</span>
                            </div>
                            <p className="font-sans text-sm text-white leading-relaxed">{q.text || <span className="text-slate-500 italic">No question text</span>}</p>

                            {/* Answer Preview */}
                            <div className="mt-2 text-xs font-sans">
                              {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                                <span className="text-emerald-400 font-medium">Answer: {q.options[q.correct]}</span>
                              )}
                              {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                                <span className="text-emerald-400 font-medium">Answer: {q.answerText || 'Not set'}</span>
                              )}
                              {q.type === 'matching' && (
                                <span className="text-emerald-400 font-medium">{q.matchingPairs.length} pairs</span>
                              )}
                              {q.type === 'essay' && (
                                <span className="text-slate-400 italic">Manual Grading</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                            <button onClick={() => updateQ(q.id, { editing: true })}
                              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all" title="Edit">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteQ(q.id)}
                              className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-t border-white/10 shrink-0 bg-surface-container-lowest">
          <button onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {isLastStep ? (
            <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
              <button onClick={() => handleSave('draft')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-sans text-sm font-bold border border-white/20 text-slate-300 hover:bg-white/5 transition-all">
                <Save className="w-4 h-4 shrink-0" /> Draft
              </button>
              <button onClick={() => handleSave('ready')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all hover:opacity-90">
                <Sparkles className="w-4 h-4 shrink-0" /> Save Ready
              </button>
            </div>
          ) : (
            <button onClick={isGenerateStep ? handleNextFromReview : () => setStep(s => s + 1)}
              disabled={(step === 0 && !canProceed0) || (step === 1 && !canProceed1) || (step === 2 && !canProceed2)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {isGenerateStep ? <><Sparkles className="w-4 h-4" /> Generate</> : <>Next <ChevronRight className="w-4 h-4" /></>}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
