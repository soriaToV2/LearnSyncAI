import { Link } from 'react-router-dom';
import { Bell, Settings, Plus, Users, BrainCircuit, Sigma, Code2 } from 'lucide-react';

export default function Dashboard() {
  return (
    <>
      {/* TopAppBar */}
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/50 backdrop-blur-md shadow-none flex justify-end items-center h-16 px-8 z-40">
        <div className="flex items-center gap-4 text-slate-400">
          <button className="hover:text-primary-fixed-dim transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <button className="hover:text-primary-fixed-dim transition-colors">
            <Settings className="w-5 h-5" />
          </button>
          
          <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 ml-2">
            <img 
              src="https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&q=80&w=150" 
              alt="Educator Profile Avatar" 
              className="w-full h-full object-cover" 
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-10 max-w-7xl w-full">
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <h2 className="font-display text-3xl font-semibold text-on-surface mb-2">Active Classrooms</h2>
            <p className="font-sans text-base text-on-surface-variant">Manage your ongoing research and academic cohorts.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button className="bg-primary-container text-on-primary-container font-sans font-semibold text-[12px] tracking-[0.1em] uppercase px-4 py-2 rounded-full hover:bg-primary-fixed transition-colors">
              Create Classroom
            </button>
            <span className="px-3 py-1.5 rounded-full bg-primary-container/10 text-primary-container border border-primary-container/20 font-sans font-semibold text-[12px] tracking-[0.1em] uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-container"></span> 3 Active
            </span>
            <span className="px-3 py-1.5 rounded-full bg-surface-container-high text-on-surface-variant border border-white/10 font-sans font-semibold text-[12px] tracking-[0.1em] uppercase">
              2 Archived
            </span>
          </div>
        </div>

        {/* Bento Grid / Cards Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1 */}
          <Link to="/class/bio-301/resources" className="block bg-surface-container rounded-xl p-6 border border-white/10 relative overflow-hidden group hover:border-primary-container/50 transition-colors duration-300">
            <div className="absolute top-0 right-0 p-6 opacity-10">
              <BrainCircuit className="w-24 h-24 text-primary-fixed-dim group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center mb-6 border border-primary-fixed-dim/20">
                <BrainCircuit className="w-6 h-6 text-primary-fixed-dim" />
              </div>
              <h3 className="font-display text-2xl font-medium text-on-surface mb-1">Neurobiology 301</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Advanced Synaptic Pathways</p>
              
              <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm">
                  <Users className="w-4 h-4" />
                  42 Students
                </div>
                <span className="px-2 py-1 rounded bg-green-500/10 text-green-400 font-sans font-semibold text-[10px] tracking-wider border border-green-500/20 uppercase">
                  IN SESSION
                </span>
              </div>
            </div>
          </Link>

          {/* Card 2 */}
          <Link to="/class/phys-401/resources" className="block bg-surface-container rounded-xl p-6 border border-white/10 relative overflow-hidden group hover:border-indigo-500/50 transition-colors duration-300">
            <div className="absolute top-0 right-0 p-6 opacity-10">
              <Sigma className="w-24 h-24 text-indigo-400 group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-indigo-400/10 flex items-center justify-center mb-6 border border-indigo-400/20">
                <Sigma className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="font-display text-2xl font-medium text-on-surface mb-1">Quantum Physics</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Wave Mechanics & Entanglement</p>
              
              <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm">
                  <Users className="w-4 h-4" />
                  28 Students
                </div>
                <span className="px-2 py-1 rounded bg-surface-bright text-on-surface-variant font-sans font-semibold text-[10px] tracking-wider border border-white/10 uppercase">
                  NEXT: 14:00
                </span>
              </div>
            </div>
          </Link>

          {/* Card 3 */}
          <Link to="/class/cs-202/resources" className="block bg-surface-container rounded-xl p-6 border border-white/10 relative overflow-hidden group hover:border-emerald-500/50 transition-colors duration-300">
            <div className="absolute top-0 right-0 p-6 opacity-10">
              <Code2 className="w-24 h-24 text-emerald-400 group-hover:scale-110 transition-transform duration-500" />
            </div>
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20">
                <Code2 className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="font-display text-2xl font-medium text-on-surface mb-1">Algorithms Lab</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Data Structures II</p>
              
              <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm">
                  <Users className="w-4 h-4" />
                  64 Students
                </div>
                <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 font-sans font-semibold text-[10px] tracking-wider border border-amber-500/20 uppercase">
                  GRADING
                </span>
              </div>
            </div>
          </Link>

          {/* Card 4: New Classroom Placeholder */}
          <button className="rounded-xl p-6 border-2 border-dashed border-white/10 bg-surface-container-low/50 hover:bg-surface-container/50 hover:border-white/20 transition-all duration-300 flex flex-col items-center justify-center cursor-pointer min-h-[220px] group">
            <div className="w-12 h-12 rounded-full bg-surface-bright flex items-center justify-center mb-4 text-on-surface-variant group-hover:text-on-surface transition-colors">
              <Plus className="w-6 h-6" />
            </div>
            <span className="font-display text-2xl font-medium text-on-surface-variant group-hover:text-on-surface transition-colors">New Classroom</span>
          </button>
          
        </div>
      </main>
    </>
  );
}
