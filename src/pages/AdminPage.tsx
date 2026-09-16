import { useState } from 'react'
import { mockCourses, mockUsers } from '../data/mockData'
import type { PlatformUser, UserRole } from '../types'

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'moderation'>('users')
  const [users, setUsers] = useState<PlatformUser[]>(mockUsers)
  const [reviewCourses, setReviewCourses] = useState(
    mockCourses.filter((c) => c.status === 'review')
  )
  const [notification, setNotification] = useState<string | null>(null)

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    )
    setNotification('✓ Роль пользователя успешно обновлена.')
    setTimeout(() => setNotification(null), 3500)
  }

  const handlePublishCourse = (courseId: string) => {
    setReviewCourses((prev) => prev.filter((c) => c.id !== courseId))
    setNotification('✓ Курс успешно проверен и опубликован в общем каталоге!')
    setTimeout(() => setNotification(null), 4000)
  }

  const handleRejectCourse = (courseId: string) => {
    setReviewCourses((prev) => prev.filter((c) => c.id !== courseId))
    setNotification('✓ Курс возвращён автору с замечаниями по программе.')
    setTimeout(() => setNotification(null), 4000)
  }

  return (
    <section className="page-wrap admin-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Панель администратора</p>
          <h1>Управление и модерация</h1>
        </div>
      </div>

      {notification && (
        <div className="notification-banner success">
          <span>{notification}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="admin-tabs" role="tablist">
        <button
          className={activeTab === 'users' ? 'active' : ''}
          type="button"
          onClick={() => setActiveTab('users')}
        >
          Пользователи платформы ({users.length})
        </button>
        <button
          className={activeTab === 'moderation' ? 'active' : ''}
          type="button"
          onClick={() => setActiveTab('moderation')}
        >
          Курсы на проверке <span>{reviewCourses.length}</span>
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="teacher-table">
          <div className="table-head">
            <span>Пользователь</span>
            <span>Email</span>
            <span>Роль</span>
            <span>Дата регистрации</span>
            <span>Смена роли</span>
          </div>

          {users.map((user) => (
            <div className="table-row" key={user.id}>
              <div>
                <b>{user.name}</b>
                <small>Записей на курсы: {user.coursesEnrolled}</small>
              </div>

              <span className="text-muted">{user.email}</span>

              <div>
                <span
                  className={`status ${
                    user.role === 'admin'
                      ? 'review'
                      : user.role === 'teacher'
                      ? 'published'
                      : 'student'
                  }`}
                >
                  {user.role === 'admin'
                    ? 'Администратор'
                    : user.role === 'teacher'
                    ? 'Преподаватель'
                    : 'Студент'}
                </span>
              </div>

              <span className="text-muted">{user.joinedAt}</span>

              <div className="table-actions-cell">
                <select
                  value={user.role}
                  onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                  className="role-inline-select"
                >
                  <option value="student">Студент</option>
                  <option value="teacher">Преподаватель</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Moderation Queue Tab */}
      {activeTab === 'moderation' && (
        <div className="moderation-queue-container">
          {reviewCourses.length > 0 ? (
            reviewCourses.map((course) => (
              <div className="moderation-card" key={course.id}>
                <div className="moderation-card-top">
                  <div>
                    <span className="status review">Ожидает публикации</span>
                    <h2>{course.title}</h2>
                    <p className="moderation-meta">
                      Автор: <strong>{course.author}</strong> · Категория: {course.category} · {course.lessonsCount} уроков
                    </p>
                  </div>
                  <div className="moderation-actions">
                    <button
                      type="button"
                      className="button button-muted"
                      onClick={() => handleRejectCourse(course.id)}
                    >
                      ↩ Вернуть автору
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => handlePublishCourse(course.id)}
                    >
                      ✓ Одобрить и опубликовать
                    </button>
                  </div>
                </div>

                <div className="moderation-syllabus-preview">
                  <h4>Заявленная программа курса:</h4>
                  <ul>
                    {course.modules.map((m) => (
                      <li key={m.id}>
                        <strong>{m.title}</strong> — {m.lessons.length} уроков
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-catalog-state">
              <span className="empty-icon">✓</span>
              <h3>Очередь модерации пуста</h3>
              <p>Все отправленные преподавателями курсы проверены и опубликованы.</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
