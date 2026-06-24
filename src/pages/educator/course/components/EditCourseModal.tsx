import React, { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';

interface CourseEditData {
  course_title: string;
  course_code?: string;
  section?: string;
  description?: string;
  status?: 'active' | 'archived';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CourseEditData) => Promise<void>;
  initialData: {
    id: string;
    course_title: string;
    course_code: string | null;
    section: string | null;
    description: string | null;
    status: 'active' | 'archived' | 'draft';
  } | null;
}

export default function EditCourseModal({ isOpen, onClose, onSave, initialData }: Props) {
  const [subjectCode, setSubjectCode] = useState('');
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialData) {
      const code = initialData.course_code || '';
      setSubjectCode(code);

      let displayTitle = initialData.course_title;
      if (code && displayTitle.toUpperCase().startsWith(`${code.toUpperCase()} - `)) {
        displayTitle = displayTitle.substring(code.length + 3);
      } else if (code && displayTitle.toUpperCase().startsWith(`${code.toUpperCase()}-`)) {
        displayTitle = displayTitle.substring(code.length + 1);
      }

      setTitle(displayTitle);
      setSection(initialData.section || '');
      setDescription(initialData.description || '');
      setStatus(initialData.status === 'archived' ? 'archived' : 'active');
    }
  }, [initialData, isOpen]);

  const canSave = title.trim().length > 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setIsSaving(true);
    try {
      await onSave({
        course_title: title.trim(),
        course_code: subjectCode.trim().toUpperCase() || undefined,
        section: section.trim() || undefined,
        description: description.trim() || undefined,
        status: status,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen && !!initialData}
      onClose={onClose}
      title="Edit Course Details"
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSave} className="flex flex-col gap-4 sm:gap-6 max-h-[60vh] landscape:max-h-[46vh] sm:max-h-[70vh] md:max-h-[75vh] overflow-y-auto pr-1 no-scrollbar">
        <div className="flex-1 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-1">
              <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Code</label>
              <input
                type="text"
                value={subjectCode}
                onChange={e => setSubjectCode(e.target.value)}
                placeholder="e.g. CS201"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-650 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Computer Algorithm"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-655 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
                required
              />
            </div>
            <div className="sm:col-span-1">
              <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Section</label>
              <input
                type="text"
                value={section}
                onChange={e => setSection(e.target.value)}
                placeholder="e.g. A"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-655 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40"
              />
            </div>
          </div>

          <div>
            <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="What will students learn?"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-sans text-sm placeholder:text-slate-655 outline-none focus:ring-1 focus:ring-primary-fixed-dim/40 resize-none"
            />
          </div>

          <div>
            <label className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold mb-2 block">Course Status</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStatus('active')}
                className={`px-4 py-3 rounded-xl border font-sans text-sm font-semibold transition-all ${
                  status === 'active'
                    ? 'bg-green-500/10 border-green-500/30 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatus('archived')}
                className={`px-4 py-3 rounded-xl border font-sans text-sm font-semibold transition-all ${
                  status === 'archived'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.1)]'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                Archived
              </button>
            </div>
            <p className="font-sans text-[11px] text-slate-500 mt-2">
              Archived courses are hidden from the active dashboard but can be viewed and reactivated at any time.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/5 mt-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors border border-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave || isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-[0_0_20px_rgba(0,218,243,0.3)] hover:shadow-[0_0_30px_rgba(0,218,243,0.5)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Save Changes
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
