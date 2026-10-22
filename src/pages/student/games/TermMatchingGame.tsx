import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Sparkles, BrainCircuit, Link2, Crosshair } from 'lucide-react';
import clsx from 'clsx';
import {
  GameStage,
  GameStatusScreen,
  HudStat,
  ResultScreen,
  ScreenFlash,
  useGameContent,
  useGameFlash,
} from './gameUi';
import { useGameAudio } from './gameAudio';
import { shuffle } from '../../../lib/shuffle';

interface CardItem {
  id: string;
  type: 'term' | 'definition';
  text: string;
  matchId: string;
}

export default function TermMatchingGame() {
  const { data: targetData, resources, loading, error, calibration, regenerate, regenerating, recordSession } =
    useGameContent();

  const { flash, fire } = useGameFlash();
  const { play } = useGameAudio();

  const [termCards, setTermCards] = useState<CardItem[]>([]);
  const [defCards, setDefCards] = useState<CardItem[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [recentMatchIds, setRecentMatchIds] = useState<string[]>([]);
  const [failedPair, setFailedPair] = useState<[string, string] | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  // Wrong attempts per term (by matchId); the hint unlocks at 2.
  const [wrongCounts, setWrongCounts] = useState<Record<string, number>>({});
  const [moves, setMoves] = useState(0);
  const [combo, setCombo] = useState(0);
  const [victory, setVictory] = useState(false);

  const timers = useRef<number[]>([]);
  const startedAt = useRef(Date.now());
  const recorded = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay));
  }, []);

  const startGame = useCallback(() => {
    clearTimers();
    setSelectedCardId(null);
    setMatchedIds([]);
    setRecentMatchIds([]);
    setFailedPair(null);
    setHintId(null);
    setWrongCounts({});
    setMoves(0);
    setCombo(0);
    setVictory(false);
    startedAt.current = Date.now();
    recorded.current = false;

    const terms: CardItem[] = [];
    const defs: CardItem[] = [];
    (targetData?.terms ?? []).forEach((item, idx) => {
      const matchId = `pair-${idx}`;
      terms.push({ id: `term-${idx}`, type: 'term', text: item.term, matchId });
      defs.push({ id: `def-${idx}`, type: 'definition', text: item.definition, matchId });
    });

    setTermCards(shuffle(terms));
    setDefCards(shuffle(defs));
  }, [targetData, clearTimers]);

  useEffect(() => {
    startGame();
    return clearTimers;
  }, [startGame, clearTimers]);

  /* The anchored card, for the mobile selection bar. */
  const selectedCard =
    [...termCards, ...defCards].find((c) => c.id === selectedCardId) ?? null;

  const totalPairs = targetData?.terms.length ?? 0;
  const matchedPairs = matchedIds.length / 2;
  const accuracy = moves === 0 ? 100 : Math.round((matchedPairs / moves) * 100);

  // Log once. Accuracy = pairs / attempts; the review shows misses per pair.
  useEffect(() => {
    if (!victory || recorded.current) return;
    recorded.current = true;
    const ratio = moves > 0 ? totalPairs / moves : 1;
    const items = (targetData?.terms ?? []).map((t, idx) => ({
      term: t.term,
      definition: t.definition,
      wrongAttempts: wrongCounts[`pair-${idx}`] ?? 0,
    }));
    recordSession({
      accuracy: ratio,
      timeMs: Date.now() - startedAt.current,
      detail: { type: 'term_matcher', items },
    });
  }, [victory, moves, totalPairs, wrongCounts, targetData, recordSession]);

  const handleCardClick = (card: CardItem) => {
    if (matchedIds.includes(card.id) || failedPair) return;

    if (!selectedCardId) {
      setSelectedCardId(card.id);
      setHintId(null);
      play('click');
      return;
    }

    if (selectedCardId === card.id) {
      setSelectedCardId(null);
      return;
    }

    const allCards = [...termCards, ...defCards];
    const first = allCards.find((c) => c.id === selectedCardId)!;

    // Another card in the same column just moves the selection.
    if (first.type === card.type) {
      setSelectedCardId(card.id);
      return;
    }

    setMoves((prev) => prev + 1);

    if (first.matchId === card.matchId) {
      const newMatched = [...matchedIds, first.id, card.id];
      setMatchedIds(newMatched);
      setRecentMatchIds([first.id, card.id]);
      setSelectedCardId(null);
      setHintId(null);
      setCombo((prev) => prev + 1);
      fire('correct');
      play('correct', combo); // pitch climbs with the combo

      schedule(() => setRecentMatchIds([]), 600);

      if (newMatched.length === totalPairs * 2) {
        schedule(() => {
          setVictory(true);
          play('victory');
        }, 700);
      }
      return;
    }

    setFailedPair([first.id, card.id]);
    setCombo(0);
    fire('wrong');
    play('wrong');

    // Count the miss against the anchored term; show its partner as a hint after two misses.
    const nextCount = (wrongCounts[first.matchId] ?? 0) + 1;
    setWrongCounts((prev) => ({ ...prev, [first.matchId]: nextCount }));

    if (nextCount >= 2) {
      const partner = allCards.find((c) => c.matchId === first.matchId && c.id !== first.id)!;
      setHintId(partner.id);
    } else {
      setHintId(null);
    }

    schedule(() => {
      setFailedPair(null);
      setSelectedCardId(null);
    }, 900);
  };

  const renderCard = (card: CardItem, index: number) => {
    const isSelected = selectedCardId === card.id;
    const isMatched = matchedIds.includes(card.id);
    const isRecent = recentMatchIds.includes(card.id);
    const isFailed = failedPair?.includes(card.id) ?? false;
    const isHinted = hintId === card.id;
    const isTerm = card.type === 'term';

    return (
      <button
        key={card.id}
        onClick={() => handleCardClick(card)}
        disabled={isMatched}
        aria-pressed={isSelected}
        className={clsx(
          'group relative w-full flex items-start gap-3 rounded-2xl border p-3.5 sm:p-4 text-left',
          'font-sans text-sm leading-relaxed transition-all duration-300 outline-none select-none',
          /* Natural height on phones (the fixed minimums only aligned two columns). */
          isTerm ? 'sm:min-h-[4.5rem]' : 'sm:min-h-[6rem]',
          /* A visible focus ring replaces the removed outline. */
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
          isRecent && 'animate-pop',
          isFailed && 'animate-shake',
          isMatched
            ? 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-300/50'
            : isFailed
              ? 'bg-rose-500/10 border-rose-500/60 text-rose-300'
              : isSelected
                ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim text-white'
                : isHinted
                  ? /* Amber, the games' hint colour; cyan was indistinguishable from the selected state. */
                    'bg-amber-400/[0.07] border-amber-400/60 text-white'
                  : 'bg-white/[0.02] border-white/[0.08] text-slate-300 hover:bg-white/[0.05] hover:border-primary-fixed-dim/40 active:scale-[0.98]'
        )}
      >
        <span
          className={clsx(
            'w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center',
            'font-display text-[11px] font-bold transition-colors',
            isMatched
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : isSelected
                ? 'bg-primary-fixed-dim border-primary-fixed-dim text-black'
                : isHinted
                  ? 'bg-amber-400 border-amber-400 text-black'
                  : 'bg-white/[0.03] border-white/10 text-slate-500 group-hover:border-primary-fixed-dim/50 group-hover:text-primary-fixed-dim'
          )}
        >
          {isMatched ? <CheckCircle2 className="w-3.5 h-3.5" /> : index + 1}
        </span>

        <span
          className={clsx(
            'flex-1 pt-1',
            isTerm ? 'font-display font-semibold text-[0.95rem]' : 'font-medium text-[0.8rem] leading-relaxed'
          )}
        >
          {card.text}
        </span>

        {isHinted && (
          <span className="absolute bottom-1.5 right-2.5 flex items-center gap-1 font-sans text-[10px] font-bold uppercase tracking-widest text-amber-400">
            <Sparkles className="w-3 h-3" /> AI Hint
          </span>
        )}

        {isSelected && (
          <Crosshair className="absolute top-2 right-2 w-3.5 h-3.5 text-primary-fixed-dim" />
        )}
      </button>
    );
  };

  if (loading || !targetData) {
    return (
      <div className="max-w-4xl mx-auto fade-in duration-300">
        <GameStatusScreen tone="primary" state={error ? 'error' : 'loading'} />
      </div>
    );
  }

  if (victory) {
    return (
      <div className="max-w-4xl mx-auto fade-in duration-300">
        <ScreenFlash flash={flash} />
        <ResultScreen
          tone="primary"
          icon={CheckCircle2}
          title="Grid Cleared!"
          message="Outstanding recall — every term is locked to its definition."
          headline={`${accuracy}%`}
          headlineLabel="match accuracy"
          stats={[
            { label: 'Pairs', value: `${totalPairs}` },
            { label: 'Attempts', value: `${moves}` },
          ]}
          onReplay={startGame}
          onRegenerate={regenerate}
          regenerating={regenerating}
        />
      </div>
    );
  }

  return (
    /* Clearance only while the selection bar is up. */
    <div
      className={clsx(
        'max-w-4xl mx-auto fade-in duration-300',
        selectedCard && 'pb-24 sm:pb-0'
      )}
    >
      <ScreenFlash flash={flash} />

      <GameStage
        tone="primary"
        icon={BrainCircuit}
        title="Term Matching"
        subtitle={targetData.courseName}
        tier={calibration?.tier ?? null}
        resources={resources}
        hud={
          <>
            <HudStat
              icon={Link2}
              label="Linked"
              value={`${matchedPairs}/${totalPairs}`}
              pulseKey={matchedPairs}
            />
            <HudStat icon={Sparkles} label="Combo" value={`x${combo}`} pulseKey={combo} highlight={combo >= 3} />
          </>
        }
        actions={
          <button
            onClick={startGame}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all font-sans text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
        }
      >
        <div className="space-y-6">
          {/* Objective strip */}
          <div className="flex items-center justify-center">
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              Select a term, then link it to its definition
            </p>
          </div>

          {/* Board: two panels split by a spine */}
          {/* Paired from sm: up (columns are wide enough there). */}
          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-10">
            {/* Centre spine */}
            <div
              aria-hidden
              className="hidden sm:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"
            />

            <div className="space-y-2.5 sm:space-y-3">
              <ColumnHeader label="Terms" count={termCards.length} />
              {termCards.map(renderCard)}
            </div>

            <div className="space-y-2.5 sm:space-y-3">
              <ColumnHeader label="Definitions" count={defCards.length} />
              {defCards.map(renderCard)}
            </div>
          </div>

          {/* Pair tracker */}
          <div className="flex items-center justify-center gap-2 pt-2">
            {Array.from({ length: totalPairs }).map((_, i) => (
              <span
                key={i}
                className={clsx(
                  'h-1.5 rounded-full transition-all duration-500',
                  i < matchedPairs ? 'w-10 bg-primary-fixed-dim' : 'w-6 bg-white/[0.08]'
                )}
              />
            ))}
          </div>
        </div>
      </GameStage>

      {/* Mobile selection bar: the columns stack below sm:, so this keeps the anchored term visible between the two taps. fixed, not sticky (an overflow-hidden ancestor makes sticky inert). */}
      {selectedCard && (
        <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-surface-container-lowest/95 backdrop-blur border-t border-white/10">
          <div className="min-w-0 flex-1">
            <p className="font-sans text-[10px] font-bold uppercase tracking-widest text-primary-fixed-dim">
              {selectedCard.type === 'term' ? 'Now pick its definition' : 'Now pick its term'}
            </p>
            <p className="font-sans text-sm text-white truncate mt-0.5">{selectedCard.text}</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedCardId(null)}
            className="shrink-0 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] font-sans text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1 pb-1">
      <h3 className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</h3>
      <span className="font-display text-[10px] font-bold text-slate-600 tabular-nums">{count}</span>
    </div>
  );
}
