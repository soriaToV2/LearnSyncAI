import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Layers, ChevronLeft, RefreshCw, RotateCcw, Play, Trash2, BookOpen, Pencil, AlertCircle, Sparkles, FileText, Check, CheckCircle2, LibraryBig, CalendarCheck, Shuffle, ArrowUpDown, Target } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import FlashcardStudyView from '../components/FlashcardStudyView';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';
import DueBadge from '../../../components/ui/DueBadge';
import { api } from '../../../lib/api';
// Shared with StudySpace, which counts due cards for the tab badge. One copy of
// the rule on the client; the server stays authoritative.
import { isDue } from '../../../lib/reviewSchedule';
import type { EaseRating } from '../../../lib/reviewSchedule';
// Lifted out of TermMatchingGame when this grid needed one too.
import { shuffle } from '../../../lib/shuffle';
import type { StudyIntent } from '../../../lib/studySpace';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  /**
   * The concept this card assesses — how a test result finds its card.
   *
   * ⚠️ NULLABLE. `flashcards.concept_id` is `ON DELETE SET NULL`, so a card
   * whose concept a re-upload removed still works as a card and matches nothing.
   */
  conceptId?: string | null;
  /** The material this card was generated from. Drives "already in this deck". */
  sourceMaterialId?: string | null;
  /** When this card is next due. Past or null = due now. */
  nextReviewAt?: string | null;
  /** The model wrote this card's front, so it is a question, not the term. */
  isAiGenerated?: boolean;
  /**
   * The student's last self-rating, or null for a card never rated while due.
   * See the fuller note on the same field in `StudySpace.tsx`: practice ratings
   * do not write it, so null is common and must never be read as "easy".
   */
  easeRating?: EaseRating | null;
}

/**
 * How the deck's cards are ordered on screen and in the session that starts
 * from here.
 *
 * ⚠️ `shuffled` IS A VALUE HERE BUT NOT AN OPTION IN THE MENU. Shuffle and the
 * sort both decide one thing — the order — so two pieces of state would let the
 * UI claim "Hardest first" over a shuffled grid. The menu is for SORTING and
 * the button is for scrambling; they are mutually exclusive, and choosing
 * either clears the other.
 *
 * That leaves one hazard to handle at the call site: `Dropdown` falls back to
 * its first option when `value` matches nothing, so passing `shuffled` straight
 * to it would silently render "Default" over a shuffled grid. The trigger is
 * therefore fed a mapped value, and the shuffled state is shown on the button
 * instead, via `aria-pressed` and an active tone.
 *
 * A `due` option was tried and removed: `next_review_at` is set FROM the last
 * rating (Hard 1 day, Medium 3, Easy 7), so on a deck reviewed in one sitting
 * it reproduces "Hardest first" almost exactly. The two diverge only across
 * ratings given on different days, which is not worth a near-duplicate entry.
 */
type OrderKey = 'deck' | 'hardest' | 'easiest' | 'shuffled';

/** Which cards a session opens with. See `studyMode`. */
type StudyMode = 'due' | 'practice' | 'marked';

const ORDER_OPTIONS: Array<{ label: string; value: OrderKey }> = [
  { label: 'Default', value: 'deck' },
  { label: 'Hardest first', value: 'hardest' },
  { label: 'Easiest first', value: 'easiest' },
];

/** Hard is the thing worth working on, so it sorts first. */
const RATING_RANK: Record<EaseRating, number> = { hard: 0, medium: 1, easy: 2 };
/**
 * ⚠️ UNRATED SORTS LAST IN *BOTH* DIRECTIONS, which is why "Easiest first" is
 * not a plain reverse of "Hardest first". Reversing the whole list would float
 * every never-rated card to the top of a list labelled "Easiest", asserting
 * something false about cards nobody has been tested on. The two orders differ
 * only in the part their labels describe; the unknowns stay parked at the end.
 *
 * Same rule the Analytics tab and educator Class Performance already follow for
 * unassessed concepts: partition first, never rank an unknown among the known.
 */
const UNRATED_RANK = 3;

