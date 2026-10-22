import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChartColumn,
  ClipboardList,
  Flame,
  Gamepad2,
  History,
  Layers,
  PenLine,
  Sparkles,
  Target,
  Trophy
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
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
import { conceptBand, recommendConcept } from '../../lib/recommend';
import { studySpaceLink } from '../../lib/studySpace';
import { scorePercent } from '../../lib/testMode';
import { badgeStyle, badgeTotals } from '../../lib/badges';
import BadgeGalleryModal from '../../components/student/BadgeGalleryModal';
import { useTourDemo } from '../../context/OnboardingContext';
import ExampleChip from '../../components/onboarding/ExampleChip';
import {
  DEMO_BADGE_NAMES,
  DEMO_MASTERY,
  DEMO_RECENT,
  DEMO_STREAK_DAYS,
} from '../../lib/onboarding';
import {
  dashboardApi,
  type ActivityItem,
  type DashboardData,
  type FocusConcept,
  type GamificationBlock,
  type SpaceMasteryRow,
} from '../../lib/dashboard';

/**
 * The student dashboard (paper p. 65): mastery and its curve, streaks, badges, due cards, focus
 * concepts, recent activity. No study hours: most activities record no duration, so a total would be
 * misleading. No heatmap or weekly chart either.
 */

type IconType = typeof ClipboardList;

const FOCUS_ICON_BY_KIND: Record<ActivityItem['kind'], IconType> = {
  test: ClipboardList,
  free_recall: PenLine,
  feynman: Sparkles,
  game: Gamepad2,
};

