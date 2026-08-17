import { AlertTriangle, Hourglass, KeyRound, ShieldOff } from 'lucide-react';
import {
  accountState,
  ACCOUNT_STATE_LABEL,
  type AccountRole,
  type AccountState,
  type AdminAccount,
} from '../../../lib/adminAccounts';

/**
 * The small display pieces the admin pages share.
 *
 * Kept beside the pages rather than in `src/components/ui/` because every one of
 * them encodes an *account* concept — a status, a role, an account that cannot
 * sign in. None of it is general-purpose UI.
 */

/** An error banner, matching the inline rose pill used across the educator portal. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 mb-6">
      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
      <p className="font-sans text-sm text-rose-300">{message}</p>
    </div>
  );
}

const ROLE_STYLE: Record<AccountRole, string> = {
  student: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
  educator: 'bg-violet-500/10 border-violet-500/20 text-violet-300',
  admin: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
};

export function RolePill({ role }: { role: AccountRole }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider ${ROLE_STYLE[role]}`}
    >
      {role}
    </span>
  );
}

/**
 * ⚠️ `disabled` IS NOT AN ERROR STATE, AND IS NOT STYLED AS ONE.
 *
 * It is the deliberate, reversible act this portal offers instead of deletion —
 * a student who left the school, an account parked between terms. Rose would
 * read as a fault, and would put the most ordinary administrative action on the
 * page in the same colour as a failure.
 *
 * `not_activated` is amber for the same reason inverted: it is not a fault
 * either, but it IS something to act on — the account is out in the world with a
 * password the administrator also knows.
 *
 * Takes the whole account rather than a status, because the state shown here is
 * derived from two columns. See `accountState()`.
 */
const STATE_STYLE: Record<AccountState, string> = {
  active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  not_activated: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
  disabled: 'bg-slate-500/10 border-slate-500/25 text-slate-400',
};

export function StatusPill({ account }: { account: AdminAccount }) {
  const state = accountState(account);
  return (
    <span
      title={
        state === 'not_activated'
          ? 'Signed in for the first time yet? This account still uses the password you set, so it is not private until they change it.'
          : undefined
      }
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider ${STATE_STYLE[state]}`}
    >
      {state === 'disabled' && <ShieldOff className="w-3 h-3" />}
      {state === 'not_activated' && <Hourglass className="w-3 h-3" />}
      {ACCOUNT_STATE_LABEL[state]}
    </span>
  );
}

/**
 * Flags `username === null`.
 *
 * `handle_new_user()` degrades a malformed or already-taken username to NULL
 * rather than raising, because an exception in that trigger would abort the
 * account creation itself. The result is an account that exists, looks entirely
 * healthy in a list, and **cannot sign in** — so it has to be called out
 * explicitly or it is invisible until a student reports it.
 */
export function CannotSignInPill() {
  return (
    <span
      title="This account has no username, so nobody can sign in to it. Set one to fix it."
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border bg-amber-500/10 border-amber-500/25 text-amber-300 font-sans text-[10px] font-bold uppercase tracking-wider"
    >
      <KeyRound className="w-3 h-3" />
      Cannot sign in
    </span>
  );
}

/** Long date, matching `formatDate` in the educator portal. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
