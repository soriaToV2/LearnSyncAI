import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { api, type ApiRequestError } from '../../lib/api';
import { AuthShell, AuthField, BrandMark } from './authKit';

/**
 * Sign-in by username. POST /api/auth/login resolves it to the email server-side, so there is no
 * public username → email lookup to harvest addresses with. It also returns `role`, saving a read.
 */
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  /* Separate from `error` so a disabled account gets a different banner, not a red "wrong password". */
  const [isDisabledAccount, setIsDisabledAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setIsDisabledAccount(false);

    try {
      const { data } = await api.post<{
        session: Session;
        role: string;
        must_change_password: boolean;
      }>('/auth/login', {
        username: username.trim().toLowerCase(),
        password,
      });

      /* Installing the session is what signs the browser in; api.ts reads the JWT from this client. */
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw new Error('Signed in, but the session could not be saved.');

      /*
       * An un-activated account goes straight to /set-password (a shortcut; RequireRole and the server
       * enforce it). Admins go to the admin portal.
       */
      navigate(
        data.must_change_password
          ? '/set-password'
          : data.role === 'admin'
            ? '/admin/dashboard'
            : data.role === 'educator'
              ? '/educator/dashboard'
              : '/student/dashboard',
        { replace: true }
      );
    } catch (err: unknown) {
      /*
       * Failures are one generic message, so they can't reveal which usernames exist. The exception,
       * ACCOUNT_DISABLED, is sent only after the password checks out. Branch on the code, never the text.
       */
      const code = (err as ApiRequestError | undefined)?.code;
      setIsDisabledAccount(code === 'ACCOUNT_DISABLED');
      setError(err instanceof Error ? err.message : 'Incorrect username or password');
      setIsLoading(false);
    }
  };

  return (
    /* The only auth page that draws the light/dark toggle; the palette itself comes from AuthShell. */
    <AuthShell showModeToggle>
      <div className="flex flex-col items-center text-center mb-7">
        <BrandMark />
        {/* A <p>, not a heading: the page keeps one <h1>. */}
        <p className="font-display text-lg font-bold text-white tracking-tight mt-3">LearnSyncAI</p>
        {/* Greeting first. The line below says what's unusual here: sign in by username, issued by the school. */}
        <h1 className="font-display text-3xl font-bold text-white mt-6">Welcome back</h1>
        <p className="font-sans text-sm text-slate-400 mt-2">
          Sign in with your school username.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleLogin}>
        {/* Two shapes: a wrong password keeps the red alert; a disabled account is a state, so a lock, amber, and who can undo it. Both role="alert". */}
        {error && (
          isDisabledAccount ? (
            <div
              role="alert"
              className="bg-amber-500/10 border border-amber-500/30 text-amber-800 px-4 py-3 rounded-xl font-sans text-sm flex items-start gap-2.5 fade-in"
            >
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold">Account deactivated</p>
                <p className="text-amber-700 text-xs mt-1 leading-relaxed">{error}</p>
              </div>
            </div>
          ) : (
            <div
              role="alert"
              className="bg-rose-500/10 border border-rose-500/30 text-rose-700 px-4 py-3 rounded-xl font-sans text-sm flex items-start gap-2.5 fade-in"
            >
              <span className="shrink-0 w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center font-bold text-xs mt-px">
                !
              </span>
              <p>{error}</p>
            </div>
          )
        )}

        <AuthField
          id="username"
          label="Username"
          type="text"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          inputProps={{ spellCheck: false, autoCapitalize: 'none' }}
        />

        <AuthField
          id="password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={setPassword}
          /* current-password, not new-password, which makes password managers offer to generate one. */
          autoComplete="current-password"
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

        {/* Links to the mail flow. Don't promise a reset works: accounts without a deliverable address still need an administrator. */}
        <div className="flex justify-end -mt-0.5">
          <Link
            to="/forgot-password"
            className="font-sans text-xs font-semibold text-primary-fixed-dim hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="mt-3 w-full bg-primary-fixed-dim text-on-primary-fixed font-display text-sm font-bold py-3 px-6 rounded-xl hover:brightness-110 transition-all active:scale-[0.98] flex justify-center items-center gap-2 disabled:opacity-70 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
        >
          {isLoading ? <Spinner className="w-4 h-4" /> : 'Sign in'}
        </button>
      </form>

      {/* One line instead of "remember me", Google sign-in and sign-up: none could work here (no self-registration, and a Google identity carries no role or grade). */}
      <p className="mt-6 pt-5 border-t border-white/5 font-sans text-xs text-slate-500 text-center leading-relaxed">
        Accounts are created by your school administrator.
      </p>
    </AuthShell>
  );
}
