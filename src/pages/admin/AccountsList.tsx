import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronLeft, ChevronRight, Users, UploadCloud } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import Dropdown from '../../components/ui/Dropdown';
import { useAdminTheme, inkOn } from '../../context/ThemeContext';
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

const GRADES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All grades' },
  ...[7, 8, 9, 10].map((g) => ({ value: String(g), label: `Grade ${g}` })),
];

/**
 * ⚠️ `ring-inset`. The account rows are spaced `gap-2` — 8px — and each is a
 * full-width `<Link>`, so an outward ring plus an offset reaches into the gap
 * and touches its neighbour. Same token as both other dashboards.
 */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

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
      {/* `sm:` steps on both axes, plus the entrance the other two portals use. */}
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
              Accounts
            </h1>
            <p className="font-sans text-sm text-on-surface-variant mt-1.5">
              {page ? `${page.total} account${page.total === 1 ? '' : 's'}` : 'Loading…'}
            </p>
          </div>
          {/*
            Two actions, one primary. Creating a single account is the everyday
            case; a bulk import happens once or twice a term, so it takes the
            bordered treatment. Wrapped together so they wrap as a pair inside the
            header's `flex-wrap` rather than the Import button dropping alone.

            ⚠️ FULL WIDTH AND EQUAL HALVES BELOW `sm:`. Once the pair wraps onto
            its own line on a phone it has the full 343px to sit in, and two
            content-fitted buttons totalling ~240px left-aligned under a heading
            reads as a fragment of a row rather than as the page's actions. Equal
            halves also gives each a ~165px target instead of ~110px.
          */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setIsCreateOpen(true)}
              style={{ backgroundColor: theme.accent, color: inkOn(theme.accent) }}
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-display text-xs font-bold hover:brightness-110 transition-all active:scale-95 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-surface"
            >
              <Plus className="w-4 h-4" />
              New account
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 font-display text-xs font-bold transition-colors active:scale-95 whitespace-nowrap ${FOCUS}`}
            >
              <UploadCloud className="w-4 h-4" />
              Import
            </button>
          </div>
        </header>

        {error && <ErrorBanner message={error} />}

        {/*
          ── Filters ──
          Deliberately the SAME control set and the same reflow as the educator
          materials library, because they are the same job: one search box that
          takes the leftover width, then the narrow filters beside it.

          ⚠️ THE THREE NATIVE `<select>`s ARE GONE, AND THAT IS THE SUBSTANTIVE
          PART. They rendered as OS dropdowns — a different height, a different
          corner radius and a different font from every other control in the
          product — and their options were styled with `className="bg-slate-900"`
          on each `<option>`, a hardcoded dark fill. In light mode that is dark
          text on a dark panel inside an otherwise white page, and no theme
          override can reach it: option styling is barely honoured by browsers
          and not at all on some platforms. `Dropdown` renders real elements, so
          it themes like everything else and keyboards get the same affordances
          the rest of the app has.

          The row is `grid-cols-2` on a phone with Status spanning both — three
          filters do not divide into two columns, and a half-width control with
          a hole beside it reads as a missing filter. Three across from `sm:`,
          and only at `lg:` do they sit inline beside the search box.
        */}
        <section className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={q}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="Search name or username..."
              aria-label="Search accounts by name or username"
              spellCheck={false}
              className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs font-semibold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-2.5 sm:gap-3">
            <Dropdown
              value={role}
              onChange={(v) => setFilter('role', v)}
              options={ROLES}
              className="w-full lg:w-40"
            />
            <Dropdown
              value={grade}
              onChange={(v) => setFilter('grade', v)}
              options={GRADES}
              className="w-full lg:w-36"
            />
            <Dropdown
              value={status}
              onChange={(v) => setFilter('status', v)}
              options={STATUSES}
              className="col-span-2 sm:col-span-1 w-full lg:w-36"
            />
          </div>
        </section>

        {isLoading && !page && (
          <div className="flex items-center gap-2.5 text-slate-500 py-12 justify-center">
            <Spinner className="w-4 h-4" />
            <span className="font-sans text-sm">Loading accounts…</span>
          </div>
        )}

        {page && page.accounts.length === 0 && (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 shadow-lg shadow-black/20 py-16 px-6 text-center animate-tab-in">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="font-display text-base font-bold text-slate-300">No accounts match</p>
            <p className="font-sans text-sm text-slate-500 mt-1.5">
              Try clearing a filter, or create an account.
            </p>
          </div>
        )}

        {page && page.accounts.length > 0 && (
          /*
            ⚠️ `animate-tab-in` IS KEYED, AND THE KEY IS THE FILTER SET, NOT THE
            PAGE OBJECT. Every keystroke in the search box refetches, so keying
            on anything that changes per response would restart the animation
            mid-type and make the list strobe. Keyed on the four filters plus the
            page number, it fires when the reader actually changed what they are
            looking at — and, because the list is absent until the first response,
            on the initial load too.
          */
          <div
            key={`${role}|${grade}|${status}|${q}|${pageNumber}`}
            className={`flex flex-col gap-2 animate-tab-in ${isLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}`}
          >
            {page.accounts.map((account) => (
              <Link
                key={account.id}
                to={`/admin/accounts/${account.id}`}
                className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 sm:py-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-colors group ${FOCUS}`}
              >
                {/* The monogram takes the portal accent inline rather than
                    through `.tone-chip`, and that is correct here: `theme`
                    already switches with the light/dark toggle (the white theme
                    carries its own `#0284c7` accent and a matching soft tint),
                    so both halves are mode-aware without a mix. */}
                <div
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border border-white/10 font-display text-xs font-bold shrink-0"
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

                  {/*
                    ⚠️ ON A PHONE THE PILLS STACK UNDER THE NAME; THEY ARE NOT
                    SQUEEZED IN BESIDE IT. Role and status are the two facts an
                    administrator scans this list for, so they belong at every
                    width — but placed on the right at 375px they take ~140px of
                    a 343px row, leaving under 150px for a name and a username
                    that are already `truncate`d. "Angelo Soria · @angelo.soria"
                    would be cut mid-word to make room for a chip that says
                    "STUDENT".

                    Below the subtitle they get the full column, wrap on their
                    own, and cost one line of height. `flex-wrap` matters:
                    "CANNOT SIGN IN" alongside the other two exceeds 343px.
                  */}
                  <div className="flex sm:hidden flex-wrap items-center gap-1.5 mt-2">
                    {account.username === null && <CannotSignInPill />}
                    <RolePill role={account.role} />
                    <StatusPill account={account} />
                  </div>
                </div>

                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  {account.username === null && <CannotSignInPill />}
                  <RolePill role={account.role} />
                  <StatusPill account={account} />
                </div>

                <ChevronRight className="hidden sm:block w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors" />
              </Link>
            ))}
          </div>
        )}

        {page && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setFilter('page', String(page.page - 1))}
              disabled={page.page <= 1}
              className={`p-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none transition-colors ${FOCUS}`}
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
              className={`p-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none transition-colors ${FOCUS}`}
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
