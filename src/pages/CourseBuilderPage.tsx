import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { mockCourses } from '../data/mockData'
import type { LessonType } from '../types'

interface BuilderLesson {
  id: string
  title: string
  type: LessonType
  duration: string
}

interface BuilderModule {
  id: string
  title: string
  lessons: BuilderLesson[]
}

export function CourseBuilderPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const existingCourse = courseId ? mockCourses.find((c) => c.id === courseId) : null

  const [title, setTitle] = useState(existingCourse?.title ?? '')
  const [description, setDescription] = useState(existingCourse?.description ?? '')
  const [category, setCategory] = useState(existingCourse?.category ?? 'Дизайн')
  const [duration, setDuration] = useState(existingCourse?.duration ?? '4 недели')

  const [modules, setModules] = useState<BuilderModule[]>(
    existingCourse?.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        type: l.type,
        duration: l.duration,
      })),
    })) ?? [
      {
        id: 'mod-init',
        title: 'Модуль 1. Введение и базовые концепции',
        lessons: [
          { id: 'l-1', title: 'Знакомство с темой', type: 'video', duration: '15 мин' },
          { id: 'l-2', title: 'Практические основы', type: 'text', duration: '20 мин' },
        ],
      },
    ]
  )

  const [notification, setNotification] = useState<string | null>(null)

  const handleAddModule = () => {
    const newModId = `mod-${Date.now()}`
    setModules((prev) => [
      ...prev,
      {
        id: newModId,
        title: `Модуль ${prev.length + 1}. Новая тема`,
        lessons: [],
      },
    ])
  }

  const handleRemoveModule = (modId: string) => {
    setModules((prev) => prev.filter((m) => m.id !== modId))
  }

  const handleUpdateModuleName = (modId: string, newTitle: string) => {
    setModules((prev) =>
      prev.map((m) => (m.id === modId ? { ...m, title: newTitle } : m))
    )
  }

  const handleAddLesson = (modId: string) => {
    const newLessonId = `lesson-${Date.now()}`
    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== modId) return m
        return {
          ...m,
          lessons: [
            ...m.lessons,
            {
              id: newLessonId,
              title: `Урок ${m.lessons.length + 1}. Название урока`,
              type: 'video',
              duration: '15 мин',
            },
          ],
        }
      })
    )
  }

  const handleUpdateLesson = (
    modId: string,
    lessonId: string,
    updates: Partial<BuilderLesson>
  ) => {
    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== modId) return m
        return {
          ...m,
          lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, ...updates } : l)),
        }
      })
    )
  }

  const handleRemoveLesson = (modId: string, lessonId: string) => {
    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== modId) return m
        return {
          ...m,
          lessons: m.lessons.filter((l) => l.id !== lessonId),
        }
      })
    )
  }

  const handleSave = (status: 'draft' | 'review') => {
    const msg =
      status === 'draft'
        ? '✓ Черновик курса успешно сохранён локально.'
        : '✓ Курс отправлен администраторам на модерацию!'
    setNotification(msg)
    setTimeout(() => setNotification(null), 4000)
  }

  return (
    <section className="page-wrap builder-page">
      <nav className="breadcrumbs">
        <Link to="/teacher/courses">Кабинет преподавателя</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{existingCourse ? 'Редактирование курса' : 'Конструктор нового курса'}</span>
      </nav>

      <div className="section-heading">
        <div>
          <p className="eyebrow">{existingCourse ? 'Редактирование' : 'Создание программы'}</p>
          <h1>{title || 'Новый курс'}</h1>
        </div>
        <div className="builder-header-actions">
          <button
            className="button button-muted"
            type="button"
            onClick={() => handleSave('draft')}
          >
            Сохранить черновик
          </button>
          <button
            className="button"
            type="button"
            onClick={() => handleSave('review')}
          >
            Отправить на модерацию
          </button>
        </div>
      </div>

      {notification && (
        <div className="notification-banner success">
          <span>{notification}</span>
        </div>
      )}

      <div className="builder-grid">
        {/* Left Column: Course Parameters */}
        <form className="builder-form" onSubmit={(e) => e.preventDefault()}>
          <h3>Основные параметры</h3>

          <label>
            Название курса
            <input
              type="text"
              placeholder="Например, Основы UX-дизайна"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>

          <label>
            Категория
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'Дизайн' | 'Разработка' | 'Навыки')}
            >
              <option value="Дизайн">Дизайн</option>
              <option value="Разработка">Разработка</option>
              <option value="Навыки">Навыки</option>
            </select>
          </label>

          <label>
            Планируемая длительность
            <input
              type="text"
              placeholder="Например, 6 недель"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>

          <label>
            Краткое описание курса
            <textarea
              placeholder="Расскажите, чему научатся студенты и какую пользу принесет этот курс..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="builder-tip-box">
            <b>💡 Совет по структуре</b>
            <p>Рекомендуем разбивать курс на 3–5 модулей, а каждый урок делать не длиннее 20 минут.</p>
          </div>
        </form>

        {/* Right Column: Program / Syllabus Builder */}
        <aside className="builder-outline">
          <div className="section-heading">
            <div>
              <h2>Программа курса</h2>
              <p className="builder-subtitle">Модули и типы учебных материалов</p>
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={handleAddModule}
            >
              + Добавить модуль
            </button>
          </div>

          <div className="builder-modules-stack">
            {modules.map((mod, modIndex) => (
              <div key={mod.id} className="builder-module-card">
                <div className="builder-module-top">
                  <span className="builder-mod-badge">0{modIndex + 1}</span>
                  <input
                    type="text"
                    className="builder-module-title-input"
                    value={mod.title}
                    onChange={(e) => handleUpdateModuleName(mod.id, e.target.value)}
                    placeholder="Название модуля..."
                  />
                  <button
                    type="button"
                    className="builder-delete-btn"
                    onClick={() => handleRemoveModule(mod.id)}
                    title="Удалить модуль"
                  >
                    🗑
                  </button>
                </div>

                <div className="builder-lessons-list">
                  {mod.lessons.map((lesson) => (
                    <div key={lesson.id} className="builder-lesson-item">
                      <div className="builder-lesson-fields">
                        <input
                          type="text"
                          className="builder-lesson-name-input"
                          value={lesson.title}
                          onChange={(e) =>
                            handleUpdateLesson(mod.id, lesson.id, { title: e.target.value })
                          }
                          placeholder="Тема урока..."
                        />
                        <select
                          className="builder-type-select"
                          value={lesson.type}
                          onChange={(e) =>
                            handleUpdateLesson(mod.id, lesson.id, {
                              type: e.target.value as LessonType,
                            })
                          }
                        >
                          <option value="video">▶ Видео</option>
                          <option value="text">📄 Текст</option>
                          <option value="quiz">❓ Тест</option>
                          <option value="homework">📝 Задание</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        className="builder-lesson-remove-btn"
                        onClick={() => handleRemoveLesson(mod.id, lesson.id)}
                        title="Удалить урок"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="builder-add-lesson-btn"
                    onClick={() => handleAddLesson(mod.id)}
                  >
                    + Добавить урок в этот модуль
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
