import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TOURS, type OnboardingKey } from '../lib/onboarding';
import TourOverlay from '../components/onboarding/TourOverlay';

/**
 * Which first-run steps this student has already been shown.
 *
 * ══ WHY IT IS ITS OWN CONTEXT ══
 * `SubjectsContext.tsx` and `AuthContext.tsx` both state the rule this follows:
 * "a context that accumulates 'things several screens happen to need' becomes a
 * second, invisible data layer with its own staleness rules." Onboarding is read
 * by the tour, by six study tabs and by the Help page, so it is exactly the kind
 * of thing that would otherwise be bolted onto `AuthContext`.
 *
 * ══ ⚠️ NOTHING RENDERS UNTIL THE SET HAS LOADED ══
 * `isLoaded` is not a spinner flag — it is a correctness guard. Treating "not
 * loaded yet" as "not seen" would flash the tour, or all six tool panels, at a
 * student who dismissed them last week, every single time they open the app.
 * Every consumer must check it. The one exception is a deliberate replay from
 * the Help page, which ignores the stored set by design.
 *
 * ══ ⚠️ IT NEVER SURFACES A FAILURE ══
 * Every request is swallowed, the same contract `BadgeContext` and the server's
 * `logActivity()` keep. The worst a failed read or write can do is show a step
 * twice; an error banner over a student's dashboard because a tour could not be
 * recorded would be worse than the thing it reports.
 *
 * ══ SEEN-SET IS STATE, NOT A REF ══
 * This is the one place it deliberately differs from `BadgeContext`, which holds
 * its baseline in a `useRef` so `celebrate` keeps a stable identity. Here the
 * answer to `hasSeen` decides what is RENDERED, so it has to be state or a
 * dismissed panel would stay on screen. `markSeen` still keeps a stable identity
 * by using a functional update, so consumers' effects do not re-fire.
 */

interface OnboardingValue {
  /** False until the stored set has arrived. Gate every render on it. */
  isLoaded: boolean;
  hasSeen: (key: OnboardingKey) => boolean;
  /** Records a step locally and on the server. Fire-and-forget; never throws. */
  markSeen: (key: OnboardingKey) => void;
  /** Runs the dashboard tour again on demand. Clears nothing that was stored. */
  replayTour: () => void;
  /**
   * Start a walkthrough by key, if it has one in `TOURS` and is not already
   * running. Safe to call on every mount — it is a no-op once seen.
   */
  startTour: (key: OnboardingKey) => void;
  /**
   * The `data-tour` anchor of the step currently asking for example content, or
   * null. Read it through `useTourDemo()` rather than directly.
   */
  activeDemo: string | null;
}

/*
 * A real working default, like all four existing contexts — none of them throws
 * "used outside provider".
 *
 * ⚠️ `hasSeen` DEFAULTS TO TRUE, NOT FALSE. Outside a provider the honest answer
 * is "we cannot know", and of the two guesses, showing nothing is the safe one:
 * a stray consumer rendered in the educator portal would otherwise pop a student
 * tour over it.
 */
const OnboardingContext = createContext<OnboardingValue>({
  isLoaded: false,
  hasSeen: () => true,
  markSeen: () => {},
  replayTour: () => {},
  startTour: () => {},
  activeDemo: null,
});

/** The only route the first-run tour starts itself on. */
const TOUR_ROUTE = '/student/dashboard';

/**
 * Waited before the tour opens, for the same reason `BadgeContext` waits before
 * it fetches: the dashboard is still resolving `GET /api/dashboard` at the
 * moment this mounts, so the cards half the tour points at are not in the DOM
 * yet. Used by both the auto-start and the replay-from-Help path.
 *
 * It is not a guarantee, and does not need to be. `TourOverlay` hunts for a
 * missing anchor for a short while and then skips that step, so the worst a slow
 * network costs is one step rather than a tour pointing at nothing.
 */
