import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Search, ChevronLeft, ChevronRight, Users, UploadCloud } from 'lucide-react';
import { useAdminTheme } from '../../context/ThemeContext';
import {
  adminApi,
  accountSubtitle,
  type AccountRole,
  type AccountStatus,
  type AccountsPage,
} from '../../lib/adminAccounts';
import { CannotSignInPill, ErrorBanner, RolePill, StatusPill } from './components/accountUi';
import CreateAccountModal from './components/CreateAccountModal';
import ImportAccountsModal from './components/ImportAccountsModal';

/**
 * Every account in the school, filtered.
 *
 * ⚠️ THERE IS NO DELETE CONTROL HERE OR ANYWHERE IN THIS PORTAL, BY DESIGN.
 * Thirteen tables CASCADE from `profiles` — study spaces, BKT mastery, telemetry,
 * every log — so deleting one student destroys their entire measured history
 * irrecoverably, which for a 50-student study is the research data itself.
 * `schema.sql` states the intended idiom on the column: disable to revoke access
 * without deleting. Disabling is reversible and loses nothing.
 *
 * Filters live in the URL so the dashboard's attention cards can link straight to
 * a filtered view, and so a filtered list can be shared or reloaded.
 */

const ROLES: Array<{ value: AccountRole | 'all'; label: string }> = [
  { value: 'all', label: 'All roles' },
  { value: 'student', label: 'Students' },
  { value: 'educator', label: 'Educators' },
  { value: 'admin', label: 'Admins' },
];

const STATUSES: Array<{ value: AccountStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];

const GRADES = ['all', '7', '8', '9', '10'] as const;

export default function AccountsList() {
  const { theme } = useAdminTheme();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const role = (params.get('role') ?? 'all') as AccountRole | 'all';
  const status = (params.get('status') ?? 'all') as AccountStatus | 'all';
  const grade = params.get('grade') ?? 'all';
  const q = params.get('q') ?? '';
  const pageNumber = Number(params.get('page') ?? '1');

  /** Writes one filter and resets to page 1 — a filtered page 3 is usually empty. */
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all' || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  /*
   * Every keystroke in the search box fires a request, so responses can land out
   * of order — and the one that lands last wins, not the one asked for last.
   * `requestId` stamps each call and only the newest is allowed to write state.
   *
   * A ref rather than a cancellation flag in the effect: `load()` is also called
   * directly by the create modal's success path, where there is no effect
   * teardown to hang a flag on.
   */
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);
    return adminApi
      .listAccounts({
        ...(role !== 'all' ? { role } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(grade !== 'all' ? { grade: Number(grade) } : {}),
        ...(q ? { q } : {}),
        page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
      })
      .then((data) => {
        if (id === requestId.current) setPage(data);
      })
      .catch((err: unknown) => {
        if (id === requestId.current) {
          setError(err instanceof Error ? err.message : 'Could not load accounts.');
        }
      })
      .finally(() => {
        if (id === requestId.current) setIsLoading(false);
      });
  }, [role, status, grade, q, pageNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1;

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1100px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-semibold text-on-surface">Accounts</h1>
            <p className="font-sans text-sm text-on-surface-variant mt-1.5">
              {page ? `${page.total} account${page.total === 1 ? '' : 's'}` : 'Loading…'}
            </p>
          </div>
          {/*
            Two actions, one primary. Creating a single account is the everyday
            case; a bulk import happens once or twice a term, so it takes the
            bordered treatment. Wrapped together so they wrap as a pair inside the
            header's `flex-wrap` rather than the Import button dropping alone.
          */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreateOpen(true)}
              style={{ backgroundColor: theme.accent, color: '#04121a' }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-display text-xs font-bold hover:brightness-110 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              New account
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 font-display text-xs font-bold transition-colors active:scale-95"
            >
              <UploadCloud className="w-4 h-4" />
              Import
            </button>
          </div>
        </header>

        {error && <ErrorBanner message={error} />}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="Search name or username"
              spellCheck={false}
              className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-on-surface font-sans text-sm outline-none transition-colors focus:border-white/25"
            />
          </div>

          <select
            value={role}
            onChange={(e) => setFilter('role', e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-white/25"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value} className="bg-slate-900">
                {r.label}
              </option>
            ))}
          </select>

          <select
            value={grade}
            onChange={(e) => setFilter('grade', e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-white/25"
          >
            {GRADES.map((g) => (
              <option key={g} value={g} className="bg-slate-900">
                {g === 'all' ? 'Any grade' : `Grade ${g}`}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-white/25"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value} className="bg-slate-900">
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading && !page && (
          <div className="flex items-center gap-2.5 text-slate-500 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-sans text-sm">Loading accounts…</span>
          </div>
        )}

        {page && page.accounts.length === 0 && (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 py-16 px-6 text-center">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="font-display text-base font-bold text-slate-300">No accounts match</p>
            <p className="font-sans text-sm text-slate-500 mt-1.5">
              Try clearing a filter, or create an account.
            </p>
          </div>
        )}

        {page && page.accounts.length > 0 && (
          <div
            className={`flex flex-col gap-2 ${isLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}`}
          >
            {page.accounts.map((account) => (
              <Link
                key={account.id}
                to={`/admin/accounts/${account.id}`}
                className="flex items-center gap-4 px-5 py-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-colors group"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center border border-white/10 font-display text-xs font-bold shrink-0"
                  style={{ backgroundColor: theme.accentSoft, color: theme.accent }}
                >
                  {(account.first_name[0] ?? '') + (account.last_name[0] ?? '') || '?'}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-white truncate">
                    {account.first_name} {account.last_name}
                  </p>
                  <p className="font-sans text-xs text-slate-500 truncate">
                    {account.username ? `@${account.username}` : 'No username'} ·{' '}
                    {accountSubtitle(account)}
                  </p>
                </div>

                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  {account.username === null && <CannotSignInPill />}
                  <RolePill role={account.role} />
                  <StatusPill account={account} />
                </div>

                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors" />
              </Link>
            ))}
          </div>
        )}

        {page && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setFilter('page', String(page.page - 1))}
              disabled={page.page <= 1}
              className="p-2 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-sans text-xs text-slate-400 tabular-nums">
              Page {page.page} of {totalPages}
            </span>
            <button
              onClick={() => setFilter('page', String(page.page + 1))}
              disabled={page.page >= totalPages}
              className="p-2 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <CreateAccountModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={load}
        accent={theme.accent}
      />

      {/*
        Note that `load()` respects the filters currently in the URL, so importing
        a class of students while `role=educator` is set refreshes to a list
        showing none of them. Creating one account behaves the same way; it is the
        filter working, not the import failing.
      */}
      <ImportAccountsModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={load}
        accent={theme.accent}
      />
    </main>
  );
}
