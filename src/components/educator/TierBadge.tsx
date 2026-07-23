import type { MasteryTier } from '../../data/mockEducator';

/**
 * Colour and wording for each mastery tier. Kept in one place so the badge, the
 * bar, and any chart that needs a tier colour all agree.
 *
 * Tier boundaries themselves live in masteryTier() in mockEducator.ts, which
 * mirrors the database function public.mastery_tier().
 */
export const TIER_STYLE: Record<MasteryTier, { label: string; color: string; hint: string }> = {
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
    color: '#fb7185',
    hint: 'Mastery below 50%',
  },
};

interface TierBadgeProps {
  tier: MasteryTier;
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
