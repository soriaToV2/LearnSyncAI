import { Fragment } from 'react';
import Modal from '../ui/Modal';
import MeterBar from '../ui/MeterBar';
import {
  badgeStyle,
  badgeTotals,
  BADGE_CATALOGUE,
  BADGE_FAMILY,
  BADGE_FAMILY_ORDER,
  type BadgeCatalogueEntry,
} from '../../lib/badges';
import { relativeTime } from '../../lib/mastery';
import type { BadgeProgressRow, EarnedBadge } from '../../lib/dashboard';

/**
 * Every badge, earned or not (opt-in; the dashboard card shows earned only). A progress bar appears
 * only when the server sent a row for that badge. Caps its own height (Modal has no max-height); don't
 * change Modal.tsx instead.
 */

/** Locked tiles are muted: a to-do, not a failure. */
const LOCKED_CHROME = 'bg-white/[0.03] border-white/5';

export default function BadgeGalleryModal({
  isOpen,
  onClose,
  earned,
  progress,
}: {
  isOpen: boolean;
  onClose: () => void;
  earned: EarnedBadge[];
  progress: BadgeProgressRow[];
}) {
  const earnedAt = new Map(earned.map((b) => [b.name, b.awarded_at]));
  const progressByName = new Map(progress.map((p) => [p.name, p]));

  // Held badges this build doesn't know, so the "N of M" count stays honest.
  const known = new Set(BADGE_CATALOGUE.map((b) => b.name));
  const unknown = earned.filter((b) => !known.has(b.name));

  const { held, total } = badgeTotals(earned);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Badges" maxWidth="max-w-lg" noPadding>
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        {/* Sibling of the scroll box, so it never scrolls away. */}
        <div className="flex items-baseline gap-2">
          <p className="font-display text-2xl font-bold text-white tabular-nums">
            {held}
            <span className="font-sans text-sm font-medium text-slate-400 ml-1">of {total}</span>
          </p>
          <p className="font-sans text-xs text-slate-500 ml-auto">
            {held === total ? 'Every badge earned.' : 'Keep studying to unlock the rest.'}
          </p>
        </div>

        {/* no-scrollbar hides the bar but scrolling still works; keep the height cap. */}
        <div className="max-h-[calc(85vh-13rem)] overflow-y-auto no-scrollbar -mx-1 px-1 flex flex-col gap-5">
          {BADGE_FAMILY_ORDER.map((family) => {
            const rows = BADGE_CATALOGUE.filter((b) => b.family === family);
            if (rows.length === 0) return null;
            const heading = BADGE_FAMILY[family];

            return (
              <section key={family}>
                <h3 className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  {heading.label}
                </h3>
                {heading.note && (
                  <p className="font-sans text-xs text-slate-500 mt-1">{heading.note}</p>
                )}

                <ul className="flex flex-col gap-2 mt-3">
                  {rows.map((badge) => (
                    <Fragment key={badge.name}>
                      <BadgeRow
                        badge={badge}
                        awardedAt={earnedAt.get(badge.name) ?? null}
                        progress={progressByName.get(badge.name) ?? null}
                      />
                    </Fragment>
                  ))}
                </ul>
              </section>
            );
          })}

          {unknown.length > 0 && (
            <section>
              <h3 className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest">
                Other
              </h3>
              <ul className="flex flex-col gap-2 mt-3">
                {unknown.map((badge) => {
                  const style = badgeStyle(badge.name);
                  return (
                    <Fragment key={badge.name}>
                      <BadgeRow
                        badge={{ ...style, name: badge.name, family: 'first', criteria: '' }}
                        awardedAt={badge.awarded_at}
                        progress={null}
                      />
                    </Fragment>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BadgeRow({
  badge,
  awardedAt,
  progress,
}: {
  badge: BadgeCatalogueEntry;
  awardedAt: string | null;
  progress: BadgeProgressRow | null;
}) {
  const Icon = badge.icon;
  const isEarned = awardedAt !== null;

  return (
    <li
      className={`flex items-start gap-3 p-3 rounded-xl border ${
        isEarned ? `${badge.bg} ${badge.ring}` : LOCKED_CHROME
      }`}
    >
      <div
        className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
          isEarned ? `${badge.bg} ${badge.ring}` : 'bg-white/5 border-white/5'
        }`}
      >
        <Icon className={`w-4 h-4 ${isEarned ? badge.color : 'text-slate-500'}`} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`font-sans text-sm font-semibold ${isEarned ? 'text-slate-200' : 'text-slate-400'}`}
        >
          {badge.label}
        </p>

        {isEarned ? (
          <p className="font-sans text-xs text-slate-500 mt-0.5">
            Earned {relativeTime(awardedAt)}
          </p>
        ) : (
          <>
            {badge.criteria && (
              <p className="font-sans text-xs text-slate-500 mt-0.5">{badge.criteria}</p>
            )}

            {/* Neutral tone: a distance to go, not a grade. */}
            {progress && (
              <div className="flex items-center gap-2.5 mt-2">
                <MeterBar
                  value={progress.current / progress.target}
                  tone="neutral"
                  label={`Progress toward ${badge.label}`}
                  className="flex-1"
                />
                <span className="font-sans text-xs text-slate-400 tabular-nums shrink-0">
                  {progress.current} / {progress.target}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
