import { Router, Request, Response } from 'express';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase';
import {
  ephemeralAnonClient,
  sessionClientForPassword,
  signInWithPassword,
  verifyPassword,
} from '../lib/authClient';
import {
  canSend,
  canVerify,
  clearThrottle,
  noteSend,
  noteVerifyFailure,
} from '../lib/otpThrottle';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { canReceiveMail, isPlaceholderEmail } from '../lib/placeholderEmail';
import {
  RegisterSchema,
  LoginSchema,
  UpdateProfileSchema,
  ChangePasswordSchema,
  ChangeEmailSchema,
  ConfirmEmailChangeSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '../types/api';

const router = Router();

/**
 * The columns `GET /api/auth/me` and `PATCH /api/auth/me` return.
 *
 * Listed explicitly rather than `*` because the client types against this shape;
 * a column added to `profiles` should not silently widen the payload.
 */
const PROFILE_COLUMNS =
  'id, role, username, first_name, last_name, grade_level, status, must_change_password, created_at';

/**
 * ⚠️ FOUR OF THIS FILE'S ROUTES ARE FULLY UNAUTHENTICATED, WHICH IS A STRONGER
 * CLAIM THAN SKIPPING `requireRole`. They run `authenticate` too.
 *
 *   POST /register         no caller; see its own note
 *   POST /login            the way in
 *   POST /forgot-password  the caller cannot sign in — that is the whole premise
 *   POST /reset-password   likewise
 *
 * The last two are the ones to be careful with. Both take a USERNAME from an
 * anonymous caller, so both are shaped by the same doctrine as `/login`: one
 * response for every outcome, and the address resolved server-side so it never
 * reaches the browser. See each route's own note.
 *
 * ⚠️ TWO FURTHER ROUTES MUST NEVER BE PUT BEHIND `requireRole`, AND THIS IS WHY.
 *
 * `requireRole` refuses every request from an account that still holds an
 * administrator-set password (403 `PASSWORD_CHANGE_REQUIRED`). The only way out
 * of that state is to change the password — so if the route that changes it, or
 * the route that tells the client who it is, were gated, a newly created account
 * would be permanently unusable with no recovery short of the database.
 *
 *   GET  /me              OPEN — the set-password page needs the caller's identity
 *   POST /change-password OPEN — this is the exit
 *   PATCH /me             gated — no renaming yourself before activating
 *   POST /change-email    gated — likewise
 *
 * `authenticate` alone still proves a valid session, and both open routes act on
 * `req.user!.id` only, so neither can be pointed at another account.
 */

/**
 * Postgres unique-violation. Raised by `ux_profiles_username_lower` when a
 * username is already taken — case-insensitively, so `Juan` collides with `juan`.
 */
const UNIQUE_VIOLATION = '23505';

/**
 * ⚠️ ONE MESSAGE FOR EVERY LOGIN FAILURE.
 *
 * Unknown username, wrong password, NULL username and a disabled account all
 * return this. `POST /api/auth/login` is unauthenticated, so any response that
 * distinguishes them turns the endpoint into an oracle for which usernames
 * exist — and this platform's usernames belong to identifiable minors at one
 * named school.
 */
const LOGIN_FAILED = 'Incorrect username or password';

/**
 * The ONE failure this route is allowed to describe, and the reason it is not a
 * hole in the rule above.
 *
 * ⚠️ IT IS RETURNED ONLY AFTER `signInWithPassword` HAS SUCCEEDED. That is the
 * whole safety argument: the caller has proved they own the account, so telling
 * them their own account is disabled reveals nothing to a guesser. Answering
 * before the password check — which is what this route used to do, folding
 * `status !== 'active'` into the same branch as an unknown username — would make
 * the endpoint an oracle for which usernames exist, and this platform's
 * usernames belong to identifiable minors at one named school.
 *
 * It is the same argument, at the same point in the flow, that already permits
 * `must_change_password` to be disclosed below.
 *
 * ⚠️ THE SESSION IS DISCARDED, NOT RETURNED. Supabase knows nothing about our
 * `profiles.status` column, so it happily mints a session for an account we
 * consider disabled; that session must never reach the browser. `requireRole`
 * and `private.auth_role()` would both refuse it anyway — this is the outer
 * layer of that defence, not the only one.
 */
const ACCOUNT_DISABLED =
  'This account has been deactivated. Ask your school administrator to restore it.';

/**
 * POST /api/auth/register
 *
 * Called immediately after Supabase Auth signup on the frontend.
 * Creates the corresponding row in the `profiles` table.
 *
 * ⚠️ NOTHING CALLS THIS. `CreateAccount.tsx` is a stub whose submit handler is a
 * `setTimeout`, and accounts are created by an administrator through the Supabase
 * Auth admin API. It is left in place because it is the only working reference
 * for the signup shape, but note that an account created here gets NO USERNAME
 * and therefore cannot sign in — see `handle_new_user()`, which takes one from
 * `user_metadata` when the admin API supplies it.
 *
 * Body: { email, password, first_name, last_name }
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { email, password, first_name, last_name } = parsed.data;

  // 1. Create the user in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm for now; enable email verification in production
  });

  if (authError || !authData.user) {
    res.status(400).json({ error: 'Registration failed', message: authError?.message });
    return;
  }

  // 2. Create the profile row linked to the auth user
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      first_name,
      last_name,
      role: 'student',
    })
    .select()
    .single();

  if (profileError) {
    // Rollback: delete the auth user if profile creation fails
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    res.status(500).json({ error: 'Profile creation failed', message: profileError.message });
    return;
  }

  res.status(201).json({ data: profile, message: 'Account created successfully' });
});

/**
 * POST /api/auth/login — the only unauthenticated write in the app.
 *
 * THE USERNAME IS RESOLVED TO AN EMAIL HERE, ON THE SERVER, AND THAT IS THE WHOLE
 * POINT OF THIS ROUTE EXISTING. The obvious alternative — a public endpoint the
 * browser calls to turn a username into an email before signing in normally — is
 * answerable without a password, so anyone could work through plausible usernames
 * and collect the real email addresses of 12-to-16-year-olds. Here the username
 * and password arrive together and are checked in one step, so **no email is
 * disclosed to anyone who has not already proven the password.**
 *
 * ⚠️ Be precise about that guarantee: the SUCCESS response does contain the
 * caller's own address, because a Supabase session embeds `user.email` and the
 * access token is a JWT carrying an `email` claim. Stripping it would be theatre
 * — the JWT still holds it, and the recipient is by definition the account owner
 * learning their own address. What must never happen, and does not, is a FAILED
 * or unauthenticated call revealing anything: every failure returns `LOGIN_FAILED`
 * and no user data at all.
 *
 * Returns the session for the client to install with `supabase.auth.setSession()`,
 * plus `role` so the caller can route to the right portal. That also removes the
 * second round trip the login page used to make: `signInWithPassword`, then a
 * separate `profiles` select for the role.
 *
 * ⚠️ THIS IS WHERE A DISABLED ACCOUNT IS STOPPED. `authenticate` deliberately
 * does not check `status` — only `requireRole` does — so before this route a
 * disabled account could still obtain a valid session and hold it until expiry.
 *
 * Body: { username, password }
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    // Not a validation dump: a malformed username is still a failed login, and
    // saying which rule it broke narrows a guess.
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  const { username, password } = parsed.data;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, must_change_password')
    .eq('username', username)
    .maybeSingle();

  /*
   * ⚠️ ONLY `!profile` HERE. The `status !== 'active'` test used to share this
   * branch, which meant a disabled account and a username that does not exist
   * were answered identically — correct for secrecy, but it left a disabled
   * student staring at "Incorrect username or password" and retyping a password
   * that was never the problem. The status check now runs after the password is
   * verified; see `ACCOUNT_DISABLED`.
   */
  if (!profile) {
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  // The email lives on auth.users, not profiles, and never leaves this function.
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
  const email = authUser?.user?.email;

  if (!email) {
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  const session = await signInWithPassword(email, password);

  if (!session) {
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  /*
   * Password proven — from here it is safe to be specific.
   *
   * `session` is deliberately dropped on the floor rather than returned. See the
   * `ACCOUNT_DISABLED` note: Supabase does not know about `profiles.status`, so
   * the session it just minted is valid as far as it is concerned.
   */
  if (profile.status !== 'active') {
    res.status(403).json({
      error: 'Forbidden',
      code: 'ACCOUNT_DISABLED',
      message: ACCOUNT_DISABLED,
    });
    return;
  }

  /*
   * `must_change_password` rides along so the client can go straight to
   * `/set-password` instead of opening a dashboard that `requireRole` will refuse
   * on its first data call. It is a HINT, not the enforcement — the gate is
   * server-side in `requireRole`, and a client that ignores this field simply
   * gets 403s.
   *
   * It is safe to disclose here and only here: the caller has just proved the
   * password. Every failure path above returns `LOGIN_FAILED` with no `data` at
   * all, so this never tells an unauthenticated guesser anything.
   */
  res.json({
    data: {
      session,
      role: profile.role,
      must_change_password: profile.must_change_password,
    },
  });
});

/**
 * The one answer `POST /forgot-password` ever gives.
 *
 * ⚠️ UNKNOWN USERNAME, DISABLED ACCOUNT, NO DELIVERABLE ADDRESS, RATE-LIMITED AND
 * SENT ARE ALL THIS. The doctrine is `LOGIN_FAILED`'s and the reason is the same,
 * only sharper: these usernames belong to identifiable minors at one named
 * school, so a response that separates "no such user" from "code sent" is an
 * oracle for which children attend it.
 *
 * ⚠️ THE ADDRESS IS NEVER ECHOED, NOT EVEN MASKED. `m•••@gmail.com` is ordinary
 * practice and is wrong here — a domain plus a first letter is still a partial
 * disclosure about a child to whoever typed the username. The page copy carries
 * the "nothing arriving? ask your teacher" line instead, which strands nobody
 * without disclosing anything.
 */
const FORGOT_PASSWORD_SENT =
  'If that username has an email saved, a 6-digit code is on its way.';

/**
 * Resolves a username to its sign-in address, for the recovery routes.
 *
 * ⚠️ THE RETURN VALUE MUST NEVER REACH A RESPONSE BODY OR A LOG. It exists only so
 * the server can hand the address to Supabase. This is the same rule
 * `POST /login` follows — a public username-to-email lookup needs no password, so
 * it would let anyone harvest the real addresses of 12-to-16-year-olds by working
 * through plausible names.
 *
 * Returns null for every disqualifying case, and the caller must not distinguish
 * them: no such profile, disabled, no address, or an address nothing can be
 * delivered to (`canReceiveMail` — wider than the placeholder check, since
 * `admin` and `educ1` hold bare words).
 */
async function recoverableEmailFor(username: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, status')
    .eq('username', username)
    .maybeSingle();

  if (!profile || profile.status !== 'active') return null;

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
  const email = authUser?.user?.email ?? null;

  return canReceiveMail(email) ? email : null;
}

/**
 * POST /api/auth/forgot-password — UNAUTHENTICATED. Always answers 200.
 *
 * ⚠️ THIS IS TIER 1 OF TWO, AND TIER 2 IS THE ONE THAT NEVER FAILS. An account
 * with a deliverable address recovers itself with a mailed code. Every other
 * account — no address, a `@pca.invalid` placeholder, or one of the bare words
 * migration 0021 left behind — still goes through an administrator
 * (`POST /api/admin/accounts/:userId/password`). That path is unchanged and
 * remains the guarantee; this one is an upgrade for accounts that opt in via
 * `EmailRecoveryBanner`.
 *
 * ⚠️ EVERY FAILURE IS SILENT AND RETURNS 200. A rate-limited caller, a disabled
 * account and a mail error all look like success. That is uncomfortable to read
 * and it is the point — see `FORGOT_PASSWORD_SENT`. Failures are logged WITHOUT
 * the address so an administrator can still diagnose them.
 *
 * Body: { username }
 */
router.post('/forgot-password', (req: Request, res: Response): void => {
  const parsed = ForgotPasswordSchema.safeParse(req.body);

  /*
   * ⚠️ THE REPLY IS FULLY SENT BEFORE ANY VARIABLE WORK BEGINS, AND THAT IS A
   * SECURITY PROPERTY RATHER THAN A LATENCY ONE.
   *
   * An identical response body is not a uniform response if it arrives at a
   * different time. Measured on this route when it awaited the work before
   * answering: 0.6ms for a malformed username, 165–520ms for a well-formed one
   * with no account, and 2360ms when an account existed and a code was actually
   * mailed. The same 101 bytes every time — and a spread that tells anyone with a
   * stopwatch which usernames belong to real children with addresses on file.
   * That is exactly the oracle `FORGOT_PASSWORD_SENT` exists to close, so closing
   * it in the body alone would have been half a fix.
   *
   * Deferring the work collapses every path to the same time. Verified on a
   * freshly started server, isolated requests five seconds apart: malformed,
   * well-formed-but-unknown and real-account all land at 2.7–3.8ms, against
   * `/api/health` at 2.5ms. That flatness is the actual assertion — if a change
   * here reintroduces a spread, the uniform body is no longer doing its job.
   *
   * ⚠️ `res.on('finish')`, NOT A BARE CALL. `res.json()` does not transmit; it
   * hands a write to libuv and returns, so work started immediately afterwards
   * can hold the main thread through a TLS handshake and delay the reply that was
   * supposedly already sent. `finish` fires once the last segment has gone to the
   * OS. (`setImmediate` looks like it should be enough and was not tested
   * conclusively — the measurement that appeared to reject it was taken against a
   * stale process. Prefer `finish`: it states the actual precondition rather than
   * relying on phase ordering.)
   *
   * ⚠️ A MALFORMED USERNAME GETS THE SAME 200. A validation dump would say "that
   * is not even a valid username shape", which narrows a guess as effectively as
   * saying the account does not exist. Same doctrine as `/login` answering 401
   * rather than 400 on a bad body — and note it must stay on the same timing path
   * too, which it does by construction here.
   *
   * ⚠️ THE CALLBACK MUST NEVER THROW. The response is gone, so there is no error
   * path left — and Express 4 does not forward async rejections, with no
   * `unhandledRejection` handler in this process. Same shape and the same reason
   * as `logActivity()`, and as `chat.routes.ts` logging after `res.end()`.
   */
  if (parsed.success) {
    const { username } = parsed.data;
    res.on('finish', () => void sendRecoveryCode(username));
  }

  res.json({ data: { sent: true }, message: FORGOT_PASSWORD_SENT });
});

/**
 * The work `POST /forgot-password` deliberately does not wait for.
 *
 * ⚠️ SWALLOWS EVERYTHING. Nothing it learns may reach the caller — not that the
 * username was unknown, not that the address was undeliverable, not that the mail
 * server refused. Failures are logged WITHOUT the address so an administrator can
 * still diagnose them; see `recoverableEmailFor()`.
 */
async function sendRecoveryCode(username: string): Promise<void> {
  try {
    const gate = canSend(username);
    if (!gate.allowed) {
      console.warn(`[auth] forgot-password throttled (${gate.reason})`);
      return;
    }

    const email = await recoverableEmailFor(username);
    if (!email) return;

    /*
     * ⚠️ THE EMAIL TEMPLATE MUST USE `{{ .Token }}`, NOT `{{ .ConfirmationURL }}`.
     * Supabase mints both for this call; the default template sends the link, and
     * this flow reads a code the student types back. The template must also name
     * neither the account nor the student — a code arriving at a mistyped address
     * should tell its recipient nothing.
     */
    const { error } = await ephemeralAnonClient().auth.resetPasswordForEmail(email);

    if (error) {
      // No address in the log line: this route's whole point is that it never leaks.
      console.error('[auth] could not send recovery code', error.message);
      return;
    }

    noteSend(username);
  } catch (err) {
    console.error(
      '[auth] recovery send failed',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * POST /api/auth/reset-password — UNAUTHENTICATED. Redeems the code.
 *
 * ⚠️ UNLIKE THE ROUTE ABOVE, THIS ONE DOES REPORT FAILURE — and that is not an
 * inconsistency. Reaching here means holding a 6-digit code, which is proof of
 * inbox access rather than a guess at a username, and a reset that silently did
 * nothing would be unusable. It still returns ONE message for every kind of
 * failure, so it cannot be used to tell a wrong code from an unknown username.
 *
 * Body: { username, code, new_password }
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { username, code, new_password } = parsed.data;

  const INVALID = {
    error: 'Invalid code',
    message: 'That code is not valid or has expired. Request a new one.',
  };

  if (!canVerify(username)) {
    res.status(429).json({
      error: 'Too many attempts',
      message: 'Too many incorrect codes. Request a new one.',
    });
    return;
  }

  const email = await recoverableEmailFor(username);
  if (!email) {
    noteVerifyFailure(username);
    res.status(400).json(INVALID);
    return;
  }

  const { data, error } = await ephemeralAnonClient().auth.verifyOtp({
    email,
    token: code,
    type: 'recovery',
  });

  if (error || !data.session || !data.user) {
    noteVerifyFailure(username);
    res.status(400).json(INVALID);
    return;
  }

  const userId = data.user.id;

  /*
   * ⚠️ REVOKE FIRST, THEN CHANGE — the ordering `POST /change-password` already
   * documents. Changing the password can invalidate the very token the revocation
   * needs, so doing it the other way round would fail exactly when it matters
   * most. Here it matters more than anywhere else in the app: someone resetting
   * their password may be doing it BECAUSE another person is signed in as them,
   * and that is the case this call ends.
   *
   * `'global'`, not `'others'`. The OTP session created two lines above is thrown
   * away rather than returned, so there is no session worth preserving — and the
   * caller is about to sign in with the new password anyway.
   */
  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    data.session.access_token,
    'global'
  );

  if (signOutError) {
    console.error('[auth] could not revoke sessions during reset', signOutError.message);
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: new_password,
  });

  if (updateError) {
    res.status(400).json({ error: 'Reset failed', message: updateError.message });
    return;
  }

  /*
   * ⚠️ CLEARED, NOT RE-ARMED — THE OPPOSITE OF AN ADMIN RESET. `must_change_password`
   * exists because whoever chose the password has seen it; here that is the
   * account holder themselves, so the activation gate is already satisfied.
   * `POST /api/admin/accounts/:userId/password` re-arms it for the mirror reason.
   *
   * AFTER the password change, never before: clearing it first and then failing
   * would open the account up while it still held the old password.
   */
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (flagError) {
    console.error('[auth] password reset but the activation flag survived', flagError.message);
  }

  clearThrottle(username);

  /*
   * ⚠️ NO SESSION IN THE RESPONSE. `verifyOtp` returned one and it is deliberately
   * dropped: a session derived from an emailed code is weaker proof than one
   * derived from a password, and the user has a password now. The client sends
   * them to `/login` to use it — which also confirms the new password works while
   * they are still on the page that set it.
   */
  res.json({ data: { reset: true }, message: 'Password updated. Sign in with your new password.' });
});

/**
 * GET /api/auth/me
 *
 * The authenticated user's own profile. Backs `AuthContext` on the client — the
 * one place a real name, role and grade level enter the UI.
 *
 * THIS ROUTE WAS BROKEN AND NOTHING NOTICED. It selected `*, institutions(name)`
 * against a table that has never existed in `schema.sql`, so PostgREST rejected
 * the embed and every call fell into the 404 below. It went unseen because no
 * client code called it until the dashboard rebuild needed a real name.
 *
 * `email` and `last_sign_in_at` come from `req.user`, which `authenticate`
 * already attached — `profiles` has no email column and none may be invented
 * there, but `auth.users` has the genuine one and it costs no extra query.
 * `status` is returned rather than enforced here — `authenticate` deliberately
 * does not check it (only `requireRole` does), so the caller decides.
 */
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', req.user!.id)
    .single();

  if (error || !profile) {
    res.status(404).json({ error: 'Profile not found', message: error?.message });
    return;
  }

  res.json({
    data: {
      ...profile,
      email: req.user!.email ?? null,
      /*
       * ⚠️ The profile page MUST NOT print a placeholder address. A bulk-created
       * student has `<username>@pca.invalid` on `auth.users`, and showing it under
       * "Current email" presents a fabricated address as genuine — the exact rule
       * the invented `liza.mendoza@pca.edu.ph` broke. The flag travels with the
       * value so the client cannot forget to check.
       */
      email_is_placeholder: isPlaceholderEmail(req.user!.email),
      /*
       * ⚠️ WIDER THAN THE FLAG ABOVE, AND BOTH ARE NEEDED. `email_is_placeholder`
       * answers "must this be hidden?"; this answers "could a reset code reach
       * it?" — and they disagree for `admin` and `educ1`, whose addresses are
       * bare words rather than `@pca.invalid`. The recovery banner and every
       * screen that prints an address key off THIS one; see `canReceiveMail()`.
       */
      email_can_receive: canReceiveMail(req.user!.email),
      last_sign_in_at: req.user!.last_sign_in_at ?? null,
    },
  });
});

