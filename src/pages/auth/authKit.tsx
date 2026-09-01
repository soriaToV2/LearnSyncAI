import React, { useRef, useLayoutEffect } from 'react';
import Logo from '../../components/common/Logo';
import {
  applyThemeToElement,
  DARK_THEME,
  themeForMode,
  type ColorMode,
} from '../../context/ThemeContext';

/**
 * The shell and the field for the auth pages.
 *
 * ⚠️ ONE CENTRED CARD, NOT A SPLIT PANEL. The previous version put a marketing
 * panel beside the form — a headline, a paragraph and three feature cards. Every
 * word of it sat between a student and the two fields they came to fill in, and
 * two of those claims were not even true (it advertised CollabShare, which
 * migration 0003 removed, and cited RLS as the isolation mechanism when the
 * service role bypasses RLS on every request that reaches Express).
 *
 * The rule for anything added here: a sign-in screen has one job. If a line does
 * not help someone sign in, it does not belong on it.
 *
 * ⚠️ THE PALETTE IS FIXED PER PAGE AND IS STILL NOT THE LIGHT/DARK TOGGLE. That
 * preference is stored per portal and read by that portal's own provider; nobody
 * is signed in here, so there is no portal to read it from. `mode` is the page
 * AUTHOR's choice, baked in at the call site — not the visitor's, and there is
 * deliberately no control for it on these screens.
 *
 * It defaults to `'dark'`, so `ForgotPassword` and `SetPassword` are untouched.
 * `Login` passes `'light'`.
 *
 * ⚠️ MOST OF LIGHT MODE IS THE STYLESHEET, NOT THIS FILE. `applyThemeToElement`
 * puts `data-theme="white"` on `documentElement`, which switches on ~296 rules in
 * `index.css` — they remap the whole `--color-slate-*` ramp and already correct
 * `input.text-white`, `.border-white/5|10|20`, `p.text-white`, `h1..h6.text-white`
 * and `.hover:text-white`. So a page going light needs to fix only what those
 * rules cannot see: arbitrary-value utilities like the card shadow below, and
 * tinted semantic colours such as the alert banners in `Login`.
 *
 * ⚠️ THE CLEANUP IS NOT OPTIONAL, AND IT IS A LAYOUT EFFECT FOR A REASON. The
 * attribute is set on `<html>`, which OUTLIVES this component — and the portal
 * layouts apply their own theme in a passive `useEffect`, which runs after the
 * browser has painted. Without the restore, signing in from the light Login page
 * paints one frame of the dashboard on a white palette before the portal
 * corrects it. A layout effect's cleanup runs before that paint; a passive one
 * would not. Restoring DARK rather than the visitor's preference is deliberate:
 * it is exactly the state these pages used to leave behind, so the portal's own
 * first frame is unchanged from before this feature.
 */

export function AuthShell({
  children,
  mode = 'dark',
}: {
  children: React.ReactNode;
  /** The page author's fixed choice, not the visitor's. See the header. */
  mode?: ColorMode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (wrapperRef.current) {
      applyThemeToElement(themeForMode(mode), wrapperRef.current);
    }
    return () => {
      applyThemeToElement(DARK_THEME, document.documentElement);
    };
  }, [mode]);

  return (
    <div
      ref={wrapperRef}
      /* ⚠️ `min-h-screen` HERE AND NOWHERE INSIDE. This wrapper and the inner
         `<main>` both used to carry it, so on a phone a full viewport was nested
         inside a full viewport and the card could not centre — the same
         double-count `GamesLayout` and `StudySpace` each shipped. */
      className="min-h-screen bg-page text-slate-200 flex flex-col relative overflow-hidden font-sans animate-page-fade"
    >
      {/* ⚠️ THE UNSPLASH BACKGROUND IS GONE. Both auth pages carried one — a
          remote image on the app's front door: a request that fails on a school
          connection or offline, uncredited third-party photography, and the last
          surviving piece of the stock-photo dressing `mockStudents.ts` was
          deleted for. Two tinted blurs do the same job with no network.

          The graph-paper grid overlay is gone too. It was a 4rem lattice across
          the whole viewport, and a login card floating on ruled paper reads as
          dashboard chrome that has lost its content — on the one screen in the
          app where there is deliberately nothing else to look at.

          ⚠️ `overflow-hidden` IS LOAD-BEARING HERE. `.auth-aurora` is 130vmax
          square and centred by negative margins, so without it the document
          gains a scrollbar on both axes on every auth page.

          The motion lives in `index.css` — see `.auth-aurora` for why rotation
          is the only animated property on an 80px-blurred layer. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
        <div className="auth-aurora" />
        <div className="auth-vignette" />
      </div>

      <main className="flex-grow flex items-center justify-center p-4 sm:p-6 relative z-10">
        {/* ⚠️ THE SHADOW IS THE ONE PIECE OF CARD CHROME THE STYLESHEET CANNOT
            REACH. `border-white/10` has a `[data-theme="white"]` rule; an
            arbitrary-value utility does not, and a 60px black bloom that reads as
            depth on `#020617` reads as grime on `#eef2f6`. Light gets a normal
            downward elevation shadow instead of a glow in all directions. */}
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
 * A floating-label text field.
 *
 * ⚠️ THE LABEL FLOATS RATHER THAN BEING A PLACEHOLDER, AND THAT IS AN
 * ACCESSIBILITY DECISION, NOT A STYLING ONE. A placeholder-only field looks
 * identical at rest but loses its name the moment anything is typed — so a
 * student who tabs away and back, or a screen reader reading a filled form, has
 * no idea which box is which. Floating keeps the `<label>` bound to the input at
 * all times and still reads as a placeholder before you touch it.
 *
 * The floated size is `text-[10px]`, not the `text-[9px]` this used to be. An
 * uppercase, letter-spaced micro-label is the one case the type scale allows
 * under 11px — 9px was below even that, on the only thing naming the field.
 *
 * The chrome is deliberately plain: no gradient halo, no inset shadow, no
 * animated underline sweep. Three separate focus effects on one text box is more
 * design than a login form can carry, and the border plus ring says the same
 * thing in one gesture.
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
