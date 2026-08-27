import { useState, useMemo, useEffect, useCallback, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Plus, Search, Trash2, Archive, ArchiveRestore,
  AlertTriangle, Eye, Layers, ClipboardList
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import Dropdown from '../../components/ui/Dropdown';
import SubjectBadge, { SUBJECT_COLOR } from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';
// PRE/POST GATE — temporary research instrument (migration 0024). Delete this
// import, the `assessments` state, the fetch in load(), the pill and its component.
import { assessmentOverview, assessmentState, type AssessmentOverviewRow, type AssessmentState } from '../../lib/assessments';
import UploadMaterialModal from './components/UploadMaterialModal';
import {
  SUBJECTS, ALL_GRADE_LEVELS,
  formatFileSize, formatRelativeTime,
  type EducatorMaterial, type ParsedStatus,
} from '../../data/mockEducator';
import { api } from '../../lib/api';

/** A material row as returned by GET /api/materials — the DB row plus a joined count. */
type MaterialRow = EducatorMaterial & { concept_count: number };

/**
 * `all` plus exactly the four `parsed_status` enum values, labelled with the enum
 * value itself so the filter, the pill and the database column all use one
 * vocabulary. See `ParseStatusPill` for why the student side does not.
 *
 * "Archived" does not belong here — `is_archived` is an orthogonal boolean with
 * its own toggle, and folding it in would make a material's status ambiguous
 * (an archived material still has a real parse status).
 */
const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Any status', value: 'all' },
  { label: 'Completed', value: 'completed' },
  { label: 'Processing', value: 'processing' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
];

/**
 * The focus indicator for this page, matching `EducatorDashboard`.
 *
 * ⚠️ `ring-inset`. The three card actions sit in a `gap-1` cluster — 4px — so an
 * outward `ring-2` plus an offset is 8px of glow bleeding into a 4px gap and
 * over its neighbours. Same reason the dashboard rows use it.
 */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

/**
 * ⚠️ THE CARD ACTIONS ARE ALWAYS AT FULL OPACITY, AND THAT IS THE FIX, NOT A
 * PREFERENCE. They were transparent until the card was hovered, and a touch
 * screen has no hover — so View, Archive and Delete were permanently invisible
 * AND unreachable on a phone or tablet; the focus-within escape hatch beside it
 * only ever rescued a keyboard.
 * Viewing survives, since tapping the card navigates there anyway, but
 * **archiving and deleting a material were not available on mobile at all**,
 * which is a functional loss rather than a cosmetic one. (iOS synthesises a
 * hover on first tap, but that same tap fires the card's own `onClick` and
 * navigates away before anything is revealed.)
 *
 * This mirrors `StudySpacesList` exactly — same `p-2` target, same `gap-1`, same
 * neutral/rose split, same focus rings — where the identical defect was fixed
 * the same way and for the same reason. Keep the two in step.
 *
 * ⚠️ `p-2`, NOT the `p-1.5` this used to use. A 3.5-unit icon in 1.5 units of
 * padding is a 26px target; 30px still misses the 44px finger floor, but these
 * three sit 4px apart and at 26px a mis-tap on Delete instead of Archive is a
 * cascading delete of every concept and every student's mastery for them.
 */
const CARD_ACTION = 'p-2 rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2';
const CARD_ACTION_NEUTRAL = `${CARD_ACTION} bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 focus-visible:ring-[var(--theme-accent)]`;
const CARD_ACTION_DANGER = `${CARD_ACTION} bg-rose-500/5 border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 focus-visible:ring-rose-400`;

export default function MaterialsLibrary() {
  const navigate = useNavigate();

  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  // PRE/POST GATE — temporary. Keyed by material id; empty when the read fails.
  const [assessments, setAssessments] = useState<Map<string, AssessmentOverviewRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MaterialRow | null>(null);

  // ── Data loading ────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<MaterialRow[]>('/materials');
      setMaterials(data);
      // PRE/POST GATE — temporary (migration 0024). Its own read, so removing the
      // feature is deleting these two lines rather than editing /api/materials
      // back. A failure costs the pill and nothing else.
      setAssessments(await assessmentOverview().catch(() => new Map()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load materials.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // While any material is still being processed, poll so the educator watches
  // Pending → Processing → Completed without a manual refresh.
  const hasInFlight = materials.some(
    (m) => m.parsed_status === 'pending' || m.parsed_status === 'processing'
  );
  useEffect(() => {
    if (!hasInFlight) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [hasInFlight, load]);

  // The full catalogue and every JHS grade — neither is restricted per educator.
  const subjectOptions = [
    { label: 'All subjects', value: 'all' },
    ...SUBJECTS.map((s) => ({ label: s.name, value: s.code })),
  ];

  const gradeOptions = [
    { label: 'All grades', value: 'all' },
    ...ALL_GRADE_LEVELS.map((g) => ({ label: `Grade ${g}`, value: String(g) })),
  ];

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return materials
      .filter((m) => (showArchived ? m.is_archived : !m.is_archived))
      .filter((m) => subjectFilter === 'all' || m.subject === subjectFilter)
      .filter((m) => gradeFilter === 'all' || m.grade_levels.includes(Number(gradeFilter)))
      .filter((m) => statusFilter === 'all' || m.parsed_status === (statusFilter as ParsedStatus))
      .filter((m) =>
        !query ||
        m.title.toLowerCase().includes(query) ||
        (m.description ?? '').toLowerCase().includes(query)
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [materials, search, subjectFilter, gradeFilter, statusFilter, showArchived]);

  const archivedCount = materials.filter((m) => m.is_archived).length;

  /**
   * Archive / restore, persisted.
   *
   * This used to be an optimistic local toggle with no endpoint behind it, which
   * the 3s parse poll above would silently revert. It now writes through
   * `PATCH /api/materials/:id` and replaces the row from the response, so the
   * poll and the UI cannot disagree.
   *
   * Archiving hides the material from every student's study space at their next
   * read while keeping its concepts, its `study_space_materials` link rows and
   * every student's BKT mastery — restoring brings all of it back untouched.
   * That is what makes it the safe alternative to Delete, which cascades.
   */
  const [archiving, setArchiving] = useState<string | null>(null);

  const toggleArchive = async (target: MaterialRow) => {
    setArchiving(target.id);
    try {
      const { data } = await api.patch<MaterialRow>(`/materials/${target.id}`, {
        is_archived: !target.is_archived,
      });
      setMaterials((prev) => prev.map((m) => (m.id === data.id ? data : m)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update material.');
    } finally {
      setArchiving(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await api.delete(`/materials/${target.id}`);
      setMaterials((prev) => prev.filter((m) => m.id !== target.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete material.');
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      {/* `sm:` steps on both axes, and `animate-page-fade` — the same entrance the
          educator dashboard now uses. See the note there for why it is not the
          `fade-in` idiom the student pages write. */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              {/* `/10` + `/20`, matching the chip on every card below. It was
                  `/20` + `/30` — a heavier version of the same chip, which made
                  the page title's mark look like a different component. */}
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 shrink-0">
                <FileText className="text-primary-fixed-dim w-5 h-5" />
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-on-surface">Materials</h1>
            </div>
            <p className="font-sans text-sm text-on-surface-variant max-w-2xl">
              PDF learning modules you have published, and the grade levels that can study them.
            </p>
          </div>

          {/* Full-width on a phone (the column's default stretch), hugging its
              label from `md:` where it sits beside the title. */}
          <button
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors shrink-0 active:scale-98 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-primary-fixed"
          >
            <Plus className="w-4 h-4" />
            Upload Material
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 mb-6">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="font-sans text-xs text-rose-300">{error}</p>
          </div>
        )}

        {/* Filters */}
        <section className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search materials..."
              className="w-full bg-surface-container-high border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs font-semibold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
            />
          </div>

          {/*
            ⚠️ THE FOUR CONTROLS WERE FIXED-WIDTH INSIDE A `flex-wrap`, WHICH IS
            WHAT MADE THIS RAGGED ON A PHONE. At 375px the row has 343px to work
            with, and `w-44 + w-36` (176 + 144 + a 12px gap) is 332 — so subject
            and grade landed on one line, status and Archived on a second, each
            leaving a different amount of dead space on the right. Three
            different widths on four sibling filters reads as misalignment
            rather than as a deliberate hierarchy.

            A 2×2 grid at phone width, 4-across from `sm:`, and only at `lg:` —
            where they sit on one line beside the search box — do the original
            content-fitted widths come back.
          */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:items-center gap-2.5 sm:gap-3">
            <Dropdown value={subjectFilter} onChange={setSubjectFilter} options={subjectOptions} className="w-full lg:w-44" />
            <Dropdown value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} className="w-full lg:w-36" />
            <Dropdown value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} className="w-full lg:w-36" />

            <button
              onClick={() => setShowArchived(!showArchived)}
              aria-pressed={showArchived}
              className={`flex items-center justify-center lg:justify-start gap-2 w-full lg:w-auto px-4 py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] ${
                showArchived
                  ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30 text-primary-fixed-dim'
                  : 'bg-surface-container-high border-white/10 text-slate-300 hover:bg-surface-container-highest'
              }`}
            >
              <Archive className="w-3.5 h-3.5 shrink-0" />
              Archived
              {archivedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] tabular-nums">
                  {archivedCount}
                </span>
              )}
            </button>
          </div>
        </section>

        {/* Grid */}
        {loading ? (
          <div className="flex flex-col items-center text-center py-20">
            <Spinner className="w-6 h-6 text-primary-fixed-dim mb-3" />
            <p className="font-sans text-sm text-slate-400">Loading your materials…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20 px-6 rounded-2xl border-2 border-dashed border-white/10 animate-tab-in">
            <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <Layers className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="font-display text-lg font-semibold text-white mb-1.5">
              {showArchived
                ? 'Nothing archived'
                : materials.length === 0
                  ? 'No materials yet'
                  : 'No materials match these filters'}
            </h3>
            <p className="font-sans text-sm text-slate-400 max-w-sm">
              {showArchived
                ? 'Archived materials stay out of students’ study spaces but keep their extracted concepts.'
                : materials.length === 0
                  ? 'Upload a PDF learning module to get started — the system will extract its key terms and definitions for you.'
                  : 'Try clearing a filter, or upload a new PDF learning module.'}
            </p>
          </div>
        ) : (
          /* Keyed on the archived toggle so the fade re-fires when the list is
             swapped for a different one. A CSS animation runs once on mount, so
             without a `key` React reuses the nodes and the class does nothing
             after the first render — the same reason the dashboard keys its
             three views. It is deliberately NOT keyed on `search`, which would
             re-animate the whole grid on every keystroke. */
          <div key={showArchived ? 'archived' : 'live'} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 animate-tab-in">
            {visible.map((m) => {
              const concepts = m.concept_count;
              /* The card's mark takes its SUBJECT's colour rather than the one
                 app accent every card used to share. `SubjectBadge` already
                 owns this mapping and is rendered three lines down, so the tint
                 and the badge cannot drift; it just moves the cue to the
                 largest element on the card, which is what makes a grid of a
                 dozen lessons scannable by subject at a glance. */
              const tint = SUBJECT_COLOR[m.subject] ?? '#94a3b8';

              return (
                /*
                  ⚠️ THE CARD IS NO LONGER A BARE `<article onClick>`. That gave
                  it no Tab stop, no key handler and no focus ring — the entire
                  grid was invisible to a keyboard, and to anything driving the
                  page through the accessibility tree.

                  The fix is `StudySpacesList`'s pattern, not `tabIndex` on the
                  article: the TITLE is a real button whose `::after` is
                  stretched over the whole card. A mouse keeps the full surface
                  clickable, a keyboard gets exactly ONE stop for "open this
                  material" instead of a stop on a div that announces nothing,
                  and the browser supplies Enter/Space for free — a hand-rolled
                  `onKeyDown` on a div gets Space wrong (it scrolls) about as
                  often as it gets it right.

                  ⚠️ THE ACTION CLUSTER NEEDS `relative z-10`. The stretched
                  `::after` is painted after the buttons in DOM order, so
                  without it the overlay swallows all three clicks and every tap
                  on Delete would silently open the material instead. This is
                  also why `e.stopPropagation()` is gone from the three
                  handlers: there is no ancestor click handler left to stop, and
                  leaving it would imply one exists.
                */
                <article
                  key={m.id}
                  className="group relative flex flex-col rounded-2xl bg-white/[0.02] border border-white/5 p-5 cursor-pointer shadow-lg shadow-black/20 hover:bg-white/[0.04] hover:border-white/10 hover:-translate-y-0.5 hover:shadow-xl focus-within:border-white/10 focus-within:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div
                      className="tone-chip w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
                      style={{ '--tone': tint } as CSSProperties}
                    >
                      <FileText className="w-5 h-5" />
                    </div>

                    <div className="relative z-10 flex items-center gap-1">
                      <button
                        onClick={() => navigate(`/educator/materials/${m.id}`)}
                        title={`View ${m.title}`}
                        aria-label={`View ${m.title}`}
                        className={CARD_ACTION_NEUTRAL}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => void toggleArchive(m)}
                        disabled={archiving === m.id}
                        title={
                          m.is_archived
                            ? 'Restore — students can study this again'
                            : 'Archive — hides it from students, keeps concepts and progress'
                        }
                        aria-label={m.is_archived ? `Restore ${m.title}` : `Archive ${m.title}`}
                        className={`${CARD_ACTION_NEUTRAL} disabled:opacity-50`}
                      >
                        {archiving === m.id
                          ? <Spinner className="w-3.5 h-3.5" />
                          : m.is_archived
                            ? <ArchiveRestore className="w-3.5 h-3.5" />
                            : <Archive className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => setPendingDelete(m)}
                        title={`Delete ${m.title}`}
                        aria-label={`Delete ${m.title}`}
                        className={CARD_ACTION_DANGER}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <h2 className="font-display text-base font-semibold text-white mb-1.5 leading-snug group-hover:text-primary-fixed-dim transition-colors">
                    <button
                      onClick={() => navigate(`/educator/materials/${m.id}`)}
                      className="text-left rounded after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="line-clamp-2">{m.title}</span>
                    </button>
                  </h2>

                  {m.description && (
                    <p className="font-sans text-xs text-slate-400 line-clamp-2 mb-3.5">
                      {m.description}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 mb-3.5">
                    <SubjectBadge code={m.subject} />
                    <GradeChips grades={m.grade_levels} />
                    <ParseStatusPill status={m.parsed_status} />
                    {/* PRE/POST GATE — temporary. */}
                    <AssessmentPill state={assessmentState(assessments.get(m.id))} />
                    {m.is_archived && (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider">
                        Archived
                      </span>
                    )}
                  </div>

                  {m.parsed_status === 'failed' && m.parse_error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 mb-3.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <p className="font-sans text-[11px] text-rose-300 leading-relaxed">{m.parse_error}</p>
                    </div>
                  )}

                  <div className="mt-auto pt-3 border-t border-white/5 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[11px] text-slate-500">
                    <span>{concepts} concept{concepts === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>{m.page_count ?? '—'} pages</span>
                    <span>·</span>
                    <span>{formatFileSize(m.file_size_bytes)}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(m.created_at)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <UploadMaterialModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={() => void load()}
      />

      {/* Delete confirmation */}
      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete Material"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner">
            <Trash2 className="w-5 h-5" />
          </div>

          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            Delete <span className="font-semibold text-white">"{pendingDelete?.title}"</span>?
            Its extracted concepts and every student's mastery record for them are removed too.
            Archive it instead if you only want to hide it from students.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-[#ffffff] font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

/**
 * PRE/POST GATE — temporary (migration 0024).
 *
 * Answers "which lessons still need a test?" at a glance, which is the whole point
 * of the rule that every uploaded material should have one. Copies
 * `ParseStatusPill`'s shape rather than extending it: that component's label rule
 * is "the label IS the enum value, title-cased", and these states are not an enum.
 *
 * `none` renders NOTHING. A grey "no test" chip on every material an educator has
 * not got to yet reads as a wall of errors.
 */
function AssessmentPill({ state }: { state: AssessmentState }) {
  if (state === 'none') return null;

  const style = {
    ready: { label: 'Test ready', color: '#94a3b8', hint: 'Questions written, not yet open to students' },
    pre_open: { label: 'Pre-test open', color: '#22d3ee', hint: 'Students must take the pre-test before they can study this lesson' },
    post_open: { label: 'Post-test open', color: '#a78bfa', hint: 'Students must take the post-test to keep using this lesson' },
  }[state];

  /* `.tone-chip` + `--tone`, matching `ParseStatusPill` beside it — see the
     TINTED CHIPS block in `index.css`. This one had the two worst values in the
     set on white: pre-test cyan at ~1.9:1 and post-test violet at ~2.9:1. */
  return (
    <span
      title={style.hint}
      className="tone-chip inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ '--tone': style.color } as CSSProperties}
    >
      <ClipboardList className="w-3 h-3 shrink-0" />
      {style.label}
    </span>
  );
}