/**
 * PATCH /api/auth/me — the ONLY writer for a user's own profile.
 *
 * ⚠️ IT ACCEPTS THREE FIELDS AND `UpdateProfileSchema` IS THE ONLY THING KEEPING
 * IT THAT WAY. `enforce_profile_immutables()` in schema.sql looks like it guards
 * `role` / `status` / `grade_level`, but its first branch returns early when
 * `auth.uid()` is NULL — which is exactly the case for the service role Express
 * holds. The trigger protects direct anon-key access and nothing that reaches
 * this handler.
 *
 * `grade_level` is the dangerous one: `materialAccess.ts` gates every student
 * read on `grade_levels @> [caller.gradeLevel]`, so a student able to PATCH their
 * own grade would read another year's materials. Same doctrine as
 * `PATCH /api/materials/:id`.
 *
 * Gated by `requireRole` for all three roles: renaming yourself is not part of
 * activating, so an account still holding an administrator-set password has no
 * business here. (`GET /me` above and `POST /change-password` below stay open —
 * see the note at the top of this file.)
 *
 * Body: { first_name?, last_name?, username? }
 */
router.patch('/me', authenticate, requireRole('student', 'educator', 'admin'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', req.user!.id)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    if ((error as PostgrestError).code === UNIQUE_VIOLATION) {
      res.status(409).json({ error: 'Username taken', message: 'That username is already in use' });
      return;
    }
    res.status(500).json({ error: 'Update failed', message: error.message });
    return;
  }

  res.json({
    data: {
      ...profile,
      email: req.user!.email ?? null,
      /*
       * ⚠️ The profile page MUST NOT print a placeholder address. A bulk-created
       * student has `<username>@pca.invalid` on `auth.users`, and showing it under
       * "Current email" presents a fabricated address as genuine — the exact rule
       * the invented `liza.mendoza@pca.edu.ph` broke. The flag travels with the
       * value so the client cannot forget to check.
       */
      email_is_placeholder: isPlaceholderEmail(req.user!.email),
      /*
       * ⚠️ WIDER THAN THE FLAG ABOVE, AND BOTH ARE NEEDED. `email_is_placeholder`
       * answers "must this be hidden?"; this answers "could a reset code reach
       * it?" — and they disagree for `admin` and `educ1`, whose addresses are
       * bare words rather than `@pca.invalid`. The recovery banner and every
       * screen that prints an address key off THIS one; see `canReceiveMail()`.
       */
      email_can_receive: canReceiveMail(req.user!.email),
      last_sign_in_at: req.user!.last_sign_in_at ?? null,
    },
    message: 'Profile updated',
  });
});