/** Sort position of one card under a rating order. Lower comes first. */
function ratingRank(card: Flashcard, easiestFirst: boolean): number {
  if (!card.easeRating) return UNRATED_RANK;
  const rank = RATING_RANK[card.easeRating];
  return easiestFirst ? 2 - rank : rank;
}


/**
 * Tone for the rating chip on a card.
 *
 * ⚠️ THE PALETTE'S SOURCE OF TRUTH IS `RATING_CONFIG` IN
 * `FlashcardStudyView.tsx` — the rating buttons are where a student learns that
 * Hard is red — so keep these three in step with it. Three colour strings do
 * not yet justify a shared module; lift them if a third consumer appears.
 */
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
  /** Show the definition first and ask for the term. Deck row, migration 0027. */
  answerFirst: boolean;
}

/**
 * Type size and alignment for a face in the DECK GRID, from how much text it
 * holds — the small-card cousin of `faceTypeClass()` in `FlashcardStudyView`.
 *
 * ⚠️ IT EXISTS BECAUSE `answer_first` CHANGED WHAT A FACE CAN HOLD. The front
 * was always a term (23 characters on average) and was fixed at `text-lg`;
 * reversed, it holds a definition with a 162-character median that reaches 643,
 * in a 256px-tall box. One size cannot serve both.
 *
 * ⚠️ DO NOT IMPORT `faceTypeClass` INSTEAD. Its bands are measured against the
 * study card, which is `h-72` to `23rem` tall and twice as wide; its shortest
 * band alone runs to 260 characters, which is most of a definition.
 *
 * Size and alignment only. Font family and colour belong to the face — the back
 * stays cyan and `font-sans` whatever it holds — so they are not set here.
 */
function gridFaceClass(text: string): string {
  const len = text.length;
  if (len <= 120) return 'text-lg leading-snug text-center';
  if (len <= 300) return 'text-base leading-snug text-center';
  // Past roughly four lines, centring hurts: every line starts at a different
  // x-position. Same reasoning as the study view's own curve.
  return 'text-sm leading-relaxed text-left';
}

interface SpaceMaterial {
  id: string;
  title: string;
  concept_count: number;
}

/**
 * What goes on the FRONT of a generated card. The back is the educator's
 * definition in both cases — the model never writes an answer.
 */
type CardFormat = 'term' | 'question';

/**
 * A deck is the student's own folder — they create, rename and delete decks to
 * organise their lessons. The CARDS inside are not theirs to write: every card
 * assesses a concept an educator uploaded and vetted, so cards arrive only by
 * generating against a selected material. There is deliberately no add-card,
 * edit-card or delete-card control here, and the routes behind them are gone.
 *
 * Layout note: Study is on the deck tile itself, so opening the tab and starting
 * a session is one click. The deck view still exists, but for browsing cards and
 * managing the deck — it is no longer a step you pass through to reach studying.
 */
interface FlashcardsTabProps {
  spaceId: string;
  selectedSetContent: string | null;
  flashcardSets: FlashcardSet[];
  setSelectedSetContent: (id: string | null) => void;
  onRefresh: () => void;
  availableResources: SpaceMaterial[];
  /**
   * A recommendation's destination — in practice, "Review its deck" on the test
   * results screen.
   *
   * `materialId` picks the deck; `conceptIds` are the concepts the student got
   * wrong, which this tab MARKS rather than selects. This tab was the only
   * intent target never handed one, so the button was a dead end: the tab opened
   * on the plain deck list and the intent was silently dropped.
   */
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
   * 'due' opens with only the cards that are due; 'practice' with all of them;
   * 'marked' with the ones a test result flagged.
   *
   * ⚠️ `'marked'` IS A CARD FILTER, NOT A NEW RULE. It changes which cards the
   * session opens with and nothing else — every rating is still posted, and the
   * server still decides whether it counts by the same due-check. There is no
   * session id and no practice flag on the wire.
   */
  const [studyMode, setStudyMode] = useState<StudyMode>('due');
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Every failed action lands here and is rendered. Writing failures to the
  // console only would leave a student assuming the action worked.
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

