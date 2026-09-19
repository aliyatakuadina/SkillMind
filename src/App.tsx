import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { UserRole } from './types'
import { t } from './i18n'
import './App.css'

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((module) => ({ default: module.CatalogPage })))
const CoursePage = lazy(() => import('./pages/CoursePage').then((module) => ({ default: module.CoursePage })))
const LearningPage = lazy(() => import('./pages/LearningPage').then((module) => ({ default: module.LearningPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const CertificatePage = lazy(() => import('./pages/CertificatePage').then((module) => ({ default: module.CertificatePage })))
const CertificateVerifyPage = lazy(() => import('./pages/CertificateVerifyPage').then((module) => ({ default: module.CertificateVerifyPage })))
const TeacherCoursesPage = lazy(() => import('./pages/TeacherCoursesPage').then((module) => ({ default: module.TeacherCoursesPage })))
const CourseBuilderPage = lazy(() => import('./pages/CourseBuilderPage').then((module) => ({ default: module.CourseBuilderPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage').then((module) => ({ default: module.SubmissionsPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const NoAccessPage = lazy(() => import('./pages/NoAccessPage').then((module) => ({ default: module.NoAccessPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profileRole, setProfileRole] = useState<{ userId: string; role: UserRole } | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) {
      return
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user || !supabase) return

    let active = true
    void supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!active) return
        setProfileRole({
          userId: session.user.id,
          role: isUserRole(data?.role) ? data.role : 'student',
        })
      })

    return () => {
      active = false
    }
  }, [session?.user])

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut()
    setSession(null)
    setProfileRole(null)
  }

  const profileLoading = Boolean(session && profileRole?.userId !== session.user.id)
  const currentRole: UserRole = profileRole && profileRole.userId === session?.user.id
    ? profileRole.role
    : 'student'

  if (authLoading || profileLoading) {
    return <div className="app-loading" role="status">{t('app.loading')}</div>
  }

  return (
    <Suspense fallback={<div className="app-loading" role="status">{t('app.pageLoading')}</div>}>
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={session ? <Navigate to="/dashboard" replace /> : <AuthPage mode="register" />} />
      <Route path="/verify" element={<CertificateVerifyPage />} />
      <Route path="/verify/:verificationToken" element={<CertificatePage publicVerification />} />

      <Route element={<Layout currentRole={currentRole} user={session?.user ?? null} onLogout={handleLogout} />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/courses" element={<CatalogPage />} />
        <Route path="/courses/:courseId" element={<CoursePage isAuthenticated={Boolean(session)} />} />
        <Route path="/no-access" element={<NoAccessPage />} />

        <Route element={<ProtectedRoute session={session}><Outlet /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage user={session?.user ?? null} role={currentRole} />} />
          <Route path="/certificates/:certificateId" element={<CertificatePage />} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />

          <Route element={<RoleRoute currentRole={currentRole} allowedRoles={['teacher', 'admin']} />}>
            <Route path="/teacher/courses" element={<TeacherCoursesPage />} />
            <Route path="/teacher/courses/create" element={<CourseBuilderPage />} />
            <Route path="/teacher/courses/:courseId/edit" element={<CourseBuilderPage />} />
            <Route path="/teacher/courses/:courseId/analytics" element={<AnalyticsPage />} />
            <Route path="/teacher/submissions" element={<SubmissionsPage />} />
          </Route>

          <Route element={<RoleRoute currentRole={currentRole} allowedRoles={['admin']} />}>
            <Route path="/admin/users" element={<AdminPage />} />
          </Route>

          <Route path="/learn/:courseId/lesson/:lessonId" element={<LearningPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
  )
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'student' || value === 'teacher' || value === 'admin'
}

function ProtectedRoute({ session, children }: { session: Session | null; children: React.ReactNode }) {
  const location = useLocation()

  if (!isSupabaseConfigured) {
    return (
      <div className="setup-state">
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.description')}</p>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function RoleRoute({ currentRole, allowedRoles }: { currentRole: UserRole; allowedRoles: UserRole[] }) {
  if (!allowedRoles.includes(currentRole)) return <Navigate to="/no-access" replace />
  return <Outlet />
}

function Layout({ currentRole, user, onLogout }: { currentRole: UserRole; user: User | null; onLogout: () => Promise<void> }) {
  return (
    <div className="app-shell">
      <Header currentRole={currentRole} userEmail={user?.email ?? ''} onLogout={onLogout} />
      <main className="main-content"><Outlet /></main>
      <Footer />
    </div>
  )
}

export default App
