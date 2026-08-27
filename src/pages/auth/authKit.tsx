import React, { useRef, useEffect } from 'react';
import Logo from '../../components/common/Logo';
import { ACTIVE_THEME, applyThemeToElement } from '../../context/ThemeContext';

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
 * ⚠️ THESE PAGES ARE PINNED TO `ACTIVE_THEME` AND ARE NOT PART OF THE LIGHT/DARK
 * TOGGLE. The preference is stored per portal and read by that portal's own
 * provider; nobody is signed in here, so there is no portal to read it from.
 * They always render the dark palette — which is why the hard-coded cyan glow on
 * the brand mark is correct here rather than the theme-literal bug it resembles
 * elsewhere in the app.
 *
 * `SetPassword` still hand-builds its own shell and can adopt this unchanged.
 */

export function AuthShell({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wrapperRef.current) {
      applyThemeToElement(ACTIVE_THEME, wrapperRef.current);
    }
  }, []);

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
        <div className="w-full max-w-[400px] bg-surface-container-lowest/70 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.5)] p-7 sm:p-9">
          {children}
        </div>
      </main>
    </div>
  );
}

/** The accented brand tile, centred above the heading. */
export function BrandMark() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shadow-[0_0_30px_rgba(0,218,243,0.2)]">
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