  /**
   * How the cards below are ordered. One piece of state for one decision.
   *
   * Deliberately NOT persisted, unlike `answer_first`: a saved sort is a deck
   * that silently opens reordered weeks later with nothing on screen saying
   * why. It resets when the student opens a different deck.
   */
  const [order, setOrder] = useState<OrderKey>('deck');
  /**
   * Bumped on every press of Shuffle so pressing it again re-rolls. A counter
   * rather than a stored array of ids: the order is derived, so nothing has to
   * be reconciled when the card list changes underneath it.
   */
  const [shuffleNonce, setShuffleNonce] = useState(0);
  /**
   * Optimistic half of the answer-first toggle. Null means "no local opinion,
   * use what the server sent". Reverted if the write fails.
   */
  const [answerFirstDraft, setAnswerFirstDraft] = useState<boolean | null>(null);

  const toggleFlip = (cardId: string) => {
    setFlippedCardId(prev => (prev === cardId ? null : cardId));
  };

  const selectedSet = flashcardSets.find(s => s.id === selectedSetContent) || null;
  const hasMaterials = availableResources.length > 0;

  /**
   * What a test result asked this tab to mark.
   *
   * ⚠️ IT CARRIES ITS OWN `deckId` AND IS READ THROUGH `marking` BELOW, WHICH IS
   * WHAT AVOIDS THE ORDERING BUG. Landing on a deck changes
   * `selectedSetContent`, which fires the reset effect below — so a marking set
   * in the same tick as the deck would be wiped by it. Rather than sequencing
   * two effects, the value simply states which deck it belongs to and is ignored
   * everywhere else. The reset effect then needs no knowledge of it at all.
   *
   * Card ids rather than concept ids, so the grid and the session test
   * membership directly. `missing` counts concepts the test flagged that this
   * deck has no card for.
   *
   * ⚠️ VISIT-SCOPED ON PURPOSE. `<main key={activeTab}>` remounts this tab on
   * entry, so the marking disappears when the student leaves — right, because it
   * describes one test rather than a property of the deck. The deck selection
   * lives in the parent and correctly outlives it.
   */
  const [markingState, setMarkingState] = useState<{
    deckId: string;
    materialId: string | null;
    cardIds: Set<string>;
    missing: number;
  } | null>(null);

  const marking = markingState?.deckId === selectedSetContent ? markingState : null;

  // Opening a different deck starts clean: its own saved side, its own order,
  // and no card left showing its answer. The marking guards itself, so it is
  // deliberately not in here.
  useEffect(() => {
    setOrder('deck');
    setShuffleNonce(0);
    setAnswerFirstDraft(null);
    setFlippedCardId(null);
  }, [selectedSetContent]);

  /**
   * Change the order. Always clears the flip, because a card showing its answer
   * that then jumps position is disorienting.
   *
   * Pressing Shuffle again re-rolls rather than being a no-op, which is why the
   * nonce is bumped even when `shuffled` is already the current order.
   */
  const chooseOrder = (next: OrderKey) => {
    setOrder(next);
    if (next === 'shuffled') setShuffleNonce(n => n + 1);
    setFlippedCardId(null);
  };

  const answerFirst = answerFirstDraft ?? selectedSet?.answerFirst ?? false;

  /**
   * What the open deck's cards hold on their `front`, named for the student.
   * The back is the educator's definition in both formats, so only this half
   * varies.
   *
   * ⚠️ IT IS NOT ALWAYS "TERM", WHICH IS WHY THIS IS DERIVED RATHER THAN A
   * CONSTANT. Cards generated in `question` format have a model-written question
   * on the front ("What does the term CYBERSECURITY refer to…?"), and labelling
   * that "Term" would be plainly wrong on screen.
   *
   * `.some()` mirrors how the server derives `currentFormat` in
   * `studyspaces.routes.ts` — a deck may gather several materials and so mix the
   * two formats, and of the two words the broader one is the safer label.
   */
  const frontNoun = selectedSet?.cards.some(c => c.isAiGenerated) ? 'Question' : 'Term';