/**
 * POST /api/auth/change-password
 *
 * ⚠️ THE CURRENT PASSWORD IS RE-VERIFIED, BECAUSE SUPABASE DOES NOT.
 * `updateUser({ password })` accepts any live session, so on a shared school
 * computer a walked-away session is a permanent account takeover — the real owner
 * cannot get back in. Proving the current password is what makes this a change
 * rather than a seizure.
 *
 * On success the user's OTHER sessions are revoked, so "someone has been using my
 * account" is actually fixed by changing the password. The caller's own session
 * survives: signing someone out of the page they just used would read as an error.
 *
 * Body: { current_password, new_password }
 */
router.post('/change-password', authenticate, async (req: Request, res: Response): Promise<void> => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const email = req.user!.email;
  if (!email) {
    res.status(409).json({
      error: 'No sign-in address',
      message: 'This account has no sign-in address. Ask an administrator to set one.',
    });
    return;
  }

  if (!(await verifyPassword(email, parsed.data.current_password))) {
    res.status(401).json({ error: 'Unauthorized', message: 'Your current password is incorrect' });
    return;
  }

  /*
   * ⚠️ REVOKE BEFORE CHANGING, AND PASS THE JWT — NOT THE USER ID.
   *
   * `admin.signOut(jwt, scope)` identifies the sessions to revoke by the token,
   * which is why `req.accessToken` exists; passing `req.user!.id` here returned
   * an error the acceptance harness caught and a human never would have.
   *
   * The order matters too. Changing the password first can invalidate the very
   * token this call needs, so the revocation would fail exactly when it is most
   * wanted. Revoking first means the worst case is that other devices were signed
   * out and the password change then failed — harmless, and arguably the right
   * outcome for someone who just tried to change it.
   *
   * Best-effort either way: `scope: 'others'` keeps the caller's own session, so
   * they stay on the page they are looking at.
   */
  const { error: signOutError } = req.accessToken
    ? await supabaseAdmin.auth.admin.signOut(req.accessToken, 'others')
    : { error: new Error('missing access token') };

  if (signOutError) {
    console.error('[auth] could not revoke other sessions', signOutError.message);
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user!.id, {
    password: parsed.data.new_password,
  });

  if (error) {
    res.status(400).json({ error: 'Password change failed', message: error.message });
    return;
  }

  /*
   * ⚠️ THIS IS THE ONLY PLACE AN ACCOUNT BECOMES ACTIVATED, and until this change
   * the route did not touch `profiles` at all.
   *
   * `must_change_password` gates every route behind `requireRole`, so failing to
   * clear it here would leave the user permanently at `/set-password`, changing
   * their password over and over with nothing else reachable.
   *
   * AFTER the password change, never before: clearing it first and then failing
   * the change would open the account up while it still holds the password the
   * administrator chose. It is unconditional rather than `.eq('must_change_password', true)`
   * because a routine change by an already-activated user must be a harmless no-op.
   */
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', req.user!.id);

  if (flagError) {
    // The password DID change, so this must not read as a failure — but the user
    // is now stuck behind the gate, which an admin has to clear. Loud in the log.
    console.error('[auth] password changed but the activation flag survived', flagError.message);
  }

  res.json({
    data: { other_sessions_revoked: !signOutError },
    message: 'Password updated',
  });
});

