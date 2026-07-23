import { masteryTier } from '../../data/mockEducator';
import { TIER_STYLE } from './TierBadge';

interface MasteryBarProps {
  /** BKT latent mastery, 0–1. */
  mastery: number;
  /** Show the percentage next to the bar. */
  showValue?: boolean;
  /** Renders muted and greyed — used for concepts with no assessment yet. */
  muted?: boolean;
  className?: string;
}

export default function MasteryBar({
  mastery,
  showValue = true,
  muted = false,
  className = '',
}: MasteryBarProps) {
  const percent = Math.round(mastery * 100);
  const color = muted ? '#64748b' : TIER_STYLE[masteryTier(mastery)].color;

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <div
        className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[3rem]"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Mastery"
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
      {showValue && (
        <span
          className="font-sans text-xs font-semibold tabular-nums shrink-0 w-9 text-right"
          style={{ color: muted ? '#64748b' : color }}
        >
          {percent}%
        </span>
      )}
    </div>
  );
}
