import { Moon, Sun, SunMoon } from 'lucide-react';
import { Section } from './formKit';
import { inkOn, type ColorMode } from '../../context/ThemeContext';

/**
 * The dark / light switch, shared by all three portals' Profile pages.
 *
 * ⚠️ IT TAKES `mode` AND `onChange` AS PROPS RATHER THAN CALLING A THEME HOOK.
 * There are three hooks — `useStudentTheme`, `useEducatorTheme`,
 * `useAdminTheme` — backed by three separate contexts and three storage keys,
 * because the per-portal split is the seam this preference reopens. A component
 * that picked one of them would work in one portal and silently read the default
 * in the other two. This is the same reason `ProfileCard` takes `accent` instead
 * of reaching for a theme itself.
 *
 * ⚠️ THERE IS NO "SYSTEM" OPTION, AND ADDING ONE IS NOT A UI CHANGE. It would be
 * a third mode that has to track `prefers-color-scheme` live, decide what a
 * stored preference means once the OS disagrees with it, and re-render every
 * portal on an OS-level change. Nothing in the platform reads that media query
 * today. Two explicit states are the whole ask; a third is its own piece of work.
 */

const OPTIONS: {
  mode: ColorMode;
  label: string;
  description: string;
  icon: typeof Moon;
}[] = [
  {
    mode: 'dark',
    label: 'Dark',
    description: 'The default. Easier on the eyes for long study sessions.',
    icon: Moon,
  },
  {
    mode: 'light',
    label: 'Light',
    description: 'Higher contrast in a bright room or on a projector.',
    icon: Sun,
  },
];

export default function AppearanceCard({
  mode,
  onChange,
  accent,
  accentSoft,
}: {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
  accent: string;
  accentSoft: string;
}) {
  return (
    <Section
      icon={SunMoon}
      title="Appearance"
      description="Choose how LearnSyncAI looks on this device. The choice is saved in this browser, so it does not follow you to another computer."
    >
      {/* Stacked below `sm:` — each tile carries a sentence of explanation, and
          two of those side by side at 375px leaves ~160px per column, which
          breaks the description onto five lines. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {OPTIONS.map((option) => {
          const selected = mode === option.mode;
          const Icon = option.icon;

          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => onChange(option.mode)}
              aria-pressed={selected}
              /* The accent is a runtime value, so the selected state is inline —
                 the idiom every themed control in this codebase already uses.
                 Only the *unselected* case can live in classNames. */
              style={selected ? { borderColor: accent, backgroundColor: accentSoft } : undefined}
              className={[
                'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                'focus-visible:ring-[var(--theme-accent)]',
                selected ? '' : 'border-white/10 bg-white/[0.02] hover:bg-white/5 hover:border-white/20',
              ].join(' ')}
            >
              <span
                className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center"
                style={
                  selected
                    ? { backgroundColor: accent, color: inkOn(accent) }
                    : { backgroundColor: 'rgba(255,255,255,0.05)' }
                }
              >
                <Icon className={`w-4 h-4 ${selected ? '' : 'text-slate-300'}`} />
              </span>

              <span className="min-w-0">
                <span
                  className="block font-display text-sm font-bold text-white"
                  style={selected ? { color: accent } : undefined}
                >
                  {option.label}
                </span>
                <span className="block font-sans text-xs text-slate-400 mt-0.5 leading-relaxed">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
