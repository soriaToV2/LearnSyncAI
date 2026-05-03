import React, { useState } from 'react';
import {
  FileText, Layers, ChevronRight, ChevronLeft, Check,
  AlignLeft, List, ToggleLeft, GitMerge, Edit3, HelpCircle,
  Zap, Flame, Snowflake, X
} from 'lucide-react';
import { createPortal } from 'react-dom';

export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'identification'
  | 'fill-in-the-blank'
  | 'essay'
  | 'matching';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type QuizSource =
  | { type: 'flashcard-set'; setId: number; setTitle: string }
  | { type: 'resource'; resourceNames: string[] };

export interface QuizConfig {
  source: QuizSource;
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  questionCount: number;
}

interface FlashcardSet {
  id: number;
  title: string;
  cardCount: number;
}

interface QuizSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (config: QuizConfig) => void;
  preselectedSetId: number | null;
  flashcardSets: FlashcardSet[];
  availableResources: string[];
  courseConnected: boolean;
}

const QUESTION_TYPES: { id: QuestionType; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', desc: 'Pick the correct option from 4 choices', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True or False', desc: 'Decide if the statement is correct', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', desc: 'Name the term or concept', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', desc: 'Complete the missing word in a sentence', icon: <Edit3 className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching Type', desc: 'Match terms to their definitions', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'essay', label: 'Essay', desc: 'Write a short answer or explanation', icon: <AlignLeft className="w-4 h-4" /> },
];

const DIFFICULTIES: { id: Difficulty; label: string; desc: string; color: string; icon: React.ReactNode }[] = [
  { id: 'easy', label: 'Easy', desc: 'Straightforward recall', color: 'emerald', icon: <Snowflake className="w-4 h-4" /> },
  { id: 'medium', label: 'Medium', desc: 'Some analysis required', color: 'amber', icon: <Zap className="w-4 h-4" /> },
  { id: 'hard', label: 'Hard', desc: 'Deep understanding needed', color: 'red', icon: <Flame className="w-4 h-4" /> },
];

const QUESTION_COUNTS = [5, 10, 15, 20, 25];

