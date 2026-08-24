import React, { useEffect, useState } from 'react';
import { AtSign, KeyRound, UserPen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  accountApi,
  isPasswordValid,
  passwordProblem,
  PASSWORD_HINT,
  USERNAME_HINT,
  usernameProblem,
} from '../../lib/account';
import {
  Field,
  Section,
  SaveButton,
  StatusLine,
  messageOf,
  useSubmitLatch,
  type Status,
} from './formKit';

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

/*
 * `Field`, `Section`, `SaveButton`, `StatusLine`, `messageOf` and
 * `useSubmitLatch` moved to `./formKit` when the admin portal needed the same
 * pieces. Behaviour is unchanged — see that file for why the latch in particular
 * must not exist in two copies.
 */

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
      {/* `bg-white/5` for the same reason as `ProfileCard`'s fact tiles — the
          `Section` behind this is `bg-white/[0.02]`, so at the same value the
          box had no edge against its own container. */}
      <div className="mb-4 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
          Current
        </p>
        {/*
          ⚠️ NEVER PRINT A PLACEHOLDER ADDRESS. A bulk-created account carries
          `<username>@pca.invalid` on `auth.users`, and showing it here would
          present a fabricated address to the student as though it were theirs —
          the same mistake as the invented `liza.mendoza@pca.edu.ph`, with better
          intentions. The admin account page has always checked this; this page
          did not, and showed it.
        */}
        <p className="font-sans text-sm text-slate-200 break-all">
          {user && user.email && !user.email_is_placeholder ? user.email : 'None set'}
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

/* The rule lives in `src/lib/account.ts`, mirroring the server's `PasswordField`. */

function PasswordForm({ accent }: { accent: string }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const passwordError = passwordProblem(next);
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSave = !!user && current.length > 0 && isPasswordValid(next) && next === confirm && !busy;

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
            hint={passwordError ?? PASSWORD_HINT}
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
