import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Layers, ChevronLeft, RefreshCw, Play, Trash2, BookOpen, Pencil, AlertCircle, Sparkles, FileText, Check, CheckCircle2, LibraryBig, CalendarCheck, Shuffle, ArrowUpDown, Target } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import FlashcardStudyView from '../components/FlashcardStudyView';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';
import DueBadge from '../../../components/ui/DueBadge';
import { api } from '../../../lib/api';
// Shared with StudySpace (tab badge). The server stays authoritative.
import { isDue } from '../../../lib/reviewSchedule';
import type { EaseRating } from '../../../lib/reviewSchedule';
import { shuffle } from '../../../lib/shuffle';
import type { StudyIntent } from '../../../lib/studySpace';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** The concept this card assesses. Nullable (ON DELETE SET NULL), so it may match nothing. */
  conceptId?: string | null;
  /** The material this card was generated from. Drives "already in this deck". */
  sourceMaterialId?: string | null;
  /** When this card is next due. Past or null = due now. */
  nextReviewAt?: string | null;
  /** The model wrote this card's front, so it is a question, not the term. */
  isAiGenerated?: boolean;
  /** Last self-rating, or null if never rated while due. Null never means "easy". */
  easeRating?: EaseRating | null;
}

/**
 * Card order for the grid and the session started from it. `shuffled` is an order but not a menu
 * option: the menu sorts, the button scrambles, and choosing either clears the other. Map it before
 * passing to Dropdown, which renders its first option for unknown values.
 */
type OrderKey = 'deck' | 'hardest' | 'easiest' | 'shuffled';

/** Which cards a session opens with. See `studyMode`. */
type StudyMode = 'due' | 'marked';

const ORDER_OPTIONS: Array<{ label: string; value: OrderKey }> = [
  { label: 'Default', value: 'deck' },
  { label: 'Hardest first', value: 'hardest' },
  { label: 'Easiest first', value: 'easiest' },
];

/** Hard is the thing worth working on, so it sorts first. */
const RATING_RANK: Record<EaseRating, number> = { hard: 0, medium: 1, easy: 2 };
/** Unrated cards sort last in both directions, so "Easiest first" isn't a plain reverse. */
const UNRATED_RANK = 3;

/** Sort position of one card under a rating order. Lower comes first. */
function ratingRank(card: Flashcard, easiestFirst: boolean): number {
  if (!card.easeRating) return UNRATED_RANK;
  const rank = RATING_RANK[card.easeRating];
  return easiestFirst ? 2 - rank : rank;
}


/** Rating chip tone. Keep in step with RATING_CONFIG in FlashcardStudyView.tsx. */
const RATING_CHIP: Record<EaseRating, { label: string; className: string }> = {
  hard: { label: 'Hard', className: 'text-red-400' },
  medium: { label: 'Medium', className: 'text-amber-400' },
  easy: { label: 'Easy', className: 'text-emerald-400' },
};

