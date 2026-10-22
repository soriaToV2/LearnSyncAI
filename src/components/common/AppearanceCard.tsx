import { Moon, Sun, SunMoon } from 'lucide-react';
import { Section } from './formKit';
import { inkOn, type ColorMode } from '../../context/ThemeContext';

/**
 * Dark/light switch for every Profile page. Takes `mode`/`onChange` as props because each portal has
 * its own theme hook and storage key. No "system" option (that would be a third mode tracking the OS).
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
      {/* Stacked below sm: two explained tiles side by side are too narrow on a phone. */}
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
              /* The accent is runtime, so the selected state is inline; only the unselected case uses classes. */
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
