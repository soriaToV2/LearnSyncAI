import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { AuthShell, AuthField, BrandMark } from './authKit';
import {
  recoveryApi,
  isCodeValid,
  isPasswordValid,
  passwordProblem,
  PASSWORD_HINT,
} from '../../lib/account';

/**
 * Self-service password reset — TIER 1 of two, and the one that can fail to be
 * available.
 *
 * An account with a deliverable address recovers itself here with a mailed code.
 * Every other account — no address, a `@pca.invalid` placeholder from CSV import,
 * or one of the bare words migration 0021 left in `auth.users.email` — still goes
 * through an administrator, which is Tier 2 and is the guarantee that never
 * moves. That is why the copy on screen 2 names the fallback explicitly.
 *
 * ⚠️ SCREEN 2 IS REACHED WHATEVER HAPPENS, AND THAT IS THE WHOLE DESIGN.
 * `POST /forgot-password` answers 200 identically for an unknown username, a
 * disabled account, an address nothing can be delivered to, a throttled caller
 * and a successful send. These usernames belong to identifiable minors at one
 * named school, so a screen that said "no such user" would be an oracle for which
 * children attend it. Do not add a branch here that reports whether mail was
 * actually sent — the server deliberately does not say.
 *
 * ⚠️ THE ADDRESS IS NEVER SHOWN, NOT EVEN MASKED. `m•••@gmail.com` is ordinary
 * practice elsewhere and is wrong here: a domain and a first letter are still a
 * partial disclosure about a child to whoever typed the username. The
 * "nothing arriving?" paragraph is what replaces it — it strands nobody while
 * disclosing nothing, which is the trade masking normally fails to make.
 *
 * MOUNTED OUTSIDE EVERY LAYOUT, beside `/login` and `/set-password`. It is
 * unauthenticated by definition, so it must not sit inside a shell whose
 * `RequireRole` would bounce a signed-out visitor straight back to `/login`.
 */
