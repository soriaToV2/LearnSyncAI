import type { DifficultyTier } from '../../lib/mastery';

/**
 * Colour and wording per mastery tier, shared by badge, bar and charts. Thresholds come from
 * masteryTier() in src/lib/mastery.ts. `foundational` is neutral, never red: everyone starts there.
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
