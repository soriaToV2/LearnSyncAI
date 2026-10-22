import React, { createContext, useContext, useCallback, useState } from 'react';

/**
 * Dark/light mode only. Just THEMES[0] (dark) and `white` (light) are reachable, because only they have
 * stylesheet support in index.css. Keep the other palettes in the array: applyThemeToElement() uses them.
 * Storage keys are `…_mode`; old `…_theme` values are never read.
 */
export interface ThemeDefinition {
  id: string;
  label: string;
  accent: string;
  accentDim: string;
  accentSoft: string;
  glow: string;
  pageBg: string;
  surfaceDeep: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'cyan',
    label: 'Cyber Cyan',
    accent: '#22d3ee',
    accentDim: '#00daf3',
    accentSoft: 'rgba(34,211,238,0.1)',
    glow: 'rgba(34,211,238,0.25)',
    pageBg: '#020617',
    surfaceDeep: '#080f1e',
  },
  {
    id: 'indigo',
    label: 'Deep Indigo',
    accent: '#818cf8',
    accentDim: '#6366f1',
    accentSoft: 'rgba(129,140,248,0.1)',
    glow: 'rgba(129,140,248,0.25)',
    pageBg: '#02040f',
    surfaceDeep: '#06091a',
  },
  {
    id: 'violet',
    label: 'Neon Violet',
    accent: '#a78bfa',
    accentDim: '#7c3aed',
    accentSoft: 'rgba(167,139,250,0.1)',
    glow: 'rgba(167,139,250,0.25)',
    pageBg: '#050212',
    surfaceDeep: '#0d0820',
  },
  {
    id: 'emerald',
    label: 'Matrix Emerald',
    accent: '#34d399',
    accentDim: '#10b981',
    accentSoft: 'rgba(52,211,153,0.1)',
    glow: 'rgba(52,211,153,0.25)',
    pageBg: '#020d0a',
    surfaceDeep: '#051510',
  },
  {
    id: 'rose',
    label: 'Neon Rose',
    accent: '#fb7185',
    accentDim: '#f43f5e',
    accentSoft: 'rgba(251,113,133,0.1)',
    glow: 'rgba(251,113,133,0.25)',
    pageBg: '#0d0208',
    surfaceDeep: '#180510',
  },
  {
    id: 'amber',
    label: 'Solar Amber',
    accent: '#fbbf24',
    accentDim: '#f59e0b',
    accentSoft: 'rgba(251,191,36,0.1)',
    glow: 'rgba(251,191,36,0.25)',
    pageBg: '#0d0800',
    surfaceDeep: '#1a1200',
  },
  {
    id: 'white',
    label: 'Studio White',
    accent: '#0284c7',
    accentDim: '#0369a1',
    accentSoft: 'rgba(2,132,199,0.1)',
    glow: 'rgba(2,132,199,0.2)',
    pageBg: '#eef2f6',
    surfaceDeep: '#ffffff',
  },
];

/** The default (dark) theme. */
export const ACTIVE_THEME = THEMES[0];

/** The two reachable themes; ACTIVE_THEME is the default. */
export const DARK_THEME = THEMES[0];
export const LIGHT_THEME = THEMES.find((t) => t.id === 'white')!;

export type ColorMode = 'dark' | 'light';

/**
 * Text/icon colour that reads on an `accent` background, computed from WCAG relative luminance
 * (a fixed dark ink fails contrast on the light theme's dark-blue accent). 0.45 leans toward dark ink.
 */
export function inkOn(accent: string): string {
  const hex = accent.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  // Unparseable colours keep the dark ink.
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#04121a';

  const channel = (offset: number) => {
    const v = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? '#04121a' : '#ffffff';
}

export const themeForMode = (mode: ColorMode) => (mode === 'light' ? LIGHT_THEME : DARK_THEME);

// Storage access is wrapped: localStorage throws in Safari private windows and some managed browsers.
function readMode(key: string, fallback: ColorMode): ColorMode {
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark') return stored;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeMode(key: string, mode: ColorMode) {
  try {
    localStorage.setItem(key, mode);
  } catch {
    /* Not persisted this session; the toggle still works. */
  }
}

/**
 * Sets data-theme on documentElement as well as the wrapper: modals render in a portal outside the
 * wrapper, and the `:root[data-theme="white"]` rules in index.css need it on <html>.
 */
export function applyThemeToElement(t: ThemeDefinition, el: HTMLElement) {
  if (typeof document !== 'undefined' && document.documentElement !== el) {
    applyThemeVars(t, document.documentElement);
  }
  applyThemeVars(t, el);
}

function applyThemeVars(t: ThemeDefinition, el: HTMLElement) {
  el.dataset.theme = t.id;
  el.style.setProperty('--theme-accent', t.accent);
  el.style.setProperty('--theme-accent-dim', t.accentDim);
  el.style.setProperty('--theme-accent-soft', t.accentSoft);
  el.style.setProperty('--theme-glow', t.glow);
  el.style.setProperty('--page-bg', t.pageBg);
  el.style.setProperty('--page-surface-deep', t.surfaceDeep);
  el.style.setProperty('--color-primary-fixed-dim', t.accentDim);
  el.style.setProperty('--color-surface-tint', t.accentDim);
  el.style.setProperty('--color-primary-container', t.accent);
}

// Consumers can only ask for dark or light.
interface ThemeContextValue {
  theme: ThemeDefinition;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
}

/**
 * Mode state per storage key (one per portal). Seeded in the initialiser, not an effect, so there's
 * no dark flash on load. It's local state, not a subscription: wrap it in a provider to share.
 * `fallback` applies only when nothing is stored.
 */
export function useColorMode(
  storageKey: string,
  fallback: ColorMode = 'dark'
): ThemeContextValue {
  const [mode, setModeState] = useState<ColorMode>(() => readMode(storageKey, fallback));

  const setMode = useCallback(
    (next: ColorMode) => {
      setModeState(next);
      writeMode(storageKey, next);
    },
    [storageKey]
  );

  return { theme: themeForMode(mode), mode, setMode };
}

const DEFAULT_VALUE: ThemeContextValue = {
  theme: ACTIVE_THEME,
  mode: 'dark',
  setMode: () => {},
};

const StudentThemeContext = createContext<ThemeContextValue>(DEFAULT_VALUE);
const EducatorThemeContext = createContext<ThemeContextValue>(DEFAULT_VALUE);

export function StudentThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useColorMode('learnsyncai_student_mode');
  return <StudentThemeContext.Provider value={value}>{children}</StudentThemeContext.Provider>;
}

export function useStudentTheme() {
  return useContext(StudentThemeContext);
}

export function EducatorThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useColorMode('learnsyncai_educator_mode');
  return <EducatorThemeContext.Provider value={value}>{children}</EducatorThemeContext.Provider>;
}

export function useEducatorTheme() {
  return useContext(EducatorThemeContext);
}

const AdminThemeContext = createContext<ThemeContextValue>(DEFAULT_VALUE);

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useColorMode('learnsyncai_admin_mode');
  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme() {
  return useContext(AdminThemeContext);
}
