import { Link } from 'react-router-dom'
import { mockCourses, mockSubmissions } from '../data/mockData'

export function TeacherCoursesPage() {
  const pendingSubmissionsCount = mockSubmissions.filter((s) => s.status === 'pending').length

  return (
    <section className="page-wrap teacher-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Кабинет преподавателя</p>
          <h1>Управление курсами</h1>
        </div>
        <div className="teacher-top-actions">
          <Link to="/teacher/submissions" className="button button-muted">
            📝 Работы на проверке{' '}
            {pendingSubmissionsCount > 0 && <span className="badge-count-pill">{pendingSubmissionsCount}</span>}
          </Link>
          <Link className="button" to="/teacher/courses/create">
            + Создать курс
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="teacher-summary">
        <article className="metric">
          <span>Опубликовано курсов</span>
          <strong>3</strong>
        </article>
        <article className="metric">
          <span>На модерации</span>
          <strong>1</strong>
        </article>
        <article className="metric">
          <span>Всего студентов</span>
          <strong>288</strong>
        </article>
      </div>

      {/* Courses List Table */}
      <div className="section-heading" style={{ marginTop: '35px' }}>
        <h2>Ваши программы</h2>
      </div>

      <div className="teacher-table">
        <div className="table-head">
          <span>Курс</span>
          <span>Категория</span>
          <span>Статус</span>
          <span>Студенты</span>
          <span>Действия</span>
        </div>

        {mockCourses.map((course) => {
          const isPublished = course.status === 'published'
          const isReview = course.status === 'review'

          return (
            <div className="table-row" key={course.id}>
              <div className="table-course-info">
                <b>{course.title}</b>
                <small>{course.lessonsCount} уроков · {course.duration}</small>
              </div>

              <span className="table-category">{course.category}</span>

              <div>
                {isPublished && <span className="status published">Опубликован</span>}
                {isReview && <span className="status review">На модерации</span>}
                {course.status === 'draft' && <span className="status draft">Черновик</span>}
              </div>

              <span className="table-students-count">
                {course.studentsCount > 0 ? `${course.studentsCount} чел.` : '—'}
              </span>

              <div className="table-actions-cell">
                <Link
                  to={`/teacher/courses/${course.id}/analytics`}
                  className="table-action-btn"
                  title="Посмотреть статистику студентов"
                >
                  Аналитика
                </Link>
                <Link
                  to={`/teacher/courses/${course.id}/edit`}
                  className="table-action-btn"
                  title="Редактировать структуру курса"
                >
                  Редактор
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