export default function QuizSetupModal({
  isOpen, onClose, onStart, preselectedSetId, flashcardSets, availableResources, courseConnected
}: QuizSetupModalProps) {
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState<'flashcards' | 'resources'>('flashcards');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(['multiple-choice']);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionCount, setQuestionCount] = useState(10);

  const toggleType = (t: QuestionType) => {
    setSelectedTypes(prev =>
      prev.includes(t) ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t]
    );
  };

  const handleStart = () => {
    const source: QuizSource =
      sourceType === 'flashcards' && preselectedSetId !== null
        ? { type: 'flashcard-set', setId: preselectedSetId, setTitle: flashcardSets.find(s => s.id === preselectedSetId)?.title ?? '' }
        : { type: 'resource', resourceNames: selectedResources };

    onStart({ source, questionTypes: selectedTypes, difficulty, questionCount });
    // reset for next use
    setStep(0);
  };

  const canProceedStep0 =
    sourceType === 'flashcards' ? preselectedSetId !== null : selectedResources.length > 0;

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-2xl bg-surface-container-high rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Quiz / Test Mode</h2>
            <p className="font-sans text-xs text-slate-400 mt-0.5">
              Step {step + 1} of 3 — {step === 0 ? 'Choose Source' : step === 1 ? 'Question Types & Difficulty' : 'Review & Start'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress */}
        <div className="flex h-1">
          {[0, 1, 2].map(i => (
            <div key={i} className={`flex-1 transition-all duration-500 ${i <= step ? 'bg-primary-fixed-dim' : 'bg-white/5'}`} />
          ))}
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto no-scrollbar">

          {/* ── STEP 0: Source ── */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <p className="font-sans text-sm text-slate-300">Where should the quiz questions be generated from?</p>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSourceType('flashcards')}
                  className={`p-5 rounded-xl border-2 text-left transition-all ${sourceType === 'flashcards' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}
                >
                  <Layers className={`w-6 h-6 mb-3 ${sourceType === 'flashcards' ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-display font-semibold text-sm ${sourceType === 'flashcards' ? 'text-primary-fixed' : 'text-white'}`}>Currently Selected Deck</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">
                    {preselectedSetId 
                      ? `Use content from: ${flashcardSets.find(s => s.id === preselectedSetId)?.title ?? 'Unknown'}` 
                      : 'No deck selected'}
                  </p>
                </button>

                <button
                  onClick={() => courseConnected && setSourceType('resources')}
                  className={`p-5 rounded-xl border-2 text-left transition-all relative ${!courseConnected ? 'opacity-40 cursor-not-allowed' : ''} ${sourceType === 'resources' ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}
                >
                  <FileText className={`w-6 h-6 mb-3 ${sourceType === 'resources' ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                  <p className={`font-display font-semibold text-sm ${sourceType === 'resources' ? 'text-primary-fixed' : 'text-white'}`}>Course Resources</p>
                  <p className="font-sans text-xs text-slate-400 mt-1">
                    {courseConnected ? 'Use a connected course document' : 'Connect a course to unlock'}
                  </p>
                </button>
              </div>

              {/* Resource picker */}
              {sourceType === 'resources' && courseConnected && (
                <div className="space-y-2">
                  <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Select Resources (Select multiple)</p>
                  {availableResources.map(res => {
                    const isSelected = selectedResources.includes(res);
                    return (
                    <button
                      key={res}
                      onClick={() => {
                        setSelectedResources(prev => 
                          prev.includes(res) ? prev.filter(r => r !== res) : [...prev, res]
                        );
                      }}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${isSelected ? 'border-primary-fixed-dim/50 bg-primary-fixed-dim/10' : 'border-white/5 bg-surface-container hover:border-white/20'}`}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className={`w-5 h-5 ${isSelected ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                        <p className={`font-sans text-sm font-semibold ${isSelected ? 'text-primary-fixed' : 'text-white'}`}>{res}</p>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-primary-fixed-dim shrink-0" />}
                    </button>
                  )})}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1: Question Types & Difficulty ── */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Question Types */}
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Question Types <span className="text-slate-600 normal-case">(select all that apply)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  {QUESTION_TYPES.map(qt => {
                    const selected = selectedTypes.includes(qt.id);
                    return (
                      <button
                        key={qt.id}
                        onClick={() => toggleType(qt.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${selected ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={selected ? 'text-primary-fixed-dim' : 'text-slate-400'}>{qt.icon}</span>
                          <p className={`font-sans text-sm font-semibold ${selected ? 'text-primary-fixed' : 'text-white'}`}>{qt.label}</p>
                          {selected && <Check className="w-3.5 h-3.5 text-primary-fixed-dim ml-auto" />}
                        </div>
                        <p className="font-sans text-xs text-slate-500">{qt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Difficulty */}
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Difficulty Level</p>
                <div className="grid grid-cols-3 gap-3">
                  {DIFFICULTIES.map(d => {
                    const selected = difficulty === d.id;
                    const colorMap: Record<string, string> = {
                      emerald: selected ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-slate-400',
                      amber: selected ? 'border-amber-400 bg-amber-400/10 text-amber-300' : 'border-white/10 text-slate-400',
                      red: selected ? 'border-red-400 bg-red-400/10 text-red-300' : 'border-white/10 text-slate-400',
                    };
                    return (
                      <button
                        key={d.id}
                        onClick={() => setDifficulty(d.id)}
                        className={`p-4 rounded-xl border-2 text-center transition-all bg-surface-container hover:opacity-90 ${colorMap[d.color]}`}
                      >
                        <span className="flex justify-center mb-2">{d.icon}</span>
                        <p className="font-sans text-sm font-bold">{d.label}</p>
                        <p className="font-sans text-[10px] text-slate-500 mt-0.5">{d.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Question Count */}
              <div className="space-y-3">
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Number of Questions</p>
                <div className="flex gap-3 flex-wrap">
                  {QUESTION_COUNTS.map(n => (
                    <button
                      key={n}
                      onClick={() => setQuestionCount(n)}
                      className={`px-5 py-2.5 rounded-xl border-2 font-sans text-sm font-bold transition-all ${questionCount === n ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-primary-fixed' : 'border-white/10 bg-surface-container text-slate-400 hover:border-white/20'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Review ── */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in duration-300">
              <p className="font-sans text-sm text-slate-300">Review your quiz configuration before starting.</p>

              <div className="bg-surface-container-lowest rounded-xl border border-white/5 divide-y divide-white/5">
                <div className="flex items-center justify-between px-5 py-4">
                  <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">Source</span>
                  <span className="font-sans text-sm text-white font-medium">
                    {sourceType === 'flashcards'
                      ? flashcardSets.find(s => s.id === preselectedSetId)?.title ?? '—'
                      : selectedResources.length > 0 ? `${selectedResources.length} Resource(s)` : '—'}
                  </span>
                </div>
                <div className="flex items-start justify-between px-5 py-4 gap-4">
                  <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold shrink-0">Types</span>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {selectedTypes.map(t => (
                      <span key={t} className="px-2.5 py-1 bg-surface-container border border-white/10 rounded-lg font-sans text-xs text-slate-300 capitalize">
                        {QUESTION_TYPES.find(q => q.id === t)?.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between px-5 py-4">
                  <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">Difficulty</span>
                  <span className={`font-sans text-sm font-bold capitalize ${difficulty === 'easy' ? 'text-emerald-400' : difficulty === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>
                    {difficulty}
                  </span>
                </div>
                <div className="flex items-center justify-between px-5 py-4">
                  <span className="font-sans text-xs uppercase tracking-widest text-slate-400 font-semibold">Questions</span>
                  <span className="font-sans text-sm text-white font-medium">{questionCount}</span>
                </div>
              </div>

              <div className="bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 rounded-xl p-4 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center mt-0.5 shrink-0">
                  <Zap className="w-3 h-3 text-primary-fixed-dim" />
                </div>
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  Questions are automatically generated from your selected source. No preparation needed — just start and test your knowledge!
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button
            onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < 2 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={step === 0 && !canProceedStep0}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] hover:shadow-[0_0_30px_rgba(0,218,243,0.5)] transition-all hover:scale-[1.02]"
            >
              <Zap className="w-4 h-4" /> Start Quiz
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
