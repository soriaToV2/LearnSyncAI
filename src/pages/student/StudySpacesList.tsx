import { useState, useEffect, FormEvent } from 'react';
import { Layers, Plus, Folder, Clock, Pencil, Trash2, ArrowRight } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSubjects, useSubjectName } from '../../context/SubjectsContext';
import SubjectBadge, { SUBJECT_COLOR } from '../../components/educator/SubjectBadge';

import Modal from '../../components/ui/Modal';
import Dropdown from '../../components/ui/Dropdown';

/** One subject per space, fixed at creation. The server fills a new space with that subject's published materials. */
interface StudySpaceData {
  id: string;
  title: string;
  subject: string;
  created_at: string;
}

/** A card's accent comes from its subject, never its position, so colours are stable and match SubjectBadge. */
const ACCENT_FALLBACK = '#94a3b8';

const accentFor = (subject: string) => SUBJECT_COLOR[subject] ?? ACCENT_FALLBACK;


export default function StudySpacesList() {
  const navigate = useNavigate();

  // Subjects come from SubjectsProvider (public.subjects), never a constant.
  const { subjects, error: subjectsError } = useSubjects();
  const subjectNameOf = useSubjectName();

  const [spaces, setSpaces] = useState<StudySpaceData[]>([]);

  // One space per subject; the server enforces it (409 SUBJECT_SPACE_EXISTS), this only greys them out.
  const takenSubjects = new Set(spaces.map((s) => s.subject));
  const allTaken = subjects.length > 0 && subjects.every((s) => takenSubjects.has(s.code));

  // Subject options led by an empty placeholder: Dropdown shows its first option for an unmatched value,
  // and the subject can't be changed later. The placeholder also carries loading/failure states.
  const subjectOptions = [
    {
      value: '',
      label: subjectsError
        ? 'Subjects unavailable'
        : !subjects.length
          ? 'Loading subjects…'
          : allTaken
            ? 'You have a space for every subject'
            : 'Choose a subject…',
    },
    ...subjects.map((s) =>
      takenSubjects.has(s.code)
        ? { value: s.code, label: `${s.name} · you have a space`, disabled: true }
        : { value: s.code, label: s.name },
    ),
  ];

  const [isLoading, setIsLoading] = useState(true);

  // Modals and forms
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newSpaceTitle, setNewSpaceTitle] = useState('');
  const [newSpaceSubject, setNewSpaceSubject] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);


  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [selectedSpaceToRename, setSelectedSpaceToRename] = useState<StudySpaceData | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedSpaceToDelete, setSelectedSpaceToDelete] = useState<StudySpaceData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSpaces = async () => {
    try {
      const res = await api.get<StudySpaceData[]>('/spaces');
      setSpaces(res.data || []);
    } catch (err) {
      console.error('Failed to load study spaces', err);
    }
  };



  const initData = async () => {
    setIsLoading(true);
    await fetchSpaces();
    setIsLoading(false);
  };

  useEffect(() => {
    initData();
  }, []);

  // No space cloning: removed to keep each student's data isolated.

  const handleCreateSpace = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSpaceTitle.trim() || !newSpaceSubject) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      // The server fills the new space with this subject's published materials.
      await api.post('/spaces', {
        title: newSpaceTitle.trim(),
        subject: newSpaceSubject,
      });
      await fetchSpaces();
      setIsCreateModalOpen(false);
      setNewSpaceTitle('');
      setNewSpaceSubject('');
    } catch (err: any) {
      console.error('Failed to create study space', err);
      setCreateError(err.message ?? 'Could not create the study space. Please try again.');
      // Made in another tab: refresh so the dropdown greys the subject out.
      if (err?.code === 'SUBJECT_SPACE_EXISTS') {
        setNewSpaceSubject('');
        await fetchSpaces();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameClick = (space: StudySpaceData) => {
    setSelectedSpaceToRename(space);
    setRenameTitle(space.title);
    setIsRenameModalOpen(true);
  };

  const handleRenameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!renameTitle.trim() || !selectedSpaceToRename) return;

    try {
      await api.put(`/spaces/${selectedSpaceToRename.id}`, {
        title: renameTitle.trim()
      });
      await fetchSpaces();
      setIsRenameModalOpen(false);
      setSelectedSpaceToRename(null);
    } catch (err) {
      console.error('Failed to rename study space', err);
    }
  };

  const handleDeleteClick = (space: StudySpaceData) => {
    setSelectedSpaceToDelete(space);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSpaceToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/spaces/${selectedSpaceToDelete.id}`);
      await fetchSpaces();
      setIsDeleteModalOpen(false);
      setSelectedSpaceToDelete(null);
    } catch (err) {
      console.error('Failed to delete study space', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex-1 w-full bg-background p-4 sm:p-6 lg:p-10 overflow-y-auto relative">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 sm:mb-10 gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30 shrink-0">
                <Layers className="text-primary-fixed-dim w-5 h-5" />
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-on-surface">Study Spaces</h1>
            </div>
            <p className="font-sans text-on-surface-variant max-w-2xl text-sm">
              One space per subject. Each opens with the materials your teachers published for your
              grade level, ready for the AI study tools.
            </p>
          </div>

          {/* Exactly one create action per state: this button once spaces exist; the empty state has its own CTA. */}
          {!isLoading && spaces.length > 0 && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Plus className="w-4 h-4" />
              New Space
            </button>
          )}
        </header>

        {isLoading ? (
          /* Skeletons in the cards' shape, so nothing jumps when data lands. */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 p-5 sm:p-6 min-h-[200px] animate-pulse"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="w-11 h-11 rounded-xl bg-white/5" />
                  <div className="w-12 h-5 rounded-md bg-white/5" />
                </div>
                <div className="h-5 w-2/3 rounded bg-white/5 mb-3" />
                <div className="h-3 w-1/2 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : spaces.length === 0 ? (
          /* No spaces: an explanation, not a lone dashed tile. */
          <div className="rounded-2xl border border-white/5 bg-surface-container-lowest/40 py-16 px-6 text-center animate-tab-in">
            <div className="w-16 h-16 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center mx-auto mb-5">
              <Layers className="w-7 h-7 text-primary-fixed-dim" />
            </div>
            <h2 className="font-display text-lg font-medium text-white mb-2">
              You have no study spaces yet
            </h2>
            <p className="font-sans text-sm text-slate-400 max-w-md mx-auto leading-relaxed mb-6">
              Create one for a subject and it opens already filled with the lessons your teachers
              published for your grade level — flashcards, tests and the AI tools work from there.
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans text-sm font-bold hover:bg-primary-fixed transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Plus className="w-4 h-4" />
              Create your first space
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 animate-tab-in">
            {spaces.map((space) => {
              const accent = accentFor(space.subject);

              return (
                <div
                  key={space.id}
                  className="group relative flex flex-col justify-between min-h-[200px] rounded-2xl border bg-surface-container-lowest p-5 sm:p-6 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-within:-translate-y-1"
                  style={{ borderColor: `${accent}33` }}
                >
                  {/* The subject glow, at the default stacking level (behind an opaque card -z-10 is invisible); content uses relative z-10. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-30 group-hover:opacity-60 transition-opacity translate-x-1/3 -translate-y-1/3"
                    style={{ backgroundColor: accent }}
                  />

                  <div className="relative z-10 flex justify-between items-start mb-5 gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        color: accent,
                        backgroundColor: `${accent}1a`,
                        border: `1px solid ${accent}33`,
                      }}
                    >
                      <Folder className="w-5 h-5" />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <SubjectBadge code={space.subject} />

                      {/* Full opacity: touch devices never hover. z-10 keeps them above the title's stretched hit area. */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameClick(space);
                          }}
                          className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
                          title={`Rename ${space.title}`}
                          aria-label={`Rename ${space.title}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(space);
                          }}
                          className="p-2 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                          title={`Delete ${space.title}`}
                          aria-label={`Delete ${space.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10">
                    {/* The title is a real button whose ::after covers the card: one focus stop, whole card clickable; actions sit at z-10. */}
                    <h2 className="font-display text-lg sm:text-xl font-medium text-white mb-2">
                      <button
                        onClick={() => navigate(`/student/space/${space.id}`)}
                        className="text-left cursor-pointer rounded-lg after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <span className="line-clamp-2">{space.title}</span>
                      </button>
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-sans">
                      <span className="truncate">{subjectNameOf(space.subject)}</span>
                      <span aria-hidden="true">•</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3.5 h-3.5" /> {getRelativeTime(space.created_at)}
                      </span>
                    </div>

                    <span
                      className="inline-flex items-center gap-1.5 mt-4 font-sans text-xs font-semibold transition-all group-hover:gap-2.5"
                      style={{ color: accent }}
                    >
                      Open space <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}

          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Space"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateSpace} className="flex flex-col gap-6 max-h-[75vh] overflow-y-auto pr-1 no-scrollbar">
          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Space Title
              </label>
              <input
                type="text"
                value={newSpaceTitle}
                onChange={(e) => setNewSpaceTitle(e.target.value)}
                placeholder="e.g. Science Quarter 2"
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Subject
              </label>
              {/* Dropdown, not a native <select> (which ignores the theme). Validation is unchanged: submit stays disabled without a subject. */}
              <Dropdown
                value={newSpaceSubject}
                onChange={setNewSpaceSubject}
                options={subjectOptions}
                className="w-full"
              />
              {subjectsError ? (
                <p className="mt-1.5 font-sans text-[11px] text-red-400 leading-relaxed">
                  The subject list couldn't be loaded, so a space can't be created right now. Check
                  your connection and reopen this page.
                </p>
              ) : (
                <p className="mt-1.5 font-sans text-[11px] text-slate-500 leading-relaxed">
                  Your space will open with the materials your teachers published for this subject at
                  your grade level. You can have one space per subject, and the subject can't be
                  changed later.
                </p>
              )}
            </div>

            {createError && (
              <p className="font-sans text-[12px] text-red-400">{createError}</p>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 border-t border-white/5 mt-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newSpaceTitle.trim() || !newSpaceSubject || isCreating}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCreating && <Spinner className="w-4 h-4" />}
              {isCreating ? 'Creating…' : 'Create Space'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename modal */}
      <Modal
        isOpen={isRenameModalOpen}
        onClose={() => {
          setIsRenameModalOpen(false);
          setSelectedSpaceToRename(null);
        }}
        title="Rename Study Space"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleRenameSubmit} className="flex flex-col gap-6 max-h-[75vh] overflow-y-auto pr-1 no-scrollbar">
          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                New Space Title
              </label>
              <input
                type="text"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder="e.g. Biology 101 Midterm Prep"
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                required
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 border-t border-white/5 mt-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsRenameModalOpen(false);
                setSelectedSpaceToRename(null);
              }}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!renameTitle.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setSelectedSpaceToDelete(null);
        }}
        title="Delete Study Space"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner">
            <Trash2 className="w-5 h-5" />
          </div>

          <div className="space-y-2">
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-white">"{selectedSpaceToDelete?.title}"</span>? This action cannot be undone.
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setSelectedSpaceToDelete(null);
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
