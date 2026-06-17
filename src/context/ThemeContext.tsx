import React, { createContext, useContext, useState, useEffect } from 'react';

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

// ─── Storage Keys ──────────────────────────────────────────────────────────────
const STUDENT_STORAGE_KEY = 'learnsyncai_student_theme';
const EDUCATOR_STORAGE_KEY = 'learnsyncai_educator_theme';
export const LAST_ROLE_KEY = 'learnsyncai_last_role';

// ─── CSS var application (applied to a specific element, not always root) ──────
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

// ─── Student Theme Context ─────────────────────────────────────────────────────
interface ThemeContextValue {
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
}

const StudentThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[0],
  setTheme: () => {},
});

export function StudentThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(() => {
    const saved = localStorage.getItem(STUDENT_STORAGE_KEY);
    return THEMES.find(t => t.id === saved) ?? THEMES[0];
  });

  useEffect(() => {
    localStorage.setItem(LAST_ROLE_KEY, 'student');
  }, []);

  const setTheme = (id: string) => {
    const found = THEMES.find(t => t.id === id);
    if (found) {
      setThemeState(found);
      localStorage.setItem(STUDENT_STORAGE_KEY, id);
    }
  };

  return (
    <StudentThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </StudentThemeContext.Provider>
  );
}

export function useStudentTheme() {
  return useContext(StudentThemeContext);
}

// ─── Educator Theme Context ────────────────────────────────────────────────────
const EducatorThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[0],
  setTheme: () => {},
});

export function EducatorThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(() => {
    const saved = localStorage.getItem(EDUCATOR_STORAGE_KEY);
    return THEMES.find(t => t.id === saved) ?? THEMES[0];
  });

  useEffect(() => {
    localStorage.setItem(LAST_ROLE_KEY, 'educator');
  }, []);

  const setTheme = (id: string) => {
    const found = THEMES.find(t => t.id === id);
    if (found) {
      setThemeState(found);
      localStorage.setItem(EDUCATOR_STORAGE_KEY, id);
    }
  };

  return (
    <EducatorThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </EducatorThemeContext.Provider>
  );
}

export function useEducatorTheme() {
  return useContext(EducatorThemeContext);
}

// ─── Auth-page helper: returns the theme for whichever role was last active ────
export function getAuthTheme(): ThemeDefinition {
  const lastRole = localStorage.getItem(LAST_ROLE_KEY);
  const key = lastRole === 'educator' ? EDUCATOR_STORAGE_KEY : STUDENT_STORAGE_KEY;
  const saved = localStorage.getItem(key);
  return THEMES.find(t => t.id === saved) ?? THEMES[0];
}

// ─── Legacy alias so any component using useTheme() still compiles ─────────────
// Student pages use this; educators should use useEducatorTheme() instead.
export function useTheme() {
  return useContext(StudentThemeContext);
}

/** @deprecated Use StudentThemeProvider or EducatorThemeProvider instead */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <StudentThemeProvider>{children}</StudentThemeProvider>;
}
