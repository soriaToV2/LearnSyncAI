import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The signed-in user's own profile, fetched once per layout mount.
 *
 * Before this existed, every screen that needed a name read `MOCK_STUDENTS[0]`
 * and rendered "Sarah Jenkins / MIT" — to every student, in every portal. The
 * profile was reachable the whole time at `GET /api/auth/me`; that route was
 * simply broken (it embedded a table that does not exist) and nothing called it,
 * so nothing surfaced the failure.
 *
 * DELIBERATELY THIN. It holds identity and nothing else. Mastery, spaces and
 * activity all belong to the pages that show them — a context that accumulates
 * "things several screens happen to need" becomes a second, invisible data layer
 * with its own staleness rules.
 *
 * No cache, no background revalidation, no localStorage. It is one small request
 * on mount, and `api.ts` already re-reads the Supabase session for the JWT on
 * every call, so there is no token to keep in sync here.
 *
 * `refresh()` is not a retreat from that. It re-runs the same request on demand,
 * and exists for exactly one caller: the Profile page, after a write it just
 * performed. The sidebar renders `fullName(user)` from this context, so without
 * it a renamed user keeps seeing their old name until a hard reload — the page
 * would contradict the form that had just reported success. What the rule above
 * rules out is staleness machinery that runs on its own; this only fires when the
 * data provably changed.
 *
 * There are NO ROUTE GUARDS in this app today, and this file deliberately does
 * not add them — that is a separate change with its own redirect semantics. It
 * does make them a five-line addition: `user === null && !isLoading` after a
 * settled fetch is exactly "not signed in, or not permitted".
 */

export type UserRole = 'student' | 'educator' | 'admin';

export interface AuthUser {
  id: string;
  role: UserRole;
  /**
   * The LOGIN IDENTIFIER — `email` below is not. NULL means the account cannot
   * sign in, which an administrator has to fix; see `profiles.username`.
   */
  username: string | null;
  first_name: string;
  last_name: string;
  /** NULL for educators and admins; NOT NULL for students by DB constraint. */
  grade_level: number | null;
  status: 'active' | 'disabled';
  created_at: string;
  /**
   * From `auth.users`, not `profiles` — the genuine sign-in address, which is why
   * it may be shown despite `profiles` having no email column. It is CONTACT
   * INFORMATION, not a credential: `username` is what you log in with.
   */
  email: string | null;
  last_sign_in_at: string | null;
}

interface AuthValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** The thrown message, already display-ready — `api.ts` unwraps it. */
  error: string | null;
  /** Re-read the profile. For a page that just wrote to it — see the note above. */
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

  /*
   * Stable identity so a consumer can list it in a dependency array without
   * re-running on every render.
   */
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

/**
 * The name to greet someone by.
 *
 * `handle_new_user()` COALESCEs `first_name` to `''` when an account is created
 * without metadata, so an empty string is a real stored value and "Hi, " is a
 * real render. Falls back to the surname, then to a neutral word — never to a
 * placeholder that looks like a name.
 */
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

/**
 * One or two letters for the avatar monogram.
 *
 * `profiles` has no avatar column and no email, so there is no image to fetch and
 * none may be invented — the layout used to render an Unsplash URL from mock data.
 */
export function initials(user: AuthUser | null): string {
  if (!user) return '';
  const first = user.first_name?.trim()?.[0] ?? '';
  const last = user.last_name?.trim()?.[0] ?? '';
  return (first + last).toUpperCase() || '?';
}

/**
 * The line under the name in the sidebar. `Grade 9` for students — a real column,
 * unlike the "MIT" it replaces. Educators and admins have no grade, so they get
 * their role instead.
 */
export function subtitleFor(user: AuthUser | null): string {
  if (!user) return '';
  if (user.grade_level !== null && user.grade_level !== undefined) return `Grade ${user.grade_level}`;
  return user.role.charAt(0).toUpperCase() + user.role.slice(1);
}
