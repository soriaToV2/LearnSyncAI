import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Home, Layers, Gamepad2, BrainCircuit, LogOut, Settings as SettingsIcon, Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStudentTheme, StudentThemeProvider, applyThemeToElement } from '../../context/ThemeContext';
import { AuthProvider, useAuth, displayName, fullName, initials, subtitleFor } from '../../context/AuthContext';

const SIDEBAR_COLLAPSED_KEY = 'learnsyncai-sidebar-collapsed';

/**
 * The avatar. `profiles` carries no image column and no email, so there is
 * nothing to fetch and nothing may be invented — this replaced three `<img>`
 * tags pointing at an Unsplash URL that lived in mock data.
 *
 * Renders an empty tinted circle while the profile is loading rather than a
 * spinner: the sidebar is persistent chrome and should not flash on every
 * navigation. It is tinted with the live theme accent, matching the logo bubble.
 */
function Monogram({
  user,
  size,
  accent,
}: {
  user: ReturnType<typeof useAuth>['user'];
  size: 'sm' | 'lg';
  accent: string;
}) {
  const box = size === 'lg' ? 'w-10 h-10 text-xs' : 'w-8 h-8 text-[10px]';
  return (
    <div
      className={`${box} rounded-full flex items-center justify-center border font-display font-bold shrink-0 select-none`}
      style={{ backgroundColor: `${accent}20`, borderColor: `${accent}40`, color: accent }}
      aria-hidden={!user}
    >
      {initials(user)}
    </div>
  );
}