/** "Tue 4 Aug" — short enough for a deck tile. */
function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Due now" / "Due in 3 days" for a single card. */
function dueLabel(nextReviewAt: string | null | undefined): string {
  if (isDue(nextReviewAt)) return 'Due now';
  const days = Math.ceil((new Date(nextReviewAt!).getTime() - Date.now()) / 86_400_000);
  if (days <= 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

interface FlashcardSet {
  id: string;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  /** Show the definition first and ask for the term. */
  answerFirst: boolean;
}

/**
 * Type size and alignment for a face in the deck grid, by text length (answer_first can put a long
 * definition on the front). Not faceTypeClass(): its bands are sized for the larger study card.
 */
function gridFaceClass(text: string): string {
  const len = text.length;
  if (len <= 120) return 'text-lg leading-snug text-center';
  if (len <= 300) return 'text-base leading-snug text-center';
  // Past about four lines, left-align: centred long text is hard to read.
  return 'text-sm leading-relaxed text-left';
}

interface SpaceMaterial {
  id: string;
  title: string;
  concept_count: number;
}

/** What goes on a generated card's front. The back is always the educator's definition. */
type CardFormat = 'term' | 'question';

/**
 * Students own decks but not cards: cards arrive only by generating against a material, so there is no
 * add/edit/delete card control. Study starts from the deck tile in one click; the deck view is for
 * browsing and managing.
 */
interface FlashcardsTabProps {
  spaceId: string;
  selectedSetContent: string | null;
  flashcardSets: FlashcardSet[];
  setSelectedSetContent: (id: string | null) => void;
  onRefresh: () => void;
  availableResources: SpaceMaterial[];
  /** From "Review its deck": `materialId` picks the deck; `conceptIds` (missed in the test) are marked, not selected. */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
}

export default function FlashcardsTab({
  spaceId,
  selectedSetContent,
  flashcardSets,
  setSelectedSetContent,
  onRefresh,
  availableResources,
  preselect,
  onPreselectConsumed,
}: FlashcardsTabProps) {
  const [isStudying, setIsStudying] = useState(false);
/**
 * 'due' opens with the deck's due cards; 'marked' with the due cards a test flagged.
 * Both are due-only. There is no practice mode, and it must not come back: practising between reviews
 * inflates the next rating that does count. See CLAUDE.md § Flashcards.
 */
  const [studyMode, setStudyMode] = useState<StudyMode>('due');
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Every failed action is shown, never just logged.
  const [actionError, setActionError] = useState<string | null>(null);

  // Create deck
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Rename deck
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameDescription, setRenameDescription] = useState('');

  // Delete deck
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Add cards from a material
  const [isAddCardsOpen, setIsAddCardsOpen] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [cardFormat, setCardFormat] = useState<CardFormat>('term');
  /** Material the server said is already here — the Refresh confirmation. */
  const [confirmRefresh, setConfirmRefresh] = useState<
    { material: SpaceMaterial; message: string; currentFormat: CardFormat } | null
  >(null);

  /** Card order. Not persisted (a deck reopening reordered weeks later would be confusing); resets per deck. */
  const [order, setOrder] = useState<OrderKey>('deck');
  /** Bumped on each Shuffle press so pressing again re-rolls. */
  const [shuffleNonce, setShuffleNonce] = useState(0);
  /** Optimistic answer-first value; null means use the server's. Reverted on failure. */
  const [answerFirstDraft, setAnswerFirstDraft] = useState<boolean | null>(null);

  const toggleFlip = (cardId: string) => {
    setFlippedCardId(prev => (prev === cardId ? null : cardId));
  };

  const selectedSet = flashcardSets.find(s => s.id === selectedSetContent) || null;
  const hasMaterials = availableResources.length > 0;

  /**
   * Cards a test result asked to mark. Carries its own deckId and is read through `marking`, so the
   * deck-change reset can't wipe it. Card ids, plus `missing` (flagged concepts with no card here).
   * Visit-scoped: the tab remounts on entry.
   */
  const [markingState, setMarkingState] = useState<{
    deckId: string;
    materialId: string | null;
    cardIds: Set<string>;
    missing: number;
  } | null>(null);

  const marking = markingState?.deckId === selectedSetContent ? markingState : null;

  // Opening a different deck starts clean (side, order, flips). The marking guards itself.
  useEffect(() => {
    setOrder('deck');
    setShuffleNonce(0);
    setAnswerFirstDraft(null);
    setFlippedCardId(null);
  }, [selectedSetContent]);

  /** Change the order and clear flips. Shuffle always bumps the nonce, so pressing again re-rolls. */
  const chooseOrder = (next: OrderKey) => {
    setOrder(next);
    if (next === 'shuffled') setShuffleNonce(n => n + 1);
    setFlippedCardId(null);
  };

  const answerFirst = answerFirstDraft ?? selectedSet?.answerFirst ?? false;

  /** Label for the cards' front: "Term", or "Question" if any card was generated in question format (matches the server). */
  const frontNoun = selectedSet?.cards.some(c => c.isAiGenerated) ? 'Question' : 'Term';

  /**
   * Cards in display order for grid and session. Depends on `selectedSet?.cards`, which is stable across
   * renders, so flipping doesn't reshuffle. Always returns a new array (never sort state in place).
   * The sort is stable, so ties keep deck order.
   */
  const orderedCards = useMemo(() => {
    const cards = selectedSet?.cards ?? [];
    const sorted = (() => {
      switch (order) {
        case 'shuffled':
          return shuffle(cards);
        case 'hardest':
          return [...cards].sort((a, b) => ratingRank(a, false) - ratingRank(b, false));
        case 'easiest':
          return [...cards].sort((a, b) => ratingRank(a, true) - ratingRank(b, true));
        default:
          return cards;
      }
    })();

    // Marked cards first. A partition rather than another OrderKey, so the chosen order still holds inside each group.
    if (!marking || marking.cardIds.size === 0) return sorted;
    const marked = sorted.filter(c => marking.cardIds.has(c.id));
    const rest = sorted.filter(c => !marking.cardIds.has(c.id));
    return [...marked, ...rest];
    // `shuffleNonce` is in the deps so pressing Shuffle again re-rolls; it is
    // otherwise unused here.
  }, [selectedSet?.cards, order, shuffleNonce, marking]);

  /** The marked cards that are actually due — the ones a session would count. */
  const markedDueCount = useMemo(
    () =>
      marking
        ? (selectedSet?.cards ?? []).filter(c => marking.cardIds.has(c.id) && isDue(c.nextReviewAt))
            .length
        : 0,
    [selectedSet?.cards, marking]
  );

  /** When the first marked card that is NOT due yet comes back. */
  const markedNextReview = useMemo(() => {
    if (!marking) return null;
    const upcoming = (selectedSet?.cards ?? [])
      .filter(c => marking.cardIds.has(c.id))
      .map(c => c.nextReviewAt)
      .filter((d): d is string => Boolean(d) && !isDue(d))
      .sort();
    return upcoming[0] ?? null;
  }, [selectedSet?.cards, marking]);

  /** How many cards in the open deck carry a rating at all. */
  const ratedCount = (selectedSet?.cards ?? []).filter(c => c.easeRating).length;

  /**
   * Persist the open deck's answer_first: local first, then one PUT; revert and report on failure.
   * No onRefresh(): that refetches every deck for a display switch.
   */
  const setAnswerFirst = async (next: boolean) => {
    if (!selectedSet || next === answerFirst) return;
    const previous = answerFirst;
    setAnswerFirstDraft(next);
    setActionError(null);
    setFlippedCardId(null);
    try {
      await api.put(`/spaces/${spaceId}/decks/${selectedSet.id}`, { answer_first: next });
    } catch (err: any) {
      setAnswerFirstDraft(previous);
      setActionError(err?.message || 'Could not save which side to show first.');
    }
  };

  const materialTitle = (id: string | null | undefined): string | null =>
    availableResources.find(m => m.id === id)?.title ?? null;

  // Following "Review its deck" from a test result

  /** The intent at mount; kept out of effect deps and cleared once acted on. */
  const preselectRef = React.useRef<StudyIntent | null>(preselect);
  React.useEffect(() => {
    if (preselect) preselectRef.current = preselect;
  }, [preselect]);

  /** A just-built deck awaiting its cards, and the concepts to mark once they arrive. */
  const pendingBuildRef = React.useRef<{ deckId: string; materialId: string } | null>(null);
  const buildConceptsRef = React.useRef<string[]>([]);

  /** The lesson a preselect asked for but no deck holds. Drives the fallback card. */
  const [needsDeckFor, setNeedsDeckFor] = useState<SpaceMaterial | null>(null);
  const [buildingDeck, setBuildingDeck] = useState(false);

  /** The deck holding a lesson. Several can; pick the one with most cards from it, then the earliest. */
  const deckHolding = (materialId: string): FlashcardSet | null => {
    let best: FlashcardSet | null = null;
    let bestCount = 0;
    for (const set of flashcardSets) {
      const count = set.cards.filter(c => c.sourceMaterialId === materialId).length;
      if (count > bestCount) {
        best = set;
        bestCount = count;
      }
    }
    return best;
  };

  /** Turn a set of concept ids into the marking for one deck. */
  const markingFor = (set: FlashcardSet, materialId: string | null, conceptIds: string[]) => {
    const wanted = new Set(conceptIds);
    // conceptId is nullable; such cards match nothing.
    const cardIds = new Set(
      set.cards.filter(c => c.conceptId && wanted.has(c.conceptId)).map(c => c.id)
    );
    const covered = new Set(
      set.cards.map(c => c.conceptId).filter((id): id is string => Boolean(id) && wanted.has(id!))
    );
    return {
      deckId: set.id,
      materialId,
      cardIds,
      missing: wanted.size - covered.size,
    };
  };

  // Apply the intent and consume it in every branch, or it would re-apply on the next remount.
  useEffect(() => {
    const intent = preselectRef.current;
    if (!intent) return;
    preselectRef.current = null;

    const materialId = intent.materialId;
    const set = materialId ? deckHolding(materialId) : null;

    if (set) {
      setSelectedSetContent(set.id);
      setMarkingState(markingFor(set, materialId, intent.conceptIds));
      setNeedsDeckFor(null);
    } else if (materialId) {
      // No deck covers it: offer to build one (on the deck list). Concepts are parked for marking.
      buildConceptsRef.current = intent.conceptIds;
      setSelectedSetContent(null);
      setNeedsDeckFor(availableResources.find(m => m.id === materialId) ?? null);
    }

    onPreselectConsumed();
    // Runs on the arrival that carried an intent. `flashcardSets` is in the deps
    // because the resolution needs the cards, and on a cold mount they land a
    // moment after this component first renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, flashcardSets, availableResources, onPreselectConsumed]);

  /** Build the missing deck in one click. format: 'term', never 'question' (no model call, no quota). */
  const buildDeckFor = async (material: SpaceMaterial) => {
    setBuildingDeck(true);
    setActionError(null);
    try {
      const res = await api.post<{ id: string }>(`/spaces/${spaceId}/decks`, {
        title: material.title,
      });
      const deckId = res.data?.id;
      if (!deckId) throw new Error('The deck was created but could not be opened.');

      await api.post(`/spaces/${spaceId}/decks/${deckId}/generate`, {
        material_id: material.id,
        format: 'term',
      });

      // Marking is applied once the refreshed cards arrive (see the effect below).
      pendingBuildRef.current = { deckId, materialId: material.id };
      setNeedsDeckFor(null);
      setSelectedSetContent(deckId);
      onRefresh();
    } catch (err: any) {
      // A created-but-empty deck still shows the manual Add Cards path.
      setActionError(err?.message ?? 'That deck could not be built. Please try again.');
    } finally {
      setBuildingDeck(false);
    }
  };

  useEffect(() => {
    const pendingBuild = pendingBuildRef.current;
    if (!pendingBuild) return;
    const set = flashcardSets.find(s => s.id === pendingBuild.deckId);
    if (!set || set.cards.length === 0) return; // cards not delivered yet
    pendingBuildRef.current = null;
    setMarkingState(markingFor(set, pendingBuild.materialId, buildConceptsRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashcardSets]);

  /** Distinct material titles represented in a deck, in card order. */
  const deckSources = (set: FlashcardSet): string[] => {
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const card of set.cards) {
      if (!card.sourceMaterialId || seen.has(card.sourceMaterialId)) continue;
      seen.add(card.sourceMaterialId);
      const title = materialTitle(card.sourceMaterialId);
      if (title) titles.push(title);
    }
    return titles;
  };

  /** Cards in a deck that are ready to review right now. */
  const dueCards = (set: FlashcardSet): Flashcard[] =>
    set.cards.filter(c => isDue(c.nextReviewAt));

  /** Earliest upcoming review date in a deck, when nothing is due. */
  const nextReviewDate = (set: FlashcardSet): string | null => {
    const upcoming = set.cards
      .map(c => c.nextReviewAt)
      .filter((d): d is string => Boolean(d) && !isDue(d))
      .sort();
    return upcoming[0] ?? null;
  };

/** A deck's summary line: its size only (due counts and dates appear elsewhere on the tile). */
  const deckSummary = (set: FlashcardSet): string => {
    if (set.cardCount === 0) return 'Empty — no cards yet';
    return `${set.cardCount} card${set.cardCount === 1 ? '' : 's'}`;
  };

/** Where a deck's cards came from; shown in the deck view, not on the tile. */
  const deckSourceLine = (set: FlashcardSet): string | null => {
    const sources = deckSources(set);
    if (sources.length === 0) return null;
    if (sources.length === 1) return `From ${sources[0]}`;
    return `From ${sources.join(', ')}`;
  };

  /** Material ids the open deck already holds cards from. */
  const materialsInDeck = new Set(
    (selectedSet?.cards ?? [])
      .map(c => c.sourceMaterialId)
      .filter((id): id is string => Boolean(id))
  );

  /**
   * Material id → the other deck already holding it. A lesson lives in one deck per space (the server
   * enforces it as a BKT integrity guard); this warns before the 409.
   */
  const deckHoldingMaterial = new Map<string, string>();
  for (const set of flashcardSets) {
    if (set.id === selectedSetContent) continue;
    for (const card of set.cards) {
      if (card.sourceMaterialId && !deckHoldingMaterial.has(card.sourceMaterialId)) {
        deckHoldingMaterial.set(card.sourceMaterialId, set.title);
      }
    }
  }

  const openAddCards = () => {
    setGenerateError(null);
    setGenerateNotice(null);
    setConfirmRefresh(null);
    setIsAddCardsOpen(true);
  };

  /** Start a session straight from a deck tile — the one-click path. */
  const studyDeck = (deckId: string, mode: StudyMode = 'due') => {
    setSelectedSetContent(deckId);
    setStudyMode(mode);
    setIsStudying(true);
  };

  /** Leaving a session refreshes the deck list so counts are current. */
  const exitStudy = () => {
    setIsStudying(false);
    onRefresh();
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await api.post(`/spaces/${spaceId}/decks`, {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
      });
      setIsCreateOpen(false);
      setNewTitle('');
      setNewDescription('');
      onRefresh();
    } catch (err: any) {
      setActionError(err?.message ?? 'That deck could not be created. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRenameDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSet || !renameTitle.trim()) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await api.put(`/spaces/${spaceId}/decks/${selectedSet.id}`, {
        title: renameTitle.trim(),
        description: renameDescription.trim() || null,
      });
      setIsRenameOpen(false);
      onRefresh();
    } catch (err: any) {
      setActionError(err?.message ?? 'That deck could not be renamed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDeck = async () => {
    if (!selectedSet) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await api.delete(`/spaces/${spaceId}/decks/${selectedSet.id}`);
      setIsDeleteOpen(false);
      setSelectedSetContent(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err?.message ?? 'That deck could not be deleted. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  /** Fill the open deck from one material. A 409 without `replace` becomes a Refresh prompt, not an error. */
  const handleGenerate = async (material: SpaceMaterial, replace = false, format = cardFormat) => {
    if (!selectedSet || generatingId) return;
    setGeneratingId(material.id);
    setGenerateError(null);
    setGenerateNotice(null);
    try {
      const res = await api.post<{ added: number; updated: number; removed: number; fallback: number }>(
        `/spaces/${spaceId}/decks/${selectedSet.id}/generate`,
        { material_id: material.id, replace, format }
      );
      const { added = 0, updated = 0, removed = 0, fallback = 0 } = res.data ?? {};
      const note = fallback > 0
        ? ` ${fallback} show the term instead — no question could be written for ${fallback === 1 ? 'it' : 'them'}.`
        : '';
      setGenerateNotice(
        (replace
          ? `Refreshed from ${material.title} — ${updated} updated, ${added} added, ${removed} removed.`
          : `Added ${added} card${added === 1 ? '' : 's'} from ${material.title}.`) + note
      );
      setConfirmRefresh(null);
      setIsAddCardsOpen(false);
      onRefresh();
    } catch (err: any) {
      const message: string = err?.message ?? 'Those cards could not be added. Please try again.';
      // Check the code first: two 409s have near-identical wording, and the cross-deck one must not
      // offer a Refresh (it would be refused again).
      if (err?.code === 'MATERIAL_IN_ANOTHER_DECK') {
        setGenerateError(message);
      } else if (/already/i.test(message)) {
        // A prompt, not a failure. Refresh keeps the deck's current style.
        setConfirmRefresh({ material, message, currentFormat: cardFormat });
      } else {
        setGenerateError(message);
      }
    } finally {
      setGeneratingId(null);
    }
  };

  /** Shared inline error banner. Dismissible — it must not trap the student. */
  const errorBanner = actionError && (
    <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 fade-in duration-200">
      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
      <p className="font-sans text-xs text-rose-300 leading-relaxed flex-1">{actionError}</p>
      <button
        onClick={() => setActionError(null)}
        className="font-sans text-[10px] uppercase tracking-widest text-rose-400/70 hover:text-rose-300 font-bold shrink-0"
      >
        Dismiss
      </button>
    </div>
  );

  // Study view. Sessions are due-only ('marked' narrows further); if nothing qualifies, fall through to the deck view.
  if (isStudying && selectedSet && selectedSet.cards.length > 0) {
    // From orderedCards, so a shuffled grid opens a shuffled session.
    const sessionCards = orderedCards.filter(
      c => isDue(c.nextReviewAt) && (studyMode === 'due' || (marking?.cardIds.has(c.id) ?? false))
    );
    if (sessionCards.length > 0) {
      return (
        <div className="fade-in duration-300">
          <FlashcardStudyView
            /* front/back stay unswapped; the view applies answerFirst at render (labels and type curve follow). */
            cards={sessionCards.map(c => ({
              id: c.id,
              front: c.front,
              back: c.back,
              source: materialTitle(c.sourceMaterialId) ?? undefined,
            }))}
            deckTitle={selectedSet.title}
            answerFirst={answerFirst}
            frontNoun={frontNoun}
            onExit={exitStudy}
          />
        </div>
      );
    }
  }

  return (
    <div className="fade-in duration-300">
      {/* Deck list */}
      {selectedSetContent === null ? (
        <div key="deck-list" className="fade-in duration-500">
          <div data-tour="fc-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white mb-1">Study Decks</h2>
              <p className="font-sans text-sm text-slate-400">Organize your lessons into decks</p>
            </div>
            {flashcardSets.length > 0 && (
                <button
                data-tour="fc-new-deck"
                onClick={() => { setIsCreateOpen(true); setActionError(null); }}
                className="px-5 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all shrink-0"
              >
                <Plus className="w-4 h-4" />
                New Deck
              </button>
            )}
          </div>

          {errorBanner}

          {/* "Review its deck" for a lesson no deck holds yet. Shown only when an intent asked for it. */}
          {needsDeckFor && (
            <div className="mb-6 flex items-start gap-3 px-4 py-4 rounded-xl bg-amber-400/5 border border-amber-400/20">
              <Target className="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-sans text-sm font-semibold text-white">
                  No deck covers “{needsDeckFor.title}” yet.
                </p>
                <p className="mt-1 font-sans text-xs text-slate-400 leading-relaxed">
                  Making one gives you a card for each of its {needsDeckFor.concept_count} idea
                  {needsDeckFor.concept_count === 1 ? '' : 's'}, and marks the ones you just missed.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void buildDeckFor(needsDeckFor)}
                    disabled={buildingDeck}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/15 disabled:opacity-50 disabled:cursor-not-allowed font-sans text-xs font-semibold text-amber-200 transition-colors"
                  >
                    {buildingDeck ? (
                      <><Spinner className="w-3.5 h-3.5" /> Building…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /> Make a deck from this lesson</>
                    )}
                  </button>
                  <button
                    onClick={() => setNeedsDeckFor(null)}
                    disabled={buildingDeck}
                    className="font-sans text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}

          {flashcardSets.length === 0 ? (
            /* No decks at all — one instruction, one button. */
            <div className="flex flex-col items-center justify-center py-16 md:py-24 px-6 text-center bg-surface-container-lowest/40 border border-white/5 rounded-2xl">
              <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/5 flex items-center justify-center mb-6">
                <LibraryBig className="w-8 h-8 text-primary-fixed-dim" />
              </div>
              <h3 className="font-display text-xl font-medium text-white mb-2">Start your first deck</h3>
              {hasMaterials ? (
                <>
                  <p className="font-sans text-sm text-slate-400 max-w-sm mb-7 leading-relaxed">
                    A deck is a folder for one lesson. Make one, then fill it with flashcards from
                    your teacher's materials.
                  </p>
                  <button
                    data-tour="fc-new-deck"
                    onClick={() => { setIsCreateOpen(true); setActionError(null); }}
                    className="px-6 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Deck
                  </button>
                </>
              ) : (
                <p className="font-sans text-sm text-slate-400 max-w-sm leading-relaxed">
                  There are no materials in this study space yet, so there is nothing to make
                  flashcards from. Open the <span className="text-slate-300 font-semibold">Learning Resources</span> tab
                  to see what your teacher has published.
                </p>
              )}
            </div>
          ) : (
            <div data-tour="fc-decks" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {flashcardSets.map(set => {
                const isEmpty = set.cardCount === 0;
                const due = dueCards(set).length;
                return (
                  /* Decks with due cards get an accent border and glow; caught-up decks stay neutral. */
                  <div
                    key={set.id}
                    className={`relative bg-surface-container-lowest rounded-2xl border p-6 hover:-translate-y-1 focus-within:-translate-y-1 transition-all duration-300 group hover:shadow-lg flex flex-col ${
                      due > 0
                        ? 'border-primary-fixed-dim/30 shadow-[0_0_25px_-12px] shadow-primary-fixed-dim/35 hover:border-primary-fixed-dim/50 hover:shadow-primary-fixed-dim/10'
                        : 'border-white/5 hover:border-white/15 hover:shadow-black/20'
                    }`}
                  >
                    {/* The badge sits on the icon, the column the eye scans. */}
                    <div className="relative w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center group-hover:bg-primary-fixed-dim/20 group-hover:border-primary-fixed-dim/30 transition-colors mb-5">
                      <Layers className="w-6 h-6 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                      <DueBadge count={due} className="absolute -top-1.5 -right-1.5 ring-2 ring-surface-container-lowest" />
                    </div>

                    <div className="flex-1 mb-5">
                      {/* The title is a real button whose ::after covers the tile: one focus stop, whole card clickable. The action button uses relative z-10 to stay clickable. */}
                      <h3 className="font-display text-xl font-medium text-white mb-1.5 group-hover:text-primary-fixed-dim transition-colors">
                        <button
                          onClick={() => setSelectedSetContent(set.id)}
                          className="text-left rounded after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <span className="line-clamp-2">{set.title}</span>
                        </button>
                      </h3>
                      {set.description && (
                        <p className="font-sans text-xs text-slate-500 mb-2 line-clamp-2">{set.description}</p>
                      )}
                      <p className="font-sans text-xs text-slate-400">{deckSummary(set)}</p>
                    </div>

                    {/* One action per tile; studying is one click. */}
                    {isEmpty ? (
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedSetContent(set.id); openAddCards(); }}
                        disabled={!hasMaterials}
                        className="relative z-10 w-full px-4 py-2.5 bg-surface-container border border-primary-fixed-dim/30 text-primary-fixed-dim hover:bg-primary-fixed-dim/10 rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-container"
                      >
                        <Sparkles className="w-4 h-4" />
                        {hasMaterials ? 'Add Cards' : 'No Materials'}
                      </button>
                    ) : due > 0 ? (
                      <button
                        onClick={e => { e.stopPropagation(); studyDeck(set.id, 'due'); }}
                        className="relative z-10 w-full px-4 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 shadow-[0_0_20px] shadow-primary-fixed-dim/15 hover:shadow-[0_0_30px] shadow-primary-fixed-dim/30 transition-all"
                      >
                        <Play className="w-4 h-4" />
                        Review {due}
                      </button>
                    ) : (
                      /* Nothing due: a status, not a button (no practice mode). Same height as buttons; clicks fall through to open the deck. */
                      <div className="w-full px-4 py-2.5 bg-emerald-500/5 border border-emerald-500/15 rounded-xl font-sans text-xs font-semibold text-slate-300 flex items-center justify-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-emerald-400/80 shrink-0" />
                        <span className="truncate">
                          Caught up
                          {nextReviewDate(set) && <> · back {formatReviewDate(nextReviewDate(set)!)}</>}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Inside a deck: browsing and managing */
        <div key="selected-deck" className="fade-in duration-500">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5 mb-8">
            <div className="min-w-0">
              <button
                onClick={() => setSelectedSetContent(null)}
                className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 mb-3 font-sans font-semibold text-xs uppercase tracking-widest"
              >
                <ChevronLeft className="w-4 h-4" /> All decks
              </button>
              <h2 className="font-display text-2xl font-semibold text-white mb-1.5">
                {selectedSet?.title}
              </h2>
              {selectedSet?.description && (
                <p className="font-sans text-sm text-slate-400 mb-1">{selectedSet.description}</p>
              )}
              {selectedSet && (
                <>
                  <p className="font-sans text-xs text-slate-500">{deckSummary(selectedSet)}</p>
                  {deckSourceLine(selectedSet) && (
                    <p className="font-sans text-xs text-slate-600 mt-0.5">{deckSourceLine(selectedSet)}</p>
                  )}
                </>
              )}
            </div>

            {selectedSet && (
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                {/* Only when something is due. */}
                {dueCards(selectedSet).length > 0 && (
                  <button
                    onClick={() => studyDeck(selectedSet.id, 'due')}
                    className="px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 shadow-[0_0_20px] shadow-primary-fixed-dim/20 hover:shadow-[0_0_30px] shadow-primary-fixed-dim/35 transition-all"
                  >
                    <Play className="w-4 h-4" />
                    Review {dueCards(selectedSet).length}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={openAddCards}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    Add Cards
                  </button>
                  <button
                    onClick={() => {
                      setRenameTitle(selectedSet.title);
                      setRenameDescription(selectedSet.description || '');
                      setActionError(null);
                      setIsRenameOpen(true);
                    }}
                    aria-label="Rename deck"
                    className="px-3 py-2.5 bg-surface-container border border-white/10 text-slate-300 hover:text-white hover:bg-surface-container-high rounded-xl transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setActionError(null); setIsDeleteOpen(true); }}
                    aria-label="Delete deck"
                    className="px-3 py-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 rounded-xl transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {errorBanner}

          {/* Result of the last generation. */}
          {generateNotice && (
            <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-emerald-300 leading-relaxed flex-1">{generateNotice}</p>
              <button
                onClick={() => setGenerateNotice(null)}
                className="font-sans text-[10px] uppercase tracking-widest text-emerald-400/70 hover:text-emerald-300 font-bold shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Caught up, said explicitly so a missing Review button reads as success. */}
          {/* What the last test caught. States how many marked cards are due now and when the rest return: only due cards can be reviewed. */}
          {marking && marking.cardIds.size > 0 && (
            <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-400/5 border border-amber-400/20">
              <Target className="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-sans text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-200 font-semibold">
                    {marking.cardIds.size} card{marking.cardIds.size === 1 ? '' : 's'} from your last
                    test {marking.cardIds.size === 1 ? 'is' : 'are'} marked below.
                  </span>{' '}
                  {markedDueCount > 0
                    ? `${markedDueCount} ${markedDueCount === 1 ? 'is' : 'are'} due — reviewing ${markedDueCount === 1 ? 'it' : 'those'} updates your mastery.`
                    : `None are due yet${markedNextReview ? ` — the first comes back ${formatReviewDate(markedNextReview)}` : ''}.`}
                  {markedDueCount > 0 && markedNextReview && (
                    <> The rest come back from {formatReviewDate(markedNextReview)}.</>
                  )}
                  {markedDueCount === 0 && <> They're marked so you can find them.</>}
                  {marking.missing > 0 && (
                    <>
                      {' '}
                      <span className="text-amber-400/80">
                        {marking.missing} other{marking.missing === 1 ? '' : 's'} you missed{' '}
                        {marking.missing === 1 ? 'has' : 'have'} no card in this deck yet.
                      </span>
                    </>
                  )}
                </p>
                {/* Counts due marked cards: what the session will hold. */}
                {markedDueCount > 0 && (
                  <button
                    // marking.deckId, not selectedSet!.id: selectedSet is briefly null right after a deck is built.
                    onClick={() => studyDeck(marking.deckId, 'marked')}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/15 font-sans text-xs font-semibold text-amber-200 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Review {markedDueCount} marked card{markedDueCount === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedSet && selectedSet.cards.length > 0 && dueCards(selectedSet).length === 0 && (
            <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
              <CalendarCheck className="w-4 h-4 text-emerald-400/80 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                <span className="text-slate-200 font-semibold">You're all caught up.</span>{' '}
                {nextReviewDate(selectedSet)
                  ? `Your next cards are due ${formatReviewDate(nextReviewDate(selectedSet)!)}.`
                  : 'Nothing is due right now.'}{' '}
                Cards come back on the day they're due — that gap is what makes them stick. You can
                still flip through them below.
              </p>
            </div>
          )}

          {/* Empty state: a new deck is empty by design. */}
          {selectedSet && selectedSet.cards.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 md:py-24 px-6 text-center bg-surface-container-lowest/40 border border-white/5 rounded-2xl">
              <div className="w-16 h-16 rounded-2xl bg-surface-container border border-white/5 flex items-center justify-center mb-6">
                <BookOpen className="w-8 h-8 text-slate-500" />
              </div>
              <h3 className="font-display text-xl font-medium text-white mb-2">This deck is empty</h3>
              {hasMaterials ? (
                <>
                  <p className="font-sans text-sm text-slate-400 mb-7 max-w-sm leading-relaxed">
                    Pick one of your teacher's materials and this deck fills with a card for every
                    key term in it.
                  </p>
                  <button
                    onClick={openAddCards}
                    className="px-6 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Add Cards from Material
                  </button>
                </>
              ) : (
                <p className="font-sans text-sm text-slate-400 max-w-sm leading-relaxed">
                  There are no materials in this study space yet. Open the{' '}
                  <span className="text-slate-300 font-semibold">Learning Resources</span> tab to see
                  what your teacher has published.
                </p>
              )}
            </div>
          )}

          {/* View controls for the grid (deck actions live in the header). Sides are named Term/Question and Definition. Sort and Shuffle share one `order`. */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-bold shrink-0">
                  Show in front
                </span>
                {/* A segmented pair: a single toggle labelled with its state is ambiguous. */}
                <div
                  role="group"
                  aria-label="Which side of the card to show in front"
                  className="flex items-center gap-1 p-1 rounded-xl bg-surface-container border border-white/10"
                >
                  {([false, true] as const).map(value => {
                    const active = answerFirst === value;
                    return (
                      <button
                        key={String(value)}
                        onClick={() => setAnswerFirst(value)}
                        aria-pressed={active}
                        className={`px-3 py-1.5 rounded-lg font-sans text-[11px] uppercase tracking-widest font-bold transition-colors ${
                          active
                            ? 'bg-primary-fixed-dim text-on-primary-fixed'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {value ? 'Definition' : frontNoun}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* The menu sorts, the button scrambles; only one applies. */}
              <div className="flex items-center gap-2">
                <Dropdown
                  /* Mapped: Dropdown would show its first option for `shuffled`. */
                  value={order === 'shuffled' ? 'deck' : order}
                  onChange={v => chooseOrder(v as OrderKey)}
                  options={ORDER_OPTIONS}
                  icon={<ArrowUpDown className="w-3.5 h-3.5" />}
                  className="w-44"
                />
                <button
                  onClick={() => chooseOrder('shuffled')}
                  disabled={selectedSet.cards.length < 2}
                  aria-pressed={order === 'shuffled'}
                  aria-label="Shuffle the cards"
                  className={`px-4 py-2.5 rounded-xl border font-sans text-[11px] uppercase tracking-widest font-bold flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    order === 'shuffled'
                      ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30 text-primary-fixed-dim hover:bg-primary-fixed-dim/20'
                      : 'bg-surface-container border-white/10 text-slate-300 hover:bg-surface-container-high hover:text-white'
                  }`}
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  Shuffle
                </button>
              </div>
            </div>
          )}

          {/* Common case: unreviewed decks have no ratings, so sorting by rating changes nothing. Say so. */}
          {selectedSet && selectedSet.cards.length > 0 && ratedCount === 0 &&
            (order === 'hardest' || order === 'easiest') && (
            <div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-surface-container-lowest/60 border border-white/5">
              <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-slate-400 leading-relaxed">
                Nothing in this deck has been rated yet, so the order has not changed. A card gets a
                rating when you review it on the day it is due.
              </p>
            </div>
          )}

          {/* Card grid for browsing; no controls on cards. */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {orderedCards.map((card) => {
                const source = materialTitle(card.sourceMaterialId);
                const flipped = flippedCardId === card.id;
                const isMarked = marking?.cardIds.has(card.id) ?? false;
                /* front/back keep one meaning; only which side shows first changes. */
                const prompt = answerFirst ? card.back : card.front;
                const answer = answerFirst ? card.front : card.back;
                return (
                  /* Focus, role and keys live on the outer box (a ring on the flipping element would rotate away). Enter/Space wired here. */
                  <div
                    key={card.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={flipped}
                    aria-label={`Flashcard: ${prompt}`}
                    onClick={() => toggleFlip(card.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleFlip(card.id);
                      }
                    }}
                    className="group relative h-64 [perspective:1000px] cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div
                      className={`relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? '[transform:rotateY(180deg)]' : ''}`}
                    >
                      {/* Front */}
                      {/* The mark is on both faces, not the root (the root's ring means keyboard focus). Amber matches the results screen. */}
                      <div
                        className={`absolute inset-0 [backface-visibility:hidden] rounded-2xl border bg-surface-container flex flex-col shadow-lg overflow-hidden ${
                          isMarked ? 'border-amber-400/40' : 'border-white/10'
                        }`}
                      >
                        {/* The grid shows every card; scheduled ones are marked, never hidden. */}
                        <div className="shrink-0 flex items-baseline justify-between gap-2 px-5 pt-4">
                          {/* 11px slate-500: a title, more legible than the 10px micro-labels. */}
                          <p className="font-sans text-[11px] text-slate-500 truncate min-w-0">{source ?? ''}</p>
                          <span className="shrink-0 flex items-baseline gap-1.5 font-sans text-[11px]">
                            {isMarked && (
                              <>
                                <span className="text-amber-400/90 font-semibold">Missed</span>
                                <span className="text-slate-700">·</span>
                              </>
                            )}
                            {/* Rated cards only; an untested card shows nothing rather than an invented value. */}
                            {card.easeRating && (
                              <>
                                <span className={RATING_CHIP[card.easeRating].className}>
                                  {RATING_CHIP[card.easeRating].label}
                                </span>
                                <span className="text-slate-700">·</span>
                              </>
                            )}
                            <span className={
                              isDue(card.nextReviewAt) ? 'text-primary-fixed-dim/80' : 'text-slate-600'
                            }>
                              {dueLabel(card.nextReviewAt)}
                            </span>
                          </span>
                        </div>
                        {/* my-auto on the text, never items-center on the scroll box (that clips overflow past the top). */}
                        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col">
                          {/* Font and colour belong to the face; size and alignment follow the text via gridFaceClass. */}
                          <p className={`my-auto font-display text-on-surface ${gridFaceClass(prompt)}`}>{prompt}</p>
                        </div>
                        <span className="shrink-0 pb-4 text-[10px] uppercase tracking-widest text-slate-500 flex items-center justify-center gap-1 font-semibold">
                          <RefreshCw className="w-3 h-3" /> Click to Flip
                        </span>
                      </div>
                      {/* Back. An opaque surface with the cyan as a gradient wash over it. Don't collapse it to one bg-colour/opacity (the card turned see-through). */}
                      <div
                        className={`absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl border bg-surface-container bg-gradient-to-br from-primary-fixed-dim/[0.08] to-primary-fixed-dim/[0.02] flex flex-col shadow-[0_0_30px] shadow-primary-fixed-dim/10 overflow-hidden ${
                          isMarked ? 'border-amber-400/40' : 'border-primary-fixed-dim/30'
                        }`}
                      >
                        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col">
                          <p className={`my-auto font-sans text-primary-fixed-dim font-medium ${gridFaceClass(answer)}`}>{answer}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Saving indicator */}
      {isSaving && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-center justify-center">
          <div className="bg-surface-container border border-white/10 px-6 py-4 rounded-xl flex items-center gap-3 text-white">
            <Spinner className="w-5 h-5 text-primary-fixed-dim" />
            <span className="font-sans text-sm font-semibold">Saving changes...</span>
          </div>
        </div>,
        document.body
      )}

      {/* Create Deck Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Deck"
      >
        <form onSubmit={handleCreateDeck} className="flex flex-col gap-6">
          <div className="space-y-2">
            <label htmlFor="new-deck-title" className="font-sans text-sm font-medium text-slate-300">
              Deck Title
            </label>
            <input
              id="new-deck-title"
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Chapter 4 — Information Security"
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="new-deck-desc" className="font-sans text-sm font-medium text-slate-300">
              Description <span className="text-slate-500 text-xs">(optional)</span>
            </label>
            <textarea
              id="new-deck-desc"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="What does this deck cover?"
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm resize-none"
            />
          </div>
          <p className="font-sans text-xs text-slate-500 leading-relaxed">
            Your new deck starts empty. You'll fill it with flashcards generated from your teacher's materials.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newTitle.trim()}
              className="px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Deck
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename Deck Modal */}
      <Modal
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        title="Rename Deck"
      >
        <form onSubmit={handleRenameDeck} className="flex flex-col gap-6">
          <div className="space-y-2">
            <label htmlFor="rename-deck-title" className="font-sans text-sm font-medium text-slate-300">
              Deck Title
            </label>
            <input
              id="rename-deck-title"
              type="text"
              value={renameTitle}
              onChange={e => setRenameTitle(e.target.value)}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="rename-deck-desc" className="font-sans text-sm font-medium text-slate-300">
              Description <span className="text-slate-500 text-xs">(optional)</span>
            </label>
            <textarea
              id="rename-deck-desc"
              value={renameDescription}
              onChange={e => setRenameDescription(e.target.value)}
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsRenameOpen(false)}
              className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!renameTitle.trim()}
              className="px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Cards from Material */}
      <Modal
        isOpen={isAddCardsOpen}
        onClose={() => { if (!generatingId) { setIsAddCardsOpen(false); setConfirmRefresh(null); } }}
        title="Add Cards from Material"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            Every key term your teacher approved becomes one flashcard in
            <span className="text-white font-semibold"> {selectedSet?.title}</span>.
            The back of each card is always their exact definition.
          </p>

          {/* Card style — what goes on the FRONT. */}
          <div>
            <p className="font-sans text-[11px] uppercase tracking-widest text-slate-400 font-bold mb-2">
              Card front
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                {
                  value: 'term' as CardFormat,
                  label: 'Term & Definition',
                  blurb: 'The term on the front. Instant.',
                  example: 'Defense-in-depth',
                },
                {
                  value: 'question' as CardFormat,
                  label: 'Question & Answer',
                  blurb: 'AI writes a question. Takes a moment.',
                  example: 'What does defense-in-depth involve, and why does it help?',
                },
              ]).map(option => {
                const isActive = cardFormat === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCardFormat(option.value)}
                    disabled={!!generatingId}
                    className={`text-left p-3 rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      isActive
                        ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/50'
                        : 'bg-surface-container border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        isActive ? 'border-primary-fixed-dim' : 'border-slate-500'
                      }`}>
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim" />}
                      </span>
                      <span className="font-sans text-xs font-bold text-slate-200">{option.label}</span>
                    </div>
                    {/* An explicit 1.375rem indent (radio width + gap); fractional ml-5.5 generates no CSS. */}
                    <p className="font-sans text-[11px] text-slate-400 mb-1.5 ml-[1.375rem]">{option.blurb}</p>
                    <p className="font-sans text-[11px] text-slate-500 italic leading-snug line-clamp-2">
                      “{option.example}”
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {generateError && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-rose-300 leading-relaxed">{generateError}</p>
            </div>
          )}

          {/* Already here: a prompt, not a failure. */}
          {confirmRefresh && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-3">
              <p className="font-sans text-xs text-amber-200 leading-relaxed">
                {confirmRefresh.message}
              </p>
              <p className="font-sans text-[11px] text-amber-200/70 leading-relaxed">
                Refreshing updates the wording if your teacher has corrected it, adds any new terms and
                removes any they deleted. Your review progress on these cards is kept. They'll be
                rebuilt as{' '}
                <span className="font-semibold text-amber-200">
                  {confirmRefresh.currentFormat === 'question' ? 'questions' : 'terms'}
                </span>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmRefresh(null)}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-[11px] font-bold uppercase tracking-wider transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleGenerate(confirmRefresh.material, true, confirmRefresh.currentFormat)}
                  disabled={!!generatingId}
                  className="flex-1 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 text-amber-200 font-sans text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {generatingId ? 'Refreshing…' : 'Refresh Cards'}
                </button>
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {availableResources.length === 0 ? (
              <p className="font-sans text-xs text-slate-500 text-center py-8 leading-relaxed">
                There are no materials in this study space yet.<br />
                Open the Learning Resources tab to see what your teacher has published.
              </p>
            ) : (
              availableResources.map(material => {
                const alreadyHere = materialsInDeck.has(material.id);
                const otherDeck = alreadyHere ? null : deckHoldingMaterial.get(material.id) ?? null;
                const isBusy = generatingId === material.id;
                return (
                  <button
                    key={material.id}
                    onClick={() => handleGenerate(material)}
                    disabled={!!generatingId || otherDeck !== null}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-surface-container hover:border-primary-fixed-dim/40 hover:bg-primary-fixed-dim/5 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-9 h-9 rounded-lg bg-surface-container-high border border-white/5 flex items-center justify-center shrink-0">
                      {isBusy
                        ? <Spinner className="w-4 h-4 text-primary-fixed-dim" />
                        : <FileText className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-sm text-slate-200 truncate">{material.title}</p>
                      <p className="font-sans text-[11px] text-slate-500">
                        {isBusy
                          ? (cardFormat === 'question' ? 'Writing questions…' : 'Adding cards…')
                          : `${material.concept_count} card${material.concept_count === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    {alreadyHere && !isBusy && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 font-sans text-[10px] font-bold uppercase tracking-wider shrink-0">
                        <Check className="w-3 h-3" /> In deck
                      </span>
                    )}
                    {/* Amber: a refusal. Names the deck that holds it. */}
                    {otherDeck && !isBusy && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-400 font-sans text-[10px] font-bold uppercase tracking-wider shrink-0 max-w-[45%]">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="truncate">In {otherDeck}</span>
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Deck Confirmation */}
      <Modal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        title="Delete Flashcard Deck?"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner fade-in duration-300">
            <Trash2 className="w-5 h-5" />
          </div>

          {/* States the cost: review history is deleted with the cards, while mastery (keyed by concept) is kept. */}
          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            Are you sure you want to delete <span className="font-semibold text-white">"{selectedSet?.title}"</span>?
            This removes the deck and the {selectedSet?.cardCount ?? 0} card{selectedSet?.cardCount === 1 ? '' : 's'} inside it,
            along with <span className="font-semibold text-white">your review dates and ratings</span> for them.
            Your mastery scores are not affected.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsDeleteOpen(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteDeck}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-[#ffffff] font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
