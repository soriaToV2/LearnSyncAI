import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import Logo from '../../components/common/Logo';
import { applyThemeToElement, DARK_THEME, useColorMode } from '../../context/ThemeContext';

/**
 * Shell and field for the auth pages: one centred card, nothing that doesn't help someone sign in.
 * - The palette persists under its own key (never a portal key) and defaults to light; a stored value wins.
 * - Only Login renders the toggle (`showModeToggle`), but every auth page reads the stored choice.
 *   There's no `mode` prop: a page pinning a palette would fight the toggle.
 * - Light mode is mostly index.css (data-theme="white" on <html>); fix only what it can't reach.
 * - The layout-effect cleanup restores dark before paint, so the portal never flashes light.
 */

/** Its own key. Never a portal key: the sign-in screen must not rewrite a signed-in preference. */
const AUTH_MODE_KEY = 'learnsyncai_auth_mode';

export function AuthShell({
  children,
  showModeToggle = false,
}: {
  children: React.ReactNode;
  /** Draw the light/dark control (Login only). Doesn't affect which palette renders. */
  showModeToggle?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { theme, mode, setMode } = useColorMode(AUTH_MODE_KEY, 'light');

  useLayoutEffect(() => {
    if (wrapperRef.current) {
      applyThemeToElement(theme, wrapperRef.current);
    }
    return () => {
      applyThemeToElement(DARK_THEME, document.documentElement);
    };
  }, [theme]);

  return (
    <div
      ref={wrapperRef}
      /* min-h-screen here and nowhere inside (nesting it stopped the card centring on phones). */
      className="min-h-screen bg-page text-slate-200 flex flex-col relative overflow-hidden font-sans animate-page-fade"
    >
      {/* Two tinted blurs, no remote image. overflow-hidden is required: .auth-aurora is 130vmax and would add scrollbars. Motion is in index.css. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
        <div className="auth-aurora" />
        <div className="auth-vignette" />
      </div>

      <main className="flex-grow flex items-center justify-center p-4 sm:p-6 relative z-10">
        {/* The arbitrary-value shadow has no light-theme rule, so light gets a normal elevation shadow. */}
        <div
          className={`w-full max-w-[400px] bg-surface-container-lowest/70 backdrop-blur-2xl rounded-3xl border border-white/10 p-7 sm:p-9 ${
            mode === 'light'
              ? 'shadow-[0_20px_50px_-12px_rgba(15,23,42,0.18)]'
              : 'shadow-[0_0_60px_rgba(0,0,0,0.5)]'
          }`}
        >
          {children}
        </div>
      </main>

      {/* Login only. fixed, so it sits outside <main> with its own z-index above the aurora. Uses classes the light stylesheet already remaps. */}
      {showModeToggle && (
      <button
        type="button"
        onClick={() => setMode(mode === 'light' ? 'dark' : 'light')}
        /* Names the destination, not the current state. */
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        className="fixed top-5 right-5 z-20 w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim"
      >
        {/* The icon shows what you'd get. */}
        {mode === 'light' ? (
          <Moon className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Sun className="w-4 h-4" aria-hidden="true" />
        )}
      </button>
      )}
    </div>
  );
}

/** The accented brand tile, centred above the heading. */
export function BrandMark() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center">
      <Logo className="w-6 h-6 text-primary-fixed-dim" />
    </div>
  );
}

/**
 * Floating-label field: the <label> stays bound and visible after typing (a placeholder alone loses its
 * name). Floated size 10px, the floor for uppercase micro-labels. Plain chrome: border plus ring.
 */
export function AuthField({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  trailing,
  inputProps,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  trailing?: React.ReactNode;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        placeholder=" "
        autoComplete={autoComplete}
        className={`peer w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 pt-5 pb-2 text-white font-sans text-sm outline-none placeholder-transparent transition-colors focus:border-primary-fixed-dim/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-fixed-dim/25 ${
          trailing ? 'pr-12' : ''
        }`}
        {...inputProps}
      />
      <label
        htmlFor={id}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-200 pointer-events-none
          peer-focus:top-3.5 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-widest peer-focus:text-primary-fixed-dim
          peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-widest"
      >
        {label}
      </label>
      {trailing}
    </div>
  );
}

/** Digits in a recovery code; mirrors codeProblem() in src/lib/account.ts. */
const CODE_LENGTH = 6;

const padCode = (value: string) =>
  Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');

/**
 * Six single-digit boxes for a mailed code. The boxes keep their own array (a joined string can't hold
 * a gap, so clearing a middle digit would shift the rest). No maxLength: it truncates pastes and breaks
 * iOS autofill; write() distributes multi-character input across the boxes instead.
 */
export function AuthCodeInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const [chars, setChars] = useState<string[]>(() => padCode(value));
  const previous = useRef(value);

  /* Parent-driven changes win (the clear after a rejected code), and refocus the first box. */
  useEffect(() => {
    if (value !== chars.join('')) setChars(padCode(value));
    if (previous.current.length > 0 && value.length === 0) boxes.current[0]?.focus();
    previous.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const focusBox = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))];
    box?.focus();
    box?.select();
  };

  const commit = (next: string[]) => {
    setChars(next);
    onChange(next.join(''));
  };

  /** The one writer: a typed digit, a paste, or an autofill. */
  const write = (index: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '');
    const next = chars.slice();

    if (incoming.length === 0) {
      next[index] = '';
      commit(next);
      return;
    }

    for (let i = 0; i < incoming.length && index + i < CODE_LENGTH; i += 1) {
      next[index + i] = incoming[i];
    }
    commit(next);
    focusBox(index + incoming.length);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = chars.slice();
      // Backspace on an empty box clears the previous one.
      if (next[index] === '' && index > 0) {
        next[index - 1] = '';
        commit(next);
        focusBox(index - 1);
      } else {
        next[index] = '';
        commit(next);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusBox(index - 1);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusBox(index + 1);
    }
  };

  /* A paste always fills from the first box. */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (text.length === 0) return;
    e.preventDefault();
    write(0, text);
  };

  return (
    <div>
      <label
        htmlFor={`${id}-1`}
        className="block font-sans text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2"
      >
        {label}
      </label>

      {/* The group carries the field's name; each box says which digit it is. */}
      <div role="group" aria-label={label} className="grid grid-cols-6 gap-2">
        {chars.map((char, index) => (
          <input
            key={index}
            ref={(el) => {
              boxes.current[index] = el;
            }}
            id={`${id}-${index + 1}`}
            type="text"
            inputMode="numeric"
            /* First box only, so a browser doesn't offer the code six times. */
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            spellCheck={false}
            aria-label={`${label}, digit ${index + 1} of ${CODE_LENGTH}`}
            value={char}
            onChange={(e) => write(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            /* text-white also drives the light theme's input.text-white rule. */
            className="w-full h-14 text-center bg-white/[0.03] border border-white/10 rounded-xl text-white font-display text-xl font-bold outline-none transition-colors focus:border-primary-fixed-dim/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-fixed-dim/25"
          />
        ))}
      </div>
    </div>
  );
}
