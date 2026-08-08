import { Fragment, useEffect, useState } from 'react';
import { ChartColumn, ChevronRight, RefreshCw, Target } from 'lucide-react';
import { CARD, LABEL, SECTION, toneText } from '../../../components/ui/surfaces';
import MeterBar from '../../../components/ui/MeterBar';
import {
  masteryApi,
  masteryCaption,
  masteryPercent,
  masteryTier,
  relativeTime,
  TIER_LABEL,
  TIER_TONE,
  type ConceptMastery,
  type MaterialMasteryDetail,
  type SpaceMasteryDetail,
} from '../../../lib/mastery';

/**
 * Analytics — what BKT has actually learned about this student.
 *
 * This is the paper's EQ(4) deliverable. p. 81: the document mastery percentage
 * "displayed as a progress bar on the user dashboard"; p. 98 lists "BKT mastery
 * tracking and dashboard visualization" and "learning analytics display" among
 * the student-side black-box test cases.
 *
 * ── THE RULE THIS WHOLE TAB IS BUILT AROUND ─────────────────────────────────
 *
 * A concept with no `bkt_mastery` row sits at P(L₀) = 0.10, and that is an
 * ASSUMPTION, not a measurement. In a 29-concept lesson where six questions were
 * answered, twenty-three concepts read 0.10 — and rendering those as "10%" tells
 * a student they know a tenth of something nobody has asked them about.
 *
 * There is a second, sharper reason. Any concept with even one observation lands
 * at 0.20 or above, because the transition step floors the posterior at P(T).
 * So an unassessed concept at 0.10 would rank BELOW every genuinely struggling
 * one, and a weakest-first list would fill up with concepts the student has never
 * seen — the exact opposite of useful.
 *
 * Hence: assessed concepts get a bar, a percentage and a tier colour. Unassessed
 * ones get their name and nothing else. Every gate reads `assessed` or
 * `assessed_concept_count`, NEVER `mastery === 0.1`.
 *
 * Corollary worth knowing before you look at real data: **no assessed concept can
 * ever display below 20%**, and a cluster at 20–25% means "got everything wrong",
 * not "barely started".
 *
 * READ-ONLY. Mastery has exactly two writers (paper p. 58) — the flashcard rating
 * route and test completion. Nothing here may ever write it.
 */

interface AnalyticsTabProps {
  spaceId: string;
  /** Used ONLY to tell "no lessons in this space" apart from "the fetch failed". */
  availableResources: { id: string; title: string; concept_count: number }[];
}

/** How many concepts the Focus card names. Three fits without becoming a list. */
const FOCUS_COUNT = 3;

