import { useState, useEffect, useRef, FormEvent, DragEvent } from 'react';
import { UploadCloud, FileText, X, AlertCircle, Info, ImagePlus } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';
import SubjectBadge from '../../../components/educator/SubjectBadge';
import { formatFileSize, ALL_GRADE_LEVELS } from '../../../data/mockEducator';
import { useSubjects } from '../../../context/SubjectsContext';
import { api } from '../../../lib/api';
import { isPhoto, preparePhoto } from '../../../lib/photoPrep';
import PhotoPageGrid, { type PhotoPage } from './PhotoPageGrid';
import PhotoPageViewer from './PhotoPageViewer';

/** Documented platform limit (Scope & Limitations): one material ≤ 20 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A scanned or photographed document is at most 20 pages (photo N = page N). Mirrors MAX_SCANNED_PAGES on the server. */
const MAX_PHOTOS = 20;

const ACCEPT = 'application/pdf,image/jpeg,image/png';

/**
 * Exactly one grade per material, so a single-select (sent as a one-element array; the column is
 * SMALLINT[]). The empty placeholder matters: Dropdown shows its first option for an unmatched value,
 * so without it the control would silently sit on Grade 7.
 */
const NO_GRADE = '';

interface UploadMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful upload so the library can refetch from the server. */
  onUploaded: () => void;
}

