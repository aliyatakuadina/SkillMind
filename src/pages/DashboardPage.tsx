import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getDashboardData,
  type DashboardCertificate,
  type DashboardCourse,
} from '../lib/learningRepository'
import { t } from '../i18n'

export function DashboardPage() {
  const [fullName, setFullName] = useState('')
  const [courses, setCourses] = useState<DashboardCourse[]>([])
  const [certificates, setCertificates] = useState<DashboardCertificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getDashboardData()
      .then((data) => {
        if (!active) return
        setFullName(data.fullName)
        setCourses(data.courses)
        setCertificates(data.certificates)
      })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const currentCourse = courses.find((course) => course.progressPercent < 100 && course.nextLessonId) ?? courses[0]
  const completedLessons = courses.reduce((total, course) => total + course.completedCount, 0)

  if (loading) return <section className="page-wrap"><p>{t('dashboard.loading')}</p></section>

  return (
    <section className="page-wrap dashboard">
      <div className="dashboard-header"><p className="eyebrow">{t('dashboard.eyebrow')}</p><h1>{t('dashboard.welcome', { name: fullName ? `, ${fullName.split(' ')[0]}` : '' })}</h1><p className="dashboard-sublead">{t('dashboard.lead')}</p></div>
      {error && <div className="notification-banner error" role="alert">{error}</div>}
      <div className="dashboard-overview"><article className="metric"><span>{t('dashboard.inProgress')}</span><strong>{courses.filter((course) => course.progressPercent < 100).length}</strong></article><article className="metric"><span>{t('dashboard.lessonsCompleted')}</span><strong>{completedLessons}</strong></article><article className="metric"><span>{t('dashboard.certificatesReceived')}</span><strong>{certificates.length}</strong></article></div>

      <div className="section-heading"><h2>{t('dashboard.currentLesson')}</h2><Link className="text-action" to="/courses">{t('dashboard.allCatalog')} <span>→</span></Link></div>
      {currentCourse?.nextLessonId ? <div className="continue-card"><div className="continue-icon">▶</div><div className="continue-body"><p className="course-meta">{currentCourse.title} · {t('dashboard.courseProgress', { completed: currentCourse.completedCount, total: currentCourse.lessonCount })}</p><h2>{currentCourse.nextLessonTitle}</h2><div className="progress-row"><div className="progress-bar"><i style={{ width: `${currentCourse.progressPercent}%` }} /></div><b>{t('dashboard.percentComplete', { percent: currentCourse.progressPercent })}</b></div></div><Link className="button" to={`/learn/${currentCourse.id}/lesson/${currentCourse.nextLessonId}`}>{t('dashboard.continueLesson')}</Link></div> : <div className="empty-catalog-state"><h3>{t('dashboard.startTitle')}</h3><p>{t('dashboard.startDescription')}</p><Link className="button" to="/courses">{t('dashboard.openCatalog')}</Link></div>}

      <div className="section-heading" style={{ marginTop: '55px' }}><h2>{t('dashboard.myCourses')}</h2></div>
      <div className="enrolled-courses-grid">{courses.map((course) => <div className="enrolled-course-item" key={course.id}><div className="enrolled-item-top"><span className="enrolled-category">{course.category}</span><span className="enrolled-status">{course.progressPercent === 100 ? t('dashboard.completed') : t('dashboard.active')}</span></div><h3>{course.title}</h3><p>{course.description}</p><div className="enrolled-item-progress"><div className="progress-bar"><i style={{ width: `${course.progressPercent}%` }} /></div><span>{t('dashboard.percentShort', { percent: course.progressPercent })}</span></div><div className="enrolled-item-actions">{course.nextLessonId ? <Link to={`/learn/${course.id}/lesson/${course.nextLessonId}`} className="button button-small">{t('dashboard.goLessons')}</Link> : null}<Link to={`/courses/${course.id}`} className="link-muted-small">{t('dashboard.courseProgram')}</Link></div></div>)}</div>

      <div className="section-heading" style={{ marginTop: '60px' }}><div><p className="eyebrow">{t('dashboard.achievements')}</p><h2>{t('dashboard.myCertificates')}</h2></div></div>
      {certificates.length ? <div className="certificates-grid">{certificates.map((certificate) => <div className="certificate-badge-card" key={certificate.id}><div className="cert-card-icon">🏆</div><div className="cert-card-info"><h4>{certificate.courseTitle}</h4><p>{t('dashboard.issued', { date: new Intl.DateTimeFormat('ru-RU').format(new Date(certificate.issuedAt)) })}</p><small className="cert-number">ID: {certificate.certificateNumber}</small></div><Link to={`/certificates/${certificate.id}`} className="button button-small button-muted">{t('dashboard.view')}</Link></div>)}</div> : <p className="text-muted">{t('dashboard.noCertificates')}</p>}
    </section>
  )
}
