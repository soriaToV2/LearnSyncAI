import React, { useState, useRef } from 'react';
import { Check, List, ToggleLeft, HelpCircle, Edit3, GitMerge, AlignLeft, PenTool, Plus, Trash2, Save, Sparkles } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';
import type { Question, QuestionType } from '../../../../data/mockEducatorData';
import Dropdown from '../../../../components/ui/Dropdown';

// Types
type QType = QuestionType;

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

// Constants
const Q_TYPES: { id: QType; label: string; icon: React.ReactNode }[] = [
  { id: 'multiple-choice', label: 'Multiple Choice', icon: <List className="w-4 h-4" /> },
  { id: 'true-false', label: 'True / False', icon: <ToggleLeft className="w-4 h-4" /> },
  { id: 'identification', label: 'Identification', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'fill-in-the-blank', label: 'Fill in the Blank', icon: <PenTool className="w-4 h-4" /> },
  { id: 'matching', label: 'Matching', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'essay', label: 'Essay', icon: <AlignLeft className="w-4 h-4" /> },
];

// Helpers

// Convert a stored Question to editable GenQuestion
function toGen(q: Question): GenQuestion {
  let options: string[] = [];
  let correct = 0;
  let answerText = '';
  let matchingPairs: { left: string; right: string }[] = [{ left: '', right: '' }];

  if (q.type === 'multiple-choice') {
    options = q.options ?? ['Option A', 'Option B', 'Option C', 'Option D'];
    const ca = typeof q.correctAnswer === 'string' ? q.correctAnswer : '';
    correct = Math.max(0, options.indexOf(ca));
  } else if (q.type === 'true-false') {
    options = ['True', 'False'];
    const ca = typeof q.correctAnswer === 'string' ? q.correctAnswer.toLowerCase() : 'true';
    correct = ca === 'true' ? 0 : 1;
  } else if (q.type === 'identification' || q.type === 'fill-in-the-blank') {
    answerText = typeof q.correctAnswer === 'string' ? q.correctAnswer : '';
  } else if (q.type === 'matching') {
    matchingPairs = Array.isArray(q.correctAnswer)
      ? q.correctAnswer.map((a) => {
        const [left = '', right = ''] = a.split(' → ');
        return { left, right };
      })
      : [{ left: '', right: '' }];
  }

  return {
    id: q.id,
    text: q.question,
    type: q.type,
    options,
    correct,
    answerText,
    matchingPairs,
    points: q.points ?? (q.type === 'essay' ? 5 : 2),
    editing: false,
  };
}

// Convert a GenQuestion back to storable Question
function fromGen(g: GenQuestion): Question {
  let correctAnswer: string | string[] = '';
  let options: string[] | undefined;

  if (g.type === 'multiple-choice') {
    options = g.options;
    correctAnswer = g.options[g.correct] ?? '';
  } else if (g.type === 'true-false') {
    options = ['True', 'False'];
    correctAnswer = g.correct === 0 ? 'true' : 'false';
  } else if (g.type === 'identification' || g.type === 'fill-in-the-blank') {
    correctAnswer = g.answerText;
  } else if (g.type === 'matching') {
    correctAnswer = g.matchingPairs.map((p) => `${p.left} → ${p.right}`);
  }

  return {
    id: g.id,
    type: g.type,
    question: g.text,
    options,
    correctAnswer,
    points: g.points || 2,
  };
}

// Create a blank GenQuestion ready for editing
function makeBlank(count: number): GenQuestion {
  return {
    id: `q-${Date.now()}-${count}`,
    text: '',
    type: 'multiple-choice',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct: 0,
    answerText: '',
    matchingPairs: [{ left: '', right: '' }],
    points: 2,
    editing: true,
  };
}

