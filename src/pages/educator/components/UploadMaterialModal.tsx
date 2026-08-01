import { useState, useRef, FormEvent, DragEvent } from 'react';
import { UploadCloud, FileText, X, AlertCircle, Info, Loader2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Dropdown from '../../../components/ui/Dropdown';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import SubjectBadge from '../../../components/educator/SubjectBadge';
import { SUBJECTS, formatFileSize, ALL_GRADE_LEVELS } from '../../../data/mockEducator';
import { api } from '../../../lib/api';

/** Documented platform limit (Scope & Limitations): plain-text PDF, ≤ 20 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface UploadMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful upload so the library can refetch from the server. */
  onUploaded: () => void;
}

const gradeLabel = (g: number) => `Grade ${g}`;
const gradeValue = (label: string) => Number(label.replace('Grade ', ''));

export default function UploadMaterialModal({ isOpen, onClose, onUploaded }: UploadMaterialModalProps) {
  // The full catalogue: an educator is not pre-assigned to any subject.
  const subjects = SUBJECTS;

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState(subjects[0]?.code ?? '');
  const [grades, setGrades] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Grade access is the educator's own decision, so all four JHS grades are offered. */
  // Grade labels are unique, so label doubles as the option value.
  const gradeOptions = ALL_GRADE_LEVELS.map((g) => ({ value: gradeLabel(g), label: gradeLabel(g) }));

  const reset = () => {
    setFile(null);
    setTitle('');
    setDescription('');
    setSubject(subjects[0]?.code ?? '');
    setGrades([]);
    setError(null);
    setIsUploading(false);
  };

  const handleClose = () => {
    if (isUploading) return; // don't drop an in-flight upload
    reset();
    onClose();
  };

  const acceptFile = (candidate: File) => {
    if (candidate.type !== 'application/pdf') {
      setError('Only PDF files can be uploaded.');
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setError(`That file is ${formatFileSize(candidate.size)}. The limit is 20 MB.`);
      return;
    }
    setError(null);
    setFile(candidate);
    if (!title.trim()) {
      setTitle(candidate.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '));
    }
    // Whether the PDF is scanned/text is decided authoritatively on the server,
    // which saves a scanned file marked as unsupported with a clear reason.
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isUploading) return;

    if (!file) return setError('Choose a PDF to upload.');
    if (!title.trim()) return setError('Give the material a title.');
    if (grades.length === 0) return setError('Select at least one grade level.');

    const gradeNumbers = grades.map(gradeValue).sort((a, b) => a - b);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    formData.append('subject', subject);
    if (description.trim()) formData.append('description', description.trim());
    formData.append('grade_levels', JSON.stringify(gradeNumbers));

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

        {/* Drop zone */}
        {file ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-container border border-white/10">
            <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-white truncate">{file.name}</p>
              <p className="font-sans text-xs text-slate-400">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              disabled={isUploading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
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
              <UploadCloud className="w-5 h-5 text-slate-400" />
            </div>
            <p className="font-sans text-sm font-medium text-white">
              Drop a PDF here, or click to browse
            </p>
            <p className="font-sans text-xs text-slate-500 mt-1">
              Text-based PDF · up to 20 MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) acceptFile(chosen);
                e.target.value = '';
              }}
            />
          </div>
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
              options={subjects.map((s) => ({ label: s.name, value: s.code }))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block font-sans text-sm font-medium text-slate-300 mb-1.5">Grade Levels</label>
            <MultiSelectDropdown
              selectedValues={grades}
              onChange={setGrades}
              options={gradeOptions}
              placeholder="Select grades..."
              itemNoun="grade"
            />
          </div>
        </div>

        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="font-sans text-xs text-slate-400">
            Subject and grade access are both your call. Students in the grades you select will find
            this
            <SubjectBadge code={subject} className="mx-1 align-middle" />
            material, and those grades then appear in your Students roster.
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
            disabled={!file || !title.trim() || grades.length === 0 || isUploading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
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