const TOUR_START_DELAY_MS = 900;

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [seen, setSeen] = useState<Set<OnboardingKey> | null>(null);
  /**
   * Which walkthrough is on screen, or null. One at a time, deliberately: two
   * overlays would both bind Escape and fight over the same spotlight.
   */
  const [running, setRunning] = useState<OnboardingKey | null>(null);
  /*
   * Which card, if any, should show example content right now. Owned here rather
   * than inside `TourOverlay` because the cards that render the example are
   * anywhere in the tree below, and the overlay is a sibling of them.
   */
  const [activeDemo, setActiveDemo] = useState<string | null>(null);
  /**
   * True between asking for a replay and arriving on the dashboard. The tour
   * cannot start until the route it describes is the one on screen.
   */
  const [replayPending, setReplayPending] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  /*
   * The auto-start fires at most once per mount. Without this, dismissing the
   * tour and navigating back to the dashboard would reopen it in the window
   * before the POST lands — and refusing to re-arm is also what makes a replay
   * from Help feel deliberate rather than sticky.
   */
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
        /*
         * An empty set, not a null one. A student whose progress could not be
         * read still gets a working portal; they may see a panel they had
         * already dismissed, which is the mildest possible failure and far
         * better than every first-run explanation being suppressed by a blip.
         */
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
    // Local first, so the panel closes immediately rather than after a round
    // trip. The functional update is what keeps this callback's identity stable.
    setSeen((prev) => {
      if (prev === null) return prev;
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    void api.post('/onboarding/seen', { step_key: key }).catch(() => {
      /* Swallowed: the student sees this step once more next session. */
    });
  }, []);

  /*
   * ⚠️ REPLAY NAVIGATES TO THE DASHBOARD FIRST, AND THAT IS THE WHOLE FIX.
   *
   * `tour_v1` is ABOUT the dashboard: five of its ten steps point at cards that
   * exist nowhere else. Started from the Help page it showed the three sidebar
   * steps, then hunted for those five one after another, then jumped to Games —
   * which a student experiences as the tour freezing after the third card and
   * coming back seconds later on the wrong topic.
   *
   * Skipping absent steps is still the right safety net; it is just the wrong
   * answer here, because the steps are not absent, the student is simply on the
   * wrong page. So take them to the right one.
   */
  const replayTour = useCallback(() => {
    if (location.pathname === TOUR_ROUTE) {
      setRunning('tour_v1');
      return;
    }
    setReplayPending(true);
    navigate(TOUR_ROUTE);
  }, [location.pathname, navigate]);

  /*
   * The second half of the replay: wait for the dashboard to actually be the
   * current route, then give it the same settle delay the auto-start uses so its
   * fetch can land before the spotlight starts looking for cards.
   */
  useEffect(() => {
    if (!replayPending) return;

    if (location.pathname === TOUR_ROUTE) {
      const t = setTimeout(() => {
        setReplayPending(false);
        setRunning((current) => current ?? 'tour_v1');
      }, TOUR_START_DELAY_MS);
      return () => clearTimeout(t);
    }

    /*
     * Not there yet. Normally that is a single render, but if the navigation
     * never lands — the student taps something else on the way — the request
     * must be dropped rather than left armed to ambush them on a later visit to
     * the dashboard.
     */
    const abandon = setTimeout(() => setReplayPending(false), 2000);
    return () => clearTimeout(abandon);
  }, [replayPending, location.pathname]);

  /*
   * ⚠️ SAFE TO CALL ON EVERY MOUNT, which is what lets a tab just say "start my
   * walkthrough" without tracking whether it already did. It refuses when the
   * set has not loaded (treating that as "not seen" would replay a walkthrough a
   * student finished last week), when the key is already recorded, when it has
   * no steps, and when anything is already running — the last one matters
   * because switching tabs mid-walkthrough would otherwise hijack the overlay.
   */
  const startTour = useCallback(
    (key: OnboardingKey) => {
      if (seen === null || seen.has(key)) return;
      if (!TOURS[key]?.length) return;
      setRunning((current) => current ?? key);
    },
    [seen]
  );

  /*
   * Auto-start the dashboard tour on first arrival, once the set is known.
   *
   * ⚠️ THE CLEANUP IS THE BUG FIX. This effect had none, so the pending timer
   * survived navigation: a student who reached the dashboard and clicked through
   * to a study space inside the delay window got the DASHBOARD tour opening on
   * the study-space page, spotlighting the sidebar while its dashboard steps
   * pointed at cards that were not there.
   *
   * `autoStarted` is also set when the timer FIRES rather than when it is armed.
   * Setting it up front meant a cancelled run counted as a run, and the tour
   * could never open again for that session.
   */
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

  /*
   * Finishing and skipping are the same action. A student who skips has decided
   * they do not want it, and showing it again on their next login would read as
   * the app ignoring them — the replay button on Help is how they get it back.
   */
  const closeTour = useCallback(() => {
    setRunning((key) => {
      // Whichever walkthrough was on screen is the one now recorded as seen.
      if (key) markSeen(key);
      return null;
    });
    // ⚠️ Clear the example the same tick the tour closes. Leaving it set would
    // strand fake badges on a real dashboard, which is the one outcome the whole
    // demo design exists to prevent.
    setActiveDemo(null);
  }, [markSeen]);

  return (
    <OnboardingContext.Provider
      value={{ isLoaded: seen !== null, hasSeen, markSeen, replayTour, startTour, activeDemo }}
    >
      {children}
      {/* A sibling of `children`, exactly as `BadgeProvider` mounts its modal. */}
      <TourOverlay
        isOpen={running !== null}
        steps={running ? TOURS[running] ?? [] : []}
        onClose={closeTour}
        onDemoChange={setActiveDemo}
      />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingValue {
  return useContext(OnboardingContext);
}

/**
 * True while the tour is spotlighting this anchor AND that step asked for
 * example content.
 *
 * ⚠️ A CARD USING THIS MUST STILL RENDER ITS HONEST EMPTY STATE WHEN IT IS
 * FALSE, and must label the example when it is true. The example is a
 * demonstration attached to an explanation, not a placeholder — see the `DEMO_*`
 * header in `src/lib/onboarding.ts`.
 */
export function useTourDemo(anchor: string): boolean {
  return useContext(OnboardingContext).activeDemo === anchor;
}
