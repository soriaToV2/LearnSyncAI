import ClassroomLayout from '../../components/layout/ClassroomLayout';
import { MoreVertical, Calendar, ListOrdered, Rocket, Edit3, PlusCircle } from 'lucide-react';

export default function ClassroomQuizzes() {
  return (
    <ClassroomLayout>
      <div className="mb-6 flex justify-end">
        <button className="shrink-0 px-6 py-3 bg-primary-container text-on-primary-container rounded-lg font-display text-base font-semibold hover:bg-primary-fixed transition-all duration-300 flex items-center justify-center gap-2 active:scale-95">
          <PlusCircle className="w-5 h-5" />
          Create Assessment
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Assessment Card 1: Ready */}
        <article className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-primary-fixed-dim/40 transition-all duration-300 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-fixed-dim/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-primary-fixed-dim/20 transition-colors"></div>
          
          <div>
            <div className="flex justify-between items-start mb-4 relative z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[11px] border border-primary-fixed-dim/30 uppercase tracking-[0.1em]">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim shadow-[0_0_5px_rgba(0,218,243,0.5)]"></span>
                Ready
              </span>
              <button className="text-on-surface-variant hover:text-primary-fixed-dim transition-colors p-1">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <h3 className="font-display text-[22px] font-medium text-on-surface mb-2 group-hover:text-primary-fixed-dim transition-colors relative z-10">
              Midterm: Neural Firing
            </h3>
            <p className="font-sans text-sm text-on-surface-variant mb-6 line-clamp-2 relative z-10">
              Comprehensive assessment covering chapters 1-4, focusing on action potentials, ion channels, and synaptic transmission.
            </p>

            <div className="flex flex-col gap-3 mb-6 relative z-10">
              <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                <Calendar className="w-5 h-5 text-primary-fixed-dim" />
                <span>Deadline: Oct 15, 2023 • 11:59 PM</span>
              </div>
              <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                <ListOrdered className="w-5 h-5 text-primary-fixed-dim" />
                <span>45 Questions • 90 Minutes</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto relative z-10">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-surface-bright border border-surface-container flex items-center justify-center text-[10px] font-sans font-semibold text-on-surface">32</div>
              <div className="w-8 h-8 rounded-full bg-surface-container-high border border-surface-container flex items-center justify-center text-[10px] font-sans font-semibold text-on-surface-variant uppercase tracking-wider">Enrolled</div>
            </div>
            
            <button className="px-5 py-2 bg-transparent border border-primary-fixed-dim text-primary-fixed-dim hover:bg-primary-fixed-dim/10 rounded-lg font-display text-sm font-medium transition-all duration-300 flex items-center gap-2 group/btn">
              <Rocket className="w-4 h-4 group-hover/btn:rotate-12 transition-transform" />
              Deploy
            </button>
          </div>
        </article>

        {/* Assessment Card 2: Draft */}
        <article className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-white/20 transition-all duration-300 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
          
          <div>
            <div className="flex justify-between items-start mb-4 relative z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-bright text-on-surface-variant font-sans font-semibold text-[11px] border border-outline-variant uppercase tracking-[0.1em]">
                <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant"></span>
                Draft
              </span>
              <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <h3 className="font-display text-[22px] font-medium text-on-surface mb-2 relative z-10">
              Quiz 2: Synaptic Pathways
            </h3>
            <p className="font-sans text-sm text-on-surface-variant mb-6 line-clamp-2 relative z-10">
              Short quiz evaluating understanding of neurotransmitter release mechanisms and receptor binding kinetics.
            </p>

            <div className="flex flex-col gap-3 mb-6 relative z-10">
              <div className="flex items-center gap-3 text-on-surface-variant/50 font-sans text-sm">
                <Calendar className="w-5 h-5 opacity-60" />
                <span className="italic">No deadline set</span>
              </div>
              <div className="flex items-center gap-3 text-on-surface-variant font-sans text-sm">
                <ListOrdered className="w-5 h-5 opacity-60" />
                <span>12 Questions drafted</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-4 border-t border-white/5 mt-auto relative z-10">
            <button className="px-5 py-2 bg-white/5 text-on-surface hover:bg-white/10 rounded-lg font-display text-sm font-medium transition-all duration-300 flex items-center gap-2 border border-white/10">
              <Edit3 className="w-4 h-4" />
              Continue Editing
            </button>
          </div>
        </article>

      </div>
    </ClassroomLayout>
  );
}