  /**
   * The deck's cards in the order they should be shown — in the grid and in the
   * session that starts from it.
   *
   * ⚠️ THE DEPENDENCY IS `selectedSet?.cards`, AND ITS STABILITY IS THE WHOLE
   * POINT. `selectedSet` is recomputed by `.find()` on every render, but
   * `.cards` is the same array instance held in `StudySpace`'s state, so
   * flipping a card does not reshuffle the grid underneath the student. It does
   * reshuffle once `onRefresh()` replaces the array — that is, on returning from
   * a session — which is a fresh visit rather than a surprise.
   *
   * Every branch returns a NEW array; `selectedSet.cards` belongs to
   * `StudySpace`'s state and must never be sorted in place.
   *
   * `Array.prototype.sort` is stable (guaranteed since ES2019), so ties keep
   * deck order — three cards all rated Hard stay in the order they were
   * generated rather than reshuffling themselves on every render.
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

    /*
     * Marked cards float to the top.
     *
     * ⚠️ A PARTITION, NOT A FIFTH `OrderKey`. The header note above says shuffle
     * and the sort both decide one thing — the order — so two pieces of state
     * would let the dropdown claim "Hardest first" over a grid that is not. A
     * `'missed'` order would inherit that, plus the `Dropdown` hazard where an
     * unrecognised value silently renders the first option. Partitioning instead
     * COMPOSES: "Hardest first" still holds inside each group.
     *
     * The sort is stable, so both groups keep whatever order was just chosen.
     */
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

  /** How many cards in the open deck carry a rating at all. */
  const ratedCount = (selectedSet?.cards ?? []).filter(c => c.easeRating).length;

  /**
   * Persist which face the open deck opens on.
   *
   * Local first so the cards turn over instantly, then one narrow PUT. On
   * failure it reverts and reports — `actionError` exists precisely so a write
   * that failed is not left looking like it worked.
   *
   * It does NOT call `onRefresh()`: that refetches every deck AND every card in
   * the space, one request per deck, which is far too much for a display switch.
   * `answerFirstDraft` is what keeps the screen honest until the next real load.
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

  // ── Following "Review its deck" from a test result ─────────────────────────

  /**
   * The intent as it stood at MOUNT.
   *
   * Held out of the resolving effect's deps: reading the live prop there would
   * re-run it the moment the intent is consumed and the prop flips to null.
   * Cleared as soon as it is acted on, so it cannot become a stale second source.
   */
  const preselectRef = React.useRef<StudyIntent | null>(preselect);
  React.useEffect(() => {
    if (preselect) preselectRef.current = preselect;
  }, [preselect]);

  /**
   * A deck we just built, waiting for `onRefresh()` to deliver its cards, and
   * the concepts to mark once they arrive.
   *
   * Parked in refs because the intent that carried them is consumed the instant
   * it is acted on, and the cards do not exist yet at that point.
   */
  const pendingBuildRef = React.useRef<{ deckId: string; materialId: string } | null>(null);
  const buildConceptsRef = React.useRef<string[]>([]);

  /** The lesson a preselect asked for but no deck holds. Drives the fallback card. */
  const [needsDeckFor, setNeedsDeckFor] = useState<SpaceMaterial | null>(null);
  const [buildingDeck, setBuildingDeck] = useState(false);

  /**
   * Which deck holds a lesson.
   *
   * ⚠️ "THE DECK" IS NOT A THING — MORE THAN ONE CAN HOLD THE SAME MATERIAL.
   * Nothing constrains it: `flashcard_decks` has no material column, and the 409
   * "already generated" guard on the generate route is scoped to a single
   * `deck_id`, so generating a lesson into a second deck is supported and
   * unremarked. Rather than asking, pick deterministically — most cards from that
   * lesson, then earliest created (decks arrive in `created_at` order, and
   * `find`-style reduction keeps the first on a tie).
   */
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
    // `conceptId` is nullable — a card whose concept a re-upload removed matches
    // nothing, which is correct.
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

  /*
   * Apply the intent: open the deck that holds the lesson and mark what the test
   * caught. Consumed in every branch, including the ones that resolve nothing —
   * an intent the parent still holds would be re-applied on the next remount and
   * would yank the student off a deck they had since picked by hand.
   */
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
      // No deck covers it yet — offer to build one rather than dead-ending. Shown
      // on the deck list, so send them there. The concepts are parked for the
      // marking that follows if they take the offer.
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

