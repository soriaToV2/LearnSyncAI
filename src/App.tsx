import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';

// Educator
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/educator/Dashboard';
import CoursesList from './pages/educator/CoursesList';
import CourseResources from './pages/educator/course/CourseResources';
import CourseMastery from './pages/educator/course/CourseMastery';
import CourseAssessments from './pages/educator/course/CourseAssessments';
import CourseStudents from './pages/educator/course/CourseStudents';
import CourseAnnouncements from './pages/educator/course/CourseAnnouncements';
import EducatorSettings from './pages/educator/EducatorSettings';

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<CreateAccount />} />
        <Route path="/login" element={<Login />} />

        {/* Educator Routes */}
        <Route element={<MainLayout />}>
          <Route path="/educator/dashboard" element={<Dashboard />} />
          <Route path="/educator/courses" element={<CoursesList />} />
          <Route path="/educator/course/:courseId/resources" element={<CourseResources />} />
          <Route path="/educator/course/:courseId/mastery" element={<CourseMastery />} />
          <Route path="/educator/course/:courseId/assessments" element={<CourseAssessments />} />
          <Route path="/educator/course/:courseId/students" element={<CourseStudents />} />
          <Route path="/educator/course/:courseId/announcements" element={<CourseAnnouncements />} />
          <Route path="/educator/settings" element={<EducatorSettings />} />
          <Route path="/dashboard" element={<Navigate to="/educator/dashboard" replace />} />
          <Route path="/class/:classId/*" element={<Navigate to="/educator/courses" replace />} />
        </Route>

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
        </Route>

      </Routes>
    </BrowserRouter>
  );
}