/** Page-local card surfaces layered on the shared CARD token (other pages keep the plain token). */
const PANEL = `${CARD} border border-white/5 shadow-lg shadow-black/20`;
const PANEL_INTERACTIVE = `${PANEL} hover:bg-surface-container-lowest/70 hover:border-white/10 hover:shadow-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface`;

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
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12">
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
            <Spinner className="w-5 h-5 text-slate-500" />
          </div>
        ) : !data ? (
          // Only a fetch failure short-circuits; an empty account still renders the full dashboard.
          <EmptyCard
            title="Your dashboard could not be loaded."
            body="Check your connection and reload the page. Your progress is safe. This is only the view."
          />
        ) : (
          <div className="animate-tab-in">
            {/* New students get a notice above the complete dashboard (the server sends a fully shaped zero payload with real gamification); each card renders its own empty state. */}
            {(noSpaces || noMaterials) && (
              <div className="rounded-xl border border-primary-fixed-dim/25 bg-primary-fixed-dim/[0.07] px-4 py-3 mb-6 flex items-start gap-3">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-primary-fixed-dim" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm font-semibold text-white">
                    {noSpaces
                      ? 'Nothing here yet. Make your first study space.'
                      : 'No lessons in your spaces yet.'}
                  </p>
                  <p className="mt-0.5 font-sans text-xs leading-relaxed text-slate-400">
                    {noSpaces
                      ? 'Everything below fills in as you study. Create a space and the lessons for your grade are added to it automatically.'
                      : 'Your teacher has not published anything to your grade for these subjects yet. Once they do, it appears in your spaces and everything below starts tracking.'}
                  </p>
                </div>
              </div>
            )}

            {/* Summary strip */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              <Stat icon={Layers} label="Study spaces" value={String(data.counts.spaces)} tone="text-primary-fixed-dim" />
              <Stat icon={ClipboardList} label="Lessons" value={String(data.counts.materials)} tone="text-secondary-fixed-dim" />
              <Stat
                icon={Target}
                label="Concepts assessed"
                value={`${data.mastery.concepts_assessed} / ${data.mastery.concepts_total}`}
                tone="text-slate-200"
              />
              <Stat
                icon={Trophy}
                label="Concepts mastered"
                value={nothingAssessed ? '—' : String(data.mastery.concepts_mastered)}
                tone={nothingAssessed ? 'text-white' : toneText.good}
              />
            </section>

            {/* Explains "3 / 47": the denominator is the lesson size, not a target. One sentence here rather than captions on four tiles. */}
            <p className="-mt-6 mb-8 font-sans text-xs leading-relaxed text-slate-600">
              Assessed counts the concepts you have been asked about in a flashcard
              or a test. It is not a score, and the rest are waiting, not wrong.
            </p>

            <div className="grid grid-cols-12 gap-6">
              {/* Main column */}
              <div className="col-span-12 lg:col-span-8 space-y-6">
                <MasteryCard data={data} />
                <FocusCard
                  focus={data.focus}
                  assessed={data.mastery.concepts_assessed}
                  total={data.mastery.concepts_total}
                />
                <SpacesCard spaces={data.mastery.by_space} />
              </div>

              {/* Side column */}
              <div className="col-span-12 lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
                <StreakCard g={data.gamification} />
                {/* DueCard renders nothing when nothing is due (a permanent "0" is clutter). */}
                <DueCard total={data.flashcards_due} spaces={data.mastery.by_space} />
                {data.resume_test && <ResumeCard test={data.resume_test} />}
                <BadgesCard g={data.gamification} />
                <RecentCard items={data.recent} />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** Tinted box behind a card's header icon. */
function IconChip({ icon: Icon, className = '' }: { icon: IconType; className?: string }) {
  return (
    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${className}`}>
      <Icon className="w-4 h-4" />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'text-white',
}: {
  icon: IconType;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`${CARD} border border-white/5 p-4 text-center`}>
      <Icon className={`w-4 h-4 mx-auto mb-2 ${tone}`} />
      <p className={`font-display text-xl font-bold tabular-nums ${tone}`}>{value}</p>
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
    <div className={`${PANEL} py-16 px-6 text-center animate-tab-in`}>
      <Layers className="w-10 h-10 text-slate-500 opacity-20 mx-auto mb-4" />
      <p className="font-sans text-sm text-slate-400 mb-1">{title}</p>
      <p className="font-sans text-xs text-slate-600 max-w-md mx-auto leading-relaxed">{body}</p>
      {cta && (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-container transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {cta.label} <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

/**
 * EQ(4) mastery as a progress bar (paper p. 81) with its history beneath. Kept in one card: the
 * curve's last point equals this number by construction.
 */
function MasteryCard({ data }: { data: DashboardData }) {
  const m = data.mastery;
  const realNothingAssessed = m.concepts_assessed === 0;
  const updated = relativeTime(m.last_updated);

  // Example content only while the tour spotlights this card, and only if nothing real is assessed.
  const showDemo = useTourDemo('dash-mastery') && realNothingAssessed;
  const nothingAssessed = showDemo ? false : realNothingAssessed;
  const overall = showDemo ? DEMO_MASTERY.overall : m.overall;
  const assessedCount = showDemo ? DEMO_MASTERY.concepts_assessed : m.concepts_assessed;
  const totalCount = showDemo ? DEMO_MASTERY.concepts_total : m.concepts_total;

  // Tier from the rounded value so colour matches the number shown.
  const percent = overall === null ? 0 : masteryPercent(overall);
  const tier = masteryTier(percent / 100);
  const tone = TIER_TONE[tier];

  return (
    <div
      data-tour="dash-mastery"
      className={`${CARD} border border-white/10 shadow-[0_10px_25px_-8px_rgba(0,0,0,0.35),0_0_45px_-12px_var(--theme-glow)] p-5`}
    >
      <div className="flex items-center gap-2">
        <IconChip icon={ChartColumn} className="bg-primary-fixed-dim/10 text-primary-fixed-dim" />
        <h2 className={SECTION}>Overall mastery</h2>
        {showDemo && <span className="ml-auto"><ExampleChip /></span>}
      </div>

      <div className="flex items-end justify-between gap-4 mt-4">
        <div className="min-w-0">
          <p className={`font-display text-4xl font-bold tabular-nums ${nothingAssessed ? 'text-white' : toneText[tone]}`}>
            {nothingAssessed || overall === null ? '—' : `${percent}%`}
          </p>
          <p className={`font-sans text-xs font-semibold mt-1 ${nothingAssessed ? 'text-slate-500' : toneText[tone]}`}>
            {nothingAssessed ? 'Not measured yet' : TIER_LABEL[tier]}
          </p>
        </div>
        <p className="font-sans text-[11px] text-slate-600 text-right shrink-0">
          {assessedCount} of {totalCount} concepts
          {!showDemo && m.total_attempts > 0 && (
            <>
              <br />
              {m.total_attempts} attempt{m.total_attempts === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      <MeterBar
        value={nothingAssessed ? null : overall}
        tone={tone}
        label="Overall mastery across all study spaces"
        className="mt-4"
      />

      {showDemo ? (
        <p className="font-sans text-xs text-slate-500 mt-4 leading-relaxed">
          This is what it looks like once you have been studying. Your own number
          starts at nothing and grows from there.
        </p>
      ) : nothingAssessed ? (
        <p className="font-sans text-xs text-slate-500 mt-4 leading-relaxed">
          Your mastery updates when you rate a flashcard or finish a test. Until then there is
          nothing to measure — your lessons are waiting, not scored at zero.
        </p>
      ) : (
        <>
          {data.curve && (
            <div className="mt-6">
              <MasteryCurve points={data.curve.points} toneClass={toneText[tone]} />
              {/* Wraps rather than overflows on a phone. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2">
                <p className="font-sans text-[11px] text-slate-600">
                  {masteryPercent(data.curve.points[0].m_doc)}% →{' '}
                  <span className="text-slate-400 font-semibold">
                    {masteryPercent(data.curve.points[data.curve.points.length - 1].m_doc)}%
                  </span>
                </p>
                <p className="font-sans text-[11px] text-slate-600">
                  {data.curve.total_updates} update{data.curve.total_updates === 1 ? '' : 's'}
                  {data.curve.stride > 1 && ` · showing every ${ordinal(data.curve.stride)} point`}
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

/** The weakest concepts across every space; the one view no per-space screen can give. */
function FocusCard({
  focus,
  assessed,
  total,
}: {
  focus: FocusConcept[];
  assessed: number;
  total: number;
}) {
  // Renders even when empty, with its own message instead of the honesty line.
  const nothingAssessed = assessed === 0;

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex items-center gap-2">
        <IconChip icon={Target} className="bg-primary-fixed-dim/10 text-primary-fixed-dim" />
        <h2 className={SECTION}>Focus next</h2>
      </div>
      {/* Same honesty line as the Analytics tab: missing concepts haven't come up yet. */}
      {!nothingAssessed && (
        <p className="font-sans text-[11px] text-slate-600 mt-1.5">
          Ranked from the {assessed} concept{assessed === 1 ? '' : 's'} you have been tested on.
        </p>
      )}

      {nothingAssessed ? (
        <p className="font-sans text-sm text-slate-400 mt-3 leading-relaxed">
          Once you have answered a few flashcards or finished a test, the concepts
          worth working on next are listed here, weakest first.
        </p>
      ) : focus.length === 0 || focus[0].mastery >= 0.85 ? (
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
        <>
          <div className="mt-4 space-y-3">
            {focus.map((c) => (
              <Fragment key={c.concept_id}>
                <FocusRow concept={c} />
              </Fragment>
            ))}
          </div>
          {/* Once per card, never per row. */}
          <p className="font-sans text-[11px] text-slate-600 mt-4 leading-relaxed">
            {
              recommendConcept({
                term: focus[0].term,
                band: conceptBand({ assessed: true, mastery: focus[0].mastery }),
                mastery: focus[0].mastery,
                sourcePages: null,
              }).honesty
            }
          </p>
        </>
      )}
    </div>
  );
}

/** One assessed concept (unassessed ones are never rendered). */
function FocusRow({ concept }: { concept: FocusConcept }) {
  const percent = masteryPercent(concept.mastery);
  const tone = TIER_TONE[masteryTier(percent / 100)];

  // The lead step picks the tab, lesson and (for Feynman) concept. A real <Link> is correct here: this
  // is a different route, so StudySpace mounts fresh and reads the params.
  const lead = recommendConcept({
    term: concept.term,
    band: conceptBand({ assessed: true, mastery: concept.mastery }),
    mastery: concept.mastery,
    // No page numbers in this payload, so the step says "that part of the lesson".
    sourcePages: null,
  }).steps[0];

  return (
    <Link
      to={
        concept.space_id
          ? studySpaceLink(concept.space_id, {
              tab: lead.tab,
              materialId: concept.material_id,
              // One concept per row.
              conceptIds: lead.action === 'feynman' ? [concept.concept_id] : [],
            })
          : '/student/spaces'
      }
      className="block group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
          <p className="font-sans text-[11px] font-semibold text-primary-fixed-dim truncate mt-0.5">
            {lead.cta}
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

/** Study spaces, including the "make your first space" call to action for new students. */
function SpacesCard({ spaces }: { spaces: SpaceMasteryRow[] }) {
  return (
    <div data-tour="dash-spaces">
      <div className="flex items-center gap-2 mb-4">
        <IconChip icon={Layers} className="bg-primary-fixed-dim/10 text-primary-fixed-dim" />
        <h2 className={SECTION}>Your study spaces</h2>
      </div>

      {spaces.length === 0 ? (
        <div className={`${PANEL} py-10 px-6 text-center`}>
          <p className="font-sans text-sm text-slate-400 mb-1">You have no study spaces yet.</p>
          <p className="font-sans text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
            One space per subject. It opens already holding the lessons your teacher
            published for your grade.
          </p>
          <Link
            to="/student/spaces"
            className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-container transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Create your first space <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {spaces.map((s) => (
            <Fragment key={s.space_id}>
              <SpaceRow space={s} />
            </Fragment>
          ))}
        </div>
      )}
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
      className={`${PANEL_INTERACTIVE} block p-4 group`}
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

      {/* null, never 0: an unmeasured space has no bar. */}
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

/**
 * The day streak. Renders at zero (it's what says "come back tomorrow"). Shows current and best:
 * badges use the best, so a broken streak doesn't look like lost work. Days are Asia/Manila dates.
 */
function StreakCard({ g }: { g: GamificationBlock }) {
  // Example only while the tour is on this card and the real streak is zero.
  const showDemo = useTourDemo('dash-streak') && g.day_streak === 0;
  const days = showDemo ? DEMO_STREAK_DAYS : g.day_streak;

  return (
    <div data-tour="dash-streak" className={`${PANEL} p-5`}>
      <div className="flex items-center gap-2">
        <IconChip
          icon={Flame}
          className={days > 0 ? 'bg-orange-400/10 text-orange-400' : 'bg-white/5 text-slate-500'}
        />
        <h2 className={SECTION}>Study streak</h2>
        {showDemo && <span className="ml-auto"><ExampleChip /></span>}
      </div>

      <p className="font-display text-3xl font-bold text-white tabular-nums mt-3">
        {days}
        <span className="font-sans text-sm font-medium text-slate-400 ml-1.5">
          day{days === 1 ? '' : 's'}
        </span>
      </p>

      <p className="font-sans text-xs text-slate-500 mt-1">
        {showDemo
          ? 'Yours starts at zero and grows by one each day you study.'
          : days === 0
            ? 'Study anything today to start a streak.'
            : g.longest_streak > days
              ? `Best so far: ${g.longest_streak} days`
              : 'This is your best run yet.'}
      </p>
    </div>
  );
}

/**
 * Earned badges plus a link to the full gallery (where locked ones live). Renders even with none.
 * One "Next" nudge, only once progress has started (current > 0).
 */
function BadgesCard({ g }: { g: GamificationBlock }) {
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Example badges are real catalogue entries, shown only when none are held.
  const showDemo = useTourDemo('dash-badges') && g.badges.length === 0;
  const badges = showDemo
    ? DEMO_BADGE_NAMES.map((name) => ({ name, awarded_at: new Date().toISOString() }))
    : g.badges;
  // Real totals, never the example's.
  const totals = badgeTotals(g.badges);

  // Closest to done, among badges already started.
  const nextUp = [...g.badge_progress]
    .filter((p) => p.current > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target)[0];
  const nextStyle = nextUp ? badgeStyle(nextUp.name) : null;

  return (
    <div data-tour="dash-badges" className={`${PANEL} p-5`}>
      <div className="flex items-center gap-2">
        <IconChip icon={Trophy} className="bg-amber-400/10 text-amber-400" />
        <h2 className={SECTION}>Badges</h2>
        {showDemo ? (
          <span className="ml-auto"><ExampleChip /></span>
        ) : (
          <span className="font-sans text-xs text-slate-500 tabular-nums ml-auto">
            {totals.held} / {totals.total}
          </span>
        )}
      </div>

      {badges.length === 0 ? (
        <p className="font-sans text-sm text-slate-400 mt-4">
          No badges yet. Studying anything at all earns your first one.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 mt-4">
          {badges.map((badge) => {
            const style = badgeStyle(badge.name);
            const Icon = style.icon;
            return (
              <li
                key={badge.name}
                title={showDemo ? style.label : `${style.label} — earned ${relativeTime(badge.awarded_at)}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${style.bg} ${style.ring}`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${style.color}`} />
                <span className="font-sans text-xs font-semibold text-slate-200">{style.label}</span>
              </li>
            );
          })}
        </ul>
      )}

      {nextUp && nextStyle && (
        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-center gap-2">
            <nextStyle.icon className="w-3.5 h-3.5 shrink-0 text-slate-500" />
            <span className="font-sans text-xs font-semibold text-slate-400">
              Next: {nextStyle.label}
            </span>
            <span className="font-sans text-xs text-slate-500 tabular-nums ml-auto">
              {nextUp.current} / {nextUp.target}
            </span>
          </div>
          <MeterBar
            value={nextUp.current / nextUp.target}
            tone="neutral"
            label={`Progress toward ${nextStyle.label}`}
            className="mt-2"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setGalleryOpen(true)}
        className="font-sans text-xs font-semibold text-primary-fixed-dim hover:underline mt-4"
      >
        See all badges
      </button>

      <BadgeGalleryModal
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        earned={badges}
        progress={g.badge_progress}
      />
    </div>
  );
}

