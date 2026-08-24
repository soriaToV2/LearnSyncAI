import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { ACTIVE_THEME, inkOn } from '../../context/ThemeContext';
import { AuthShell, BrandMark } from './authKit';
import { AuthProvider, useAuth, displayName } from '../../context/AuthContext';
import { accountApi, isPasswordValid, passwordProblem, PASSWORD_HINT } from '../../lib/account';
import { signOut } from '../../lib/signOut';
import { Field, StatusLine, messageOf, useSubmitLatch, type Status } from '../../components/common/formKit';

/**
 * First login — replace the password an administrator gave you.
 *
 * ⚠️ MOUNTED OUTSIDE ALL THREE LAYOUTS, beside `/login`. `RequireRole` redirects
 * here whenever `must_change_password` is set; if this page lived inside a
 * guarded layout that redirect would fire again on arrival and loop forever.
 *
 * It carries its own `AuthProvider` for the same reason the layouts do — it needs
 * `GET /api/auth/me`, which is one of the two routes deliberately left outside
 * the server-side gate (the other is the change-password call below). Everything
 * else answers 403 until this form succeeds.
 *
 * The copy explains WHY rather than just demanding. A student who is told "you
 * must change your password" with no reason assumes the app is broken; told that
 * a teacher picked the password and can therefore sign in as them, they
 * understand the point immediately.
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

  /*
   * Someone who lands here already activated — a bookmark, or a second tab open
   * from before the change — should not be asked again. Sending them on is
   * friendlier than showing a form that would be a no-op.
   */
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
      /*
       * The server cleared `must_change_password` as part of that call. Re-read
       * before navigating, or `RequireRole` at the destination still sees the old
       * value and bounces straight back here.
       */
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

  /*
    ⚠️ THIS PAGE NOW USES `AuthShell`, WHICH IT WAS ALWAYS SUPPOSED TO — the
    shell's own header says so ("SetPassword still hand-builds its own shell and
    can adopt this unchanged"). It was the last screen carrying the 4rem
    graph-paper grid that was removed from Login as reading like dashboard chrome
    that had lost its content, plus its own tinted blur, its own card, its own
    brand lockup and its own `applyThemeToElement` call.

    That mattered more here than anywhere: this is the FIRST screen a student
    ever reaches after signing in, arriving directly from Login — so the two
    screens sitting one click apart looked like two different products.

    `wrapperRef` and the theme effect are gone with it; `AuthShell` pins
    `ACTIVE_THEME` itself.
  */
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
                    `${PASSWORD_HINT}. Pick something you will remember — there is no email reset.`)
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

            <button
              type="submit"
              disabled={!canSave}
              style={canSave ? { backgroundColor: ACTIVE_THEME.accent, color: inkOn(ACTIVE_THEME.accent) } : undefined}
              className={`mt-1 w-full py-3 rounded-xl font-display text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                canSave ? 'hover:brightness-110' : 'bg-white/5 text-slate-500 cursor-not-allowed'
              }`}
            >
              {busy && <Spinner className="w-4 h-4" />}
              Set my password and continue
            </button>

            <StatusLine status={status} />
          </form>

          {/* `flex-col` below `sm:`: the sentence and the escape hatch are
              ~230px and ~70px, and side by side inside a 400px card minus its
              padding they leave the sentence about 250px — it wrapped to three
              lines beside a one-line button. */}
          <div className="mt-6 pt-5 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <p className="font-sans text-[11px] text-slate-500 flex items-start gap-2 leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
              If you forget it, an administrator can reset it for you.
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
