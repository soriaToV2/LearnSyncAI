import React, { useMemo } from 'react';

/**
 * A falling confetti burst, shared by the games and the badge modal (gameUi.tsx re-exports it; it lives
 * here so the portal bundle doesn't pull in mock data). `absolute inset-0`: needs a positioned
 * ancestor. Animation is in index.css and disabled under prefers-reduced-motion.
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
