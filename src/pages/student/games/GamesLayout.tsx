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
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Header / Stats Panel */}
      <header className="relative md:sticky md:top-0 w-full border-b border-white/10 bg-page-80 backdrop-blur-md z-40 px-4 md:px-8 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-on-background">PlayMe Games</h1>
              <p className="text-sm font-sans text-slate-400 mt-0.5">
                Reinforce course topics through interactive study games.
              </p>
            </div>
          </div>

          {/* Real day streak */}
          <div className="flex items-center gap-2 px-3.5 py-2 bg-orange-500/10 border border-orange-500/25 rounded-xl self-start sm:self-auto">
            <Flame className="w-4 h-4 text-orange-400 shrink-0" />
            <span className="font-display text-sm font-bold text-white whitespace-nowrap tabular-nums">
              {streak} Day{streak === 1 ? '' : 's'} Streak
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-6xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
