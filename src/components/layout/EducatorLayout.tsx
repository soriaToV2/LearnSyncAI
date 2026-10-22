import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, FileText, LogOut, UserCircle,
  Menu, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import Logo from '../common/Logo';
import { useEducatorTheme, EducatorThemeProvider, applyThemeToElement } from '../../context/ThemeContext';
import { AuthProvider, useAuth, fullName, initials, subtitleFor } from '../../context/AuthContext';
import { SubjectsProvider } from '../../context/SubjectsContext';
import { signOut } from '../../lib/signOut';
import RequireRole from '../common/RequireRole';
import EmailRecoveryBanner from '../common/EmailRecoveryBanner';

const SIDEBAR_COLLAPSED_KEY = 'learnsyncai-educator-sidebar-collapsed';

function EducatorLayoutInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  const { theme } = useEducatorTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The real profile. No email or avatar columns: the subtitle is the role, the avatar a monogram.
  const educatorName = fullName(user);
  const monogram = initials(user);
  const subtitle = subtitleFor(user);

  // `replace: true` so Back can't return to the portal. Redirect even if signOut() throws.
  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('[auth] sign-out failed, redirecting anyway', err);
    } finally {
      navigate('/login', { replace: true });
    }
  };

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

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
    'flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95 font-display text-sm tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

  const collapsedNavClass = (collapsed: boolean) =>
    collapsed ? 'justify-center px-0 gap-0' : '';

  // Student performance is reached via Materials → a material → Class Performance.
  const NAV_ITEMS = [
    { to: '/educator/dashboard', label: 'Dashboard', icon: Home },
    { to: '/educator/materials', label: 'Materials', icon: FileText },
    { to: '/educator/profile', label: 'Profile', icon: UserCircle },
  ];

  const renderNavLinks = (collapsed = false) => (
    <div className="flex flex-col gap-2 font-display text-sm tracking-wide">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) =>
            `${navBase} ${collapsedNavClass(collapsed)} ${isActive ? '' : inactiveClass}`
          }
          style={({ isActive }) => (isActive ? activeStyle : {})}
        >
          <Icon className="w-5 h-5 shrink-0" />
          {!collapsed && label}
        </NavLink>
      ))}
    </div>
  );

  // Footer: Logout (always rendered) above the identity card, nothing else.
  const renderFooter = (collapsed = false) => (
    <div className="mt-auto flex flex-col gap-2">
      {/* A <button>, not a NavLink — it ends the session before it navigates. */}
      <button
        onClick={handleSignOut}
        disabled={isSigningOut}
        title="Logout"
        className={`flex items-center gap-4 px-4 py-3 mb-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all duration-300 active:scale-95 font-display text-sm tracking-wide disabled:opacity-60 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-400 ${collapsedNavClass(collapsed)}`}
      >
        <LogOut className="w-5 h-5 shrink-0" />
        {!collapsed && (isSigningOut ? 'Signing out…' : 'Logout')}
      </button>

      {/* Collapsed: no card chrome and a smaller avatar (the collapsed rail has 32px inner width). */}
      <div
        title={educatorName}
        className={`flex items-center gap-3 w-full text-left ${
          collapsed ? 'justify-center' : 'p-3 rounded-xl border border-white/5'
        }`}
      >
        <div className="relative shrink-0">
          <div
            className={`${
              collapsed ? 'w-8 h-8 text-[10px]' : 'w-10 h-10 text-sm'
            } rounded-full flex items-center justify-center border border-white/10 font-display font-bold`}
            style={{ backgroundColor: theme.accentSoft, color: theme.accent }}
          >
            {monogram}
          </div>
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-page"
            style={{ backgroundColor: theme.accent }}
          />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-bold text-white truncate">
              {educatorName}
            </p>
            <p className="font-sans text-[11px] text-slate-400 truncate">
              {subtitle}
            </p>
          </div>
        )}
      </div>
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
          className="p-2 -ml-2 text-slate-400 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
          aria-label="Open navigation"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center border"
            style={{
              backgroundColor: `${theme.accent}20`,
              borderColor: `${theme.accent}40`,
            }}
          >
            <Logo className="w-5 h-5" style={{ color: theme.accent }} />
          </div>
          <span className="text-lg font-bold tracking-tighter font-display" style={{ color: theme.accent }}>
            LearnSyncAI
          </span>
        </div>

        <NavLink
          to="/educator/profile"
          className="w-8 h-8 rounded-full overflow-hidden border border-white/10 flex items-center justify-center font-display text-[11px] font-bold"
          style={{ backgroundColor: theme.accentSoft, color: theme.accent }}
        >
          {monogram}
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
              <Logo className="w-5 h-5" style={{ color: theme.accent }} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tighter font-display" style={{ color: theme.accent }}>
                LearnSyncAI
              </h1>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
            aria-label="Close navigation"
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
          className="absolute -right-3 top-9 w-6 h-6 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-all duration-300 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
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
            }}
          >
            <Logo className="w-6 h-6" style={{ color: theme.accent }} />
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
                Educator Portal
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
        {/* Outside the keyed div so it doesn't replay its entrance on every navigation. */}
        <EmailRecoveryBanner accent={theme.accent} />
        <div key={location.pathname} className="flex-1 flex flex-col animate-page-fade">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** AuthProvider is mounted per layout, not at the root, so /login never calls /auth/me. */
export default function EducatorLayout() {
  return (
    <AuthProvider>
      <EducatorThemeProvider>
        {/* RequireRole: see StudentLayout. */}
        <RequireRole allow={['educator']}>
          {/* Reference data, its own provider. Inside RequireRole (the route is gated). */}
          <SubjectsProvider>
            <EducatorLayoutInner />
          </SubjectsProvider>
        </RequireRole>
      </EducatorThemeProvider>
    </AuthProvider>
  );
}
