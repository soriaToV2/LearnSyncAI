import React, { useMemo } from 'react';

/**
 * A falling confetti burst.
 *
 * ══ WHY IT LIVES HERE AND NOT IN `games/gameUi.tsx` ══
 * It was written for the games and used by three of them, and it stayed there
 * until the badge-earned modal needed the same effect. Importing it from
 * `gameUi.tsx` would have pulled `MOCK_COURSES` and the whole `gamesData` module
 * into every bundle that loads the student portal — `gameUi.tsx` is the last
 * reader of the last mock data left in the tree.
 *
 * Same lift `surfaces.ts` got out of `cognitiveShared.tsx` and
 * `reviewSchedule.ts` got out of `FlashcardsTab`: when a second consumer
 * appears, the utility moves up rather than being copied. `gameUi.tsx`
 * re-exports it, so its existing usages are unchanged.
 *
 * ══ POSITIONING ══
 * `absolute inset-0`, so it needs a positioned ancestor and is clipped to it.
 * That is deliberate — inside `Modal`'s panel (already `relative
 * overflow-hidden`) the confetti falls within the card rather than over the
 * whole viewport.
 *
 * The animation itself is `.game-confetti` / `@keyframes gameConfettiFall` in
 * `index.css`, which the `prefers-reduced-motion` block there already disables.
 */

const CONFETTI_COLORS = ['#22d3ee', '#fbbf24', '#34d399', '#a78bfa', '#fb7185'];

export default function ConfettiBurst({ pieces = 20 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.45,
        duration: 1.6 + Math.random() * 0.9,
        size: 5 + Math.random() * 5,
        rotate: Math.random() * 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [pieces]
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p) => (
        <span
          key={p.id}
          className="game-confetti"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              ['--confetti-rotate' as string]: `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
