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
 * ══ ONLY EARNED BADGES ARE EVER RENDERED ══
 * `GET /api/dashboard` returns what the student holds, not the catalogue. There
 * is no greyed-out "not yet earned" rail: it would need the criteria text, and a
 * wall of locked tiles on a two-week study reads as a list of things you failed
 * to do.
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
const BADGE_STYLES: Record<string, BadgeStyle> = {
  streak_3: { label: 'Getting Started', description: 'Studied three days in a row.', ...STREAK },
  streak_5: { label: 'On a Roll', description: 'Studied five days in a row.', ...STREAK },
  streak_7: { label: 'Week Warrior', description: 'Studied seven days in a row.', ...STREAK },

  first_flashcard: {
    label: 'First Review',
    description: 'Reviewed your first flashcard.',
    icon: Layers,
    ...FIRST,
  },
  first_test: {
    label: 'First Test',
    description: 'Finished your first adaptive test.',
    icon: CheckCircle2,
    ...FIRST,
  },
  first_recall: {
    label: 'First Recall',
    description: 'Completed your first free recall.',
    icon: PenLine,
    ...FIRST,
  },
  first_feynman: {
    label: 'First Explanation',
    description: 'Explained your first concept in your own words.',
    icon: Sparkles,
    ...FIRST,
  },
  first_game: {
    label: 'First Game',
    description: 'Played your first study game.',
    icon: Gamepad2,
    ...FIRST,
  },

  mastery_1: {
    label: 'First Mastery',
    description: 'Reached 85% mastery on your first concept.',
    icon: Target,
    ...MASTERY,
  },
  mastery_10: {
    label: 'Ten Mastered',
    description: 'Reached 85% mastery on ten concepts.',
    icon: BrainCircuit,
    ...MASTERY,
  },
  mastery_25: {
    label: 'Twenty-Five Mastered',
    description: 'Reached 85% mastery on twenty-five concepts.',
    icon: Award,
    ...MASTERY,
  },

  perfect_test: {
    label: 'Perfect Score',
    description: 'Answered every question on an adaptive test correctly.',
    icon: Trophy,
    ...PERFORMANCE,
  },
  flawless_game: {
    label: 'Flawless',
    description: 'Finished a study game without a single mistake.',
    icon: Zap,
    ...PERFORMANCE,
  },
  cards_100: {
    label: 'Century',
    description: 'Reviewed one hundred flashcards.',
    icon: Trophy,
    ...PERFORMANCE,
  },
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
