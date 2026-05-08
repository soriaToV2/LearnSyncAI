import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Users, BrainCircuit, LayoutDashboard, Settings, Bell, HelpCircle, LogOut } from 'lucide-react';
import clsx from 'clsx';


export default function MainLayout() {
  const location = useLocation();

  const getClassActivePaths = () => {
    return location.pathname.includes('/class/');
  }

  return (
    <div className="flex min-h-screen bg-background text-on-background font-sans antialiased selection:bg-primary-container/30">
      
      {/* SideNavBar */}
      <nav className="fixed left-0 top-0 flex flex-col p-6 z-50 h-screen w-64 border-r border-white/10 shadow-2xl bg-[#020617]/80 backdrop-blur-xl hidden md:flex">
        <div className="mb-12 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-fixed/20 flex items-center justify-center border border-primary-fixed/30 shadow-[0_0_15px_rgba(0,229,255,0.15)]">
            <BrainCircuit className="text-primary-fixed-dim w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter text-primary-fixed-dim font-display">EduSpace Pro</h1>
            <p className="font-semibold text-xs text-slate-400 mt-1 uppercase tracking-widest text-[10px]">Academic Console</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-2 font-display text-sm tracking-wide">
          <NavLink 
            to="/dashboard"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              isActive && !getClassActivePaths()
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </NavLink>
          <NavLink 
            to="/class/bio-301/resources"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              getClassActivePaths()
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <BookOpen className="w-5 h-5" />
            Classes
          </NavLink>
        </div>

        <div className="mt-auto">
          <NavLink 
            to="/login"
            className="flex items-center gap-4 px-4 py-3 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all duration-300 active:scale-95 font-display text-sm tracking-wide"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </NavLink>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 min-h-screen">
        <Outlet />
      </div>
    </div>
  );
}
