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

  /** Applies immediately. Does NOT change how the user signs in. */
  async changeEmail(current_password: string, new_email: string): Promise<string> {
    const res = await api.post<{ email: string }>('/auth/change-email', {
      current_password,
      new_email,
    });
    return res.data.email;
  },
};

/**
 * Mirrors `profiles_username_format` in schema.sql and `UsernameField` in
 * `server/types/api.ts`. Client-side only to give an answer before a round trip —
 * **the server is authoritative** and re-validates the same rule.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;

export const USERNAME_HINT =
  '3–30 characters: lowercase letters, numbers, dots and underscores, starting and ending with a letter or number.';

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
