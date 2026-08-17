import { User, ShieldCheck, CalendarDays, Clock } from 'lucide-react';
import { useAdminTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ProfileCard, { type ProfileFact } from '../../components/common/ProfileCard';
import AccountForms from '../../components/common/AccountForms';
import { formatWhen } from './components/accountUi';

/**
 * The administrator's own account.
 *
 * Reuses `ProfileCard` and `AccountForms` unchanged — this is self-service, and
 * what a user may change about themselves does not vary by role. The admin's
 * extra powers live in `/admin/accounts/:userId`, applied to other people.
 *
 * ⚠️ AN ADMIN CANNOT CHANGE THEIR OWN ROLE OR STATUS, HERE OR ANYWHERE.
 * `PATCH /api/auth/me` omits both from `UpdateProfileSchema`, and the admin
 * routes refuse them on `req.user!.id` with a 400. There is one admin account on
 * this deployment: a self-demotion or a self-disable would lock every
 * administrator out permanently, including out of the request that would undo it.
 */
export default function AdminProfile() {
  const { theme } = useAdminTheme();
  const { user, isLoading, error } = useAuth();

  const facts: ProfileFact[] = [
    {
      icon: User,
      label: 'Role',
      value: 'Administrator — manages accounts',
      note: 'Learning materials and student progress are not visible to this role.',
    },
    {
      icon: ShieldCheck,
      label: 'Account status',
      value: user?.status ?? '—',
      note: 'You cannot disable your own account — it would lock you out with no way back.',
    },
    {
      icon: CalendarDays,
      label: 'Member since',
      value: formatWhen(user?.created_at),
    },
    {
      icon: Clock,
      label: 'Last signed in',
      value: formatWhen(user?.last_sign_in_at),
      note: "If this wasn't you, change your password below.",
    },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[900px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-on-surface">Profile</h1>
          <p className="font-sans text-sm text-on-surface-variant mt-1.5">
            Your account details and how you sign in.
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4">
            <p className="font-sans text-sm text-rose-300">{error}</p>
          </div>
        )}

        <div
          className={`flex flex-col gap-6 ${isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
        >
          <ProfileCard
            user={user}
            accent={theme.accent}
            accentSoft={theme.accentSoft}
            roleLabel="Administrator"
            facts={facts}
          />

          <AccountForms accent={theme.accent} />
        </div>
      </div>
    </main>
  );
}
