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

/**
 * ⚠️ TWO STEPS, BECAUSE AN UNPROVEN ADDRESS IS AN ACCOUNT-TAKEOVER ROUTE. This
 * form used to apply the change in one call. Now step 1 mails a 6-digit code to
 * the address the user typed and step 2 redeems it — so an address only lands on
 * the account once someone has read mail sent to it.
 *
 * The pending address is held in component state and re-sent on confirm rather
 * than remembered server-side. The user typed it moments ago, so showing it back
 * discloses nothing, and Supabase is the authority regardless: the code was
 * minted against that address and will not redeem against another.
 */
function EmailForm({ accent }: { accent: string }) {
  const { user, refresh } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Set once a code has been sent — this is what swaps the form to step 2. */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const canSend = newEmail.trim().length > 3 && password.length > 0 && !busy && !!user;
  const canConfirm = isCodeValid(code) && !busy && !!pending;

  /** Step 1 — prove the current password, then ask Supabase to mail the code. */
  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      const address = await accountApi.changeEmail(password, newEmail.trim().toLowerCase());
      setPending(address);
      /*
       * The password is cleared as soon as it has done its job — step 2 does not
       * re-check it, and leaving it in a live input on a shared school computer
       * is exactly the situation the re-check exists to defend against.
       */
      setPassword('');
      setStatus({ kind: 'ok', text: `Code sent to ${address}. It expires in 15 minutes.` });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not send the code.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  /** Step 2 — redeem it. Supabase applies the change as part of this. */
  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !pending || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await accountApi.confirmEmailChange(pending, code.trim());
      /*
       * `refresh()` re-reads `GET /auth/me`, which is what clears
       * `EmailRecoveryBanner` — it gates on `email_can_receive`, and that only
       * turns true once the address actually lands on the account.
       */
      await refresh();
      setPending(null);
      setNewEmail('');
      setCode('');
      setStatus({ kind: 'ok', text: 'Email updated. You still sign in with your username.' });
    } catch (err) {
      /*
       * The code field is cleared but `pending` is kept, so a mistyped code
       * leaves the user on step 2 with the address intact rather than sending
       * them back to re-enter their password for a code that is still valid.
       */
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
      {/* `bg-white/5` for the same reason as `ProfileCard`'s fact tiles — the
          `Section` behind this is `bg-white/[0.02]`, so at the same value the
          box had no edge against its own container. */}
      <div className="mb-4 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
          Current
        </p>
        {/*
          ⚠️ NEVER PRINT AN ADDRESS THAT IS NOT ONE. A bulk-created account carries
          `<username>@pca.invalid` on `auth.users`, and showing it here would
          present a fabricated address to the student as though it were theirs —
          the same mistake as the invented `liza.mendoza@pca.edu.ph`, with better
          intentions. The admin account page has always checked this; this page
          did not, and showed it.

          ⚠️ IT TESTS `email_can_receive`, NOT `email_is_placeholder`, AND THE
          DIFFERENCE WAS A LIVE BUG. The placeholder flag only catches the
          `@pca.invalid` suffix, so it is false for `admin` and `educ1` — whose
          addresses are the bare words migration 0021 left behind. This form
          printed `admin` to the administrator as their own contact address.
        */}
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
            /* `one-time-code` is what lets a phone offer the code from the
               notification rather than making the user switch apps to read it. */
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
