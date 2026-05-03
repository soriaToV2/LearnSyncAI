import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Search, Globe, Building, ArrowRight, ShieldCheck, Sigma, Code2, BrainCircuit } from 'lucide-react';

export default function StudentDashboard() {
  const [activeTab, setActiveTab] = useState<'enrolled' | 'internal' | 'global'>('enrolled');

  return (
    <>
      {/* TopAppBar */}
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/50 backdrop-blur-md shadow-none flex justify-between items-center h-16 px-8 z-40">
        <div className="flex-1 max-w-md">
          <div className="relative flex items-center focus-within:ring-1 focus-within:ring-primary-fixed-dim/50 rounded-full bg-surface-container/50 px-4 py-2 border border-white/5">
            <Search className="text-on-surface-variant w-5 h-5 mr-2" />
            <input 
              type="text" 
              placeholder="Search courses, universities..." 
              className="bg-transparent border-none focus:ring-0 text-on-surface font-sans text-sm w-full placeholder:text-on-surface-variant/50 outline-none" 
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
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
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
        {/* Welcome Banner */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 bg-surface-container rounded-2xl p-8 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary-fixed-dim/10 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none"></div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 rounded-full bg-secondary-container/20 text-secondary-container border border-secondary-container/30 font-sans font-semibold text-[12px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5" />
                MIT Student
              </span>
            </div>
            <h2 className="font-display text-4xl font-semibold text-on-surface mb-2">Welcome back, Sarah.</h2>
            <p className="font-sans text-base text-on-surface-variant">Your cognitive research environment is updated and ready.</p>
          </div>
          
          <div className="relative z-10 flex gap-4">
             <div className="text-center px-6 border-r border-white/10">
               <p className="font-display text-3xl font-semibold text-primary-fixed-dim">3</p>
               <p className="font-sans text-xs text-on-surface-variant mt-1 uppercase tracking-wider">Active Courses</p>
             </div>
             <div className="text-center px-4">
               <p className="font-display text-3xl font-semibold text-secondary-container">12</p>
               <p className="font-sans text-xs text-on-surface-variant mt-1 uppercase tracking-wider">Badges Earned</p>
             </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-white/10 mb-8 flex gap-8">
          <button 
            className={`pb-3 font-display text-[15px] transition-colors border-b-2 ${activeTab === 'enrolled' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}
            onClick={() => setActiveTab('enrolled')}
          >
            My Enrolled Courses
          </button>
          <button 
            className={`pb-3 font-display text-[15px] transition-colors border-b-2 ${activeTab === 'internal' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}
            onClick={() => setActiveTab('internal')}
          >
            Internal Courses
          </button>
          <button 
            className={`pb-3 font-display text-[15px] transition-colors border-b-2 ${activeTab === 'global' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant border-transparent hover:text-on-surface'}`}
            onClick={() => setActiveTab('global')}
          >
            Global Network
          </button>
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1 */}
          <Link to="/student/course/bio-301" className="block glass-card rounded-xl p-6 relative overflow-hidden group hover:border-primary-fixed-dim/40 transition-colors duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary-fixed-dim/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-primary-fixed-dim/20 transition-colors"></div>
            
            <div className="relative z-10 flex justify-between items-start mb-4">
              <span className="px-2.5 py-1 rounded-md bg-secondary-container/10 text-secondary-container border border-secondary-container/20 font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Building className="w-3 h-3" />
                MIT
              </span>
              <span className="px-2.5 py-1 rounded-md bg-surface-bright border border-white/5 text-on-surface-variant font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Internal
              </span>
            </div>

            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center mb-4 border border-primary-fixed-dim/20 text-primary-fixed-dim">
                <BrainCircuit className="w-6 h-6" />
              </div>
              <h3 className="font-display text-xl font-medium text-on-surface mb-1 group-hover:text-primary-fixed-dim transition-colors">Advanced Neurobiology</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Prof. Elias Vance</p>
              
              <div className="w-full bg-surface-container-high rounded-full h-1.5 mb-2">
                <div className="bg-primary-fixed-dim h-1.5 rounded-full" style={{ width: '45%' }}></div>
              </div>
              <div className="flex justify-between text-[11px] font-sans text-on-surface-variant uppercase tracking-wider font-semibold">
                <span>45% Complete</span>
                <span className="flex items-center gap-1 group-hover:text-primary-fixed-dim transition-colors">
                  Continue <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </Link>

          {/* Card 2 */}
          <Link to="/student/course/phys-401" className="block glass-card rounded-xl p-6 relative overflow-hidden group hover:border-indigo-400/40 transition-colors duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-indigo-500/20 transition-colors"></div>
            
            <div className="relative z-10 flex justify-between items-start mb-4">
              <span className="px-2.5 py-1 rounded-md bg-white/5 text-slate-300 border border-white/10 font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Building className="w-3 h-3" />
                Stanford
              </span>
              <span className="px-2.5 py-1 rounded-md bg-primary-container/10 border border-primary-container/20 text-primary-container font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Globe className="w-3 h-3" />
                Global
              </span>
            </div>

            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-indigo-400/10 flex items-center justify-center mb-4 border border-indigo-400/20 text-indigo-400">
                <Sigma className="w-6 h-6" />
              </div>
              <h3 className="font-display text-xl font-medium text-on-surface mb-1 group-hover:text-indigo-400 transition-colors">Quantum Mechanics II</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Prof. Sarah Chen</p>
              
              <div className="w-full bg-surface-container-high rounded-full h-1.5 mb-2">
                <div className="bg-indigo-400 h-1.5 rounded-full" style={{ width: '80%' }}></div>
              </div>
              <div className="flex justify-between text-[11px] font-sans text-on-surface-variant uppercase tracking-wider font-semibold">
                <span>80% Complete</span>
                <span className="flex items-center gap-1 group-hover:text-indigo-400 transition-colors">
                  Continue <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </Link>

          {/* Card 3 */}
          <Link to="/student/course/cs-202" className="block glass-card rounded-xl p-6 relative overflow-hidden group hover:border-emerald-400/40 transition-colors duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-emerald-500/20 transition-colors"></div>
            
            <div className="relative z-10 flex justify-between items-start mb-4">
              <span className="px-2.5 py-1 rounded-md bg-secondary-container/10 text-secondary-container border border-secondary-container/20 font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Building className="w-3 h-3" />
                MIT
              </span>
              <span className="px-2.5 py-1 rounded-md bg-surface-bright border border-white/5 text-on-surface-variant font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Internal
              </span>
            </div>

            <div className="relative z-10">
              <div className="w-12 h-12 rounded-lg bg-emerald-400/10 flex items-center justify-center mb-4 border border-emerald-400/20 text-emerald-400">
                <Code2 className="w-6 h-6" />
              </div>
              <h3 className="font-display text-xl font-medium text-on-surface mb-1 group-hover:text-emerald-400 transition-colors">Algorithms & Data Structures</h3>
              <p className="font-sans text-sm text-on-surface-variant mb-6">Prof. Alan Turing</p>
              
              <div className="w-full bg-surface-container-high rounded-full h-1.5 mb-2">
                <div className="bg-emerald-400 h-1.5 rounded-full" style={{ width: '15%' }}></div>
              </div>
              <div className="flex justify-between text-[11px] font-sans text-on-surface-variant uppercase tracking-wider font-semibold">
                <span>15% Complete</span>
                <span className="flex items-center gap-1 group-hover:text-emerald-400 transition-colors">
                  Continue <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          </Link>

        </div>
      </main>
    </>
  );
}
