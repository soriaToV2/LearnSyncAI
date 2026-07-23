import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, ArrowUpDown, ChevronRight } from 'lucide-react';
import Dropdown from '../../components/ui/Dropdown';
import MasteryBar from '../../components/educator/MasteryBar';
import TierBadge from '../../components/educator/TierBadge';
import SubjectBadge from '../../components/educator/SubjectBadge';
import {
  GRADE_LEVEL_MASTERY, MATERIALS, assignedGrades, masteryTier,
  overallMastery, formatRelativeTime, studentName,
  type GradeLevelMasteryRow,
} from '../../data/mockEducator';

type SortKey = 'name' | 'mastery' | 'assessed';

/** One row per student when "All materials" is selected; otherwise one per pair. */
interface RosterRow {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  label: string;
  subject: string | null;
  concept_count: number;
  assessed_concept_count: number;
  mastery: number;
  mastered_concept_count: number;
  last_updated: string | null;
  material_count: number;
}

function collapseByStudent(rows: GradeLevelMasteryRow[]): RosterRow[] {
  const byStudent = new Map<string, GradeLevelMasteryRow[]>();
  for (const r of rows) {
    const existing = byStudent.get(r.student_id);
    if (existing) existing.push(r);
    else byStudent.set(r.student_id, [r]);
  }

  return [...byStudent.values()].map((studentRows) => {
    const first = studentRows[0];
    const lastUpdated = studentRows
      .map((r) => r.last_updated)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return {
      student_id: first.student_id,
      first_name: first.first_name,
      last_name: first.last_name,
      grade_level: first.grade_level,
      label: `${studentRows.length} material${studentRows.length === 1 ? '' : 's'}`,
      subject: null,
      concept_count: studentRows.reduce((s, r) => s + r.concept_count, 0),
      assessed_concept_count: studentRows.reduce((s, r) => s + r.assessed_concept_count, 0),
      mastery: overallMastery(studentRows),
      mastered_concept_count: studentRows.reduce((s, r) => s + r.mastered_concept_count, 0),
      last_updated: lastUpdated,
      material_count: studentRows.length,
    };
  });
}

