import {
  Award,
  BrainCircuit,
  CheckCircle2,
  Flame,
  Gamepad2,
  Layers,
  PenLine,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * How a badge LOOKS. The server decides which badges exist and who holds one.
 *
 * ══ THE SPLIT IS DELIBERATE ══
 * `server/lib/badges.ts` owns the catalogue and every rule; this file owns
 * labels, icons and colours. The server never ships presentation, and this file
 * never decides eligibility — a client that could would be a client that awards
 * its own trophies.
 *
 * ══ AN UNKNOWN NAME MUST NOT CRASH ══
 * `badgeStyle()` falls back rather than indexing blind, so the server can add a
 * badge and award it before this file knows the name. The student sees a generic
 * medal with the raw identifier instead of a blank screen, and the next deploy
 * fixes the label. Never replace this with `BADGE_STYLES[name]`.
 *
 * ══ THE DASHBOARD CARD SHOWS EARNED BADGES ONLY. THE GALLERY IS OPT-IN. ══
 * This file used to say no unearned badge is ever rendered, because a permanent
 * greyed-out rail on a two-week study reads as a list of things you failed to do.
 * That still holds for the CARD, which is always on screen and still shows only
 * what the student holds.
 *
 * `BadgeGalleryModal` is the narrow exception, and the distinction is consent: a
 * student opens it having asked what is left to earn, which is a different act
 * from being shown a wall of grey on every visit. The other half of the old
 * objection — "it would need the criteria text" — is answered by `criteria`
 * below. The one nudge that does reach the card is a single row for the badge
 * closest to completion, and only once real progress exists; a "0 / 100" bar is
 * the thing the original rule was protecting against.
 *
 * `GET /api/dashboard` still ships only what the student holds, plus a distance
 * for each unearned COUNTABLE badge. The catalogue is not served — `BADGE_STYLES`
 * below is the client's own copy, so a badge the server adds and awards will show
 * in the earned list (via the fallback) but not in the locked list until this file
 * learns its name. That is the same trade `badgeStyle()` already makes.
 */

export interface BadgeStyle {
  label: string;
  /**
   * One sentence naming what was done to earn it. Shown only in the
   * badge-earned modal, and only when a single badge was awarded.
   *
   * This DUPLICATES the server catalogue's `description`, as `label` already
   * does, because the catalogue is never shipped to the client — the server
   * sends which badges a student holds, not what they are. The duplication is
   * the price of not shipping a catalogue endpoint nobody else needs; the only
   * field that must never drift is `name`, which is the database identity.
   */
  description: string;
  icon: LucideIcon;
  /** Text colour. Paired with `ring` for the tile border. */
  color: string;
  bg: string;
  ring: string;
  /**
   * Raw colour for the celebration halo, which is drawn with `color-mix()` in
   * CSS and so cannot take a Tailwind class the way the fields above do.
   */
  glow: string;
}

/** Mirrors `BadgeFamily` in `server/lib/badges.ts`. Groups the gallery, nothing else. */
export type BadgeFamily = 'streak' | 'mastery' | 'first' | 'performance';

/** One catalogue row: how a badge looks, plus what it takes to get it. */
export interface BadgeCatalogueEntry extends BadgeStyle {
  /** The database identity. Never changes. */
  name: string;
  family: BadgeFamily;
  /**
   * How to EARN it, imperative and present tense — "Study on three days in a
   * row." This is not `description`, which is past tense because the celebration
   * modal is congratulating someone who already did it. Both exist because a
   * badge is read in two opposite situations and one sentence cannot serve both.
   */
  criteria: string;
}

type Palette = Pick<BadgeStyle, 'color' | 'bg' | 'ring' | 'glow'>;

const STREAK: Palette & Pick<BadgeStyle, 'icon'> = {
  icon: Flame,
  color: 'text-orange-400',
  bg: 'bg-orange-400/10',
  ring: 'border-orange-400/25',
  glow: '#fb923c',
};

const FIRST: Palette = {
  color: 'text-sky-400',
  bg: 'bg-sky-400/10',
  ring: 'border-sky-400/25',
  glow: '#38bdf8',
};

const MASTERY: Palette = {
  color: 'text-violet-400',
  bg: 'bg-violet-400/10',
  ring: 'border-violet-400/25',
  glow: '#a78bfa',
};

const PERFORMANCE: Palette = {
  color: 'text-amber-400',
  bg: 'bg-amber-400/10',
  ring: 'border-amber-400/25',
  glow: '#fbbf24',
};

/** Keys mirror `BADGES` in `server/lib/badges.ts`. Labels may drift; keys may not. */
const BADGE_STYLES: Record<string, Omit<BadgeCatalogueEntry, 'name'>> = {
  streak_3: {
    label: 'Getting Started',
    description: 'Studied three days in a row.',
    criteria: 'Study on three days in a row.',
    family: 'streak',
    ...STREAK,
  },
  streak_5: {
    label: 'On a Roll',
    description: 'Studied five days in a row.',
    criteria: 'Study on five days in a row.',
    family: 'streak',
    ...STREAK,
  },
  streak_7: {
    label: 'Week Warrior',
    description: 'Studied seven days in a row.',
    criteria: 'Study on seven days in a row.',
    family: 'streak',
    ...STREAK,
  },

  first_flashcard: {
    label: 'First Review',
    description: 'Reviewed your first flashcard.',
    criteria: 'Review a flashcard in any study space.',
    family: 'first',
    icon: Layers,
    ...FIRST,
  },
  first_test: {
    label: 'First Test',
    description: 'Finished your first adaptive test.',
    criteria: 'Finish an adaptive test.',
    family: 'first',
    icon: CheckCircle2,
    ...FIRST,
  },
  first_recall: {
    label: 'First Recall',
    description: 'Completed your first free recall.',
    criteria: 'Write down everything you remember in Free Recall.',
    family: 'first',
    icon: PenLine,
    ...FIRST,
  },
  first_feynman: {
    label: 'First Explanation',
    description: 'Explained your first concept in your own words.',
    criteria: 'Explain a concept in your own words in the Feynman tab.',
    family: 'first',
    icon: Sparkles,
    ...FIRST,
  },
  first_game: {
    label: 'First Game',
    description: 'Played your first study game.',
    criteria: 'Play any study game.',
    family: 'first',
    icon: Gamepad2,
    ...FIRST,
  },

  mastery_1: {
    label: 'First Mastery',
    description: 'Reached 85% mastery on your first concept.',
    criteria: 'Reach 85% mastery on one concept.',
    family: 'mastery',
    icon: Target,
    ...MASTERY,
  },
  mastery_10: {
    label: 'Ten Mastered',
    description: 'Reached 85% mastery on ten concepts.',
    criteria: 'Reach 85% mastery on ten concepts.',
    family: 'mastery',
    icon: BrainCircuit,
    ...MASTERY,
  },
  mastery_25: {
    label: 'Twenty-Five Mastered',
    description: 'Reached 85% mastery on twenty-five concepts.',
    criteria: 'Reach 85% mastery on twenty-five concepts.',
    family: 'mastery',
    icon: Award,
    ...MASTERY,
  },

  perfect_test: {
    label: 'Perfect Score',
    description: 'Answered every question on an adaptive test correctly.',
    criteria: 'Answer every question on an adaptive test correctly.',
    family: 'performance',
    icon: Trophy,
    ...PERFORMANCE,
  },
  flawless_game: {
    label: 'Flawless',
    description: 'Finished a study game without a single mistake.',
    criteria: 'Finish a study game without a single mistake.',
    family: 'performance',
    icon: Zap,
    ...PERFORMANCE,
  },
  cards_100: {
    label: 'Century',
    description: 'Reviewed one hundred flashcards.',
    criteria: 'Review one hundred flashcards.',
    family: 'performance',
    icon: Trophy,
    ...PERFORMANCE,
  },
};

/**
 * Every badge this build knows about, for the gallery.
 *
 * Derived from `BADGE_STYLES` rather than written out again — a second list would
 * be one more thing to keep in step with the server's. `BADGE_FAMILY_ORDER`
 * carries the display order, so the object literal's key order above is
 * presentation-irrelevant.
 */
export const BADGE_CATALOGUE: readonly BadgeCatalogueEntry[] = Object.entries(BADGE_STYLES).map(
  ([name, body]) => ({ name, ...body })
);

export const BADGE_FAMILY_ORDER: readonly BadgeFamily[] = [
  'streak',
  'first',
  'mastery',
  'performance',
];

/**
 * The "N of M" figure, for the dashboard card and the gallery alike.
 *
 * `total` counts held badges this build has never heard of, because the server
 * can add one and award it before the client knows its name — see `badgeStyle()`.
 * Without that, a student holding such a badge would read "3 / 14" while only two
 * of the fourteen listed were actually theirs. Both screens call this so they
 * cannot answer the same question differently.
 */
export function badgeTotals(earned: readonly { name: string }[]): { held: number; total: number } {
  const known = new Set(BADGE_CATALOGUE.map((b) => b.name));
  const unknown = earned.filter((b) => !known.has(b.name)).length;
  return { held: earned.length, total: BADGE_CATALOGUE.length + unknown };
}

/**
 * Section headings for the gallery.
 *
 * `note` states the rule a student cannot infer from the badges themselves. The
 * mastery one matters most: mastery moves through flashcards and adaptive tests
 * ONLY (paper p. 58), so without it a student can reasonably grind games trying
 * to shift a bar that cannot move.
 */
export const BADGE_FAMILY: Record<BadgeFamily, { label: string; note?: string }> = {
  streak: { label: 'Study streak', note: 'Any study activity counts, including the chatbot.' },
  first: { label: 'First steps' },
  mastery: { label: 'Mastery', note: 'Only flashcards and adaptive tests build mastery.' },
  performance: { label: 'Performance' },
};

/** Never throws and never returns undefined — see the file header. */
export function badgeStyle(name: string): BadgeStyle {
  return (
    BADGE_STYLES[name] ?? {
      label: name,
      // Deliberately generic: the server knows what this badge is for and this
      // build does not, so anything more specific would be invented.
      description: 'A new achievement.',
      icon: Award,
      color: 'text-slate-300',
      bg: 'bg-slate-400/10',
      ring: 'border-slate-400/25',
      glow: '#94a3b8',
    }
  );
}
