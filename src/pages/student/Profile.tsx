import { User, GraduationCap, CalendarDays, Clock } from 'lucide-react';
import { useStudentTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../data/mockEducator';
import ProfileCard, { type ProfileFact } from '../../components/common/ProfileCard';
import AccountForms from '../../components/common/AccountForms';

/**
 * The student's own account.
 *
 * ⚠️ THE CARD IS READ-ONLY AND THE FORMS BELOW IT ARE NOT, AND THE SPLIT IS THE
 * POINT. Everything on the card is either derived or administrator-owned;
 * everything in the forms is the student's to change. `grade_level` carries its
 * reason explicitly, because `PATCH /api/auth/me` refuses it and an unexplained
 * gap in the form would read as a bug rather than a boundary.
 *
 * Replaces two pages that were entirely invented: `Settings.tsx`, which rendered
 * `MOCK_STUDENTS[0]` — an Unsplash avatar, "MIT", a location, follower counts and
 * an "Edit Profile Card" form that persisted nothing — and `StudentProfile.tsx`,
 * whose "Public Study Spaces" tab was CollabShare, the peer sharing migration
 * 0003 removed as contradicting the paper's data-isolation guarantee.
 */
export default function Profile() {
  const { theme } = useStudentTheme();
  const { user, isLoading, error } = useAuth();

  const facts: ProfileFact[] = [
    {
      icon: User,
      label: 'Role',
      value: 'Student — studies the materials published to your grade',
    },
    {
      icon: GraduationCap,
      label: 'Grade level',
      /*
       * `grade_level` is NOT NULL for students by DB constraint, so the fallback
       * is unreachable in practice — it exists so a null cannot render as
       * "Grade null" if that constraint ever changes.
       */
      value: user?.grade_level != null ? `Grade ${user.grade_level}` : 'Not set',
      note: 'Only an administrator can change this — it decides which materials you can open.',
    },
    {
      icon: CalendarDays,
      label: 'Member since',
      value: user ? formatDate(user.created_at) : '—',
    },
    {
      icon: Clock,
      label: 'Last signed in',
      value: user?.last_sign_in_at ? formatDate(user.last_sign_in_at) : '—',
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
            roleLabel="Student"
            facts={facts}
          />

          <AccountForms accent={theme.accent} />
        </div>
      </div>
    </main>
  );
}
