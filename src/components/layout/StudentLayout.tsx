import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, Layers, Gamepad2, LogOut, UserCircle, Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import Logo from '../common/Logo';
import { useStudentTheme, StudentThemeProvider, applyThemeToElement } from '../../context/ThemeContext';
import { AuthProvider, useAuth, displayName, fullName, initials, subtitleFor } from '../../context/AuthContext';
import { SubjectsProvider } from '../../context/SubjectsContext';
import { signOut } from '../../lib/signOut';
import { BadgeProvider } from '../../context/BadgeContext';
import RequireRole from '../common/RequireRole';
import EmailRecoveryBanner from '../common/EmailRecoveryBanner';

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
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  const { user } = useAuth();
  const { theme } = useStudentTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);

  /*
   * `replace: true` is load-bearing: without it the browser Back button returns
   * to the portal shell, which is exactly the "still signed in" impression this
   * change exists to remove.
   *
   * The redirect happens even if `signOut()` throws. Being stranded inside the
   * account on a network blip is the worse failure of the two, and the local
   * session is cleared before the network call in the Supabase client anyway.
   */
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
    'flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 active:scale-95 font-display text-sm tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

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

      <NavLink
        to="/student/profile"
        title="Profile"
        className={({ isActive }) => `${navBase} ${collapsedNavClass(collapsed)} ${isActive ? '' : inactiveClass}`}
        style={({ isActive }) => (isActive ? activeStyle : {})}
      >
        <UserCircle className="w-5 h-5 shrink-0" />
        {!collapsed && 'Profile'}
      </NavLink>
    </div>
  );

  /*
   * Logout, then the identity card — nothing else. Profile is a destination like
   * Dashboard and Spaces, so it lives with them in the nav list above; the footer
   * is for the one control that ends the session.
   *
   * LOGOUT IS ALWAYS RENDERED. It used to appear only after clicking the identity
   * card, which nothing indicated was a toggle — the most important control in the
   * app was invisible until you guessed. That toggle was the card's only job, so
   * the card is now a plain `<div>`: leaving a hover affordance on a dead element
   * is worse than removing it.
   */
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

      {/*
       * ⚠️ THE CARD SHEDS ITS PADDING AND BORDER WHEN COLLAPSED, AND THE
       * MONOGRAM DROPS A SIZE. THE ARITHMETIC IS WHY, NOT TASTE:
       *
       *   collapsed nav   w-20 (80px) − p-6 (24px × 2)          = 32px inner
       *   this card       − border (1px × 2) − p-3 (12px × 2)   =  6px content
       *   monogram        size="lg" → w-10                      = 40px
       *
       * A 40px `shrink-0` avatar in a 6px box overflows 17px each side, straight
       * through the card's own border — which is what it looked like. `p-1` would
       * not have been enough either; at 32px of inner width the only thing that
       * fits a 32px avatar is no chrome at all. That reads correctly anyway: a
       * bordered box drawn tight around an avatar that fills it adds nothing.
       *
       * The expanded state is untouched — 64px of inner width is plenty for the
       * lg monogram plus the name and grade beside it.
       */}
      <div
        title={fullName(user)}
        className={`flex items-center gap-3 w-full text-left ${
          collapsed ? 'justify-center' : 'p-3 rounded-xl border border-white/5'
        }`}
      >
        <div className="relative shrink-0">
          <Monogram user={user} size={collapsed ? 'sm' : 'lg'} accent={theme.accent} />
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-page"
            style={{ backgroundColor: theme.accent }}
          />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-bold text-white truncate">
              {fullName(user) || displayName(user)}
            </p>
            <p className="font-sans text-[11px] text-slate-400 truncate">{subtitleFor(user)}</p>
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
          aria-label="Open menu"
          className="p-2 -ml-2 text-slate-400 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
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
            <Logo className="w-5 h-5" style={{ color: theme.accent }} />
          </div>
          <span className="text-lg font-bold tracking-tighter font-display" style={{ color: theme.accent }}>
            LearnSyncAI
          </span>
        </div>

        <NavLink to="/student/profile" title={fullName(user)}>
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
            aria-label="Close menu"
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
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
              boxShadow: `0 0 15px ${theme.glow}`,
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
      {/*
        * `transition-[margin]`, not `transition-all`.
        *
        * The only thing here that is MEANT to animate is the left margin tracking
        * the sidebar collapse (`md:ml-64` ↔ `md:ml-20`). `transition-all` animated
        * every animatable property of the box that holds every page — so any width
        * change originating elsewhere got replayed as a smooth 300ms horizontal
        * slide. That is what made a scrollbar appearing inside a child read as the
        * layout deliberately compressing itself.
        *
        * Scoped to margin, the intended sidebar animation is unchanged and
        * unrelated reflows land instantly instead of being dramatised.
        */}
      <div
        className={`flex-1 flex flex-col min-h-screen pt-16 md:pt-0 min-w-0 overflow-x-hidden transition-[margin] duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'
          }`}
      >
        {/* Above the keyed div so it does not replay its entrance animation on
            every navigation — it is one standing notice, not a new alert per page. */}
        <EmailRecoveryBanner accent={theme.accent} />
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
        {/*
          `RequireRole` was added for the admin portal and deferred here, because
          it changes redirect behaviour on routes that had already shipped. The
          first-login gate made it necessary: an un-activated account would
          otherwise render this whole shell and then 403 on every request, with
          nothing on screen explaining why. It also sends a signed-in educator or
          admin to their own portal instead of a student page whose calls refuse
          them.
        */}
        <RequireRole allow={['student']}>
          {/*
            INSIDE `RequireRole`, deliberately. The provider fetches the badges
            the student already holds on mount, to seed the baseline it diffs
            against — so it must never run for a signed-out, un-activated or
            wrong-role visitor, who would get a 401/403 for nothing.
          */}
          <BadgeProvider>
            {/*
              Reference data, not identity, so it is its own provider rather than
              a field on `AuthContext`. Sits inside `RequireRole` for the same
              reason `BadgeProvider` does — `GET /api/subjects` is
              `requireRole`-gated.
            */}
            <SubjectsProvider>
              <StudentLayoutInner />
            </SubjectsProvider>
          </BadgeProvider>
        </RequireRole>
      </StudentThemeProvider>
    </AuthProvider>
  );
}
