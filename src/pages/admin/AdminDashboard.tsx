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

/**
 * ⚠️ TWO TOKENS, SAME SPLIT AS `EducatorDashboard`. `CARD` is a surface you look
 * at; `PANEL` is a row inside a list. Giving one constant a shadow would put a
 * drop shadow under every attention row, which reads as a stack of floating
 * cards rather than a list.
 */
const PANEL = 'rounded-2xl bg-white/[0.02] border border-white/5';
const CARD = `${PANEL} shadow-lg shadow-black/20`;

/**
 * ⚠️ `ring-inset`, matching both other dashboards. The grade tiles sit in a
 * `gap-4` grid so an outward ring would survive there, but the attention rows
 * are `gap-3` and every one of these is a `<Link>` with a rounded border — an
 * inset ring reads as the card itself lighting up rather than as a halo around
 * it, and it cannot bleed into a neighbour at any width.
 */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

/**
 * A headline count.
 *
 * ⚠️ THE ICON IS TINTED PER CARD, VIA `.tone-chip`. All four were the same
 * `text-slate-500` glyph at the same size, so the strip read as four identical
 * grey boxes and the only way to tell students from educators was to read the
 * 10px label. The colours are decorative — nothing here encodes a value — but
 * they make the strip scannable, which is the entire job of a summary row.
 *
 * `.tone-chip` rather than `bg-emerald-400/10 text-emerald-400` and friends: the
 * light theme's overrides cover tone TEXT and deliberately not tone FILLS, so a
 * hand-rolled chip would come out as a near-invisible tint behind text that had
 * been darkened independently. See the TINTED CHIPS block in `index.css`.
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
  /** Hex for the icon chip. Decorative — it never encodes a count. */
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

  /*
   * The operational signals, mirroring the educator dashboard's `attention`:
   * rendered only when something actually needs attention. A permanent "all
   * clear" card is a widget that reports nothing, every day, forever.
   *
   * ⚠️ THE "UNKNOWN" BRANCH IS GONE, AND SO IS THE PARAGRAPH THAT EXPLAINED IT.
   * It described `never_signed_in`, which needed a paged sweep of `auth.users`
   * and could therefore fail and come back null. That field no longer exists —
   * `not_activated` replaced it and is a plain column read — so all three counts
   * on `AdminOverview.attention` are typed `number`. The null checks below were
   * unreachable, and the fallback sentence ("the sign-in records could not be
   * read just now") described a request the page no longer makes.
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
      {/* `sm:` steps on both axes and the entrance the other two portals now
          use — see `EducatorDashboard` for why it is `animate-page-fade` rather
          than a bare `fade-in`. */}
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

        {/* ⚠️ `animate-tab-in` ON THE LOADED BODY, NOT ON THE PAGE WRAPPER. The
            wrapper's entrance fires while the spinner is the only thing on
            screen, so it is over before a single count arrives. Same rule as
            every other fetching screen in the app. */}
        {overview && (
          <div className="flex flex-col gap-8 animate-tab-in">
            {/* 4-across from `md:`, not `lg:`. At 768px two tiles were ~350px
                wide each, carrying a 14px icon and one number — the widest
                things on the page holding the least. */}
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
                        {/* The count leads and is `tabular-nums` so the three
                            rows' titles line up when the numbers differ in
                            width. */}
                        <p className="font-display text-sm font-bold text-white">
                          <span className="tabular-nums">{count}</span> · {title}
                        </p>
                        <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">{body}</p>
                      </div>
                      {/* Hidden below `sm:`: at 375px the row has ~280px for two
                          lines of body copy, and a decorative chevron is the
                          first thing that should give that width back. The whole
                          row is the link, so nothing is lost — it was never the
                          hit target. */}
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
              {/* Four JHS grades, so `md:grid-cols-4` lands them on one row
                  exactly — matching the summary strip above rather than
                  reflowing at a different width to it. */}
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
