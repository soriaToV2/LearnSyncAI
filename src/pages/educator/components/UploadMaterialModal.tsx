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

/** Documented platform limit (Scope & Limitations): one material ≤ 20 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Documented platform limit: a scanned or photographed document is at most 20
 * pages. Photo N becomes page N of the PDF the server assembles, so this is
 * also the photo cap. Mirrors `MAX_SCANNED_PAGES` in `materials.routes.ts`,
 * which is the guarantee; this only saves a round trip.
 */
const MAX_PHOTOS = 20;

const ACCEPT = 'application/pdf,image/jpeg,image/png';

/**
 * A material is published to EXACTLY ONE grade level, so this is a single-select.
 *
 * It was a `MultiSelectDropdown`. The rule is enforced in three places that must
 * agree: `materials_grade_levels_valid` (`array_length = 1`), `GradeLevelsField`
 * in `server/types/api.ts` (`.length(1)`), and this control. The wire format is
 * still a one-element array because `materials.grade_levels` is still SMALLINT[]
 * — see the schema comment for why the column did not become a scalar.
 *
 * `Dropdown` falls back to its FIRST option when `value` matches nothing, so the
 * empty placeholder below is what gives this an unselected state. Without it the
 * control would silently sit on Grade 7 and an educator could publish to the
 * wrong grade without ever touching the field.
 */
const NO_GRADE = '';

interface UploadMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful upload so the library can refetch from the server. */
  onUploaded: () => void;
}

