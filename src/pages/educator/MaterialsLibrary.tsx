import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Plus, Search, Trash2, Archive, ArchiveRestore,
  AlertTriangle, Eye, Layers, Loader2,
} from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Dropdown from '../../components/ui/Dropdown';
import SubjectBadge from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';
import UploadMaterialModal from './components/UploadMaterialModal';
import {
  SUBJECTS, ALL_GRADE_LEVELS,
  formatFileSize, formatRelativeTime,
  type EducatorMaterial, type ParsedStatus,
} from '../../data/mockEducator';
import { api } from '../../lib/api';

/** A material row as returned by GET /api/materials — the DB row plus a joined count. */
type MaterialRow = EducatorMaterial & { concept_count: number };

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Any status', value: 'all' },
  { label: 'Ready', value: 'completed' },
  { label: 'Processing', value: 'processing' },
  { label: 'Queued', value: 'pending' },
  { label: 'Failed', value: 'failed' },
];

export default function MaterialsLibrary() {
  const navigate = useNavigate();

  const [materials, setMaterials] = useState<MaterialRow[]>([]);
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

  // Archive is presentation-only for now (there is no archive endpoint yet, and it
  // is outside this task's scope). A poll refetch while a material is processing
  // will reset an optimistic toggle.
  const toggleArchive = (id: string) => {
    setMaterials((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, is_archived: !m.is_archived, updated_at: new Date().toISOString() } : m
      )
    );
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
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30">
                <FileText className="text-primary-fixed-dim w-5 h-5" />
              </div>
              <h1 className="font-display text-3xl font-semibold text-on-surface">Materials</h1>
            </div>
            <p className="font-sans text-sm text-on-surface-variant max-w-2xl">
              PDF learning modules you have published, and the grade levels that can study them.
            </p>
          </div>

          <button
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors shrink-0 active:scale-98"
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
              className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white text-xs font-semibold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Dropdown value={subjectFilter} onChange={setSubjectFilter} options={subjectOptions} className="w-44" />
            <Dropdown value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} className="w-36" />
            <Dropdown value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} className="w-36" />

            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all ${
                showArchived
                  ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30 text-primary-fixed-dim'
                  : 'bg-surface-container/60 border-white/10 text-slate-300 hover:bg-surface-container/85'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
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
            <Loader2 className="w-6 h-6 text-primary-fixed-dim animate-spin mb-3" />
            <p className="font-sans text-sm text-slate-400">Loading your materials…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20 px-6 rounded-2xl border-2 border-dashed border-white/10">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map((m) => {
              const concepts = m.concept_count;

              return (
                <article
                  key={m.id}
                  onClick={() => navigate(`/educator/materials/${m.id}`)}
                  className="group flex flex-col rounded-2xl bg-white/[0.02] border border-white/5 p-5 cursor-pointer hover:bg-white/[0.04] hover:border-white/10 hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-primary-fixed-dim" />
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/educator/materials/${m.id}`); }}
                        title="View material"
                        className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleArchive(m.id); }}
                        title={m.is_archived ? 'Restore material' : 'Archive material'}
                        className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                      >
                        {m.is_archived
                          ? <ArchiveRestore className="w-3.5 h-3.5" />
                          : <Archive className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(m); }}
                        title="Delete material"
                        className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <h2 className="font-display text-base font-semibold text-white mb-1.5 leading-snug group-hover:text-primary-fixed-dim transition-colors">
                    {m.title}
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
