import { useState } from 'react'
import { Outlet, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { CoursePage } from './pages/CoursePage'
import { LearningPage } from './pages/LearningPage'
import { DashboardPage } from './pages/DashboardPage'
import { CertificatePage } from './pages/CertificatePage'
import { TeacherCoursesPage } from './pages/TeacherCoursesPage'
import { CourseBuilderPage } from './pages/CourseBuilderPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SubmissionsPage } from './pages/SubmissionsPage'
import { AdminPage } from './pages/AdminPage'
import { AuthPage } from './pages/AuthPage'
import { NotFoundPage } from './pages/NotFoundPage'
import type { UserRole } from './types'
import './App.css'

function App() {
  const [currentRole, setCurrentRole] = useState<UserRole>('student')

  return (
    <Routes>
      <Route element={<Layout currentRole={currentRole} onRoleChange={setCurrentRole} />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/courses" element={<CatalogPage />} />
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/learn/:courseId/lesson/:lessonId" element={<LearningPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/certificates/:certificateId" element={<CertificatePage />} />
        <Route path="/teacher/courses" element={<TeacherCoursesPage />} />
        <Route path="/teacher/courses/create" element={<CourseBuilderPage />} />
        <Route path="/teacher/courses/:courseId/edit" element={<CourseBuilderPage />} />
        <Route path="/teacher/courses/:courseId/analytics" element={<AnalyticsPage />} />
        <Route path="/teacher/submissions" element={<SubmissionsPage />} />
        <Route path="/admin/users" element={<AdminPage />} />
        <Route path="/login" element={<AuthPage mode="login" onLoginSuccess={setCurrentRole} />} />
        <Route path="/register" element={<AuthPage mode="register" onLoginSuccess={setCurrentRole} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

function Layout({
  currentRole,
  onRoleChange,
}: {
  currentRole: UserRole
  onRoleChange: (role: UserRole) => void
}) {
  return (
    <div className="app-shell">
      <Header currentRole={currentRole} onRoleChange={onRoleChange} />
      <main className="main-content">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}

export default App
