/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';

// Educator
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/educator/Dashboard';
import CoursesList from './pages/educator/CoursesList';
import CourseResources from './pages/educator/course/CourseResources';
import CourseAssessments from './pages/educator/course/CourseAssessments';
import CourseStudents from './pages/educator/course/CourseStudents';

// Student
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentCourseView from './pages/student/StudentCourseView';
import StudentProfile from './pages/student/StudentProfile';
import StudySpacesList from './pages/student/StudySpacesList';
import StudySpace from './pages/student/StudySpace';
import LockdownExam from './pages/student/LockdownExam';
import StudentCommunity from './pages/student/StudentCommunity';
import CourseCatalog from './pages/student/CourseCatalog';
import StudentDashboardV1 from './pages/student/StudentDashboardV1';
import StudentDashboardV2 from './pages/student/StudentDashboardV2';

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
          <Route path="/educator/course/:courseId/assessments" element={<CourseAssessments />} />
          <Route path="/educator/course/:courseId/students" element={<CourseStudents />} />
          {/* Legacy redirects */}
          <Route path="/dashboard" element={<Navigate to="/educator/dashboard" replace />} />
          <Route path="/class/:classId/*" element={<Navigate to="/educator/courses" replace />} />
        </Route>

        {/* Student Routes */}
        <Route element={<StudentLayout />}>
          <Route path="/student/dashboard" element={<StudentDashboard />} />
          <Route path="/student/dashboard/v1" element={<StudentDashboardV1 />} />
          <Route path="/student/dashboard/v2" element={<StudentDashboardV2 />} />
          <Route path="/student/course/:courseId" element={<StudentCourseView />} />
          <Route path="/student/profile/:studentId" element={<StudentProfile />} />
          <Route path="/student/spaces" element={<StudySpacesList />} />
          <Route path="/student/space/:spaceId" element={<StudySpace />} />
          <Route path="/student/community" element={<StudentCommunity />} />
          <Route path="/student/catalog" element={<CourseCatalog />} />
        </Route>
        
        {/* Exam without standard layout */}
        <Route path="/student/exam/:examId" element={<LockdownExam />} />
      </Routes>
    </BrowserRouter>
  );
}