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
 * Badge presentation only (labels, icons, colours); the server decides which badges exist and who
 * holds them. badgeStyle() falls back for unknown names; never index BADGE_STYLES directly.
 * The dashboard card shows earned badges only; the gallery (opt-in) also lists locked ones.
 */

export interface BadgeStyle {
  label: string;
  /** What was done to earn it (past tense), for the earned modal. Duplicates the server description. */
  description: string;
  icon: LucideIcon;
  /** Text colour; paired with `ring`. */
  color: string;
  bg: string;
  ring: string;
  /** Raw colour for the celebration halo (used in CSS color-mix()). */
  glow: string;
}

/** Mirrors BadgeFamily on the server; groups the gallery. */
export type BadgeFamily = 'streak' | 'mastery' | 'first' | 'performance';

/** How a badge looks, plus how to earn it. */
export interface BadgeCatalogueEntry extends BadgeStyle {
  /** The database identity; never changes. */
  name: string;
  family: BadgeFamily;
  /** How to earn it, imperative and present tense (unlike `description`). */
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

/** Keys mirror BADGES in server/lib/badges.ts. Labels may change; keys may not. */
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

/** Every badge this build knows, for the gallery, derived from BADGE_STYLES in BADGE_FAMILY_ORDER. */
export const BADGE_CATALOGUE: readonly BadgeCatalogueEntry[] = Object.entries(BADGE_STYLES).map(
  ([name, body]) => ({ name, ...body })
);

export const BADGE_FAMILY_ORDER: readonly BadgeFamily[] = [
  'streak',
  'first',
  'mastery',
  'performance',
];

/** The "N of M" figure for card and gallery. Counts held badges this build doesn't know yet. */
export function badgeTotals(earned: readonly { name: string }[]): { held: number; total: number } {
  const known = new Set(BADGE_CATALOGUE.map((b) => b.name));
  const unknown = earned.filter((b) => !known.has(b.name)).length;
  return { held: earned.length, total: BADGE_CATALOGUE.length + unknown };
}

/** Gallery section headings. `note` states rules a student can't infer (mastery moves only via flashcards and tests). */
export const BADGE_FAMILY: Record<BadgeFamily, { label: string; note?: string }> = {
  streak: { label: 'Study streak', note: 'Any study activity counts, including the chatbot.' },
  first: { label: 'First steps' },
  mastery: { label: 'Mastery', note: 'Only flashcards and adaptive tests build mastery.' },
  performance: { label: 'Performance' },
};

/** Never throws, never returns undefined. */
export function badgeStyle(name: string): BadgeStyle {
  return (
    BADGE_STYLES[name] ?? {
      label: name,
      // Generic on purpose: this build doesn't know what the badge is for.
      description: 'A new achievement.',
      icon: Award,
      color: 'text-slate-300',
      bg: 'bg-slate-400/10',
      ring: 'border-slate-400/25',
      glow: '#94a3b8',
    }
  );
}
