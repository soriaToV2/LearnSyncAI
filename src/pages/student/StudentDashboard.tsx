import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChartColumn,
  ClipboardList,
  Gamepad2,
  Layers,
  PenLine,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { CARD, SECTION, toneText } from '../../components/ui/surfaces';
import MeterBar from '../../components/ui/MeterBar';
import DueBadge from '../../components/ui/DueBadge';
import SubjectBadge from '../../components/educator/SubjectBadge';
import MasteryCurve from './components/MasteryCurve';
import { useAuth, displayName } from '../../context/AuthContext';
import {
  masteryPercent,
  masteryTier,
  relativeTime,
  TIER_LABEL,
  TIER_TONE,
} from '../../lib/mastery';
import { scorePercent } from '../../lib/testMode';
import {
  dashboardApi,
  type ActivityItem,
  type DashboardData,
  type FocusConcept,
  type SpaceMasteryRow,
} from '../../lib/dashboard';

/**
 * The student dashboard.
 *
 * Rebuilt from a version that made ZERO network calls — every number on it was a
 * literal, the three study-space links pointed at ids `'1'`, `'2'` and `'3'`, and
 * it greeted every student as "Sarah". It was also the only student page outside
 * the design system, which is why it was the one page the theme switcher did not
 * reach.
 *
 * ══ WHAT IS NOT HERE, AND WHY ══
 * The paper (p. 65) lists four things for this screen: mastery curves, study
 * hours, daily streaks and earned badges. Only the first has data behind it.
 * Nothing writes `activity_logs`, so `duration_ms` (study hours) and any weekly
 * chart have no source; nothing awards `user_badges`; and `day_streak` is frozen
 * for the one student who has a non-zero value — a stale number that looks real,
 * which is worse than none. All three are omitted rather than faked. If they are
 * ever wanted, the missing piece is a writer, not a widget.
 *
 * ══ ONE REQUEST ══
 * `GET /api/dashboard`. Everything below comes from that payload, including the
 * curve — which matters because the curve's last point must equal the headline
 * number, and that is only enforceable inside a single response.
 *
 * No cache and no refresh button: the page is fresh on mount like every other
 * screen, and a button would advertise a staleness the mount already handles.
 */

const FOCUS_ICON_BY_KIND: Record<ActivityItem['kind'], typeof ClipboardList> = {
  test: ClipboardList,
  free_recall: PenLine,
  feynman: Sparkles,
  game: Gamepad2,
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    dashboardApi
      .load()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your dashboard.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const name = displayName(user);
  const m = data?.mastery;
  const nothingAssessed = m !== undefined && m.concepts_assessed === 0;
  const noSpaces = data !== null && data.counts.spaces === 0;
  const noMaterials = data !== null && data.counts.spaces > 0 && data.counts.materials === 0;

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">
        <header className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
            {name ? `Hi, ${name}` : 'Your progress'}
          </h1>
          <p className="font-sans text-sm text-slate-500 mt-1.5">
            Everything you have learned so far, across all of your study spaces.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 mb-6">
            <p className="font-sans text-sm text-red-300">{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
          </div>
        ) : !data || noSpaces ? (
          <EmptyCard
            title="No study spaces yet."
            body="Create a study space and the lessons for your grade will be added to it automatically. Your progress shows up here as soon as you start."
            cta={{ to: '/student/spaces', label: 'Create a study space' }}
          />
        ) : noMaterials ? (
          <EmptyCard
            title="No lessons in your spaces yet."
            body="Your teacher has not published anything to your grade for these subjects yet. Once they do, it appears in your spaces and your progress starts tracking here."
            cta={{ to: '/student/spaces', label: 'Open your spaces' }}
          />
        ) : (
          <>
            {/* ── Summary strip ────────────────────────────────────────────── */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              <Stat label="Study spaces" value={String(data.counts.spaces)} />
              <Stat label="Lessons" value={String(data.counts.materials)} />
              <Stat
                label="Concepts assessed"
                value={`${m!.concepts_assessed} / ${m!.concepts_total}`}
              />
              <Stat
                label="Concepts mastered"
                value={nothingAssessed ? '—' : String(m!.concepts_mastered)}
                className={nothingAssessed ? '' : toneText.good}
              />
            </section>

            <div className="grid grid-cols-12 gap-6">
              {/* ── Main column ────────────────────────────────────────────── */}
              <div className="col-span-12 lg:col-span-8 space-y-6">
                <MasteryCard data={data} />
                <FocusCard focus={data.focus} assessed={m!.concepts_assessed} total={m!.concepts_total} />
                <SpacesCard spaces={m!.by_space} />
              </div>

              {/* ── Side column ────────────────────────────────────────────── */}
              <div className="col-span-12 lg:col-span-4 space-y-6">
                <DueCard total={data.flashcards_due} spaces={m!.by_space} />
                {data.resume_test && <ResumeCard test={data.resume_test} />}
                <RecentCard items={data.recent} />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`${CARD} p-4 text-center`}>
      <p className={`font-display text-xl font-bold tabular-nums ${className || 'text-white'}`}>{value}</p>
      <p className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-1">
        {label}
      </p>
    </div>
  );
}

