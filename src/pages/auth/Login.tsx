import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { AuthShell, AuthField, BrandMark } from './authKit';

/**
 * ⚠️ SIGN-IN IS BY USERNAME, AND THE TRANSLATION HAPPENS ON THE SERVER.
 *
 * This page used to call `supabase.auth.signInWithPassword({ email })` with
 * whatever was typed into a field labelled "Email or Username" — which worked
 * only because `auth.users.email` happened to hold username-like strings
 * (`student`, `educ1`, `admin`). Migration 0021 gave the username its own column
 * and `POST /api/auth/login` resolves it to the email server-side.
 *
 * The resolution is NOT done here on purpose. A public "what email is this
 * username?" call needs no password, so anyone could work through plausible
 * usernames and harvest the real addresses of 12-to-16-year-olds. The username
 * and password now travel together and the email never reaches the browser.
 *
 * It also removes a round trip: the route returns `role` alongside the session,
 * so there is no second `profiles` select to decide which portal to open.
 */
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data } = await api.post<{
        session: Session;
        role: string;
        must_change_password: boolean;
      }>('/auth/login', {
        username: username.trim().toLowerCase(),
        password,
      });

      /*
       * The server verified the credentials; installing the session is what makes
       * the browser signed in, since `api.ts` reads the JWT from the Supabase
       * client on every subsequent call.
       */
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw new Error('Signed in, but the session could not be saved.');

      /*
       * An account still holding the password an administrator set goes straight
       * to `/set-password`, whatever its role. Sending it to a portal first would
       * render a dashboard whose every request `requireRole` refuses with a 403,
       * and nothing on screen would say why. This is a shortcut, not the
       * enforcement: `RequireRole` catches the same condition on any other entry
       * point, and the server refuses regardless.
       *
       * ⚠️ ADMINS GO TO THE ADMIN PORTAL. They used to be sent to
       * `/educator/dashboard` alongside educators, where `requireRole('educator')`
       * 403s every single data call — so the one admin account could sign in and
       * then do nothing at all.
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
      // Already display-ready and deliberately generic — the route returns one
      // message for every failure so it cannot be used to test which usernames exist.
      setError(err instanceof Error ? err.message : 'Incorrect username or password');
      setIsLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center mb-7">
        <BrandMark />
        {/* The wordmark is a `<p>`, not a heading — the page keeps ONE `<h1>`,
            and it is "Welcome back", which is what this screen is about. A
            product name stacked above it as a second heading would give the
            document two competing top-level titles for a screen with one job.
            It sits tight under the mark (`mt-3`) so the two read as one logo
            lockup, with the larger gap below separating the brand from the
            greeting. */}
        <p className="font-display text-lg font-bold text-white tracking-tight mt-3">LearnSyncAI</p>
        <p className="font-sans text-xs text-slate-500 mt-6">Please enter your details</p>
        <h1 className="font-display text-3xl font-bold text-white mt-1">Welcome back</h1>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleLogin}>
        {error && (
          <div
            role="alert"
            className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-4 py-3 rounded-xl font-sans text-sm flex items-start gap-2.5 fade-in"
          >
            <span className="shrink-0 w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center font-bold text-xs mt-px">
              !
            </span>
            <p>{error}</p>
          </div>
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
          /* ⚠️ `current-password`, NOT `new-password`. This is a sign-in form;
             `new-password` tells a password manager to offer to GENERATE one
             rather than fill the saved one, so the field fought the browser on
             every visit. */
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

        {/*
          ⚠️ IT IS A `<Link>` NOW BECAUSE THERE IS SOMEWHERE TO GO. This was a
          `<button>` toggling an inline "ask your administrator" hint, and before
          that an `<a href="#">` that scrolled the page to the top — a placeholder
          held open for the mail flow. `/forgot-password` is that flow.

          ⚠️ IT DOES NOT PROMISE A RESET WILL WORK, and must not start to. Only an
          account with a deliverable address can recover itself; everyone else
          still needs an administrator (`POST /api/admin/accounts/:userId/password`),
          which is what the old hint said. That fallback is now stated on the
          second screen of `/forgot-password`, where it can be phrased without
          revealing whether this particular username has an address on file.
        */}
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

      {/*
        ⚠️ ONE LINE, AND IT REPLACES THREE CONTROLS THAT COULD NOT WORK.
        (Forgot password is NOT one of them — it is a real link above now, to the
        mail flow this comment used to describe as "coming".)

        "Remember for 30 days" — an unbound checkbox with nothing to bind it to:
        `supabase-js` persists the session to localStorage regardless, so it
        offered a choice the library does not expose, and 30 days is not the
        refresh-token lifetime either.

        "Sign in with Google" — removed at the team's request, and the reasoning
        holds all the way down: an account here carries a role and a grade level
        that decide which materials it can open, and a Google identity supplies
        neither. It was inert anyway — no `onClick`, no provider configured, and
        `signInWithOAuth` appears nowhere in the codebase.

        "Don't have an account? Sign up" — the page it pointed at is deleted.
      */}
      <p className="mt-6 pt-5 border-t border-white/5 font-sans text-xs text-slate-500 text-center leading-relaxed">
        Accounts are created by your school administrator.
      </p>
    </AuthShell>
  );
}
