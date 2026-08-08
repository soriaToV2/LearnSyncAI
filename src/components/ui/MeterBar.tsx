import { toneBg, type Tone } from './surfaces';

interface MeterBarProps {
  /**
   * 0–1, or **null for "there is no value"**.
   *
   * Never pass 0 to mean "not assessed yet": 0 asserts a measurement of zero,
   * which is a different claim from having no measurement. `null` renders the
   * empty track so a not-started row keeps the same height as its neighbours.
   */
  value: number | null;
  tone?: Tone;
  /** Accessible name, e.g. "Mastery of SQL Injection". */
  label: string;
  className?: string;
}

/**
 * The shared progress meter.
 *
 * Five hand-rolled copies of this existed before it — in `cognitiveShared`,
 * `TestResultsView`, `StudentDashboard` and both session views — all agreeing on
 * `h-1.5 rounded-full bg-white/5` and diverging on colour. This is also the first
 * consumer of `toneBg`, which had been exported and unused; `cognitiveShared`
 * inlines a ternary that is exactly `toneBg` minus `neutral`.
 *
 * `components/educator/MasteryBar.tsx` was deliberately NOT reused: it imports
 * `masteryTier` from `src/data/mockEducator.ts` and a palette whose
 * `foundational` is rose, which contradicts the student side's deliberate
 * neutral.
 */
export default function MeterBar({ value, tone = 'neutral', label, className = '' }: MeterBarProps) {
  /*
   * No value → no meter semantics. `role="meter"` without `aria-valuenow` is
   * invalid, and announcing "0" would be a lie; the adjacent "Not started" text
   * is what carries the meaning to a screen reader.
   */
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
