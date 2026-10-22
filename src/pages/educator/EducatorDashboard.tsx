import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, ChevronDown, ClipboardCheck, FileText, Layers, TrendingDown, Upload, UserCheck, Users
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import MeterBar from '../../components/ui/MeterBar';
import { toneText } from '../../components/ui/surfaces';
import StatCard from '../../components/educator/StatCard';
import TierBadge from '../../components/educator/TierBadge';
import SubjectBadge from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';
import { useAuth, displayName } from '../../context/AuthContext';
import { formatRelativeTime, type ParsedStatus } from '../../data/mockEducator';
import {
  educatorOverviewApi, overviewCaption, materialCaption, studentCaption,
  ATTENTION_TEXT, masteryPercent, masteryTier, TIER_TONE,
  type DifficultyTier, type EducatorOverview, type AttentionItem,
  type MaterialOverview, type StudentOverview, type ConceptOverview,
} from '../../lib/educatorOverview';

/**
 * The educator dashboard: answers cross-material questions Class Performance can't (which materials
 * need attention, a student across everything you teach, the class's weakest concepts library-wide).
 * One request (GET /api/educator/overview); no cache.
 * Never print P(L₀): unmeasured figures render "—" with an empty MeterBar; gate on the counts.
 * Deliberately absent: a class mastery curve (its denominator moves), streaks/badges/study hours
 * (motivational for the student, an attendance register for a teacher), Free Recall/Feynman numbers.
 */

type View = 'materials' | 'students' | 'concepts';

/** CARD is a surface you look at; PANEL is a row inside one (so ~40 rows don't each get a shadow). */
const PANEL = 'rounded-2xl bg-white/[0.02] border border-white/5';
const CARD = `${PANEL} shadow-lg shadow-black/20`;

/** Focus ring for rows and links: inset, since rows sit 6px apart and some parents clip overflow. */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

export default function EducatorDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<EducatorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('materials');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    educatorOverviewApi
      .load()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your dashboard.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const name = displayName(user);

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      {/* sm: steps for tablets. animate-page-fade for the page entrance. */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">

        <header className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight">
            {name ? `Hi, ${name}` : 'Your classes'}
          </h1>
          <p className="font-sans text-sm text-slate-400 mt-1.5">
            How the materials you have published are going.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 mb-6">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="font-sans text-xs text-rose-300">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner className="w-5 h-5 text-slate-500" />
          </div>
        ) : !data ? null : data.counts.materials_live === 0 ? (
          <NoMaterials archived={data.counts.materials_archived} />
        ) : (
          <Loaded data={data} view={view} onView={setView} />
        )}
      </div>
    </main>
  );
}

