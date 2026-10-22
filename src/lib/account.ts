/**
 * Self-service account calls. The server decides what a user may change (UpdateProfileSchema is
 * strict); never add role, status or grade_level here. `username` signs in; `email` is contact info.
 */

import { api } from './api';
import type { AuthUser } from '../context/AuthContext';

export interface UpdateProfileBody {
  first_name?: string;
  last_name?: string;
  username?: string;
}

export const accountApi = {
  /** Name and username; no password needed. */
  async updateProfile(body: UpdateProfileBody): Promise<AuthUser> {
    const res = await api.patch<AuthUser>('/auth/me', body);
    return res.data;
  },

  /** Returns whether other sessions were revoked. The password changed either way. */
  async changePassword(current_password: string, new_password: string): Promise<boolean> {
    const res = await api.post<{ other_sessions_revoked: boolean }>('/auth/change-password', {
      current_password,
      new_password,
    });
    return res.data.other_sessions_revoked;
  },

  /** Step 1 of 2: mails a code to the new address; applies nothing until confirmEmailChange(). */
  async changeEmail(current_password: string, new_email: string): Promise<string> {
    const res = await api.post<{ pending_email: string }>('/auth/change-email', {
      current_password,
      new_email,
    });
    return res.data.pending_email;
  },

  /** Step 2 of 2: redeems the code and returns the new address. */
  async confirmEmailChange(new_email: string, code: string): Promise<string> {
    const res = await api.post<{ email: string }>('/auth/change-email/confirm', {
      new_email,
      code,
    });
    return res.data.email;
  },
};

/**
 * Unauthenticated recovery calls (no JWT). requestPasswordReset always succeeds identically by design;
 * never try to infer what happened.
 */
export const recoveryApi = {
  async requestPasswordReset(username: string): Promise<void> {
    await api.post('/auth/forgot-password', { username });
  },

  async resetPassword(username: string, code: string, new_password: string): Promise<void> {
    await api.post('/auth/reset-password', { username, code, new_password });
  },
};

/** null when valid, otherwise the reason. Mirrors OtpCodeField. */
export function codeProblem(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null; // untouched field: say nothing yet
  if (!/^\d{6}$/.test(v)) return 'Enter the 6-digit code from your email.';
  return null;
}

/** Whether the code would be accepted (empty is invalid but not reported). */
export function isCodeValid(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}

/** Mirrors `profiles_username_format`; the server re-validates. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;

export const USERNAME_HINT =
  '3–30 characters: lowercase letters, numbers, dots and underscores, starting and ending with a letter or number.';

/** The password rule, mirrored from PasswordField (authoritative), shared by every form that sets a password. */
export const MIN_PASSWORD_LENGTH = 8;

/** Anything that isn't a letter or digit. */
const HAS_SPECIAL = /[^A-Za-z0-9]/;

export const PASSWORD_HINT =
  'At least 8 characters, including one special character such as ! ? # - or _';

/** null when valid, otherwise the reason. */
export function passwordProblem(value: string): string | null {
  if (value.length === 0) return null; // untouched field: say nothing yet
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!HAS_SPECIAL.test(value)) {
    return 'Add one special character — for example ! ? # - or _';
  }
  return null;
}

/** Whether the value would be accepted (empty is invalid but not reported). */
export function isPasswordValid(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && HAS_SPECIAL.test(value);
}

/** null when valid, otherwise the reason. */
export function usernameProblem(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return 'Choose a username — it is what you sign in with.';
  if (v.includes('@')) return 'A username is not an email address — leave out the @.';
  if (v.length < 3) return 'Use at least 3 characters.';
  if (v.length > 30) return 'Use at most 30 characters.';
  if (!USERNAME_PATTERN.test(v)) return USERNAME_HINT;
  return null;
}

/** Email shape check only (the server's .email() is authoritative). Shared by both admin email forms. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** null when valid, otherwise the reason; empty reports nothing. */
export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (!EMAIL_SHAPE.test(v)) return 'Enter a valid email address.';
  return null;
}

/** Whether the value would be accepted (empty is invalid but not reported). */
export function isEmailValid(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}
