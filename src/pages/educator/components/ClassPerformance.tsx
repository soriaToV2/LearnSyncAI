import { useState, useEffect, useCallback } from 'react';
import {
  Users, ChevronDown, AlertTriangle, HelpCircle, BookOpen, TrendingDown
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import MeterBar from '../../../components/ui/MeterBar';
import TierBadge from '../../../components/educator/TierBadge';
import { toneText } from '../../../components/ui/surfaces';
import {
  educatorAnalyticsApi, classCaption, conceptCaption, STRUGGLING_BELOW,
  masteryPercent, masteryTier, relativeTime, TIER_TONE,
  type DifficultyTier, type MaterialPerformance, type StudentMaterialDetail,
  type ConceptClassDetail,
} from '../../../lib/educatorAnalytics';

/**
 * The Class Performance tab inside a material.
 *
 * Replaces the roster pages that used to live at `/educator/students`. Those were
 * built entirely on `src/data/mockEducator.ts` — eighteen invented students — and
 * this tab was too: it called `masteryRowsForMaterial()` with a real database
 * UUID against a table keyed on `'mat-sci-1'`, so the lookup never matched and
 * only its empty state ever rendered. Everything below is real BKT data.
 *
 * ── Never print P(L₀) ────────────────────────────────────────────────────────
 *
 * A student with no `bkt_mastery` row for a concept sits at 0.10 by assumption.
 * Rendering that as "10%" would tell an educator a student knows a tenth of
 * something nobody has asked them about, and — because the BKT transition step
 * floors every assessed posterior at P(T) = 0.20 — would rank every student who
 * has done nothing ABOVE every student who is measurably struggling. So a null
 * `m_doc` renders as "Not started" with `<MeterBar value={null} />`, which draws
 * an empty track of the same height rather than a short bar.
 *
 * ── No cache, deliberately ───────────────────────────────────────────────────
 *
 * The parent renders this only while its tab is active, so switching away and
 * back remounts it and refetches. That is the same freshness-by-construction the
 * student Analytics tab gets from `<main key={activeTab}>`, and it matters more
 * here: an educator returning to this tab is usually checking whether something
 * moved. The per-student drill-downs ARE cached, but only for the life of one
 * mount — they are fetched on expansion and there is no reason to pay for the
 * same expansion twice in one sitting.
 */

type View = 'students' | 'concepts';

const PANEL = 'rounded-2xl bg-white/[0.02] border border-white/5';

export default function ClassPerformance({ materialId }: { materialId: string }) {
  const [data, setData] = useState<MaterialPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('students');

  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, StudentMaterialDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // The By-concept view's own expansion — the transpose of the above.
  const [openConcept, setOpenConcept] = useState<string | null>(null);
  const [conceptDetails, setConceptDetails] = useState<Record<string, ConceptClassDetail>>({});
  const [conceptLoading, setConceptLoading] = useState<string | null>(null);
  const [conceptError, setConceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    educatorAnalyticsApi
      .performance(materialId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError('Could not load class performance.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [materialId]);

  const toggleStudent = useCallback(
    async (studentId: string) => {
      if (expanded === studentId) {
        setExpanded(null);
        return;
      }
      setExpanded(studentId);
      setDetailError(null);
      if (details[studentId]) return;

      setDetailLoading(studentId);
      try {
        const detail = await educatorAnalyticsApi.student(materialId, studentId);
        setDetails((prev) => ({ ...prev, [studentId]: detail }));
      } catch {
        setDetailError(studentId);
      } finally {
        setDetailLoading(null);
      }
    },
    [expanded, details, materialId]
  );

  const toggleConcept = useCallback(
    async (conceptId: string) => {
      if (openConcept === conceptId) {
        setOpenConcept(null);
        return;
      }
      setOpenConcept(conceptId);
      setConceptError(null);
      if (conceptDetails[conceptId]) return;

      setConceptLoading(conceptId);
      try {
        const detail = await educatorAnalyticsApi.concept(materialId, conceptId);
        setConceptDetails((prev) => ({ ...prev, [conceptId]: detail }));
      } catch {
        setConceptError(conceptId);
      } finally {
        setConceptLoading(null);
      }
    },
    [openConcept, conceptDetails, materialId]
  );

  // ── Load / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className={`${PANEL} p-10 flex items-center justify-center gap-3`}>
        <Spinner className="w-4 h-4 text-slate-500" />
        <p className="font-sans text-sm text-slate-400">Loading class performance…</p>
      </section>
    );
  }

  /*
    ⚠️ EVERY POST-LOADING BRANCH BELOW CARRIES `animate-tab-in`, AND THE LOADING
    BRANCH ABOVE DELIBERATELY DOES NOT. `MaterialDetail` animates the tab panel
    when it mounts, but this component mounts into a spinner and fetches — so
    that entrance played on the loader and was over before anything readable
    arrived, and the content then just appeared. The animation has to fire on
    the transition the reader actually sees, which is loading → result.

    No `key` is needed: React reuses the `<section>` across that render, and a
    CSS animation restarts whenever `animation-name` changes from `none` to a
    name. The three empty/error branches get it too — they are results as much
    as the table is, and an empty state that snaps in while a populated one
    animates would look like a different component.
  */
  if (error || !data) {
    return (
      <section className={`${PANEL} p-6 flex items-start gap-2.5 animate-tab-in`}>
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <p className="font-sans text-sm text-rose-300">{error ?? 'Could not load class performance.'}</p>
      </section>
    );
  }

  const { class: cls, students, concepts, material } = data;

  /*
   * Three distinct empty states, not one. "This lesson has no concepts yet" and
   * "nobody is in these grades" and "nobody has started" are different problems
   * with different fixes, and collapsing them into a single paragraph is how the
   * old tab managed to say nothing useful in every case.
   */
  if (material.concept_count === 0) {
    return (
      <section className={`${PANEL} p-8 text-center animate-tab-in`}>
        <BookOpen className="w-5 h-5 text-slate-500 mx-auto mb-3" />
        <p className="font-sans text-sm text-slate-300 font-medium">No concepts yet</p>
        <p className="font-sans text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
          {material.parsed_status === 'completed'
            ? 'This material has no concepts, so there is nothing for mastery to be measured against.'
            : 'Concepts appear once extraction finishes. Mastery starts tracking after that.'}
        </p>
      </section>
    );
  }

  if (cls.size === 0) {
    return (
      <section className={`${PANEL} p-8 text-center animate-tab-in`}>
        <Users className="w-5 h-5 text-slate-500 mx-auto mb-3" />
        <p className="font-sans text-sm text-slate-300 font-medium">No students in these grades</p>
        <p className="font-sans text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
          No active student account is in{' '}
          {material.grade_levels.map((g) => `Grade ${g}`).join(' or ')}. Publish this material to
          another grade level, or check with your administrator.
        </p>
      </section>
    );
  }

  const tone = TIER_TONE[cls.tier];

  return (
    <section className="flex flex-col gap-4 animate-tab-in">

      {/* ── Class summary ─────────────────────────────────────────────── */}
      <div className={`${PANEL} p-6`}>
        <div className="flex items-center gap-2 mb-5">
          <Users className="w-4 h-4 text-slate-400" />
          <h2 className="font-display text-lg font-bold text-white">Class Performance</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              label="Class average mastery"
              className="mt-3"
            />
            <p className="font-sans text-xs text-slate-500 mt-2.5 leading-relaxed">
              {classCaption(cls, material.concept_count)}
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

      {/* ── By student / By concept ───────────────────────────────────── */}
      {/* Labels shorten below `sm:` for the same reason the dashboard's control
          and the material tab bar do — this sits inside a padded card, so on a
          320px phone the two content-fitted buttons have ~240px to share. "By "
          carries nothing: the heading above already says what is being listed. */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/5 self-start">
        {([
          ['students', 'Students', 'By student', cls.size],
          ['concepts', 'Concepts', 'By concept', material.concept_count],
        ] as const).map(
          ([id, shortLabel, longLabel, count]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`px-3 sm:px-3.5 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] ${
                view === id
                  ? 'bg-white/[0.06] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">{shortLabel}</span>
              <span className="hidden sm:inline">{longLabel}</span> ({count})
            </button>
          )
        )}
      </div>

      {/* ── By student ────────────────────────────────────────────────── */}
      {/* Both branches carry the entrance. No `key` is needed: they are siblings
          at different child positions, so switching genuinely unmounts one and
          mounts the other — unlike a single slot whose content changes, which is
          what needs a key. */}
      {view === 'students' && (
        <div className="flex flex-col gap-1.5 animate-tab-in">
          {students.map((s) => {
            const isOpen = expanded === s.student_id;
            const detail = details[s.student_id];
            const started = s.m_doc !== null;

            return (
              <div key={s.student_id} className={`${PANEL} overflow-hidden`}>
                <button
                  onClick={() => void toggleStudent(s.student_id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] transition-colors text-left"
                >
                  <ChevronDown
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />

                  <div className="w-8 h-8 rounded-full bg-surface-container border border-white/10 flex items-center justify-center shrink-0 font-display text-[11px] font-bold text-slate-300">
                    {s.first_name.charAt(0)}{s.last_name.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm font-semibold text-white truncate">
                      {s.first_name} {s.last_name}
                    </p>
                    <p className="font-sans text-[11px] text-slate-500">
                      Grade {s.grade_level}
                      {started ? (
                        <>
                          {' · '}{s.assessed_concept_count} of {material.concept_count} assessed
                          {s.mastered_concept_count > 0 && ` · ${s.mastered_concept_count} mastered`}
                          {relativeTime(s.last_updated) && ` · ${relativeTime(s.last_updated)}`}
                        </>
                      ) : (
                        ' · Not started'
                      )}
                    </p>
                  </div>

                  <div className="w-24 sm:w-40 shrink-0 flex items-center gap-2.5">
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
                  <div className="border-t border-white/5 px-4 py-4">
                    {detailLoading === s.student_id && (
                      <div className="flex items-center justify-center gap-2.5 py-4">
                        <Spinner className="w-3.5 h-3.5 text-slate-500" />
                        <p className="font-sans text-xs text-slate-500">Loading concepts…</p>
                      </div>
                    )}

                    {detailError === s.student_id && (
                      <p className="font-sans text-xs text-rose-300 py-2">
                        Could not load this student's concepts.
                      </p>
                    )}

                    {/* On the loaded list, not on the panel — expanding a row
                        shows a spinner first, so an entrance on the panel
                        itself would play against the loader and be over before
                        the concepts arrived. Same rule as the tab panels; the
                        `.animate-tab-in` name is about the motion, not the
                        widget. */}
                    {detail && (
                      <div className="flex flex-col gap-1.5 animate-tab-in">
                        {detail.concepts.map((c) => (
                          <div
                            key={c.concept_id}
                            className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3.5 py-2.5 rounded-xl border ${
                              c.assessed
                                ? 'bg-white/[0.02] border-white/5'
                                : 'bg-transparent border-dashed border-white/10'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`font-sans text-sm font-medium truncate ${c.assessed ? 'text-white' : 'text-slate-500'}`}>
                                {c.term}
                              </p>
                              {!c.assessed && (
                                <p className="font-sans text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                                  <HelpCircle className="w-3 h-3 shrink-0" />
                                  Not yet assessed
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="font-sans text-[11px] text-slate-500 tabular-nums w-16 text-right hidden sm:block">
                                {c.assessed
                                  ? `${c.opportunity_count} attempt${c.opportunity_count === 1 ? '' : 's'}`
                                  : '—'}
                              </span>
                              <div className="w-28 sm:w-36">
                                {/*
                                  value={null} for an unassessed concept, NOT its 0.10.
                                  MeterBar renders the empty track and drops the meter
                                  role — announcing "10" would be a lie.
                                */}
                                <MeterBar
                                  value={c.assessed ? c.mastery : null}
                                  tone={TIER_TONE[c.assessed ? tierOf(c.mastery) : 'foundational']}
                                  label={`Mastery of ${c.term}`}
                                />
                              </div>
                              <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${c.assessed ? toneText[TIER_TONE[tierOf(c.mastery)]] : 'text-slate-600'}`}>
                                {c.assessed ? `${masteryPercent(c.mastery)}%` : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── By concept ────────────────────────────────────────────────── */}
      {view === 'concepts' && (
        <div className="flex flex-col gap-1.5 animate-tab-in">
          <p className="font-sans text-xs text-slate-500 mb-1 leading-relaxed">
            {cls.started === 0
              ? 'No student has been assessed on this material yet, so no concept has a class average.'
              : 'Weakest first, averaged across the students assessed on each concept — not the whole class. Open one to see where each student stands. "Struggling" means an assessed student below 50%; a student nobody has asked about this concept is not counted either way.'}
          </p>

          {concepts.map((c) => {
            const caption = conceptCaption(c);
            const assessed = c.avg_mastery !== null;
            const tier = assessed ? tierOf(c.avg_mastery as number) : 'foundational';
            const isOpen = openConcept === c.concept_id;
            const detail = conceptDetails[c.concept_id];

            return (
              <div
                key={c.concept_id}
                className={`rounded-xl border overflow-hidden ${
                  assessed ? 'bg-white/[0.02] border-white/5' : 'bg-transparent border-dashed border-white/10'
                }`}
              >
                <button
                  onClick={() => void toggleConcept(c.concept_id)}
                  aria-expanded={isOpen}
                  className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
                >
                  <ChevronDown
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {assessed && c.struggling_students > 0 && (
                        <TrendingDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                      <p className={`font-sans text-sm font-medium truncate ${assessed ? 'text-white' : 'text-slate-500'}`}>
                        {c.term}
                      </p>
                    </div>
                    <p className="font-sans text-[11px] text-slate-500 mt-0.5">
                      {caption ?? 'Not yet assessed by anyone'}
                      {c.source_pages && c.source_pages.length > 0 && ` · p. ${Math.min(...c.source_pages)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-28 sm:w-40">
                      <MeterBar
                        value={c.avg_mastery}
                        tone={TIER_TONE[tier]}
                        label={`Class average for ${c.term}`}
                      />
                    </div>
                    <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right ${assessed ? toneText[TIER_TONE[tier]] : 'text-slate-600'}`}>
                      {assessed ? `${masteryPercent(c.avg_mastery as number)}%` : '—'}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/5 px-4 py-4">
                    {conceptLoading === c.concept_id && (
                      <div className="flex items-center justify-center gap-2.5 py-4">
                        <Spinner className="w-3.5 h-3.5 text-slate-500" />
                        <p className="font-sans text-xs text-slate-500">Loading students…</p>
                      </div>
                    )}

                    {conceptError === c.concept_id && (
                      <p className="font-sans text-xs text-rose-300 py-2">
                        Could not load who is where on this concept.
                      </p>
                    )}

                    {/* A plain `<div>` rather than the fragment this was, purely
                        so the entrance has something to sit on — it wraps the
                        definition AND the student list, which arrive together.
                        Block-in-block, so nothing about the flow changes. */}
                    {detail && (
                      <div className="animate-tab-in">
                        <p className="font-sans text-[11px] text-slate-500 mb-3 leading-relaxed">
                          <span className="text-slate-400 font-medium">{detail.concept.term}</span>
                          {' — '}{detail.concept.definition}
                        </p>

                        <div className="flex flex-col gap-1.5">
                          {detail.students.map((s) => {
                            const sTier = s.assessed ? tierOf(s.mastery) : 'foundational';
                            const struggling = s.assessed && s.mastery < STRUGGLING_BELOW;

                            return (
                              <div
                                key={s.student_id}
                                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border ${
                                  s.assessed
                                    ? 'bg-white/[0.02] border-white/5'
                                    : 'bg-transparent border-dashed border-white/10'
                                }`}
                              >
                                <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 font-display text-[10px] font-bold ${
                                  struggling
                                    ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                                    : 'bg-surface-container border-white/10 text-slate-300'
                                }`}>
                                  {s.first_name.charAt(0)}{s.last_name.charAt(0)}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className={`font-sans text-sm font-medium truncate ${s.assessed ? 'text-white' : 'text-slate-500'}`}>
                                    {s.first_name} {s.last_name}
                                  </p>
                                  <p className="font-sans text-[11px] text-slate-500">
                                    {s.assessed
                                      ? `${s.opportunity_count} attempt${s.opportunity_count === 1 ? '' : 's'}`
                                      : 'Not yet assessed on this concept'}
                                    {struggling && ' · struggling'}
                                  </p>
                                </div>

                                <div className="w-24 sm:w-32 shrink-0">
                                  <MeterBar
                                    value={s.assessed ? s.mastery : null}
                                    tone={TIER_TONE[sTier]}
                                    label={`${s.first_name} ${s.last_name} on ${detail.concept.term}`}
                                  />
                                </div>
                                <span className={`font-sans text-xs font-semibold tabular-nums w-9 text-right shrink-0 ${s.assessed ? toneText[TIER_TONE[sTier]] : 'text-slate-600'}`}>
                                  {s.assessed ? `${masteryPercent(s.mastery)}%` : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*
        Careful with this sentence — the version it replaces said free recall and
        the Feynman technique "read these values to personalise themselves", which
        is not true of the built system. `cognitive.routes.ts` contains neither
        the word "mastery" nor "bkt": those two tabs neither read nor write it.
        Only the games read it (`server/lib/gameDifficulty.ts`).
      */}
      <p className="font-sans text-xs text-slate-500 mt-2 leading-relaxed">
        Mastery comes from Bayesian Knowledge Tracing and moves only when a student rates a due
        flashcard or completes an adaptive test. The games read it to pick their difficulty but never
        change it; free recall and the Feynman technique neither read nor change it.
      </p>
    </section>
  );
}

/**
 * Tier from the value being DISPLAYED, not the raw one.
 *
 * `masteryTier()` carries this rule in its own JSDoc: a concept at 0.849 renders
 * as "85%" but tiers as `intermediate`, so feeding it the raw number puts an
 * amber bar beside a number that reads as the advanced threshold. Rounding first
 * makes the colour and the digits agree. The class and per-student tiers come
 * from the server and are not run through this — they are computed on the
 * unrounded mean, so the two can only differ inside a razor-thin band.
 */
function tierOf(mastery: number): DifficultyTier {
  return masteryTier(masteryPercent(mastery) / 100);
}