function StudentLayoutInner() {
  const location = useLocation();
  const [showLogout, setShowLogout] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  const { user } = useAuth();
  const { theme } = useStudentTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const isSpaceActive = location.pathname.includes('/student/space/');

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

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

  const inactiveClass =
    'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-r-2 border-transparent';

  const navBase =
    'flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95 font-display text-sm tracking-wide';

  const collapsedNavClass = (collapsed: boolean) =>
    collapsed ? 'justify-center px-0 gap-0' : '';

  const renderNavLinks = (collapsed = false) => (
    <div className="flex flex-col gap-2 font-display text-sm tracking-wide">
      <NavLink
        to="/student/dashboard"
        title="Dashboard"
        className={({ isActive }) =>
          `${navBase} ${collapsedNavClass(collapsed)} ${(isActive && !isSpaceActive) ? '' : inactiveClass}`
        }
        style={({ isActive }) =>
          isActive && !isSpaceActive ? activeStyle : {}
        }
      >
        <Home className="w-5 h-5 shrink-0" />
        {!collapsed && 'Dashboard'}
      </NavLink>

      <NavLink
        to="/student/spaces"
        title="Spaces"
        className={({ isActive }) =>
          `${navBase} ${collapsedNavClass(collapsed)} ${(isActive || isSpaceActive) ? '' : inactiveClass}`
        }
        style={({ isActive }) =>
          isActive || isSpaceActive ? activeStyle : {}
        }
      >
        <Layers className="w-5 h-5 shrink-0" />
        {!collapsed && 'Spaces'}
      </NavLink>


      <NavLink
        to="/student/games"
        title="Games"
        className={({ isActive }) => `${navBase} ${collapsedNavClass(collapsed)} ${isActive ? '' : inactiveClass}`}
        style={({ isActive }) => (isActive ? activeStyle : {})}
      >
        <Gamepad2 className="w-5 h-5 shrink-0" />
        {!collapsed && 'Games'}
      </NavLink>
    </div>
  );

  const renderFooter = (collapsed = false) => (
    <div className="mt-auto flex flex-col gap-2 relative">
      <NavLink
        to="/student/settings"
        title="Settings"
        className={({ isActive }) => `${navBase} ${collapsedNavClass(collapsed)} mb-1 ${isActive ? '' : inactiveClass}`}
        style={({ isActive }) => (isActive ? activeStyle : {})}
      >
        <SettingsIcon className="w-5 h-5 shrink-0" />
        {!collapsed && 'Settings'}
      </NavLink>

      {showLogout && (
        <NavLink
          to="/login"
          title="Logout"
          className={`flex items-center gap-4 px-4 py-3 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all duration-300 active:scale-95 font-display text-sm tracking-wide ${collapsedNavClass(collapsed)}`}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && 'Logout'}
        </NavLink>
      )}

      <button
        onClick={() => setShowLogout(!showLogout)}
        title={fullName(user)}
        className={`flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all duration-300 border border-white/5 w-full text-left group active:scale-98 focus:outline-none ${collapsed ? 'justify-center' : ''}`}
      >
        <div className="relative shrink-0">
          <Monogram user={user} size="lg" accent={theme.accent} />
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-page"
            style={{ backgroundColor: theme.accent }}
          />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p
              className="font-display text-sm font-bold text-white transition-colors truncate"
              style={{ color: showLogout ? theme.accent : undefined }}
            >
              {fullName(user) || displayName(user)}
            </p>
            <p className="font-sans text-[11px] text-slate-400 truncate">{subtitleFor(user)}</p>
          </div>
        )}
      </button>
    </div>
  );

  return (
    <div
      ref={wrapperRef}
      className="flex min-h-screen bg-background text-on-background font-sans antialiased selection:bg-primary-container/30"
    >
      {/* Mobile Top Navbar */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-slate-950/80 border-b border-white/10 backdrop-blur-xl z-40 px-6 flex items-center justify-between md:hidden">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 -ml-2 text-slate-400 hover:text-white rounded-lg focus:outline-none"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center border"
            style={{
              backgroundColor: `${theme.accent}20`,
              borderColor: `${theme.accent}40`,
              boxShadow: `0 0 10px ${theme.glow}`,
            }}
          >
            <BrainCircuit style={{ color: theme.accent }} className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tighter font-display" style={{ color: theme.accent }}>
            LearnSyncAI
          </span>
        </div>

        <NavLink to="/student/settings" title={fullName(user)}>
          <Monogram user={user} size="sm" accent={theme.accent} />
        </NavLink>
      </header>

      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 md:hidden"
        />
      )}

      {/* Mobile Navigation Drawer */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-72 bg-slate-950 border-r border-white/10 p-6 flex flex-col z-50 transition-transform duration-300 ease-in-out md:hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center border"
              style={{
                backgroundColor: `${theme.accent}20`,
                borderColor: `${theme.accent}40`,
              }}
            >
              <BrainCircuit style={{ color: theme.accent }} className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tighter font-display" style={{ color: theme.accent }}>
                LearnSyncAI
              </h1>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-2">
          {renderNavLinks()}
        </div>

        <div className="mt-auto pt-6 border-t border-white/5">
          {renderFooter()}
        </div>
      </aside>

      {/* Desktop SideNavBar */}
      <nav
        className={`fixed left-0 top-0 flex flex-col p-6 z-50 h-screen border-r border-white/10 shadow-2xl bg-page-80 backdrop-blur-xl hidden md:flex transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'
          }`}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-9 w-6 h-6 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-all duration-300 focus:outline-none shadow-lg"
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Logo */}
        <div className={`mb-12 flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center border shrink-0"
            style={{
              backgroundColor: `${theme.accent}20`,
              borderColor: `${theme.accent}40`,
              boxShadow: `0 0 15px ${theme.glow}`,
            }}
          >
            <BrainCircuit style={{ color: theme.accent }} className="w-6 h-6" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <h1
                className="text-xl font-bold tracking-tighter font-display truncate"
                style={{ color: theme.accent }}
              >
                LearnSyncAI
              </h1>
              <p className="font-semibold text-xs text-slate-400 mt-1 uppercase tracking-widest text-[10px] truncate">
                Student Dashboard
              </p>
            </div>
          )}
        </div>

        {/* Nav Items */}
        <div className="flex-1">
          {renderNavLinks(isCollapsed)}
        </div>

        {/* Footer */}
        {renderFooter(isCollapsed)}
      </nav>

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-h-screen pt-16 md:pt-0 min-w-0 overflow-x-hidden transition-all duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'
          }`}
      >
        <div key={location.pathname} className="flex-1 flex flex-col animate-page-fade">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/**
 * `AuthProvider` is mounted HERE, not at the App root.
 *
 * At the root it would fire `GET /api/auth/me` on `/login` and `/register`,
 * where there is no session — a 401 on every cold page load, and an error state
 * the login screen would have to know to ignore. Mounted on the layout, it runs
 * exactly once per portal entry, on routes that already require a signed-in user.
 * `EducatorLayout` can adopt the same provider unchanged; nothing in it is
 * student-specific.
 */
export default function StudentLayout() {
  return (
    <AuthProvider>
      <StudentThemeProvider>
        <StudentLayoutInner />
      </StudentThemeProvider>
    </AuthProvider>
  );
}
