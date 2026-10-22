import { AlertTriangle, Hourglass, KeyRound, ShieldOff } from 'lucide-react';
import {
  accountState,
  ACCOUNT_STATE_LABEL,
  type AccountRole,
  type AccountState,
  type AdminAccount,
} from '../../../lib/adminAccounts';

/** Display pieces the admin pages share; kept here because each encodes an account concept. */

/** An error banner, matching the educator portal's inline rose pill. */
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
 * Account state pill. `disabled` is a reversible admin action, not an error, so it isn't rose;
 * `not_activated` is amber because it needs acting on. Takes the account because the state is
 * derived from two columns (see accountState()).
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

/** Flags a NULL username: handle_new_user() degrades a bad one to NULL, leaving an account that can't sign in. */
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
