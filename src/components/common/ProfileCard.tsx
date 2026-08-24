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
          /* `bg-white/5`, not `bg-white/[0.02]`: the card behind these is ALSO
             `bg-white/[0.02]`, so the tiles were invisible against it and the
             four facts read as one undifferentiated block. Both values are
             patched in the `[data-theme="white"]` block, so the light theme is
             unaffected by the swap. */
          <div
            key={label}
            className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/5 border border-white/5"
          >
            {/* Tinted with the portal's own accent — the same prop the monogram
                uses, so the card reads as one object instead of a coloured
                square above four grey rows. Alpha suffix matches the
                `${accent}40` idiom already used for the monogram border. */}
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
