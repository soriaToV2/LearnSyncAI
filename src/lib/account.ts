/**
 * The four account-management calls, and the one rule they share.
 *
 * ⚠️ WHAT A USER MAY CHANGE ABOUT THEMSELVES IS DECIDED ON THE SERVER, NOT HERE.
 * `UpdateProfileSchema` is `.strict()` and omits `role`, `status` and
 * `grade_level`, so sending one is a 400 rather than a silent no-op. This module
 * must never grow a field the schema does not accept — a form that appears to
 * save a grade level and does not is worse than no form.
 *
 * `username` is the login identifier and `email` is contact information. They are
 * separate fields on separate endpoints because they are separate things; see
 * migration 0021 for why they used to be the same column.
 */

import { api } from './api';
import type { AuthUser } from '../context/AuthContext';

export interface UpdateProfileBody {
  first_name?: string;
  last_name?: string;
  username?: string;
}

export const accountApi = {
  /** Name and username. No password required — none of it is a credential check. */
  async updateProfile(body: UpdateProfileBody): Promise<AuthUser> {
    const res = await api.patch<AuthUser>('/auth/me', body);
    return res.data;
  },

  /**
   * Returns whether the user's OTHER sessions were successfully revoked. The
   * password is already changed either way — the flag decides what the UI says
   * afterwards, and must not be reported as a failure of the change itself.
   */
  async changePassword(current_password: string, new_password: string): Promise<boolean> {
    const res = await api.post<{ other_sessions_revoked: boolean }>('/auth/change-password', {
      current_password,
      new_password,
    });
    return res.data.other_sessions_revoked;
  },

  /**
   * STEP 1 of 2 — mails a 6-digit code to the NEW address and applies nothing.
   *
   * ⚠️ IT USED TO APPLY IMMEDIATELY. That made it possible to set an address you
   * did not own, which is an account-takeover route now that a reset code can be
   * mailed to it. The address only moves once `confirmEmailChange` redeems the
   * code. Does NOT change how the user signs in either way — that is the username.
   */
  async changeEmail(current_password: string, new_email: string): Promise<string> {
    const res = await api.post<{ pending_email: string }>('/auth/change-email', {
      current_password,
      new_email,
    });
    return res.data.pending_email;
  },

  /** STEP 2 of 2 — redeems the code. Returns the address now on the account. */
  async confirmEmailChange(new_email: string, code: string): Promise<string> {
    const res = await api.post<{ email: string }>('/auth/change-email/confirm', {
      new_email,
      code,
    });
    return res.data.email;
  },
};

/**
 * The two UNAUTHENTICATED recovery calls, separate from `accountApi` because they
 * run with no session at all — `api.ts` simply attaches no JWT.
 *
 * ⚠️ `requestPasswordReset` CANNOT FAIL IN A WAY THE UI MAY REPORT. The server
 * answers 200 identically for an unknown username, a disabled account, an account
 * with no deliverable address and a successful send, because these usernames
 * belong to identifiable minors at one named school. Do not add a branch here
 * that infers which happened — there is nothing in the response to infer from,
 * and inventing one would undo the property on the client.
 */
export const recoveryApi = {
  async requestPasswordReset(username: string): Promise<void> {
    await api.post('/auth/forgot-password', { username });
  },

  async resetPassword(username: string, code: string, new_password: string): Promise<void> {
    await api.post('/auth/reset-password', { username, code, new_password });
  },
};

/** `null` when valid, otherwise the reason. Mirrors `OtpCodeField` on the server. */
export function codeProblem(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null; // untouched field: say nothing yet
  if (!/^\d{6}$/.test(v)) return 'Enter the 6-digit code from your email.';
  return null;
}

/** Whether this code would be accepted. Empty is invalid; `codeProblem` stays quiet on it. */
export function isCodeValid(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}

/**
 * Mirrors `profiles_username_format` in schema.sql and `UsernameField` in
 * `server/types/api.ts`. Client-side only to give an answer before a round trip —
 * **the server is authoritative** and re-validates the same rule.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;

export const USERNAME_HINT =
  '3–30 characters: lowercase letters, numbers, dots and underscores, starting and ending with a letter or number.';

/**
 * ⚠️ THE PASSWORD RULE, MIRRORED. `PasswordField` in `server/types/api.ts` is
 * authoritative and re-validates every one of these; this exists only so a form
 * can answer before a round trip.
 *
 * Used by all three places a password is chosen — first-login activation, the
 * self-service change, and an admin reset. One implementation, because three
 * forms disagreeing about what a valid password is would be three different
 * error messages for the same rejection.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Anything that is not a letter or a digit. Accepts `-`, `_`, `!`, `?`, … */
const HAS_SPECIAL = /[^A-Za-z0-9]/;

export const PASSWORD_HINT =
  'At least 8 characters, including one special character such as ! ? # - or _';

/** `null` when valid, otherwise the reason. */
export function passwordProblem(value: string): string | null {
  if (value.length === 0) return null; // untouched field: say nothing yet
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!HAS_SPECIAL.test(value)) {
    return 'Add one special character — for example ! ? # - or _';
  }
  return null;
}

/** Whether this value would be accepted. Empty is invalid; `passwordProblem` stays quiet on it. */
export function isPasswordValid(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && HAS_SPECIAL.test(value);
}

/** `null` when valid, otherwise the reason. */
export function usernameProblem(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return 'Choose a username — it is what you sign in with.';
  if (v.includes('@')) return 'A username is not an email address — leave out the @.';
  if (v.length < 3) return 'Use at least 3 characters.';
  if (v.length > 30) return 'Use at most 30 characters.';
  if (!USERNAME_PATTERN.test(v)) return USERNAME_HINT;
  return null;
}

/**
 * ⚠️ SHAPE ONLY, AND DELIBERATELY SO. Zod's `.email()` on the server is
 * authoritative and re-validates every one of these; a browser-side email regex
 * that disagrees with it is worse than none, because it rejects addresses the
 * platform would have accepted and gives no way to find that out.
 *
 * Lives here, beside the password and username rules, for the reason stated on
 * those: it is used by both places an admin types an address — the create modal
 * and the account page's email form — and two copies would be two different
 * messages for the same rejection.
 */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** `null` when valid, otherwise the reason. Empty says nothing: the field is untouched. */
export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (!EMAIL_SHAPE.test(v)) return 'Enter a valid email address.';
  return null;
}

/** Whether this value would be accepted. Empty is invalid; `emailProblem` stays quiet on it. */
export function isEmailValid(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}
