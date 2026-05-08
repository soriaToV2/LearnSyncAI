import { useState } from 'react';
import { Bell, MapPin, Building, Users, Star, Award, Search, BrainCircuit, Box } from 'lucide-react';


export default function StudentProfile() {
  const [activeTab, setActiveTab] = useState<'achievements' | 'spaces'>('achievements');

  return (
    <>
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/50 backdrop-blur-md shadow-none flex justify-end items-center h-16 px-8 z-40">
        <div className="flex items-center gap-4 text-slate-400">
          <button className="hover:text-primary-fixed-dim transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 ml-2">
            <img 
              src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150" 
              alt="Student Profile Avatar" 
              className="w-full h-full object-cover" 
            />
          </div>
        </div>
      </header>

      <main className="p-10 max-w-5xl mx-auto w-full">
        {/* Profile Header Area */}
        <div className="mb-12 flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-surface-container ring-2 ring-primary-fixed-dim/30 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
            <img 
              src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=300" 
              alt="Sarah Jenkins" 
              className="w-full h-full object-cover" 
            />
          </div>
          
          <div className="flex-1 text-center md:text-left flex flex-col items-center md:items-start">
            <h1 className="font-display text-4xl font-bold text-on-surface mb-2">Sarah Jenkins</h1>
            
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-6 text-on-surface-variant font-sans text-sm">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/10 border border-secondary-container/20 text-secondary-container font-semibold uppercase tracking-wider text-[11px]">
                <Building className="w-3.5 h-3.5" />
                MIT
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                Cambridge, MA
              </span>
            </div>

            <div className="flex gap-8 mb-6">
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-on-surface">342</p>
                <p className="font-sans text-xs text-on-surface-variant uppercase tracking-widest">Followers</p>
              </div>
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-on-surface">128</p>
                <p className="font-sans text-xs text-on-surface-variant uppercase tracking-widest">Following</p>
              </div>
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-primary-fixed-dim">12</p>
                <p className="font-sans text-xs text-primary-fixed-dim/70 uppercase tracking-widest">Completed</p>
              </div>
            </div>

            <button className="px-8 py-2.5 bg-on-surface text-background rounded-full font-display font-semibold hover:bg-white transition-colors active:scale-95 shadow-md">
              Follow
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar gap-8">
          <button 
            onClick={() => setActiveTab('achievements')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'achievements' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            <Award className="w-4 h-4" /> Achievements
          </button>
          <button 
            onClick={() => setActiveTab('spaces')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'spaces' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
             <Box className="w-4 h-4" /> Public Study Spaces
          </button>
        </div>

        {/* Content */}
        {activeTab === 'achievements' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {/* Badge 1 */}
            <div className="glass-card rounded-2xl p-6 flex flex-col items-center text-center group hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,218,243,0.15)] transition-all duration-300">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-fixed-dim/20 to-primary/5 flex items-center justify-center mb-4 border border-primary-fixed-dim/30 shadow-[inset_0_2px_10px_rgba(0,218,243,0.3)]">
                <BrainCircuit className="w-10 h-10 text-primary-fixed-dim" />
              </div>
              <h4 className="font-display text-sm font-semibold text-on-surface mb-1 leading-tight">Advanced Neurobiology</h4>
              <p className="font-sans text-[10px] uppercase tracking-widest text-secondary-container">MIT</p>
            </div>

            {/* Badge 2 */}
            <div className="glass-card rounded-2xl p-6 flex flex-col items-center text-center group hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(99,102,241,0.15)] transition-all duration-300">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/20 to-indigo-300/5 flex items-center justify-center mb-4 border border-indigo-400/30 shadow-[inset_0_2px_10px_rgba(99,102,241,0.3)]">
                <Award className="w-10 h-10 text-indigo-400" />
              </div>
              <h4 className="font-display text-sm font-semibold text-on-surface mb-1 leading-tight">Cognitive Psychology</h4>
              <p className="font-sans text-[10px] uppercase tracking-widest text-slate-400">Stanford Global</p>
            </div>

             {/* Badge 3 */}
             <div className="glass-card rounded-2xl p-6 flex flex-col items-center text-center group hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(16,185,129,0.15)] transition-all duration-300">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-300/5 flex items-center justify-center mb-4 border border-emerald-400/30 shadow-[inset_0_2px_10px_rgba(16,185,129,0.3)]">
                <Star className="w-10 h-10 text-emerald-400" />
              </div>
              <h4 className="font-display text-sm font-semibold text-on-surface mb-1 leading-tight">Bioethics 101</h4>
              <p className="font-sans text-[10px] uppercase tracking-widest text-secondary-container">MIT</p>
            </div>
            
            {/* Empty Slots */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl p-6 flex flex-col items-center justify-center border-2 border-dashed border-white/5 opacity-50">
                 <div className="w-20 h-20 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
                  <div className="w-6 h-6 rounded-full bg-surface-bright"></div>
                 </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'spaces' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card p-6 rounded-xl border border-primary-fixed-dim/20 hover:border-primary-fixed-dim/50 transition-colors">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-display text-xl font-medium text-on-surface">Synaptic Transmitters Decks</h3>
                <span className="bg-primary-fixed-dim/20 text-primary-fixed-dim px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Top Rated</span>
              </div>
              <p className="text-on-surface-variant text-sm mb-6">45 flashcards focused on neurotransmitter release mechanisms.</p>
              <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4"/> 1.2k Studied</span>
              </div>
            </div>

            <div className="glass-card p-6 rounded-xl border border-white/10 hover:border-white/20 transition-colors">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-display text-xl font-medium text-on-surface">Neuroanatomy Midterm Prep</h3>
              </div>
              <p className="text-on-surface-variant text-sm mb-6">Comprehensive review of brain structures and pathways.</p>
              <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4"/> 840 Studied</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