/**
 * POST /api/auth/change-email — STEP 1 OF 2. Sends a code; applies nothing.
 *
 * ⚠️ IT USED TO APPLY IMMEDIATELY, AND THAT HAD TO BE FIXED BEFORE PASSWORD RESET
 * COULD EXIST. The old route called `admin.updateUserById({ email })` with
 * `email_confirm: true`, so a user could set their address to one they did not
 * own — harmless while nothing was ever mailed to it, and an account-takeover
 * route the moment a reset code is. Type in someone else's address, then
 * "recover" their password to your own inbox. The route's own note said as much:
 * "do not enable password-reset-by-email without adding a confirmation step here
 * first."
 *
 * TWO INDEPENDENT PROOFS ARE NOW REQUIRED, and they answer different questions.
 * The current password proves the CALLER owns this account (Supabase's
 * `updateUser` accepts any live session, so on a shared school computer a
 * walked-away session would otherwise be enough). The mailed code proves the
 * caller owns the DESTINATION. Neither substitutes for the other.
 *
 * ⚠️ NOTHING IS STORED BETWEEN THE TWO CALLS. Supabase mints the code against the
 * address, so it is the authority on which address this code is for; the client
 * re-sends the address on confirm. A pending-change table would be a second
 * source of truth for a string that lives fifteen minutes.
 *
 * ⚠️ REQUIRES "Secure email change" TO BE OFF IN THE SUPABASE DASHBOARD. Left on,
 * Supabase demands confirmation from the OLD address too — and the old address is
 * `@pca.invalid` or a bare word for exactly the accounts that need this most, so
 * the change could never complete for them.
 *
 * Changing the email does NOT change how anyone signs in. The login identifier is
 * `profiles.username`; this address is contact information.
 *
 * Body: { current_password, new_email }
 */