  /**
   * Build the missing deck in one click: create it, fill it, land on it.
   *
   * ⚠️ `format: 'term'` — NEVER `'question'`. The term path has no model in it at
   * all, so this is instant and free; the question path is a Gemini call against
   * a bucket one adaptive test already takes five of, and a recommender that
   * generates on a button press is a quota amplifier by construction.
   */
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

      // The marking is applied once the refreshed cards arrive — see the effect
      // below, which is why the wanted concepts are parked rather than resolved
      // here against cards that do not exist yet.
      pendingBuildRef.current = { deckId, materialId: material.id };
      setNeedsDeckFor(null);
      setSelectedSetContent(deckId);
      onRefresh();
    } catch (err: any) {
      // The manual path stays open: a created-but-empty deck renders the existing
      // "This deck is empty" card with its Add Cards button.
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

  /**
   * The one-line summary under a deck name. Leads with what the student has to
   * do — how many are due — rather than the deck's total size.
   */
  const deckSummary = (set: FlashcardSet): string => {
    if (set.cardCount === 0) return 'Empty — no cards yet';
    const cards = `${set.cardCount} card${set.cardCount === 1 ? '' : 's'}`;
    // Deliberately does NOT append "· N due". The tile already carries that
    // number twice — on the badge and on the "Review N" button — and a third
    // copy on one small tile reads as noise rather than emphasis.
    if (dueCards(set).length > 0) return cards;
    // Nothing due, so the tile has room to say something useful instead.
    const next = nextReviewDate(set);
    return next ? `${cards} · next review ${formatReviewDate(next)}` : cards;
  };

  /**
   * Where a deck's cards came from. Kept off the tile — the tile's one line is
   * spent on what to do next — and shown in the deck view, which has the room.
   */
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

  /**
   * Leaving a session refreshes the deck list, so the counts the student just
   * changed are correct the moment they land back on it.
   */
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

  /**
   * Fills the open deck from one material. Without `replace` the server answers
   * 409 when the material is already here; that is surfaced as a Refresh
   * confirmation rather than an error, because nothing went wrong.
   */
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
      // The 409 message names the deck and the existing count, so it reads as a
      // prompt rather than a failure. A refresh keeps the deck's existing style
      // unless the student deliberately picks the other one.
      if (/already/i.test(message)) {
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

  // Render study view if active.
  //
  // A 'due' session opens with only the cards that are due — that is what makes
  // the schedule mean anything. 'practice' opens with the whole deck; those
  // ratings are still sent, and the server schedules any that happen to be due.
  if (isStudying && selectedSet && selectedSet.cards.length > 0) {
    // Built from `orderedCards`, so a shuffled grid opens a shuffled session.
    // Starting from a deck TILE always gives the deck's own order, because
    // changing decks resets the nonce — correct, since the student never saw a
    // shuffled grid for that deck.
    const sessionCards =
      studyMode === 'due'
        ? orderedCards.filter(c => isDue(c.nextReviewAt))
        : studyMode === 'marked'
          ? orderedCards.filter(c => marking?.cardIds.has(c.id))
          : orderedCards;
    if (sessionCards.length > 0) {
      return (
        <div className="fade-in duration-300">
          <FlashcardStudyView
            /* `front`/`back` are handed over unswapped on purpose — the view
               takes `answerFirst` and does the swap at render, so it can move
               the "Question"/"Answer" labels and the type curve with it. */
            cards={sessionCards.map(c => ({
              id: c.id,
              front: c.front,
              back: c.back,
              source: materialTitle(c.sourceMaterialId) ?? undefined,
            }))}
            deckTitle={selectedSet.title}
            /* ⚠️ COMPUTED ON THE SESSION'S OWN CARDS, NOT THE WHOLE DECK. It
               used to ask whether anything ANYWHERE in the deck was due, which
               is the wrong question for a filtered session: a marked session
               where none of the marked cards are due would have suppressed the
               "your ratings won't count" banner just because some unrelated
               card elsewhere happened to be due. */
            isPractice={studyMode !== 'due' && !sessionCards.some(c => isDue(c.nextReviewAt))}
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
      {/* ══ Deck list ══════════════════════════════════════════════════ */}
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

          {/* ── "Review its deck" arrived, but no deck holds that lesson ─────
              Reachable and probably common early on: a student can take a test
              on a lesson they have never made cards from. Without this the step
              dead-ends on a deck list that says nothing about why they are here.

              Rendered ONLY when an intent asked for it — never as a standing
              nag, which is what it would become if it keyed off "some material
              has no deck". */}
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
                  /* A deck with work waiting now LOOKS different, not just
                     badged. Every tile was the same grey regardless of state, so
                     "which deck do I owe something to" was a counting task
                     against a small badge; the accent border and soft glow make
                     it a glance. Caught-up decks stay deliberately neutral —
                     if every tile glowed, none would. */
                  <div
                    key={set.id}
                    className={`relative bg-surface-container-lowest rounded-2xl border p-6 hover:-translate-y-1 focus-within:-translate-y-1 transition-all duration-300 group hover:shadow-lg flex flex-col ${
                      due > 0
                        ? 'border-primary-fixed-dim/30 shadow-[0_0_25px_-12px] shadow-primary-fixed-dim/35 hover:border-primary-fixed-dim/50 hover:shadow-primary-fixed-dim/10'
                        : 'border-white/5 hover:border-white/15 hover:shadow-black/20'
                    }`}
                  >
                    {/* The badge rides the icon rather than the title: scanning
                        a grid of six decks for "which one has work waiting" is a
                        visual job, and the icons form the column the eye follows. */}
                    <div className="relative w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center group-hover:bg-primary-fixed-dim/20 group-hover:border-primary-fixed-dim/30 transition-colors mb-5">
                      <Layers className="w-6 h-6 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                      <DueBadge count={due} className="absolute -top-1.5 -right-1.5 ring-2 ring-surface-container-lowest" />
                    </div>

                    <div className="flex-1 mb-5">
                      {/* The tile was a bare `<div onClick>` — no Tab stop, no
                          focus ring, so the deck grid could not be navigated by
                          keyboard at all. The title is a real button whose
                          `::after` stretches over the card, keeping the whole
                          surface mouse-clickable while giving the tile ONE focus
                          stop. Its action button below carries `relative z-10` to
                          stay clickable through that overlay. */}
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

                    {/* One clear action per tile. Studying is one click from
                        here — the deck view is no longer on the way. */}
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
                      /* Nothing due. Practice stays available for cramming, but
                         quietly — it is not the recommended next action. */
                      <button
                        onClick={e => { e.stopPropagation(); studyDeck(set.id, 'practice'); }}
                        className="relative z-10 w-full px-4 py-2.5 bg-surface-container border border-white/10 text-slate-300 hover:bg-surface-container-high hover:text-white rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 transition-all"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Practice all
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ══ Inside a deck — browsing and managing, not a step to studying ══ */
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
                {selectedSet.cards.length > 0 && (
                  dueCards(selectedSet).length > 0 ? (
                    <button
                      onClick={() => studyDeck(selectedSet.id, 'due')}
                      className="px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 shadow-[0_0_20px] shadow-primary-fixed-dim/20 hover:shadow-[0_0_30px] shadow-primary-fixed-dim/35 transition-all"
                    >
                      <Play className="w-4 h-4" />
                      Review {dueCards(selectedSet).length}
                    </button>
                  ) : (
                    <button
                      onClick={() => studyDeck(selectedSet.id, 'practice')}
                      className="px-5 py-2.5 bg-surface-container border border-white/10 text-slate-300 hover:bg-surface-container-high hover:text-white rounded-xl font-sans text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Practice all
                    </button>
                  )
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

          {/* Caught up. Said explicitly so an inactive Review button reads as
              success rather than something being broken. */}
          {/* ── What the last test caught ──────────────────────────────────
              ⚠️ THE DUE SPLIT IS STATED BEFORE THEY START, and that is the whole
              point of this banner. Flashcards move mastery only for cards that
              are DUE — `POST /flashcards/rate` returns early otherwise and
              writes no schedule, no log and no BKT update. So a student who
              cleared this deck yesterday, then missed five concepts in a test,
              can drill all five here and change nothing. The button that sent
              them here carries a "moves mastery" chip, so the honest thing is to
              say which half they are about to do rather than relax the rule. */}
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
                    : "None are due yet, so practising them won't change your mastery or your review dates."}
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
                <button
                  // `marking.deckId`, not `selectedSet!.id` — the two are equal
                  // by the guard above, but `selectedSet` is briefly null in the
                  // window after a deck is built and before its cards arrive.
                  onClick={() => studyDeck(marking.deckId, 'marked')}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/15 font-sans text-xs font-semibold text-amber-200 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {markedDueCount > 0
                    ? `Review these ${marking.cardIds.size}`
                    : `Practice these ${marking.cardIds.size}`}
                </button>
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
                You can still practise — it just won't change your review dates.
              </p>
            </div>
          )}

          {/* Empty state — a new deck is empty by design, so it names the next step. */}
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

          {/*
            View controls for the grid below.

            ⚠️ NOT IN THE HEADER CLUSTER ABOVE. That row holds deck ACTIONS —
            study, add cards, rename, delete — and already carries four buttons.
            These change how the cards below are shown and belong next to them.

            ⚠️ THE SIDES ARE NAMED FOR WHAT THEY HOLD, NOT "QUESTION"/"ANSWER".
            Those two were the study view's existing face labels and read as
            vague here — "Answer" never tells a student it means the definition.
            The first side is `frontNoun`, which is "Term" for a term-format deck
            and "Question" for one built in question format; the second is always
            "Definition", because the back is the educator's definition verbatim
            whichever format the deck was generated in.

            The right-hand pair is ONE decision, not two. Shuffle and the sort
            both set the order, so they share `order` — three separate controls
            (Shuffle / Original order / Sort) could have contradicted each other
            on screen. Choosing a sort clears the shuffle and vice versa.
          */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-bold shrink-0">
                  Show in front
                </span>
                {/* A segmented pair, not one toggle. A single button whose label
                    is its current state is ambiguous — nobody can tell whether
                    it names what you have or what you would get. */}
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

              {/* The menu sorts, the button scrambles, and only one can be in
                  effect. "Original order" used to be a third control here and is
                  now the menu's `Default`. */}
              <div className="flex items-center gap-2">
                <Dropdown
                  /* ⚠️ MAPPED, NOT PASSED THROUGH. `shuffled` is a real order but
                     not an option, and `Dropdown` renders its first option for
                     any value it does not recognise — so passing it raw would
                     read "Default" over a shuffled grid. Shuffling genuinely is
                     "no sort applied", and the button below is what shows it. */
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

          {/*
            ⚠️ THE COMMON CASE, NOT AN EDGE CASE. `ease_rating` is written only
            when a rating counted, so a deck nobody has reviewed while due has
            no ratings at all — which is every new deck. Sorting it by rating
            correctly changes nothing, and without this line the first thing a
            student tries looks broken.
          */}
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

          {/* Card grid — for reviewing what is in the deck. No controls on cards. */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {orderedCards.map((card) => {
                const source = materialTitle(card.sourceMaterialId);
                const flipped = flippedCardId === card.id;
                const isMarked = marking?.cardIds.has(card.id) ?? false;
                /* `front`/`back` keep one meaning everywhere — front is the term
                   or generated question, back is the educator's definition. Only
                   which one the student meets first changes here. */
                const prompt = answerFirst ? card.back : card.front;
                const answer = answerFirst ? card.front : card.back;
                return (
                  /* Focus, role and the key handler live on the OUTER box, not on
                     the rotating inner one: a focus ring on the flipping element
                     rotates away with it. There is no global key handler on this
                     grid (unlike the study view, where Space is already bound
                     window-wide), so Enter/Space are wired here. */
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
                      {/* ⚠️ THE MARK IS ON BOTH FACES, not on the card root. The
                          root carries the focus ring, so a ring there would be
                          indistinguishable from keyboard focus; and the back is
                          a separate element, so a front-only border vanishes the
                          moment the card is flipped. Amber is carried over from
                          the results screen's own "Concepts to revisit" chips so
                          the two screens read as one action. */}
                      <div
                        className={`absolute inset-0 [backface-visibility:hidden] rounded-2xl border bg-surface-container flex flex-col shadow-lg overflow-hidden ${
                          isMarked ? 'border-amber-400/40' : 'border-white/10'
                        }`}
                      >
                        {/* The grid always shows every card — it is for browsing
                            a lesson. Scheduled cards are marked, never hidden. */}
                        <div className="shrink-0 flex items-baseline justify-between gap-2 px-5 pt-4">
                          {/* `[11px]`/`slate-500`, not `[10px]`/`slate-600`: this
                              is a lesson TITLE, not an uppercase micro-label, and
                              10px at the lowest slate on a dark card is the least
                              legible text in the tab. `[10px]` stays correct for
                              the tracking-widest labels below. */}
                          <p className="font-sans text-[11px] text-slate-500 truncate min-w-0">{source ?? ''}</p>
                          <span className="shrink-0 flex items-baseline gap-1.5 font-sans text-[11px]">
                            {isMarked && (
                              <>
                                <span className="text-amber-400/90 font-semibold">Missed</span>
                                <span className="text-slate-700">·</span>
                              </>
                            )}
                            {/* Rated cards only. A card nobody has reviewed shows
                                nothing at all — no "Unrated" pill, no neutral
                                dot. Sorting by rating is invisible without this,
                                but inventing a value for an untested card is the
                                mistake the rule against it exists to prevent. */}
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
                        {/* `my-auto` on the text, never `items-center` here — a
                            centred flex item taller than its box overflows past
                            the TOP edge, which is outside the scrollable region
                            and unreachable. An auto margin centres the same way
                            when it fits and clips nothing when it does not. */}
                        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col">
                          {/* Font family and colour belong to the FACE — this is
                              the "before you flip" side and should read like it
                              whichever string it holds. Only size and alignment
                              follow the text, via `gridFaceClass`. */}
                          <p className={`my-auto font-display text-on-surface ${gridFaceClass(prompt)}`}>{prompt}</p>
                        </div>
                        <span className="shrink-0 pb-4 text-[10px] uppercase tracking-widest text-slate-500 flex items-center justify-center gap-1 font-semibold">
                          <RefreshCw className="w-3 h-3" /> Click to Flip
                        </span>
                      </div>
                      {/* Back.

                          ⚠️ THE OPAQUE SURFACE IS THE BASE AND THE CYAN IS A WASH
                          OVER IT. This face was `bg-primary-fixed-dim/5` and
                          nothing else — a 5% tint, meaning 95% TRANSPARENT — so
                          flipping a card revealed the page behind it rather than
                          the back of the card. It went unnoticed on the dark
                          theme, where a faint cyan wash over a near-black page
                          still reads as a dark card; in light mode the card
                          vanished under its own cyan text.

                          `background-color` and `background-image` compose, so
                          the opaque surface sits beneath the gradient and the
                          tint survives unchanged. Do not collapse this back to a
                          single `bg-<colour>/<opacity>` — an opacity modifier on
                          the only background is what caused this. */}
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

      {/* Saving indicator overlay */}
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
                    {/* `ml-5.5` generated NO CSS and the indent silently never
                        applied — Tailwind v4 invents dynamic spacing for whole
                        numbers (`max-h-68` compiles) but not for arbitrary
                        fractions. Written as an explicit length instead: the
                        w-3.5 radio (0.875rem) plus its gap-2 (0.5rem) is exactly
                        1.375rem, which aligns this under the label text. */}
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

          {/* Already here — a prompt, not a failure. */}
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
                const isBusy = generatingId === material.id;
                return (
                  <button
                    key={material.id}
                    onClick={() => handleGenerate(material)}
                    disabled={!!generatingId}
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

          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            Are you sure you want to delete <span className="font-semibold text-white">"{selectedSet?.title}"</span>?
            This removes the deck and the {selectedSet?.cardCount ?? 0} card{selectedSet?.cardCount === 1 ? '' : 's'} inside it.
            You can generate them again from the same material.
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
