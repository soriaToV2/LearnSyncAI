import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TOURS, type OnboardingKey } from '../lib/onboarding';
import TourOverlay from '../components/onboarding/TourOverlay';
import { useBadges } from './BadgeContext';

/**
 * Which first-run steps this student has seen. Its own context, not part of AuthContext.
 * Consumers must gate on `isLoaded` (otherwise dismissed steps flash again). Failures are swallowed.
 * The seen set is state (it drives rendering); markSeen keeps a stable identity via a functional update.
 */

interface OnboardingValue {
  /** False until the stored set has arrived. Gate every render on it. */
  isLoaded: boolean;
  hasSeen: (key: OnboardingKey) => boolean;
  /** Records a step locally and on the server. Never throws. */
  markSeen: (key: OnboardingKey) => void;
  /** Runs the dashboard tour again on demand. Clears nothing that was stored. */
  replayTour: () => void;
  /** Starts a walkthrough by key unless seen or one is running. Safe on every mount. */
  startTour: (key: OnboardingKey) => void;
  /** The anchor of the step currently showing example content, or null. Read via useTourDemo(). */
  activeDemo: string | null;
  /** True while a tour step needs the mobile menu open. Read only by StudentLayout. */
  navRequested: boolean;
}

// A working default. hasSeen defaults to true outside a provider, so nothing pops up unexpectedly.
const OnboardingContext = createContext<OnboardingValue>({
  isLoaded: false,
  hasSeen: () => true,
  markSeen: () => {},
  replayTour: () => {},
  startTour: () => {},
  activeDemo: null,
  navRequested: false,
});

/** The only route the tour starts itself on. */
const TOUR_ROUTE = '/student/dashboard';

/** Delay before the tour opens so the dashboard's cards have rendered. Missing anchors are skipped anyway. */
const TOUR_START_DELAY_MS = 900;

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [seen, setSeen] = useState<Set<OnboardingKey> | null>(null);
  /** The walkthrough on screen, or null. One at a time (two overlays would fight over Escape). */
  const [running, setRunning] = useState<OnboardingKey | null>(null);
  // Which card shows example content. Owned here because those cards sit elsewhere in the tree.
  const [activeDemo, setActiveDemo] = useState<string | null>(null);
  // Whether the mobile menu must stay open; owned here because StudentLayout is an ancestor.
  const [navRequested, setNavRequested] = useState(false);
  /** True between requesting a replay and arriving on the dashboard. */
  const [replayPending, setReplayPending] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // BadgeProvider is an ancestor; while it checks for or shows a badge, the tour waits.
  const { isCelebrating } = useBadges();

  // Auto-start fires at most once per mount.
  const autoStarted = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ seen: string[] }>('/onboarding')
      .then((res) => {
        if (cancelled) return;
        setSeen(new Set((res.data?.seen ?? []) as OnboardingKey[]));
      })
      .catch(() => {
        // An empty set on failure: at worst a dismissed step shows again.
        if (!cancelled) setSeen(new Set());
      });

    return () => {
      cancelled = true;
      if (startTimer.current) clearTimeout(startTimer.current);
    };
  }, []);

  const hasSeen = useCallback(
    (key: OnboardingKey) => (seen === null ? true : seen.has(key)),
    [seen]
  );

  const markSeen = useCallback((key: OnboardingKey) => {
    // Local first so the panel closes immediately.
    setSeen((prev) => {
      if (prev === null) return prev;
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    void api.post('/onboarding/seen', { step_key: key }).catch(() => {
      /* Swallowed: the step shows once more next session. */
    });
  }, []);

  // Replay navigates to the dashboard first: most tour steps point at dashboard cards.
  const replayTour = useCallback(() => {
    if (location.pathname === TOUR_ROUTE) {
      setRunning('tour_v1');
      return;
    }
    setReplayPending(true);
    navigate(TOUR_ROUTE);
  }, [location.pathname, navigate]);

  // Replay, part two: once on the dashboard, wait the same settle delay, then start.
  useEffect(() => {
    if (!replayPending) return;

    if (location.pathname === TOUR_ROUTE) {
      const t = setTimeout(() => {
        setReplayPending(false);
        setRunning((current) => current ?? 'tour_v1');
      }, TOUR_START_DELAY_MS);
      return () => clearTimeout(t);
    }

    // Navigation never landed: drop the request rather than leave it armed.
    const abandon = setTimeout(() => setReplayPending(false), 2000);
    return () => clearTimeout(abandon);
  }, [replayPending, location.pathname]);

  // Safe on every mount: refuses until loaded, when seen, when empty, or while another is running.
  const startTour = useCallback(
    (key: OnboardingKey) => {
      if (seen === null || seen.has(key)) return;
      if (!TOURS[key]?.length) return;
      setRunning((current) => current ?? key);
    },
    [seen]
  );

  // Auto-start the dashboard tour on first arrival. The cleanup cancels the timer on navigation;
  // autoStarted is set when the timer fires, not when armed.
  useEffect(() => {
    if (seen === null || autoStarted.current) return;
    if (location.pathname !== TOUR_ROUTE) return;
    if (seen.has('tour_v1')) return;

    startTimer.current = setTimeout(() => {
      autoStarted.current = true;
      setRunning((current) => current ?? 'tour_v1');
    }, TOUR_START_DELAY_MS);

    return () => {
      if (startTimer.current) clearTimeout(startTimer.current);
      startTimer.current = null;
    };
  }, [seen, location.pathname]);

  // Finishing and skipping both record the tour as seen; Help can replay it.
  const closeTour = useCallback(() => {
    setRunning((key) => {
      // Record whichever walkthrough was showing.
      if (key) markSeen(key);
      return null;
    });
    // Clear the example in the same tick, so no fake data stays on a real dashboard.
    setActiveDemo(null);
    // And release the mobile menu.
    setNavRequested(false);
  }, [markSeen]);

  return (
    <OnboardingContext.Provider
      value={{
        isLoaded: seen !== null,
        hasSeen,
        markSeen,
        replayTour,
        startTour,
        activeDemo,
        navRequested,
      }}
    >
      {children}
      {/* A sibling of children, as BadgeProvider mounts its modal. Held back (not dropped) while a
          badge is being checked or shown: two overlays would fight over Escape, and the spotlight
          would frame the badge window instead of the score it explains. It opens once that closes. */}
      <TourOverlay
        isOpen={running !== null && !isCelebrating}
        steps={running ? TOURS[running] ?? [] : []}
        onClose={closeTour}
        onDemoChange={setActiveDemo}
        onNavChange={setNavRequested}
      />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingValue {
  return useContext(OnboardingContext);
}

/** True while the tour spotlights this anchor and asked for an example. Otherwise render the real empty state. */
export function useTourDemo(anchor: string): boolean {
  return useContext(OnboardingContext).activeDemo === anchor;
}