export default function StudentsRoster() {
  const navigate = useNavigate();
  const grades = assignedGrades();

  const [grade, setGrade] = useState(grades[0] ?? 7);
  const [materialFilter, setMaterialFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('mastery');
  const [sortAsc, setSortAsc] = useState(true);

  /** Only materials that actually reach this grade and have concepts to score. */
  const gradeMaterials = useMemo(() => {
    const ids = new Set(
      GRADE_LEVEL_MASTERY.filter((r) => r.grade_level === grade).map((r) => r.material_id)
    );
    return MATERIALS.filter((m) => ids.has(m.id));
  }, [grade]);

  const materialOptions = [
    { label: 'All materials', value: 'all' },
    ...gradeMaterials.map((m) => ({ label: m.title, value: m.id })),
  ];

  const rows = useMemo<RosterRow[]>(() => {
    const scoped = GRADE_LEVEL_MASTERY.filter((r) => r.grade_level === grade);

    const base: RosterRow[] =
      materialFilter === 'all'
        ? collapseByStudent(scoped)
        : scoped
            .filter((r) => r.material_id === materialFilter)
            .map((r) => ({
              student_id: r.student_id,
              first_name: r.first_name,
              last_name: r.last_name,
              grade_level: r.grade_level,
              label: r.material_title,
              subject: r.subject,
              concept_count: r.concept_count,
              assessed_concept_count: r.assessed_concept_count,
              mastery: r.m_doc,
              mastered_concept_count: r.mastered_concept_count,
              last_updated: r.last_updated,
              material_count: 1,
            }));

    const query = search.trim().toLowerCase();
    const filtered = query
      ? base.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(query))
      : base;

    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') {
        return direction * `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
      }
      if (sortKey === 'assessed') {
        return direction * (a.assessed_concept_count - b.assessed_concept_count);
      }
      return direction * (a.mastery - b.mastery);
    });
  }, [grade, materialFilter, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  };

  const SortButton = ({ label, sortBy }: { label: string; sortBy: SortKey }) => (
    <button
      onClick={() => toggleSort(sortBy)}
      className={`flex items-center gap-1 font-sans text-[10px] uppercase tracking-wider font-bold transition-colors ${
        sortKey === sortBy ? 'text-primary-fixed-dim' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30">
              <Users className="text-primary-fixed-dim w-5 h-5" />
            </div>
            <h1 className="font-display text-3xl font-semibold text-on-surface">Students</h1>
          </div>
          <p className="font-sans text-sm text-on-surface-variant max-w-2xl">
            Mastery for every student in the grades you teach, measured against the materials you
            published. You see a grade here once you publish a material to it.
          </p>
        </header>

        {/* Grade tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container/40 border border-white/5 w-fit mb-5">
          {grades.map((g) => (
            <button
              key={g}
              onClick={() => { setGrade(g); setMaterialFilter('all'); }}
              className={`px-5 py-2 rounded-lg font-display text-sm font-semibold transition-all ${
                grade === g
                  ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim border border-primary-fixed-dim/30'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              Grade {g}
            </button>
          ))}
        </div>

        {/* Filters */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students..."
              className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs font-semibold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
            />
          </div>
          <Dropdown
            value={materialFilter}
            onChange={setMaterialFilter}
            options={materialOptions}
            className="w-full sm:w-64"
          />
        </section>

        {/* Table */}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20 px-6 rounded-2xl border-2 border-dashed border-white/10">
            <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="font-display text-lg font-semibold text-white mb-1.5">
              No mastery data for Grade {grade}
            </h3>
            <p className="font-sans text-sm text-slate-400 max-w-sm">
              Scores appear once students study your materials through adaptive flashcards or an
              adaptive test. Those are the only two activities that update mastery.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-5 py-3.5"><SortButton label="Student" sortBy="name" /></th>
                    <th className="text-left px-5 py-3.5 font-sans text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      {materialFilter === 'all' ? 'Coverage' : 'Material'}
                    </th>
                    <th className="text-left px-5 py-3.5"><SortButton label="Assessed" sortBy="assessed" /></th>
                    <th className="text-left px-5 py-3.5 w-56"><SortButton label="Mastery" sortBy="mastery" /></th>
                    <th className="text-left px-5 py-3.5 font-sans text-[10px] uppercase tracking-wider font-bold text-slate-500">
                      Tier
                    </th>
                    <th className="text-left px-5 py-3.5 font-sans text-[10px] uppercase tracking-wider font-bold text-slate-500 hidden lg:table-cell">
                      Last active
                    </th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.student_id}-${r.label}`}
                      onClick={() => navigate(`/educator/students/${r.student_id}`)}
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface-container border border-white/10 flex items-center justify-center shrink-0 font-display text-[11px] font-bold text-slate-300">
                            {r.first_name[0]}{r.last_name[0]}
                          </div>
                          <span className="font-sans text-sm font-semibold text-white whitespace-nowrap group-hover:text-primary-fixed-dim transition-colors">
                            {studentName(r)}
                          </span>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 max-w-[220px]">
                          {r.subject && <SubjectBadge code={r.subject} />}
                          <span className="font-sans text-xs text-slate-400 truncate">{r.label}</span>
                        </div>
                      </td>

                      <td className="px-5 py-4 font-sans text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {r.assessed_concept_count}
                        <span className="text-slate-600"> / {r.concept_count}</span>
                      </td>

                      <td className="px-5 py-4">
                        <MasteryBar mastery={r.mastery} />
                      </td>

                      <td className="px-5 py-4">
                        <TierBadge tier={masteryTier(r.mastery)} />
                      </td>

                      <td className="px-5 py-4 font-sans text-xs text-slate-500 whitespace-nowrap hidden lg:table-cell">
                        {formatRelativeTime(r.last_updated)}
                      </td>

                      <td className="px-3 py-4">
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-primary-fixed-dim group-hover:translate-x-0.5 transition-all" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="font-sans text-xs text-slate-500 mt-4">
          Mastery is the mean BKT probability across a material's concepts. A concept a student has
          never been assessed on counts at the starting probability of 10%, so low coverage pulls the
          average down — check the assessed column before reading a score as a weakness.
        </p>
      </div>
    </main>
  );
}
