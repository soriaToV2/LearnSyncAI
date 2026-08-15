import { User, GraduationCap, CalendarDays, BookOpen, Clock } from 'lucide-react';
import { useEducatorTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../data/mockEducator';
import ProfileCard, { type ProfileFact } from '../../components/common/ProfileCard';
import AccountForms from '../../components/common/AccountForms';

/**
 * The educator's own account.
 *
 * ⚠️ THE EMAIL SHOWN HERE IS THE REAL ONE, FROM `auth.users`, AND THAT IS A
 * NARROW EXCEPTION TO A RULE WORTH RESTATING. The Settings page this replaces
 * printed "liza.mendoza@pca.edu.ph" — a constant in `mockEducator.EDUCATOR` — to
 * every educator, which is why `profiles` having no email column became "no email
 * anywhere". The rule was against INVENTING one. `auth.users.email` is genuine,
 * the user owns it, and after migration 0021 it is contact information rather
 * than a credential. Nothing fabricated has come back.
 *
 * The publishing explainer moved across from the deleted Settings page verbatim.
 * It is the one thing on that page worth keeping: an educator is assigned nothing
 * in advance, so "which grades am I responsible for?" has no answer until they
 * upload something, and this is where that is said.
 */
export default function EducatorProfile() {
  const { theme } = useEducatorTheme();
  const { user, isLoading, error } = useAuth();

  const facts: ProfileFact[] = [
    {
      icon: User,
      label: 'Role',
      value: 'Educator — uploads materials and monitors mastery',
    },
    {
      icon: GraduationCap,
      label: 'Grade access',
      value: 'Set per material as you upload it',
      note: 'Derived from what you publish — there is nothing to configure here.',
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
            roleLabel="Educator"
            facts={facts}
          />

          <AccountForms accent={theme.accent} />

          <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <div className="flex items-center gap-2 mb-5">
              <BookOpen className="w-4 h-4 text-slate-400" />
              <h2 className="font-display text-lg font-bold text-white">How Publishing Works</h2>
            </div>

            <div className="flex flex-col gap-2.5">
              {[
                'Choose the subject and the grade levels for each material as you upload it. Nothing is assigned to you in advance.',
                'Students in the grades you selected can pull that material into a study space.',
                "Open a material and its Class Performance tab shows exactly those grades — publish to Grade 8 and you see Grade 8's students.",
                'An administrator manages accounts only, and never sees student learning data.',
              ].map((line, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/5"
                >
                  <span className="w-5 h-5 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5 font-sans text-[10px] font-bold text-slate-400 tabular-nums">
                    {i + 1}
                  </span>
                  <p className="font-sans text-xs text-slate-300 leading-relaxed">{line}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
