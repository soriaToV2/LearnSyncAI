import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, AtSign, CalendarDays, Clock, GraduationCap, Hourglass, KeyRound,
  Loader2, ShieldCheck, ShieldOff, User, UserPen, Check, Copy,
} from 'lucide-react';
import { useAdminTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  Field, Section, SaveButton, StatusLine, messageOf, useSubmitLatch, type Status,
} from '../../components/common/formKit';
import {
  isPasswordValid,
  passwordProblem,
  PASSWORD_HINT,
  USERNAME_HINT,
  usernameProblem,
} from '../../lib/account';
import {
  adminApi, contactEmail, ROLE_LABEL,
  type AdminAccountDetail, type AssignableRole,
} from '../../lib/adminAccounts';
import { CannotSignInPill, ErrorBanner, formatWhen, RolePill, StatusPill } from './components/accountUi';

/**
 * One account, and everything an administrator may do to it.
 *
 * ⚠️ THREE FORMS, NOT ONE — the same split, for the same reason, as the
 * self-service Profile page. Details, password and status are three actions with
 * three different consequences: a rejected password must not roll back a saved
 * name, and disabling an account is not something to bundle behind a Save that
 * also fixes a typo in a surname.
 *
 * A user id in the URL is correct here and is NOT the pattern the student and
 * educator dashboards avoid. Those derive everything from `req.user!.id` because
 * a student's id in a URL is an IDOR surface on a student-facing route.
 * Administering every account is what this role IS; `requireRole('admin')` on the
 * server is the authorisation, and there is nothing narrower to scope to.
 */

const GRADES = [7, 8, 9, 10];
/* The password rule lives in `src/lib/account.ts`, mirroring the server. */

// ── details: names, username, role, grade ───────────────────────────────────

