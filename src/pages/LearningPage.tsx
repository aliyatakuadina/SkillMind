import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { mockCourses } from '../data/mockData'
import type { Lesson } from '../types'

export function LearningPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>()
  const navigate = useNavigate()

  const course = mockCourses.find((item) => item.id === courseId) ?? mockCourses[0]

  // Flatten lessons for navigation
  const allLessons: { lesson: Lesson; moduleTitle: string }[] = []
  course.modules.forEach((mod) => {
    mod.lessons.forEach((l) => {
      allLessons.push({ lesson: l, moduleTitle: mod.title })
    })
  })

  // Find active lesson index
  const currentIndex = allLessons.findIndex((item) => item.lesson.id === lessonId)
  const safeIndex = currentIndex >= 0 ? currentIndex : 0
  const activeItem = allLessons[safeIndex]
  const activeLesson = activeItem?.lesson ?? course.modules[0].lessons[0]
  const currentModuleTitle = activeItem?.moduleTitle ?? course.modules[0].title

  // Local state for completed lessons tracking
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(
    new Set(allLessons.filter((i) => i.lesson.isCompleted).map((i) => i.lesson.id))
  )

  // Mobile drawer state for curriculum
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Interactive state for quiz & homework
  const [quizSelectedOption, setQuizSelectedOption] = useState<number | null>(null)
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [homeworkSubmitted, setHomeworkSubmitted] = useState(false)

  const isCurrentCompleted = completedLessonIds.has(activeLesson.id)

  const toggleCompleted = () => {
    setCompletedLessonIds((prev) => {
      const next = new Set(prev)
      if (next.has(activeLesson.id)) {
        next.delete(activeLesson.id)
      } else {
        next.add(activeLesson.id)
      }
      return next
    })
  }

  // Navigation handlers
  const prevLesson = safeIndex > 0 ? allLessons[safeIndex - 1].lesson : null
  const nextLesson = safeIndex < allLessons.length - 1 ? allLessons[safeIndex + 1].lesson : null

  const handleNext = () => {
    // Mark current as completed
    setCompletedLessonIds((prev) => new Set(prev).add(activeLesson.id))

    if (nextLesson) {
      navigate(`/learn/${course.id}/lesson/${nextLesson.id}`)
      setQuizSelectedOption(null)
      setQuizSubmitted(false)
      setHomeworkSubmitted(false)
    } else {
      // Finished all lessons, offer certificate or dashboard
      navigate(`/certificates/cert-ux-2026-982`)
    }
  }

  const handlePrev = () => {
    if (prevLesson) {
      navigate(`/learn/${course.id}/lesson/${prevLesson.id}`)
      setQuizSelectedOption(null)
      setQuizSubmitted(false)
      setHomeworkSubmitted(false)
    }
  }

  const progressPercent = Math.round((completedLessonIds.size / (allLessons.length || 1)) * 100)

  return (
    <section className="learning-layout">
      {/* Mobile Top Bar for toggling lesson sidebar */}
      <div className="learning-mobile-bar">
        <button
          type="button"
          className="mobile-curriculum-toggle"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          aria-expanded={mobileSidebarOpen}
        >
          <span>☰</span>
          <b>Оглавление курса</b>
          <small>
            {safeIndex + 1}/{allLessons.length}
          </small>
        </button>
        <span className="learning-mobile-progress">{progressPercent}% пройдено</span>
      </div>

      {/* Curriculum Sidebar */}
      <aside className={`lesson-sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top-actions">
          <Link to={`/courses/${course.id}`} className="back-to-course-link">
            ← К описанию курса
          </Link>
          {mobileSidebarOpen && (
            <button
              type="button"
              className="close-sidebar-btn"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Закрыть оглавление"
            >
              ✕
            </button>
          )}
        </div>

        <h2 className="sidebar-course-title">{course.title}</h2>

        <div className="sidebar-progress">
          <div>
            <span>Общий прогресс</span>
            <b>{progressPercent}%</b>
          </div>
          <div className="progress-bar">
            <i style={{ width: `${progressPercent}%` }} />
          </div>
          <small className="progress-lessons-label">
            {completedLessonIds.size} из {allLessons.length} уроков завершено
          </small>
        </div>

        <div className="sidebar-modules-list">
          {course.modules.map((mod) => (
            <div key={mod.id} className="sidebar-module-group">
              <p className="sidebar-module-name">{mod.title}</p>
              {mod.lessons.map((lesson) => {
                const isActive = lesson.id === activeLesson.id
                const isDone = completedLessonIds.has(lesson.id)
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    className={`lesson-link ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''}`}
                    onClick={() => {
                      navigate(`/learn/${course.id}/lesson/${lesson.id}`)
                      setMobileSidebarOpen(false)
                      setQuizSelectedOption(null)
                      setQuizSubmitted(false)
                      setHomeworkSubmitted(false)
                    }}
                  >
                    <span className="lesson-status-icon">{isDone ? '✓' : ''}</span>
                    <span className="lesson-link-title">{lesson.title}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Main Lesson Content Area */}
      <article className="lesson-content">
        <div className="lesson-meta-bar">
          <p className="eyebrow">
            {currentModuleTitle} · Урок {safeIndex + 1} из {allLessons.length}
          </p>
          <button
            type="button"
            className={`complete-toggle-btn ${isCurrentCompleted ? 'is-done' : ''}`}
            onClick={toggleCompleted}
            title={isCurrentCompleted ? 'Отметить как не пройденный' : 'Отметить урок как пройденный'}
          >
            {isCurrentCompleted ? '✓ Пройден' : 'Отметить как пройденный'}
          </button>
        </div>

        <h1 className="lesson-main-title">{activeLesson.title}</h1>
        <p className="lesson-lead">{activeLesson.description || 'Изучите материал урока и выполните проверочное действие.'}</p>

        {/* Content Render Based on Lesson Type */}
        {activeLesson.type === 'video' && (
          <div className="video-player-container">
            <div className="video-placeholder">
              <button type="button" aria-label="Воспроизвести учебное видео" className="video-play-btn">
                ▶
              </button>
              <span>Видеоматериал к уроку: {activeLesson.title}</span>
              <small className="video-duration">Длительность: {activeLesson.duration}</small>
            </div>
            <div className="video-timeline-mock">
              <div className="video-progress" style={{ width: '35%' }} />
            </div>
          </div>
        )}

        {activeLesson.type === 'quiz' && (
          <div className="quiz-container">
            <div className="quiz-header">
              <span className="quiz-tag">Проверочный тест</span>
              <h3>Вопрос 1: В чем главное отличие глубинного интервью от фокус-группы?</h3>
            </div>
            <div className="quiz-options">
              {[
                'Индивидуальный разговор позволяет избежать эффекта конформизма и влияния группы',
                'Фокус-группы проводятся только онлайн, а интервью — только очно',
                'Интервью требует использования готовых анкет с вариантами «да/нет»',
              ].map((opt, idx) => (
                <label
                  key={idx}
                  className={`quiz-option-item ${quizSelectedOption === idx ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="quiz"
                    checked={quizSelectedOption === idx}
                    onChange={() => {
                      setQuizSelectedOption(idx)
                      setQuizSubmitted(false)
                    }}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <div className="quiz-actions">
              <button
                type="button"
                className="button button-small"
                disabled={quizSelectedOption === null}
                onClick={() => setQuizSubmitted(true)}
              >
                Проверить ответ
              </button>
              {quizSubmitted && (
                <span className="quiz-result-msg success">
                  ✓ Верно! Индивидуальный формат раскрывает личный контекст без давления мнения окружающих.
                </span>
              )}
            </div>
          </div>
        )}

        {activeLesson.type === 'homework' && (
          <div className="homework-container">
            <div className="homework-header">
              <span className="homework-tag">Практическое задание</span>
              <h3>Сдача работы на проверку преподавателю</h3>
              <p>Прикрепите ссылку на выполненный проект в Figma или загрузите PDF-файл с решением.</p>
            </div>

            {homeworkSubmitted ? (
              <div className="homework-success-banner">
                <span className="success-icon">✓</span>
                <div>
                  <h4>Работа отправлена на проверку!</h4>
                  <p>Преподаватель проверит решение и оставит комментарий в течение 24 часов.</p>
                </div>
              </div>
            ) : (
              <form
                className="homework-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  setHomeworkSubmitted(true)
                }}
              >
                <label>
                  Ссылка на решение или комментарий
                  <textarea
                    rows={3}
                    placeholder="Вставьте ссылку на Figma, GitHub или напишите пояснительную записку..."
                    required
                  />
                </label>
                <div className="file-dropzone-mock">
                  <span>📎 Загрузить файлы решения (PDF, DOCX, ZIP до 25 МБ)</span>
                </div>
                <button type="submit" className="button">
                  Отправить работу на проверку
                </button>
              </form>
            )}
          </div>
        )}

        {/* Text Notes & Explanation */}
        <div className="lesson-copy">
          <h2>Ключевые мысли и конспект</h2>
          <p>
            {activeLesson.content ||
              'В SkillMind каждый курс построен так, чтобы вы могли двигаться последовательно. Короткие блоки теории сочетаются с практическими заданиями — это помогает закреплять знания сразу после изучения.'}
          </p>
          <div className="callout">
            <b>Совет преподавателя</b>
            <p>Выделяйте 20–30 минут в день на конспекты и практику — регулярность важнее идеального момента.</p>
          </div>
        </div>

        {/* Previous / Next Lesson Navigation */}
        <div className="lesson-navigation">
          <button
            className="button button-muted"
            type="button"
            onClick={handlePrev}
            disabled={!prevLesson}
          >
            ← Предыдущий урок
          </button>
          <button className="button" type="button" onClick={handleNext}>
            {nextLesson ? 'Завершить и продолжить →' : 'Завершить курс и получить сертификат 🏆'}
          </button>
        </div>
      </article>
    </section>
  )
}
