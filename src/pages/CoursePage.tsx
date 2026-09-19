import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { enrollInCourse, getPublishedCourse, isEnrolled } from '../lib/learningRepository'
import type { Course } from '../types'
import { t } from '../i18n'

export function CoursePage({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const [course, setCourse] = useState<Course | null>(null)
  const [enrolled, setEnrolled] = useState(false)
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!courseId) return
    let active = true
    void Promise.all([getPublishedCourse(courseId), isEnrolled(courseId)])
      .then(([loadedCourse, enrollment]) => {
        if (!active) return
        setCourse(loadedCourse)
        setEnrolled(enrollment)
        setExpandedModules(Object.fromEntries(loadedCourse.modules.map((module) => [module.id, true])))
      })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  const handleStart = async () => {
    if (!course) return
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/courses/${course.id}` } })
      return
    }
    const firstLessonId = course.modules[0]?.lessons[0]?.id
    if (!firstLessonId) {
      setError(t('course.noLessons'))
      return
    }
    setEnrolling(true)
    setError(null)
    try {
      if (!enrolled) await enrollInCourse(course.id)
      setEnrolled(true)
      navigate(`/learn/${course.id}/lesson/${firstLessonId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('course.enrollError'))
    } finally {
      setEnrolling(false)
    }
  }

  if (loading) return <section className="page-wrap"><p>{t('common.loadingCourse')}</p></section>
  if (!course) return <section className="page-wrap empty-catalog-state"><h1>{t('course.notFound')}</h1><p>{error || t('course.notPublished')}</p><Link className="button" to="/courses">{t('common.backCatalog')}</Link></section>

  return (
    <section className="page-wrap course-page">
      <nav className="breadcrumbs" aria-label={t('course.breadcrumbs')}><Link to="/courses">{t('footer.catalog')}</Link><span className="breadcrumb-separator">/</span><span>{course.category}</span><span className="breadcrumb-separator">/</span><span className="breadcrumb-current">{course.title}</span></nav>
      {error && <div className="notification-banner error" role="alert">{error}</div>}
      <div className="course-intro">
        <div className="course-intro-main"><div className="course-badge-row"><span className="eyebrow">{course.category}</span></div><h1>{course.title}</h1><p className="course-hero-desc">{course.description}</p><div className="author-card"><div className="author-avatar">{course.author[0]}</div><div><span className="author-label">{t('role.teacher')}</span><strong>{course.author}</strong></div></div></div>
        <aside className="course-aside">
          <div className="aside-header"><p>{t('course.parameters')}</p><strong>{t('course.lessons', { count: course.lessonsCount })}</strong><span>{t('course.flexible', { duration: course.duration })}</span></div>
          <div className="aside-features"><div className="aside-feature-item"><span>✦</span> {t('course.instantAccess')}</div><div className="aside-feature-item"><span>✓</span> {t('course.homeworkReview')}</div><div className="aside-feature-item"><span>🏆</span> {t('course.digitalCertificate')}</div></div>
          <button className="button button-block" type="button" disabled={enrolling} onClick={() => void handleStart()}>{enrolling ? t('course.enrolling') : enrolled ? t('course.continue') : t('course.enrollFree')}</button>
        </aside>
      </div>
      <div className="course-details">
        <div className="course-about-col"><h2>{t('course.about')}</h2><p>{course.description}</p><div className="course-guarantee-box"><h4>{t('course.certificateTitle')}</h4><p>{t('course.certificateDescription')}</p></div></div>
        <div className="course-syllabus-col"><div className="syllabus-header"><h2>{t('course.program')}</h2><span className="modules-count">{t('course.modules', { count: course.modules.length })}</span></div><div className="accordion-modules">
          {course.modules.map((module, moduleIndex) => { const expanded = Boolean(expandedModules[module.id]); return <div className="module-accordion-item" key={module.id}>
            <button type="button" className={`module-accordion-header ${expanded ? 'expanded' : ''}`} onClick={() => setExpandedModules((current) => ({ ...current, [module.id]: !current[module.id] }))} aria-expanded={expanded}><span className="mod-number">{String(moduleIndex + 1).padStart(2, '0')}</span><div className="mod-header-info"><b>{module.title}</b><small>{t('course.lessons', { count: module.lessons.length })}</small></div><span className="accordion-caret">{expanded ? '▲' : '▼'}</span></button>
            {expanded ? <ul className="module-lessons-list">{module.lessons.map((lesson, lessonIndex) => <li key={lesson.id} className="module-lesson-row"><span className="lesson-icon">📄</span><div className="lesson-row-info"><span className="lesson-name">{lessonIndex + 1}. {lesson.title}</span></div>{enrolled ? <Link to={`/learn/${course.id}/lesson/${lesson.id}`} className="lesson-start-link">{t('course.watch')}</Link> : <span className="text-muted">{t('course.afterEnroll')}</span>}</li>)}</ul> : null}
          </div> })}
        </div></div>
      </div>
    </section>
  )
}
