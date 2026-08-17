import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, type UserRole } from '../../context/AuthContext';

/**
 * ⚠️ THE APP'S FIRST ROUTE GUARD. It renders nothing until it knows who you are.
 *
 * There were none before this. `AuthContext.tsx` says so outright and notes the
 * shape it would take: `user === null && !isLoading` after a settled fetch is
 * exactly "not signed in, or not permitted". Everywhere else the absence only
 * meant a wrong-portal URL rendered a shell whose API calls 403 — untidy, not
 * dangerous.
 *
 * **On a portal that administers accounts that is not good enough.** The admin
 * shell lists every account in the school, and a student typing `/admin/accounts`
 * must not get as far as seeing the frame, the nav or an empty table with those
 * column headings. The server is still the real boundary — every `/api/admin`
 * route sits behind `requireRole('admin')` — but the UI should not describe a
 * capability the viewer does not have.
 *
 * Mounted INSIDE the layout's `AuthProvider`, so it reads the profile that layout
 * already fetches rather than issuing a second `/auth/me`.
 *
 * It is written generically and currently guards only the admin portal. Wiring
 * `StudentLayout` and `EducatorLayout` is a one-line change each, but it alters
 * redirect behaviour on routes that have shipped without it, so it belongs to its
 * own change.
 */
export default function RequireRole({
  allow,
  children,
}: {
  allow: UserRole[];
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  /*
   * The loading branch is load-bearing, not a nicety. `user` is null on the first
   * render of every mount, so redirecting on a falsy `user` alone would bounce a
   * legitimate admin to /login on every cold page load — the same first-render
   * trap that keeps `AuthProvider` mounted per-layout instead of at the App root.
   */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
      </div>
    );
  }

  // No profile: either not signed in, or the token is stale. Both mean sign in.
  if (!user) return <Navigate to="/login" replace />;

  /*
   * ⚠️ BEFORE THE ROLE CHECK, DELIBERATELY.
   *
   * An un-activated account still holds the password an administrator gave it, so
   * `requireRole` on the server refuses every data route with a 403. Without this
   * branch the portal shell would render and then fail on every request, with
   * nothing on screen explaining why.
   *
   * It comes first because it applies whatever the role is — a student, educator
   * and admin created this way are all equally un-activated, and routing them to
   * a portal they cannot use before noticing would be the same bug three times.
   *
   * `/set-password` is mounted OUTSIDE every guarded layout. Inside one, this
   * redirect would fire again on arrival and loop forever.
   */
  if (user.must_change_password) return <Navigate to="/set-password" replace />;

  /*
   * Signed in as someone else. Send them to their own portal rather than to
   * /login — bouncing a signed-in student to a sign-in page reads as "your
   * session broke", and they would sign straight back in and land here again.
   *
   * `replace` throughout, so Back does not return to a portal that refused them.
   */
  if (!allow.includes(user.role)) {
    const home =
      user.role === 'admin'
        ? '/admin/dashboard'
        : user.role === 'educator'
          ? '/educator/dashboard'
          : '/student/dashboard';
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}
