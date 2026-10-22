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
        {/* No self-registration: accounts are issued by an administrator. Redirect rather than delete, since there's no catch-all route and an unmatched path renders blank. */}
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        {/* Outside every layout: RequireRole redirects here, so inside one it would loop. Brings its own AuthProvider. */}
        <Route path="/set-password" element={<SetPassword />} />
        {/* Outside every layout too: its visitors can't sign in. No AuthProvider. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* Student Routes */}
        <Route element={<StudentLayout />}>
          <Route path="/student/dashboard" element={<StudentDashboard />} />
          <Route path="/student/profile" element={<Profile />} />
          <Route path="/student/spaces" element={<StudySpacesList />} />
          {/* The reference half of student onboarding, and where the tour can be replayed. */}
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
          <Route path="/educator/profile" element={<EducatorProfile />} />
        </Route>

        {/* Admin Routes. No delete route or control: disabling is the reversible mechanism. */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/accounts" element={<AccountsList />} />
          <Route path="/admin/accounts/:userId" element={<AccountDetail />} />
          {/* Import is a modal on Accounts now; redirect old links (no catch-all route). */}
          <Route path="/admin/import" element={<Navigate to="/admin/accounts" replace />} />
          <Route path="/admin/profile" element={<AdminProfile />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}