router.post('/change-email', authenticate, requireRole('student', 'educator', 'admin'), async (req: Request, res: Response): Promise<void> => {
  const parsed = ChangeEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const email = req.user!.email;
  if (!email) {
    res.status(409).json({
      error: 'No sign-in address',
      message: 'This account has no sign-in address. Ask an administrator to set one.',
    });
    return;
  }

  /*
   * ⚠️ ONE SIGN-IN THAT BOTH PROVES THE PASSWORD AND CARRIES THE SESSION.
   * `updateUser` reads the session off the client instance, so it must run on the
   * client that signed in — a bearer token in `global.headers` is NOT enough and
   * fails with "Auth session missing!". See `sessionClientForPassword`.
   *
   * ⚠️ USER-SCOPED, NOT THE SERVICE ROLE. `admin.updateUserById({ email })` is the
   * call that applies an address outright with no confirmation — the behaviour
   * being removed. `updateUser` on the caller's own session mails the new address
   * a code and changes nothing until `verifyOtp` redeems it.
   */
  const caller = await sessionClientForPassword(email, parsed.data.current_password);
  if (!caller) {
    res.status(401).json({ error: 'Unauthorized', message: 'Your current password is incorrect' });
    return;
  }

  const { error } = await caller.auth.updateUser({
    email: parsed.data.new_email,
  });

  if (error) {
    // Supabase enforces email uniqueness across auth.users; surface it as a 409
    // rather than a 400 so the client can say "already in use" specifically.
    const taken = /already|exists|registered/i.test(error.message);
    res.status(taken ? 409 : 400).json({
      error: taken ? 'Email taken' : 'Email change failed',
      message: taken ? 'That email address is already in use' : error.message,
    });
    return;
  }

  res.json({
    data: { pending_email: parsed.data.new_email },
    message: 'Check that inbox for a 6-digit code',
  });
});

