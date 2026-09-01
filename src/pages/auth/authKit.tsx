import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import Logo from '../../components/common/Logo';
import { applyThemeToElement, DARK_THEME, useColorMode } from '../../context/ThemeContext';

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
 * ══ THE PALETTE IS THE VISITOR'S, AND THE SHELL OWNS IT ══
 * The choice persists under `learnsyncai_auth_mode` — its own key, deliberately
 * not one of the three portal keys: nobody is signed in here, so there is no
 * portal whose preference this could be, and writing into a portal's key would
 * silently change a signed-in experience from the sign-out screen.
 *
 * ⚠️ THE DEFAULT IS LIGHT, WHICH IS THE OPPOSITE OF EVERY PORTAL'S. Deliberate:
 * these are the school's front door. A stored value always wins over it, so
 * someone who picks dark keeps dark.
 *
 * ⚠️ ONLY `Login` RENDERS THE TOGGLE (`showModeToggle`), BUT ALL THREE PAGES
 * READ THE STORED CHOICE. That split is the whole design and it is easy to
 * half-implement: gating the READ as well would leave `/forgot-password` bright
 * white for someone who had just chosen dark one screen earlier. Sign-in is the
 * page everybody passes through and the only one they arrive at cold, so it is
 * where the control belongs; the other two are mid-flow and reachable only from
 * it. Both link back to `/login`, so the setting is never more than one click
 * away — check that stays true before adding an auth page that does not.
 *
 * ⚠️ THERE IS STILL NO `mode` PROP, AND REINSTATING ONE WOULD BE A BUG. A page
 * cannot pin a palette the visitor can change one click later; the two would
 * fight on the next render, and the toggle would appear not to work on whichever
 * page did the pinning. `showModeToggle` decides whether the CONTROL is drawn,
 * never what the palette is.
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

/**
 * Its own key, alongside the three portal keys rather than inside one.
 *
 * ⚠️ DO NOT POINT THIS AT A PORTAL KEY. Sharing one would let the sign-in screen
 * rewrite a signed-in student's saved preference — and it could only ever pick
 * one portal's, so it would be wrong for the other two roles.
 */
const AUTH_MODE_KEY = 'learnsyncai_auth_mode';

export function AuthShell({
  children,
  showModeToggle = false,
}: {
  children: React.ReactNode;
  /**
   * Draw the light/dark control. `Login` only — see the header. It does NOT
   * affect which palette this page renders, only whether it can be changed here.
   */
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

      {/* Rendered on `/login` alone. The pages that omit it still follow the
          stored choice — see the header for why gating the read too would be the
          bug this split exists to avoid.

          ⚠️ `fixed`, SO IT MUST SIT OUTSIDE `<main>` AND CARRY ITS OWN z-index.
          The aurora layer above is `fixed inset-0 z-0` and would otherwise paint
          over it. `overflow-hidden` on the root does not clip this — only
          transform/filter/contain create a containing block for a fixed child,
          and the root has none.

          The chrome is written in classes the light stylesheet already knows:
          `bg-white/5`, `border-white/10`, `text-slate-400` and `hover:text-white`
          each have a `[data-theme="white"]` rule, so the button re-colours itself
          in both palettes with nothing conditional here. */}
      {showModeToggle && (
      <button
        type="button"
        onClick={() => setMode(mode === 'light' ? 'dark' : 'light')}
        /* Names the DESTINATION, not the current state — it is a control, and
            "Dark mode" alone leaves a screen-reader user guessing whether that is
            what they have or what they would get. */
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        className="fixed top-5 right-5 z-20 w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim"
      >
        {/* The icon shows what you would GET, matching the label. */}
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


/** Digits in a recovery code. Mirrors `codeProblem()`'s `/^\d{6}$/` in `src/lib/account.ts`. */
const CODE_LENGTH = 6;

const padCode = (value: string) =>
  Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');

/**
 * Six single-digit boxes for a mailed recovery code.
 *
 * ══ WHY NOT `AuthField` ══
 * A code is not prose: it has a known length, it is copied out of an email
 * rather than composed, and it is the one field on these pages a phone can fill
 * from a notification. Boxes show how many digits are expected before the user
 * starts, and show progress while they type — a single box does neither.
 *
 * ══ ⚠️ THE PARENT'S STRING CANNOT HOLD A GAP, WHICH IS WHY THE BOXES KEEP THEIR
 * OWN ARRAY ══
 * `['1', '', '3', '', '', '']` joins to `"13"`, so driving the boxes straight
 * off the joined value would make clearing a MIDDLE digit shift every later one
 * left — the code silently rearranges itself under the cursor. The array is the
 * display truth; the parent only ever needs the concatenation, which is
 * meaningful exactly when all six are present. The effect syncs downward so a
 * parent-side clear (`setCode('')` after a rejected code) still empties them.
 *
 * ══ ⚠️ NO `maxLength`, AND THAT IS DELIBERATE ══
 * It looks like the obvious guard and it breaks the two ways a code actually
 * arrives: a browser truncates a PASTE to `maxLength`, so six digits pasted into
 * the first box become one, and iOS one-time-code AUTOFILL delivers the whole
 * code into a single field. `write()` distributes any multi-character value
 * across the boxes instead, so typing, pasting and autofill all take one path.
 * Focus selects the box's content, so typing over a filled digit replaces it.
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

  /* Parent-driven changes win. The only one in practice is the clear after a
     rejected code, so this also refocuses the first box — the user has to retype
     and should not have to aim. */
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

  /** The one writer. `raw` may be one typed digit, a pasted code, or an autofill. */
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
      // An empty box steps back and clears the one before it, which is what a
      // single Backspace press means to someone fixing a typo at the end.
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

  /* Paste always fills from the FIRST box, wherever the cursor is. Someone
     pasting is pasting the whole code, not editing one digit of it. */
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

      {/* Six inputs are six tab stops and six screen-reader announcements, so the
          group carries the field's name and each box says which digit it is. */}
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
            /* On the first box only. Repeating it invites a browser to offer the
               same code six times. */
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            spellCheck={false}
            aria-label={`${label}, digit ${index + 1} of ${CODE_LENGTH}`}
            value={char}
            onChange={(e) => write(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            /* `text-white` is not just a colour here: `[data-theme="white"]`
               keys its `input.text-white` rule off it, which is what gives these
               boxes a readable ink and background in light mode. Same reason
               `AuthField` carries it. */
            className="w-full h-14 text-center bg-white/[0.03] border border-white/10 rounded-xl text-white font-display text-xl font-bold outline-none transition-colors focus:border-primary-fixed-dim/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-fixed-dim/25"
          />
        ))}
      </div>
    </div>
  );
}