export default function ForgotPassword() {
  const [step, setStep] = useState<'username' | 'code'>('username');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const normalised = username.trim().toLowerCase();
  const mismatch = confirm.length > 0 && password !== confirm;
  const canReset = isCodeValid(code) && isPasswordValid(password) && password === confirm;

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || normalised.length === 0) return;
    setIsLoading(true);
    setError('');

    /*
     * ⚠️ NO `catch` BRANCH THAT CHANGES THE OUTCOME. The route cannot fail in a
     * way the user may see, so a network error is the only thing that can land
     * here — and even then, advancing is right: the code may well have been sent.
     * Reporting "that username does not exist" is precisely what this flow must
     * never do.
     */
    try {
      await recoveryApi.requestPasswordReset(normalised);
    } catch {
      /* Deliberately swallowed — see above. */
    } finally {
      setIsLoading(false);
      setStep('code');
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !canReset) return;
    setIsLoading(true);
    setError('');

    try {
      await recoveryApi.resetPassword(normalised, code.trim(), password);
      /*
       * ⚠️ TO `/login`, NOT INTO THE APP. The server deliberately discards the
       * session `verifyOtp` produced: a session derived from an emailed code is
       * weaker proof than one derived from a password, and the user has a
       * password now. Signing in with it also confirms it works while they are
       * still on the page that set it.
       */
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      /*
       * The password fields keep their values and only the code is cleared — a
       * mistyped code should not cost someone the password they just composed
       * and typed twice.
       */
      setCode('');
      setError(err instanceof Error ? err.message : 'That code is not valid or has expired.');
      setIsLoading(false);
    }
  };

  const passwordError = passwordProblem(password);

  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center mb-7">
        <BrandMark />
        <p className="font-display text-lg font-bold text-white tracking-tight mt-3">LearnSyncAI</p>
        <p className="font-sans text-xs text-slate-500 mt-6">
          {step === 'username' ? 'Password recovery' : 'Check your email'}
        </p>
        {/* One `<h1>` per screen, and it names what this screen is for. */}
        <h1 className="font-display text-3xl font-bold text-white mt-1">
          {step === 'username' ? 'Forgot password' : 'Enter your code'}
        </h1>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-4 py-3 rounded-xl font-sans text-sm flex items-start gap-2.5 fade-in mb-3"
        >
          <span className="shrink-0 w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center font-bold text-xs mt-px">
            !
          </span>
          <p>{error}</p>
        </div>
      )}

      {step === 'username' ? (
        <form className="flex flex-col gap-3" onSubmit={requestCode}>
          <p className="font-sans text-xs text-slate-400 leading-relaxed mb-1">
            Enter your username and we will email you a 6-digit code — if your account has an email
            address saved.
          </p>

          <AuthField
            id="username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            inputProps={{ spellCheck: false, autoCapitalize: 'none' }}
          />

          <button
            type="submit"
            disabled={isLoading || normalised.length === 0}
            className="mt-3 w-full bg-primary-fixed-dim text-on-primary-fixed font-display text-sm font-bold py-3 px-6 rounded-xl hover:brightness-110 transition-all active:scale-[0.98] flex justify-center items-center gap-2 disabled:opacity-70 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
          >
            {isLoading ? <Spinner className="w-4 h-4" /> : 'Send code'}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submitReset}>
          {/*
            ⚠️ THIS PARAGRAPH IS THE MOST IMPORTANT TEXT IN THE FEATURE, and both
            halves are load-bearing. The first sentence is conditional ("if that
            username has an email saved") because the server will not say whether
            it does. The second names the fallback, which is what stops a uniform
            response from stranding anyone: a student whose account has no address
            would otherwise sit here waiting for mail that is never coming.
          */}
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 mb-1">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-fixed-dim" aria-hidden="true" />
            <div className="font-sans text-xs leading-relaxed text-slate-400">
              <p>
                If that username has an email saved, a 6-digit code is on its way. It expires in 15
                minutes — check your spam folder too.
              </p>
              <p className="mt-2">
                <span className="font-semibold text-slate-300">Nothing arriving?</span> Your account
                may not have an email saved. Ask your teacher or the school administrator to reset
                your password for you.
              </p>
            </div>
          </div>

          <AuthField
            id="code"
            label="6-digit code"
            type="text"
            value={code}
            onChange={setCode}
            /* `one-time-code` lets a phone offer the code straight from the
               notification instead of making the user switch apps to read it. */
            autoComplete="one-time-code"
            inputProps={{ inputMode: 'numeric', maxLength: 6, spellCheck: false }}
          />

          <AuthField
            id="new-password"
            label="New password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 px-4 flex items-center text-slate-500 hover:text-white transition-colors rounded-r-xl focus-visible:outline-none focus-visible:text-primary-fixed-dim"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />

          <AuthField
            id="confirm-password"
            label="Confirm new password"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />

          {/* The rule comes from `src/lib/account.ts`, which mirrors the server's
              `PasswordField` — so this page cannot disagree with the other three
              places a password is chosen about what is acceptable. */}
          <p
            className={`font-sans text-xs leading-relaxed ${
              mismatch || passwordError ? 'text-amber-300' : 'text-slate-500'
            }`}
          >
            {mismatch ? 'These do not match.' : (passwordError ?? PASSWORD_HINT)}
          </p>

          <button
            type="submit"
            disabled={isLoading || !canReset}
            className="mt-2 w-full bg-primary-fixed-dim text-on-primary-fixed font-display text-sm font-bold py-3 px-6 rounded-xl hover:brightness-110 transition-all active:scale-[0.98] flex justify-center items-center gap-2 disabled:opacity-70 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
          >
            {isLoading ? <Spinner className="w-4 h-4" /> : 'Set new password'}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep('username');
              setCode('');
              setError('');
            }}
            className="font-sans text-xs font-semibold text-slate-400 hover:text-white transition-colors mt-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim"
          >
            Use a different username
          </button>
        </form>
      )}

      <p className="mt-6 pt-5 border-t border-white/5 text-center">
        <Link
          to="/login"
          className="font-sans text-xs font-semibold text-slate-500 hover:text-white transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
