import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { EarnedBadge } from '../lib/dashboard';
import BadgeEarnedModal from '../components/student/BadgeEarnedModal';

/**
 * Notices when the student earns a badge, and celebrates it.
 *
 * ══ IT DIFFS, IT IS NOT TOLD ══
 * The obvious design is for each write endpoint to return the badges its action
 * awarded. Two things in this codebase rule that out:
 *
 *   - `FlashcardStudyView` DOES NOT AWAIT the rating. It posts and advances the
 *     card immediately, by design, so a slow network never stalls a session. A
 *     badge arriving on that response would open a modal over whatever card the
 *     student had moved on to.
 *   - `chat.routes.ts` calls `logActivity()` AFTER `res.end()`. The SSE stream is
 *     already closed, so it has nowhere to put the answer. A student keeping a
 *     streak alive through the chatbot would be the one person the feature
 *     silently skipped.
 *
 * So instead: `celebrate()` re-reads `GET /api/gamification/badges` and compares
 * against what this session has already seen. One small indexed query, at the
 * half-dozen "you just finished something" moments where a celebration belongs.
 * The write paths are untouched.
 *
 * ══ THE BASELINE IS IN-MEMORY AND SEEDED ON MOUNT ══
 * The first fetch records what the student already holds and celebrates NOTHING.
 * Without that, anyone with existing badges is ambushed on their next login —
 * and one student already holds five from before this feature existed.
 *
 * A reload re-seeds, so a badge is never celebrated twice. The gap that leaves
 * is a badge earned by the very last action before the tab closes, which is
 * never popped; it is still on the dashboard. Persisting the baseline to
 * `localStorage` would close that gap and open a worse one — clearing site data
 * would replay every badge the student has ever earned.
 *
 * ══ IT NEVER SURFACES A FAILURE ══
 * Every fetch is swallowed. A missed celebration must not put an error banner
 * over a student's results screen, and there is nothing they could do about it.
 * Same contract as `logActivity()` on the server.
 */

interface BadgeValue {
  /**
   * Check for newly earned badges and open the modal if there are any.
   *
   * Safe to call anywhere, including before the baseline has loaded — it is a
   * no-op until then, because "everything is new" is exactly the wrong answer.
   */
  celebrate: () => void;
}

const BadgeContext = createContext<BadgeValue>({ celebrate: () => {} });

/**
 * Waited BEFORE the fetch, not after it, because the delay does two jobs.
 *
 *   1. It lets a results screen finish its own entrance rather than being
 *      covered as it renders.
 *   2. IT GIVES AN IN-FLIGHT WRITE TIME TO LAND. `FlashcardStudyView` does not
 *      await the rating POST, so at the instant a session ends the last rating -
 *      the one most likely to have crossed a threshold — may still be on the
 *      wire. Fetching immediately would read the badge list from before it was
 *      awarded and celebrate nothing.
 *
 * Not a guarantee, and deliberately not made into one: a poll loop to close the
 * remaining gap would cost every student requests on every session to catch a
 * case whose failure mode is "the badge appears on the dashboard instead".
 */
const REVEAL_DELAY_MS = 600;

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<EarnedBadge[]>([]);

  /*
   * Refs, not state: `celebrate` must not change identity when the seen-set
   * updates, or every consumer's `useEffect` that depends on it re-fires and
   * checks again in a loop.
   */
  const seen = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBadges = useCallback(async (): Promise<EarnedBadge[] | null> => {
    try {
      const res = await api.get<EarnedBadge[]>('/gamification/badges');
      return res.data ?? [];
    } catch {
      return null;
    }
  }, []);

  // Seed the baseline once, on entry to the portal. Celebrates nothing.
  useEffect(() => {
    let cancelled = false;
    void fetchBadges().then((badges) => {
      if (cancelled || badges === null) return;
      seen.current = new Set(badges.map((b) => b.name));
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchBadges]);

  const celebrate = useCallback(() => {
    // No baseline yet means the seed request is still in flight or failed.
    // Treating that as "everything is new" would open a modal listing every
    // badge the student has ever held.
    if (seen.current === null || inFlight.current) return;
    inFlight.current = true;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fetchBadges()
        .then((badges) => {
          if (badges === null || seen.current === null) return;

          const fresh = badges.filter((b) => !seen.current!.has(b.name));
          // Marked seen BEFORE the modal opens, so a second checkpoint firing
          // while this one is resolving cannot queue the same badge twice.
          for (const b of fresh) seen.current.add(b.name);
          if (fresh.length === 0) return;

          // The server sends newest first; reversed, the stagger runs in the
          // order they were earned. Badges awarded by ONE action share a
          // timestamp to the millisecond, so among those the order is arbitrary
          // and only the cross-action case is genuinely ordered.
          setPending([...fresh].reverse());
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, REVEAL_DELAY_MS);
  }, [fetchBadges]);

  return (
    <BadgeContext.Provider value={{ celebrate }}>
      {children}
      <BadgeEarnedModal badges={pending} onClose={() => setPending([])} />
    </BadgeContext.Provider>
  );
}

export function useBadges(): BadgeValue {
  return useContext(BadgeContext);
}
