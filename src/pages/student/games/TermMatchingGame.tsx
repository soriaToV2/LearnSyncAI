import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { MOCK_COURSES } from '../../../data/mockCourses';
import { COURSE_DATABASE, getCourseDisplayInfo, getCourseResources } from './gamesData';

interface CardItem {
  id: string;
  type: 'term' | 'definition';
  text: string;
  matchId: string;
}

export default function TermMatchingGame() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('course') || 'bio-301';

  const targetCourse = MOCK_COURSES.find(c => c.id === courseId) || MOCK_COURSES[0];
  const targetInfo = getCourseDisplayInfo(targetCourse);
  const targetData = COURSE_DATABASE[targetInfo.gameKey];
  const finalConnectedResources = getCourseResources(courseId);

  const [matchingCards, setMatchingCards] = useState<CardItem[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [failedPair, setFailedPair] = useState<[string, string] | null>(null);
  const [matchingVictory, setMatchingVictory] = useState(false);
  const [matcherClueId, setMatcherClueId] = useState<string | null>(null);

  const startMatchingGame = () => {
    setSelectedCardId(null);
    setMatchedIds([]);
    setFailedPair(null);
    setMatchingVictory(false);
    setMatcherClueId(null);

    const cards: CardItem[] = [];
    targetData.terms.forEach((item, idx) => {
      const matchId = `pair-${idx}`;
      cards.push({ id: `term-${idx}`, type: 'term', text: item.term, matchId });
      cards.push({ id: `def-${idx}`, type: 'definition', text: item.definition, matchId });
    });
    cards.sort(() => Math.random() - 0.5);
    setMatchingCards(cards);
  };

  useEffect(() => {
    startMatchingGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

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

      if (newMatched.length === matchingCards.length) {
        setMatchingVictory(true);
      }
    } else {
      setFailedPair([firstCard.id, secondCard.id]);

      const partner = matchingCards.find(c => c.matchId === firstCard.matchId && c.id !== firstCard.id)!;
      setMatcherClueId(partner.id);

      setTimeout(() => {
        setFailedPair(null);
        setSelectedCardId(null);
      }, 1000);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <button
          onClick={() => navigate('/student/games')}
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
          onClick={startMatchingGame}
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
          <div className="pt-4 flex gap-4 justify-center">
            <button
              onClick={() => navigate('/student/games')}
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
  );
}
