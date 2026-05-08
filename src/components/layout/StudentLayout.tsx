import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Home, Layers, Globe, User, BrainCircuit, LogOut, Compass } from 'lucide-react';
import clsx from 'clsx';



export default function StudentLayout() {
  const location = useLocation();

  const isCourseActive = location.pathname.includes('/student/course/');
  const isSpaceActive = location.pathname.includes('/student/space/');

  return (
    <div className="flex min-h-screen bg-background text-on-background font-sans antialiased selection:bg-primary-container/30">
      
      {/* SideNavBar */}
      <nav className="fixed left-0 top-0 flex flex-col p-6 z-50 h-screen w-64 border-r border-white/10 shadow-2xl bg-[#020617]/80 backdrop-blur-xl hidden md:flex">
        <div className="mb-12 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30 shadow-[0_0_15px_rgba(0,218,243,0.15)]">
            <BrainCircuit className="text-primary-fixed-dim w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter text-primary-fixed-dim font-display">EduSpace</h1>
            <p className="font-semibold text-xs text-slate-400 mt-1 uppercase tracking-widest text-[10px]">Student Portal</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-2 font-display text-sm tracking-wide">
          <NavLink 
            to="/student/dashboard"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              (isActive && !isCourseActive && !isSpaceActive)
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <Home className="w-5 h-5" />
            Dashboard
          </NavLink>

          <NavLink 
            to="/student/spaces"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              (isActive || isSpaceActive)
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <Layers className="w-5 h-5" />
            My Spaces
          </NavLink>

          <NavLink 
            to="/student/catalog"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              isActive
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <Compass className="w-5 h-5" />
            Courses
          </NavLink>

          <NavLink 
            to="/student/community"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              isActive
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <Globe className="w-5 h-5" />
            Community
          </NavLink>

          <NavLink 
            to="/student/profile/me"
            className={({ isActive }) => clsx(
              "flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95",
              isActive
                ? "text-primary-fixed-dim bg-primary-fixed-dim/10 border-r-2 border-primary-fixed-dim font-semibold" 
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            <User className="w-5 h-5" />
            My Profile
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
