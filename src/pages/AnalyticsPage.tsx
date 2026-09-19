import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCourseAnalytics, type CourseAnalytics } from '../lib/analyticsRepository'
import { t } from '../i18n'

export function AnalyticsPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const [analytics, setAnalytics] = useState<CourseAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt] = useState(() => Date.now())

  useEffect(() => {
    if (!courseId) return
    let active = true
    void getCourseAnalytics(courseId)
      .then((data) => { if (active) setAnalytics(data) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  const metrics = useMemo(() => {
    const students = analytics?.students ?? []
    return {
      active: students.filter((student) => loadedAt - new Date(student.lastActivity).getTime() <= 30 * 86400000).length,
      completed: students.filter((student) => student.progressPercent >= 100).length,
      averageProgress: students.length ? Math.round(students.reduce((sum, student) => sum + student.progressPercent, 0) / students.length) : 0,
      averageHours: students.length ? (students.reduce((sum, student) => sum + student.learningSeconds, 0) / students.length / 3600).toFixed(1) : '0.0',
    }
  }, [analytics, loadedAt])

  const exportCsv = () => {
    if (!analytics) return
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = analytics.students.map((student) => [student.id, student.name, student.email, student.progressPercent, student.averageQuizScore ?? '', student.learningSeconds, student.submittedAssignments, student.gradedAssignments, student.lastActivity].map(escape).join(','))
    const header = ['ID', t('analytics.csvName'), 'Email', t('analytics.csvProgress'), t('analytics.csvAverageQuiz'), t('analytics.csvLearningTime'), t('analytics.csvSubmitted'), t('analytics.csvGraded'), t('analytics.csvLastActivity')].map(escape).join(',')
    const blob = new Blob([`\uFEFF${header}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `analytics-${courseId}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <section className="page-wrap"><p>{t('analytics.loading')}</p></section>
  if (!analytics) return <section className="page-wrap empty-catalog-state"><h1>{t('analytics.unavailable')}</h1><p>{error}</p><Link className="button" to="/teacher/courses">{t('analytics.backCourses')}</Link></section>

  return <section className="page-wrap analytics-page">
    <nav className="breadcrumbs"><Link to="/teacher/courses">{t('teacher.eyebrow')}</Link><span className="breadcrumb-separator">/</span><span>{t('analytics.breadcrumb')}</span></nav>
    <div className="section-heading"><div><p className="eyebrow">{analytics.courseTitle}</p><h1>{t('analytics.title')}</h1></div><button className="button button-muted" type="button" onClick={exportCsv}>{t('analytics.export')}</button></div>
    <div className="metric-grid"><article className="metric"><span>{t('analytics.enrolled')}</span><strong>{analytics.students.length}</strong></article><article className="metric"><span>{t('analytics.active')}</span><strong>{metrics.active}</strong></article><article className="metric"><span>{t('analytics.completed')}</span><strong>{metrics.completed}</strong></article><article className="metric"><span>{t('analytics.averageProgress')}</span><strong>{metrics.averageProgress}%</strong></article><article className="metric"><span>{t('analytics.averageTime')}</span><strong>{t('analytics.hours', { hours: metrics.averageHours })}</strong></article></div>

    <div className="section-heading" style={{ marginTop: '40px' }}><h2>{t('analytics.quizResults')}</h2></div>
    <div className="metric-grid">{analytics.quizResults.length ? analytics.quizResults.map((quiz) => <article className="metric" key={quiz.title}><span>{quiz.title}</span><strong>{quiz.averageScore == null ? '—' : `${quiz.averageScore}%`}</strong><small>{t('analytics.attempts', { count: quiz.attempts, rate: quiz.passRate ?? 0 })}</small></article>) : <p className="text-muted">{t('analytics.noQuizResults')}</p>}</div>

    <div className="section-heading" style={{ marginTop: '40px' }}><h2>{t('analytics.students')}</h2><span className="count-badge">{analytics.students.length}</span></div>
    <div className="teacher-table"><div className="table-head"><span>{t('analytics.student')}</span><span>{t('analytics.progress')}</span><span>{t('analytics.quizzes')}</span><span>{t('analytics.assignments')}</span><span>{t('analytics.activity')}</span></div>{analytics.students.map((student) => <div className="table-row" key={student.id}><div><b>{student.name}</b><small>{student.email}</small></div><div><div className="progress-bar mini-table-bar"><i style={{ width: `${student.progressPercent}%` }} /></div><small>{student.completedLessons}/{analytics.lessonCount} · {student.progressPercent}%</small></div><b>{student.averageQuizScore == null ? '—' : `${student.averageQuizScore}%`}</b><span>{t('analytics.graded', { graded: student.gradedAssignments, submitted: student.submittedAssignments })}</span><span className="text-muted">{new Intl.DateTimeFormat('ru-RU').format(new Date(student.lastActivity))}</span></div>)}</div>
  </section>
}
