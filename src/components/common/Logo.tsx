import type { CSSProperties } from 'react';

/**
 * The LearnSyncAI mark.
 *
 * ══ WHAT IT DRAWS, AND WHY IT IS THIS AND NOT SOMETHING ELSE ══
 *
 * A BKT mastery curve: three elements, each one a real property of the engine
 * this platform is built on.
 *
 *   1. THE CURVE — concave, steep early and flattening late. That is the actual
 *      shape of `P(L)` under the four-parameter update in `server/lib/bkt.ts`:
 *      a learner starting at P(L₀) = 0.10 gains fastest on their first correct
 *      observations and less with each one after.
 *   2. THE DOT at its end — the learner's current mastery, the value stored in
 *      `bkt_mastery.latent_mastery`. Filled rather than stroked, because it is
 *      the one measured point on an otherwise inferred line.
 *   3. THE RULE above it — the ceiling. Mastery is clamped to `1 − 1e-9` and
 *      continuous BKT asymptotes but never arrives, so the curve deliberately
 *      does not touch it. Drawn at 40% so it reads as a limit rather than as a
 *      second stroke of equal weight.
 *
 * ⚠️ THE GEOMETRY IS EXACT, AND A HAND-DRAWN VERSION WAS TRIED AND REVERTED.
 * It carried deliberate irregularities — an off-level ceiling, overshot ends, a
 * two-segment curve with a visible join, a rotated ellipse for the dot — to make
 * the mark read as crafted rather than generated. It was dropped on 2026-08-28.
 * If the idea comes back, note what made it hard: every classic hand-drawn
 * device (varying stroke weight, textured edges, grain) is invisible below about
 * 32px, so the wobble has to live in the path itself, and at 20px a wobble large
 * enough to notice is also large enough to look like a mistake.
 *
 * ⚠️ IT IS BUILT ON LUCIDE'S GRID ON PURPOSE — 24×24 viewBox, 2px stroke, round
 * caps and joins, `currentColor`. This glyph sits directly above nav items that
 * are all Lucide icons at that exact weight, and it replaces `BrainCircuit` in
 * every slot it previously filled. A filled mark, a different stroke width, or a
 * different grid would read as a foreign object pasted into the sidebar. If you
 * redraw it, keep those four properties.
 *
 * ⚠️ `currentColor`, NEVER A LITERAL. Every call site tints it by passing
 * `style={{ color: theme.accent }}`, which is what lets one mark serve the dark
 * palette, the light palette and all six unused theme palettes without a second
 * asset. The one place a literal is unavoidable is `public/favicon.svg`, which
 * the browser renders outside the document and so cannot inherit anything —
 * keep the two in sync by hand if the geometry ever changes.
 *
 * ⚠️ `aria-hidden`, ALWAYS. The mark never carries the product name on its own:
 * every lockup in the app pairs it with a visible "LearnSyncAI" text node, so
 * announcing it would make a screen reader say the name twice. The favicon and
 * the `<title>` cover the tab.
 */
export default function Logo({
  className = 'w-6 h-6',
  style,
}: {
  className?: string;
  /** How every call site tints the mark — `{ color: theme.accent }`. The SVG
   *  strokes in `currentColor`, so this is the whole theming mechanism. */
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {/* The ceiling the curve approaches and never reaches. */}
      <path d="M12.5 3H21" opacity={0.4} />
      {/* P(L) rising from the prior — fast first, then flattening. */}
      <path d="M3 20.5C5.5 13 9.5 9 19.5 7.5" />
      {/* Current mastery. Filled, and `stroke="none"` so the 2px stroke above
          does not thicken it into a blob at 20px. */}
      <circle cx="19.5" cy="7.5" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
