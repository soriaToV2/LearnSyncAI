import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { api, type ApiRequestError } from '../../lib/api';
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
  /* Tracked separately from `error` so the banner can change SHAPE, not just
     wording. A deactivated account is not a typo, and dressing it in the same
     red "!" as a wrong password invites the student to retype a password that
     was never the problem — which is exactly what they did before this. */
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
      /*
       * Messages arrive display-ready and are deliberately generic — the route
       * returns one sentence for every failure so it cannot be used to test
       * which usernames exist.
       *
       * ⚠️ THE ONE EXCEPTION IS `ACCOUNT_DISABLED`, and the server only sends it
       * AFTER the password has been verified, so it is not an oracle. It is
       * branched on the CODE, never on the message text: that text is user-facing
       * copy someone will reword, and a string match would fail silently the
       * first time they did.
       */
      const code = (err as ApiRequestError | undefined)?.code;
      setIsDisabledAccount(code === 'ACCOUNT_DISABLED');
      setError(err instanceof Error ? err.message : 'Incorrect username or password');
      setIsLoading(false);
    }
  };

  return (
    /* ⚠️ THE ONLY AUTH PAGE THAT DRAWS THE LIGHT/DARK TOGGLE. Everybody passes
       through sign-in and it is the only auth page reached cold; the other two
       are mid-flow and both link back here. The palette itself is still
       `AuthShell`'s, applied on all three from one stored key — this prop draws
       the control, it does not pin a mode. Do not reintroduce a per-page `mode`;
       see the shell's header. */
    <AuthShell showModeToggle>
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
        {/*
          ⚠️ THE GREETING LEADS AND THE SUPPORTING LINE FOLLOWS. It used to be
          the other way round — "Please enter your details" sat ABOVE "Welcome
          back" as an eyebrow, so the page issued an instruction before it said
          hello. An eyebrow line works when it gives context; it does not work
          when it gives an order.

          The line also has to EARN its place, because two labelled fields sit
          directly beneath it already saying "type your username and password".
          "Please enter your details" said only that, in more words and in the
          language of a form rather than a school. What it says now answers the
          one question this screen genuinely raises: sign-in is by USERNAME, not
          email — unusual enough that the field was mislabelled "Email or
          Username" until migration 0021 — and there is no self-registration, so
          "your school" is also the honest answer to where it came from.
        */}
        <h1 className="font-display text-3xl font-bold text-white mt-6">Welcome back</h1>
        <p className="font-sans text-sm text-slate-400 mt-2">
          Sign in with your school username.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleLogin}>
        {/*
          ⚠️ TWO SHAPES, NOT TWO COLOURS OF THE SAME SHAPE.

          A wrong password is something the person can fix by trying again, so it
          keeps the red alert. A deactivated account is a STATE, not a mistake —
          nothing they type will change it — so it drops the "!" for a lock, goes
          amber, and adds the one line that actually helps: who can undo it.
          Presented identically to a typo, students retype the password until they
          lock themselves out of trying.

          Both are `role="alert"`, so either way a screen reader announces the
          change without the field losing focus.
        */}
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
