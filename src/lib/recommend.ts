/**
 * What to do about a mastery number.
 *
 * BKT tells a student they are at 30% on a concept and then, until this module
 * existed, stopped. `bkt_mastery` had three readers — adaptive test difficulty,
 * game calibration and the Analytics tab — and none of them turned a low number
 * into an instruction. This turns one `(assessed, mastery)` pair into an ordered
 * ladder of study steps plus the sentences that go with them.
 *
 * ⚠️ NO MODEL CALL EVER REACHES THIS FILE, AND THAT IS A RULE RATHER THAN AN
 * OVERSIGHT. Every sentence below is assembled from a band, a term and a page
 * list, so it is instant, free, identical every time, and statable as one
 * paragraph in the paper. A Gemini call here would be none of those, and would
 * spend a ~20/day free-tier bucket that one adaptive test already takes five of.
 *
 * ⚠️ NO THRESHOLD IS DECLARED HERE. 0.50 and 0.85 live in `masteryTier()` next
 * door, which mirrors `masteryTier()` in `server/lib/testDifficulty.ts` and
 * `mastery_tier()` in `schema.sql`. This module imports it. A fourth copy is
 * exactly the drift that `MASTERED_AT = 0.85` in
 * `server/routes/dashboard.routes.ts` already demonstrates.
 *
 * ⚠️ THIS FILE NEVER RESTATES WHAT A TOOL IS. Every `Step` carries a `ToolKey`,
 * so a surface wanting the canonical description reads `TOOL_INTROS[step.tool]`
 * (`src/lib/onboarding.ts`). What is new here is only *why this concept, now*.
 *
 * Copy is grade-7 reading level, per the copy rule in `onboarding.ts`.
 */

import { masteryPercent, masteryTier } from './mastery';
import type { ConceptMastery, DifficultyTier, MaterialMasteryDetail } from './mastery';
import type { ToolKey } from './onboarding';
import type { StudyTab } from './studySpace';

/**
 * The four states a recommendation keys off.
 *
 * ⚠️ `unassessed` IS NOT A FOURTH TIER. It is the absence of a measurement, and
 * conflating it with `foundational` is the single mistake the whole analytics
 * surface exists to prevent — a concept nobody has asked about sits at
 * P(L₀) = 0.10, which is an assumption. `DifficultyTier` supplies the other
 * three unchanged, so the band vocabulary and the tier vocabulary cannot drift.
 */
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
 * ⚠️ `bkt_mastery` HAS EXACTLY TWO WRITERS — `flashcards.routes.ts` (the
 * `counted: true` branch of `POST /rate`) and `practice.routes.ts`
 * (`PUT /:id/complete`) — and paper p. 58 fixes it at two. Reading, explaining
 * and recalling are real study and change nothing measurable.
 *
 * This is a FIELD rather than a comment because it is load-bearing copy policy:
 * a `why` string on a false step must describe what the activity *finds*, never
 * what it *moves*. Without that discipline the app tells a student to do Feynman
 * to fix their 30%, they do, the number does not budge, and they stop believing
 * every number on the screen.
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
  /** For `TOOL_INTROS[tool]`. Never write a fourth copy of a tool description. */
  tool: ToolKey;
  tab: StudyTab;
  /** Imperative, short. This is the link text. */
  cta: string;
  /** One sentence: why this step, for this concept, now. */
  why: string;
  movesMastery: boolean;
}

