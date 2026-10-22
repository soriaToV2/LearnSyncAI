import type { LucideIcon } from 'lucide-react';
import { ShieldCheck } from 'lucide-react';
import { type AuthUser, fullName, initials } from '../../context/AuthContext';

export interface ProfileFact {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Why this can't be edited, shown under the value (e.g. grade_level, which PATCH /auth/me refuses). */
  note?: string;
}

interface ProfileCardProps {
  user: AuthUser | null;
  /** The portal's live theme accent. */
  accent: string;
  accentSoft: string;
  /** "Student" / "Educator"; not derived from role, so the copy stays editable. */
  roleLabel: string;
  facts: ProfileFact[];
}

/**
 * Read-only identity card for every Profile page (editing lives in AccountForms). Everything comes
 * from GET /api/auth/me; there is no avatar or institution, so never invent fields.
 */
export default function ProfileCard({ user, accent, accentSoft, roleLabel, facts }: ProfileCardProps) {
  return (
    <section className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-lg shadow-black/20 p-5 sm:p-6">
      <div className="flex items-center gap-4 mb-5 sm:mb-6">
        <div
          className="w-16 h-16 rounded-2xl border flex items-center justify-center shrink-0 font-display text-xl font-bold select-none"
          style={{ backgroundColor: accentSoft, borderColor: `${accent}40`, color: accent }}
        >
          {initials(user)}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-white truncate">
            {fullName(user) || 'Your account'}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="px-2 py-0.5 rounded-md bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-[10px] font-bold uppercase tracking-wider">
              {roleLabel}
            </span>
            {/* Only once loaded, so the pill never asserts an unknown status. */}
            {user && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-sans text-[10px] font-bold uppercase tracking-wider">
                <ShieldCheck className="w-3 h-3" />
                {user.status}
              </span>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {facts.map(({ icon: Icon, label, value, note }) => (
          /* bg-white/5 so the tiles show against the card's bg-white/[0.02]. */
          <div
            key={label}
            className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/5 border border-white/5"
          >
            {/* Tinted with the portal accent (the monogram's `${accent}40` idiom). */}
            <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: `${accent}B3` }} />
            <div className="min-w-0">
              <dt className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                {label}
              </dt>
              <dd className="font-sans text-sm text-slate-200 break-words">{value}</dd>
              {note && <p className="font-sans text-[11px] text-slate-500 mt-1">{note}</p>}
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
