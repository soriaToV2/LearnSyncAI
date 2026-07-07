import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Gamepad2, Flame, Medal } from 'lucide-react';
import clsx from 'clsx';
import { BADGES } from './gamesData';

export default function GamesLayout() {
  const [streak] = useState(5); // Static mock data for now

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Header / Stats Panel */}
      <header className="relative md:sticky md:top-0 w-full border-b border-white/10 bg-page-80 backdrop-blur-md shadow-sm z-40 px-4 md:px-8 py-5 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <Gamepad2 className="w-9 h-9 text-primary-fixed-dim mt-1 shrink-0" />
            <div>
              <h1 className="text-2xl font-display font-bold text-on-background flex items-center gap-2">
                PlayMe Games
              </h1>
              <p className="text-sm font-sans text-slate-400 mt-1">
                Reinforce course topics dynamically through interactive study games.
              </p>
            </div>
          </div>

          {/* Streak & Badges only */}
          <div className="flex items-center gap-3">
            {/* Streak pill */}
            <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/25 rounded-xl">
              <Flame className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="font-display text-sm font-bold text-white whitespace-nowrap">
                {streak} Day Streak
              </span>
            </div>

            {/* Earned badges */}
            <div className="flex items-center gap-1.5 bg-surface-container-high/40 border border-white/5 rounded-xl px-3 py-2">
              <Medal className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
              {BADGES.map(badge => (
                <div
                  key={badge.id}
                  title={badge.label}
                  className={clsx(
                    'w-7 h-7 rounded-lg flex items-center justify-center border transition-all',
                    badge.earned
                      ? `${badge.bg} ${badge.border} ${badge.color}`
                      : 'bg-white/3 border-white/5 text-slate-700 opacity-40'
                  )}
                >
                  <badge.icon className="w-3.5 h-3.5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-6xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
