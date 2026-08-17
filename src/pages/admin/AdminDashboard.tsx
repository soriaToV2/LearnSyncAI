import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, GraduationCap, BookUser, Hourglass, KeyRound, ShieldOff, Loader2, ArrowRight } from 'lucide-react';
import { useAuth, displayName } from '../../context/AuthContext';
import { adminApi, type AdminOverview } from '../../lib/adminAccounts';
import { ErrorBanner } from './components/accountUi';

/**
 * The admin's landing page.
 *
 * ⚠️ EVERY FIGURE ON THIS PAGE IS A COUNT OF ACCOUNTS. There is no mastery here,
 * no test scores, no material counts and no class performance — this role "does
 * not interact with learning content, study activities, or analytics"
 * (ARCHITECTURE.md:14, README.md:191, CLAUDE.md:14, schema.sql:13), and a
 * dashboard is the easiest place in an application to cross that line by
 * accident.
 *
 * `GET /api/admin/overview` accepts nothing at all — no body, no query, no path
 * parameter — so it cannot be pointed at anyone else's data. That is the same bar
 * `GET /api/dashboard` and `GET /api/educator/overview` are held to, and any
 * future global read should meet it too.
 */

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-slate-500" />
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          {label}
        </p>
      </div>
      <p className="font-display text-3xl font-bold text-white tabular-nums">{value}</p>
      {hint && <p className="font-sans text-[11px] text-slate-500 mt-1.5">{hint}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .overview()
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the overview.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The operational signals, mirroring the educator dashboard's `attention`:
   * rendered only when something actually needs attention. A permanent "all
   * clear" card is a widget that reports nothing, every day, forever.
   *
   * `never_signed_in` is null when `auth.users` could not be paged — shown as
   * "unknown" rather than 0, because 0 would be a claim the page cannot support.
   */
  const attentionItems = overview
    ? [
        {
          key: 'cannot_sign_in',
          count: overview.attention.cannot_sign_in,
          icon: KeyRound,
          title: 'Cannot sign in',
          body: 'These accounts have no username. Nobody can sign in to them until one is set.',
          to: '/admin/accounts',
          tone: 'amber' as const,
        },
        {
          key: 'not_activated',
          count: overview.attention.not_activated,
          icon: Hourglass,
          title: 'Not activated',
          body: 'Still using the password you gave them, so it is not private yet. They set their own the first time they sign in.',
          to: '/admin/accounts',
          tone: 'amber' as const,
        },
        {
          key: 'disabled',
          count: overview.attention.disabled,
          icon: ShieldOff,
          title: 'Disabled',
          body: 'Access is revoked. Nothing has been deleted — enabling restores the account intact.',
          to: '/admin/accounts?status=disabled',
          tone: 'slate' as const,
        },
      ].filter((item) => item.count !== 0)
    : [];

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1100px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-on-surface">
            {user ? `Hi, ${displayName(user)}` : 'Dashboard'}
          </h1>
          <p className="font-sans text-sm text-on-surface-variant mt-1.5">
            Accounts for the students and educators at Pasig Christian Academy.
          </p>
        </header>

        {error && <ErrorBanner message={error} />}

        {isLoading && (
          <div className="flex items-center gap-2.5 text-slate-500 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-sans text-sm">Loading accounts…</span>
          </div>
        )}

        {overview && (
          <div className="flex flex-col gap-8">
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Users}
                label="All accounts"
                value={overview.totals.all}
                hint={`${overview.totals.active} active · ${overview.totals.disabled} disabled`}
              />
              <StatCard icon={GraduationCap} label="Students" value={overview.totals.students} />
              <StatCard icon={BookUser} label="Educators" value={overview.totals.educators} />
              <StatCard
                icon={Users}
                label="Admins"
                value={overview.totals.admins}
                hint="Created from the Supabase dashboard"
              />
            </section>

            {attentionItems.length > 0 && (
              <section>
                <h2 className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                  Needs attention
                </h2>
                <div className="flex flex-col gap-3">
                  {attentionItems.map(({ key, count, icon: Icon, title, body, to, tone }) => (
                    <Link
                      key={key}
                      to={to}
                      className={`flex items-start gap-3.5 px-5 py-4 rounded-2xl border transition-colors group ${
                        tone === 'amber'
                          ? 'bg-amber-500/[0.07] border-amber-500/20 hover:bg-amber-500/10'
                          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 mt-0.5 ${tone === 'amber' ? 'text-amber-400' : 'text-slate-400'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-sm font-bold text-white">
                          {count === null ? 'Unknown' : count} · {title}
                        </p>
                        <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                          {count === null
                            ? 'The sign-in records could not be read just now. Try again shortly.'
                            : body}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5 transition-colors" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                Students by grade
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {overview.by_grade.map(({ grade, count }) => (
                  <Link
                    key={grade}
                    to={`/admin/accounts?role=student&grade=${grade}`}
                    className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 hover:bg-white/[0.04] transition-colors"
                  >
                    <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3">
                      Grade {grade}
                    </p>
                    <p className="font-display text-3xl font-bold text-white tabular-nums">{count}</p>
                  </Link>
                ))}
              </div>
              <p className="font-sans text-[11px] text-slate-500 mt-3 leading-relaxed">
                A student's grade decides which materials they can open, so it is set by an
                administrator and never by the student.
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