function DueCard({ total, spaces }: { total: number; spaces: SpaceMasteryRow[] }) {
  // Nothing due: no card.
  if (total <= 0) return null;

  // Link to where the work is.
  const busiest = [...spaces].sort((a, b) => b.due_count - a.due_count)[0];

  return (
    <Link
      to={busiest ? `/student/space/${busiest.space_id}` : '/student/spaces'}
      className={`${PANEL_INTERACTIVE} block p-5 group`}
    >
      <div className="flex items-center gap-2">
        <IconChip icon={Layers} className="bg-primary-fixed-dim/10 text-primary-fixed-dim" />
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
      className={`${PANEL_INTERACTIVE} block p-5 group`}
    >
      <div className="flex items-center gap-2">
        <IconChip icon={ClipboardList} className="bg-tertiary-fixed-dim/10 text-tertiary-fixed-dim" />
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
      <span className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold text-tertiary-fixed-dim mt-4 group-hover:gap-2.5 transition-all">
        Pick up where you left off <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

function RecentCard({ items }: { items: ActivityItem[] }) {
  const showDemo = useTourDemo('dash-recent') && items.length === 0;

  return (
    <div data-tour="dash-recent" className={`${PANEL} p-5`}>
      <div className="flex items-center gap-2">
        <IconChip icon={History} className="bg-white/5 text-slate-400" />
        <h2 className={SECTION}>Recent activity</h2>
        {showDemo && <span className="ml-auto"><ExampleChip /></span>}
      </div>
      {showDemo ? (
        // Plain sentences rather than ActivityRow, which would need fabricated ids and timestamps.
        <div className="mt-4 space-y-3.5">
          {DEMO_RECENT.map((row) => {
            const Icon = FOCUS_ICON_BY_KIND[row.kind];
            return (
              <div key={row.text} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm text-slate-300 leading-snug">{row.text}</p>
                  <p className="font-sans text-[11px] text-slate-600 mt-0.5">{row.when}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : items.length === 0 ? (
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

/** One sentence per activity. Free Recall and Feynman carry no number (coverage % isn't comparable out of context). */
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

/** "2nd", "3rd", "4th" for the curve caption. */
function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