export interface Recommendation {
  band: MasteryBand;
  /** Ordered, never empty. `steps[0]` is the lead action. */
  steps: Step[];
  /**
   * The one sentence saying which steps move the number.
   *
   * ⚠️ RENDER IT ONCE PER CARD, NEVER PER ROW. Three focus rows and nine lesson
   * lines would otherwise print it twelve times on one screen. The card that
   * owns the rows prints it under its heading; the rows do not.
   */
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

// ─────────────────────────────────────────────
// Bands

/**
 * ⚠️ GATE ON `assessed`, NEVER ON `mastery === 0.1`. An assessed concept can
 * legitimately sit near the prior, and the flag is the only thing that
 * distinguishes "measured and low" from "never asked".
 *
 * Rounds before banding, which `masteryTier`'s own JSDoc asks for: a concept at
 * 0.849 prints "85%" and tiers `intermediate` on the raw value, so the card
 * would read "You are at 85% on Injection. You know part of it" — the number
 * contradicting the sentence beside it.
 */
export function conceptBand(c: Pick<ConceptMastery, 'assessed' | 'mastery'>): MasteryBand {
  if (!c.assessed) return 'unassessed';
  return masteryTier(masteryPercent(c.mastery) / 100);
}

/** Same rule one level up. Gate on the COUNT — a started lesson can average 0.10. */
export function materialBand(
  m: Pick<MaterialMasteryDetail, 'assessed_concept_count' | 'm_doc'>
): MasteryBand {
  if (m.assessed_concept_count === 0) return 'unassessed';
  return masteryTier(masteryPercent(m.m_doc) / 100);
}

// ─────────────────────────────────────────────
// Pages

/**
 * "page 24" / "pages 24 and 25" / "pages 24, 25 and 26" / "pages 24, 25 and more".
 *
 * Returns null rather than an empty string when there is nothing to cite, so a
 * caller has to branch and cannot render a dangling "Read  again".
 * `concepts.source_pages` is nullable, and a folded concept carries several.
 */
export function pageHint(pages: number[] | null | undefined): string | null {
  if (!pages || pages.length === 0) return null;
  const clean = [...new Set(pages.filter((p) => Number.isFinite(p)))].sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `page ${clean[0]}`;
  if (clean.length === 2) return `pages ${clean[0]} and ${clean[1]}`;
  if (clean.length === 3) return `pages ${clean[0]}, ${clean[1]} and ${clean[2]}`;
  return `pages ${clean[0]}, ${clean[1]} and more`;
}

// ─────────────────────────────────────────────
// The ladders

const HONESTY_START =
  'Your mastery starts tracking the first time you answer a flashcard or a test question about it.';
/** Stated as a benefit rather than a caveat, and true — a wrong answer at 0.90 pulls it down. */
const HONESTY_TEST = 'A test moves this number in both directions, so it is a real check.';

/** How each non-moving action is named inside the honesty sentence. */
const NON_MOVING_GERUND: Record<StudyAction, string | null> = {
  read: 'reading',
  free_recall: 'writing down what you remember',
  feynman: 'explaining',
  // The two writers. `bkt_mastery` has exactly these, per paper p. 58.
  flashcards: null,
  test: null,
};

/**
 * Build the honesty sentence FROM the ladder rather than picking it by hand.
 *
 * ⚠️ THESE WERE FIVE HAND-PICKED CONSTANTS AND EXTENDING A LADDER DESYNCED THEM
 * IMMEDIATELY. The material `foundational` band gained a Free Recall step while
 * its sentence still said only "Reading and explaining do not", so the screen
 * listed an activity it had just failed to account for. Deriving it makes the
 * sentence provably match the steps above it — the property that matters, since
 * this line is the feature's whole credibility (see `ACTION_MOVES_MASTERY`).
 */
function honestyFor(steps: Step[]): string {
  const parts = steps
    .filter((s) => !s.movesMastery)
    .map((s) => NON_MOVING_GERUND[s.action])
    .filter((g): g is string => g !== null);

  // Every step moves the number — there is nothing to disclaim, so say the
  // useful thing instead.
  if (parts.length === 0) return HONESTY_TEST;

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const sentence = list.charAt(0).toUpperCase() + list.slice(1);
  const [verb, pronoun] = parts.length === 1 ? ['does', 'it shows'] : ['do', 'they show'];

  return `Only flashcards and tests change this number. ${sentence} ${verb} not — ${pronoun} you what to fix.`;
}

/** A `Recommendation` whose honesty sentence is derived from its own steps. */
function withHonesty(band: MasteryBand, steps: Step[]): Recommendation {
  return { band, steps, honesty: honestyFor(steps) };
}

/**
 * One concept's ladder.
 *
 * ⚠️ THE ORDER IS THE DECISION. Below 0.50 the lead is READ, not Feynman:
 * Feynman works by finding holes in what you already partly know, so a student
 * at 20% asked to explain a concept to a ten-year-old writes an empty box and is
 * graded near zero. It is still offered, third, once there is something to
 * explain. From 0.50 up it leads, because that is where it is genuinely powerful.
 *
 * `mastery` is read only when `band !== 'unassessed'` — passing P(L₀) through is
 * harmless because nothing prints it in that branch.
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
 * One lesson's ladder.
 *
 * ⚠️ FREE RECALL APPEARS HERE AND NOWHERE ELSE, and the asymmetry is deliberate
 * rather than an oversight. `FreeRecallSchema` caps the submission at exactly one
 * MATERIAL and scores a coverage ratio over every concept in it, so it cannot be
 * aimed at a concept — a per-concept ladder has no slot to put it in. A lesson is
 * exactly the unit it addresses.
 *
 * ⚠️ THE FULL LADDER IS RENDERED IN EXACTLY ONE PLACE — the adaptive-test results
 * screen. `AnalyticsTab` (its Focus rows and its lesson lines) and the dashboard's
 * `FocusRow` all read `steps[0]` alone, so lengthening a ladder here is invisible
 * to them. Verified before the four-step bands below were added; check it again
 * before adding a fifth step, because a new `steps[0]` WOULD change all three.
 *
 * The order within a band is the same rule `recommendConcept()` follows: below
 * 0.50 acquisition leads (read, then cards) and explaining comes last, because
 * Feynman finds holes in what you already partly know and has nothing to work
 * with at 20%. From 0.50 up, retrieval and explanation lead.
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

// ─────────────────────────────────────────────
// Ranking

/**
 * What an unassessed concept counts as WHEN CHOOSING WHAT TO WORK ON.
 *
 * ⚠️ CLIENT MIRROR of `NEUTRAL_MASTERY` in `server/lib/gameDifficulty.ts`.
 * Change one, change both — the same arrangement `isDue()` in
 * `src/lib/reviewSchedule.ts` has with its server twin.
 *
 * ⚠️ THIS IS THE EASIEST THING IN THE FEATURE TO GET BACKWARDS. BKT's transition
 * step floors every assessed posterior at P(T) = 0.20, while a concept nobody
 * has ever asked about sits at P(L₀) = 0.10. So ranking a picker by raw mastery
 * puts every UNTOUCHED concept above every concept the student is measurably
 * failing: on a 57-concept lesson with six assessed, the Feynman picker would
 * open entirely on concepts they have never seen. 0.50 gives the ordering that
 * is actually wanted — known-weak > unknown > known-strong.
 *
 * ⚠️ THIS 0.5 IS NOT THE `intermediate` TIER THRESHOLD. They coincide
 * numerically and mean different things: one is a paper threshold (p. 81 / p. 98),
 * the other is a selection-neutral point chosen to sit between weak and strong.
 * Do not unify them.
 */
export const NEUTRAL_MASTERY = 0.5;

export function rankOf(assessed: boolean, mastery: number): number {
  if (!assessed) return NEUTRAL_MASTERY;
  if (!Number.isFinite(mastery)) return NEUTRAL_MASTERY;
  return Math.min(Math.max(mastery, 0), 1);
}

/**
 * Weakest-worth-practising first.
 *
 * Deterministic, deliberately NOT `pickConceptsByMastery()`'s weighted sampling:
 * that exists so "Play Again" cannot rebuild a byte-identical game, and a list
 * that reshuffled on every render would read as broken.
 */
export function byConceptPriority(
  a: Pick<ConceptMastery, 'assessed' | 'mastery' | 'term'>,
  b: Pick<ConceptMastery, 'assessed' | 'mastery' | 'term'>
): number {
  const ra = rankOf(a.assessed, a.mastery);
  const rb = rankOf(b.assessed, b.mastery);
  if (ra !== rb) return ra - rb;
  // A concept measured at exactly 0.50 outranks an unmeasured one sitting at the
  // same key: one is evidence, the other is a placeholder standing in for none.
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