// Props
interface Props {
  isOpen: boolean;
  onClose: () => void;
  assessmentTitle: string;
  questions: Question[];
  setQuestionsMap?: Record<string, Question[]>;
  onSave: (questions: Question[], saveMode: 'draft' | 'ready', setQuestionsMap?: Record<string, Question[]>) => void;
}

// Component
export default function ManageAssessmentModal({ isOpen, onClose, assessmentTitle, questions, setQuestionsMap, onSave }: Props) {
  const [setQsMap, setSetQsMap] = useState<Record<string, GenQuestion[]>>(() => {
    if (setQuestionsMap && Object.keys(setQuestionsMap).length > 0) {
      const map: Record<string, GenQuestion[]> = {};
      Object.keys(setQuestionsMap).forEach(k => {
        map[k] = (setQuestionsMap[k] || []).map(toGen);
      });
      return map;
    }
    return { 'Set A': questions.map(toGen) };
  });
  const [activeSet, setActiveSet] = useState<string>('Set A');
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const activeQs = setQsMap[activeSet] || [];

  // Helpers
  const updateQ = (id: string, patch: Partial<GenQuestion>) => {
    setSetQsMap((prev) => {
      const currentList = prev[activeSet] || [];
      const updatedList = currentList.map((q) => (q.id === id ? { ...q, ...patch } : q));
      return { ...prev, [activeSet]: updatedList };
    });
  };

  const deleteQ = (id: string) => {
    setSetQsMap((prev) => {
      const currentList = prev[activeSet] || [];
      const updatedList = currentList.filter((q) => q.id !== id);
      return { ...prev, [activeSet]: updatedList };
    });
  };

  const addQuestion = () => {
    const newQ = makeBlank(activeQs.length);
    setSetQsMap((prev) => {
      const currentList = prev[activeSet] || [];
      return { ...prev, [activeSet]: [...currentList, newQ] };
    });
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }, 100);
  };

  const handleSave = (saveMode: 'draft' | 'ready') => {
    const finalSetMap: Record<string, Question[]> = {};
    Object.keys(setQsMap).forEach(k => {
      finalSetMap[k] = (setQsMap[k] || []).map(fromGen);
    });
    const mainQuestions = finalSetMap['Set A'] || [];
    onSave(mainQuestions, saveMode, finalSetMap);
    onClose();
  };

  // Render
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex flex-col gap-1 items-start">
          <span className="font-display text-base sm:text-lg font-semibold text-white">Manage Questions</span>
          <p className="font-sans text-xs text-slate-400 font-normal normal-case truncate max-w-xs">{assessmentTitle}</p>
        </div>
      }
      maxWidth="max-w-2xl"
      noPadding={true}
    >
      <div className="flex flex-col max-h-[75vh] landscape:max-h-[60vh] sm:max-h-[80vh] md:max-h-[85vh]">
        {/* Scrollable body */}
        <div ref={scrollRef} className="px-6 pb-6 pt-0 overflow-y-auto flex-1 no-scrollbar scroll-smooth relative min-h-0">
          <div className="space-y-4">

            {/* Sticky sub-header */}
            {(() => {
              const totalPoints = activeQs.reduce((sum, q) => sum + (q.points || 2), 0);
              const setKeys = Object.keys(setQsMap);
              return (
                <div className="sticky top-0 z-20 bg-surface-container-lowest pt-2.5 pb-3.5 -mx-6 px-6 border-b border-white/10 flex flex-col gap-3 mb-2 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-sans text-sm text-slate-300 font-medium">Review &amp; Edit Questions</p>
                      <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">
                        {activeQs.length} questions · <span className="text-indigo-400 font-bold">{totalPoints} Points Total</span> {setKeys.length > 1 && `(${activeSet})`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      {/* Set Tabs Selector */}
                      {setKeys.length > 1 && (
                        <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/10 overflow-x-auto no-scrollbar shrink-0">
                          {setKeys.map(setLabel => (
                            <button
                              key={setLabel}
                              type="button"
                              onClick={() => setActiveSet(setLabel)}
                              className={`px-3 py-1.5 rounded-lg font-sans text-xs font-bold transition-all ${activeSet === setLabel
                                ? 'bg-primary-fixed-dim text-on-primary-fixed shadow-md'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                            >
                              {setLabel}
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={addQuestion}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 text-primary-fixed-dim text-xs font-bold hover:bg-primary-fixed-dim/20 transition-all active:scale-95 shadow-lg shadow-primary-fixed-dim/5"
                      >
                        <Plus className="w-4 h-4" /> Add Question
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Empty state */}
            {activeQs.length === 0 && (
              <div className="text-center py-14 border-2 border-dashed border-white/10 rounded-2xl">
                <p className="text-slate-500 font-sans text-sm">No questions yet.</p>
                <p className="text-slate-600 font-sans text-xs mt-1">Click "Add Question" to get started.</p>
              </div>
            )}

            {/* Question cards */}
            <div className="space-y-3 pb-6">
              {activeQs.map((q, idx) => (
                <div key={q.id} className="bg-surface-container rounded-xl border border-white/5 overflow-hidden">

                  {q.editing ? (
                    <div key="edit" className="p-4 space-y-3 animate-fade-in">
                      {/* Row: Q-badge + type select + points input */}
                      <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded shrink-0">
                            Q{idx + 1}
                          </span>
                          <Dropdown
                            value={q.type}
                            onChange={(val) => {
                              const t = val as QType;
                              updateQ(q.id, {
                                type: t,
                                options:
                                  t === 'true-false' ? ['True', 'False'] :
                                    t === 'multiple-choice' ? ['Option A', 'Option B', 'Option C', 'Option D'] :
                                      [],
                                correct: 0,
                                answerText: '',
                                matchingPairs: [{ left: '', right: '' }],
                                points: t === 'essay' ? 5 : 2,
                              });
                            }}
                            options={Q_TYPES.map(qt => ({ label: qt.label, value: qt.id }))}
                            className="w-full max-w-[130px] sm:max-w-[176px] text-left text-xs shrink-0"
                          />
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

                      {/* Question textarea */}
                      <textarea
                        value={q.text}
                        onChange={(e) => updateQ(q.id, { text: e.target.value })}
                        placeholder="Enter question text…"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none min-h-[60px]"
                      />

                      {/* Multiple-choice / True-False options */}
                      {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                        <div className="space-y-2">
                          {q.type === 'multiple-choice' && (
                            <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">
                              Options &amp; Correct Answer
                            </p>
                          )}
                          {q.type === 'true-false' && (
                            <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">
                              Select Correct Answer
                            </p>
                          )}
                          {q.options.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateQ(q.id, { correct: oi })}
                                className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${q.correct === oi ? 'border-emerald-400 bg-emerald-400' : 'border-white/20'
                                  }`}
                              >
                                {q.correct === oi && <Check className="w-3 h-3 text-black" />}
                              </button>
                              {q.type === 'multiple-choice' ? (
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const opts = [...q.options];
                                    opts[oi] = e.target.value;
                                    updateQ(q.id, { options: opts });
                                  }}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
                                />
                              ) : (
                                <span className="text-sm text-white font-sans">{opt}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Identification / Fill-in-the-blank */}
                      {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                        <div className="space-y-1.5">
                          <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">
                            Correct Answer
                          </p>
                          <input
                            value={q.answerText}
                            onChange={(e) => updateQ(q.id, { answerText: e.target.value })}
                            placeholder="Type the exact correct answer..."
                            className="w-full bg-white/5 border border-emerald-400/50 rounded-lg px-3 py-2 text-sm text-emerald-100 font-sans outline-none focus:ring-1 focus:ring-emerald-400/50"
                          />
                        </div>
                      )}

                      {/* Matching */}
                      {q.type === 'matching' && (
                        <div className="space-y-2">
                          <p className="font-sans text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">
                            Matching Pairs
                          </p>
                          {q.matchingPairs.map((pair, pi) => (
                            <div key={pi} className="flex items-center gap-2">
                              <input
                                value={pair.left}
                                onChange={(e) => {
                                  const pairs = [...q.matchingPairs];
                                  pairs[pi] = { ...pairs[pi], left: e.target.value };
                                  updateQ(q.id, { matchingPairs: pairs });
                                }}
                                placeholder="Term"
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
                              />
                              <span className="text-slate-500">-</span>
                              <input
                                value={pair.right}
                                onChange={(e) => {
                                  const pairs = [...q.matchingPairs];
                                  pairs[pi] = { ...pairs[pi], right: e.target.value };
                                  updateQ(q.id, { matchingPairs: pairs });
                                }}
                                placeholder="Definition"
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-sans outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const pairs = q.matchingPairs.filter((_, i) => i !== pi);
                                  updateQ(q.id, { matchingPairs: pairs });
                                }}
                                className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all shrink-0"
                                title="Remove pair"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => updateQ(q.id, { matchingPairs: [...q.matchingPairs, { left: '', right: '' }] })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs font-semibold hover:bg-white/10 transition-colors w-full justify-center mt-2"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Pair
                          </button>
                        </div>
                      )}

                      {/* Essay */}
                      {q.type === 'essay' && (
                        <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                          <p className="text-xs text-slate-400 font-sans italic">
                            Essay questions will be manually graded by the educator.
                          </p>
                        </div>
                      )}

                      {/* Done button */}
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => updateQ(q.id, { editing: false })}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-colors flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" /> Done
                        </button>
                      </div>
                    </div>

                  ) : (
                    <div key="preview" className="p-4 flex items-start gap-3 group animate-fade-in">
                      <span className="font-sans text-xs font-semibold text-primary-fixed-dim bg-primary-fixed-dim/10 px-2 py-1 rounded shrink-0 mt-0.5">
                        Q{idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="font-sans text-[10px] text-slate-500 uppercase tracking-wider font-semibold bg-white/5 border border-white/10 px-2 py-0.5 rounded">{q.type}</span>
                          <span className="font-sans text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-bold">{q.points || 2} Points</span>
                        </div>
                        <p className="font-sans text-sm text-white leading-relaxed">
                          {q.text || <span className="text-slate-500 italic">No question text</span>}
                        </p>

                        {/* Answer preview */}
                        <div className="mt-2 text-xs font-sans">
                          {(q.type === 'multiple-choice' || q.type === 'true-false') && (
                            <span className="text-emerald-400 font-medium">
                              Answer: {q.options[q.correct]}
                            </span>
                          )}
                          {(q.type === 'identification' || q.type === 'fill-in-the-blank') && (
                            <span className="text-emerald-400 font-medium">
                              Answer: {q.answerText || 'Not set'}
                            </span>
                          )}
                          {q.type === 'matching' && (
                            <span className="text-emerald-400 font-medium">
                              {q.matchingPairs.length} pairs
                            </span>
                          )}
                          {q.type === 'essay' && (
                            <span className="text-slate-400 italic">Manual Grading</span>
                          )}
                        </div>
                      </div>

                      {/* Hover-revealed edit + delete */}
                      <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQ(q.id, { editing: true })}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteQ(q.id)}
                          className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-t border-white/5 shrink-0 bg-surface-container-lowest">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors w-full sm:w-auto"
          >
            Cancel
          </button>
          <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleSave('draft')}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-sans text-sm font-bold border border-white/20 text-slate-300 hover:bg-white/5 transition-all"
            >
              <Save className="w-4 h-4" /> Save as Draft
            </button>
            <button
              type="button"
              onClick={() => handleSave('ready')}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] transition-all hover:opacity-90"
            >
              <Sparkles className="w-4 h-4" /> Save as Ready
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
