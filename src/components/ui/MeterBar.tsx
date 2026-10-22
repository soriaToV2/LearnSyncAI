import { toneBg, type Tone } from './surfaces';

interface MeterBarProps {
  /** 0–1, or null for "no value" (never 0 for not assessed). null renders an empty track. */
  value: number | null;
  tone?: Tone;
  /** Accessible name, e.g. "Mastery of SQL Injection". */
  label: string;
  className?: string;
}

/** The shared progress meter. Takes null for "not assessed", which a bare number can't express. */
export default function MeterBar({ value, tone = 'neutral', label, className = '' }: MeterBarProps) {
  // No value, no meter semantics (role="meter" needs aria-valuenow); adjacent text carries the meaning.
  if (value === null) {
    return (
      <div
        aria-hidden="true"
        className={`h-1.5 w-full rounded-full bg-white/5 overflow-hidden ${className}`}
      />
    );
  }

  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <div
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 w-full rounded-full bg-white/5 overflow-hidden ${className}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${toneBg[tone]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
