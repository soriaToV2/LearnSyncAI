import type { CSSProperties } from 'react';

/**
 * The LearnSyncAI mark: a BKT mastery curve (concave rise from P(L₀)), a dot for current mastery, and
 * a ceiling rule the curve never reaches.
 * Built on Lucide's grid (24×24, 2px round strokes) to match the nav icons. Uses currentColor; keep
 * public/favicon.svg (a literal colour) in sync by hand. Always aria-hidden: it's paired with visible text.
 */
export default function Logo({
  className = 'w-6 h-6',
  style,
}: {
  className?: string;
/** Tint via `{ color: theme.accent }`; the SVG strokes in currentColor. */
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
      {/* Current mastery. stroke="none" so the stroke doesn't blob it at small sizes. */}
      <circle cx="19.5" cy="7.5" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
