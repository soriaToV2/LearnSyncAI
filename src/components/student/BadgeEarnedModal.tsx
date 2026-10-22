import React from 'react';
import Modal from '../ui/Modal';
import ConfettiBurst from '../ui/ConfettiBurst';
import { badgeStyle } from '../../lib/badges';
import type { EarnedBadge } from '../../lib/dashboard';

/**
 * The badge-earned celebration: one modal listing every badge an action earned, staggered (never a
 * queue). Styling comes from badgeStyle(). Silent on purpose: it can appear anywhere, including in class.
 */

/** Stagger between medallions. */
const STAGGER_MS = 90;

export default function BadgeEarnedModal({
  badges,
  onClose,
}: {
  badges: EarnedBadge[];
  onClose: () => void;
}) {
  const isOpen = badges.length > 0;
  const many = badges.length > 1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={many ? `${badges.length} badges earned!` : 'Badge earned!'}
      maxWidth="max-w-sm"
    >
      {/* `relative` so the absolute confetti is clipped to the body. */}
      <div className="relative text-center">
        <ConfettiBurst pieces={many ? 28 : 20} />

        <div
          className={
            many
              ? 'relative flex flex-wrap items-start justify-center gap-5 pt-1'
              : 'relative flex flex-col items-center pt-1'
          }
        >
          {badges.map((badge, i) => {
            const style = badgeStyle(badge.name);
            const Icon = style.icon;
            const delay = `${i * STAGGER_MS}ms`;

            return (
              <div
                key={badge.name}
                className={many ? 'flex flex-col items-center w-24' : 'flex flex-col items-center'}
              >
                <div
                  className="relative animate-badge-pop"
                  style={{ animationDelay: delay }}
                >
                  {/* The halo; --badge-glow carries the badge's own colour to .animate-badge-glow. */}
                  <span
                    className="animate-badge-glow"
                    style={
                      {
                        animationDelay: delay,
                        ['--badge-glow' as string]: style.glow,
                      } as React.CSSProperties
                    }
                  />
                  <div
                    className={`relative ${many ? 'w-14 h-14' : 'w-20 h-20'} rounded-full border-2 flex items-center justify-center ${style.bg} ${style.ring}`}
                  >
                    <Icon className={`${many ? 'w-7 h-7' : 'w-10 h-10'} ${style.color}`} />
                  </div>
                </div>

                <p
                  className={`font-display font-bold text-white mt-3 animate-badge-pop ${many ? 'text-xs leading-tight' : 'text-lg'}`}
                  style={{ animationDelay: `${i * STAGGER_MS + 120}ms` }}
                >
                  {style.label}
                </p>

                {/* The description only when there's a single badge. */}
                {!many && (
                  <p
                    className="font-sans text-sm text-slate-400 mt-1.5 animate-badge-pop"
                    style={{ animationDelay: `${i * STAGGER_MS + 180}ms` }}
                  >
                    {style.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="relative w-full mt-7 py-2.5 rounded-xl bg-primary-fixed-dim/15 border border-primary-fixed-dim/30 font-sans text-sm font-semibold text-primary-fixed-dim hover:bg-primary-fixed-dim/25 transition-colors"
        >
          Continue
        </button>
      </div>
    </Modal>
  );
}
