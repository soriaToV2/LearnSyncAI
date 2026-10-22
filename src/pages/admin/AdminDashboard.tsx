import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, GraduationCap, BookUser, Hourglass, KeyRound, ShieldOff, ShieldCheck, ArrowRight,
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useAuth, displayName } from '../../context/AuthContext';
import { adminApi, type AdminOverview } from '../../lib/adminAccounts';
import { ErrorBanner } from './components/accountUi';

/**
 * The admin's landing page. Every figure is a count of accounts: this role doesn't touch learning
 * content or analytics. GET /api/admin/overview takes no input, so it can't be pointed at other data.
 */

/** CARD is a surface; PANEL is a row in a list (no shadow, or the list reads as floating cards). */
const PANEL = 'rounded-2xl bg-white/[0.02] border border-white/5';
const CARD = `${PANEL} shadow-lg shadow-black/20`;

/** ring-inset, matching the other dashboards: the rows are close-set rounded links. */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

/**
 * A headline count. Icons are tinted per card (decorative) via .tone-chip, because the light theme
 * overrides tone text but not tone fills; see TINTED CHIPS in index.css.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  hint?: string;
/** Hex for the icon chip; decorative. */
  tone: string;
}) {
  return (
    <div className={`${CARD} p-4 sm:p-5`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="tone-chip w-7 h-7 rounded-lg border flex items-center justify-center shrink-0"
          style={{ '--tone': tone } as CSSProperties}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold leading-tight">
          {label}
        </p>
      </div>
      <p className="font-display text-2xl sm:text-3xl font-bold text-white tabular-nums">{value}</p>
      {hint && <p className="font-sans text-[11px] text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
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

  /* Operational signals, rendered only when something needs attention. */
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
      {/* Same page entrance as the other portals. */}
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">
        <header className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
            {user ? `Hi, ${displayName(user)}` : 'Dashboard'}
          </h1>
          <p className="font-sans text-sm text-on-surface-variant mt-1.5">
            Accounts for the students and educators at Pasig Christian Academy.
          </p>
        </header>

        {error && <ErrorBanner message={error} />}

        {isLoading && (
          <div className="flex items-center gap-2.5 text-slate-500 py-12 justify-center">
            <Spinner className="w-4 h-4" />
            <span className="font-sans text-sm">Loading accounts…</span>
          </div>
        )}

        {/* animate-tab-in on the loaded body, not the wrapper (which fades in around the spinner). */}
        {overview && (
          <div className="flex flex-col gap-8 animate-tab-in">
            {/* Four across from md:. */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                icon={Users}
                label="All accounts"
                value={overview.totals.all}
                hint={`${overview.totals.active} active · ${overview.totals.disabled} disabled`}
                tone="#22d3ee"
              />
              <StatCard
                icon={GraduationCap}
                label="Students"
                value={overview.totals.students}
                tone="#34d399"
              />
              <StatCard
                icon={BookUser}
                label="Educators"
                value={overview.totals.educators}
                tone="#a78bfa"
              />
              <StatCard
                icon={ShieldCheck}
                label="Admins"
                value={overview.totals.admins}
                hint="Created from the Supabase dashboard"
                tone="#fbbf24"
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
                      className={`flex items-start gap-3 sm:gap-3.5 px-4 sm:px-5 py-4 rounded-2xl border transition-colors group ${FOCUS} ${
                        tone === 'amber'
                          ? 'bg-amber-500/[0.07] border-amber-500/20 hover:bg-amber-500/10'
                          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 mt-0.5 ${tone === 'amber' ? 'text-amber-400' : 'text-slate-400'}`}
                      />
                      <div className="min-w-0 flex-1">
                        {/* tabular-nums so the titles line up. */}
                        <p className="font-display text-sm font-bold text-white">
                          <span className="tabular-nums">{count}</span> · {title}
                        </p>
                        <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">{body}</p>
                      </div>
                      {/* Chevron hidden below sm: to give the text room; the whole row is the link. */}
                      <ArrowRight className="hidden sm:block w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5 transition-colors" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="font-sans text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                Students by grade
              </h2>
              {/* Four grades, four columns from md:, matching the strip above. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                {overview.by_grade.map(({ grade, count }) => (
                  <Link
                    key={grade}
                    to={`/admin/accounts?role=student&grade=${grade}`}
                    className={`${CARD} p-4 sm:p-5 hover:bg-white/[0.04] hover:border-white/10 transition-colors group ${FOCUS}`}
                  >
                    <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3 group-hover:text-slate-400 transition-colors">
                      Grade {grade}
                    </p>
                    <p className="font-display text-2xl sm:text-3xl font-bold text-white tabular-nums">
                      {count}
                    </p>
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
