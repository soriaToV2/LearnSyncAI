/**
 * Turns a mastery reading into an ordered ladder of study steps plus their sentences.
 * Never call a model here: fixed sentences are instant, free and reproducible.
 * No thresholds declared here (imports masteryTier). Tool descriptions come from TOOL_INTROS.
 * Grade 7 reading level.
 */

import { masteryPercent, masteryTier } from './mastery';
import type { ConceptMastery, DifficultyTier, MaterialMasteryDetail } from './mastery';
import type { ToolKey } from './onboarding';
import type { StudyTab } from './studySpace';

/** Recommendation bands. `unassessed` is the absence of a measurement, not a tier. */
export type MasteryBand = 'unassessed' | DifficultyTier;

export type StudyAction = 'read' | 'flashcards' | 'feynman' | 'free_recall' | 'test';

/** Where each action lives. */
const ACTION_TAB: Record<StudyAction, StudyTab> = {
  read: 'resources',
  flashcards: 'flashcards',
  feynman: 'feynman',
  free_recall: 'free-recall',
  test: 'adaptive-test',
};

const ACTION_TOOL: Record<StudyAction, ToolKey> = {
  read: 'tool_resources',
  flashcards: 'tool_flashcards',
  feynman: 'tool_feynman',
  free_recall: 'tool_free_recall',
  test: 'tool_adaptive_test',
};

/**
 * Which actions move mastery (only flashcards and tests, paper p. 58). A field, not a comment, because
 * a `why` on a non-moving step must say what the activity finds, never what it moves.
 */
const ACTION_MOVES_MASTERY: Record<StudyAction, boolean> = {
  read: false,
  flashcards: true,
  feynman: false,
  free_recall: false,
  test: true,
};

export interface Step {
  action: StudyAction;
  /** Key into TOOL_INTROS; never write another copy of a tool description. */
  tool: ToolKey;
  tab: StudyTab;
  /** Short imperative; the link text. */
  cta: string;
  /** One sentence: why this step, for this concept, now. */
  why: string;
  movesMastery: boolean;
}

export interface Recommendation {
  band: MasteryBand;
  /** Ordered, never empty. `steps[0]` is the lead action. */
  steps: Step[];
  /** Which steps move the number. Render once per card, never per row. */
  honesty: string;
}

function step(action: StudyAction, cta: string, why: string): Step {
  return {
    action,
    tool: ACTION_TOOL[action],
    tab: ACTION_TAB[action],
    cta,
    why,
    movesMastery: ACTION_MOVES_MASTERY[action],
  };
}

// Bands

/** Gate on `assessed`, never `mastery === 0.1`. Rounds before banding so the % shown matches the sentence. */
export function conceptBand(c: Pick<ConceptMastery, 'assessed' | 'mastery'>): MasteryBand {
  if (!c.assessed) return 'unassessed';
  return masteryTier(masteryPercent(c.mastery) / 100);
}

/** Same rule for a lesson: gate on the count. */
export function materialBand(
  m: Pick<MaterialMasteryDetail, 'assessed_concept_count' | 'm_doc'>
): MasteryBand {
  if (m.assessed_concept_count === 0) return 'unassessed';
  return masteryTier(masteryPercent(m.m_doc) / 100);
}

// Pages

/** "page 24", "pages 24 and 25", "pages 24, 25 and more"; null when there's nothing to cite. */
export function pageHint(pages: number[] | null | undefined): string | null {
  if (!pages || pages.length === 0) return null;
  const clean = [...new Set(pages.filter((p) => Number.isFinite(p)))].sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `page ${clean[0]}`;
  if (clean.length === 2) return `pages ${clean[0]} and ${clean[1]}`;
  if (clean.length === 3) return `pages ${clean[0]}, ${clean[1]} and ${clean[2]}`;
  return `pages ${clean[0]}, ${clean[1]} and more`;
}

// The ladders

const HONESTY_START =
  'Your mastery starts tracking the first time you answer a flashcard or a test question about it.';
/** A benefit, and true: a wrong answer at 0.90 pulls it down. */
const HONESTY_TEST = 'A test moves this number in both directions, so it is a real check.';

/** How each non-moving action is named in the honesty sentence. */
const NON_MOVING_GERUND: Record<StudyAction, string | null> = {
  read: 'reading',
  free_recall: 'writing down what you remember',
  feynman: 'explaining',
  // The two mastery writers (paper p. 58).
  flashcards: null,
  test: null,
};

/** Derives the honesty sentence from the steps, so it always matches them. */
function honestyFor(steps: Step[]): string {
  const parts = steps
    .filter((s) => !s.movesMastery)
    .map((s) => NON_MOVING_GERUND[s.action])
    .filter((g): g is string => g !== null);

  // Every step moves the number, so say something useful instead of a disclaimer.
  if (parts.length === 0) return HONESTY_TEST;

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const sentence = list.charAt(0).toUpperCase() + list.slice(1);
  const [verb, pronoun] = parts.length === 1 ? ['does', 'it shows'] : ['do', 'they show'];

  return `Only flashcards and tests change this number. ${sentence} ${verb} not — ${pronoun} you what to fix.`;
}

/** A Recommendation whose honesty sentence is derived from its steps. */
function withHonesty(band: MasteryBand, steps: Step[]): Recommendation {
  return { band, steps, honesty: honestyFor(steps) };
}

/**
 * One concept's ladder. The order is the decision: below 0.50 lead with Read, not Feynman (which needs
 * partial knowledge to find holes in).
 */