function Loaded({
  data,
  view,
  onView,
}: {
  data: EducatorOverview;
  view: View;
  onView: (v: View) => void;
}) {
  const { counts, class: cls } = data;
  const tone = TIER_TONE[cls.tier];

  /* animate-tab-in on the loaded body, not the wrapper (whose fade finishes while the spinner shows). */
  return (
    <div className="animate-tab-in">
      {/* Summary strip */}
      {/* 4-across from md:. */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Materials"
          value={String(counts.materials_live)}
          hint={
            counts.materials_archived > 0
              ? `${counts.materials_archived} archived`
              : 'All published'
          }
          icon={FileText}
          color="#22d3ee"
        />
        <StatCard
          label="Students reached"
          value={String(cls.size)}
          hint={`Across ${counts.grades.length} grade level${counts.grades.length === 1 ? '' : 's'}`}
          icon={Users}
          color="#818cf8"
        />
        {/* These tiles count different things (students, concepts); each names its unit and the remainder. */}
        <StatCard
          label="Students started"
          value={`${cls.started} / ${cls.size}`}
          hint={startedHint(cls.started, cls.size)}
          icon={UserCheck}
          color="#34d399"
        />
        <StatCard
          label="Concepts assessed"
          value={`${counts.concepts_assessed} / ${counts.concepts_total}`}
          hint={assessedHint(counts.concepts_assessed, counts.concepts_total)}
          icon={ClipboardCheck}
          color="#fbbf24"
        />
      </section>

      {/* Needs a look */}
      {/* Omitted when empty (no permanent "all clear" card). */}
      {data.attention.length > 0 && <AttentionStrip items={data.attention} />}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">

          {/* Class mastery */}
          <div className={`${CARD} p-5 sm:p-6`}>
            <div className="flex items-center gap-2.5 mb-5">
              <span className="w-8 h-8 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-primary-fixed-dim" />
              </span>
              <h2 className="font-display text-lg font-bold text-white">Class mastery</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
              <div className="md:col-span-2">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className={`font-display text-3xl font-bold tracking-tight tabular-nums ${cls.m_doc === null ? 'text-slate-600' : toneText[tone]}`}>
                    {cls.m_doc === null ? '—' : `${masteryPercent(cls.m_doc)}%`}
                  </span>
                  {cls.m_doc !== null && <TierBadge tier={cls.tier} />}
                </div>
                <MeterBar
                  value={cls.m_doc}
                  tone={tone}
                  label="Average mastery across your materials"
                  className="mt-3"
                />
                <p className="font-sans text-xs text-slate-500 mt-2.5 leading-relaxed">
                  {overviewCaption(cls, counts.concepts_total)}
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                <p className="font-sans text-[10px] uppercase tracking-wider font-bold text-slate-500">
                  Students by tier
                </p>
                {(['advanced', 'intermediate', 'foundational'] as const).map((tier) => (
                  <div key={tier} className="flex items-center justify-between gap-3">
                    <TierBadge tier={tier} />
                    <span className="font-display text-base font-bold text-white tabular-nums">
                      {cls.by_tier[tier]}
                    </span>
                  </div>
                ))}
                {cls.started < cls.size && (
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5 mt-0.5">
                    <span className="font-sans text-[11px] text-slate-500">Not started</span>
                    <span className="font-display text-base font-bold text-slate-500 tabular-nums">
                      {cls.size - cls.started}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* By material / By student / By concept */}
          <div className="flex flex-col gap-4">
            {/* Fits a phone: "By " drops below sm: and the control goes full-width in equal thirds. Counts always show. */}
            <div className="flex w-full sm:w-auto sm:self-start items-center gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/5">
              {(
                [
                  ['materials', 'Materials', 'By material', counts.materials_live],
                  ['students', 'Students', 'By student', cls.size],
                  ['concepts', 'Concepts', 'By concept', counts.concepts_assessed],
                ] as const
              ).map(([id, shortLabel, longLabel, count]) => (
                <button
                  key={id}
                  onClick={() => onView(id)}
                  aria-pressed={view === id}
                  className={`flex-1 sm:flex-none px-2.5 sm:px-3.5 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors whitespace-nowrap ${FOCUS} ${
                    view === id ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{longLabel}</span> ({count})
                </button>
              ))}
            </div>

            {/* key={view} remounts on each switch so the fade fires (and expanded rows reset). */}
            <div key={view} className="animate-tab-in">
              {view === 'materials' && <MaterialsView materials={data.materials} />}
              {view === 'students' && (
                <StudentsView students={data.students} materials={data.materials} />
              )}
              {view === 'concepts' && (
                <ConceptsView concepts={data.concepts} total={counts.concepts_assessed} />
              )}
            </div>
          </div>
        </div>

        {/* Side column */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
          <GradeCoverage grades={data.grades} />
          <RecentUploads uploads={data.recent_uploads} />
        </div>
      </div>

      {/* Accurate: only the games read mastery (Free Recall and Feynman don't). */}
      <p className="font-sans text-xs text-slate-500 mt-6 leading-relaxed">
        Mastery comes from Bayesian Knowledge Tracing and moves only when a student rates a due
        flashcard or completes an adaptive test. The games read it to pick their difficulty but never
        change it; free recall and the Feynman technique neither read nor change it. Archived
        materials are left out of every figure on this page.
      </p>
    </div>
  );
}

// Attention

/** parse_pending is informational; the rest need action. */
const ATTENTION_TONE: Record<AttentionItem['reason'], string> = {
  parse_failed: 'text-amber-400',
  parse_pending: 'text-slate-400',
  no_concepts: 'text-amber-400',
  no_students: 'text-amber-400',
  nobody_started: 'text-amber-400',
};

function AttentionStrip({ items }: { items: AttentionItem[] }) {
  return (
    <section className={`${CARD} p-5 mb-6`}>
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h2 className="font-display text-base font-bold text-white">Needs a look</h2>
        <span className="font-sans text-[11px] text-slate-500">
          {items.length} material{items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <Link
            key={item.material_id}
            to={`/educator/materials/${item.material_id}`}
            className={`flex items-start gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group ${FOCUS}`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${ATTENTION_TONE[item.reason]}`} />
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                {item.title}
              </p>
              <p className="font-sans text-[11px] text-slate-500 mt-0.5">
                {ATTENTION_TEXT[item.reason](item)}
              </p>
              {item.parse_error && (
                <p className="font-sans text-[11px] text-rose-300/80 mt-1 leading-relaxed">
                  {item.parse_error}
                </p>
              )}
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-1 group-hover:text-slate-400 transition-colors" />
          </Link>
        ))}
      </div>
    </section>
  );
}

// By material

function MaterialsView({ materials }: { materials: MaterialOverview[] }) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-sans text-xs text-slate-500 mb-1 leading-relaxed">
        Weakest first, averaged across the students who have started each one. These are the same
        figures each material's Class Performance tab shows.
      </p>

      {materials.map((m) => {
        const started = m.m_doc !== null;
        const tier = started ? tierOf(m.m_doc as number) : 'foundational';

        return (
          <button
            key={m.material_id}
            onClick={() => navigate(`/educator/materials/${m.material_id}?tab=performance`)}
            className={`${PANEL} ${FOCUS} w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3.5 hover:bg-white/[0.05] hover:border-white/10 transition-colors text-left`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {m.struggling_concepts > 0 && (
                  <TrendingDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <p className="font-sans text-sm font-semibold text-white truncate">{m.title}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <SubjectBadge code={m.subject} />
                <GradeChips grades={m.grade_levels} />
                {m.parsed_status !== 'completed' && (
                  <ParseStatusPill status={m.parsed_status as ParsedStatus} />
                )}
              </div>
              <p className="font-sans text-[11px] text-slate-500 mt-1.5">{materialCaption(m)}</p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
              <div className="flex-1 sm:flex-none sm:w-40">
                <MeterBar value={m.m_doc} tone={TIER_TONE[tier]} label={`Class average for ${m.title}`} />
              </div>
              <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${started ? toneText[TIER_TONE[tier]] : 'text-slate-600'}`}>
                {started ? `${masteryPercent(m.m_doc as number)}%` : '—'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// By student

function StudentsView({
  students,
  materials,
}: {
  students: StudentOverview[];
  materials: MaterialOverview[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const titleOf = new Map(materials.map((m) => [m.material_id, m.title]));

  const toggle = useCallback(
    (id: string) => setExpanded((prev) => (prev === id ? null : id)),
    []
  );

  if (students.length === 0) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <Users className="w-5 h-5 text-slate-500 mx-auto mb-3" />
        <p className="font-sans text-sm text-slate-300 font-medium">No students in your grades</p>
        <p className="font-sans text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
          No active student account is in a grade level you publish to. Publish a material to another
          grade, or check with your administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-sans text-xs text-slate-500 mb-1 leading-relaxed">
        Weakest first. Each figure averages every concept in your materials that reach that student,
        counting ones they have not been asked about at the starting estimate — so it will differ
        from the number the student sees if another educator also publishes to them. Open a row for
        the per-material breakdown.
      </p>

      {students.map((s) => {
        const isOpen = expanded === s.student_id;
        const started = s.m_doc !== null;

        return (
          <div key={s.student_id} className={`${PANEL} overflow-hidden`}>
            <button
              onClick={() => toggle(s.student_id)}
              aria-expanded={isOpen}
              disabled={!started}
              className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-colors text-left disabled:hover:bg-transparent disabled:cursor-default ${FOCUS}`}
            >
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                  started ? 'text-slate-500' : 'text-transparent'
                } ${isOpen ? 'rotate-180' : ''}`}
              />

              <div className="w-8 h-8 rounded-full bg-surface-container border border-white/10 flex items-center justify-center shrink-0 font-display text-[11px] font-bold text-slate-300">
                {s.first_name.charAt(0)}{s.last_name.charAt(0)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-sans text-sm font-semibold text-white truncate">
                  {s.first_name} {s.last_name}
                </p>
                <p className="font-sans text-[11px] text-slate-500">{studentCaption(s)}</p>
              </div>

              <div className="w-20 sm:w-40 shrink-0 flex items-center gap-2.5">
                <MeterBar
                  value={s.m_doc}
                  tone={TIER_TONE[s.tier]}
                  label={`Mastery for ${s.first_name} ${s.last_name}`}
                  className="flex-1"
                />
                <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right shrink-0 ${started ? toneText[TIER_TONE[s.tier]] : 'text-slate-600'}`}>
                  {started ? `${masteryPercent(s.m_doc as number)}%` : '—'}
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-white/5 px-4 py-4 flex flex-col gap-1.5">
                {/* Already in the payload: no request on expansion and no student id in a URL. */}
                {s.by_material.map((slice) => {
                  const tier = tierOf(slice.m_doc);
                  return (
                    <Link
                      key={slice.material_id}
                      to={`/educator/materials/${slice.material_id}?tab=performance`}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors group ${FOCUS}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm font-medium text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                          {titleOf.get(slice.material_id) ?? 'This lesson'}
                        </p>
                        <p className="font-sans text-[11px] text-slate-500 mt-0.5">
                          {slice.assessed_concept_count} of {slice.concept_count} concepts assessed
                        </p>
                      </div>
                      <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
                        <div className="flex-1 sm:flex-none sm:w-36">
                          <MeterBar
                            value={slice.m_doc}
                            tone={TIER_TONE[tier]}
                            label={`${s.first_name} ${s.last_name} on ${titleOf.get(slice.material_id) ?? 'this lesson'}`}
                          />
                        </div>
                        <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${toneText[TIER_TONE[tier]]}`}>
                          {masteryPercent(slice.m_doc)}%
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// By concept

function ConceptsView({ concepts, total }: { concepts: ConceptOverview[]; total: number }) {
  if (concepts.length === 0) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <Layers className="w-5 h-5 text-slate-500 mx-auto mb-3" />
        <p className="font-sans text-sm text-slate-300 font-medium">Nothing assessed yet</p>
        <p className="font-sans text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
          A concept appears here once a student has been asked about it in an adaptive test or a due
          flashcard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-sans text-xs text-slate-500 mb-1 leading-relaxed">
        {concepts.length < total
          ? `The ${concepts.length} weakest of ${total} assessed concepts, `
          : 'Weakest first, '}
        averaged across the students assessed on each one — not the whole class. A concept nobody has
        been asked about is not listed, because its starting estimate is not a measurement. Open a
        material's Class Performance tab to see which students are where.
      </p>

      {concepts.map((c) => {
        const tier = tierOf(c.avg_mastery);

        return (
          <Link
            key={c.concept_id}
            to={`/educator/materials/${c.material_id}?tab=performance`}
            className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors group ${FOCUS}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {c.struggling_students > 0 && (
                  <TrendingDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <p className="font-sans text-sm font-medium text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                  {c.term}
                </p>
              </div>
              <p className="font-sans text-[11px] text-slate-500 mt-0.5 truncate">
                {c.material_title}
                {' · '}{c.assessed_students} assessed
                {c.struggling_students > 0 && ` · ${c.struggling_students} struggling`}
                {c.mastered_students > 0 && ` · ${c.mastered_students} mastered`}
                {c.source_pages && c.source_pages.length > 0 && ` · p. ${Math.min(...c.source_pages)}`}
              </p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
              <div className="flex-1 sm:flex-none sm:w-40">
                <MeterBar
                  value={c.avg_mastery}
                  tone={TIER_TONE[tier]}
                  label={`Class average for ${c.term}`}
                />
              </div>
              <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${toneText[TIER_TONE[tier]]}`}>
                {masteryPercent(c.avg_mastery)}%
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// Side column

function GradeCoverage({ grades }: { grades: EducatorOverview['grades'] }) {
  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      <div className="flex items-center gap-2.5 mb-5">
        <span className="w-8 h-8 rounded-lg bg-indigo-400/10 border border-indigo-400/20 flex items-center justify-center shrink-0">
          <Layers className="w-4 h-4 text-indigo-400" />
        </span>
        <h2 className="font-display text-lg font-bold text-white">Grade coverage</h2>
      </div>

      <div className="flex flex-col gap-4">
        {grades.map((g) => {
          const started = g.m_doc !== null;
          const tier = started ? tierOf(g.m_doc as number) : 'foundational';

          return (
            <div key={g.grade_level}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-sm font-bold text-white">Grade {g.grade_level}</h3>
                <span className={`font-sans text-xs font-semibold tabular-nums ${started ? toneText[TIER_TONE[tier]] : 'text-slate-600'}`}>
                  {started ? `${masteryPercent(g.m_doc as number)}%` : '—'}
                </span>
              </div>
              <MeterBar
                value={g.m_doc}
                tone={TIER_TONE[tier]}
                label={`Average mastery in Grade ${g.grade_level}`}
                className="mt-2"
              />
              <p className="font-sans text-[11px] text-slate-500 mt-1.5">
                {g.material_count} material{g.material_count === 1 ? '' : 's'}
                {' · '}
                {g.size === 0
                  ? 'no students'
                  : `${g.started} of ${g.size} student${g.size === 1 ? '' : 's'} started`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentUploads({ uploads }: { uploads: EducatorOverview['recent_uploads'] }) {
  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      {/* Icon chip, matching the other side-column headings. */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center shrink-0">
            <Upload className="w-4 h-4 text-emerald-400" />
          </span>
          <h2 className="font-display text-lg font-bold text-white truncate">Recent uploads</h2>
        </div>
        <Link
          to="/educator/materials"
          className={`font-sans text-xs text-primary-fixed-dim font-semibold flex items-center gap-1 hover:gap-1.5 transition-all shrink-0 rounded ${FOCUS}`}
        >
          See all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {uploads.map((m) => (
          <Link
            key={m.material_id}
            to={`/educator/materials/${m.material_id}`}
            className={`flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group ${FOCUS}`}
          >
            <div className="w-8 h-8 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="w-3.5 h-3.5 text-primary-fixed-dim" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                {m.title}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <SubjectBadge code={m.subject} />
                <GradeChips grades={m.grade_levels} />
                <ParseStatusPill status={m.parsed_status as ParsedStatus} />
              </div>
              <p className="font-sans text-[11px] text-slate-500 mt-1.5">
                {m.concept_count} concept{m.concept_count === 1 ? '' : 's'} ·{' '}
                {formatRelativeTime(m.created_at)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NoMaterials({ archived }: { archived: number }) {
  return (
    <div className={`${CARD} py-16 px-6 text-center animate-tab-in`}>
      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-4 mx-auto">
        <Upload className="w-5 h-5 text-slate-400" />
      </div>
      <h3 className="font-display text-base font-semibold text-white mb-1.5">
        {archived > 0 ? 'Nothing published right now' : 'No materials yet'}
      </h3>
      <p className="font-sans text-xs text-slate-400 max-w-sm mx-auto mb-5 leading-relaxed">
        {archived > 0
          ? `You have ${archived} archived material${archived === 1 ? '' : 's'}. Archived lessons stay out of students' study spaces, so nothing is being measured — restore one, or upload something new.`
          : 'Upload a PDF learning module and choose which grade level can study it. Concepts are extracted automatically, and mastery starts tracking as soon as students begin.'}
      </p>
      <Link
        to="/educator/materials"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-xs font-bold hover:brightness-110 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {archived > 0 ? 'Open your materials' : 'Upload your first material'}
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

/** Tile hints state the remainder (what's left to act on) and name their unit. */
function startedHint(started: number, size: number): string {
  if (size === 0) return 'No students in your grade levels';
  if (started === size) return 'Everyone has begun';
  return `${size - started} student${size - started === 1 ? '' : 's'} not started yet`;
}

function assessedHint(assessed: number, total: number): string {
  if (total === 0) return 'No concepts extracted yet';
  if (assessed === total) return 'Every concept has been answered on';
  // Same phrasing as the student dashboard.
  return `${total - assessed} have not come up yet`;
}

/** Tier from the displayed (rounded) value so the bar colour matches the number. */
function tierOf(mastery: number): DifficultyTier {
  return masteryTier(masteryPercent(mastery) / 100);
}
