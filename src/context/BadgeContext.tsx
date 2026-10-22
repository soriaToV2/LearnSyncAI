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
}

const BadgeContext = createContext<BadgeValue>({ celebrate: () => {} });

/** Delay before fetching, so the results screen settles and the last un-awaited rating can land. */
const REVEAL_DELAY_MS = 600;

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<EarnedBadge[]>([]);

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
