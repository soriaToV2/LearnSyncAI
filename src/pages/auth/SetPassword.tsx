import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { AuthShell, BrandMark } from './authKit';
import { AuthProvider, useAuth, displayName } from '../../context/AuthContext';
import { accountApi, isPasswordValid, passwordProblem, PASSWORD_HINT } from '../../lib/account';
import { signOut } from '../../lib/signOut';
import { Field, StatusLine, messageOf, useSubmitLatch, type Status } from '../../components/common/formKit';

/**
 * First login: replace the password an administrator gave you. Mounted outside all layouts, or
 * RequireRole's redirect here would loop. Carries its own AuthProvider (GET /me stays ungated). The
 * copy explains why: whoever picked the password could sign in as you.
 */

/* The rule lives in `src/lib/account.ts`, mirroring the server's `PasswordField`. */

function SetPasswordInner() {
  const { user, isLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  const homeFor = (role: string) =>
    role === 'admin' ? '/admin/dashboard' : role === 'educator' ? '/educator/dashboard' : '/student/dashboard';

  /* Already activated (bookmark, second tab)? Send them on. */
  useEffect(() => {
    if (!isLoading && user && !user.must_change_password) {
      navigate(homeFor(user.role), { replace: true });
    }
  }, [isLoading, user, navigate]);

  const passwordError = passwordProblem(next);
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const canSave =
    !!user &&
    current.length > 0 &&
    isPasswordValid(next) &&
    next === confirm &&
    !sameAsCurrent &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !user || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await accountApi.changePassword(current, next);
      /* Re-read before navigating, or RequireRole still sees the old flag and bounces back here. */
      await refresh();
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not set your password.') });
      setBusy(false);
      latch.release();
    }
  };

  /* A wrong account on a shared computer must not be a dead end. */
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('[auth] sign-out failed, redirecting anyway', err);
    } finally {
      navigate('/login', { replace: true });
    }
  };

  /* AuthShell owns the palette (chosen on /login). */
  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center mb-7">
        <BrandMark />
        <p className="font-display text-lg font-bold text-white tracking-tight mt-3">LearnSyncAI</p>
      </div>

      <div>
          <div className="flex items-center gap-2.5 mb-2">
            <KeyRound className="w-4 h-4 text-primary-fixed-dim shrink-0" />
            <h1 className="font-display text-lg sm:text-xl font-bold text-white break-words">
              {user ? `Welcome, ${displayName(user)}` : 'Set your password'}
            </h1>
          </div>

          <p className="font-sans text-sm text-slate-400 leading-relaxed mb-1">
            Before you start, choose a password only you know.
          </p>
          <p className="font-sans text-xs text-slate-500 leading-relaxed mb-6">
            The password you signed in with was created by an administrator, so it is not private
            yet. Once you set your own, nobody else can sign in as you.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field
              label="The password you just used"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              disabled={!user}
            />

            <Field
              label="New password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={!user}
              hint={
                sameAsCurrent
                  ? 'Choose something different from the one you were given.'
                  : (passwordError ??
                    `${PASSWORD_HINT}. Pick something you will remember.`)
              }
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

            {/* Accent from the tokens, not a JS constant, so it follows the light/dark palette. */}
            <button
              type="submit"
              disabled={!canSave}
              className={`mt-1 w-full py-3 rounded-xl font-display text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                canSave
                  ? 'bg-primary-fixed-dim text-on-primary-fixed hover:brightness-110'
                  : 'bg-white/5 text-slate-500 cursor-not-allowed'
              }`}
            >
              {busy && <Spinner className="w-4 h-4" />}
              Set my password and continue
            </button>

            <StatusLine status={status} />
          </form>

          {/* flex-col below sm: so the sentence isn't squeezed beside the button. */}
          <div className="mt-6 pt-5 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <p className="font-sans text-[11px] text-slate-500 flex items-start gap-2 leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
              If you forget it, an administrator can reset it for you — or add an email address
              on your profile to reset it yourself.
            </p>
            <button
              onClick={handleSignOut}
              className="shrink-0 self-start sm:self-auto flex items-center gap-1.5 font-sans text-[11px] text-slate-400 hover:text-white transition-colors rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-fixed-dim"
            >
              <LogOut className="w-3.5 h-3.5" />
              Not you?
            </button>
          </div>
      </div>
    </AuthShell>
  );
}

export default function SetPassword() {
  return (
    <AuthProvider>
      <SetPasswordInner />
    </AuthProvider>
  );
}
