import { Link } from 'react-router-dom'
import { mockCertificates, mockCourses } from '../data/mockData'

export function DashboardPage() {
  const currentCourse = mockCourses[0]
  const nextLessonId = 'user-research' // lesson 3

  return (
    <section className="page-wrap dashboard">
      <div className="dashboard-header">
        <p className="eyebrow">Личный кабинет студента</p>
        <h1>Рады видеть вас снова, Алия</h1>
        <p className="dashboard-sublead">
          Продолжайте обучение с того места, где остановились, или выберите новую программу.
        </p>
      </div>

      {/* Metrics Row */}
      <div className="dashboard-overview">
        <article className="metric">
          <span>Курсов в процессе</span>
          <strong>3</strong>
        </article>
        <article className="metric">
          <span>Завершено уроков</span>
          <strong>19</strong>
        </article>
        <article className="metric">
          <span>Получено сертификатов</span>
          <strong>2</strong>
        </article>
      </div>

      {/* Continue Learning Highlight */}
      <div className="section-heading">
        <h2>Текущий урок</h2>
        <Link className="text-action" to="/courses">
          Все курсы в каталоге <span>→</span>
        </Link>
      </div>

      <div className="continue-card">
        <div className="continue-icon">UX</div>
        <div className="continue-body">
          <p className="course-meta">Основы UX-дизайна · Модуль 1 · Урок 3 из 18</p>
          <h2>Методы интервью и анализ болей</h2>
          <div className="progress-row">
            <div className="progress-bar">
              <i style={{ width: '64%' }} />
            </div>
            <b>64% курса пройдено</b>
          </div>
        </div>
        <Link className="button" to={`/learn/${currentCourse.id}/lesson/${nextLessonId}`}>
          Продолжить урок →
        </Link>
      </div>

      {/* Active Courses List */}
      <div className="section-heading" style={{ marginTop: '55px' }}>
        <h2>Мои курсы</h2>
      </div>

      <div className="enrolled-courses-grid">
        {mockCourses.slice(0, 3).map((course, idx) => {
          const progressVals = ['64%', '25%', '10%']
          const progress = progressVals[idx] || '0%'

          return (
            <div className="enrolled-course-item" key={course.id}>
              <div className="enrolled-item-top">
                <span className="enrolled-category">{course.category}</span>
                <span className="enrolled-status">В процессе</span>
              </div>
              <h3>{course.title}</h3>
              <p>{course.description}</p>
              <div className="enrolled-item-progress">
                <div className="progress-bar">
                  <i style={{ width: progress }} />
                </div>
                <span>{progress} пройдено</span>
              </div>
              <div className="enrolled-item-actions">
                <Link to={`/learn/${course.id}/lesson/intro`} className="button button-small">
                  Перейти к урокам
                </Link>
                <Link to={`/courses/${course.id}`} className="link-muted-small">
                  Программа курса
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {/* Certificates Section */}
      <div className="section-heading" style={{ marginTop: '60px' }}>
        <div>
          <p className="eyebrow">Достижения</p>
          <h2>Мои сертификаты</h2>
        </div>
      </div>

      <div className="certificates-grid">
        {mockCertificates.map((cert) => (
          <div className="certificate-badge-card" key={cert.id}>
            <div className="cert-card-icon">🏆</div>
            <div className="cert-card-info">
              <h4>{cert.courseTitle}</h4>
              <p>Выдан: {cert.issueDate}</p>
              <small className="cert-number">ID: {cert.id}</small>
            </div>
            <Link to={cert.credentialUrl} className="button button-small button-muted">
              Посмотреть бланк
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
