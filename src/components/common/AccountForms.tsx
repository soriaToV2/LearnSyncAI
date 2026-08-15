import React, { useEffect, useRef, useState } from 'react';
import { AtSign, Check, KeyRound, Loader2, TriangleAlert, UserPen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { accountApi, USERNAME_HINT, usernameProblem } from '../../lib/account';

/**
 * The three account forms, shared verbatim by both portals' Profile pages.
 *
 * ⚠️ THREE FORMS, NOT ONE, AND THEY MUST NOT BE MERGED. They hit three endpoints
 * with three different authorisations: name and username need no password, while
 * changing an email or a password re-proves the current one. Merged into a single
 * Save, a rejected password would roll back a perfectly valid name change, and
 * the user would be asked for their password to correct a typo in their surname.
 *
 * ⚠️ ROLE, ACCOUNT STATUS AND GRADE LEVEL ARE ABSENT ON PURPOSE. `PATCH
 * /api/auth/me` refuses them — `materialAccess.ts` gates every student read on
 * their grade level, so a self-service grade field would hand out another year's
 * materials. `ProfileCard` shows them read-only with the reason, which is why
 * their absence here does not read as an oversight.
 */

// ── primitives ──────────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none transition-colors focus:border-white/25 disabled:opacity-50 disabled:cursor-not-allowed';

function Field({
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

type Status = { kind: 'ok' | 'error'; text: string } | null;

function StatusLine({ status }: { status: Status }) {
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

function Section({
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
    <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-slate-400" />
        <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      </div>
      <p className="font-sans text-xs text-slate-400 mb-5 leading-relaxed">{description}</p>
      {children}
    </section>
  );
}

function SaveButton({
  accent,
  disabled,
  busy,
  label,
}: {
  accent: string;
  disabled: boolean;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      style={disabled ? undefined : { backgroundColor: accent, color: '#04121a' }}
      className={`px-5 py-2.5 rounded-xl font-display text-xs font-bold flex items-center gap-2 transition-all active:scale-95 ${
        disabled
          ? 'bg-white/5 text-slate-500 cursor-not-allowed'
          : 'hover:brightness-110 cursor-pointer'
      }`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {label}
    </button>
  );
}

/**
 * Message from a thrown `api.ts` error, with a readable fallback.
 * `apiFetch` already unwraps the envelope, so `err.message` is display-ready.
 */
function messageOf(err: unknown, fallback: string): string {
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
function useSubmitLatch() {
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

// ── 1. name + username ──────────────────────────────────────────────────────

function DetailsForm({ accent }: { accent: string }) {
  const { user, refresh } = useAuth();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  /*
   * Seeded from the context rather than held as initial state: `AuthProvider`
   * fetches on mount, so `user` is null on the first render and the fields would
   * otherwise stay permanently empty. Re-runs after `refresh()` too, which is
   * what re-syncs them once a save lands.
   */
  useEffect(() => {
    if (!user) return;
    setFirst(user.first_name ?? '');
    setLast(user.last_name ?? '');
    setUsername(user.username ?? '');
  }, [user]);

  const trimmed = { first: first.trim(), last: last.trim(), username: username.trim().toLowerCase() };
  const dirty =
    !!user &&
    (trimmed.first !== (user.first_name ?? '') ||
      trimmed.last !== (user.last_name ?? '') ||
      trimmed.username !== (user.username ?? ''));

  const usernameError = trimmed.username === (user?.username ?? '') ? null : usernameProblem(username);
  const namesOk = trimmed.first.length > 0 && trimmed.last.length > 0;
  const canSave = dirty && namesOk && !usernameError && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !user || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      // Only what actually changed — a no-op username send would 409 against
      // the caller's own row.
      await accountApi.updateProfile({
        ...(trimmed.first !== user.first_name ? { first_name: trimmed.first } : {}),
        ...(trimmed.last !== user.last_name ? { last_name: trimmed.last } : {}),
        ...(trimmed.username !== (user.username ?? '') ? { username: trimmed.username } : {}),
      });
      await refresh();
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not save your details.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  return (
    <Section
      icon={UserPen}
      title="Your details"
      description="Your name is what educators see. Your username is what you sign in with."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="First name"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            maxLength={60}
            autoComplete="given-name"
            disabled={!user}
          />
          <Field
            label="Last name"
            value={last}
            onChange={(e) => setLast(e.target.value)}
            maxLength={60}
            autoComplete="family-name"
            disabled={!user}
          />
        </div>

        <Field
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={30}
          autoComplete="username"
          spellCheck={false}
          disabled={!user}
          hint={usernameError ?? USERNAME_HINT}
        />

        <div className="flex items-center gap-4 flex-wrap">
          <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Save changes" />
          <StatusLine status={status} />
        </div>
      </form>
    </Section>
  );
}

// ── 2. email ────────────────────────────────────────────────────────────────

function EmailForm({ accent }: { accent: string }) {
  const { user, refresh } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const canSave = newEmail.trim().length > 3 && password.length > 0 && !busy && !!user;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await accountApi.changeEmail(password, newEmail.trim().toLowerCase());
      await refresh();
      setNewEmail('');
      setPassword('');
      setStatus({ kind: 'ok', text: 'Email updated. You still sign in with your username.' });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not change your email.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  return (
    <Section
      icon={AtSign}
      title="Email address"
      description="Where the school can reach you. Changing it does not change how you sign in."
    >
      <div className="mb-4 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
          Current
        </p>
        <p className="font-sans text-sm text-slate-200 break-all">
          {user?.email || 'None set'}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="New email"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={!user}
        />
        <Field
          label="Current password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={!user}
          hint="Confirms it is really you."
        />

        <div className="flex items-center gap-4 flex-wrap">
          <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Update email" />
          <StatusLine status={status} />
        </div>
      </form>
    </Section>
  );
}

// ── 3. password ─────────────────────────────────────────────────────────────

const MIN_PASSWORD = 8;

function PasswordForm({ accent }: { accent: string }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSave =
    !!user &&
    current.length > 0 &&
    next.length >= MIN_PASSWORD &&
    next === confirm &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      const revoked = await accountApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setStatus({
        kind: 'ok',
        text: revoked
          ? 'Password updated. Anyone signed in as you on another device has been signed out.'
          : 'Password updated. Other devices may still be signed in — sign out there manually.',
      });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not change your password.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  return (
    <Section
      icon={KeyRound}
      title="Password"
      description="Changing your password signs you out everywhere else, so use this if you think someone else has been in your account."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Current password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          disabled={!user}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="New password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            disabled={!user}
            hint={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : `At least ${MIN_PASSWORD} characters.`}
          />
          <Field
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={!user}
            hint={mismatch ? 'These do not match.' : undefined}
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Update password" />
          <StatusLine status={status} />
        </div>
      </form>
    </Section>
  );
}

// ── the set ─────────────────────────────────────────────────────────────────

export default function AccountForms({ accent }: { accent: string }) {
  return (
    <>
      <DetailsForm accent={accent} />
      <EmailForm accent={accent} />
      <PasswordForm accent={accent} />
    </>
  );
}