export function recommendConcept(input: {
  term: string;
  band: MasteryBand;
  mastery: number;
  sourcePages: number[] | null;
}): Recommendation {
  const { term, band, sourcePages } = input;
  const p = masteryPercent(input.mastery);
  const where = pageHint(sourcePages);
  const readWhy = where
    ? `You are at ${p}% on ${term}. Read ${where} again first.`
    : `You are at ${p}% on ${term}. Read that part of the lesson again first.`;

  switch (band) {
    case 'unassessed':
      return {
        band,
        honesty: HONESTY_START,
        steps: [
          step(
            'flashcards',
            'Study it in a deck',
            `Nobody has asked you about ${term} yet, so there is no score to show. A deck is the quickest way to start.`
          ),
        ],
      };

    case 'foundational':
      return withHonesty(band, [
        step('read', 'Read it again', readWhy),
        step(
          'flashcards',
          'Then review it in a deck',
          `Cards on ${term} are what move this number.`
        ),
        step(
          'feynman',
          'After that, explain it',
          `Once you can say something about ${term}, explaining it in your own words shows you what is still missing.`
        ),
      ]);

    case 'intermediate':
      return withHonesty(band, [
        step(
          'feynman',
          'Explain it in your own words',
          `You are at ${p}% on ${term}. You know part of it, so explaining it in your own words will show you the part you are missing.`
        ),
        step(
          'flashcards',
          'Then review it in a deck',
          `Cards on ${term} are what move this number up.`
        ),
      ]);

    case 'advanced':
      return {
        band,
        honesty: HONESTY_TEST,
        steps: [
          step(
            'test',
            'Take a test on this lesson',
            `You are at ${p}% on ${term}. A test is the strongest check that it stuck.`
          ),
        ],
      };
  }
}

/**
 * One lesson's ladder. Free Recall appears only here (it scores a whole material).
 * Only the test results screen renders the full ladder; other surfaces read steps[0], so check them
 * before changing any band's first step.
 */
export function recommendMaterial(input: {
  title: string;
  band: MasteryBand;
  m_doc: number;
}): Recommendation {
  const { title, band } = input;
  const p = masteryPercent(input.m_doc);

  switch (band) {
    case 'unassessed':
      return {
        band,
        honesty: HONESTY_START,
        steps: [
          step(
            'flashcards',
            'Make a deck from it',
            `Nothing in ${title} has been measured yet. A deck is the quickest way to start.`
          ),
        ],
      };

    case 'foundational':
      return withHonesty(band, [
        step(
          'read',
          'Read the lesson again',
          `You are at ${p}% on ${title}. Go back over it before anything else.`
        ),
        step(
          'flashcards',
          'Review its deck',
          'Cards from this lesson are what move this number.'
        ),
        step(
          'free_recall',
          'Write what you remember',
          'Then close the lesson and write down everything that stuck, without looking.'
        ),
        step(
          'feynman',
          'Explain what you missed',
          'Last, explain the ideas you got wrong in your own words — that is what shows you the gaps.'
        ),
      ]);

    case 'intermediate':
      return withHonesty(band, [
        step(
          'free_recall',
          'Write what you remember',
          `You are at ${p}% on ${title}. Writing down everything you remember, without looking, shows you what is missing.`
        ),
        step(
          'feynman',
          'Explain what you missed',
          'Then explain the ideas you got wrong in your own words — you know part of them, so this finds the rest.'
        ),
        step(
          'flashcards',
          'Review its deck',
          'Cards from this lesson are what move this number up.'
        ),
      ]);

    case 'advanced':
      return {
        band,
        honesty: HONESTY_TEST,
        steps: [
          step(
            'test',
            'Take a test on it',
            `You are at ${p}% on ${title}. A test is the strongest check that it stuck.`
          ),
        ],
      };
  }
}

// Ranking

/**
 * Weight of an unassessed concept when choosing what to work on. Mirror of NEUTRAL_MASTERY in
 * server/lib/gameDifficulty.ts; change both. Gives known-weak > unknown > known-strong. Not the
 * intermediate tier threshold, despite the same value.
 */
export const NEUTRAL_MASTERY = 0.5;

export function rankOf(assessed: boolean, mastery: number): number {
  if (!assessed) return NEUTRAL_MASTERY;
  if (!Number.isFinite(mastery)) return NEUTRAL_MASTERY;
  return Math.min(Math.max(mastery, 0), 1);
}

/** Weakest-worth-practising first. Deterministic, so lists don't reshuffle on render. */
export function byConceptPriority(
  a: Pick<ConceptMastery, 'assessed' | 'mastery' | 'term'>,
  b: Pick<ConceptMastery, 'assessed' | 'mastery' | 'term'>
): number {
  const ra = rankOf(a.assessed, a.mastery);
  const rb = rankOf(b.assessed, b.mastery);
  if (ra !== rb) return ra - rb;
  // A concept measured at 0.50 outranks an unmeasured one at the same key.
  if (a.assessed !== b.assessed) return a.assessed ? -1 : 1;
  return a.term.localeCompare(b.term);
}

export function byMaterialPriority(
  a: Pick<MaterialMasteryDetail, 'assessed_concept_count' | 'm_doc' | 'title'>,
  b: Pick<MaterialMasteryDetail, 'assessed_concept_count' | 'm_doc' | 'title'>
): number {
  const aStarted = a.assessed_concept_count > 0;
  const bStarted = b.assessed_concept_count > 0;
  const ra = rankOf(aStarted, a.m_doc);
  const rb = rankOf(bStarted, b.m_doc);
  if (ra !== rb) return ra - rb;
  if (aStarted !== bStarted) return aStarted ? -1 : 1;
  return a.title.localeCompare(b.title);
}
