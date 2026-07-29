import { useState, useEffect, FormEvent } from 'react';
import { Layers, Plus, Folder, Clock, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { SUBJECTS, subjectName } from '../../data/mockEducator';
import SubjectBadge from '../../components/educator/SubjectBadge';

import Modal from '../../components/ui/Modal';

/**
 * A study space covers exactly one subject, chosen at creation and fixed
 * afterwards. On creation the server fills the space with every material the
 * student's educators published for that subject at their grade level, so a new
 * space is never empty by the time the student opens it.
 */
interface StudySpaceData {
  id: string;
  title: string;
  subject: string;
  created_at: string;
}

const colorPalettes = [
  { color: 'from-emerald-500/25 to-teal-500/10', borderColor: 'border-emerald-500/30' },
  { color: 'from-purple-500/25 to-fuchsia-500/10', borderColor: 'border-purple-500/30' },
  { color: 'from-amber-500/25 to-orange-500/10', borderColor: 'border-amber-500/30' },
  { color: 'from-blue-500/25 to-indigo-500/10', borderColor: 'border-blue-500/30' },
  { color: 'from-rose-500/25 to-pink-500/10', borderColor: 'border-rose-500/30' },
];



export default function StudySpacesList() {
  const navigate = useNavigate();

  const [spaces, setSpaces] = useState<StudySpaceData[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  // Modals & Forms State
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

  // Peer study-space cloning (CollabShare) was removed by migration 0003 — it
  // contradicts the paper's guarantee that each student's data stays isolated.

  const handleCreateSpace = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSpaceTitle.trim() || !newSpaceSubject) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      // The server fills the new space with every material published to this
      // subject at the student's grade level, so it opens ready to study.
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
    <div className="flex-1 w-full bg-background p-6 md:p-12 overflow-y-auto relative">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30">
                <Layers className="text-primary-fixed-dim w-5 h-5" />
              </div>
              <h1 className="font-display text-3xl font-semibold text-on-surface">Study Spaces</h1>
            </div>
            <p className="font-sans text-on-surface-variant max-w-2xl text-sm">
              One space per subject. Each opens with the materials your teachers published for your
              grade level, ready for the AI study tools.
            </p>
          </div>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400 bg-surface-container/10 border border-white/5 rounded-2xl">
            <Loader2 className="w-6 h-6 animate-spin text-primary-fixed-dim" />
            <span className="font-sans text-sm">Loading study spaces...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Create Card */}
            <div
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-surface-container-lowest/30 border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary-fixed-dim/50 hover:bg-primary-fixed-dim/5 transition-all min-h-[220px]"
            >
              <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
                <Plus className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="font-display text-lg font-medium text-white mb-2">Create New Space</h3>
              <p className="font-sans text-sm text-slate-400 max-w-[200px]">Set up a dedicated workspace for your next exam or topic.</p>
            </div>

            {spaces.map((space, index) => {
              const palette = colorPalettes[index % colorPalettes.length];

              return (
                <div
                  key={space.id}
                  onClick={() => navigate(`/student/space/${space.id}`)}
                  className={`bg-surface-container-lowest rounded-2xl border ${palette.borderColor} p-6 cursor-pointer hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group hover:shadow-xl hover:shadow-primary-fixed-dim/5 flex flex-col justify-between min-h-[220px]`}
                >
                  <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${palette.color} blur-3xl opacity-50 group-hover:opacity-100 transition-opacity -z-10 rounded-full translate-x-1/2 -translate-y-1/2`}></div>

                  <div className="flex justify-between items-start mb-6">
                    <div className="w-12 h-12 rounded-xl border border-white/5 flex items-center justify-center bg-surface-container text-slate-300">
                      <Folder className="w-6 h-6" />
                    </div>

                    <div className="flex items-center gap-2">
                      <SubjectBadge code={space.subject} />

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameClick(space);
                          }}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                          title="Rename Space"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(space);
                          }}
                          className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all"
                          title="Delete Space"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <h2 className="font-display text-xl font-medium text-white mb-2">{space.title}</h2>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-2 font-sans">
                    <span>{subjectName(space.subject)}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {getRelativeTime(space.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
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
              <select
                value={newSpaceSubject}
                onChange={(e) => setNewSpaceSubject(e.target.value)}
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                required
              >
                <option value="" disabled>Choose a subject…</option>
                {SUBJECTS.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <p className="mt-1.5 font-sans text-[11px] text-slate-500 leading-relaxed">
                Your space will open with the materials your teachers published for this subject at
                your grade level. The subject can't be changed later.
              </p>
            </div>

            {createError && (
              <p className="font-sans text-[12px] text-red-400">{createError}</p>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-white/5 mt-2 shrink-0">
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
              {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
              {isCreating ? 'Creating…' : 'Create Space'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename Modal */}
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

          <div className="flex gap-3 pt-4 border-t border-white/5 mt-2 shrink-0">
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

      {/* Delete Confirmation Modal */}
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

          <div className="flex gap-3 justify-end pt-2">
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
