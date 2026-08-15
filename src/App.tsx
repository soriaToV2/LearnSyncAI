import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';

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

import OrientationGate from './components/common/OrientationGate';

export default function App() {
  return (
    <BrowserRouter>
      <OrientationGate />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<CreateAccount />} />
        <Route path="/login" element={<Login />} />

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

      </Routes>
    </BrowserRouter>
  );
}