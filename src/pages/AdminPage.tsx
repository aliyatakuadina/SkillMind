import { useEffect, useState } from 'react'
import {
  listAdminUsers,
  listModerationCourses,
  moderateCourse,
  setAdminUserRole,
  type AdminUser,
  type ModerationCourse,
} from '../lib/adminRepository'
import { AdminAiPanel } from '../components/AdminAiPanel'
import type { UserRole } from '../types'
import { t } from '../i18n'

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'moderation' | 'ai'>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [courses, setCourses] = useState<ModerationCourse[]>([])
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([listAdminUsers(), listModerationCourses()])
      .then(([loadedUsers, loadedCourses]) => { if (active) { setUsers(loadedUsers); setCourses(loadedCourses) } })
      .catch((caught: Error) => { if (active) setMessage({ kind: 'error', text: caught.message }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const changeRole = async (user: AdminUser, role: UserRole) => {
    setBusyId(user.id)
    setMessage(null)
    try {
      await setAdminUserRole(user.id, role)
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role } : item))
      setMessage({ kind: 'success', text: t('admin.roleUpdated') })
    } catch (caught) {
      setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : t('admin.roleError') })
    } finally { setBusyId(null) }
  }

  const decide = async (course: ModerationCourse, approve: boolean) => {
    setBusyId(course.id)
    setMessage(null)
    try {
      await moderateCourse(course.id, approve, comments[course.id] ?? '')
      setCourses((current) => current.filter((item) => item.id !== course.id))
      setMessage({ kind: 'success', text: approve ? t('admin.coursePublished') : t('admin.courseReturned') })
    } catch (caught) {
      setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : t('admin.decisionError') })
    } finally { setBusyId(null) }
  }

  return <section className="page-wrap admin-page">
    <div className="section-heading"><div><p className="eyebrow">{t('admin.eyebrow')}</p><h1>{t('admin.title')}</h1></div></div>
    {message && <div className={`notification-banner ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    <div className="admin-tabs" role="tablist">
      <button role="tab" aria-selected={activeTab === 'users'} className={activeTab === 'users' ? 'active' : ''} type="button" onClick={() => setActiveTab('users')}>{t('admin.usersTab', { count: users.length })}</button>
      <button role="tab" aria-selected={activeTab === 'moderation'} className={activeTab === 'moderation' ? 'active' : ''} type="button" onClick={() => setActiveTab('moderation')}>{t('admin.coursesTab')} <span>{courses.length}</span></button>
      <button role="tab" aria-selected={activeTab === 'ai'} className={activeTab === 'ai' ? 'active' : ''} type="button" onClick={() => setActiveTab('ai')}>{t('admin.aiTab')}</button>
    </div>
    {activeTab === 'ai' ? <AdminAiPanel /> : loading ? <p>{t('admin.loading')}</p> : activeTab === 'users' ? <div className="teacher-table"><div className="table-head"><span>{t('admin.user')}</span><span>{t('auth.email')}</span><span>{t('profile.role')}</span><span>{t('admin.registration')}</span><span>{t('admin.changeRole')}</span></div>{users.map((user) => <div className="table-row" key={user.id}><div><b>{user.fullName}</b><small>{t('admin.enrollments', { count: user.enrollmentsCount })}</small></div><span className="text-muted">{user.email}</span><span className={`status ${user.role === 'admin' ? 'review' : user.role === 'teacher' ? 'published' : 'student'}`}>{user.role === 'admin' ? t('role.admin') : user.role === 'teacher' ? t('role.teacher') : t('role.student')}</span><span className="text-muted">{new Intl.DateTimeFormat('ru-RU').format(new Date(user.createdAt))}</span><select value={user.role} disabled={busyId === user.id} onChange={(event) => void changeRole(user, event.target.value as UserRole)} className="role-inline-select"><option value="student">{t('role.student')}</option><option value="teacher">{t('role.teacher')}</option><option value="admin">{t('role.admin')}</option></select></div>)}</div> : <div className="moderation-queue-container">{courses.length ? courses.map((course) => <article className="moderation-card" key={course.id}><div className="moderation-card-top"><div><span className="status review">{t('admin.awaiting')}</span><h2>{course.title}</h2><p className="moderation-meta">{t('admin.authorMeta', { author: course.authorName, category: course.category, lessons: course.lessonCount })}</p></div></div><div className="moderation-syllabus-preview"><h4>{t('admin.program')}</h4><ul>{course.modules.map((module) => <li key={module.id}><strong>{module.title}</strong> — {t('course.lessons', { count: module.lessonCount })}</li>)}</ul></div><label className="moderation-comment">{t('admin.comment')}<textarea rows={3} value={comments[course.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [course.id]: event.target.value }))} placeholder={t('admin.commentPlaceholder')} /></label><div className="moderation-actions"><button type="button" className="button button-muted" disabled={busyId === course.id} onClick={() => void decide(course, false)}>{t('admin.return')}</button><button type="button" className="button" disabled={busyId === course.id} onClick={() => void decide(course, true)}>{t('admin.publish')}</button></div></article>) : <div className="empty-catalog-state"><span className="empty-icon">✓</span><h3>{t('admin.emptyTitle')}</h3><p>{t('admin.emptyDescription')}</p></div>}</div>}
  </section>
}
