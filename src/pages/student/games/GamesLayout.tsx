import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Gamepad2, Flame } from 'lucide-react';
import { api } from '../../../lib/api';

interface GamificationProfile {
  day_streak: number;
}

export default function GamesLayout() {
  const location = useLocation();
  const [profile, setProfile] = useState<GamificationProfile | null>(null);

  // Fetch the real day streak, and refresh on navigation so a game just played
  // (which logs a session and bumps the streak via a DB trigger) is reflected.
  useEffect(() => {
    let cancelled = false;
    api
      .get<GamificationProfile>('/gamification/profile')
      .then((res) => {
        if (!cancelled) setProfile(res.data);
      })
      .catch(() => {
        /* header stats are non-critical — leave at defaults on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const streak = profile?.day_streak ?? 0;

  return (
    /*
     * ⚠️ NO `min-h-screen` HERE. `StudentLayout`'s content wrapper is already
     * `min-h-screen pt-16 md:pt-0`, so on mobile its content box is 100vh MINUS
     * the 64px app bar. A second `min-h-screen` inside that forced a full 100vh
     * into the shorter box, so every games page scrolled by exactly 64px with
     * dead space at the bottom. `flex-1` alone fills the parent correctly at
     * every width, with no constant to drift.
     *
     * This is the same double-count `StudySpace` had, but NOT the same fix.
     * There the root needs a DEFINITE height because its `<main>` is
     * `overflow-y-auto`, so it takes `h-[calc(100vh-4rem)] md:h-screen`. Here the
     * document scrolls, so no definite height is needed and none should be
     * invented.
     */
    <div className="flex-1 flex flex-col">
      {/* Header / Stats Panel */}
      <header className="relative md:sticky md:top-0 w-full border-b border-white/10 bg-page-80 backdrop-blur-md z-40 px-4 sm:px-6 md:px-8 py-4 sm:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-display font-bold text-on-background">PlayMe Games</h1>
              <p className="text-sm font-sans text-slate-400 mt-0.5">
                Reinforce course topics through interactive study games.
              </p>
            </div>
          </div>

          {/* Real day streak.
              ⚠️ RENDERED ONLY ONCE THE FETCH HAS LANDED. `streak` falls back to 0,
              and printing that before the request resolves — or after it fails,
              which the catch below deliberately tolerates — states "0 Days Streak"
              to a student who may be on a five-day run. Absence says nothing;
              a zero says something false. Same rule as `ProfileCard`, which holds
              its status pill back until the profile has loaded, and the same
              reason Analytics never prints an unassessed concept's P(L₀). */}
          {/* `animate-tab-in` because this element does not exist until the
              fetch lands — it is the same "content arrives after a wait" case
              as every list on the page below it, just a one-element version, and
              without it the pill simply pops into the header.

              It fires ONCE, which is what is wanted: the effect refetches on
              every navigation inside Games, but `profile` is only ever replaced,
              never cleared back to null, so the element is never unmounted and
              the animation does not repeat on each page change. */}
          {profile && (
            <div className="flex items-center gap-2 px-3.5 py-2 bg-orange-500/10 border border-orange-500/25 rounded-xl self-start sm:self-auto shrink-0 animate-tab-in">
              <Flame className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="font-display text-sm font-bold text-white whitespace-nowrap tabular-nums">
                {streak} Day{streak === 1 ? '' : 's'} Streak
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto max-w-6xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
