import { User, GraduationCap, CalendarDays, Clock, UserCircle } from 'lucide-react';
import { useStudentTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../data/mockEducator';
import ProfileCard, { type ProfileFact } from '../../components/common/ProfileCard';
import AccountForms from '../../components/common/AccountForms';
import AppearanceCard from '../../components/common/AppearanceCard';

/**
 * The student's own account: a read-only card (derived or admin-owned facts, with grade_level's reason
 * stated) above the editable forms.
 */
export default function Profile() {
  const { theme, mode, setMode } = useStudentTheme();
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
      // grade_level is NOT NULL for students; the fallback only avoids "Grade null".
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
      {/* sm: steps so tablets don't jump from phone to desktop padding. */}
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">
        <header className="mb-7 sm:mb-8 flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: theme.accentSoft }}
          >
            <UserCircle className="w-5 h-5" style={{ color: theme.accent }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-on-surface truncate">
              Profile
            </h1>
            <p className="font-sans text-sm text-on-surface-variant mt-0.5">
              Your account details and how you sign in.
            </p>
          </div>
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

          {/* Above the credential forms: it takes effect instantly and asks for nothing. */}
          <AppearanceCard
            mode={mode}
            onChange={setMode}
            accent={theme.accent}
            accentSoft={theme.accentSoft}
          />

          <AccountForms accent={theme.accent} />
        </div>
      </div>
    </main>
  );
}
