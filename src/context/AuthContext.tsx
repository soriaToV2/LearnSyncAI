import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The signed-in user's profile, fetched once per layout mount. Identity only; don't add other shared
 * data. No cache or background revalidation. `refresh()` is for a page that just changed the profile.
 */

export type UserRole = 'student' | 'educator' | 'admin';

export interface AuthUser {
  id: string;
  role: UserRole;
  /** The login identifier. NULL means the account can't sign in until an admin fixes it. */
  username: string | null;
  first_name: string;
  last_name: string;
  /** NULL for educators and admins. */
  grade_level: number | null;
  status: 'active' | 'disabled';
  /** Un-activated (admin-set password): most routes 403. RequireRole redirects to /set-password; the server enforces it. */
  must_change_password: boolean;
  created_at: string;
  /** From auth.users: contact information, not a credential. */
  email: string | null;
  /** A generated placeholder; never display it. */
  email_is_placeholder: boolean;
  /** Whether a reset code could arrive. Wider than the placeholder flag; use it for the recovery banner and for display. */
  email_can_receive: boolean;
  last_sign_in_at: string | null;
}

interface AuthValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** Display-ready error message. */
  error: string | null;
  /** Re-read the profile after a write. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  isLoading: true,
  error: null,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable identity for dependency arrays.
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<AuthUser>('/auth/me');
      setUser(res.data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load your profile.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    api
      .get<AuthUser>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your profile.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, error, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

/** The name to greet someone by. first_name may be '', so fall back to the surname, then a neutral word. */
export function displayName(user: AuthUser | null): string {
  if (!user) return '';
  const first = user.first_name?.trim();
  if (first) return first;
  const last = user.last_name?.trim();
  if (last) return last;
  return 'there';
}

/** Full name for a title attribute, with the same empty-string tolerance. */
export function fullName(user: AuthUser | null): string {
  if (!user) return '';
  return [user.first_name, user.last_name].map((p) => p?.trim()).filter(Boolean).join(' ');
}

/** One or two letters for the avatar monogram (there is no avatar column). */
export function initials(user: AuthUser | null): string {
  if (!user) return '';
  const first = user.first_name?.trim()?.[0] ?? '';
  const last = user.last_name?.trim()?.[0] ?? '';
  return (first + last).toUpperCase() || '?';
}

/** Sidebar subtitle: "Grade N" for students, the role otherwise. */
export function subtitleFor(user: AuthUser | null): string {
  if (!user) return '';
  if (user.grade_level !== null && user.grade_level !== undefined) return `Grade ${user.grade_level}`;
  return user.role.charAt(0).toUpperCase() + user.role.slice(1);
}
