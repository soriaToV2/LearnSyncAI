import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { EarnedBadge } from '../lib/dashboard';
import BadgeEarnedModal from '../components/student/BadgeEarnedModal';

/**
 * Celebrates newly earned badges by diffing GET /gamification/badges against what this session has
 * seen (write endpoints can't return them: flashcard ratings aren't awaited, chat logs after the stream).
 * The baseline is in-memory, seeded on mount, and celebrates nothing. Failures are swallowed.
 */

interface BadgeValue {
  /** Check for new badges and open the modal. A no-op until the baseline has loaded. */
  celebrate: () => void;
  /**
   * True from a celebrate() call until its check finds nothing new, or until the modal is closed.
   * OnboardingProvider holds a tour back on it: a result screen calls celebrate() and starts its tour
   * in the same moment, and the two overlays used to open on top of each other.
   */
  isCelebrating: boolean;
}

const BadgeContext = createContext<BadgeValue>({ celebrate: () => {}, isCelebrating: false });

/** Delay before fetching, so the results screen settles and the last un-awaited rating can land. */
const REVEAL_DELAY_MS = 600;

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<EarnedBadge[]>([]);
  // State (not the inFlight ref) because a tour re-renders on it.
  const [checking, setChecking] = useState(false);

  // Refs, not state, so `celebrate` keeps a stable identity.
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

  // Seed the baseline once; celebrates nothing.
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
    // No baseline yet: do nothing rather than treat everything as new.
    if (seen.current === null || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fetchBadges()
        .then((badges) => {
          if (badges === null || seen.current === null) return;

          const fresh = badges.filter((b) => !seen.current!.has(b.name));
          // Mark seen before opening so a concurrent check can't queue the same badge.
          for (const b of fresh) seen.current.add(b.name);
          if (fresh.length === 0) return;

          // Reverse the server's newest-first order so badges appear in the order earned.
          setPending([...fresh].reverse());
        })
        .finally(() => {
          inFlight.current = false;
          // After setPending above, so isCelebrating never dips between the check and the modal.
          setChecking(false);
        });
    }, REVEAL_DELAY_MS);
  }, [fetchBadges]);

  return (
    <BadgeContext.Provider value={{ celebrate, isCelebrating: checking || pending.length > 0 }}>
      {children}
      <BadgeEarnedModal badges={pending} onClose={() => setPending([])} />
    </BadgeContext.Provider>
  );
}

export function useBadges(): BadgeValue {
  return useContext(BadgeContext);
}