/**
 * POST /api/auth/change-email/confirm — STEP 2 OF 2. This is what applies it.
 *
 * ⚠️ NO PASSWORD RE-CHECK HERE, DELIBERATELY. Step 1 already proved the caller
 * owns the account, and the code proves they own the mailbox. Asking again would
 * only make an already two-step flow three, and the code is worthless without the
 * session this route requires.
 *
 * ⚠️ `type: 'email_change'`, NOT `'recovery'`. They are different token classes at
 * Supabase and a recovery token would not redeem here — which is the correct
 * behaviour: a code mailed for a password reset must never be usable to move an
 * account's address.
 *
 * Supabase applies the change itself as part of redeeming the code, so there is
 * no separate write and no window in which one of the two could succeed alone.
 *
 * Body: { new_email, code }
 */
router.post('/change-email/confirm', authenticate, requireRole('student', 'educator', 'admin'), async (req: Request, res: Response): Promise<void> => {
  const parsed = ConfirmEmailChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { new_email, code } = parsed.data;

  const { data, error } = await ephemeralAnonClient().auth.verifyOtp({
    email: new_email,
    token: code,
    type: 'email_change',
  });

  /*
   * One message for wrong, expired and already-used. They are the same situation
   * from the user's side — ask for a new code — and distinguishing them tells a
   * shoulder-surfer whether a code they saw is still live.
   */
  if (error || !data.user) {
    res.status(400).json({
      error: 'Invalid code',
      message: 'That code is not valid or has expired. Request a new one.',
    });
    return;
  }

  /*
   * ⚠️ THE SESSION `verifyOtp` RETURNS IS DISCARDED. The caller already holds a
   * real one from signing in with their password; handing back a second, weaker
   * one derived from an emailed code would be a downgrade. Same reasoning as
   * `verifyPassword()`, which throws away the session it creates.
   */
  res.json({ data: { email: data.user.email ?? new_email }, message: 'Email updated' });
});

export default router;
