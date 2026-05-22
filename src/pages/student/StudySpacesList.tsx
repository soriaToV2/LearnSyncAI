import { useState, FormEvent } from 'react';
import { Layers, Plus, Folder, ArrowRight, Clock, Star, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';


export default function StudySpacesList() {
  const navigate = useNavigate();

  const [spaces, setSpaces] = useState([
    {
      id: 'space-1',
      title: 'Biology 101 Prep',
      courseInfo: 'Biology 301',
      lastModified: '2 hours ago',
      flashcardsCount: 42,
      color: 'from-emerald-500/20 to-teal-500/20',
      borderColor: 'border-emerald-500/30'
    },
    {
      id: 'space-2',
      title: 'History Midterm Review',
      courseInfo: 'World History',
      lastModified: '1 day ago',
      flashcardsCount: 156,
      color: 'from-purple-500/20 to-fuchsia-500/20',
      borderColor: 'border-purple-500/30'
    },
    {
      id: 'space-3',
      title: 'Physics Vectors',
      courseInfo: 'Physics 201',
      lastModified: '3 days ago',
      flashcardsCount: 24,
      color: 'from-amber-500/20 to-orange-500/20',
      borderColor: 'border-amber-500/30'
    }
  ]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newSpaceTitle, setNewSpaceTitle] = useState('');
  const [newSpaceCourse, setNewSpaceCourse] = useState('');

  const handleCreateSpace = (e: FormEvent) => {
    e.preventDefault();
    if (!newSpaceTitle.trim() || !newSpaceCourse.trim()) return;

    const newSpace = {
      id: `space-${Date.now()}`,
      title: newSpaceTitle,
      courseInfo: newSpaceCourse,
      lastModified: 'Just now',
      flashcardsCount: 0,
      hasAR: false,
      color: 'from-blue-500/20 to-indigo-500/20',
      borderColor: 'border-blue-500/30'
    };

    setSpaces([newSpace, ...spaces]);
    setIsCreateModalOpen(false);
    setNewSpaceTitle('');
    setNewSpaceCourse('');
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
              <h1 className="font-display text-3xl font-semibold text-on-surface">My Study Spaces</h1>
            </div>
            <p className="font-sans text-on-surface-variant max-w-2xl text-sm">
              Create dedicated workspaces for your courses to organize flashcards, notes, and study resources.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Empty Create Card */}
          <div 
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-surface-container-lowest/30 border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary-fixed-dim/50 hover:bg-primary-fixed-dim/5 transition-all min-h-[280px]"
          >
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <Plus className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="font-display text-lg font-medium text-white mb-2">Create New Space</h3>
            <p className="font-sans text-sm text-slate-400 max-w-[200px]">Set up a dedicated workspace for your next exam or topic.</p>
          </div>
          
          {spaces.map((space) => (
            <div
              key={space.id}
              onClick={() => navigate(`/student/space/${space.id}`)}
              className={`bg-surface-container-lowest rounded-2xl border ${space.borderColor} p-6 cursor-pointer hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden group hover:shadow-xl hover:shadow-primary-fixed-dim/5`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${space.color} blur-3xl opacity-50 group-hover:opacity-100 transition-opacity -z-10 rounded-full translate-x-1/2 -translate-y-1/2`}></div>

              <div className="flex justify-between items-start mb-6">
                <div className="w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center">
                  <Folder className="w-6 h-6 text-slate-300" />
                </div>
              </div>

              <h2 className="font-display text-xl font-medium text-white mb-2">{space.title}</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-8 font-sans">
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5" /> {space.courseInfo}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {space.lastModified}
                </span>
              </div>

              <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                <div className="flex text-xs font-semibold uppercase tracking-widest text-primary-fixed-dim gap-2 items-center">
                  <Sparkles className="w-4 h-4" /> {space.flashcardsCount} Cards
                </div>
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary-fixed-dim/20 transition-colors">
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <h2 className="font-display text-xl font-semibold text-white">Create New Space</h2>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateSpace} className="p-6">
              <div className="space-y-4">
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
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Course Information
                  </label>
                  <input 
                    type="text" 
                    value={newSpaceCourse}
                    onChange={(e) => setNewSpaceCourse(e.target.value)}
                    placeholder="e.g. Biology 301"
                    className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                    required
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newSpaceTitle.trim() || !newSpaceCourse.trim()}
                  className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Space
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
