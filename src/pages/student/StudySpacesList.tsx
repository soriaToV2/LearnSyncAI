import { useState, useEffect, FormEvent } from 'react';
import { Layers, Plus, Folder, Clock, Star, Sparkles, X, Share2, Pencil, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MOCK_PUBLIC_SPACES } from '../../data/mockPublicSpaces';
import { api } from '../../lib/api';
import Dropdown from '../../components/ui/Dropdown';
import Modal from '../../components/ui/Modal';


interface CourseData {
  id: string;
  courseCode?: string;
  section?: string;
  title: string;
  instructor: string;
  isEnrolled: boolean;
  accentColor: string;
}

interface StudySpaceData {
  id: string;
  title: string;
  course_id: string | null;
  cloned_from_id: string | null;
  original_author_name: string | null;
  created_at: string;
  is_published: boolean;
  share_token: string;
}

const colorPalettes = [
  { color: 'from-emerald-500/25 to-teal-500/10', borderColor: 'border-emerald-500/30' },
  { color: 'from-purple-500/25 to-fuchsia-500/10', borderColor: 'border-purple-500/30' },
  { color: 'from-amber-500/25 to-orange-500/10', borderColor: 'border-amber-500/30' },
  { color: 'from-blue-500/25 to-indigo-500/10', borderColor: 'border-blue-500/30' },
  { color: 'from-rose-500/25 to-pink-500/10', borderColor: 'border-rose-500/30' },
];

const formatCourseLabel = (courseCode?: string, title?: string) => {
  if (!title) return 'Untitled Course';
  if (!courseCode) return title;
  const titleClean = title.trim();
  const codeClean = courseCode.trim();
  if (titleClean.toLowerCase().startsWith(codeClean.toLowerCase())) {
    return titleClean;
  }
  return `${codeClean} - ${titleClean}`;
};

