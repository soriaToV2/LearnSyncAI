import React, { useRef } from 'react';
import { Check, TriangleAlert, UserPen } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { inkOn } from '../../context/ThemeContext';

/**
 * Form primitives shared by the account forms and the admin editors. Shared rather than copied mainly
 * because useSubmitLatch is a correctness guard. No endpoint or auth knowledge here.
 */

// outline-none removes the focus indicator, so this supplies an inset ring (works on any panel colour).
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
  /** `danger` is for controls that remove access. Colour only; the caller still confirms. */
  tone?: 'accent' | 'danger';
}) {
  const enabledStyle =
    tone === 'danger' ? { backgroundColor: '#e11d48', color: '#fff' } : { backgroundColor: accent, color: inkOn(accent) };
  return (
    <button
      type="submit"
      disabled={disabled}
      style={disabled ? undefined : enabledStyle}
      /* ring-on-surface, not the accent: the background is already the accent. */
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

/** Message from a thrown api.ts error (already display-ready), with a fallback. */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Synchronous submit latch. Not redundant with `disabled`: state doesn't update until the handler
 * yields, so a double-click would fire twice. Set before the first await, clear in finally.
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
