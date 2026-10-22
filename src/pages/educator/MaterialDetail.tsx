import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, FileText, Search, Archive, ArchiveRestore, Trash2,
  AlertTriangle, BookOpen, Pencil, Check, X, Plus, ExternalLink
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import Dropdown from '../../components/ui/Dropdown';
import SubjectBadge, { SUBJECT_COLOR } from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';
import ClassPerformance from './components/ClassPerformance';
import OcrTranscriptPanel from './components/OcrTranscriptPanel';
import {
  ALL_GRADE_LEVELS,
  formatFileSize, formatDate,
  type EducatorMaterial,
} from '../../data/mockEducator';
import { useSubjectName, useSubjects } from '../../context/SubjectsContext';
import { api } from '../../lib/api';

type MaterialRow = EducatorMaterial & { concept_count: number };

interface ConceptRow {
  id: string;
  term: string;
  definition: string;
  parent_concept_id: string | null;
  source_pages: number[] | null;
  created_at: string;
}

type Tab = 'concepts' | 'performance';
type Draft = { term: string; definition: string; pages: string };
const EMPTY_DRAFT: Draft = { term: '', definition: '', pages: '' };

/**
 * Focus ring, matching EducatorDashboard and MaterialsLibrary. ring-inset because concept rows and
 * their actions sit only gap-2/gap-1 apart, so an outward ring would bleed into neighbours.
 */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

/** Renders source pages as "p. 3" or "pp. 3–5" for the traceability badge. */
function formatPages(pages: number[] | null): string | null {
  if (!pages || pages.length === 0) return null;
  const sorted = [...pages].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return min === max ? `p. ${min}` : `pp. ${min}–${max}`;
}

