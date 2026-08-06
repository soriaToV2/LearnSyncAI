/**
 * The handful of style tokens shared by the study-space tabs.
 *
 * These lived in `cognitiveShared.tsx`, which is documented as belonging to the
 * Free Recall and Feynman tabs only. Test Mode needs the same card surface and
 * the same tone scale, and it already held a byte-identical copy of the three
 * class strings — a third copy is how two tabs stop looking like siblings.
 *
 * `cognitiveShared.tsx` re-exports everything here, so nothing that imported
 * these from there had to change.
 */

/** The standard panel surface. */
export const CARD = 'bg-surface-container-lowest/40 rounded-2xl';

/** A small field label above a control or value. */
export const LABEL = 'font-sans text-[11px] font-semibold text-slate-500 uppercase tracking-wider';

/** A section heading inside a panel. */
export const SECTION = 'font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest';

/**
 * `neutral` is the "no direction to report" tone — used where good/mid/poor
 * would each assert a judgement the data cannot support (a first attempt, a
 * change inside the measurement noise). It renders as ordinary body text.
 */
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
 * 0–100 → tone. The single place the colour thresholds live.
 *
 * These cutoffs are ABSOLUTE, which makes them right for a test score (a
 * percentage of questions answered correctly means the same thing on any
 * material) and wrong for Free Recall's coverage ratio (whose denominator is
 * however finely the document happened to be split). Free Recall pins its ring
 * to a fixed tone for exactly that reason — do not "fix" it by wiring this in.
 */
export function scoreTone(score: number): Tone {
  return score >= 80 ? 'good' : score >= 60 ? 'mid' : 'poor';
}
