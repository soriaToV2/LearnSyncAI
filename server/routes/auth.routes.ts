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

/** Columns returned by GET/PATCH /me. Explicit so new profile columns don't widen the payload. */
const PROFILE_COLUMNS =
  'id, role, username, first_name, last_name, grade_level, status, must_change_password, created_at';

/*
 * Unauthenticated: /register, /login, /forgot-password, /reset-password (one answer for every
 * outcome; addresses resolved server-side).
 * GET /me and POST /change-password must never go behind requireRole: they are the only way out
 * of the PASSWORD_CHANGE_REQUIRED state.
 */

/** Raised by the case-insensitive `ux_profiles_username_lower`. */
const UNIQUE_VIOLATION = '23505';

/** One message for every login failure, so login can't be used as a username oracle. */
const LOGIN_FAILED = 'Incorrect username or password';

/**
 * Sent only after the password is verified, so it reveals nothing to a guesser.
 * The session Supabase minted is discarded.
 */
const ACCOUNT_DISABLED =
  'This account has been deactivated. Ask your school administrator to restore it.';

/**
 * POST /api/auth/register. Unused (admins create accounts), kept as a reference.
 * Accounts created here get no username and cannot sign in.
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
 * POST /api/auth/login. Resolves username → email server-side so no address leaks before the
 * password is proven; never add a public username-lookup endpoint. Every failure returns LOGIN_FAILED.
 * Returns the session plus role for routing. Disabled accounts are stopped here.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    // No validation details: they would narrow a guess.
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  const { username, password } = parsed.data;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, must_change_password')
    .eq('username', username)
    .maybeSingle();

  // Status is checked only after the password is verified.
  if (!profile) {
    res.status(401).json({ error: 'Unauthorized', message: LOGIN_FAILED });
    return;
  }

  // The email never leaves this function.
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

  // Password proven, so it's safe to be specific. The session is dropped, not returned.
  if (profile.status !== 'active') {
    res.status(403).json({
      error: 'Forbidden',
      code: 'ACCOUNT_DISABLED',
      message: ACCOUNT_DISABLED,
    });
    return;
  }

  // must_change_password is a routing hint; requireRole is the enforcement.
  res.json({
    data: {
      session,
      role: profile.role,
      must_change_password: profile.must_change_password,
    },
  });
});

/** The only answer /forgot-password gives, whatever happened. Never echo the address, even masked. */
const FORGOT_PASSWORD_SENT =
  'If that username has an email saved, a 6-digit code is on its way.';

/**
 * A username's deliverable address, or null for any disqualifying case. Never put the result in a
 * response body or a log.
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
 * POST /api/auth/forgot-password. Unauthenticated; always 200 with the same body, even for a
 * malformed username. Accounts without a deliverable address recover via an admin reset.
 */
router.post('/forgot-password', (req: Request, res: Response): void => {
  const parsed = ForgotPasswordSchema.safeParse(req.body);

  // Do the work only after the reply has finished sending, so response timing can't reveal
  // whether the account exists. Use res.on('finish'), not a bare call. The callback must never throw.
  if (parsed.success) {
    const { username } = parsed.data;
    res.on('finish', () => void sendRecoveryCode(username));
  }

  res.json({ data: { sent: true }, message: FORGOT_PASSWORD_SENT });
});

/** Deferred work for /forgot-password. Swallows everything; logs without the address. */
async function sendRecoveryCode(username: string): Promise<void> {
  try {
    const gate = canSend(username);
    if (!gate.allowed) {
      console.warn(`[auth] forgot-password throttled (${gate.reason})`);
      return;
    }

    const email = await recoverableEmailFor(username);
    if (!email) return;

    // The Supabase email template must use {{ .Token }} (a typed code), not the link, and name no one.
    const { error } = await ephemeralAnonClient().auth.resetPasswordForEmail(email);

    if (error) {
      // Never log the address.
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
 * POST /api/auth/reset-password. Unauthenticated; redeems the code. Reports failure (holding a code
 * proves inbox access) but with one message for every kind of failure.
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

  // Revoke before changing the password, which can invalidate the token needed to revoke.
  // 'global': the OTP session is discarded anyway.
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

  // Cleared (the holder chose this password); an admin reset re-arms it. Only after the change succeeds.
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (flagError) {
    console.error('[auth] password reset but the activation flag survived', flagError.message);
  }

  clearThrottle(username);

  // No session in the response: the user signs in with the new password.
  res.json({ data: { reset: true }, message: 'Password updated. Sign in with your new password.' });
});

/**
 * GET /api/auth/me: the caller's profile, for AuthContext. Ungated (must work before activation).
 * Email and last sign-in come from `req.user`.
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
      // Never display a placeholder address.
      email_is_placeholder: isPlaceholderEmail(req.user!.email),
      // Wider than the flag above; screens that print an address key off this one.
      email_can_receive: canReceiveMail(req.user!.email),
      last_sign_in_at: req.user!.last_sign_in_at ?? null,
    },
  });
});

/**
 * PATCH /api/auth/me: the only self-profile writer. UpdateProfileSchema is the only guard on
 * role/status/grade_level (the trigger is inert under the service role). Gated by requireRole.
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
      // Never display a placeholder address.
      email_is_placeholder: isPlaceholderEmail(req.user!.email),
      // Wider than the flag above; screens that print an address key off this one.
      email_can_receive: canReceiveMail(req.user!.email),
      last_sign_in_at: req.user!.last_sign_in_at ?? null,
    },
    message: 'Profile updated',
  });
});

/**
 * POST /api/auth/change-password. Ungated: the exit from first-login activation.
 * Re-verifies the current password (Supabase doesn't) and revokes the caller's other sessions.
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

  // Revoke before changing the password. signOut takes the JWT, not the user id. Best-effort.
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

  // The only place an account becomes activated. Only after the change succeeds; unconditional on purpose.
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', req.user!.id);

  if (flagError) {
    // The password did change, but the user is stuck behind the gate until an admin clears it.
    console.error('[auth] password changed but the activation flag survived', flagError.message);
  }

  res.json({
    data: { other_sessions_revoked: !signOutError },
    message: 'Password updated',
  });
});

/**
 * POST /api/auth/change-email, step 1 of 2: verifies the password and mails a code to the new
 * address; applies nothing. Requires "Secure email change" off in the Supabase dashboard.
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

  // User-scoped updateUser (mails a code) on the signed-in client, never admin.updateUserById.
  const caller = await sessionClientForPassword(email, parsed.data.current_password);
  if (!caller) {
    res.status(401).json({ error: 'Unauthorized', message: 'Your current password is incorrect' });
    return;
  }

  const { error } = await caller.auth.updateUser({
    email: parsed.data.new_email,
  });

  if (error) {
    // Duplicate address → 409.
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
 * POST /api/auth/change-email/confirm, step 2: redeeming the `email_change` code applies the change.
 * No password re-check (step 1 did it).
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

  // One message for wrong, expired and used codes.
  if (error || !data.user) {
    res.status(400).json({
      error: 'Invalid code',
      message: 'That code is not valid or has expired. Request a new one.',
    });
    return;
  }

  // The OTP session is discarded; the caller keeps their password session.
  res.json({ data: { email: data.user.email ?? new_email }, message: 'Email updated' });
});

export default router;
