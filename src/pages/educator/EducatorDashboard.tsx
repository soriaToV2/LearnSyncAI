import { Link, useNavigate } from 'react-router-dom';
import {
  FileText, Users, TrendingUp, AlertTriangle, ArrowRight,
  Upload, Layers,
} from 'lucide-react';
import {
  EDUCATOR, MATERIALS, STUDENTS, GRADE_LEVEL_MASTERY,
  conceptCount, overallMastery, masteryRowsForStudent,
  assignedGrades, formatRelativeTime, formatPercent, studentName,
} from '../../data/mockEducator';
import StatCard from '../../components/educator/StatCard';
import MasteryBar from '../../components/educator/MasteryBar';
import TierBadge from '../../components/educator/TierBadge';
import SubjectBadge from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';

export default function EducatorDashboard() {
  const navigate = useNavigate();

  const publishedMaterials = MATERIALS.filter((m) => !m.is_archived);

  /**
   * Grades reached by this educator's live materials. Mirrors
   * private.auth_assigned_grades(), which decides which students the educator
   * can actually see.
   */
  const taughtGrades = new Set(assignedGrades());
  const reachedStudents = STUDENTS.filter((s) => taughtGrades.has(s.grade_level));

  /**
   * One overall figure per student, weighted by concept count — the same
   * arithmetic the roster uses, so the two pages never disagree.
   */
  const studentSummaries = reachedStudents
    .map((s) => {
      const rows = masteryRowsForStudent(s.id);
      const mastery = overallMastery(rows);
      return { student: s, rows, mastery };
    })
    .filter((s) => s.rows.length > 0);

  const averageMastery = studentSummaries.length
    ? studentSummaries.reduce((sum, s) => sum + s.mastery, 0) / studentSummaries.length
    : 0;

  const needsAttention = studentSummaries
    .filter((s) => s.mastery < 0.5)
    .sort((a, b) => a.mastery - b.mastery);

  const recentMaterials = [...publishedMaterials]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* Greeting */}
        <header className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight">
            Hi, {EDUCATOR.first_name}
          </h1>
          <p className="font-sans text-sm text-slate-400 mt-1.5">
            Here's how your classes are doing.
          </p>
        </header>

        {/* Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Materials Published"
            value={String(publishedMaterials.length)}
            hint={`${MATERIALS.length - publishedMaterials.length} archived`}
            icon={FileText}
            color="#22d3ee"
          />
          <StatCard
            label="Students Reached"
            value={String(reachedStudents.length)}
            hint={`Across ${taughtGrades.size} grade level${taughtGrades.size === 1 ? '' : 's'}`}
            icon={Users}
            color="#818cf8"
          />
          <StatCard
            label="Average Mastery"
            value={formatPercent(averageMastery)}
            hint="Across all your materials"
            icon={TrendingUp}
            color="#34d399"
          />
          <StatCard
            label="Needs Attention"
            value={String(needsAttention.length)}
            hint="Students below 50% mastery"
            icon={AlertTriangle}
            color="#fb7185"
          />
        </section>

        <div className="grid grid-cols-12 gap-6">

          {/* ---------------- Recent uploads ---------------- */}
          <section className="col-span-12 lg:col-span-7 rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-bold text-white">Recent Uploads</h2>
              <Link
                to="/educator/materials"
                className="font-sans text-xs text-primary-fixed-dim font-semibold flex items-center gap-1 hover:gap-1.5 transition-all"
              >
                See all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {recentMaterials.length === 0 ? (
              <div className="flex flex-col items-center text-center py-10 px-6 rounded-xl border-2 border-dashed border-white/10">
                <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-4">
                  <Upload className="w-5 h-5 text-slate-400" />
                </div>
                <h3 className="font-display text-base font-semibold text-white mb-1.5">
                  No materials yet
                </h3>
                <p className="font-sans text-xs text-slate-400 max-w-xs mb-5">
                  Upload a PDF learning module and choose which grade levels can study it.
                  Concepts are extracted automatically.
                </p>
                <Link
                  to="/educator/materials"
                  className="px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-xs font-bold hover:bg-primary-fixed transition-colors"
                >
                  Upload your first material
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentMaterials.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/educator/materials/${m.id}`)}
                    className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left w-full group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-4 h-4 text-primary-fixed-dim" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-sm font-semibold text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                        {m.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <SubjectBadge code={m.subject} />
                        <GradeChips grades={m.grade_levels} />
                        <ParseStatusPill status={m.parsed_status} />
                      </div>
                      <p className="font-sans text-[11px] text-slate-500 mt-1.5">
                        {conceptCount(m.id)} concept{conceptCount(m.id) === 1 ? '' : 's'} ·
                        {' '}uploaded {formatRelativeTime(m.created_at)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---------------- Needs attention ---------------- */}
          <section className="col-span-12 lg:col-span-5 rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-bold text-white">Needs Attention</h2>
              <Link
                to="/educator/students"
                className="font-sans text-xs text-primary-fixed-dim font-semibold flex items-center gap-1 hover:gap-1.5 transition-all"
              >
                All students <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {needsAttention.length === 0 ? (
              <div className="flex flex-col items-center text-center py-10">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="font-sans text-sm text-slate-300 font-medium">
                  Everyone is above 50%
                </p>
                <p className="font-sans text-xs text-slate-500 mt-1 max-w-[220px]">
                  No student in your grades is currently in the foundational tier.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {needsAttention.slice(0, 6).map(({ student, mastery, rows }) => (
                  <button
                    key={student.id}
                    onClick={() => navigate(`/educator/students/${student.id}`)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left w-full group"
                  >
                    <div className="w-8 h-8 rounded-full bg-surface-container border border-white/10 flex items-center justify-center shrink-0 font-display text-[11px] font-bold text-slate-300">
                      {student.first_name[0]}{student.last_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-sm font-semibold text-white truncate group-hover:text-primary-fixed-dim transition-colors">
                        {studentName(student)}
                      </p>
                      <p className="font-sans text-[11px] text-slate-500">
                        Grade {student.grade_level} · {rows.length} material{rows.length === 1 ? '' : 's'}
                      </p>
                      <MasteryBar mastery={mastery} className="mt-1.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---------------- Mastery by grade ---------------- */}
          <section className="col-span-12 rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <div className="flex items-center gap-2 mb-5">
              <Layers className="w-4 h-4 text-slate-400" />
              <h2 className="font-display text-lg font-bold text-white">Mastery by Grade Level</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...taughtGrades].sort((a, b) => a - b).map((grade) => {
                const rows = GRADE_LEVEL_MASTERY.filter((r) => r.grade_level === grade);
                const gradeStudents = new Set(rows.map((r) => r.student_id));
                const avg = rows.length
                  ? rows.reduce((sum, r) => sum + r.m_doc, 0) / rows.length
                  : 0;
                const tiers = {
                  advanced: rows.filter((r) => r.tier === 'advanced').length,
                  intermediate: rows.filter((r) => r.tier === 'intermediate').length,
                  foundational: rows.filter((r) => r.tier === 'foundational').length,
                };

                return (
                  <Link
                    key={grade}
                    to="/educator/students"
                    className="rounded-xl bg-white/[0.02] border border-white/5 p-5 hover:bg-white/[0.05] hover:border-white/10 transition-all"
                  >
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="font-display text-base font-bold text-white">Grade {grade}</h3>
                      <span className="font-sans text-xs text-slate-500">
                        {gradeStudents.size} student{gradeStudents.size === 1 ? '' : 's'}
                      </span>
                    </div>

                    <MasteryBar mastery={avg} className="mb-4" />

                    <div className="flex flex-wrap gap-1.5">
                      {tiers.advanced > 0 && (
                        <span className="flex items-center gap-1.5">
                          <TierBadge tier="advanced" />
                          <span className="font-sans text-xs text-slate-400">{tiers.advanced}</span>
                        </span>
                      )}
                      {tiers.intermediate > 0 && (
                        <span className="flex items-center gap-1.5">
                          <TierBadge tier="intermediate" />
                          <span className="font-sans text-xs text-slate-400">{tiers.intermediate}</span>
                        </span>
                      )}
                      {tiers.foundational > 0 && (
                        <span className="flex items-center gap-1.5">
                          <TierBadge tier="foundational" />
                          <span className="font-sans text-xs text-slate-400">{tiers.foundational}</span>
                        </span>
                      )}
                    </div>

                    <p className="font-sans text-[11px] text-slate-500 mt-3">
                      Counts are student–material pairs, not students.
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
