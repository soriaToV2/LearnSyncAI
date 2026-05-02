import React, { useState, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Check, X as XIcon, Trophy, RotateCcw, ChevronRight } from 'lucide-react';
import type { QuizConfig, QuestionType } from './QuizSetupModal';

interface Flashcard { id: number; front: string; back: string; }

interface QuizViewProps {
  config: QuizConfig;
  flashcardSets: { id: number; title: string; cards: Flashcard[] }[];
  onExit: () => void;
}

// ── Question shape ─────────────────────────────────────────────────────────────
interface BaseQuestion { id: number; type: QuestionType; prompt: string; }
interface MCQuestion extends BaseQuestion { type: 'multiple-choice'; options: string[]; correctIndex: number; }
interface TFQuestion extends BaseQuestion { type: 'true-false'; correct: boolean; }
interface IDQuestion extends BaseQuestion { type: 'identification'; answer: string; }
interface FIBQuestion extends BaseQuestion { type: 'fill-in-the-blank'; answer: string; blank: string; }
interface EssayQuestion extends BaseQuestion { type: 'essay'; sampleAnswer: string; }
interface MatchingQuestion extends BaseQuestion {
  type: 'matching';
  pairs: { term: string; definition: string }[];
}
type Question = MCQuestion | TFQuestion | IDQuestion | FIBQuestion | EssayQuestion | MatchingQuestion;
type UserAnswer = string | number | boolean | Record<string, string> | null;

// ── Question Generator ─────────────────────────────────────────────────────────
function generateQuestions(config: QuizConfig, flashcardSets: QuizViewProps['flashcardSets']): Question[] {
  let cards: Flashcard[] = [];

  const source = config.source;
  if (source.type === 'flashcard-set') {
    const set = flashcardSets.find(s => s.id === source.setId);
    cards = set?.cards ?? [];
  } else {
    // Simulate resource-based cards
    cards = [
      { id: 9001, front: 'What initiates neurotransmitter release?', back: 'An influx of Ca2+ ions triggered by an action potential.' },
      { id: 9002, front: 'What is the synaptic cleft?', back: 'The gap between presynaptic and postsynaptic neurons.' },
      { id: 9003, front: 'What is EPSP?', back: 'Excitatory Postsynaptic Potential — depolarization of postsynaptic membrane.' },
      { id: 9004, front: 'What is the myelin sheath function?', back: 'Increases the speed of electrical impulse propagation.' },
      { id: 9005, front: 'Define action potential.', back: 'A rapid change in membrane potential traveling along the axon.' },
    ];
  }

  if (cards.length === 0) return [];

  const pool: Question[] = [];
  const types = config.questionTypes;
  let idCounter = 1;

  cards.forEach((card, i) => {
    const type = types[i % types.length];
    const otherCards = cards.filter(c => c.id !== card.id);
    const distractors = otherCards.slice(0, 3).map(c => c.back);

    switch (type) {
      case 'multiple-choice': {
        const options = shuffle([card.back, ...distractors.slice(0, 3)]);
        pool.push({ id: idCounter++, type, prompt: card.front, options, correctIndex: options.indexOf(card.back) });
        break;
      }
      case 'true-false': {
        const isTrue = Math.random() > 0.5;
        const wrongBack = otherCards[0]?.back ?? card.back;
        pool.push({ id: idCounter++, type, prompt: isTrue ? `"${card.back}" is the answer to: ${card.front}` : `"${wrongBack}" is the answer to: ${card.front}`, correct: isTrue });
        break;
      }
      case 'identification':
        pool.push({ id: idCounter++, type, prompt: card.front, answer: card.back });
        break;
      case 'fill-in-the-blank': {
        const words = card.back.split(' ');
        const keyIdx = Math.floor(words.length / 2);
        const keyWord = words[keyIdx];
        const blank = words.map((w, wi) => wi === keyIdx ? '_____' : w).join(' ');
        pool.push({ id: idCounter++, type, prompt: card.front, answer: keyWord, blank });
        break;
      }
      case 'essay':
        pool.push({ id: idCounter++, type, prompt: `Explain in your own words: ${card.front}`, sampleAnswer: card.back });
        break;
      case 'matching': {
        const matchPairs = cards.slice(i, i + Math.min(4, cards.length)).map(c => ({ term: c.front, definition: c.back }));
        if (matchPairs.length >= 2) {
          pool.push({ id: idCounter++, type, prompt: 'Match each term to its correct definition.', pairs: matchPairs });
        }
        break;
      }
    }
  });

  return shuffle(pool).slice(0, config.questionCount);
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ── Score helpers ──────────────────────────────────────────────────────────────
function scoreAnswer(question: Question, answer: UserAnswer): boolean {
  if (answer === null) return false;
  switch (question.type) {
    case 'multiple-choice': return answer === question.correctIndex;
    case 'true-false': return answer === question.correct;
    case 'identification':
    case 'fill-in-the-blank':
      return typeof answer === 'string' && answer.trim().toLowerCase() === question.answer.toLowerCase();
    case 'essay': return true; // essays are auto-passed (self-graded)
    case 'matching': {
      if (typeof answer !== 'object' || Array.isArray(answer)) return false;
      return question.pairs.every(p => (answer as Record<string, string>)[p.term]?.trim().toLowerCase() === p.definition.toLowerCase());
    }
  }
}

// ── Sub-renderers ──────────────────────────────────────────────────────────────
function MCRenderer({ q, answer, setAnswer, submitted }: { q: MCQuestion; answer: UserAnswer; setAnswer: (a: UserAnswer) => void; submitted: boolean }) {
  return (
    <div className="space-y-3 mt-2">
      {q.options.map((opt, i) => {
        const selected = answer === i;
        const correct = submitted && i === q.correctIndex;
        const wrong = submitted && selected && i !== q.correctIndex;
        return (
          <button key={i} disabled={submitted} onClick={() => setAnswer(i)}
            className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all
              ${correct ? 'border-emerald-400 bg-emerald-400/10' : wrong ? 'border-red-400 bg-red-400/10' : selected ? 'border-primary-fixed-dim bg-primary-fixed-dim/10' : 'border-white/10 bg-surface-container hover:border-white/20 disabled:hover:border-white/10'}`}>
            <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 text-xs font-bold
              ${correct ? 'border-emerald-400 text-emerald-400' : wrong ? 'border-red-400 text-red-400' : selected ? 'border-primary-fixed-dim text-primary-fixed-dim' : 'border-white/20 text-slate-400'}`}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className="font-sans text-sm text-white">{opt}</span>
            {correct && <Check className="w-4 h-4 text-emerald-400 ml-auto" />}
            {wrong && <XIcon className="w-4 h-4 text-red-400 ml-auto" />}
          </button>
        );
      })}
    </div>
  );
}