export default function UploadMaterialModal({ isOpen, onClose, onUploaded }: UploadMaterialModalProps) {
  /* The full catalogue from SubjectsProvider; educators aren't pre-assigned subjects. */
  const { subjects, error: subjectsError } = useSubjects();

  /* Either one PDF or an ordered set of page photos (already upright and downscaled by preparePhoto). */
  const [pdf, setPdf] = useState<File | null>(null);
  const [pages, setPages] = useState<PhotoPage[]>([]);
  /* The page open in the full-size viewer, or null. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState<string>(NO_GRADE);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Default to the first subject once the list arrives, but only while the field is still empty. */
  useEffect(() => {
    if (!subject && subjects.length) setSubject(subjects[0].code);
  }, [subjects, subject]);

  /* A placeholder only while there's nothing to choose, so Dropdown's first-option fallback never stands in for a value. */
  const subjectOptions = subjects.length
    ? subjects.map((s) => ({ label: s.name, value: s.code }))
    : [{ label: subjectsError ? 'Subjects unavailable' : 'Loading subjects…', value: '' }];

  /** Grade access is the educator's own decision, so all four JHS grades are offered. */
  const gradeOptions = [
    { value: NO_GRADE, label: 'Select a grade level…' },
    ...ALL_GRADE_LEVELS.map((g) => ({ value: String(g), label: `Grade ${g}` })),
  ];

  const isPdf = pdf !== null;
  const hasFile = isPdf || pages.length > 0;
  const totalBytes = pages.reduce((sum, p) => sum + p.file.size, 0);

  /*
   * Each page's object URL is made once, when it is added, and revoked when it leaves. Rebuilding
   * them per change would flicker every tile on every reorder. The ref covers unmount.
   */
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const releasePages = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setViewerIndex(null);
  };

  const reset = () => {
    releasePages();
    setPdf(null);
    setIsPreparing(false);
    setTitle('');
    setDescription('');
    // Left empty; the effect above refills it from the catalogue.
    setSubject('');
    setGrade(NO_GRADE);
    setError(null);
    setIsUploading(false);
  };

  const handleClose = () => {
    if (isUploading || isPreparing) return; // don't drop an in-flight upload
    reset();
    onClose();
  };

  const suggestTitle = (name: string) => {
    if (!title.trim()) setTitle(name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  };

  /**
   * A PDF replaces everything; photos append. Within one pick they go in file-name order, because the
   * browser hands them over in an OS-decided order rather than the click order (phone camera names are
   * timestamps, so this is usually shooting order). Text vs scanned is decided on the server.
   */
  const acceptFiles = async (candidates: File[]) => {
    if (!candidates.length) return;
    setError(null);

    const pdfs = candidates.filter((f) => f.type === 'application/pdf');
    const photos = candidates.filter(isPhoto);
    if (pdfs.length + photos.length !== candidates.length) {
      setError('Only a PDF or JPEG/PNG photos can be uploaded.');
      return;
    }
    if (pdfs.length > 1 || (pdfs.length === 1 && photos.length)) {
      setError('Upload one PDF, or photos of the pages — not both in the same material.');
      return;
    }

    if (pdfs.length === 1) {
      const pdf = pdfs[0];
      if (pdf.size > MAX_FILE_BYTES) {
        setError(`That file is ${formatFileSize(pdf.size)}. The limit is 20 MB.`);
        return;
      }
      releasePages();
      setPdf(pdf);
      suggestTitle(pdf.name);
      return;
    }

    const existing = isPdf ? [] : pages;
    if (existing.length + photos.length > MAX_PHOTOS) {
      setError(`A photographed lesson can have at most ${MAX_PHOTOS} pages. Split a longer one into two materials.`);
      return;
    }

    const ordered = [...photos].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    setIsPreparing(true);
    const prepared: PhotoPage[] = [];
    let accepted = false;
    try {
      for (const photo of ordered) {
        let file: File;
        try {
          file = await preparePhoto(photo);
        } catch {
          setError(`"${photo.name}" could not be read as an image. Use a JPEG or PNG photo.`);
          return;
        }
        prepared.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
      }
      const next = [...existing, ...prepared];
      const bytes = next.reduce((sum, p) => sum + p.file.size, 0);
      if (bytes > MAX_FILE_BYTES) {
        setError(`These photos add up to ${formatFileSize(bytes)}. The limit is 20 MB per material.`);
        return;
      }
      setPdf(null);
      setPages(next);
      accepted = true;
      if (!existing.length) suggestTitle(ordered[0].name);
    } finally {
      // A refused batch never reaches state, so its URLs are released here.
      if (!accepted) prepared.forEach((p) => URL.revokeObjectURL(p.url));
      setIsPreparing(false);
    }
  };

  /* From the grid's ✕ or the viewer. An open viewer stays on the same slot, clamped, or closes when nothing is left. */
  const removePage = (index: number) => {
    const target = pages[index];
    if (!target) return;
    URL.revokeObjectURL(target.url);
    const next = pages.filter((_, i) => i !== index);
    setPages(next);
    if (viewerIndex !== null) setViewerIndex(next.length ? Math.min(viewerIndex, next.length - 1) : null);
  };

  /* Move earlier / Move later in the viewer; the viewer follows the page it moved. */
  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPages(next);
    setViewerIndex(to);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files ? Array.from<File>(e.dataTransfer.files) : [];
    if (dropped.length) void acceptFiles(dropped);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isUploading) return;

    if (!hasFile) return setError('Choose a PDF, or photos of the pages, to upload.');
    if (!title.trim()) return setError('Give the material a title.');
    if (grade === NO_GRADE) return setError('Select the grade level this material is for.');

    // Every file under the same field, in page order (the order of the tiles). The server takes one PDF or assembles the photos.
    const formData = new FormData();
    if (pdf) formData.append('file', pdf);
    else for (const p of pages) formData.append('file', p.file);
    formData.append('title', title.trim());
    formData.append('subject', subject);
    if (description.trim()) formData.append('description', description.trim());
    // Still an array on the wire: SMALLINT[] with a length-1 CHECK.
    formData.append('grade_levels', JSON.stringify([Number(grade)]));

    setError(null);
    setIsUploading(true);
    try {
      await api.upload('/materials', formData);
      onUploaded();
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setIsUploading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Learning Material" maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">

        {/* One hidden input for every state (drop zone, "Add more photos", drop). `multiple` allows a whole lesson in one pick. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files ? Array.from<File>(e.target.files) : [];
            if (chosen.length) void acceptFiles(chosen);
            e.target.value = '';
          }}
        />

        {/* Picker: one PDF, a strip of page photos, or the empty drop zone */}
        {pdf ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-white truncate">{pdf.name}</p>
              <p className="font-sans text-xs text-slate-400">{formatFileSize(pdf.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setPdf(null)}
              disabled={isUploading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : pages.length ? (
          <div className="p-4 rounded-xl bg-surface-container border border-white/10">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="font-sans text-xs text-slate-400">
                <span className="text-white font-semibold">{pages.length} {pages.length === 1 ? 'photo' : 'photos'}</span>
                {' · '}{formatFileSize(totalBytes)}{' · '}
                drag to reorder, tap to view
              </p>
              {pages.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isPreparing}
                  className="flex items-center gap-1.5 font-sans text-xs font-semibold text-primary-fixed-dim hover:text-primary-fixed transition-colors disabled:opacity-40"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Add photos
                </button>
              )}
            </div>
            {/* The number is the page number students will see, in the order the pages are uploaded. */}
            <PhotoPageGrid
              pages={pages}
              disabled={isUploading || isPreparing}
              onReorder={setPages}
              onOpen={setViewerIndex}
              onRemove={removePage}
            />
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center text-center px-6 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
              isDragging
                ? 'border-primary-fixed-dim/60 bg-primary-fixed-dim/5'
                : 'border-white/10 hover:border-primary-fixed-dim/40 hover:bg-white/[0.02]'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
              {isPreparing
                ? <Spinner className="w-5 h-5 text-slate-400" />
                : <UploadCloud className="w-5 h-5 text-slate-400" />}
            </div>
            <p className="font-sans text-sm font-medium text-white">
              {isPreparing ? 'Preparing photos…' : 'Drop a PDF or photos of the pages here, or click to browse'}
            </p>
            <p className="font-sans text-xs text-slate-500 mt-1">
              Text PDF, scanned PDF, or up to {MAX_PHOTOS} photos · 20 MB total
            </p>
          </div>
        )}

        {isPreparing && pages.length > 0 && (
          <p className="flex items-center gap-2 font-sans text-xs text-slate-400 -mt-2">
            <Spinner className="w-3.5 h-3.5" /> Preparing photos…
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="font-sans text-xs text-rose-300">{error}</p>
          </div>
        )}

        {/* Title */}
        <div>
          <label htmlFor="material-title" className="block font-sans text-sm font-medium text-slate-300 mb-1.5">
            Title
          </label>
          <input
            id="material-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Cell Structure and Function"
            className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="material-description" className="block font-sans text-sm font-medium text-slate-300 mb-1.5">
            Description <span className="text-slate-500 font-normal">(optional)</span>
          </label>
          <textarea
            id="material-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What this module covers, in a sentence or two."
            className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none"
          />
        </div>

        {/* Subject + grades */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-sans text-sm font-medium text-slate-300 mb-1.5">Subject</label>
            <Dropdown
              value={subject}
              onChange={setSubject}
              options={subjectOptions}
              className="w-full"
            />
            {/* Say why the dropdown is empty rather than leave it blank. */}
            {subjectsError && (
              <p className="mt-1.5 font-sans text-[11px] text-red-400 leading-relaxed">
                The subject list couldn't be loaded, so this material can't be uploaded yet. Check
                your connection and reopen this page.
              </p>
            )}
          </div>
          <div>
            <label className="block font-sans text-sm font-medium text-slate-300 mb-1.5">Grade Level</label>
            <Dropdown
              value={grade}
              onChange={setGrade}
              options={gradeOptions}
              className="w-full"
            />
          </div>
        </div>

        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="font-sans text-xs text-slate-400">
            Subject and grade level are both your call. A material goes to
            {' '}<span className="text-slate-200 font-medium">one grade level</span> — students in
            {grade === NO_GRADE ? ' that grade' : ` Grade ${grade}`} will find this
            <SubjectBadge code={subject} className="mx-1 align-middle" />
            material, and their progress on it appears in its Class Performance tab. You can change
            the grade later from the material's page.
          </p>
        </div>

        <div className="flex gap-3 pt-4 border-t border-white/5 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-sans text-sm font-medium hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!hasFile || !title.trim() || !subject || grade === NO_GRADE || isUploading || isPreparing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <Spinner className="w-4 h-4" />
                Uploading…
              </>
            ) : (
              'Upload Material'
            )}
          </button>
        </div>
      </form>

      {isOpen && viewerIndex !== null && (
        <PhotoPageViewer
          pages={pages}
          index={viewerIndex}
          disabled={isUploading || isPreparing}
          onIndexChange={setViewerIndex}
          onMove={movePage}
          onRemove={removePage}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </Modal>
  );
}
