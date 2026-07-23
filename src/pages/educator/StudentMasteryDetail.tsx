import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Users, ChevronDown, TrendingUp, Target, Clock, HelpCircle,
} from 'lucide-react';
import MasteryBar from '../../components/educator/MasteryBar';
import TierBadge, { TIER_STYLE } from '../../components/educator/TierBadge';
import SubjectBadge from '../../components/educator/SubjectBadge';
import {
  studentById, masteryRowsForStudent, conceptsForMaterial, masteryFor,
  overallMastery, masteryTier, formatRelativeTime, formatPercent, studentName,
  INITIAL_MASTERY, type MasteryTier,
} from '../../data/mockEducator';

const TIERS: MasteryTier[] = ['advanced', 'intermediate', 'foundational'];

export default function StudentMasteryDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const student = studentId ? studentById(studentId) : undefined;
  const rows = studentId ? masteryRowsForStudent(studentId) : [];

  const [expanded, setExpanded] = useState<string | null>(rows[0]?.material_id ?? null);

  if (!student) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-background px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-4">
          <Users className="w-6 h-6 text-slate-400" />
        </div>
        <h1 className="font-display text-xl font-semibold text-white mb-2">Student not found</h1>
        <p className="font-sans text-sm text-slate-400 mb-6">
          This student may not be in a grade level you have published a material to.
        </p>
        <Link
          to="/educator/students"
          className="px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors"
        >
          Back to Students
        </Link>
      </main>
    );
  }

  const overall = overallMastery(rows);

  /** Every concept row across the student's materials, for the tier breakdown. */
  const allConcepts = rows.flatMap((r) =>
    conceptsForMaterial(r.material_id).map((c) => ({
      concept: c,
      mastery: masteryFor(student.id, c.id),
    }))
  );

  const assessedCount = allConcepts.filter((c) => c.mastery).length;

  const tierCounts = TIERS.map((tier) => ({
    tier,
    count: allConcepts.filter(
      (c) => c.mastery && masteryTier(c.mastery.latent_mastery) === tier
    ).length,
  }));

  const lastActive = rows
    .map((r) => r.last_updated)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1000px] mx-auto px-4 md:px-8 py-8 md:py-12">

        <button
          onClick={() => navigate('/educator/students')}
          className="flex items-center gap-2 font-sans text-xs text-slate-400 hover:text-white transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Students
        </button>

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center gap-5 mb-8">
          <div
            className="w-16 h-16 rounded-2xl border flex items-center justify-center shrink-0 font-display text-xl font-bold"
            style={{
              backgroundColor: `${TIER_STYLE[masteryTier(overall)].color}1a`,
              borderColor: `${TIER_STYLE[masteryTier(overall)].color}40`,
              color: TIER_STYLE[masteryTier(overall)].color,
            }}
          >
            {student.first_name[0]}{student.last_name[0]}
          </div>

          <div className="min-w-0">
            <h1 className="font-display text-2xl md:text-3xl font-semibold text-on-surface">
              {studentName(student)}
            </h1>
            <div className="flex flex-wrap items-center gap-2.5 mt-2">
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-sans text-[10px] font-bold uppercase tracking-wider">
                Grade {student.grade_level}
              </span>
              <TierBadge tier={masteryTier(overall)} />
              <span className="font-sans text-xs text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Last active {formatRelativeTime(lastActive)}
              </span>
            </div>
          </div>
        </header>

        {/* Summary */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
              style={{
                backgroundColor: `${TIER_STYLE[masteryTier(overall)].color}1a`,
                color: TIER_STYLE[masteryTier(overall)].color,
              }}
            >
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
            <p className="font-display text-2xl font-bold text-white tracking-tight">
              {formatPercent(overall)}
            </p>
            <p className="font-sans text-sm text-slate-300 font-medium mt-0.5">Overall Mastery</p>
            <p className="font-sans text-xs text-slate-500 mt-0.5">
              Weighted across {rows.length} material{rows.length === 1 ? '' : 's'}
            </p>
            <MasteryBar mastery={overall} showValue={false} className="mt-3" />
          </div>

          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-4 bg-cyan-400/10 text-cyan-400">
              <Target className="w-4.5 h-4.5" />
            </div>
            <p className="font-display text-2xl font-bold text-white tracking-tight tabular-nums">
              {assessedCount}
              <span className="text-slate-600 text-lg"> / {allConcepts.length}</span>
            </p>
            <p className="font-sans text-sm text-slate-300 font-medium mt-0.5">Concepts Assessed</p>
            <p className="font-sans text-xs text-slate-500 mt-0.5">
              {allConcepts.length - assessedCount} not yet attempted
            </p>
          </div>

          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
            <p className="font-sans text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3.5">
              Assessed concepts by tier
            </p>
            <div className="flex flex-col gap-2.5">
              {tierCounts.map(({ tier, count }) => (
                <div key={tier} className="flex items-center justify-between gap-3">
                  <TierBadge tier={tier} />
                  <span className="font-display text-base font-bold text-white tabular-nums">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Per-material breakdown */}
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold text-white mb-1">Mastery by Material</h2>

          {rows.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-8 text-center">
              <p className="font-sans text-sm text-slate-400">
                This student has no mastery data for any of your materials yet.
              </p>
            </div>
          ) : (
            rows.map((row) => {
              const isOpen = expanded === row.material_id;
              const concepts = conceptsForMaterial(row.material_id);

              return (
                <div
                  key={row.material_id}
                  className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : row.material_id)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <SubjectBadge code={row.subject} />
                        <span className="font-sans text-sm font-semibold text-white truncate">
                          {row.material_title}
                        </span>
                      </div>
                      <p className="font-sans text-[11px] text-slate-500">
                        {row.assessed_concept_count} of {row.concept_count} concepts assessed ·
                        {' '}{row.mastered_concept_count} mastered ·
                        {' '}updated {formatRelativeTime(row.last_updated)}
                      </p>
                    </div>

                    <div className="w-32 sm:w-40 shrink-0">
                      <MasteryBar mastery={row.m_doc} />
                    </div>

                    <TierBadge tier={row.tier} className="hidden sm:inline-flex shrink-0" />
                  </button>

                  {isOpen && (
                    <div className="border-t border-white/5 px-5 py-4">
                      <div className="flex flex-col gap-1.5">
                        {concepts.map((c) => {
                          const m = masteryFor(student.id, c.id);
                          const value = m?.latent_mastery ?? INITIAL_MASTERY;

                          return (
                            <div
                              key={c.id}
                              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3.5 py-3 rounded-xl border ${
                                m
                                  ? 'bg-white/[0.02] border-white/5'
                                  : 'bg-transparent border-dashed border-white/10'
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className={`font-sans text-sm font-medium truncate ${m ? 'text-white' : 'text-slate-500'}`}>
                                  {c.term}
                                </p>
                                {!m && (
                                  <p className="font-sans text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                                    <HelpCircle className="w-3 h-3" />
                                    Not yet assessed — held at the starting probability of 10%
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-4 shrink-0">
                                <span className="font-sans text-[11px] text-slate-500 tabular-nums w-20 text-right hidden sm:block">
                                  {m ? `${m.opportunity_count} attempt${m.opportunity_count === 1 ? '' : 's'}` : '—'}
                                </span>
                                <div className="w-32 sm:w-40">
                                  <MasteryBar mastery={value} muted={!m} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <p className="font-sans text-xs text-slate-500 mt-6 leading-relaxed">
          Mastery comes from Bayesian Knowledge Tracing and is updated only by adaptive flashcards and
          adaptive tests. Free recall, the Feynman technique, and the games read these values to
          personalise themselves, but never change them.
        </p>
      </div>
    </main>
  );
}
