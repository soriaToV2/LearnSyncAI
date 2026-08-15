import type { LucideIcon } from 'lucide-react';
import { ShieldCheck } from 'lucide-react';
import { type AuthUser, fullName, initials } from '../../context/AuthContext';

export interface ProfileFact {
  icon: LucideIcon;
  label: string;
  value: string;
  /**
   * Why this one cannot be edited. Rendered under the value in muted type.
   *
   * Load-bearing on `grade_level`: `PATCH /api/auth/me` refuses it, because
   * `materialAccess.ts` gates every student read on it. Without a stated reason
   * its absence from the form below reads as a missing feature rather than a
   * deliberate one.
   */
  note?: string;
}

interface ProfileCardProps {
  user: AuthUser | null;
  /** The portal's live theme accent — this component sits under either provider. */
  accent: string;
  accentSoft: string;
  /** "Student" / "Educator". Not derived from `user.role` so the copy stays editable. */
  roleLabel: string;
  facts: ProfileFact[];
}

/**
 * The signed-in user's identity card, shared by both portals' Profile pages.
 *
 * ⚠️ EVERYTHING HERE COMES FROM `GET /api/auth/me`, AND THERE IS NOTHING ELSE.
 * `profiles` has no email column, no avatar and no institution — so the avatar is
 * a monogram, and no third field may be invented to fill the space. The pages this
 * replaced rendered an Unsplash URL, "MIT", a location, and follower counts, none
 * of which existed anywhere but in `mockStudents.ts`.
 *
 * ONE component rather than two near-identical copies, following `MeterBar`'s
 * precedent. The two portals differ only in their accent and their facts, so both
 * arrive as props; the educator page appends its own section below this card.
 *
 * READ-ONLY, and that is a real constraint rather than an omission: there is no
 * `PATCH /api/auth/me`. The deleted student Settings page had an "Edit Profile
 * Card" form that wrote to `useState` and persisted nothing.
 */
export default function ProfileCard({ user, accent, accentSoft, roleLabel, facts }: ProfileCardProps) {
  return (
    <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
      <div className="flex items-center gap-4 mb-6">
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
            {/*
              Rendered only once the profile has loaded. An "active" pill that
              appears before the fetch settles would be asserting something the
              page does not yet know.
            */}
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
          <div
            key={label}
            className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/5"
          >
            <Icon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
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
