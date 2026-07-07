import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';

// Student
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentCourseView from './pages/student/StudentCourseView';
import StudentProfile from './pages/student/StudentProfile';
import Settings from './pages/student/Settings';
import StudySpacesList from './pages/student/StudySpacesList';
import StudySpace from './pages/student/StudySpace';
import PlayMeGames from './pages/student/PlayMeGames';
import CourseCatalog from './pages/student/Course';

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
          <Route path="/student/course/:courseId" element={<StudentCourseView />} />
          <Route path="/student/profile/:studentId" element={<StudentProfile />} />
          <Route path="/student/settings" element={<Settings />} />
          <Route path="/student/spaces" element={<StudySpacesList />} />
          <Route path="/student/space/:spaceId" element={<StudySpace />} />
          <Route path="/student/games" element={<PlayMeGames />} />
          <Route path="/student/catalog" element={<CourseCatalog />} />
          
          <Route path="/dashboard" element={<Navigate to="/student/dashboard" replace />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}