function EmptyCard({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { to: string; label: string };
}) {
  return (
    <div className={`${CARD} py-16 px-6 text-center`}>
      <Layers className="w-10 h-10 text-slate-500 opacity-20 mx-auto mb-4" />
      <p className="font-sans text-sm text-slate-400 mb-1">{title}</p>
      <p className="font-sans text-xs text-slate-600 max-w-md mx-auto leading-relaxed">{body}</p>
      {cta && (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-container transition-all active:scale-[0.98]"
        >
          {cta.label} <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

/**
 * The paper's p. 81 deliverable: EQ(4) document mastery "displayed as a progress
 * bar on the user dashboard" — with its history directly beneath it.
 *
 * The number and the curve live in ONE card on purpose. The curve's last point
 * equals this number by construction, and putting them in separate cards is how
 * someone later sources them differently and the invariant quietly dies.
 */
function MasteryCard({ data }: { data: DashboardData }) {
  const m = data.mastery;
  const nothingAssessed = m.concepts_assessed === 0;
  const updated = relativeTime(m.last_updated);

  // Tier from the ROUNDED value so the colour cannot contradict the number:
  // 0.849 prints "85%" but tiers as intermediate on the raw value.
  const percent = m.overall === null ? 0 : masteryPercent(m.overall);
  const tier = masteryTier(percent / 100);
  const tone = TIER_TONE[tier];

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center gap-2">
        <ChartColumn className="w-4 h-4 text-primary-fixed-dim" />
        <h2 className={SECTION}>Overall mastery</h2>
      </div>

      <div className="flex items-end justify-between gap-4 mt-4">
        <div className="min-w-0">
          <p className={`font-display text-4xl font-bold tabular-nums ${nothingAssessed ? 'text-white' : toneText[tone]}`}>
            {nothingAssessed || m.overall === null ? '—' : `${percent}%`}
          </p>
          <p className={`font-sans text-xs font-semibold mt-1 ${nothingAssessed ? 'text-slate-500' : toneText[tone]}`}>
            {nothingAssessed ? 'Not measured yet' : TIER_LABEL[tier]}
          </p>
        </div>
        <p className="font-sans text-[11px] text-slate-600 text-right shrink-0">
          {m.concepts_assessed} of {m.concepts_total} concepts
          {m.total_attempts > 0 && (
            <>
              <br />
              {m.total_attempts} attempt{m.total_attempts === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      <MeterBar
        value={nothingAssessed ? null : m.overall}
        tone={tone}
        label="Overall mastery across all study spaces"
        className="mt-4"
      />

      {nothingAssessed ? (
        <p className="font-sans text-xs text-slate-500 mt-4 leading-relaxed">
          Your mastery updates when you rate a flashcard or finish a test. Until then there is
          nothing to measure — your lessons are waiting, not scored at zero.
        </p>
      ) : (
        <>
          {data.curve && (
            <div className="mt-6">
              <MasteryCurve points={data.curve.points} toneClass={toneText[tone]} />
              <div className="flex items-center justify-between mt-2">
                <p className="font-sans text-[11px] text-slate-600">
                  {masteryPercent(data.curve.points[0].m_doc)}% →{' '}
                  <span className="text-slate-400 font-semibold">
                    {masteryPercent(data.curve.points[data.curve.points.length - 1].m_doc)}%
                  </span>
                </p>
                <p className="font-sans text-[11px] text-slate-600">
                  {data.curve.total_updates} update{data.curve.total_updates === 1 ? '' : 's'}
                  {data.curve.stride > 1 && ` · showing every ${ordinal(data.curve.stride)}`}
                  {data.curve.truncated && ' · most recent only'}
                </p>
              </div>
            </div>
          )}
          <p className="font-sans text-[11px] text-slate-600 mt-3 leading-relaxed">
            Your average across the {m.concepts_total} concept{m.concepts_total === 1 ? '' : 's'} you
            are tracking today, one point per answer.
            {updated ? ` Updated ${updated}.` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The weakest concepts across EVERY space — the one thing this page can show that
 * no per-space screen can. The Analytics tab is scoped to one space by design, so
 * "what should I work on next, overall" had no home until now.
 */
function FocusCard({
  focus,
  assessed,
  total,
}: {
  focus: FocusConcept[];
  assessed: number;
  total: number;
}) {
  if (assessed === 0) return null;

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-primary-fixed-dim" />
        <h2 className={SECTION}>Focus next</h2>
      </div>
      {/* The honesty guard, same wording as the Analytics tab. Without it a student
          wonders why a concept they know they are weak at is missing — the answer
          is always "it has not come up yet". */}
      <p className="font-sans text-[11px] text-slate-600 mt-1.5">
        Ranked from the {assessed} concept{assessed === 1 ? '' : 's'} you have been tested on.
      </p>

      {focus.length === 0 || focus[0].mastery >= 0.85 ? (
        <p className="font-sans text-sm text-slate-300 mt-4">
          You are above 85% on everything you have been tested on.
          {assessed < total && (
            <span className="text-slate-500">
              {' '}
              {total - assessed} concept{total - assessed === 1 ? ' has' : 's have'} not come up yet.
            </span>
          )}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {focus.map((c) => (
            <Fragment key={c.concept_id}>
              <FocusRow concept={c} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** One assessed concept. Never rendered for an unassessed one — it has no percentage. */
function FocusRow({ concept }: { concept: FocusConcept }) {
  const percent = masteryPercent(concept.mastery);
  const tone = TIER_TONE[masteryTier(percent / 100)];

  return (
    <Link
      to={concept.space_id ? `/student/space/${concept.space_id}` : '/student/spaces'}
      className="block group"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-sans text-sm text-slate-200 truncate group-hover:text-white transition-colors">
            {concept.term}
          </p>
          <p className="font-sans text-[11px] text-slate-600 truncate">
            {concept.material_title}
            {concept.space_title && ` · ${concept.space_title}`}
          </p>
        </div>
        <span className={`font-display text-sm font-bold tabular-nums shrink-0 ${toneText[tone]}`}>
          {percent}%
        </span>
      </div>
      <MeterBar value={concept.mastery} tone={tone} label={`Mastery of ${concept.term}`} className="mt-1.5" />
    </Link>
  );
}

function SpacesCard({ spaces }: { spaces: SpaceMasteryRow[] }) {
  if (spaces.length === 0) return null;

  return (
    <div>
      <h2 className={`${SECTION} mb-4`}>Your study spaces</h2>
      <div className="space-y-2">
        {spaces.map((s) => (
          <Fragment key={s.space_id}>
            <SpaceRow space={s} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SpaceRow({ space }: { space: SpaceMasteryRow }) {
  const started = space.assessed_concept_count > 0;
  const percent = masteryPercent(space.m_doc);
  const tone = TIER_TONE[masteryTier(percent / 100)];

  return (
    <Link
      to={`/student/space/${space.space_id}`}
      className={`${CARD} block p-4 hover:bg-surface-container-lowest/70 transition-colors group`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <SubjectBadge code={space.subject} />
          <p className="font-sans text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors">
            {space.title}
          </p>
          <DueBadge count={space.due_count} />
        </div>
        <div className="text-right shrink-0">
          {started ? (
            <>
              <span className={`font-display text-sm font-bold tabular-nums ${toneText[tone]}`}>
                {percent}%
              </span>
              <p className={`font-sans text-[10px] uppercase tracking-widest ${toneText[tone]}`}>
                {TIER_LABEL[masteryTier(percent / 100)]}
              </p>
            </>
          ) : (
            <span className="font-sans text-[11px] text-slate-600">Not started</span>
          )}
        </div>
      </div>

      {/* null, never 0 — an unmeasured space has no bar to fill. */}
      <MeterBar
        value={started ? space.m_doc : null}
        tone={tone}
        label={`Mastery in ${space.title}`}
        className="mt-3"
      />

      <p className="font-sans text-[11px] text-slate-600 mt-2">
        {space.assessed_concept_count} of {space.concept_count} concepts assessed ·{' '}
        {space.material_count} lesson{space.material_count === 1 ? '' : 's'}
      </p>
    </Link>
  );
}

function DueCard({ total, spaces }: { total: number; spaces: SpaceMasteryRow[] }) {
  // Nothing due is not a state worth a card saying "0".
  if (total <= 0) return null;

  // Link to where the work actually is, rather than to the spaces list.
  const busiest = [...spaces].sort((a, b) => b.due_count - a.due_count)[0];

  return (
    <Link
      to={busiest ? `/student/space/${busiest.space_id}` : '/student/spaces'}
      className={`${CARD} block p-5 hover:bg-surface-container-lowest/70 transition-colors group`}
    >
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-primary-fixed-dim" />
        <h2 className={SECTION}>Flashcards due</h2>
      </div>
      <p className="font-display text-3xl font-bold text-white tabular-nums mt-3">{total}</p>
      <p className="font-sans text-xs text-slate-500 mt-1">
        {busiest && busiest.due_count > 0
          ? `${busiest.due_count} in ${busiest.title}`
          : 'Ready to review'}
      </p>
      <span className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold text-primary-fixed-dim mt-4 group-hover:gap-2.5 transition-all">
        Start reviewing <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

function ResumeCard({ test }: { test: NonNullable<DashboardData['resume_test']> }) {
  return (
    <Link
      to={`/student/space/${test.space_id}`}
      className={`${CARD} block p-5 hover:bg-surface-container-lowest/70 transition-colors group`}
    >
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-amber-400" />
        <h2 className={SECTION}>Unfinished test</h2>
      </div>
      <p className="font-sans text-sm font-semibold text-slate-200 mt-3 truncate">{test.title}</p>
      <p className="font-sans text-xs text-slate-500 mt-1">
        {test.answered} of {test.total} answered
        {test.space_title && ` · ${test.space_title}`}
      </p>
      <MeterBar
        value={test.total > 0 ? test.answered / test.total : null}
        tone="mid"
        label={`${test.answered} of ${test.total} answered`}
        className="mt-3"
      />
      <span className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold text-amber-400 mt-4 group-hover:gap-2.5 transition-all">
        Pick up where you left off <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

function RecentCard({ items }: { items: ActivityItem[] }) {
  return (
    <div className={`${CARD} p-5`}>
      <h2 className={SECTION}>Recent activity</h2>
      {items.length === 0 ? (
        <p className="font-sans text-xs text-slate-600 mt-3 leading-relaxed">
          Nothing yet. Study a deck, take a test or play a game and it shows up here.
        </p>
      ) : (
        <div className="mt-4 space-y-3.5">
          {items.map((item) => (
            <Fragment key={`${item.kind}-${item.id}`}>
              <ActivityRow item={item} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = FOCUS_ICON_BY_KIND[item.kind];
  const when = relativeTime(item.at);

  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-sans text-xs text-slate-300 leading-snug">{activityText(item)}</p>
        <p className="font-sans text-[11px] text-slate-600 mt-0.5">
          {[item.space_title, when].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

/**
 * One sentence per activity.
 *
 * Free Recall and Feynman deliberately carry NO number. Free Recall's score is a
 * coverage ratio whose denominator is however finely that document happened to be
 * split, so it means nothing stripped of its context — and a dashboard is exactly
 * the context that strips context. Printing "31%" beside a test's "80%" invites
 * the comparison the codebase spends a paragraph forbidding.
 */
function activityText(item: ActivityItem): string {
  switch (item.kind) {
    case 'test':
      return `Scored ${scorePercent(item.score)}% on ${item.title}.`;
    case 'free_recall':
      return 'Wrote a free recall attempt.';
    case 'feynman':
      return 'Explained a concept in your own words.';
    case 'game':
      return item.accuracy === null
        ? `Played ${GAME_LABEL[item.game_type] ?? 'a game'}.`
        : `Played ${GAME_LABEL[item.game_type] ?? 'a game'} — ${Math.round(item.accuracy * 100)}% correct.`;
  }
}

const GAME_LABEL: Record<string, string> = {
  term_matcher: 'Term Matching',
  crossword: 'Crossword',
  timed_trivia: 'Timed Trivia',
};

/** "2nd", "3rd", "4th" — for the curve's "showing every Nth" caption. */
function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
