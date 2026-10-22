import { Fragment, useEffect, useState } from 'react';
import { Award, ChartColumn, ChevronRight, Layers, Target, TrendingUp } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
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
import { conceptBand, materialBand, pageHint, recommendConcept, recommendMaterial } from '../../../lib/recommend';
import type { StudyIntent } from '../../../lib/studySpace';

/**
 * Analytics: what BKT has learned about this student (EQ(4), paper pp. 81, 98).
 * An unassessed concept sits at P(L₀) = 0.10, an assumption, and would rank below every struggling
 * concept (assessed ones floor at 0.20). So assessed concepts get a bar, % and tier; unassessed ones
 * get their name only. Gate on `assessed`, never on the value.
 */

interface AnalyticsTabProps {
  spaceId: string;
  /** Only to tell "no lessons" from "fetch failed". */
  availableResources: { id: string; title: string; concept_count: number }[];
  /** Follow a recommendation. A callback, not a <Link> (same-route links do nothing). */
  onNavigate: (intent: StudyIntent) => void;
}

/** Concepts named in the Focus card. */
const FOCUS_COUNT = 3;

/** Local depth on top of the shared flat CARD. */
const PANEL = `${CARD} border border-white/5 shadow-lg shadow-black/20`;

export default function AnalyticsTab({
  spaceId,
  availableResources,
  onNavigate,
}: AnalyticsTabProps) {
  const [detail, setDetail] = useState<SpaceMasteryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Reset on each tab switch (the tab remounts). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // One fetch on mount; no cache or refresh button. The tab remounts on entry, so data is always fresh.
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

  // The weakest assessed concepts across every lesson (unassessed excluded).
  const focus: (ConceptMastery & { materialTitle: string; materialId: string })[] = (
    detail?.by_material ?? []
  )
    .flatMap((m) =>
      m.concepts
        .filter((c) => c.assessed)
        // `materialId` rides along so a recommendation can open the right lesson.
        // Plain ascending mastery is correct HERE and only here: this list is
        // assessed-only, so `rankOf()`'s unknown-in-the-middle rule has nothing
        // to do — every row is a real measurement.
        .map((c) => ({ ...c, materialTitle: m.title, materialId: m.material_id }))
    )
    .sort((a, b) => a.mastery - b.mastery || a.term.localeCompare(b.term));

  const updated = relativeTime(detail?.last_updated ?? null);

  /** A concept's lead step as a button. Optional on ConceptRow so long lesson lists don't grow a button per row. */
  const actionFor = (c: ConceptMastery, materialId: string) => {
    const rec = recommendConcept({
      term: c.term,
      band: conceptBand(c),
      mastery: c.mastery,
      sourcePages: c.source_pages,
    });
    const lead = rec.steps[0];
    return {
      label: lead.cta,
      onClick: () =>
        onNavigate({
          tab: lead.tab,
          materialId,
          // Only Feynman acts on a concept; the rest open on the lesson.
          conceptIds: lead.action === 'feynman' ? [c.concept_id] : [],
        }),
    };
  };

  return (
    <div className="fade-in duration-300 pb-10">
      {/* Header */}
      <div data-tour="an-header" className="flex items-center gap-3 min-w-0 border-b border-white/5 pb-5">
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
          <Spinner className="w-5 h-5 text-slate-500" />
        </div>
      ) : noMaterials || !detail || detail.by_material.length === 0 ? (
        <div className={`${PANEL} py-14 sm:py-16 px-6 text-center mt-6 animate-tab-in`}>
          <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 flex items-center justify-center mx-auto mb-4">
            <ChartColumn className="w-6 h-6 text-primary-fixed-dim/60" />
          </div>
          <p className="font-sans text-sm text-slate-400 mb-1">No lessons in this study space yet.</p>
          <p className="font-sans text-xs text-slate-600">
            Add a lesson from the Learning Resources tab and your progress will show up here.
          </p>
        </div>
      ) : (
        <div className="animate-tab-in">
          {/* Summary. "Level" dashes out at cold start: foundational with no evidence is just the default. */}
          {/* Two-up, then three-up: three tiles don't fit "Intermediate" at 375px. */}
          <div data-tour="an-summary" className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 mt-6">
            <Stat
              icon={TrendingUp}
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
              icon={Award}
              label="Level"
              value={nothingAssessed ? '—' : TIER_LABEL[detail.tier]}
              className={nothingAssessed ? '' : toneText[TIER_TONE[detail.tier]]}
            />
            <Stat
              icon={Layers}
              label="Concepts tracked"
              value={`${detail.concepts_assessed} / ${detail.concepts_total}`}
              wrapperClassName="col-span-2 sm:col-span-1"
            />
          </div>

          <p className="font-sans text-[11px] text-slate-600 mt-2.5 leading-relaxed">
            {masteryCaption(detail)}
            {updated && !nothingAssessed ? ` · Updated ${updated}.` : ''}
          </p>

          {/* Nothing measured yet: keep the lesson list below, which is the useful part. */}
          {nothingAssessed && (
            <div className={`${PANEL} p-4 sm:p-5 mt-6`}>
              <p className="font-sans text-sm text-slate-300 font-semibold">Nothing measured yet.</p>
              <p className="font-sans text-xs text-slate-500 mt-1 leading-relaxed">
                Your mastery updates when you rate a flashcard or finish a test. Until then there is
                nothing to measure — the lessons below are waiting, not scored at zero.
              </p>
            </div>
          )}

          {/* Focus next */}
          {focus.length > 0 && (
            <div className={`${PANEL} p-4 sm:p-5 mt-6`}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
                  <Target className="w-4 h-4 text-primary-fixed-dim" />
                </div>
                <h3 className={SECTION}>Focus next</h3>
              </div>
              {/* Honesty line: missing concepts haven't come up yet. */}
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
                <>
                  <div className="mt-4 space-y-3">
                    {focus.slice(0, FOCUS_COUNT).map((c) => (
                      // Keyed Fragment: without @types/react a local component rejects `key`.
                      <Fragment key={c.concept_id}>
                        <ConceptRow
                          concept={c}
                          materialTitle={c.materialTitle}
                          action={actionFor(c, c.materialId)}
                        />
                      </Fragment>
                    ))}
                  </div>
                  {/* Once per card, never per row. */}
                  <p className="font-sans text-[11px] text-slate-600 mt-4 leading-relaxed">
                    {
                      recommendConcept({
                        term: focus[0].term,
                        band: conceptBand(focus[0]),
                        mastery: focus[0].mastery,
                        sourcePages: focus[0].source_pages,
                      }).honesty
                    }
                  </p>
                </>
              )}
            </div>
          )}

          {/* By lesson */}
          <div data-tour="an-lessons" className="mt-8">
            <h3 className={`${SECTION} mb-4`}>By lesson</h3>
            <div className="space-y-3">
              {detail.by_material.map((m) => (
                <Fragment key={m.material_id}>
                  <LessonCard
                    material={m}
                    expanded={expanded.has(m.material_id)}
                    onToggle={() => toggle(m.material_id)}
                    onNavigate={onNavigate}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  className = '',
  wrapperClassName = '',
}: {
  label: string;
  value: string;
  icon: typeof Target;
  className?: string;
  wrapperClassName?: string;
}) {
  return (
    <div className={`${PANEL} p-3 sm:p-4 text-center ${wrapperClassName}`}>
      <Icon className="w-4 h-4 text-primary-fixed-dim/70 mx-auto mb-1.5" />
      {/* text-lg on phones so "Intermediate" fits a half-width tile. */}
      <p
        className={`font-display text-lg sm:text-xl font-bold tabular-nums leading-tight ${
          className || 'text-white'
        }`}
      >
        {value}
      </p>
      <p className="font-sans text-[11px] uppercase tracking-widest text-slate-500 font-semibold mt-1">
        {label}
      </p>
    </div>
  );
}

/** One assessed concept (unassessed ones appear as name chips). */
function ConceptRow({
  concept,
  materialTitle,
  action,
}: {
  concept: ConceptMastery;
  materialTitle?: string;
  /** Optional: only the Focus card passes one. */
  action?: { label: string; onClick: () => void };
}) {
  // Tier from the rounded value so colour matches the number shown.
  const percent = masteryPercent(concept.mastery);
  const tone = TIER_TONE[masteryTier(percent / 100)];

  return (
    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
      <div className="min-w-0 flex-1">
        <p className="font-sans text-sm text-white truncate">{concept.term}</p>
        <p className="font-sans text-[11px] text-slate-500 truncate">
          {materialTitle ? `${materialTitle} · ` : ''}
          {concept.opportunity_count} attempt{concept.opportunity_count === 1 ? '' : 's'}
          {pageHint(concept.source_pages) ? ` · ${pageHint(concept.source_pages)}` : ''}
        </p>
        {action && (
          <button
            onClick={action.onClick}
            className="mt-1 inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-primary-fixed-dim hover:underline"
          >
            {action.label}
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      {/* The meter narrows on phones so the term keeps its width. */}
      <div className="w-14 sm:w-24 shrink-0">
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
  onNavigate,
}: {
  material: MaterialMasteryDetail;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (intent: StudyIntent) => void;
}) {
  // Gate on the count, never on m_doc === 0.1.
  const started = material.assessed_concept_count > 0;
  const assessed = material.concepts.filter((c) => c.assessed);
  const untested = material.concepts.filter((c) => !c.assessed);

  const rec = recommendMaterial({
    title: material.title,
    band: materialBand(material),
    m_doc: material.m_doc,
  });
  const lead = rec.steps[0];

  return (
    <div
      className={`${PANEL} transition-colors ${
        expanded ? 'border-primary-fixed-dim/25' : 'hover:border-white/10'
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left p-4 hover:bg-white/[0.02] transition-colors rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
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

      {/* A sibling of the toggle button, never inside it (buttons can't nest). Always visible: the advice is the point. */}
      <div className="px-4 pb-4 -mt-1 flex items-center gap-2 flex-wrap">
        <button
          onClick={() =>
            onNavigate({ tab: lead.tab, materialId: material.material_id, conceptIds: [] })
          }
          className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-primary-fixed-dim hover:underline"
        >
          {lead.cta}
          <ChevronRight className="w-3 h-3" />
        </button>
        <span className="font-sans text-[11px] text-slate-600 min-w-0">{lead.why}</span>
      </div>

      {expanded && (
        /* The pl-11 indent only once there's room for it. */
        <div className="px-4 pb-4 sm:pl-11 space-y-5">
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
              {/* Names only: these all sit at the prior. */}
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
