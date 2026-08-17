import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';
import SetPassword from './pages/auth/SetPassword';

// Student
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import Profile from './pages/student/Profile';
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
        <Route path="/register" element={<CreateAccount />} />
        <Route path="/login" element={<Login />} />
        {/*
          ⚠️ OUTSIDE EVERY LAYOUT, DELIBERATELY. `RequireRole` redirects here when
          an account still holds the password an administrator set. Mounted inside
          a guarded layout, that redirect would fire again on arrival and loop.
          It brings its own `AuthProvider`, exactly as the three layouts do.
        */}
        <Route path="/set-password" element={<SetPassword />} />

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