import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { BookOpen, BrainCircuit, LayoutDashboard, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { EDUCATOR_PROFILE } from '../../data/mockEducatorData';
import { useEducatorTheme, EducatorThemeProvider, applyThemeToElement } from '../../context/ThemeContext';

function MainLayoutInner() {
  const location = useLocation();
  const isCourseActive = location.pathname.includes('/educator/course/');
  const [showLogout, setShowLogout] = useState(false);
  const { theme } = useEducatorTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Apply theme to this layout wrapper, not the document root
  useEffect(() => {
    if (wrapperRef.current) {
      applyThemeToElement(theme, wrapperRef.current);
    }
  }, [theme]);

  const activeStyle = {
    color: theme.accent,
    backgroundColor: theme.accentSoft,
    borderRight: `2px solid ${theme.accent}`,
    fontWeight: 600,
  } as React.CSSProperties;

  const inactiveClass = 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-r-2 border-transparent';
  const navBase = 'flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95 font-display text-sm tracking-wide';

  return (
    <div
      ref={wrapperRef}
      className="flex min-h-screen bg-background text-on-background font-sans antialiased selection:bg-primary-container/30"
    >
      
      {/* SideNavBar */}
      <nav className="fixed left-0 top-0 flex flex-col p-6 z-50 h-screen w-64 border-r border-white/10 shadow-2xl bg-page-80 backdrop-blur-xl hidden md:flex">
        <div className="mb-12 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center border"
            style={{ backgroundColor: `${theme.accent}20`, borderColor: `${theme.accent}40`, boxShadow: `0 0 15px ${theme.glow}` }}
          >
            <BrainCircuit style={{ color: theme.accent }} className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter font-display" style={{ color: theme.accent }}>EduSpace Pro</h1>
            <p className="font-semibold text-xs text-slate-400 mt-1 uppercase tracking-widest text-[10px]">Academic Dashboard</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-2 font-display text-sm tracking-wide">
          <NavLink
            to="/educator/dashboard"
            className={({ isActive }) => `${navBase} ${isActive && !isCourseActive ? '' : inactiveClass}`}
            style={({ isActive }) => isActive && !isCourseActive ? activeStyle : {}}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </NavLink>
          <NavLink
            to="/educator/courses"
            className={({ isActive }) => `${navBase} ${(isActive || isCourseActive) ? '' : inactiveClass}`}
            style={({ isActive }) => (isActive || isCourseActive) ? activeStyle : {}}
          >
            <BookOpen className="w-5 h-5" />
            Courses
          </NavLink>
        </div>

        <div className="mt-auto flex flex-col gap-2 relative">
          {/* Settings */}
          <NavLink
            to="/educator/settings"
            className={({ isActive }) => `${navBase} mb-1 ${isActive ? '' : inactiveClass}`}
            style={({ isActive }) => (isActive ? activeStyle : {})}
          >
            <SettingsIcon className="w-5 h-5" />
            Settings
          </NavLink>

          {showLogout && (
            <NavLink
              to="/login"
              className="flex items-center gap-4 px-4 py-3 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all duration-300 active:scale-95 font-display text-sm tracking-wide"
            >
              <LogOut className="w-5 h-5" />
              Logout
            </NavLink>
          )}

          {/* Profile Card */}
          <button
            onClick={() => setShowLogout(!showLogout)}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all duration-300 border border-white/5 w-full text-left group active:scale-98 focus:outline-none"
          >
            <div className="relative shrink-0">
              <img
                src={EDUCATOR_PROFILE.avatar}
                alt={EDUCATOR_PROFILE.name}
                className="w-10 h-10 rounded-full object-cover border border-white/10"
              />
              <span
                className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-page"
                style={{ backgroundColor: theme.accent }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-bold transition-colors truncate" style={{ color: showLogout ? theme.accent : undefined }}>
                {EDUCATOR_PROFILE.name}
              </p>
              <p className="font-sans text-[11px] text-slate-400 truncate">{EDUCATOR_PROFILE.department}</p>
            </div>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-64 min-h-screen">
        <Outlet />
      </div>
    </div>
  );
}

export default function MainLayout() {
  return (
    <EducatorThemeProvider>
      <MainLayoutInner />
    </EducatorThemeProvider>
  );
}
