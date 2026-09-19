import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteCourse, listTeacherCourses, type TeacherCourseSummary } from '../lib/courseRepository'
import { t } from '../i18n'

const statusLabels: Record<TeacherCourseSummary['status'], string> = {
  draft: t('teacher.statusDraft'), pending_review: t('teacher.statusReview'), published: t('teacher.statusPublished'),
  changes_requested: t('teacher.statusChanges'), archived: t('teacher.statusArchived'),
}

export function TeacherCoursesPage() {
  const [courses, setCourses] = useState<TeacherCourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listTeacherCourses()
      .then((data) => { if (active) setCourses(data) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const publishedCount = courses.filter((course) => course.status === 'published').length
  const reviewCount = courses.filter((course) => course.status === 'pending_review').length
  const studentCount = courses.reduce((total, course) => total + course.studentCount, 0)

  const handleDelete = async (course: TeacherCourseSummary) => {
    if (!window.confirm(t('teacher.deleteConfirm', { title: course.title }))) return
    setDeletingId(course.id)
    setError(null)
    try {
      await deleteCourse(course.id)
      setCourses((current) => current.filter((item) => item.id !== course.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('teacher.deleteError'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="page-wrap teacher-page">
      <div className="section-heading">
        <div><p className="eyebrow">{t('teacher.eyebrow')}</p><h1>{t('teacher.title')}</h1></div>
        <div className="teacher-top-actions">
          <Link to="/teacher/submissions" className="button button-muted">{t('teacher.reviewWork')}</Link>
          <Link className="button" to="/teacher/courses/create">{t('teacher.create')}</Link>
        </div>
      </div>
      {error && <div className="notification-banner error" role="alert">{error}</div>}
      <div className="teacher-summary">
        <article className="metric"><span>{t('teacher.publishedCount')}</span><strong>{publishedCount}</strong></article>
        <article className="metric"><span>{t('teacher.reviewCount')}</span><strong>{reviewCount}</strong></article>
        <article className="metric"><span>{t('teacher.studentCount')}</span><strong>{studentCount}</strong></article>
      </div>
      <div className="section-heading" style={{ marginTop: '35px' }}><h2>{t('teacher.programs')}</h2></div>
      {loading ? <p>{t('teacher.loading')}</p> : courses.length === 0 ? (
        <div className="empty-catalog-state"><h3>{t('teacher.emptyTitle')}</h3><p>{t('teacher.emptyDescription')}</p><Link className="button" to="/teacher/courses/create">{t('teacher.createPlain')}</Link></div>
      ) : (
        <div className="teacher-table">
          <div className="table-head"><span>{t('teacher.columnCourse')}</span><span>{t('teacher.columnCategory')}</span><span>{t('teacher.columnStatus')}</span><span>{t('teacher.columnStudents')}</span><span>{t('teacher.columnActions')}</span></div>
          {courses.map((course) => {
            const editable = course.status === 'draft' || course.status === 'changes_requested'
            return <div className="table-row" key={course.id}>
              <div className="table-course-info"><b>{course.title}</b><small>{t('course.lessons', { count: course.lessonCount })} · {course.estimatedDuration || t('teacher.noDuration')}</small></div>
              <span className="table-category">{course.category || t('teacher.noCategory')}</span>
              <div><span className={`status ${course.status === 'published' ? 'published' : course.status === 'pending_review' ? 'review' : 'draft'}`}>{statusLabels[course.status]}</span></div>
              <span className="table-students-count">{course.studentCount > 0 ? t('teacher.people', { count: course.studentCount }) : '—'}</span>
              <div className="table-actions-cell">
                {course.status === 'published' && <Link to={`/teacher/courses/${course.id}/analytics`} className="table-action-btn">{t('teacher.analytics')}</Link>}
                {editable ? <Link to={`/teacher/courses/${course.id}/edit`} className="table-action-btn">{t('teacher.editor')}</Link> : <span className="text-muted">{t('teacher.editClosed')}</span>}
                {editable && <button type="button" className="table-action-btn danger" disabled={deletingId === course.id} onClick={() => void handleDelete(course)}>{deletingId === course.id ? t('teacher.deleting') : t('teacher.delete')}</button>}
              </div>
            </div>
          })}
        </div>
      )}
    </section>
  )
}
