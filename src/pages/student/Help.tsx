import { useState } from 'react';
import { ChevronDown, LifeBuoy, Play } from 'lucide-react';
import { useStudentTheme } from '../../context/ThemeContext';
import { useOnboarding } from '../../context/OnboardingContext';
import { HELP_SECTIONS } from '../../lib/onboarding';

/**
 * The "How to use" page. Section intros are imported verbatim from src/lib/onboarding.ts (the same
 * strings the walkthroughs open with); only the steps are unique here. Replaying the tour clears nothing.
 */
export default function Help() {
  const { theme } = useStudentTheme();
  const { replayTour } = useOnboarding();

  // All sections start closed, and several can be open at once.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className="min-h-full">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">
        <header className="mb-7 sm:mb-8 flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: theme.accentSoft }}
          >
            <LifeBuoy className="w-5 h-5" style={{ color: theme.accent }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-on-surface truncate">
              How to use LearnSync
            </h1>
            <p className="font-sans text-sm text-on-surface-variant mt-0.5">
              Every part of the app, in plain terms. Open the one you need.
            </p>
          </div>
        </header>

        {/* First: someone confused here most likely wants the walkthrough. */}
        <button
          type="button"
          onClick={replayTour}
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
          style={{ backgroundColor: `${theme.accent}14`, borderColor: `${theme.accent}33` }}
        >
          <Play className="h-4 w-4 shrink-0" style={{ color: theme.accent }} />
          <span className="min-w-0 flex-1">
            <span className="block font-sans text-sm font-semibold text-white">
              Show me around again
            </span>
            <span className="mt-0.5 block font-sans text-xs text-slate-400">
              Takes you to your dashboard and plays the short tour again. About a minute.
            </span>
          </span>
        </button>

        <div className="flex flex-col gap-3">
          {HELP_SECTIONS.map((section) => {
            const isOpen = open.has(section.id);
            return (
              <div
                key={section.id}
                className="rounded-2xl border border-white/10 bg-surface-container-lowest/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
                >
                  <span className="font-display text-[15px] font-semibold text-white">
                    {section.title}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 fade-in">
                    <p className="font-sans text-sm leading-relaxed text-slate-300">
                      {section.intro}
                    </p>
                    <ol className="mt-3 flex flex-col gap-2">
                      {section.how.map((line, i) => (
                        <li key={line} className="flex gap-3">
                          <span
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-sans text-[11px] font-bold"
                            style={{
                              backgroundColor: theme.accentSoft,
                              color: theme.accent,
                            }}
                          >
                            {i + 1}
                          </span>
                          <span className="font-sans text-sm leading-relaxed text-slate-400">
                            {line}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Who to ask: accounts without an email have no self-service recovery. */}
        <p className="mt-8 text-center font-sans text-xs leading-relaxed text-slate-500">
          Still stuck, or cannot get into your account? Ask your teacher or the
          school administrator.
        </p>
      </div>
    </main>
  );
}
