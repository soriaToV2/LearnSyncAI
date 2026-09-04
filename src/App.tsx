import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/auth/Login';
import SetPassword from './pages/auth/SetPassword';
import ForgotPassword from './pages/auth/ForgotPassword';

// Student
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import Profile from './pages/student/Profile';
import Help from './pages/student/Help';
import StudySpacesList from './pages/student/StudySpacesList';
import StudySpace from './pages/student/StudySpace';
import GamesLayout from './pages/student/games/GamesLayout';
import GamesLanding from './pages/student/games/GamesLanding';
import TermMatchingGame from './pages/student/games/TermMatchingGame';
import CrosswordGame from './pages/student/games/CrosswordGame';
import TimedTriviaGame from './pages/student/games/TimedTriviaGame';

// Educator
import EducatorLayout from './components/layout/EducatorLayout';
import EducatorDashboard from './pages/educator/EducatorDashboard';
import MaterialsLibrary from './pages/educator/MaterialsLibrary';
import MaterialDetail from './pages/educator/MaterialDetail';
import EducatorProfile from './pages/educator/EducatorProfile';

// Admin
import AdminLayout from './components/layout/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AccountsList from './pages/admin/AccountsList';
import AccountDetail from './pages/admin/AccountDetail';
import AdminProfile from './pages/admin/AdminProfile';

import OrientationGate from './components/common/OrientationGate';

export default function App() {
  return (
    <BrowserRouter>
      <OrientationGate />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        {/*
          ⚠️ SELF-REGISTRATION IS GONE. `CreateAccount.tsx` was deleted on
          2026-08-24; accounts are issued by an administrator through
          `POST /api/admin/accounts` or the CSV importer.

          It could not have been made to work from this side anyway:
          `POST /api/auth/register` sets no `username`, and `profiles.username`
          has been the login identifier since migration 0021 — so an account
          created through that page could never sign in. And an open sign-up
          choosing its own `grade_level` would hand the student another year's
          materials, because `materialAccess.ts` gates every read on exactly
          that column.

          A REDIRECT, NOT A DELETION, for the same reason `/admin/import` is one:
          there is no catch-all route, so an unmatched path renders nothing at
          all — a blank page rather than a 404 — which is what a bookmark or a
          URL-bar autocomplete of `/register` would otherwise land on.
        */}
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        {/*
          ⚠️ OUTSIDE EVERY LAYOUT, DELIBERATELY. `RequireRole` redirects here when
          an account still holds the password an administrator set. Mounted inside
          a guarded layout, that redirect would fire again on arrival and loop.
          It brings its own `AuthProvider`, exactly as the three layouts do.
        */}
        <Route path="/set-password" element={<SetPassword />} />
        {/*
          ⚠️ OUTSIDE EVERY LAYOUT, for the same reason as `/set-password` above and
          one more: whoever opens this cannot sign in, so a shell whose
          `RequireRole` bounces signed-out visitors to `/login` would make the page
          unreachable by exactly the people it is for. It mounts no `AuthProvider`
          at all — there is no session to read.
        */}
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* Student Routes */}
        <Route element={<StudentLayout />}>
          <Route path="/student/dashboard" element={<StudentDashboard />} />
          <Route path="/student/profile" element={<Profile />} />
          {/*
            `/student/settings` and `/student/profile/:studentId` are gone. The
            settings page rendered `MOCK_STUDENTS[0]` — an Unsplash avatar, "MIT",
            a location, follower counts, and an "Edit Profile Card" form that
            persisted nothing. The old profile page added achievements and a
            "Public Study Spaces" tab, which is the CollabShare peer sharing
            migration 0003 removed as contradicting the paper's data-isolation
            guarantee. `/student/profile` above is the real account page, built on
            `GET /api/auth/me`.
          */}
          <Route path="/student/spaces" element={<StudySpacesList />} />
          {/*
            The reference half of the student onboarding, and the only place the
            first-run tour can be replayed from. Student portal only — the
            educator and admin portals have no onboarding.
          */}
          <Route path="/student/help" element={<Help />} />
          <Route path="/student/space/:spaceId" element={<StudySpace />} />
          <Route path="/student/games" element={<GamesLayout />}>
            <Route index element={<GamesLanding />} />
            <Route path="matching" element={<TermMatchingGame />} />
            <Route path="crossword" element={<CrosswordGame />} />
            <Route path="trivia" element={<TimedTriviaGame />} />
          </Route>
          
          <Route path="/dashboard" element={<Navigate to="/student/dashboard" replace />} />
        </Route>

        {/* Educator Routes */}
        <Route element={<EducatorLayout />}>
          <Route path="/educator" element={<Navigate to="/educator/dashboard" replace />} />
          <Route path="/educator/dashboard" element={<EducatorDashboard />} />
          <Route path="/educator/materials" element={<MaterialsLibrary />} />
          <Route path="/educator/materials/:materialId" element={<MaterialDetail />} />
          {/*
            `/educator/students` and `/educator/students/:studentId` are gone.
            Both pages were built entirely on mock data — eighteen invented
            students, with no `lib/api` import between them. Student performance
            now lives where it is scoped to something real: a material's Class
            Performance tab, which reads BKT mastery for the students in the
            grades that material is published to.
          */}
          {/*
            `/educator/settings` is gone. Its Profile tab moved to
            `/educator/profile` below, publishing explainer and all; its
            Appearance tab was the theme picker, deleted with the picker itself —
            see the header of `context/ThemeContext.tsx`.
          */}
          <Route path="/educator/profile" element={<EducatorProfile />} />
        </Route>

        {/*
          Admin Routes.

          ⚠️ `AdminLayout` is the ONLY layout with a route guard. It wraps its
          shell in `RequireRole allow={['admin']}`, so a student typing
          `/admin/accounts` never renders the frame — the API would refuse them
          either way, but a portal that lists every account in the school should
          not describe itself to someone who cannot use it. The other two layouts
          are still unguarded; wiring them is a one-line change each and belongs
          to its own review, since it changes redirect behaviour on routes that
          have already shipped.

          There is no delete route here and no delete control anywhere in the
          portal — thirteen tables CASCADE from `profiles`, so disabling is the
          reversible mechanism the schema itself prescribes.
        */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/accounts" element={<AccountsList />} />
          <Route path="/admin/accounts/:userId" element={<AccountDetail />} />
          {/*
            Bulk import is a modal on Accounts now, not a page. This redirect
            stays because there is NO catch-all route: an unmatched path inside
            this layout renders the shell with an empty `<Outlet />` — a blank
            page, not a 404 — which is exactly what a bookmark or a URL-bar
            autocomplete of the old address would land on.
          */}
          <Route path="/admin/import" element={<Navigate to="/admin/accounts" replace />} />
          <Route path="/admin/profile" element={<AdminProfile />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}