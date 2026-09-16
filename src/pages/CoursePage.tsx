import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { mockCourses } from '../data/mockData'

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>()
  const course = mockCourses.find((item) => item.id === courseId) ?? mockCourses[0]

  // Track expanded modules
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({
    'mod-1': true,
    'mod-2': true,
    'mod-3': true,
    'fe-mod-1': true,
    'data-mod-1': true,
    'ds-mod-1': true,
  })

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Get first lesson ID
  const firstLessonId = course.modules[0]?.lessons[0]?.id ?? 'intro'

  return (
    <section className="page-wrap course-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link to="/courses">Каталог курсов</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{course.category}</span>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{course.title}</span>
      </nav>

      {/* Course Intro / Hero */}
      <div className="course-intro">
        <div className="course-intro-main">
          <div className="course-badge-row">
            <span className="eyebrow">{course.category}</span>
            {course.rating && <span className="rating-badge">★ {course.rating} рейтинг</span>}
          </div>
          <h1>{course.title}</h1>
          <p className="course-hero-desc">{course.longDescription || course.description}</p>

          <div className="author-card">
            <div className="author-avatar">{course.author[0]}</div>
            <div>
              <span className="author-label">Преподаватель</span>
              <strong>{course.author}</strong>
              {course.authorRole && <small>{course.authorRole}</small>}
            </div>
          </div>
        </div>

        <aside className="course-aside">
          <div className="aside-header">
            <p>Параметры курса</p>
            <strong>{course.lessonsCount} уроков</strong>
            <span>{course.duration} обучения в свободном графике</span>
          </div>

          <div className="aside-features">
            <div className="aside-feature-item">
              <span>✦</span> Доступ сразу после записи
            </div>
            <div className="aside-feature-item">
              <span>✓</span> Проверка домашних заданий
            </div>
            <div className="aside-feature-item">
              <span>🏆</span> Именной цифровой сертификат
            </div>
          </div>

          <Link className="button button-block" to={`/learn/${course.id}/lesson/${firstLessonId}`}>
            Начать обучение
          </Link>
        </aside>
      </div>

      {/* Program and Syllabus */}
      <div className="course-details">
        <div className="course-about-col">
          <h2>О курсе</h2>
          <p>
            Все уроки разбиты на последовательные смысловые модули. Каждый модуль включает в себя короткие видеолекции,
            структурированные конспекты с примерами, тесты на закрепление и практические домашние задания с проверкой
            преподавателем.
          </p>
          <div className="course-guarantee-box">
            <h4>Сертификат SkillMind</h4>
            <p>
              Выдаётся автоматически после успешного прохождения всех уроков программы и сдачи обязательных тестов.
            </p>
            <Link to="/certificates/cert-ux-2026-982" className="text-action">
              Посмотреть образец сертификата <span>→</span>
            </Link>
          </div>
        </div>

        <div className="course-syllabus-col">
          <div className="syllabus-header">
            <h2>Программа курса</h2>
            <span className="modules-count">{course.modules.length} модуля</span>
          </div>

          <div className="accordion-modules">
            {course.modules.map((mod, modIdx) => {
              const isExpanded = !!expandedModules[mod.id]
              return (
                <div className="module-accordion-item" key={mod.id}>
                  <button
                    type="button"
                    className={`module-accordion-header ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => toggleModule(mod.id)}
                    aria-expanded={isExpanded}
                  >
                    <span className="mod-number">0{modIdx + 1}</span>
                    <div className="mod-header-info">
                      <b>{mod.title}</b>
                      <small>{mod.lessons.length} уроков</small>
                    </div>
                    <span className="accordion-caret">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <ul className="module-lessons-list">
                      {mod.lessons.map((lesson, lessonIdx) => {
                        const icon =
                          lesson.type === 'video'
                            ? '▶'
                            : lesson.type === 'quiz'
                            ? '❓'
                            : lesson.type === 'homework'
                            ? '📝'
                            : '📄'
                        const typeName =
                          lesson.type === 'video'
                            ? 'Видео'
                            : lesson.type === 'quiz'
                            ? 'Тест'
                            : lesson.type === 'homework'
                            ? 'Задание'
                            : 'Конспект'

                        return (
                          <li key={lesson.id} className="module-lesson-row">
                            <span className="lesson-icon">{icon}</span>
                            <div className="lesson-row-info">
                              <span className="lesson-name">
                                {lessonIdx + 1}. {lesson.title}
                              </span>
                              <span className="lesson-badge">
                                {typeName} · {lesson.duration}
                              </span>
                            </div>
                            <Link
                              to={`/learn/${course.id}/lesson/${lesson.id}`}
                              className="lesson-start-link"
                              title="Перейти к уроку"
                            >
                              Смотреть
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