function TFRenderer({ q, answer, setAnswer, submitted }: { q: TFQuestion; answer: UserAnswer; setAnswer: (a: UserAnswer) => void; submitted: boolean }) {
  return (
    <div className="flex gap-4 mt-2">
      {[true, false].map(val => {
        const selected = answer === val;
        const correct = submitted && val === q.correct;
        const wrong = submitted && selected && val !== q.correct;
        return (
          <button key={String(val)} disabled={submitted} onClick={() => setAnswer(val)}
            className={`flex-1 py-5 rounded-xl border-2 font-display text-lg font-bold transition-all
              ${correct ? 'border-emerald-400 bg-emerald-400/10 text-emerald-400' : wrong ? 'border-red-400 bg-red-400/10 text-red-400' : selected ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 text-primary-fixed' : 'border-white/10 bg-surface-container text-white hover:border-white/20 disabled:hover:border-white/10'}`}>
            {val ? 'TRUE' : 'FALSE'}
          </button>
        );
      })}
    </div>
  );
}

function TextInputRenderer({ answer, setAnswer, submitted, label }: { answer: UserAnswer; setAnswer: (a: UserAnswer) => void; submitted: boolean; label: string }) {
  return (
    <div className="mt-2">
      <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold block mb-2">{label}</label>
      <input type="text" disabled={submitted} value={typeof answer === 'string' ? answer : ''} onChange={e => setAnswer(e.target.value)}
        placeholder="Type your answer..."
        className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm disabled:opacity-70" />
    </div>
  );
}

function EssayRenderer({ answer, setAnswer, submitted, sampleAnswer }: { answer: UserAnswer; setAnswer: (a: UserAnswer) => void; submitted: boolean; sampleAnswer: string }) {
  return (
    <div className="mt-2 space-y-3">
      <textarea disabled={submitted} rows={5} value={typeof answer === 'string' ? answer : ''} onChange={e => setAnswer(e.target.value)}
        placeholder="Write your answer here..."
        className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm resize-none disabled:opacity-70" />
      {submitted && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <p className="font-sans text-xs text-emerald-400 uppercase tracking-widest font-semibold mb-1">Sample Answer</p>
          <p className="font-sans text-sm text-slate-300">{sampleAnswer}</p>
        </div>
      )}
    </div>
  );
}