export default function UploadMaterialModal({ isOpen, onClose, onUploaded }: UploadMaterialModalProps) {
  /*
   * The full catalogue: an educator is not pre-assigned to any subject.
   *
   * Read from `public.subjects` through `SubjectsProvider`, not from a constant.
   * It used to be a hand-kept copy of the seeded rows, so a subject deleted in
   * Supabase stayed on offer here until someone edited the code.
   */
  const { subjects, error: subjectsError } = useSubjects();

  /*
   * ONE material is EITHER one PDF OR an ordered set of page photos. `files`
   * holds whichever it is; `isPdf` tells them apart. Photos are already
   * downscaled and upright by the time they land here (`preparePhoto`), so
   * the sizes shown are the sizes that will be sent.
   */
  const [files, setFiles] = useState<File[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState<string>(NO_GRADE);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * Preserve the old behaviour of opening on the first subject, now that the list
   * arrives asynchronously and cannot seed `useState`.
   *
   * ⚠️ ONLY WHILE THE FIELD IS STILL EMPTY. Without that guard a slow response
   * would overwrite a subject the educator had already chosen, filing the upload
   * somewhere they did not pick — and `materials.subject` is what every student's
   * space membership is derived from.
   */
  useEffect(() => {
    if (!subject && subjects.length) setSubject(subjects[0].code);
  }, [subjects, subject]);

  /*
   * A leading placeholder only while there is nothing to choose. Once loaded the
   * options are the catalogue alone and `subject` already matches one of them, so
   * `Dropdown`'s first-option fallback never has to stand in for a real value.
   */
  const subjectOptions = subjects.length
    ? subjects.map((s) => ({ label: s.name, value: s.code }))
    : [{ label: subjectsError ? 'Subjects unavailable' : 'Loading subjects…', value: '' }];

  /** Grade access is the educator's own decision, so all four JHS grades are offered. */
  const gradeOptions = [
    { value: NO_GRADE, label: 'Select a grade level…' },
    ...ALL_GRADE_LEVELS.map((g) => ({ value: String(g), label: `Grade ${g}` })),
  ];

  const isPdf = files.length === 1 && files[0].type === 'application/pdf';
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  /*
   * Object URLs for the photo thumbnails. Made in an effect, once per change to
   * the set, and revoked by its cleanup — a URL per render would leak a blob
   * for every keystroke in the title field.
   */
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = isPdf ? [] : files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files, isPdf]);

  const reset = () => {
    setFiles([]);
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
   * Takes whatever the picker or a drop produced. A PDF replaces everything;
   * photos are appended to the photos already chosen, in the order given, so an
   * educator can add the last few pages without starting over.
   *
   * Whether a PDF is text or scanned is decided on the server, which now reads
   * scanned pages with OCR rather than refusing them.
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
      setFiles([pdf]);
      suggestTitle(pdf.name);
      return;
    }

    const existing = isPdf ? [] : files;
    if (existing.length + photos.length > MAX_PHOTOS) {
      setError(`A photographed lesson can have at most ${MAX_PHOTOS} pages. Split a longer one into two materials.`);
      return;
    }

    setIsPreparing(true);
    try {
      const prepared: File[] = [];
      for (const photo of photos) {
        try {
          prepared.push(await preparePhoto(photo));
        } catch {
          setError(`"${photo.name}" could not be read as an image. Use a JPEG or PNG photo.`);
          return;
        }
      }
      const next = [...existing, ...prepared];
      const bytes = next.reduce((sum, f) => sum + f.size, 0);
      if (bytes > MAX_FILE_BYTES) {
        setError(`These photos add up to ${formatFileSize(bytes)}. The limit is 20 MB per material.`);
        return;
      }
      setFiles(next);
      if (!existing.length) suggestTitle(photos[0].name);
    } finally {
      setIsPreparing(false);
    }
  };

  const removePhoto = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
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

    if (!files.length) return setError('Choose a PDF, or photos of the pages, to upload.');
    if (!title.trim()) return setError('Give the material a title.');
    if (grade === NO_GRADE) return setError('Select the grade level this material is for.');

    // Every file goes under the same field, in page order. The server takes
    // one PDF, or assembles the photos into one — see POST /api/materials.
    const formData = new FormData();
    for (const f of files) formData.append('file', f);
    formData.append('title', title.trim());
    formData.append('subject', subject);
    if (description.trim()) formData.append('description', description.trim());
    // Still an array on the wire — the column is SMALLINT[] with a length-1 CHECK.
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

        {/*
          The one hidden input serves every state: the empty drop zone, "Add
          more photos" on the thumbnail strip, and a drop anywhere on the zone.
          `multiple` is what lets a whole lesson's photos arrive in one pick.
        */}
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
        {isPdf ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-white truncate">{files[0].name}</p>
              <p className="font-sans text-xs text-slate-400">{formatFileSize(files[0].size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFiles([])}
              disabled={isUploading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : files.length ? (
          <div className="p-4 rounded-xl bg-surface-container border border-white/10">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="font-sans text-xs text-slate-400">
                <span className="text-white font-semibold">{files.length} {files.length === 1 ? 'photo' : 'photos'}</span>
                {' · '}{formatFileSize(totalBytes)}{' · '}
                shown in page order
              </p>
              {files.length < MAX_PHOTOS && (
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
            {/*
              Numbered because the number IS the page number students will
              see. Each tile keeps the photo's aspect so a sideways one is
              obvious here rather than in the viewer.
            */}
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {files.map((f, i) => (
                <div key={`${f.name}-${f.lastModified}-${i}`} className="relative aspect-[3/4] rounded-lg overflow-hidden bg-black/30 border border-white/10">
                  <img src={previews[i]} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white font-sans text-[10px] font-bold">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    disabled={isUploading || isPreparing}
                    className="absolute top-1 right-1 p-1 rounded-md bg-black/70 text-slate-200 hover:text-white hover:bg-black/90 transition-colors disabled:opacity-40"
                    aria-label={`Remove page ${i + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
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

        {isPreparing && files.length > 0 && (
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
            {/*
              Stated rather than left to an empty dropdown. Submit is already
              disabled without a subject, and a control that offers nothing with
              no explanation reads as a form the educator is failing to fill in.
            */}
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
            disabled={!files.length || !title.trim() || !subject || grade === NO_GRADE || isUploading || isPreparing}
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
    </Modal>
  );
}
