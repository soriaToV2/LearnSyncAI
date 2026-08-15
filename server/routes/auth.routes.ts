import { Router, Request, Response } from 'express';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase';
import { signInWithPassword, verifyPassword } from '../lib/authClient';
import { authenticate } from '../middleware/auth';
import {
  RegisterSchema,
  LoginSchema,
  UpdateProfileSchema,
  ChangePasswordSchema,
  ChangeEmailSchema,
} from '../types/api';

const router = Router();

/**
 * The columns `GET /api/auth/me` and `PATCH /api/auth/me` return.
 *
 * Listed explicitly rather than `*` because the client types against this shape;
 * a column added to `profiles` should not silently widen the payload.
 */
const PROFILE_COLUMNS = 'id, role, username, first_name, last_name, grade_level, status, created_at';

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
    .select('id, role, status')
    .eq('username', username)
    .maybeSingle();

  if (!profile || profile.status !== 'active') {
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

  res.json({ data: { session, role: profile.role } });
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
 * Body: { first_name?, last_name?, username? }
 */
router.patch('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
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

  res.json({
    data: { other_sessions_revoked: !signOutError },
    message: 'Password updated',
  });
});

/**
 * POST /api/auth/change-email
 *
 * ⚠️ THIS APPLIES IMMEDIATELY AND DOES NOT PROVE THE NEW ADDRESS BELONGS TO THE
 * USER. Supabase's own flow mails a confirmation link to the new address, which
 * cannot work here: `POST /api/auth/register` passes `email_confirm: true` — what
 * a project does when it has no working SMTP — and the addresses already in
 * `auth.users` (`student`, `admin`) are not deliverable, so the link would never
 * arrive and the change would silently never complete. Re-verifying the current
 * password is what authorises it instead.
 *
 * The consequence is worth stating plainly: a user can set their address to one
 * they do not own. That matters the day password-reset-by-email is switched on —
 * do not enable it without adding a confirmation step here first.
 *
 * Changing the email does NOT change how anyone signs in. The login identifier is
 * `profiles.username`; this address is contact information.
 *
 * Body: { current_password, new_email }
 */
router.post('/change-email', authenticate, async (req: Request, res: Response): Promise<void> => {
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

  if (!(await verifyPassword(email, parsed.data.current_password))) {
    res.status(401).json({ error: 'Unauthorized', message: 'Your current password is incorrect' });
    return;
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user!.id, {
    email: parsed.data.new_email,
    email_confirm: true,
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

  res.json({ data: { email: parsed.data.new_email }, message: 'Email updated' });
});

export default router;