function DetailsForm({
  account,
  accent,
  isSelf,
  onSaved,
}: {
  account: AdminAccountDetail;
  accent: string;
  isSelf: boolean;
  onSaved: () => void;
}) {
  const [first, setFirst] = useState(account.first_name);
  const [last, setLast] = useState(account.last_name);
  const [username, setUsername] = useState(account.username ?? '');
  const [role, setRole] = useState(account.role);
  const [grade, setGrade] = useState<number | null>(account.grade_level);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const latch = useSubmitLatch();

  useEffect(() => {
    setFirst(account.first_name);
    setLast(account.last_name);
    setUsername(account.username ?? '');
    setRole(account.role);
    setGrade(account.grade_level);
  }, [account]);

  /*
   * An existing admin's role is not editable here, and neither is your own — both
   * are refused by the server (400). Rendering the control anyway would be a form
   * that looks functional and cannot save, which is the failure mode this codebase
   * keeps removing.
   */
  const roleEditable = account.role !== 'admin' && !isSelf;

  const trimmed = {
    first: first.trim(),
    last: last.trim(),
    username: username.trim().toLowerCase(),
  };

  const usernameError =
    trimmed.username === (account.username ?? '') ? null : usernameProblem(username);

  const dirty =
    trimmed.first !== account.first_name ||
    trimmed.last !== account.last_name ||
    trimmed.username !== (account.username ?? '') ||
    role !== account.role ||
    grade !== account.grade_level;

  // A student must end up with a grade; `profiles_student_needs_grade` enforces
  // it in the database and the server re-checks the resolved pair.
  const gradeOk = role !== 'student' || grade !== null;
  const canSave =
    dirty && trimmed.first.length > 0 && trimmed.last.length > 0 && !usernameError && gradeOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await adminApi.updateAccount(account.id, {
        ...(trimmed.first !== account.first_name ? { first_name: trimmed.first } : {}),
        ...(trimmed.last !== account.last_name ? { last_name: trimmed.last } : {}),
        ...(trimmed.username !== (account.username ?? '') ? { username: trimmed.username } : {}),
        ...(role !== account.role ? { role: role as AssignableRole } : {}),
        // Role and grade travel together: student → educator must clear it in the
        // same request or the DB CHECK fires.
        ...(grade !== account.grade_level || role !== account.role
          ? { grade_level: role === 'student' ? grade : null }
          : {}),
      });
      onSaved();
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not save.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  return (
    <Section
      icon={UserPen}
      title="Details"
      description="Their name, how they sign in, and what they are on the platform."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First name" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} />
          <Field label="Last name" value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} />
        </div>

        <Field
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={30}
          spellCheck={false}
          hint={
            usernameError ??
            (account.username === null
              ? 'This account has no username and cannot be signed in to. Setting one fixes it.'
              : USERNAME_HINT)
          }
        />

        {roleEditable && (
          <div className="flex flex-col gap-1.5">
            <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Role
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['student', 'educator'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    if (r === 'educator') setGrade(null);
                  }}
                  style={role === r ? { borderColor: accent, color: accent } : undefined}
                  className={`px-4 py-2.5 rounded-xl border font-display text-xs font-bold capitalize transition-colors ${
                    role === r ? 'bg-white/[0.06]' : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {role !== account.role && (
              /*
               * Worth stating plainly: nothing cascades on a role change, so it is
               * fully reversible — the same property archiving a material relies
               * on. Without saying so, an admin reasonably assumes it is not.
               */
              <p className="font-sans text-[11px] text-amber-300/90 leading-relaxed">
                Changing the role changes which portal they land in. Nothing is deleted — their
                study spaces and progress stay exactly as they are, and switching back restores
                access to them.
              </p>
            )}
          </div>
        )}

        {role === 'student' && (
          <div className="flex flex-col gap-1.5">
            <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Grade level
            </span>
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  style={grade === g ? { borderColor: accent, color: accent } : undefined}
                  className={`px-3 py-2.5 rounded-xl border font-display text-xs font-bold transition-colors ${
                    grade === g ? 'bg-white/[0.06]' : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
              Decides which materials they can open. Changing it does not delete anything.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Save changes" />
          <StatusLine status={status} />
        </div>
      </form>
    </Section>
  );
}

// ── password reset ──────────────────────────────────────────────────────────

function PasswordForm({ account, accent }: { account: AdminAccountDetail; accent: string }) {
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const latch = useSubmitLatch();

  const passwordError = passwordProblem(next);
  const canSave = isPasswordValid(next) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await adminApi.resetPassword(account.id, next);
      setIssued(next);
      setNext('');
      setStatus({ kind: 'ok', text: 'Password reset.' });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not reset the password.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  const copy = async () => {
    if (!issued || !account.username) return;
    await navigator.clipboard.writeText(`Username: ${account.username}\nPassword: ${issued}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section
      icon={KeyRound}
      title="Reset password"
      description="There is no self-service password reset on this platform, so this is the only way back in for someone who has forgotten theirs."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="New password"
          type="text"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Type the password you will give them"
          hint={
            passwordError ??
            `${PASSWORD_HINT}. Shown in plain text so you can read it out or write it down.`
          }
        />

        {issued && (
          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 flex flex-col gap-2">
            <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Give them these
            </p>
            <p className="font-mono text-sm text-white break-all">
              {account.username ?? '(no username)'} / {issued}
            </p>
            <button
              type="button"
              onClick={copy}
              className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors font-sans text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Reset password" />
          <StatusLine status={status} />
        </div>

        {/*
          Measured, not assumed: after an admin password change Supabase rejects
          both the existing access token (401) and its refresh token, so a device
          left signed in really is cut off. That holds because `authenticate`
          validates every request against the auth server rather than checking the
          JWT signature locally — see the route's JSDoc before changing either.
        */}
        {/*
          The one an admin needs BEFORE clicking: a reset re-arms
          `must_change_password`, so the account returns to "Not activated" and is
          gated again until the student chooses their own. Without this the status
          flipping backwards would look like a bug.
        */}
        <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
          They will be asked to choose their own password again the next time they sign in — this
          one is only meant to get them back in.
        </p>
      </form>
    </Section>
  );
}

// ── status ──────────────────────────────────────────────────────────────────

function StatusForm({
  account,
  accent,
  isSelf,
  onSaved,
}: {
  account: AdminAccountDetail;
  accent: string;
  isSelf: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirming, setConfirming] = useState(false);
  const latch = useSubmitLatch();

  const disabled = account.status === 'disabled';

  const apply = async () => {
    if (busy || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      await adminApi.setStatus(account.id, disabled ? 'active' : 'disabled');
      setConfirming(false);
      onSaved();
      setStatus({ kind: 'ok', text: disabled ? 'Account enabled.' : 'Account disabled.' });
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not change the status.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  return (
    <Section
      icon={disabled ? ShieldOff : ShieldCheck}
      title="Account access"
      description="Disabling revokes access immediately and deletes nothing. This is what to use when someone leaves — their work is kept, and enabling brings it all back."
    >
      {isSelf ? (
        /*
         * ⚠️ SELF-LOCKOUT. There is one admin account on this deployment; an admin
         * who disabled themselves would be refused by `requireRole` on their very
         * next request, including the one that would undo it. The server returns
         * 400 for this — the control is absent here so it is never discovered as
         * a failure.
         */
        <p className="font-sans text-sm text-slate-400 leading-relaxed">
          This is your own account. You cannot disable it — if you could, you would be locked out of
          the portal with no way back in.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <StatusPill account={account} />
            <span className="font-sans text-xs text-slate-400">
              {disabled
                ? 'Cannot sign in, and every request is refused.'
                : account.must_change_password
                  ? 'Can sign in, but only to set their own password.'
                  : 'Can sign in and use the platform normally.'}
            </span>
          </div>

          {confirming && !disabled ? (
            <div className="rounded-xl bg-rose-500/[0.07] border border-rose-500/20 p-4 flex flex-col gap-3">
              <p className="font-sans text-sm text-rose-200 leading-relaxed">
                Disable {account.first_name} {account.last_name}? They will be signed out of
                everything immediately. Nothing is deleted — you can enable the account again at any
                time and it returns exactly as it is now.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={apply}
                  disabled={busy}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-display text-xs font-bold hover:brightness-110 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-60"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Yes, disable
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white font-display text-xs font-bold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => (disabled ? apply() : setConfirming(true))}
                disabled={busy}
                style={disabled ? { backgroundColor: accent, color: '#04121a' } : undefined}
                className={`px-5 py-2.5 rounded-xl font-display text-xs font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60 ${
                  disabled ? 'hover:brightness-110' : 'bg-white/5 border border-rose-500/30 text-rose-300 hover:bg-rose-500/10'
                }`}
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {disabled ? 'Enable account' : 'Disable account'}
              </button>
              <StatusLine status={status} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function AccountDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { theme } = useAdminTheme();
  const { user: me } = useAuth();
  const [account, setAccount] = useState<AdminAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    if (!userId) return Promise.resolve();
    return adminApi
      .getAccount(userId)
      .then(setAccount)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load this account.')
      )
      .finally(() => setIsLoading(false));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isSelf = !!me && !!account && me.id === account.id;

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[900px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link
          to="/admin/accounts"
          className="inline-flex items-center gap-2 font-sans text-xs text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All accounts
        </Link>

        {error && <ErrorBanner message={error} />}

        {isLoading && (
          <div className="flex items-center gap-2.5 text-slate-500 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-sans text-sm">Loading…</span>
          </div>
        )}

        {account && (
          <div className="flex flex-col gap-6">
            {/*
              Rendered only while it is true, and it says what to DO about it —
              a banner that appears on every account would stop being read.
            */}
            {account.must_change_password && account.status === 'active' && (
              <div className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-amber-500/[0.07] border border-amber-500/20">
                <Hourglass className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-display text-sm font-bold text-white">Waiting for first sign-in</p>
                  <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                    This account still uses the password you set, so it is not private yet. They
                    will be asked to choose their own the first time they sign in, and until then
                    they cannot use the rest of the platform.
                  </p>
                </div>
              </div>
            )}

            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center gap-4 mb-6">
                <div
                  className="w-16 h-16 rounded-2xl border flex items-center justify-center shrink-0 font-display text-xl font-bold select-none"
                  style={{
                    backgroundColor: theme.accentSoft,
                    borderColor: `${theme.accent}40`,
                    color: theme.accent,
                  }}
                >
                  {(account.first_name[0] ?? '') + (account.last_name[0] ?? '') || '?'}
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-xl font-semibold text-white truncate">
                    {account.first_name} {account.last_name}
                    {isSelf && <span className="text-slate-500 font-sans text-sm ml-2">(you)</span>}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <RolePill role={account.role} />
                    <StatusPill account={account} />
                    {account.username === null && <CannotSignInPill />}
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    icon: User,
                    label: 'Role',
                    value: ROLE_LABEL[account.role],
                  },
                  {
                    icon: GraduationCap,
                    label: 'Grade level',
                    value: account.grade_level === null ? '—' : `Grade ${account.grade_level}`,
                    note:
                      account.role === 'student'
                        ? 'Decides which materials this student can open.'
                        : 'Educators choose grades per material at upload.',
                  },
                  {
                    icon: AtSign,
                    label: 'Email',
                    value: contactEmail(account),
                    note: 'Contact only — they sign in with their username.',
                  },
                  { icon: CalendarDays, label: 'Created', value: formatWhen(account.created_at) },
                  {
                    icon: Clock,
                    label: 'Last signed in',
                    value: formatWhen(account.last_sign_in_at),
                    note: account.last_sign_in_at ? undefined : 'This account has never been used.',
                  },
                ].map(({ icon: Icon, label, value, note }) => (
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

            <DetailsForm account={account} accent={theme.accent} isSelf={isSelf} onSaved={load} />
            <PasswordForm account={account} accent={theme.accent} />
            <StatusForm account={account} accent={theme.accent} isSelf={isSelf} onSaved={load} />
          </div>
        )}
      </div>
    </main>
  );
}
