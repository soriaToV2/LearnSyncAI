import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bell, Search, ChevronRight, Building, CheckCircle2, ShieldCheck, Box, PlayCircle, FileText, ArrowRight, Megaphone, Clock } from 'lucide-react';


export default function StudentCourseView() {
  const { courseId } = useParams();
  const [activeTab, setActiveTab] = useState<'resources' | 'quizzes' | 'announcements'>('resources');

  const courseTitle = courseId === 'bio-301' ? 'Advanced Neurobiology' : 'Course Overview';
  const educator = 'Prof. Elias Vance';

  return (
    <>
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/50 backdrop-blur-md shadow-none flex justify-between items-center h-16 px-8 z-40">
        <div className="flex items-center gap-4 text-slate-400 font-sans text-[13px]">
          <span className="hover:text-primary-fixed-dim cursor-pointer transition-colors">Dashboard</span>
          <ChevronRight className="w-4 h-4" />
          <span>{courseTitle}</span>
        </div>

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

      <main className="p-10 max-w-7xl mx-auto w-full">
        {/* Course Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="px-2.5 py-1 rounded-md bg-secondary-container/10 text-secondary-container border border-secondary-container/20 font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <Building className="w-3 h-3" />
                MIT
              </span>
              <span className="px-2.5 py-1 rounded-md bg-surface-bright border border-white/5 text-on-surface-variant font-sans font-semibold text-[10px] tracking-[0.1em] uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Internal Course
              </span>
            </div>
            <h1 className="font-display text-[42px] font-bold text-on-surface mb-2 tracking-tight leading-tight">{courseTitle}</h1>
            <p className="font-sans text-lg text-on-surface-variant max-w-2xl">
              Educator: <span className="text-on-surface">{educator}</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar gap-8">
          <button 
            onClick={() => setActiveTab('resources')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            Learning Resources
          </button>
          <button 
            onClick={() => setActiveTab('quizzes')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'quizzes' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            Quizzes & Exams
          </button>
          <button 
            onClick={() => setActiveTab('announcements')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 ${activeTab === 'announcements' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            Announcements
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'resources' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* File Card: PDF */}
            <div className="glass-card rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group">
              <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center shrink-0">
                <FileText className="text-error w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center h-12">
                <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Synaptic Pathways Ch.4</h4>
                <p className="font-sans text-sm text-on-surface-variant truncate">2.4 MB • Required Reading</p>
              </div>
            </div>

            {/* File Card: Video */}
            <div className="glass-card rounded-xl p-5 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group">
              <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center shrink-0">
                <PlayCircle className="text-indigo-400 w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center h-12">
                <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Lecture: Neuroplasticity</h4>
                <p className="font-sans text-sm text-on-surface-variant truncate">45 mins • Video Lecture</p>
              </div>
            </div>

            {/* File Card: AR Ready */}
            <div className="bg-surface-container rounded-xl p-5 border border-primary-fixed-dim/30 hover:border-primary-fixed-dim/60 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(0,218,243,0.1)] flex items-start gap-4 group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary-fixed-dim/10 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none"></div>
              
              <div className="w-12 h-12 rounded-lg bg-primary-fixed-dim/20 flex items-center justify-center shrink-0 shadow-inner">
                <Box className="text-primary-fixed-dim w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0 relative z-10 flex flex-col justify-center h-12">
                <div className="flex items-center gap-2 mb-0.5">
                  <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Human Brain Model</h4>
                </div>
                <div className="flex items-center gap-2">
                   <p className="font-sans text-sm text-on-surface-variant truncate">.gltf Interactive</p>
                   <span className="px-1.5 py-0.5 rounded bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[9px] tracking-[0.1em]">AR-READY</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'quizzes' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assessment Card: Pending */}
            <article className="glass-card rounded-xl p-6 flex flex-col justify-between group hover:border-error/40 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-error/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none group-hover:bg-error/20 transition-colors"></div>
              <div>
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error/10 text-error font-sans font-semibold text-[11px] border border-error/20 uppercase tracking-[0.1em]">
                    Pending
                  </span>
                </div>
                <h3 className="font-display text-[22px] font-medium text-on-surface mb-2 relative z-10">
                  Midterm: Neural Firing
                </h3>
                <p className="font-sans text-sm text-on-surface-variant mb-6 line-clamp-2 relative z-10">
                  Covers chapters 1-4. High alert: This exam utilizes Lockdown Mode. Tab switching will terminate the exam.
                </p>
              </div>
              <div className="flex items-center justify-end pt-4 border-t border-white/5 mt-auto relative z-10">
                <Link to="/student/exam/midterm-1" className="px-5 py-2.5 bg-error/10 border border-error/30 text-error hover:bg-error/20 rounded-lg font-display text-sm font-semibold transition-all duration-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Launch Lockdown Exam
                </Link>
              </div>
            </article>

            {/* Assessment Card: Completed */}
            <article className="glass-card rounded-xl p-6 flex flex-col justify-between relative overflow-hidden opacity-80">
              <div>
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-sans font-semibold text-[11px] border border-emerald-500/20 uppercase tracking-[0.1em]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                  </span>
                </div>
                <h3 className="font-display text-[22px] font-medium text-on-surface mb-2 relative z-10">
                  Quiz 1: Fundamentals
                </h3>
                <p className="font-sans text-sm text-on-surface-variant mb-6 relative z-10">
                  Score: 94% • Submitted Oct 1, 2023
                </p>
              </div>
              <div className="flex items-center justify-end pt-4 border-t border-white/5 mt-auto relative z-10">
                <button className="px-5 py-2 bg-transparent text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm flex items-center gap-2">
                  View Results <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </article>

          </div>
        )}

        {activeTab === 'announcements' && (
          <div className="space-y-6 max-w-3xl">
            {/* Announcement 1 */}
            <article className="glass-card rounded-xl p-6 relative overflow-hidden border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center shrink-0">
                  <Megaphone className="w-6 h-6 text-primary-fixed-dim" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-display text-lg font-semibold text-on-surface">Midterm Exam Details</h3>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 font-sans">
                      <Clock className="w-3 h-3" /> 2 days ago
                    </span>
                  </div>
                  <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                    Hello class, just a reminder that our midterm exam is scheduled for next Tuesday. Please ensure you have reviewed chapters 1 through 4. The exam will utilize Lockdown Mode, so make sure your system is ready.
                  </p>
                </div>
              </div>
            </article>

            {/* Announcement 2 */}
            <article className="glass-card rounded-xl p-6 relative overflow-hidden border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-full bg-surface-variant flex items-center justify-center shrink-0">
                  <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=150" alt="Educator" className="w-full h-full object-cover rounded-full" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-display text-lg font-semibold text-on-surface">New Reading Material Uploaded</h3>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 font-sans">
                      <Clock className="w-3 h-3" /> Last week
                    </span>
                  </div>
                  <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-3">
                    I've uploaded the new interactive AR model for the human brain. Please take a look at it before our next lecture as we will be using it for our discussion on neuroplasticity.
                  </p>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high border border-white/5 text-sm font-sans text-on-surface cursor-pointer hover:bg-white/5 transition-colors">
                    <Box className="w-4 h-4 text-primary-fixed-dim" />
                    Human Brain Model.gltf
                  </div>
                </div>
              </div>
            </article>
          </div>
        )}
      </main>
    </>
  );
}
