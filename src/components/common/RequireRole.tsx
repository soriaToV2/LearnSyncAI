import React from 'react';
import { Navigate } from 'react-router-dom';
import {} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useAuth, type UserRole } from '../../context/AuthContext';

/**
 * Client route guard for all three portals; renders nothing until the profile has loaded. The server
 * is the real boundary, but the UI shouldn't show a portal the viewer can't use. Mounted inside the
 * layout's AuthProvider.
 */
export default function RequireRole({
  allow,
  children,
}: {
  allow: UserRole[];
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  // Wait for the fetch: `user` is null on first render, so redirecting now would bounce legit users.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <Spinner className="w-6 h-6 text-slate-500" />
      </div>
    );
  }

  // No profile: not signed in, or a stale token.
  if (!user) return <Navigate to="/login" replace />;

  // Activation first, whatever the role: an admin-set password means every data route 403s.
  // /set-password is mounted outside every guarded layout, or this would loop.
  if (user.must_change_password) return <Navigate to="/set-password" replace />;

  // Signed in as another role: send them to their own portal, not /login. `replace` throughout.
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
