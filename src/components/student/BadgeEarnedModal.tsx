import React from 'react';
import Modal from '../ui/Modal';
import ConfettiBurst from '../ui/ConfettiBurst';
import { badgeStyle } from '../../lib/badges';
import type { EarnedBadge } from '../../lib/dashboard';

/**
 * The badge-earned celebration.
 *
 * ══ ONE MODAL, EVERY BADGE THAT ACTION EARNED ══
 * Finishing a game on a three-day streak awards Getting Started, First Game and
 * Flawless at once. A queue of three dialogs turns a reward into a chore to
 * click through, and a student clicking fast would never read the third. They
 * stagger in instead, which keeps the ceremony without costing a click.
 *
 * ══ NOTHING IS DESIGNED PER BADGE ══
 * The icon, colour and label all come from `badgeStyle()`, the same lookup the
 * dashboard chips use — the medallion is that icon at size. So a badge added
 * server-side needs no work here, and `badgeStyle()`'s fallback means one this
 * client has never heard of still renders rather than crashing.
 *
 * ══ SILENT ══
 * No audio, deliberately. This modal can appear anywhere in the portal —
 * mid-flashcard-session, after a Feynman submission — and an unexpected fanfare
 * in a classroom is startling. The games are opt-in and self-contained, which is
 * why they may have sound and this may not.
 *
 * Built on `Modal`, which already provides the portal, Escape, backdrop-click,
 * body scroll lock and z-index — so all three dismissal routes are one `onClose`.
 * Its documented max-height defect does not apply: the content is at most a few
 * medallions and never approaches the fold.
 */

/** Stagger between medallions. Enough to read as a sequence, not as a wait. */
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
      {/* `relative` so the confetti, which is `absolute inset-0`, is clipped to
          the body rather than escaping over the whole page. */}
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
                  {/* The halo. `--badge-glow` is read by `.animate-badge-glow`
                      in index.css, so the colour comes from the badge's own
                      palette instead of being hardcoded per family here. */}
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

                {/* The description only earns its space when there is one badge.
                    Three of them side by side is a wall of text over confetti. */}
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