/** Parses a "3, 4" style page field into a sorted unique number[] (empty → null). */
function parsePages(input: string): number[] | null {
  const nums = input
    .split(/[\s,]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length === 0) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

const pagesToInput = (pages: number[] | null): string => (pages ?? []).join(', ');

export default function MaterialDetail() {
  const subjectNameOf = useSubjectName();
  const { subjects } = useSubjects();
  const { materialId } = useParams<{ materialId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [material, setMaterial] = useState<MaterialRow | null>(null);
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /* Drafts being edited; `material` holds the saved row. gradeDraft only matters while isEditingGrades. */
  const [gradeDraft, setGradeDraft] = useState<string>('');
  const [isEditingGrades, setIsEditingGrades] = useState(false);
  // Title and subject follow the same draft-vs-saved-truth split as grade access.
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState('');
  const [isEditingSubject, setIsEditingSubject] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  /* Separate from actionError, which renders inside the Concepts tab and would hide errors from the other tab. */
  const [metaError, setMetaError] = useState<string | null>(null);
  const [conceptSearch, setConceptSearch] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  /* Seeded once from ?tab= (dashboard links use ?tab=performance); the tab bar owns it after mount. */
  const [activeTab, setActiveTab] = useState<Tab>(
    searchParams.get('tab') === 'performance' ? 'performance' : 'concepts'
  );

  // Concept editing state
  const [addingNew, setAddingNew] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // PDF viewer in new tab
  const [openingPdf, setOpeningPdf] = useState(false);

  // Load material + concepts
  const load = useCallback(async () => {
    if (!materialId) return;
    try {
      const [{ data: mat }, { data: cons }] = await Promise.all([
        api.get<MaterialRow>(`/materials/${materialId}`),
        api.get<ConceptRow[]>(`/materials/${materialId}/concepts`),
      ]);
      setMaterial(mat);
      setConcepts(cons);
      setNotFound(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => { void load(); }, [load]);

  // Don't let the background poll replace `material` mid-edit (concepts or grade).
  const busyRef = useRef(false);
  busyRef.current =
    addingNew || editingId !== null || saving || isEditingGrades || isEditingTitle ||
    isEditingSubject || savingMeta;

  /** The one writer for archive, grade, title and subject. Replaces the whole row from the response. */
  const patchMaterial = useCallback(
    async (body: { is_archived?: boolean; grade_levels?: number[]; title?: string; subject?: string }) => {
      if (!materialId) return false;
      setSavingMeta(true);
      setMetaError(null);
      try {
        const { data } = await api.patch<MaterialRow>(`/materials/${materialId}`, body);
        setMaterial(data);
        return true;
      } catch (e) {
        setMetaError(e instanceof Error ? e.message : 'Could not save that change.');
        return false;
      } finally {
        setSavingMeta(false);
      }
    },
    [materialId]
  );

  const saveGrade = async () => {
    const next = Number(gradeDraft);
    if (!Number.isInteger(next)) return;
    // No-op edits shouldn't cost a request or bump updated_at.
    if (material && material.grade_levels[0] === next) {
      setIsEditingGrades(false);
      return;
    }
    if (await patchMaterial({ grade_levels: [next] })) setIsEditingGrades(false);
  };

  const saveTitle = async () => {
    const next = titleDraft.trim();
    if (!next) {
      setMetaError('A material needs a title.');
      return;
    }
    if (material && material.title === next) {
      setIsEditingTitle(false);
      return;
    }
    if (await patchMaterial({ title: next })) setIsEditingTitle(false);
  };

  const saveSubject = async () => {
    if (!subjectDraft) return;
    if (material && material.subject === subjectDraft) {
      setIsEditingSubject(false);
      return;
    }
    if (await patchMaterial({ subject: subjectDraft })) setIsEditingSubject(false);
  };

  // Poll while extraction is still running so concepts + status appear on their own.
  const inFlight = material?.parsed_status === 'pending' || material?.parsed_status === 'processing';
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => { if (!busyRef.current) void load(); }, 3000);
    return () => clearInterval(id);
  }, [inFlight, load]);

  const filteredConcepts = concepts.filter((c) => {
    const q = conceptSearch.trim().toLowerCase();
    return !q || c.term.toLowerCase().includes(q) || c.definition.toLowerCase().includes(q);
  });

  const gradeValues = material?.grade_levels ?? [];
  const isArchived = material?.is_archived ?? false;

  const canEdit = material?.parsed_status === 'completed' || material?.parsed_status === 'failed';

  const bumpCount = (delta: number) =>
    setMaterial((m) => (m ? { ...m, concept_count: Math.max(0, m.concept_count + delta) } : m));

  // Concept CRUD handlers
  const addConcept = async () => {
    if (!material) return;
    if (!addDraft.term.trim() || !addDraft.definition.trim()) {
      setActionError('A concept needs both a term and a definition.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const { data } = await api.post<ConceptRow>(`/materials/${material.id}/concepts`, {
        term: addDraft.term.trim(),
        definition: addDraft.definition.trim(),
        source_pages: parsePages(addDraft.pages),
      });
      setConcepts((prev) => [...prev, data]);
      bumpCount(1);
      setAddDraft(EMPTY_DRAFT);
      setAddingNew(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not add the concept.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c: ConceptRow) => {
    setDeletingId(null);
    setEditingId(c.id);
    setEditDraft({ term: c.term, definition: c.definition, pages: pagesToInput(c.source_pages) });
    setActionError(null);
  };

  const saveEdit = async () => {
    if (!material || !editingId) return;
    if (!editDraft.term.trim() || !editDraft.definition.trim()) {
      setActionError('A concept needs both a term and a definition.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const { data } = await api.put<ConceptRow>(
        `/materials/${material.id}/concepts/${editingId}`,
        {
          term: editDraft.term.trim(),
          definition: editDraft.definition.trim(),
          source_pages: parsePages(editDraft.pages),
        }
      );
      setConcepts((prev) => prev.map((c) => (c.id === data.id ? data : c)));
      setEditingId(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the concept.');
    } finally {
      setSaving(false);
    }
  };

  const deleteConcept = async (id: string) => {
    if (!material) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.delete(`/materials/${material.id}/concepts/${id}`);
      setConcepts((prev) => prev.filter((c) => c.id !== id));
      bumpCount(-1);
      setDeletingId(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete the concept.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteMaterial = async () => {
    if (!material) return;
    try {
      await api.delete(`/materials/${material.id}`);
      navigate('/educator/materials');
    } catch {
      setShowDelete(false);
    }
  };

  const openPdfInNewTab = async () => {
    if (!material) return;
    setOpeningPdf(true);
    try {
      const { data } = await api.get<{ url: string }>(`/materials/${material.id}/view`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('Could not open the document.');
    } finally {
      setOpeningPdf(false);
    }
  };

  if (loading) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-background px-6">
        <Spinner className="w-6 h-6 text-primary-fixed-dim mb-3" />
        <p className="font-sans text-sm text-slate-400">Loading material…</p>
      </main>
    );
  }

  if (notFound || !material) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-background px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-4">
          <FileText className="w-6 h-6 text-slate-400" />
        </div>
        <h1 className="font-display text-xl font-semibold text-white mb-2">Material not found</h1>
        <p className="font-sans text-sm text-slate-400 mb-6">
          It may have been deleted, or you may not have access to it.
        </p>
        <Link
          to="/educator/materials"
          className="px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors"
        >
          Back to Materials
        </Link>
      </main>
    );
  }

  const tint = SUBJECT_COLOR[material.subject] ?? '#94a3b8';

  const facts: Array<[string, string]> = [
    // No Subject here: it has its own editable row, and a read-only copy would read as uneditable.
    ['Pages', material.page_count ? String(material.page_count) : '—'],
    ['Size', formatFileSize(material.file_size_bytes)],
    // Photos become a PDF at upload, so scans and photos are one case: both were read with OCR.
    ['Type', material.is_scanned ? 'Scanned / photographed (OCR)' : 'Text PDF'],
    ['Uploaded', formatDate(material.created_at)],
    ['Concepts', String(material.concept_count)],
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      {/* Same page entrance as the rest of the educator portal. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 animate-page-fade">

        {/* Back */}
        <button
          onClick={() => navigate('/educator/materials')}
          className={`flex items-center gap-2 font-sans text-xs text-slate-400 hover:text-white transition-colors mb-6 group rounded ${FOCUS}`}
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Materials
        </button>

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-6">
          {/* Subject-tinted mark, from the same SUBJECT_COLOR map as SubjectBadge. */}
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className="tone-chip w-11 h-11 rounded-xl border flex items-center justify-center shrink-0"
              style={{ '--tone': tint } as CSSProperties}
            >
              <FileText className="w-5 h-5" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2.5">
                <SubjectBadge code={material.subject} full />
                <GradeChips grades={gradeValues} />
                <ParseStatusPill status={material.parsed_status} />
                {isArchived && (
                  <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider">
                    Archived
                  </span>
                )}
              </div>
              {isEditingTitle ? (
                <form
                  className="flex flex-col sm:flex-row sm:items-center gap-2"
                  onSubmit={(e) => { e.preventDefault(); void saveTitle(); }}
                >
                  <input
                    autoFocus
                    aria-label="Material title"
                    value={titleDraft}
                    maxLength={200}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setIsEditingTitle(false); }}
                    className="w-full sm:w-80 px-3 py-2 rounded-lg bg-surface-container border border-white/10 font-display text-lg font-semibold text-on-surface focus:outline-none focus:border-primary-fixed-dim/50"
                  />
                  <div className="flex items-center gap-3 shrink-0 animate-swap-in">
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(false)}
                      disabled={savingMeta}
                      className={`font-sans text-xs text-slate-400 font-semibold hover:text-slate-200 transition-colors disabled:opacity-50 rounded px-1 ${FOCUS}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingMeta || !titleDraft.trim()}
                      className={`flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity disabled:opacity-50 rounded px-1 ${FOCUS}`}
                    >
                      {savingMeta ? <Spinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <h1 className="font-display text-2xl md:text-3xl font-semibold text-on-surface leading-tight break-words min-w-0">
                    {material.title}
                  </h1>
                  <button
                    onClick={() => {
                      setTitleDraft(material.title);
                      setMetaError(null);
                      setIsEditingTitle(true);
                    }}
                    title="Rename"
                    aria-label="Rename material"
                    className={`mt-1.5 p-1.5 rounded-lg text-slate-500 hover:text-primary-fixed-dim hover:bg-white/5 transition-colors shrink-0 ${FOCUS}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {material.description && (
                <p className="font-sans text-sm text-on-surface-variant mt-2 max-w-2xl">
                  {material.description}
                </p>
              )}
            </div>
          </div>

          {/* flex-wrap, and shrink-0 only from sm: — the three buttons are wider than a 320px phone, and the overflow scrolled the whole page sideways. */}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <button
              onClick={openPdfInNewTab}
              disabled={openingPdf}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-xs font-semibold hover:bg-primary-fixed-dim/20 transition-all disabled:opacity-50 whitespace-nowrap ${FOCUS}`}
            >
              {openingPdf
                ? <Spinner className="w-3.5 h-3.5" />
                : <ExternalLink className="w-3.5 h-3.5" />}
              View PDF
            </button>
            <button
              onClick={() => void patchMaterial({ is_archived: !isArchived })}
              disabled={savingMeta}
              title={
                isArchived
                  ? 'Make this available to students again'
                  : 'Hide from students’ study spaces. Concepts and mastery are kept.'
              }
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-high border border-white/10 text-slate-300 font-sans text-xs font-semibold hover:bg-surface-container-highest hover:text-white transition-all disabled:opacity-50 whitespace-nowrap ${FOCUS}`}
            >
              {savingMeta
                ? <Spinner className="w-3.5 h-3.5" />
                : isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {isArchived ? 'Restore' : 'Archive'}
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-400 font-sans text-xs font-semibold hover:bg-rose-500/10 transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-400`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </header>

        {material.parsed_status === 'failed' && material.parse_error && (
          <div className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 mb-6">
            <AlertTriangle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-sans text-sm font-semibold text-rose-300 mb-1">
                {material.is_scanned ? 'The pages could not be read' : 'Concept extraction failed'}
              </p>
              <p className="font-sans text-xs text-rose-300/80 leading-relaxed">{material.parse_error}</p>
              {canEdit && (
                <p className="font-sans text-xs text-rose-300/60 mt-1.5">
                  You can still add concepts by hand below.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Facts and grade access share one panel, split by a hairline (read-only above, editable below). */}
        <section className="rounded-xl bg-white/[0.02] border border-white/5 mb-8 divide-y divide-white/5">
          {/* Wraps into rows on a phone; the separator is hidden on the first item. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-sans text-xs px-4 py-3">
            {facts.map(([label, value], i) => (
              <span key={label} className="flex items-center gap-3">
                {i > 0 && <span className="text-slate-600" aria-hidden="true">·</span>}
                <span>
                  <span className="text-slate-500">{label} </span>
                  <span className="text-slate-200 font-medium">{value}</span>
                </span>
              </span>
            ))}
          </div>

          {/* Subject. Reads filter live on (subject, grade), so changing it moves the material between spaces without deleting anything. Edit waits for the catalogue: Dropdown shows its first option for an unknown value. */}
          <div className="flex flex-col gap-2.5 py-3.5 px-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="font-sans text-xs font-semibold text-slate-300 shrink-0 sm:w-24">Subject</span>
            <div className="flex-1 min-w-0">
              {isEditingSubject ? (
                <Dropdown
                  value={subjectDraft}
                  onChange={setSubjectDraft}
                  options={subjects.map((sub) => ({ value: sub.code, label: sub.name }))}
                  className="w-full sm:w-56"
                />
              ) : (
                <span className="font-sans text-sm text-slate-200">{subjectNameOf(material.subject)}</span>
              )}
            </div>

            {isEditingSubject ? (
              <div className="flex items-center gap-3 shrink-0 animate-swap-in">
                <button
                  onClick={() => setIsEditingSubject(false)}
                  disabled={savingMeta}
                  className={`font-sans text-xs text-slate-400 font-semibold hover:text-slate-200 transition-colors disabled:opacity-50 rounded px-1 ${FOCUS}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveSubject()}
                  disabled={savingMeta}
                  className={`flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity disabled:opacity-50 rounded px-1 ${FOCUS}`}
                >
                  {savingMeta ? <Spinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setSubjectDraft(material.subject);
                  setMetaError(null);
                  setIsEditingSubject(true);
                }}
                disabled={subjects.length === 0}
                className={`flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0 self-start sm:self-auto rounded px-1 ${FOCUS}`}
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>

          {isEditingSubject && (
            <p className="font-sans text-[11px] text-slate-500 leading-relaxed animate-swap-in">
              Students will stop seeing this material in their {subjectNameOf(material.subject)} study
              spaces, and it will be offered as a new material in their spaces for the new subject.
              Nothing is deleted — their decks and progress are kept and return if you change the
              subject back.
            </p>
          )}
          </div>

          {/* Grade access: one grade per material (materials_grade_levels_valid) */}
          <div className="flex flex-col gap-2.5 py-3.5 px-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="font-sans text-xs font-semibold text-slate-300 shrink-0 sm:w-24">Grade access</span>
            {/* Only the editing states animate; the resting chips and Edit button don't. Dropdown takes no key, but it's a different element type from the chips, so React remounts it anyway. */}
            <div className="flex-1 min-w-0">
              {/* No animate-swap-in/animate-tab-in here: a transform or opacity creates a stacking context that traps the menu's z-index, so later content paints over the open menu. Never put either class on an element containing a dropdown, popover or tooltip. */}
              {isEditingGrades ? (
                <Dropdown
                  value={gradeDraft}
                  onChange={setGradeDraft}
                  options={ALL_GRADE_LEVELS.map((g) => ({ value: String(g), label: `Grade ${g}` }))}
                  className="w-full sm:w-44"
                />
              ) : (
                <GradeChips grades={gradeValues} />
              )}
            </div>

            {isEditingGrades ? (
              <div className="flex items-center gap-3 shrink-0 animate-swap-in">
                <button
                  onClick={() => setIsEditingGrades(false)}
                  disabled={savingMeta}
                  className={`font-sans text-xs text-slate-400 font-semibold hover:text-slate-200 transition-colors disabled:opacity-50 rounded px-1 ${FOCUS}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveGrade()}
                  disabled={savingMeta}
                  className={`flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity disabled:opacity-50 rounded px-1 ${FOCUS}`}
                >
                  {savingMeta ? <Spinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setGradeDraft(String(gradeValues[0] ?? ALL_GRADE_LEVELS[0]));
                  setMetaError(null);
                  setIsEditingGrades(true);
                }}
                className={`flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity shrink-0 self-start sm:self-auto rounded px-1 ${FOCUS}`}
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>

          {/* Warn before saving. Changing grade is reversible (link rows and mastery survive), but current students lose access. */}
          {isEditingGrades && (
            <p className="font-sans text-[11px] text-slate-500 leading-relaxed animate-swap-in">
              Students in the current grade will stop seeing this material, and students in the new
              grade will find it in their study spaces. Nothing is deleted — their existing progress
              is kept and returns if you change the grade back.
            </p>
          )}
          </div>

          {metaError && (
            <div className="flex items-center gap-2 px-4 py-3" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <p className="font-sans text-xs text-rose-300">{metaError}</p>
            </div>
          )}
        </section>

        {/* Scanned/photographed materials: the OCR transcript. Shown once processing ends either way; after a failed extraction it tells a blurry page from a model problem. */}
        {material.is_scanned && canEdit && materialId && (
          <OcrTranscriptPanel materialId={materialId} focusClass={FOCUS} />
        )}

        {/* Short labels below sm: so the tab bar fits a 320px phone. */}
        <div className="flex items-center gap-4 sm:gap-6 border-b border-white/5 mb-6">
          {(
            [
              ['concepts', 'Concepts', 'Concepts'],
              ['performance', 'Performance', 'Class Performance'],
            ] as const
          ).map(([id, shortLabel, longLabel]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-pressed={activeTab === id}
              className={`relative pb-3 font-sans text-sm font-semibold transition-colors whitespace-nowrap rounded-t ${FOCUS} ${
                activeTab === id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">{shortLabel}</span>
              <span className="hidden sm:inline">{longLabel}</span>
              {activeTab === id && (
                <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-primary-fixed-dim" />
              )}
            </button>
          ))}
        </div>

        {/* Keyed on the tab so the fade re-runs on every switch. All state lives in the parent, so remounting loses nothing. */}
        <div key={activeTab} className="animate-tab-in">

        {/* Concepts tab */}
        {activeTab === 'concepts' && (
          <section>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-slate-400" />
                <h2 className="font-display text-lg font-bold text-white">Concepts</h2>
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-sans text-[10px] font-bold text-slate-400 tabular-nums">
                  {concepts.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* flex-1 below sm:, where a fixed width left dead space. */}
                {concepts.length > 0 && (
                  <div className="relative flex-1 min-w-0 sm:flex-none sm:w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                    <input
                      type="search"
                      value={conceptSearch}
                      onChange={(e) => setConceptSearch(e.target.value)}
                      placeholder="Search concepts..."
                      aria-label="Search concepts"
                      className="w-full bg-surface-container-high border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white text-xs font-medium placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
                    />
                  </div>
                )}
                {canEdit && !addingNew && (
                  <button
                    onClick={() => { setAddingNew(true); setAddDraft(EMPTY_DRAFT); setActionError(null); }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-xs font-bold hover:bg-primary-fixed transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-primary-fixed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add concept
                  </button>
                )}
              </div>
            </div>

            {actionError && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 mb-4">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="font-sans text-xs text-rose-300">{actionError}</p>
              </div>
            )}

            {/* Add form */}
            {addingNew && (
              <div className="rounded-xl bg-primary-fixed-dim/[0.04] border border-primary-fixed-dim/20 p-4 mb-3">
                <ConceptForm
                  draft={addDraft}
                  onChange={setAddDraft}
                  onSave={addConcept}
                  onCancel={() => { setAddingNew(false); setAddDraft(EMPTY_DRAFT); setActionError(null); }}
                  saving={saving}
                  saveLabel="Add"
                />
              </div>
            )}

            {/* List / states */}
            {concepts.length === 0 && !addingNew ? (
              <div className="py-6">
                {material.parsed_status === 'pending' || material.parsed_status === 'processing' ? (
                  <div className="flex items-center gap-2.5 text-slate-400">
                    <Spinner className="w-4 h-4 text-primary-fixed-dim" />
                    <p className="font-sans text-sm">Extracting concepts… this updates automatically.</p>
                  </div>
                ) : (
                  <p className="font-sans text-sm text-slate-400">
                    No concepts yet.{canEdit ? ' Use “Add concept” to create one by hand.' : ''}
                  </p>
                )}
              </div>
            ) : filteredConcepts.length === 0 ? (
              <p className="font-sans text-sm text-slate-400 py-6">No concept matches "{conceptSearch}".</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {filteredConcepts.map((c, i) => {
                  const pages = formatPages(c.source_pages);
                  const isEditing = editingId === c.id;
                  const isDeleting = deletingId === c.id;

                  return (
                    <li
                      key={c.id}
                      className="rounded-xl bg-white/[0.02] border border-white/5 p-3.5 transition-colors hover:border-white/10"
                    >
                      {isEditing ? (
                        <ConceptForm
                          draft={editDraft}
                          onChange={setEditDraft}
                          onSave={saveEdit}
                          onCancel={() => { setEditingId(null); setActionError(null); }}
                          saving={saving}
                          saveLabel="Save"
                        />
                      ) : (
                        <div className="flex gap-3.5">
                          {/* slate-500: slate-600 was under 3:1 contrast at 11px. */}
                          <span className="font-sans text-[11px] font-bold text-slate-500 tabular-nums pt-0.5 w-5 shrink-0">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-sans text-sm font-semibold text-white">{c.term}</p>
                              {pages && (
                                <span
                                  title="Where this concept was found in the document"
                                  className="px-1.5 py-0.5 rounded bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-[10px] font-bold tabular-nums"
                                >
                                  {pages}
                                </span>
                              )}
                            </div>
                            <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                              {c.definition}
                            </p>

                            {/* The destructive confirmation gets the same entrance as the editor. */}
                            {isDeleting && (
                              <div className="flex items-center gap-2 mt-2.5 animate-swap-in">
                                <span className="font-sans text-xs text-rose-300">Delete this concept?</span>
                                <button
                                  onClick={() => deleteConcept(c.id)}
                                  disabled={saving}
                                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-[#ffffff] font-sans text-[11px] font-bold transition-colors disabled:opacity-50"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => setDeletingId(null)}
                                  disabled={saving}
                                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-sans text-[11px] font-bold hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>

                          {/* p-2 for a usable tap target (the two buttons sit 4px apart). Both name their term for screen readers. Chrome-less to keep a long list quiet. */}
                          {canEdit && !isDeleting && (
                            <div className="flex items-start gap-1 shrink-0">
                              <button
                                onClick={() => startEdit(c)}
                                title="Edit concept"
                                aria-label={`Edit ${c.term}`}
                                className={`p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors ${FOCUS}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setDeletingId(c.id); }}
                                title="Delete concept"
                                aria-label={`Delete ${c.term}`}
                                className="p-2 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}

        {/* Class Performance tab. Mounted only while active, so it fetches fresh on entry. Not tied to the parse poll. */}
        {activeTab === 'performance' && materialId && (
          <ClassPerformance materialId={materialId} />
        )}
        </div>
      </div>

      {/* Delete material confirmation */}
      <Modal
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        title="Delete Material"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner">
            <Trash2 className="w-5 h-5" />
          </div>

          <p className="font-sans text-xs text-slate-400 leading-relaxed">
            Delete <span className="font-semibold text-white">"{material.title}"</span>?
            Its {concepts.length} concept{concepts.length === 1 ? '' : 's'} and every
            student's mastery record for them are removed too.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteMaterial}
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

/** Inline term/definition/pages editor, shared by the add card and per-row edit. */
function ConceptForm({
  draft, onChange, onSave, onCancel, saving, saveLabel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  /* animate-swap-in on the form root covers both places it appears (the Add card and an inline row edit). */
  return (
    <div className="flex flex-col gap-3 animate-swap-in">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={draft.term}
          onChange={(e) => onChange({ ...draft, term: e.target.value })}
          placeholder="Term"
          aria-label="Term"
          autoComplete="off"
          className="flex-1 min-w-0 bg-surface-container border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-semibold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
        />
        <input
          type="text"
          value={draft.pages}
          onChange={(e) => onChange({ ...draft, pages: e.target.value })}
          placeholder="Page(s), optional — e.g. 3 or 3, 4"
          aria-label="Source page numbers, optional"
          autoComplete="off"
          className="sm:w-56 bg-surface-container border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
        />
      </div>
      {/* Definitions run long, and this is where educators vet them. min-h grows with breakpoint because the line count does (rows can't vary per breakpoint). resize-y for outliers; keep it Y-only so the width can't break. */}
      <textarea
        value={draft.definition}
        onChange={(e) => onChange({ ...draft, definition: e.target.value })}
        rows={3}
        placeholder="Definition — written so it makes sense on its own."
        aria-label="Definition"
        autoComplete="off"
        className="w-full min-h-[8.5rem] sm:min-h-[6rem] bg-surface-container border border-white/10 rounded-lg px-3 py-2 text-white text-sm leading-relaxed placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-y"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-sans text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-50 ${FOCUS}`}
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-fixed-dim text-on-primary-fixed font-sans text-xs font-bold hover:bg-primary-fixed transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-on-primary-fixed"
        >
          {saving ? <Spinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