export default function AnalyticsTab({ spaceId, availableResources }: AnalyticsTabProps) {
  const [detail, setDetail] = useState<SpaceMasteryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Reset on every tab switch, because `<main key={activeTab}>` remounts this
     component. That is correct and deliberate — see the fetch comment below. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /*
   * One fetch, on mount. No refresh button and no cache.
   *
   * `StudySpace` renders `<main key={activeTab}>`, so switching tabs unmounts and
   * remounts this component — meaning the data is fresh by construction every
   * time the student arrives, including the moment that matters most, arriving
   * from Test Mode having just moved the number. A module-level cache would be
   * stale at exactly that moment, and a refresh button would advertise a
   * staleness that does not exist.
   */
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    masteryApi
      .detail(spaceId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your progress.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const toggle = (materialId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });

  const noMaterials = availableResources.length === 0;
  const nothingAssessed = detail !== null && detail.concepts_assessed === 0;

  /*
   * The weakest concepts the student has ACTUALLY been assessed on, across every
   * lesson. Unassessed ones are excluded by construction, which is the whole
   * point — see the header note.
   */
  const focus: (ConceptMastery & { materialTitle: string })[] = (detail?.by_material ?? [])
    .flatMap((m) => m.concepts.filter((c) => c.assessed).map((c) => ({ ...c, materialTitle: m.title })))
    .sort((a, b) => a.mastery - b.mastery || a.term.localeCompare(b.term));

  const updated = relativeTime(detail?.last_updated ?? null);

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 min-w-0 border-b border-white/5 pb-5">
        <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
          <ChartColumn className="w-5 h-5 text-primary-fixed-dim" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-white tracking-tight truncate">
            Analytics
          </h2>
          <p className="font-sans text-xs text-slate-500 mt-0.5">
            How much of each lesson you have mastered, tracked from your flashcard reviews and tests.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3">
          <p className="font-sans text-sm text-red-300">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      ) : noMaterials || !detail || detail.by_material.length === 0 ? (
        <div className={`${CARD} py-16 px-6 text-center mt-6`}>
          <ChartColumn className="w-10 h-10 text-slate-500 opacity-20 mx-auto mb-4" />
          <p className="font-sans text-sm text-slate-400 mb-1">No lessons in this study space yet.</p>
          <p className="font-sans text-xs text-slate-600">
            Add a lesson from the Learning Resources tab and your progress will show up here.
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary ──────────────────────────────────────────────────────
              "Level" dashes out at cold start for the same reason "Mastery"
              does: `foundational` with no evidence behind it is the default the
              system starts everyone at, not something it has found out. */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <Stat
              label="Overall mastery"
              value={
                detail.overall === null || nothingAssessed
                  ? '—'
                  : `${masteryPercent(detail.overall)}%`
              }
              className={
                detail.overall === null || nothingAssessed ? '' : toneText[TIER_TONE[detail.tier]]
              }
            />
            <Stat
              label="Level"
              value={nothingAssessed ? '—' : TIER_LABEL[detail.tier]}
              className={nothingAssessed ? '' : toneText[TIER_TONE[detail.tier]]}
            />
            <Stat
              label="Concepts tracked"
              value={`${detail.concepts_assessed} / ${detail.concepts_total}`}
            />
          </div>

          <p className="font-sans text-[11px] text-slate-600 mt-2">
            {masteryCaption(detail)}
            {updated && !nothingAssessed ? ` · Updated ${updated}.` : ''}
          </p>

          {/* ── Nothing measured yet ─────────────────────────────────────────
              Deliberately NOT the house empty-card. The lesson list below is
              itself the information — "these are the lessons being tracked" —
              so replacing it with an empty state would hide the one thing the
              student can act on. */}
          {nothingAssessed && (
            <div className={`${CARD} p-5 mt-6`}>
              <p className="font-sans text-sm text-slate-300 font-semibold">Nothing measured yet.</p>
              <p className="font-sans text-xs text-slate-500 mt-1 leading-relaxed">
                Your mastery updates when you rate a flashcard or finish a test. Until then there is
                nothing to measure — the lessons below are waiting, not scored at zero.
              </p>
            </div>
          )}

          {/* ── Focus next ───────────────────────────────────────────────── */}
          {focus.length > 0 && (
            <div className={`${CARD} p-5 mt-6`}>
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary-fixed-dim" />
                <h3 className={SECTION}>Focus next</h3>
              </div>
              {/* The honesty guard. Without it a student wonders why a concept
                  they know they are bad at is missing — the answer is always
                  "it has not come up yet", and this says so up front. */}
              <p className="font-sans text-[11px] text-slate-600 mt-1.5">
                Ranked from the {detail.concepts_assessed} concept
                {detail.concepts_assessed === 1 ? '' : 's'} you have been tested on.
              </p>

              {focus[0].mastery >= 0.85 ? (
                <p className="font-sans text-sm text-slate-300 mt-4">
                  You are above 85% on everything you have been tested on.
                  {detail.concepts_assessed < detail.concepts_total && (
                    <span className="text-slate-500">
                      {' '}
                      {detail.concepts_total - detail.concepts_assessed} concept
                      {detail.concepts_total - detail.concepts_assessed === 1 ? ' has' : 's have'} not
                      come up yet.
                    </span>
                  )}
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {focus.slice(0, FOCUS_COUNT).map((c) => (
                    // Keyed Fragment, not the row: this project has no
                    // @types/react, so a locally-declared component rejects `key`.
                    <Fragment key={c.concept_id}>
                      <ConceptRow concept={c} materialTitle={c.materialTitle} />
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── By lesson ────────────────────────────────────────────────── */}
          <div className="mt-8">
            <h3 className={`${SECTION} mb-4`}>By lesson</h3>
            <div className="space-y-2">
              {detail.by_material.map((m) => (
                <Fragment key={m.material_id}>
                  <LessonCard
                    material={m}
                    expanded={expanded.has(m.material_id)}
                    onToggle={() => toggle(m.material_id)}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`${CARD} p-4 text-center`}>
      <p className={`font-display text-xl font-bold tabular-nums ${className || 'text-white'}`}>
        {value}
      </p>
      <p className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-1">
        {label}
      </p>
    </div>
  );
}

/**
 * One assessed concept. Never rendered for an unassessed one — those have no
 * percentage to show and appear as name chips instead.
 */
function ConceptRow({ concept, materialTitle }: { concept: ConceptMastery; materialTitle?: string }) {
  // Tier from the ROUNDED value, so the colour cannot contradict the number: 0.849
  // prints "85%" but tiers as intermediate on the raw value.
  const percent = masteryPercent(concept.mastery);
  const tone = TIER_TONE[masteryTier(percent / 100)];

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="min-w-0 flex-1">
        <p className="font-sans text-sm text-white truncate">{concept.term}</p>
        <p className="font-sans text-[11px] text-slate-500 truncate">
          {materialTitle ? `${materialTitle} · ` : ''}
          {concept.opportunity_count} attempt{concept.opportunity_count === 1 ? '' : 's'}
          {concept.source_pages?.length ? ` · page ${concept.source_pages.join(', ')}` : ''}
        </p>
      </div>
      <div className="w-24 shrink-0">
        <MeterBar value={concept.mastery} tone={tone} label={`Mastery of ${concept.term}`} />
      </div>
      <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${toneText[tone]}`}>
        {percent}%
      </span>
    </div>
  );
}

function LessonCard({
  material,
  expanded,
  onToggle,
}: {
  material: MaterialMasteryDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Gate on the COUNT, never on `m_doc === 0.1` — a lesson can genuinely average
  // 0.10 while having been assessed, and the two must not look alike.
  const started = material.assessed_concept_count > 0;
  const assessed = material.concepts.filter((c) => c.assessed);
  const untested = material.concepts.filter((c) => !c.assessed);

  return (
    <div className={CARD}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left p-4 hover:bg-white/[0.02] transition-colors rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <ChevronRight
            className={`w-4 h-4 text-slate-500 shrink-0 mt-0.5 transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-sans text-sm font-semibold text-white truncate">{material.title}</p>
              {started ? (
                <span
                  className={`font-display text-sm font-bold tabular-nums shrink-0 ${
                    toneText[TIER_TONE[material.tier]]
                  }`}
                >
                  {masteryPercent(material.m_doc)}%
                </span>
              ) : (
                <span className="font-sans text-xs text-slate-500 shrink-0">Not started</span>
              )}
            </div>

            <div className="mt-2">
              <MeterBar
                value={started ? material.m_doc : null}
                tone={TIER_TONE[material.tier]}
                label={`Mastery of ${material.title}`}
              />
            </div>

            <p className="font-sans text-[11px] text-slate-500 mt-2">
              {material.assessed_concept_count} of {material.concept_count} concepts assessed
              {started && ` · ${TIER_LABEL[material.tier]}`}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-11 space-y-5">
          {assessed.length > 0 && (
            <div>
              <p className={`${LABEL} mb-3`}>Tested so far ({assessed.length})</p>
              <div className="space-y-3">
                {assessed.map((c) => (
                  <Fragment key={c.concept_id}>
                    <ConceptRow concept={c} />
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {untested.length > 0 && (
            <div>
              <p className={`${LABEL} mb-2`}>Not yet tested ({untested.length})</p>
              <p className="font-sans text-[11px] text-slate-600 mb-2.5 leading-relaxed">
                These haven't come up in a test or flashcard review yet, so there's nothing to
                measure.
              </p>
              {/* Names only. No bar, no number, no tier colour — every one of
                  these sits at the P(L₀) prior, which is an assumption. */}
              <div className="flex flex-wrap gap-1.5">
                {untested.map((c) => (
                  <span
                    key={c.concept_id}
                    className="px-2 py-1 rounded-md bg-white/5 font-sans text-[11px] text-slate-500"
                  >
                    {c.term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!started && (
            <p className="font-sans text-[11px] text-slate-500">
              Take a test on this lesson, or review its deck, to start tracking it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
