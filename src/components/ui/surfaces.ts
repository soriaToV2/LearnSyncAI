/** Style tokens shared by the study-space tabs (re-exported by cognitiveShared.tsx). */

/** The standard panel surface. */
export const CARD = 'bg-surface-container-lowest/40 rounded-2xl';

/** A small field label above a control or value. */
export const LABEL = 'font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider';

/** A section heading inside a panel. */
export const SECTION = 'font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest';

/** `neutral`: no direction to report (e.g. a first attempt); renders as body text. */
export type Tone = 'good' | 'mid' | 'poor' | 'neutral';

export const toneText: Record<Tone, string> = {
  good: 'text-emerald-400',
  mid: 'text-amber-400',
  poor: 'text-red-400',
  neutral: 'text-slate-300',
};

export const toneBg: Record<Tone, string> = {
  good: 'bg-emerald-400',
  mid: 'bg-amber-400',
  poor: 'bg-red-400',
  neutral: 'bg-slate-400',
};

/**
 * 0–100 → tone; the one place these thresholds live. Absolute, so right for test scores and wrong for
 * Free Recall coverage, which keeps a fixed tone. Don't wire this into it.
 */
export function scoreTone(score: number): Tone {
  return score >= 80 ? 'good' : score >= 60 ? 'mid' : 'poor';
}
