import React, { createContext, useContext } from 'react';

/**
 * ⚠️ THERE IS NO THEME PICKER, AND THE PROVIDERS ARE PINNED TO `THEMES[0]`.
 *
 * The picker lived only inside the two Settings pages, which were deleted along
 * with the invented student data they rendered. Removing the UI alone would not
 * have been enough: the provider also READ `localStorage`, so anyone who had
 * previously chosen a theme would have been locked into it permanently with no
 * way back. The read and the write both go, and every portal now renders Cyber
 * Cyan deterministically.
 *
 * SIX OF THE SEVEN `THEMES` ENTRIES ARE NOW UNREACHABLE, AND THAT IS DELIBERATE.
 * The palettes are the design system — `applyThemeToElement()` writes them into
 * the CSS custom properties every screen reads through `theme.accent` — so
 * keeping them makes a future picker a revert rather than a rewrite. Do not
 * "clean up" the array on the grounds that only the first element is used.
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

// Apply theme to element
export function applyThemeToElement(t: ThemeDefinition, el: HTMLElement) {
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
 * `setTheme` is GONE from this value, not merely unused. Leaving a setter that
 * every caller has stopped calling is how a "preference" quietly comes back with
 * nowhere to set it; the shape a consumer sees should say what it can do.
 */
interface ThemeContextValue {
  theme: ThemeDefinition;
}

const StudentThemeContext = createContext<ThemeContextValue>({ theme: ACTIVE_THEME });
const EducatorThemeContext = createContext<ThemeContextValue>({ theme: ACTIVE_THEME });

/*
 * Both providers exist only so `useStudentTheme()` / `useEducatorTheme()` keep
 * working unchanged at ~15 call sites across both portals. They are kept separate
 * rather than merged into one because the split is the seam a future per-portal
 * preference would reopen, and merging them would be the irreversible half of
 * this change.
 */
export function StudentThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <StudentThemeContext.Provider value={{ theme: ACTIVE_THEME }}>
      {children}
    </StudentThemeContext.Provider>
  );
}

export function useStudentTheme() {
  return useContext(StudentThemeContext);
}

export function EducatorThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <EducatorThemeContext.Provider value={{ theme: ACTIVE_THEME }}>
      {children}
    </EducatorThemeContext.Provider>
  );
}

export function useEducatorTheme() {
  return useContext(EducatorThemeContext);
}

/*
 * `useTheme()` / `ThemeProvider` — two legacy aliases kept "so any component
 * using them still compiles" — are gone. Grep found zero consumers of either, and
 * `getAuthTheme()` went with the localStorage read it wrapped: the auth pages now
 * apply `ACTIVE_THEME` directly, since there is no longer a per-role choice for
 * them to recover.
 */
