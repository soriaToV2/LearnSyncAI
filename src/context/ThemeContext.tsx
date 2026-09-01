import React, { createContext, useContext, useCallback, useState } from 'react';

/**
 * DARK / LIGHT ONLY — NOT A SEVEN-THEME PICKER, AND THE DIFFERENCE IS THE POINT.
 *
 * The original picker offered all seven palettes and lived inside the two
 * Settings pages; it was deleted with them, and the providers were pinned to
 * `THEMES[0]` so that a stale `localStorage` choice could not strand anyone in a
 * palette they had no UI to leave. That note said keeping the array would make a
 * future control "a revert rather than a rewrite", and this is that revert.
 *
 * What came back is deliberately narrower than what went away: a BINARY mode.
 * Only `THEMES[0]` (Cyber Cyan) and the `white` entry are reachable, because
 * only those two have a stylesheet behind them — `index.css` carries ~500 lines
 * of `[data-theme="white"]` overrides plus the completion block at the end of
 * that file, and nothing equivalent exists for indigo, violet, emerald, rose or
 * amber. Exposing all seven would ship five options that render as the dark
 * theme with a different accent, which is not what "theme" promises.
 *
 * THE OTHER FIVE ENTRIES STAY, STILL UNREACHABLE, FOR THE ORIGINAL REASON. They
 * are the design system's palettes, and `applyThemeToElement()` is what writes
 * them into the custom properties every screen reads. Do not "clean up" the
 * array.
 *
 * ⚠️ THE STORAGE KEYS ARE NEW (`…_mode`), NOT THE OLD `…_theme` PAIR. A value
 * left in the old keys is a palette id like `violet` — a vocabulary this context
 * no longer speaks. Reading them would mean either honouring an unreachable
 * theme or silently discarding a preference; a fresh key means an old value is
 * simply never consulted, which is the same reasoning that retired them.
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

/**
 * The one theme every portal renders.
 *
 * There used to be a `learnsyncai_student_theme` / `learnsyncai_educator_theme`
 * pair in localStorage backing a per-portal choice. Both keys are gone with the
 * picker; any value still sitting in a browser is ignored rather than honoured,
 * which is the point — a stale preference nobody can change is worse than none.
 */
export const ACTIVE_THEME = THEMES[0];

/** The two reachable themes. `ACTIVE_THEME` stays the dark one and the default. */
export const DARK_THEME = THEMES[0];
export const LIGHT_THEME = THEMES.find((t) => t.id === 'white')!;

export type ColorMode = 'dark' | 'light';

/**
 * The text/icon colour that reads on a block of `accent`.
 *
 * ⚠️ IT IS COMPUTED, NOT A CONSTANT, BECAUSE THE CONSTANT WAS WRONG THE MOMENT
 * A LIGHT THEME EXISTED. Nine call sites across seven files paired
 * `backgroundColor: accent` with a hard-coded `color: '#04121a'` — a near-black
 * ink, correct on all six dark palettes, whose accents are bright cyan, violet,
 * emerald and so on. The light theme's accent is `#0284c7` (sky-600), a DARK
 * blue, and near-black on it measures about 2.6:1 — under the 4.5:1 floor, on
 * the primary button of every form in the app.
 *
 * A CSS override cannot fix this: these are inline styles, so a stylesheet would
 * have to fight them with `!important` on an attribute selector broad enough to
 * catch every themed button. Deriving the ink at the call site is both smaller
 * and self-correcting — a palette added later gets a readable label without
 * anyone remembering this rule.
 *
 * Relative luminance per WCAG 2.x, with the sRGB gamma expansion. The 0.45
 * threshold rather than 0.5 leans slightly toward the dark ink, which is what
 * the six existing accents want.
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

  // Anything unparseable (a named colour, an rgba string) keeps the old ink
  // rather than guessing — the dark themes are the ones that shipped with it.
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#04121a';

  const channel = (offset: number) => {
    const v = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? '#04121a' : '#ffffff';
}

export const themeForMode = (mode: ColorMode) => (mode === 'light' ? LIGHT_THEME : DARK_THEME);

/*
 * Every read and write is wrapped: `localStorage` THROWS rather than returning
 * null in a Safari private window and under some school-managed browser
 * policies, which is exactly the deployment this is going to. A student whose
 * browser refuses storage gets the default theme, not a blank screen.
 */
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
    /* Preference is not persisted this session. The toggle still works. */
  }
}

/**
 * ⚠️ THE THEME GOES ON `documentElement` AS WELL AS THE WRAPPER, AND WITHOUT
 * THAT HALF THE LIGHT THEME IS BROKEN IN TWO WAYS THAT LOOK UNRELATED.
 *
 * `data-theme` used to be set only on each layout's wrapper `<div>`. Two
 * consequences, both measured:
 *
 *   1. EVERY MODAL STAYED DARK. `Modal` renders through
 *      `createPortal(…, document.body)`, so it is a SIBLING of the themed
 *      wrapper, not a descendant — no `[data-theme="white"] …` selector can
 *      reach it, and none of the inline custom properties inherit into it. In
 *      light mode that meant a near-black dialog over a white page.
 *
 *   2. 99 RULES IN `index.css` HAD NEVER ONCE RUN. The white block is written
 *      twice, the second copy prefixed `:root[data-theme="white"]` for
 *      specificity. `:root` IS `<html>`, which never carried the attribute, so
 *      that entire copy was inert. It is a byte-identical duplicate of the
 *      first, so switching it on is a visual no-op — verified by diffing the
 *      two — but it is now doing the job it was written for.
 *
 * The wrapper still gets it too. That costs nothing (the declarations are
 * identical, so double-matching resolves to the same values) and it keeps
 * `theme.accent` inline on the subtree that reads it.
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

/*
 * `mode` and `setMode` replace the old `setTheme`, which took any of the seven
 * palettes. A consumer can only ask for dark or light, so the shape says what it
 * can do — the same principle that removed the old setter.
 */
interface ThemeContextValue {
  theme: ThemeDefinition;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
}

/**
 * ⚠️ ONE HOOK, THREE KEYS — THE PER-PORTAL SPLIT IS PRESERVED ON PURPOSE.
 *
 * The three providers were kept separate rather than merged because "the split
 * is the seam a future per-portal preference would reopen". This is that
 * preference, so the seam earns its keep: a key each. A user only ever holds one
 * role, so in practice that is one key per person — but an admin who is also
 * shown a student view does not have their choice follow them across portals,
 * which is the behaviour the original design chose.
 *
 * The state is seeded from storage in the initialiser rather than in an effect.
 * An effect runs AFTER the first paint, so a student who chose light mode would
 * see the dark theme flash on every page load.
 *
 * ⚠️ EXPORTED, BUT IT IS STATE — NOT A SUBSCRIPTION. Two components calling this
 * with the same key get two independent copies that will not see each other's
 * writes until a remount. That is why the portals wrap it in a provider, and why
 * `AuthShell` may call it directly: it is the single owner of the auth palette,
 * and each auth page mounts exactly one.
 *
 * `fallback` is what applies when storage holds nothing — the auth pages default
 * light while the portals default dark, so it cannot be a constant. A stored
 * value always wins, including a stored `'dark'`, which is the whole point of
 * reading the string rather than testing it for `'light'`.
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

/*
 * `useTheme()` / `ThemeProvider` — two legacy aliases kept "so any component
 * using them still compiles" — are gone. Grep found zero consumers of either, and
 * `getAuthTheme()` went with the localStorage read it wrapped: the auth pages now
 * apply `ACTIVE_THEME` directly, since there is no longer a per-role choice for
 * them to recover.
 */
