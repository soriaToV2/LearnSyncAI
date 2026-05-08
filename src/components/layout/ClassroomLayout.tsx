import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Search, Bell, HelpCircle, Users as UsersIcon, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export default function ClassroomLayout({ children }: { children: React.ReactNode }) {
  const { classId } = useParams();

  return (
    <>
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/50 backdrop-blur-md shadow-none flex justify-between items-center h-16 px-8 z-40">
        <div className="flex items-center gap-4 text-slate-400 font-sans text-[13px]">
          <span className="hover:text-primary-fixed-dim cursor-pointer transition-colors">Classrooms</span>
          <ChevronRight className="w-4 h-4" />
          <span>Neurobiology Dept</span>
        </div>

        <div className="flex items-center gap-4 text-slate-400">
          <button className="hover:text-primary-fixed-dim transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <button className="hover:text-primary-fixed-dim transition-colors">
            <HelpCircle className="w-5 h-5" />
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

      <div className="p-10 max-w-7xl mx-auto w-full">
        {/* Classroom Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded-full bg-surface-variant text-on-surface font-sans font-semibold text-[12px] tracking-[0.1em] border border-white/5 uppercase">
                {classId?.toUpperCase() || 'BIO-301'}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[12px] tracking-[0.1em] border border-primary-fixed-dim/20 uppercase">
                Active Term
              </span>
            </div>
            <h1 className="font-display text-[42px] font-bold text-on-surface mb-1 tracking-tight leading-tight">Advanced Neurobiology</h1>
            <p className="font-sans text-base text-on-surface-variant max-w-2xl">
              Advanced study of nervous system function, cellular physiology, and neural networks.
            </p>
          </div>
          
          <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm bg-surface-container-high px-4 py-2 rounded-full border border-white/5 h-fit">
            <UsersIcon className="w-4 h-4" />
            <span>24 Active Students</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar">
          <NavLink 
            to={`/class/${classId}/resources`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Learning Resources
          </NavLink>
          <NavLink 
            to={`/class/${classId}/quizzes`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Quizzes & Exams
          </NavLink>
          <NavLink 
            to={`/class/${classId}/students`}
            className={({ isActive }) => clsx(
              "px-6 py-4 font-display text-[15px] whitespace-nowrap transition-colors border-b-2",
              isActive ? "text-primary-fixed-dim border-primary-fixed-dim bg-primary-fixed-dim/5 rounded-t-lg" : "text-on-surface-variant hover:text-on-surface border-transparent"
            )}
          >
            Students
          </NavLink>
        </div>

        {/* Tab Content */}
        {children}
      </div>
    </>
  );
}