/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateAccount from './pages/auth/CreateAccount';
import Login from './pages/auth/Login';
import Dashboard from './pages/educator/Dashboard';
import ClassroomResources from './pages/educator/classroom/ClassroomResources';
import ClassroomQuizzes from './pages/educator/classroom/ClassroomQuizzes';
import ClassroomStudents from './pages/educator/classroom/ClassroomStudents';
import MainLayout from './components/layout/MainLayout';
import StudentLayout from './components/layout/StudentLayout';
import StudentDashboard from './pages/student/StudentDashboard';
import StudentCourseView from './pages/student/StudentCourseView';
import StudentProfile from './pages/student/StudentProfile';
import StudySpacesList from './pages/student/StudySpacesList';
import StudySpace from './pages/student/StudySpace';
import LockdownExam from './pages/student/LockdownExam';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<CreateAccount />} />
        <Route path="/login" element={<Login />} />
        
        {/* Educator Routes */}
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/class/:classId/resources" element={<ClassroomResources />} />
          <Route path="/class/:classId/quizzes" element={<ClassroomQuizzes />} />
          <Route path="/class/:classId/students" element={<ClassroomStudents />} />
        </Route>

        {/* Student Routes */}
        <Route element={<StudentLayout />}>
          <Route path="/student/dashboard" element={<StudentDashboard />} />
          <Route path="/student/course/:courseId" element={<StudentCourseView />} />
          <Route path="/student/profile/:studentId" element={<StudentProfile />} />
          <Route path="/student/spaces" element={<StudySpacesList />} />
          <Route path="/student/space/:spaceId" element={<StudySpace />} />
        </Route>
        
        {/* Exam without standard layout */}
        <Route path="/student/exam/:examId" element={<LockdownExam />} />
      </Routes>
    </BrowserRouter>
  );
}
