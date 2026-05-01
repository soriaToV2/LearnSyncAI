import ClassroomLayout from '../../components/layout/ClassroomLayout';
import { Filter, UserMinus } from 'lucide-react';

export default function ClassroomStudents() {
  return (
    <ClassroomLayout>
      <div className="space-y-6">
        {/* Controls Bar */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2 border-b border-transparent">
            {/* These act like sub-tabs based on the design, though they look like pills in image 6 */}
            <button className="px-4 py-1.5 rounded-full bg-surface-container-high text-on-surface border border-white/10 font-sans font-semibold text-[12px] uppercase">All</button>
            <button className="px-4 py-1.5 rounded-full text-slate-400 hover:text-on-surface border border-transparent font-sans font-semibold text-[12px] uppercase transition-colors">At Risk</button>
            <button className="px-4 py-1.5 rounded-full text-slate-400 hover:text-on-surface border border-transparent font-sans font-semibold text-[12px] uppercase transition-colors">Excelling</button>
          </div>
          
          <div>
            <button className="flex items-center gap-2 text-slate-400 hover:text-primary-fixed-dim transition-colors font-sans text-sm">
              <Filter className="w-4 h-4" />
              Filter
            </button>
          </div>
        </div>

        {/* Students Rows */}
        <div className="space-y-3">
          
          {/* Student Row 1 */}
          <div className="flex items-center justify-between p-4 rounded-xl glass-card hover:border-white/20 transition-all group">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img 
                  src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" 
                  alt="Student Avatar" 
                  className="w-12 h-12 rounded-full object-cover border-2 border-surface-container" 
                />
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-surface-container"></div>
              </div>
              <div>
                <h3 className="font-display text-lg text-on-surface font-semibold">Sarah Jenkins</h3>
                <p className="font-sans text-sm text-on-surface-variant flex items-center gap-2">
                  <span>ID: NL-2049</span>
                  <span className="w-1 h-1 rounded-full bg-white/20"></span>
                  <span className="text-primary-fixed-dim">Cognitive Psych Track</span>
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="font-sans text-sm text-on-surface-variant">Avg Grade</p>
                <p className="font-display text-lg font-medium text-on-surface">94%</p>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block"></div>
              <button className="px-4 py-2 rounded-lg border border-error/20 text-error hover:bg-error/10 hover:border-error/40 transition-all font-sans text-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 focus:opacity-100">
                <UserMinus className="w-4 h-4" />
                Kick Student
              </button>
            </div>
          </div>

          {/* Student Row 2 */}
          <div className="flex items-center justify-between p-4 rounded-xl glass-card hover:border-white/20 transition-all group">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img 
                  src="https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=150" 
                  alt="Student Avatar" 
                  className="w-12 h-12 rounded-full object-cover border-2 border-surface-container" 
                />
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-surface-container"></div>
              </div>
              <div>
                <h3 className="font-display text-lg text-on-surface font-semibold">Marcus Thorne</h3>
                <p className="font-sans text-sm text-on-surface-variant flex items-center gap-2">
                  <span>ID: NL-2051</span>
                  <span className="w-1 h-1 rounded-full bg-white/20"></span>
                  <span className="text-primary-fixed-dim">Neurobiology Track</span>
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="font-sans text-sm text-on-surface-variant">Avg Grade</p>
                <p className="font-display text-lg font-medium text-on-surface">88%</p>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block"></div>
              <button className="px-4 py-2 rounded-lg border border-error/20 text-error hover:bg-error/10 hover:border-error/40 transition-all font-sans text-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 focus:opacity-100">
                <UserMinus className="w-4 h-4" />
                Kick Student
              </button>
            </div>
          </div>

          {/* Student Row 3 */}
          <div className="flex items-center justify-between p-4 rounded-xl glass-card hover:border-white/20 transition-all group">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface font-display text-lg font-semibold border-2 border-surface-container">
                  EL
                </div>
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-amber-500 border-2 border-surface-container"></div>
              </div>
              <div>
                <h3 className="font-display text-lg text-on-surface font-semibold">Elena Rostova</h3>
                <p className="font-sans text-sm text-on-surface-variant flex items-center gap-2">
                  <span>ID: NL-2088</span>
                  <span className="w-1 h-1 rounded-full bg-white/20"></span>
                  <span className="text-slate-400">Undeclared</span>
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="font-sans text-sm text-on-surface-variant">Avg Grade</p>
                <p className="font-display text-lg font-medium text-tertiary-container">72%</p>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block"></div>
              <button className="px-4 py-2 rounded-lg border border-error/20 text-error hover:bg-error/10 hover:border-error/40 transition-all font-sans text-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 focus:opacity-100">
                <UserMinus className="w-4 h-4" />
                Kick Student
              </button>
            </div>
          </div>

          {/* Student Row 4 */}
          <div className="flex items-center justify-between p-4 rounded-xl glass-card hover:border-white/20 transition-all group">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img 
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150" 
                  alt="Student Avatar" 
                  className="w-12 h-12 rounded-full object-cover border-2 border-surface-container" 
                />
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-surface-container"></div>
              </div>
              <div>
                <h3 className="font-display text-lg text-on-surface font-semibold">Aisha Patel</h3>
                <p className="font-sans text-sm text-on-surface-variant flex items-center gap-2">
                  <span>ID: NL-2102</span>
                  <span className="w-1 h-1 rounded-full bg-white/20"></span>
                  <span className="text-primary-fixed-dim">Cognitive Psych Track</span>
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="font-sans text-sm text-on-surface-variant">Avg Grade</p>
                <p className="font-display text-lg font-medium text-on-surface">98%</p>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block"></div>
              <button className="px-4 py-2 rounded-lg border border-error/20 text-error hover:bg-error/10 hover:border-error/40 transition-all font-sans text-sm flex items-center gap-2 opacity-0 group-hover:opacity-100 focus:opacity-100">
                <UserMinus className="w-4 h-4" />
                Kick Student
              </button>
            </div>
          </div>

        </div>
      </div>
    </ClassroomLayout>
  );
}
