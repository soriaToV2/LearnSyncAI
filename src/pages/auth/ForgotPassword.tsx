import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { AuthShell, AuthField, AuthCodeInput, BrandMark } from './authKit';
import {
  recoveryApi,
  isCodeValid,
  isPasswordValid,
  passwordProblem,
  PASSWORD_HINT,
} from '../../lib/account';

/**
 * Self-service password reset by mailed code, for accounts with a deliverable address; everyone else
 * goes through an administrator.
 *
 * Screen 2 is reached whatever happens: the server answers identically for every case, so the page
 * can't reveal which usernames exist. Never add a branch that reports whether mail was sent, and
 * never show the address, not even masked.
 *
 * Mounted outside every layout, since RequireRole would bounce a signed-out visitor.
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

    /* No catch branch that changes the outcome: advance even on a network error (the code may have been sent). */
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
      /* To /login, not into the app: the server discards the OTP session, and signing in confirms the new password. */
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      /* Clear only the code, so a typo doesn't cost the password they just typed twice. */
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
          className="bg-rose-500/10 border border-rose-500/30 text-rose-700 px-4 py-3 rounded-xl font-sans text-sm flex items-start gap-2.5 fade-in mb-3"
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
          {/* Both halves matter: "if that username has an email saved" (the server won't say), and the administrator fallback. */}
          {/* bg-white/5, not bg-white/[0.03]: only the former has a white-theme rule, so the other vanishes on the white card. */}
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 mb-1">
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

          {/* Six boxes: known length, copied from an email, fillable from a notification. See AuthCodeInput. */}
          <AuthCodeInput id="code" label="6-digit code" value={code} onChange={setCode} />

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

          {/* The rule comes from src/lib/account.ts, which mirrors the server. */}
          <p
            className={`font-sans text-xs leading-relaxed ${
              mismatch || passwordError ? 'text-amber-700' : 'text-slate-500'
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
