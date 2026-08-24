import React, { useRef } from 'react';
import { Check, TriangleAlert, UserPen } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { inkOn } from '../../context/ThemeContext';

/**
 * The form primitives shared by the self-service account forms and the admin
 * portal's account editors.
 *
 * These were private to `AccountForms.tsx` until the admin portal needed the same
 * pieces. They are lifted rather than copied for one reason above the others:
 * `useSubmitLatch` is a correctness guard, not styling, and a second copy of a
 * correctness guard drifts. The admin forms change passwords and account status,
 * which is exactly where a double-submit must not happen.
 *
 * Nothing here knows about an endpoint or an auth context — that is what keeps it
 * reusable across two portals with different authorisation models.
 */

/*
 * ⚠️ `outline-none` REMOVES THE BROWSER'S FOCUS INDICATOR, so this string has to
 * supply its own. It previously replaced it with `focus:border-white/25` alone —
 * a border going from 10% to 25% white, which is very nearly invisible, on the
 * forms where a password is changed.
 *
 * The ring is INSET because these inputs render on a card (the Profile pages) and
 * inside a `Modal` (the admin create/import editors), whose panels are different
 * colours. An offset ring needs its gap colour to match the backdrop; an inset one
 * needs to know nothing about it, and follows the `rounded-xl` correctly.
 */
export const INPUT_CLASS =
  'w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none transition-colors focus:border-white/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] disabled:opacity-50 disabled:cursor-not-allowed';

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold"
      >
        {label}
      </label>
      <input id={id} className={INPUT_CLASS} {...input} />
      {hint && <p className="font-sans text-[11px] text-slate-500 leading-relaxed">{hint}</p>}
    </div>
  );
}

export type Status = { kind: 'ok' | 'error'; text: string } | null;

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const ok = status.kind === 'ok';
  return (
    <p
      role="status"
      className={`flex items-start gap-2 font-sans text-xs ${ok ? 'text-emerald-400' : 'text-rose-400'}`}
    >
      {ok ? (
        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      ) : (
        <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      )}
      {status.text}
    </p>
  );
}

export function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserPen;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-lg shadow-black/20 p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-slate-300" />
        </div>
        <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      </div>
      <p className="font-sans text-xs text-slate-400 mb-5 leading-relaxed">{description}</p>
      {children}
    </section>
  );
}

export function SaveButton({
  accent,
  disabled,
  busy,
  label,
  tone = 'accent',
}: {
  accent: string;
  disabled: boolean;
  busy: boolean;
  label: string;
  /**
   * `danger` is for a control that takes access away — disabling an account. It
   * is a colour, not a confirmation: the caller still owns asking first.
   */
  tone?: 'accent' | 'danger';
}) {
  const enabledStyle =
    tone === 'danger' ? { backgroundColor: '#e11d48', color: '#fff' } : { backgroundColor: accent, color: inkOn(accent) };
  return (
    <button
      type="submit"
      disabled={disabled}
      style={disabled ? undefined : enabledStyle}
      /* `ring-on-surface`, not the accent: this button's background IS the accent
         (inline `style`), so an accent ring on it would be the same colour twice.
         `on-surface` is the max-contrast token against the surface by definition,
         so the offset gap separates them in every theme. Matches the treatment on
         the student portal's other primary CTAs. */
      className={`px-5 py-2.5 rounded-xl font-display text-xs font-bold flex items-center gap-2 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        disabled
          ? 'bg-white/5 text-slate-500 cursor-not-allowed'
          : 'hover:brightness-110 cursor-pointer'
      }`}
    >
      {busy && <Spinner className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

/**
 * Message from a thrown `api.ts` error, with a readable fallback.
 * `apiFetch` already unwraps the envelope, so `err.message` is display-ready.
 */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * A synchronous submit latch.
 *
 * NOT redundant with the button's `disabled`. That reads React state, which does
 * not re-render until the handler yields, so a double-click enters the handler
 * twice with `busy` still false and fires two requests. The same bug once graded
 * one Feynman answer 0.95 and 0.90 from identical input; here it would be two
 * password changes racing. Set before the first `await`, cleared in `finally`.
 */
export function useSubmitLatch() {
  const latch = useRef(false);
  return {
    take: () => {
      if (latch.current) return false;
      latch.current = true;
      return true;
    },
    release: () => {
      latch.current = false;
    },
  };
}
