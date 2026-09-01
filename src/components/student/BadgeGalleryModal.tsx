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
 * Every badge, earned and not, with what it takes to get the rest.
 *
 * ══ THIS IS THE OPT-IN EXCEPTION, AND THE CONSENT IS THE POINT ══
 * The dashboard card still shows earned badges only, because a permanent rail of
 * grey tiles on a two-week study reads as a list of things you failed to do.
 * A student opening this has asked the opposite question. See `src/lib/badges.ts`.
 *
 * ══ A BAR IS DRAWN IFF THE SERVER SENT A ROW FOR IT ══
 * `badge_progress` covers only the countable rules — streaks, mastery counts and
 * `cards_100`. `first_*` is a single act and `perfect_test`/`flawless_game` are
 * outcomes of one session, so they have no partial state and get criteria text
 * alone. This component never decides which is which; the server's own rule table
 * does, which is what stops a "0 / 1" bar from appearing next to "Play any study
 * game".
 *
 * ══ IT MUST CAP ITS OWN HEIGHT ══
 * `Modal` has no max-height and its wrapper centres with `items-center`, so a
 * fourteen-row list overflows BOTH edges — the top rows unreachable above the
 * viewport with nothing to scroll. Same defect `ImportAccountsModal` works
 * around. The scroll box is capped here and the summary line is its SIBLING so it
 * stays pinned. Do not fix this by giving `Modal.tsx` a max-height; a dozen other
 * call sites depend on its current sizing.
 */

/** Locked tiles are muted, never alarming — this is a to-do, not a failure. */
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

  /*
   * Badges the student holds that this build has never heard of — the server can
   * add one and award it before the client knows its name, which `badgeStyle()`
   * is already built for. Listing them keeps the "N of M" count honest rather
   * than silently dropping a badge the student can see on their dashboard.
   */
  const known = new Set(BADGE_CATALOGUE.map((b) => b.name));
  const unknown = earned.filter((b) => !known.has(b.name));

  const { held, total } = badgeTotals(earned);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Badges" maxWidth="max-w-lg" noPadding>
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        {/* Sibling of the scroll box below, so it never scrolls away. */}
        <div className="flex items-baseline gap-2">
          <p className="font-display text-2xl font-bold text-white tabular-nums">
            {held}
            <span className="font-sans text-sm font-medium text-slate-400 ml-1">of {total}</span>
          </p>
          <p className="font-sans text-xs text-slate-500 ml-auto">
            {held === total ? 'Every badge earned.' : 'Keep studying to unlock the rest.'}
          </p>
        </div>

        {/* `no-scrollbar` hides the bar, it does NOT stop scrolling — wheel,
            touch and keyboard all still work, and the cap must stay. Removing the
            scroll box itself would put the top rows above the viewport with no
            way to reach them, which is the `Modal` defect noted above. */}
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

            {/* `tone="neutral"`, never a score tone. This is a distance still to
                go, not a grade — colouring it would read as a mark out of N. */}
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
