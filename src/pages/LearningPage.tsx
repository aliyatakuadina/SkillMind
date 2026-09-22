import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getCourseAssetUrl,
  getLearningCourse,
  logLearningEvent,
  setLessonCompleted,
  issueCertificateIfEligible,
  type LearningCourse,
} from '../lib/learningRepository'
import { QuizPanel } from '../components/QuizPanel'
import { AssignmentPanel } from '../components/AssignmentPanel'
import { LessonVideoPlayer } from '../components/LessonVideoPlayer'
import { LessonChatPanel } from '../components/LessonChatPanel'
import { RewardsPanel } from '../components/RewardsPanel'
import { awardXp, getAiRuntimeFlags, isSkillmindApiConfigured } from '../lib/skillmindApi'
import { t } from '../i18n'

export function LearningPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>()
  const navigate = useNavigate()
  const [course, setCourse] = useState<LearningCourse | null>(null)
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(new Set())
  const [resolvedResource, setResolvedResource] = useState({ source: '', url: '' })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingProgress, setSavingProgress] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatEnabled, setChatEnabled] = useState(false)
  const [gamificationEnabled, setGamificationEnabled] = useState(false)

  useEffect(() => {
    if (!courseId) return
    let active = true
    void getLearningCourse(courseId)
      .then((data) => {
        if (!active) return
        setCourse(data)
        setCompletedLessonIds(new Set(data.completedLessonIds))
      })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  useEffect(() => {
    let active = true
    void getAiRuntimeFlags()
      .then((flags) => {
        if (!active) return
        setChatEnabled(flags.chatEnabled)
        setGamificationEnabled(flags.gamificationEnabled)
      })
      .catch(() => {
        if (!active) return
        setChatEnabled(false)
        setGamificationEnabled(false)
      })
    return () => { active = false }
  }, [])

  const allLessons = useMemo(() => course?.modules.flatMap((module) => module.lessons.map((lesson) => ({ lesson, moduleTitle: module.title }))) ?? [], [course])
  const currentIndex = allLessons.findIndex((item) => item.lesson.id === lessonId)
  const safeIndex = currentIndex >= 0 ? currentIndex : 0
  const activeItem = allLessons[safeIndex]
  const activeLesson = activeItem?.lesson

  useEffect(() => {
    if (!courseId || !activeLesson) return
    void logLearningEvent(courseId, activeLesson.id, 'lesson_opened').catch(() => undefined)
    const path = activeLesson.videoUrl
    if (!path) return
    let active = true
    void getCourseAssetUrl(path)
      .then((url) => { if (active) setResolvedResource({ source: path, url }) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [activeLesson, courseId])

  const claimXp = async (
    eventType: 'lesson_completed' | 'quiz_passed' | 'assignment_accepted' | 'certificate_issued',
    entityId: string,
  ) => {
    if (!gamificationEnabled || !courseId || !isSkillmindApiConfigured()) return
    try {
      await awardXp({ eventType, entityId, courseId })
    } catch {
      // uniqueness / flag race — progress already saved
    }
  }

  const updateCompletion = async (completed: boolean): Promise<boolean> => {
    if (!activeLesson || !courseId) return false
    const previous = new Set(completedLessonIds)
    const next = new Set(previous)
    if (completed) next.add(activeLesson.id)
    else next.delete(activeLesson.id)
    setCompletedLessonIds(next)
    setSavingProgress(true)
    try {
      await setLessonCompleted(activeLesson.id, completed)
      if (completed) {
        await logLearningEvent(courseId, activeLesson.id, 'lesson_completed')
        await claimXp('lesson_completed', activeLesson.id)
      }
      return true
    } catch (caught) {
      setCompletedLessonIds(previous)
      setError(caught instanceof Error ? caught.message : t('learning.saveError'))
      return false
    } finally {
      setSavingProgress(false)
    }
  }

  if (loading) return <section className="page-wrap"><p>{t('learning.loading')}</p></section>
  if (!course || !activeLesson) return <section className="page-wrap empty-catalog-state"><h1>{t('learning.unavailable')}</h1><p>{error || t('learning.enrollToOpen')}</p><Link className="button" to={`/courses/${courseId ?? ''}`}>{t('learning.coursePage')}</Link></section>

  const previousLesson = safeIndex > 0 ? allLessons[safeIndex - 1].lesson : null
  const nextLesson = safeIndex < allLessons.length - 1 ? allLessons[safeIndex + 1].lesson : null
  const progressPercent = Math.round((completedLessonIds.size / Math.max(allLessons.length, 1)) * 100)
  const isCompleted = completedLessonIds.has(activeLesson.id)
  const resourceUrl = activeLesson.videoUrl && resolvedResource.source === activeLesson.videoUrl
    ? resolvedResource.url
    : ''

  const goToLesson = (id: string) => {
    setMobileSidebarOpen(false)
    setError(null)
    navigate(`/learn/${course.id}/lesson/${id}`)
  }

  const completeAndContinue = async () => {
    if (!isCompleted && !await updateCompletion(true)) return
    if (nextLesson) goToLesson(nextLesson.id)
    else {
      const certificateId = await issueCertificateIfEligible(course.id)
      if (certificateId) await claimXp('certificate_issued', certificateId)
      navigate(certificateId ? `/certificates/${certificateId}` : '/dashboard')
    }
  }

  return (
    <section className="learning-layout">
      <div className="learning-mobile-bar"><button type="button" className="mobile-curriculum-toggle" onClick={() => setMobileSidebarOpen((open) => !open)} aria-expanded={mobileSidebarOpen}><span>☰</span><b>{t('learning.contents')}</b><small>{safeIndex + 1}/{allLessons.length}</small></button><span className="learning-mobile-progress">{t('learning.percent', { percent: progressPercent })}</span></div>
      <aside className={`lesson-sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top-actions"><Link to={`/courses/${course.id}`} className="back-to-course-link">← {t('learning.backCourse')}</Link>{mobileSidebarOpen ? <button type="button" className="close-sidebar-btn" onClick={() => setMobileSidebarOpen(false)} aria-label={t('learning.closeContents')}>✕</button> : null}</div>
        <h2 className="sidebar-course-title">{course.title}</h2>
        <div className="sidebar-progress"><div><span>{t('learning.totalProgress')}</span><b>{progressPercent}%</b></div><div className="progress-bar"><i style={{ width: `${progressPercent}%` }} /></div><small className="progress-lessons-label">{t('learning.lessonsProgress', { completed: completedLessonIds.size, total: allLessons.length })}</small></div>
        <div className="sidebar-modules-list">{course.modules.map((module) => <div key={module.id} className="sidebar-module-group"><p className="sidebar-module-name">{module.title}</p>{module.lessons.map((lesson) => <button key={lesson.id} type="button" className={`lesson-link ${lesson.id === activeLesson.id ? 'active' : ''} ${completedLessonIds.has(lesson.id) ? 'completed' : ''}`} onClick={() => goToLesson(lesson.id)}><span className="lesson-status-icon">{completedLessonIds.has(lesson.id) ? '✓' : ''}</span><span className="lesson-link-title">{lesson.title}</span></button>)}</div>)}</div>
        <RewardsPanel enabled={gamificationEnabled} courseId={course.id} />
      </aside>

      <article className="lesson-content">
        {error && <div className="notification-banner error" role="alert">{error}</div>}
        <div className="lesson-meta-bar"><p className="eyebrow">{activeItem.moduleTitle} · {t('learning.lessonPosition', { current: safeIndex + 1, total: allLessons.length })}</p><button type="button" className={`complete-toggle-btn ${isCompleted ? 'is-done' : ''}`} disabled={savingProgress} onClick={() => void updateCompletion(!isCompleted)}>{isCompleted ? t('learning.passed') : t('learning.markPassed')}</button></div>
        <h1 className="lesson-main-title">{activeLesson.title}</h1><p className="lesson-lead">{activeLesson.description || t('learning.defaultLead')}</p>

        {activeLesson.type === 'video' && <LessonVideoPlayer lesson={activeLesson} resourceUrl={resourceUrl} />}
        {activeLesson.type === 'pdf' && (resourceUrl ? <iframe className="lesson-document" src={resourceUrl} title={t('learning.pdfTitle', { title: activeLesson.title })} /> : <p>{t('learning.pdfMissing')}</p>)}
        {activeLesson.type === 'document' && (resourceUrl ? <iframe className="lesson-document" src={resourceUrl} title={t('learning.pdfTitle', { title: activeLesson.title })} /> : <div className="callout"><b>{t('learning.document')}</b><p>{t('learning.previewMissing')}</p></div>)}
        {activeLesson.type === 'quiz' && <QuizPanel lessonId={activeLesson.id} onPassed={async () => { await updateCompletion(true); await claimXp('quiz_passed', activeLesson.id) }} />}
        {activeLesson.type === 'homework' && (
          <AssignmentPanel
            lessonId={activeLesson.id}
            onSubmitted={async () => { await updateCompletion(true) }}
            onAccepted={async () => { await claimXp('assignment_accepted', activeLesson.id) }}
          />
        )}
        {activeLesson.type === 'text' && <div className="lesson-copy"><h2>{t('learning.material')}</h2><p>{activeLesson.content || t('learning.textMissing')}</p></div>}

        <LessonChatPanel enabled={chatEnabled} courseId={course.id} lessonId={activeLesson.id} lessonTitle={activeLesson.title} />

        <div className="lesson-navigation"><button className="button button-muted" type="button" onClick={() => previousLesson && goToLesson(previousLesson.id)} disabled={!previousLesson}>{t('learning.previous')}</button><button className="button" type="button" disabled={savingProgress} onClick={() => void completeAndContinue()}>{nextLesson ? t('learning.next') : t('learning.finish')}</button></div>
      </article>
    </section>
  )
}
