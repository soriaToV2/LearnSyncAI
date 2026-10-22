import React, { useEffect, useState } from 'react';
import { AtSign, KeyRound, UserPen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  accountApi,
  codeProblem,
  isCodeValid,
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
 * The three account forms shared by every Profile page. Keep them separate: they hit different
 * endpoints with different authorisation, so one Save would let a bad password roll back a name change.
 * No role, status or grade fields: PATCH /auth/me refuses them.
 */

// Field, Section, SaveButton, StatusLine, messageOf and useSubmitLatch live in ./formKit.

// 1. Name + username

function DetailsForm({ accent }: { accent: string }) {
  const { user, refresh } = useAuth();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  // Seeded from context (user is null on first render); re-runs after refresh().
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
    // Only changed fields: re-sending your own username would 409.
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

// 2. Email

/** Two steps: mail a code to the new address, then redeem it. The pending address is re-sent on confirm. */
function EmailForm({ accent }: { accent: string }) {
  const { user, refresh } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Set once a code is sent; switches the form to step 2. */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const canSend = newEmail.trim().length > 3 && password.length > 0 && !busy && !!user;
  const canConfirm = isCodeValid(code) && !busy && !!pending;

  /** Step 1: verify the current password and mail the code. */
  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      const address = await accountApi.changeEmail(password, newEmail.trim().toLowerCase());
      setPending(address);
      // Clear the password once used; step 2 doesn't need it.
      setPassword('');
      setStatus({ kind: 'ok', text: `Code sent to ${address}. It expires in 15 minutes.` });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not send the code.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  /** Step 2: redeem the code (this applies the change). */
  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !pending || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await accountApi.confirmEmailChange(pending, code.trim());
      // refresh() re-reads /auth/me, which clears EmailRecoveryBanner once the address lands.
      await refresh();
      setPending(null);
      setNewEmail('');
      setCode('');
      setStatus({ kind: 'ok', text: 'Email updated. You still sign in with your username.' });
    } catch (err) {
      // Keep `pending` so a mistyped code stays on step 2.
      setCode('');
      setStatus({ kind: 'error', text: messageOf(err, 'Could not confirm that code.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  const startOver = () => {
    setPending(null);
    setCode('');
    setStatus(null);
  };

  return (
    <Section
      icon={AtSign}
      title="Email address"
      description="Where the school can reach you, and where a password-reset code would be sent. Changing it does not change how you sign in."
    >
        {/* bg-white/5 so the box has an edge against the Section's bg-white/[0.02]. */}
      <div className="mb-4 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
          Current
        </p>
        {/* Never print a non-address: test email_can_receive (catches placeholders and bare words like `admin`). */}
        <p className="font-sans text-sm text-slate-200 break-all">
          {user && user.email_can_receive ? user.email : 'None set'}
        </p>
      </div>

      {pending === null ? (
        <form onSubmit={requestCode} className="flex flex-col gap-4">
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
            <SaveButton accent={accent} disabled={!canSend} busy={busy} label="Send code" />
            <StatusLine status={status} />
          </div>
        </form>
      ) : (
        <form onSubmit={confirmCode} className="flex flex-col gap-4">
          <p className="font-sans text-xs leading-relaxed text-slate-400">
            Enter the 6-digit code sent to{' '}
            <span className="font-semibold text-slate-200 break-all">{pending}</span>. Check your
            spam folder if it has not arrived.
          </p>

          <Field
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            /* one-time-code lets a phone offer the code from the notification. */
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            placeholder="123456"
            hint={codeProblem(code) ?? undefined}
          />

          <div className="flex items-center gap-4 flex-wrap">
            <SaveButton accent={accent} disabled={!canConfirm} busy={busy} label="Confirm" />
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              className="font-sans text-xs font-semibold text-slate-400 transition-colors hover:text-white disabled:opacity-50"
            >
              Use a different address
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      )}
    </Section>
  );
}

// 3. Password

/* The rule lives in src/lib/account.ts, mirroring the server's PasswordField. */

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

// The set

export default function AccountForms({ accent }: { accent: string }) {
  return (
    <>
      <DetailsForm accent={accent} />
      <EmailForm accent={accent} />
      <PasswordForm accent={accent} />
    </>
  );
}
