import { useState } from 'react';
import { Layers, Plus, Folder, ArrowRight, Clock, Star, Box, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';


export default function StudySpacesList() {
  const navigate = useNavigate();
  
  const [spaces] = useState([
    {
      id: 'space-1',
      title: 'Biology 101 Prep',
      courseInfo: 'Biology 301',
      lastModified: '2 hours ago',
      flashcardsCount: 42,
      hasAR: true,
      color: 'from-emerald-500/20 to-teal-500/20',
      borderColor: 'border-emerald-500/30'
    },
    {
      id: 'space-2',
      title: 'History Midterm Review',
      courseInfo: 'World History',
      lastModified: '1 day ago',
      flashcardsCount: 156,
      hasAR: false,
      color: 'from-purple-500/20 to-fuchsia-500/20',
      borderColor: 'border-purple-500/30'
    },
    {
      id: 'space-3',
      title: 'Physics Vectors',
      courseInfo: 'Physics 201',
      lastModified: '3 days ago',
      flashcardsCount: 24,
      hasAR: true,
      color: 'from-amber-500/20 to-orange-500/20',
      borderColor: 'border-amber-500/30'
    }
  ]);

  return (
    <div className="flex-1 w-full bg-background p-6 md:p-12 overflow-y-auto">
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
              Create dedicated workspaces for your courses to organize flashcards, notes, and interactive 3D holograms.
            </p>
          </div>
          
          <button className="h-12 px-6 bg-primary-fixed-dim hover:bg-primary-container text-on-primary-fixed font-sans font-bold text-sm uppercase tracking-wider rounded-xl transition-all shadow-[0_0_20px_rgba(0,218,243,0.2)] hover:shadow-[0_0_30px_rgba(0,218,243,0.4)] flex items-center gap-3 shrink-0">
            <Plus className="w-5 h-5" />
            New Space
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                {space.hasAR && (
                  <div className="px-3 py-1 rounded-full bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-primary-fixed">
                    <Box className="w-3 h-3" />
                    AR Ready
                  </div>
                )}
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

          {/* Empty Create Card */}
          <div className="bg-surface-container-lowest/30 border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary-fixed-dim/50 hover:bg-primary-fixed-dim/5 transition-all min-h-[280px]">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
               <Plus className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="font-display text-lg font-medium text-white mb-2">Create New Space</h3>
            <p className="font-sans text-sm text-slate-400 max-w-[200px]">Set up a dedicated workspace for your next exam or topic.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