export default function StudySpacesList() {
  const navigate = useNavigate();

  const [spaces, setSpaces] = useState<StudySpaceData[]>([]);
  const [courses, setCourses] = useState<CourseData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cloneToast, setCloneToast] = useState<string | null>(null);

  // Modals & Forms State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newSpaceTitle, setNewSpaceTitle] = useState('');
  const [newSpaceCourse, setNewSpaceCourse] = useState('');

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

  const fetchCourses = async () => {
    try {
      const res = await api.get<any[]>('/courses');
      const mapped = (res.data || []).map((c: any, index: number) => {
        const colors = ['primary-fixed-dim', 'indigo-400', 'emerald-400'];
        return {
          id: c.id,
          courseCode: c.course_code,
          section: c.section,
          title: (() => {
            const rawTitle = c.course_title || c.title || 'Untitled Course';
            const code = c.course_code;
            if (code && rawTitle.toUpperCase().startsWith(`${code.toUpperCase()} - `)) {
              return rawTitle.substring(code.length + 3);
            } else if (code && rawTitle.toUpperCase().startsWith(`${code.toUpperCase()}-`)) {
              return rawTitle.substring(code.length + 1);
            }
            return rawTitle;
          })(),
          instructor: c.profiles ? `${c.profiles.first_name} ${c.profiles.last_name}` : 'Unknown Instructor',
          isEnrolled: true,
          accentColor: colors[index % colors.length]
        };
      });
      setCourses(mapped);
    } catch (err) {
      console.error('Failed to load enrolled courses', err);
    }
  };

  const initData = async () => {
    setIsLoading(true);
    await Promise.all([fetchSpaces(), fetchCourses()]);
    setIsLoading(false);
  };

  useEffect(() => {
    initData();
  }, []);

  // Cloning logic from query params
  useEffect(() => {
    const checkAndClone = async () => {
      const params = new URLSearchParams(window.location.search);
      const cloneId = params.get('clone');
      if (!cloneId) return;

      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cloneId);

      if (isUuid) {
        // Real Published Study Space
        try {
          // Fetch target space info to get title and creator details
          const res = await api.get<StudySpaceData>(`/spaces/${cloneId}`);
          const targetSpace = res.data;

          if (targetSpace) {
            // Check if already cloned
            const exists = spaces.some((s) => s.cloned_from_id === cloneId);
            if (exists) {
              setCloneToast(`"${targetSpace.title}" is already in your Study Spaces.`);
              setTimeout(() => setCloneToast(null), 4500);
            } else {
              await api.post('/spaces', {
                title: targetSpace.title,
                cloned_from_id: cloneId,
                original_author_name: targetSpace.original_author_name || 'Peer'
              });
              await fetchSpaces();
              setCloneToast(`Successfully cloned "${targetSpace.title}"!`);
              setTimeout(() => setCloneToast(null), 4500);
            }
          }
        } catch (err: any) {
          setCloneToast(err.response?.data?.error || 'Failed to clone study space.');
          setTimeout(() => setCloneToast(null), 4500);
        }
      } else {
        // Mock Public Study Space
        const publicSpace = MOCK_PUBLIC_SPACES[cloneId];
        if (publicSpace) {
          const exists = spaces.some((s) => s.title === publicSpace.title && s.original_author_name === publicSpace.authorName);
          if (exists) {
            setCloneToast(`"${publicSpace.title}" is already in your Study Spaces.`);
            setTimeout(() => setCloneToast(null), 4500);
          } else {
            try {
              // 1. Create Space
              const resSpace = await api.post<StudySpaceData>('/spaces', {
                title: publicSpace.title,
                original_author_name: publicSpace.authorName
              });

              if (resSpace.data && resSpace.data.id) {
                // 2. Create Deck
                const resDeck = await api.post<any>(`/spaces/${resSpace.data.id}/decks`, {
                  title: 'Main Deck',
                  description: publicSpace.description || 'Cloned flashcard deck.'
                });

                if (resDeck.data && resDeck.data.id) {
                  // 3. Create all flashcards
                  for (const card of publicSpace.flashcards) {
                    await api.post(`/spaces/${resSpace.data.id}/decks/${resDeck.data.id}/flashcards`, {
                      term: card.front,
                      definition: card.back
                    });
                  }
                }
              }

              await fetchSpaces();
              setCloneToast(`Successfully cloned "${publicSpace.title}" by ${publicSpace.authorName}!`);
              setTimeout(() => setCloneToast(null), 4500);
            } catch (err) {
              console.error('Failed to clone mock space', err);
              setCloneToast('Failed to clone public study space.');
              setTimeout(() => setCloneToast(null), 4500);
            }
          }
        }
      }

      // Clean URL params
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    };

    if (!isLoading) {
      checkAndClone();
    }
  }, [isLoading]);

  const handleCreateSpace = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSpaceTitle.trim()) return;

    try {
      await api.post('/spaces', {
        title: newSpaceTitle.trim(),
        course_id: newSpaceCourse || null
      });
      await fetchSpaces();
      setIsCreateModalOpen(false);
      setNewSpaceTitle('');
      setNewSpaceCourse('');
    } catch (err) {
      console.error('Failed to create study space', err);
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
      {cloneToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-3 bg-surface-container-high border border-teal-500/35 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <span className="font-sans text-sm text-white font-medium">
              {cloneToast}
            </span>
          </div>
        </div>
      )}

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
              Your private, self-paced workspaces featuring cognitive AI study tools and secure peer synchronization.
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
              const isCloned = !!(space.cloned_from_id || space.original_author_name);
              const course = courses.find(c => c.id === space.course_id);
              const courseText = course ? formatCourseLabel(course.courseCode, course.title) : 'Independent Study';

              return (
                <div
                  key={space.id}
                  onClick={() => navigate(`/student/space/${space.id}`)}
                  className={`bg-surface-container-lowest rounded-2xl border ${palette.borderColor} p-6 cursor-pointer hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group hover:shadow-xl hover:shadow-primary-fixed-dim/5 flex flex-col justify-between min-h-[220px]`}
                >
                  <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${palette.color} blur-3xl opacity-50 group-hover:opacity-100 transition-opacity -z-10 rounded-full translate-x-1/2 -translate-y-1/2`}></div>

                  <div className="flex justify-between items-start mb-6">
                    <div className={`w-12 h-12 rounded-xl border border-white/5 flex items-center justify-center ${isCloned ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim border-primary-fixed-dim/20' : 'bg-surface-container text-slate-300'}`}>
                      <Folder className="w-6 h-6" />
                    </div>

                    <div className="flex items-center gap-2">
                      {isCloned ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-teal-500/10 border border-teal-500/25 text-teal-400 text-[10px] font-sans font-bold uppercase tracking-wider shadow-sm shadow-teal-500/5">
                          <Share2 className="w-3 h-3 shrink-0" /> Cloned from {space.original_author_name || 'Peer'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-500/10 border border-white/5 text-slate-400 text-[10px] font-sans font-bold uppercase tracking-wider">
                          Created by you
                        </span>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {!isCloned && (
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
                        )}
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
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-primary-fixed-dim" /> {courseText}
                    </span>
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
                placeholder="e.g. Biology 101 Prep"
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 font-sans">
                Link to Enrolled Course
              </label>
              <Dropdown
                value={newSpaceCourse}
                onChange={setNewSpaceCourse}
                options={[
                  { label: 'Independent Study (No Course Link)', value: '' },
                  ...courses.map(c => ({
                    label: formatCourseLabel(c.courseCode, c.title),
                    value: c.id
                  }))
                ]}
                className="w-full text-left"
              />
            </div>
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
              disabled={!newSpaceTitle.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Space
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
