import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';

// Student
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentProfile from './pages/student/StudentProfile';
import Settings from './pages/student/Settings';
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
import EducatorSettings from './pages/educator/EducatorSettings';

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
          <Route path="/student/profile/:studentId" element={<StudentProfile />} />
          <Route path="/student/settings" element={<Settings />} />
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
          <Route path="/educator/settings" element={<EducatorSettings />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}