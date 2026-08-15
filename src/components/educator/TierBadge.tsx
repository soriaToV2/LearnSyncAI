import type { DifficultyTier } from '../../lib/mastery';

/**
 * Colour and wording for each mastery tier. Kept in one place so the badge, the
 * bar, and any chart that needs a tier colour all agree.
 *
 * Tier boundaries themselves live in `masteryTier()` in `src/lib/mastery.ts`, which
 * mirrors `masteryTier()` in `server/lib/testDifficulty.ts` and the database
 * function `public.mastery_tier()`. The tier UNION comes from there too — it used
 * to be `MasteryTier` from `mockEducator.ts`, which meant the educator portal's
 * vocabulary was declared in a mock file.
 *
 * ⚠️ `foundational` is NEUTRAL, never rose. It was `#fb7185`, which
 * `src/components/ui/MeterBar.tsx` cites by name as the reason it refused to
 * reuse `MasteryBar`, and which contradicts `TIER_TONE.foundational = 'neutral'`
 * on the student side. The three tiers describe where a learner currently IS,
 * not how well they did: everyone starts foundational — it is the P(L₀) cold
 * start and by far the most common state during a study — so painting it red
 * marks every new student as failing at something nobody has asked them yet.
 * The two portals must not colour one number two ways.
 */
export const TIER_STYLE: Record<DifficultyTier, { label: string; color: string; hint: string }> = {
  advanced: {
    label: 'Advanced',
    color: '#34d399',
    hint: 'Mastery of 85% or higher',
  },
  intermediate: {
    label: 'Intermediate',
    color: '#fbbf24',
    hint: 'Mastery between 50% and 85%',
  },
  foundational: {
    label: 'Foundational',
    color: '#94a3b8',
    hint: 'Mastery below 50%',
  },
};

interface TierBadgeProps {
  tier: DifficultyTier;
  className?: string;
}

export default function TierBadge({ tier, className = '' }: TierBadgeProps) {
  const style = TIER_STYLE[tier];

  return (
    <span
      title={style.hint}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{
        color: style.color,
        backgroundColor: `${style.color}1a`,
        borderColor: `${style.color}40`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: style.color }} />
      {style.label}
    </span>
  );
}
