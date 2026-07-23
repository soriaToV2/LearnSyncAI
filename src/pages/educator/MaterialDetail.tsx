import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, FileText, Search, Archive, ArchiveRestore, Trash2,
  AlertTriangle, Users, BookOpen, Lock, Pencil, Check,
} from 'lucide-react';
import Modal from '../../components/ui/Modal';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown';
import SubjectBadge from '../../components/educator/SubjectBadge';
import GradeChips from '../../components/educator/GradeChips';
import ParseStatusPill from '../../components/educator/ParseStatusPill';
import MasteryBar from '../../components/educator/MasteryBar';
import TierBadge from '../../components/educator/TierBadge';
import {
  MATERIALS, conceptsForMaterial, masteryRowsForMaterial, ALL_GRADE_LEVELS,
  subjectName, formatFileSize, formatDate, formatPercent, studentName,
  type MasteryTier,
} from '../../data/mockEducator';

const TIERS: MasteryTier[] = ['advanced', 'intermediate', 'foundational'];

export default function MaterialDetail() {
  const { materialId } = useParams<{ materialId: string }>();
  const navigate = useNavigate();

  const base = MATERIALS.find((m) => m.id === materialId);

  const [grades, setGrades] = useState<string[]>(
    () => (base?.grade_levels ?? []).map((g) => `Grade ${g}`)
  );
  const [isArchived, setIsArchived] = useState(base?.is_archived ?? false);
  const [isEditingGrades, setIsEditingGrades] = useState(false);
  const [conceptSearch, setConceptSearch] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const concepts = useMemo(
    () => (materialId ? conceptsForMaterial(materialId) : []),
    [materialId]
  );

  const masteryRows = useMemo(
    () => (materialId ? masteryRowsForMaterial(materialId) : []),
    [materialId]
  );

  if (!base) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-background px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-4">
          <FileText className="w-6 h-6 text-slate-400" />
        </div>
        <h1 className="font-display text-xl font-semibold text-white mb-2">Material not found</h1>
        <p className="font-sans text-sm text-slate-400 mb-6">
          It may have been deleted, or the link is out of date.
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

  const gradeValues = grades.map((g) => Number(g.replace('Grade ', ''))).sort((a, b) => a - b);

  const filteredConcepts = concepts.filter((c) => {
    const q = conceptSearch.trim().toLowerCase();
    return !q || c.term.toLowerCase().includes(q) || c.definition.toLowerCase().includes(q);
  });

  const averageMastery = masteryRows.length
    ? masteryRows.reduce((sum, r) => sum + r.m_doc, 0) / masteryRows.length
    : 0;

  const tierCounts = TIERS.map((tier) => ({
    tier,
    count: masteryRows.filter((r) => r.tier === tier).length,
  }));

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">

        {/* Back */}
        <button
          onClick={() => navigate('/educator/materials')}
          className="flex items-center gap-2 font-sans text-xs text-slate-400 hover:text-white transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Materials
        </button>

        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-5 mb-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <SubjectBadge code={base.subject} full />
              <GradeChips grades={gradeValues} />
              <ParseStatusPill status={base.parsed_status} />
              {isArchived && (
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider">
                  Archived
                </span>
              )}
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold text-on-surface leading-tight">
              {base.title}
            </h1>
            {base.description && (
              <p className="font-sans text-sm text-on-surface-variant mt-2 max-w-2xl">
                {base.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsArchived(!isArchived)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container/60 border border-white/10 text-slate-300 font-sans text-xs font-semibold hover:bg-surface-container/85 hover:text-white transition-all"
            >
              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {isArchived ? 'Restore' : 'Archive'}
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-400 font-sans text-xs font-semibold hover:bg-rose-500/10 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </header>

        {base.parsed_status === 'failed' && base.parse_error && (
          <div className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 mb-8">
            <AlertTriangle className="w-4.5 h-4.5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-sans text-sm font-semibold text-rose-300 mb-1">
                Concept extraction failed
              </p>
              <p className="font-sans text-xs text-rose-300/80 leading-relaxed">{base.parse_error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">

          {/* ---------------- Left: document + access ---------------- */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">

            {/* Document preview placeholder */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                <div className="w-9 h-9 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-primary-fixed-dim" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-white truncate">Document</h2>
                  <p className="font-sans text-[11px] text-slate-500 truncate">
                    {base.storage_path.split('/').pop()}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center text-center gap-2.5 px-6 py-14 bg-surface-container-lowest/40">
                <Lock className="w-8 h-8 text-slate-600" />
                <p className="font-sans text-sm text-slate-400">Preview not available yet</p>
                <p className="font-sans text-xs text-slate-600 max-w-[240px]">
                  The file lives in a private storage bucket. Rendering it needs a signed URL from the
                  backend, which arrives with the API wiring phase.
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 border-t border-white/5">
                {[
                  ['Subject', subjectName(base.subject)],
                  ['Pages', base.page_count ? String(base.page_count) : '—'],
                  ['File size', formatFileSize(base.file_size_bytes)],
                  ['Type', base.is_scanned ? 'Scanned PDF' : 'Text PDF'],
                  ['Uploaded', formatDate(base.created_at)],
                  ['Last updated', formatDate(base.updated_at)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                      {label}
                    </dt>
                    <dd className="font-sans text-xs text-slate-200 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Grade access */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
              <div className="flex items-center justify-between mb-3.5">
                <h2 className="font-display text-sm font-bold text-white">Grade Access</h2>
                <button
                  onClick={() => setIsEditingGrades(!isEditingGrades)}
                  className="flex items-center gap-1.5 font-sans text-xs text-primary-fixed-dim font-semibold hover:opacity-80 transition-opacity"
                >
                  {isEditingGrades ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3 h-3" />}
                  {isEditingGrades ? 'Done' : 'Edit'}
                </button>
              </div>

              {isEditingGrades ? (
                <MultiSelectDropdown
                  selectedValues={grades}
                  onChange={setGrades}
                  options={ALL_GRADE_LEVELS.map((g) => `Grade ${g}`)}
                  placeholder="Select grades..."
                />
              ) : (
                <GradeChips grades={gradeValues} />
              )}

              <p className="font-sans text-xs text-slate-500 mt-3 leading-relaxed">
                Only students in these grades can pull this material into a study space. You choose
                the grades yourself and can change them at any time — removing a grade also removes
                those students from your roster for this material.
              </p>
            </section>
          </div>

          {/* ---------------- Right: concepts + performance ---------------- */}
          <div className="col-span-12 lg:col-span-7 flex flex-col gap-6">

            {/* Class performance */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-4 h-4 text-slate-400" />
                <h2 className="font-display text-lg font-bold text-white">Class Performance</h2>
              </div>

              {masteryRows.length === 0 ? (
                <p className="font-sans text-sm text-slate-400 py-4">
                  No mastery data yet. Scores appear once students study this material through
                  adaptive flashcards or a test.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="font-display text-3xl font-bold text-white tracking-tight">
                      {formatPercent(averageMastery)}
                    </span>
                    <span className="font-sans text-xs text-slate-400">
                      average across {masteryRows.length} student{masteryRows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <MasteryBar mastery={averageMastery} showValue={false} className="mb-5" />

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {tierCounts.map(({ tier, count }) => (
                      <div key={tier} className="rounded-xl bg-white/[0.02] border border-white/5 p-3.5">
                        <p className="font-display text-xl font-bold text-white tabular-nums">{count}</p>
                        <TierBadge tier={tier} className="mt-1.5" />
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {[...masteryRows]
                      .sort((a, b) => a.m_doc - b.m_doc)
                      .map((r) => (
                        <button
                          key={r.student_id}
                          onClick={() => navigate(`/educator/students/${r.student_id}`)}
                          className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left group"
                        >
                          <div className="w-8 h-8 rounded-full bg-surface-container border border-white/10 flex items-center justify-center shrink-0 font-display text-[11px] font-bold text-slate-300">
                            {r.first_name[0]}{r.last_name[0]}
                          </div>
                          <span className="font-sans text-sm text-white font-medium w-40 truncate group-hover:text-primary-fixed-dim transition-colors">
                            {studentName(r)}
                          </span>
                          <span className="font-sans text-[11px] text-slate-500 tabular-nums w-16 shrink-0 hidden sm:block">
                            {r.assessed_concept_count}/{r.concept_count}
                          </span>
                          <MasteryBar mastery={r.m_doc} className="flex-1" />
                        </button>
                      ))}
                  </div>
                </>
              )}
            </section>

            {/* Concepts */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-slate-400" />
                  <h2 className="font-display text-lg font-bold text-white">
                    Extracted Concepts
                  </h2>
                  <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-sans text-[10px] font-bold text-slate-400 tabular-nums">
                    {concepts.length}
                  </span>
                </div>

                {concepts.length > 0 && (
                  <div className="relative sm:w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                    <input
                      type="search"
                      value={conceptSearch}
                      onChange={(e) => setConceptSearch(e.target.value)}
                      placeholder="Search concepts..."
                      className="w-full bg-surface-container/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white text-xs font-medium placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40"
                    />
                  </div>
                )}
              </div>

              {concepts.length === 0 ? (
                <p className="font-sans text-sm text-slate-400 py-4">
                  {base.parsed_status === 'failed'
                    ? 'Extraction failed, so no concepts were stored. Re-upload a text-based PDF.'
                    : 'Concepts appear here once extraction finishes.'}
                </p>
              ) : filteredConcepts.length === 0 ? (
                <p className="font-sans text-sm text-slate-400 py-4">
                  No concept matches "{conceptSearch}".
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {filteredConcepts.map((c, i) => (
                    <li
                      key={c.id}
                      className="flex gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/5"
                    >
                      <span className="font-sans text-[11px] font-bold text-slate-600 tabular-nums pt-0.5 w-5 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <p className="font-sans text-sm font-semibold text-white">{c.term}</p>
                        <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                          {c.definition}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
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
            Delete <span className="font-semibold text-white">"{base.title}"</span>?
            Its {concepts.length} extracted concept{concepts.length === 1 ? '' : 's'} and every
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
              onClick={() => navigate('/educator/materials')}
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