function MatchingRenderer({ q, answer, setAnswer, submitted }: { q: MatchingQuestion; answer: UserAnswer; setAnswer: (a: UserAnswer) => void; submitted: boolean }) {
  const ans = (typeof answer === 'object' && answer && !Array.isArray(answer)) ? answer as Record<string, string> : {};
  const shuffledDefs = useMemo(() => shuffle(q.pairs.map(p => p.definition)), [q]);
  return (
    <div className="mt-2 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Term</p>
        <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">Your Match</p>
      </div>
      {q.pairs.map(pair => {
        const correct = submitted && ans[pair.term]?.trim().toLowerCase() === pair.definition.toLowerCase();
        return (
          <div key={pair.term} className="grid grid-cols-2 gap-3 items-center">
            <div className="bg-surface-container border border-white/10 rounded-lg p-3">
              <p className="font-sans text-sm text-white">{pair.term}</p>
            </div>
            <select disabled={submitted} value={ans[pair.term] ?? ''} onChange={e => setAnswer({ ...ans, [pair.term]: e.target.value })}
              className={`bg-surface-container border rounded-lg px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 transition-all disabled:opacity-70 ${submitted ? (correct ? 'border-emerald-400 text-emerald-400' : 'border-red-400 text-red-400') : 'border-white/10 text-white'}`}>
              <option value="" disabled>Select...</option>
              {shuffledDefs.map(def => <option key={def} value={def}>{def.length > 50 ? def.slice(0, 50) + '…' : def}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function QuizView({ config, flashcardSets, onExit }: QuizViewProps) {
  const questions = useMemo(() => generateQuestions(config, flashcardSets), [config, flashcardSets]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<UserAnswer[]>(Array(questions.length).fill(null));
  const [submitted, setSubmitted] = useState<boolean[]>(Array(questions.length).fill(false));
  const [finished, setFinished] = useState(false);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-display text-xl text-white mb-4">Not enough content to generate questions.</p>
        <p className="font-sans text-sm text-slate-400 mb-6">Add more flashcards to your deck and try again.</p>
        <button onClick={onExit} className="px-5 py-2.5 bg-surface-container border border-white/10 text-white rounded-xl font-sans text-sm font-semibold hover:bg-surface-container-high transition-all flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
      </div>
    );
  }

  const q = questions[currentIdx];
  const currentAnswer = answers[currentIdx];
  const isSubmitted = submitted[currentIdx];
  const isCorrect = isSubmitted ? scoreAnswer(q, currentAnswer) : null;
  const progress = ((currentIdx + (finished ? 1 : 0)) / questions.length) * 100;

  const setCurrentAnswer = (val: UserAnswer) => {
    setAnswers(prev => { const n = [...prev]; n[currentIdx] = val; return n; });
  };

  const handleSubmit = () => {
    setSubmitted(prev => { const n = [...prev]; n[currentIdx] = true; return n; });
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      setFinished(true);
    }
  };

  const handleRestart = () => {
    setAnswers(Array(questions.length).fill(null));
    setSubmitted(Array(questions.length).fill(false));
    setCurrentIdx(0);
    setFinished(false);
  };

  // ── Results Screen ──
  if (finished) {
    const totalScored = questions.filter((q, i) => q.type !== 'essay' && scoreAnswer(q, answers[i])).length;
    const essayCount = questions.filter(q => q.type === 'essay').length;
    const scoredTotal = questions.length - essayCount;
    const pct = scoredTotal > 0 ? Math.round((totalScored / scoredTotal) * 100) : 100;
    const getGrade = () => pct >= 90 ? 'Excellent!' : pct >= 75 ? 'Good Job!' : pct >= 60 ? 'Keep Practicing' : 'Needs Review';
    const circumference = 2 * Math.PI * 54;

    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-lg bg-surface-container-lowest rounded-3xl border border-white/5 p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary-fixed-dim/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/10 flex items-center justify-center mx-auto mb-6">
              <Trophy className={`w-8 h-8 ${pct >= 75 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'}`} />
            </div>
            <h2 className="font-display text-2xl font-bold text-white mb-1">Quiz Complete!</h2>
            <p className="font-sans text-sm text-slate-400 mb-8">{getGrade()}</p>

            {scoredTotal > 0 && (
              <div className="relative w-36 h-36 mx-auto mb-8">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
                  <circle cx="60" cy="60" r="54" fill="none" strokeWidth="6" strokeLinecap="round"
                    className={pct >= 75 ? 'stroke-emerald-400' : pct >= 60 ? 'stroke-amber-400' : 'stroke-red-400'}
                    strokeDasharray={circumference} strokeDashoffset={circumference - (pct / 100) * circumference}
                    style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`font-display text-4xl font-bold ${pct >= 75 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</span>
                  <span className="font-sans text-xs text-slate-500 uppercase tracking-widest font-semibold">Score</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-8 text-sm">
              <div className="bg-surface-container rounded-xl p-3 border border-white/5">
                <p className="font-display text-xl font-bold text-white">{questions.length}</p>
                <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest">Total</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                <p className="font-display text-xl font-bold text-emerald-400">{totalScored}</p>
                <p className="font-sans text-[10px] text-emerald-400/70 uppercase tracking-widest">Correct</p>
              </div>
              {essayCount > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="font-display text-xl font-bold text-amber-400">{essayCount}</p>
                  <p className="font-sans text-[10px] text-amber-400/70 uppercase tracking-widest">Essays</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button onClick={handleRestart} className="w-full px-5 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Try Again
              </button>
              <button onClick={onExit} className="w-full px-5 py-3 bg-surface-container border border-white/10 text-on-surface rounded-xl font-sans text-sm font-semibold hover:bg-surface-container-high transition-all flex items-center justify-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back to Deck
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Question Screen ──
  const difficultyBadge: Record<string, string> = {
    easy: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    medium: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    hard: 'text-red-400 bg-red-400/10 border-red-400/30',
  };

  return (
    <div className="animate-in fade-in duration-300 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onExit} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-sans font-semibold text-sm uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Exit Quiz
        </button>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-lg border text-[10px] uppercase tracking-widest font-bold ${difficultyBadge[config.difficulty]}`}>
            {config.difficulty}
          </span>
          <span className="font-sans text-xs text-slate-500">{currentIdx + 1} / {questions.length}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-8">
        <div className="h-full bg-gradient-to-r from-primary-fixed-dim to-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Question Card */}
      <div className="w-full max-w-2xl mx-auto">
        <div className="bg-surface-container-lowest rounded-2xl border border-white/5 p-8">
          {/* Type Badge */}
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2.5 py-1 bg-surface-container border border-white/10 rounded-lg font-sans text-[10px] uppercase tracking-widest text-slate-400 font-semibold capitalize">
              {q.type.replace(/-/g, ' ')}
            </span>
            <span className="font-sans text-[10px] text-slate-600 uppercase tracking-widest">Q{currentIdx + 1}</span>
          </div>

          {/* Prompt */}
          <p className="font-display text-lg text-white font-medium leading-relaxed mb-2">{q.prompt}</p>

          {/* FIB blank sentence */}
          {q.type === 'fill-in-the-blank' && (
            <p className="font-sans text-sm text-primary-fixed-dim bg-primary-fixed-dim/5 border border-primary-fixed-dim/20 rounded-lg px-4 py-2 mb-2">{q.blank}</p>
          )}

          {/* Answer input */}
          {q.type === 'multiple-choice' && <MCRenderer q={q} answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} />}
          {q.type === 'true-false' && <TFRenderer q={q} answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} />}
          {q.type === 'identification' && <TextInputRenderer answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} label="Your Answer" />}
          {q.type === 'fill-in-the-blank' && <TextInputRenderer answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} label="Fill in the blank" />}
          {q.type === 'essay' && <EssayRenderer answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} sampleAnswer={q.sampleAnswer} />}
          {q.type === 'matching' && <MatchingRenderer q={q} answer={currentAnswer} setAnswer={setCurrentAnswer} submitted={isSubmitted} />}

          {/* Feedback banner */}
          {isSubmitted && isCorrect !== null && q.type !== 'essay' && (
            <div className={`mt-4 flex items-center gap-3 p-3 rounded-xl border ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              {isCorrect
                ? <><Check className="w-4 h-4 text-emerald-400 shrink-0" /><span className="font-sans text-sm text-emerald-300 font-medium">Correct!</span></>
                : <>
                  <XIcon className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="font-sans text-sm text-red-300 font-medium">
                    Incorrect.{' '}
                    {q.type === 'identification' || q.type === 'fill-in-the-blank'
                      ? <span className="text-slate-300">Answer: <strong>{q.answer}</strong></span>
                      : q.type === 'true-false'
                        ? <span className="text-slate-300">Correct: <strong>{q.correct ? 'TRUE' : 'FALSE'}</strong></span>
                        : null}
                  </span>
                </>
              }
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" /> Previous
          </button>

          <div className="flex gap-3">
            {!isSubmitted && (
              <button
                onClick={handleSubmit}
                disabled={currentAnswer === null || currentAnswer === '' || (typeof currentAnswer === 'object' && !Array.isArray(currentAnswer) && currentAnswer !== null && Object.keys(currentAnswer).length === 0)}
                className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit Answer
              </button>
            )}
            {isSubmitted && (
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.2)] hover:shadow-[0_0_30px_rgba(0,218,243,0.35)] transition-all"
              >
                {currentIdx < questions.length - 1 ? 'Next' : 'See Results'} <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
