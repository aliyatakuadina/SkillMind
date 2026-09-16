import { useState } from 'react'
import { Link } from 'react-router-dom'
import { mockSubmissions } from '../data/mockData'
import type { HomeworkSubmission } from '../types'

export function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>(mockSubmissions)
  const [selectedSubId, setSelectedSubId] = useState<string | null>(submissions[0]?.id ?? null)
  const [feedbackText, setFeedbackText] = useState('')
  const [notification, setNotification] = useState<string | null>(null)

  const activeSubmission = submissions.find((s) => s.id === selectedSubId)

  const handleReview = (status: 'approved' | 'changes_requested') => {
    if (!selectedSubId) return

    setSubmissions((prev) =>
      prev.map((s) => (s.id === selectedSubId ? { ...s, status } : s))
    )

    const statusText = status === 'approved' ? 'принята с оценкой отлично' : 'отправлена студенту на доработку'
    setNotification(`✓ Работа ${activeSubmission?.studentName} ${statusText}!`)
    setFeedbackText('')
    setTimeout(() => setNotification(null), 4000)
  }

  return (
    <section className="page-wrap submissions-page">
      <nav className="breadcrumbs">
        <Link to="/teacher/courses">Кабинет преподавателя</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Проверка заданий</span>
      </nav>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Кабинет преподавателя</p>
          <h1>Работы на проверке</h1>
        </div>
        <span className="count-badge">
          {submissions.filter((s) => s.status === 'pending').length} ожидают проверки
        </span>
      </div>

      {notification && (
        <div className="notification-banner success">
          <span>{notification}</span>
        </div>
      )}

      <div className="submissions-layout">
        {/* Submissions List */}
        <div className="submissions-sidebar-list">
          <h3>Список заданий</h3>
          {submissions.map((sub) => {
            const isSelected = sub.id === selectedSubId
            return (
              <article
                key={sub.id}
                className={`submission-card-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedSubId(sub.id)}
              >
                <div className="submission-avatar">{sub.initials}</div>
                <div className="submission-info">
                  <h4>{sub.studentName}</h4>
                  <p>{sub.taskTitle}</p>
                  <small>{sub.courseTitle}</small>
                </div>
                <div className="submission-status-col">
                  <span className={`status ${sub.status}`}>
                    {sub.status === 'pending'
                      ? 'Ожидает'
                      : sub.status === 'approved'
                      ? 'Принято'
                      : 'Доработка'}
                  </span>
                  <small>{sub.submittedAt}</small>
                </div>
              </article>
            )
          })}
        </div>

        {/* Selected Submission Detail & Feedback Form */}
        {activeSubmission ? (
          <div className="submission-detail-panel">
            <div className="submission-detail-header">
              <div>
                <span className="eyebrow">{activeSubmission.courseTitle}</span>
                <h2>{activeSubmission.taskTitle}</h2>
                <p className="detail-meta">
                  Студент: <strong>{activeSubmission.studentName}</strong> · Сдано: {activeSubmission.submittedAt}
                </p>
              </div>
              <span className={`status ${activeSubmission.status}`}>
                {activeSubmission.status === 'pending'
                  ? 'Ожидает проверки'
                  : activeSubmission.status === 'approved'
                  ? 'Принято'
                  : 'Требует правок'}
              </span>
            </div>

            <div className="submission-detail-body">
              <h4>Комментарий студента:</h4>
              <blockquote className="student-comment-quote">
                «{activeSubmission.comment}»
              </blockquote>

              <h4>Прикрепленные материалы:</h4>
              <div className="submission-files-list">
                {activeSubmission.files.map((file, i) => (
                  <div key={i} className="submission-file-chip">
                    <span>📄 {file}</span>
                    <button
                      type="button"
                      className="download-file-btn"
                      onClick={() => alert(`Файл ${file} открыт для предпросмотра.`)}
                    >
                      Открыть
                    </button>
                  </div>
                ))}
              </div>

              {/* Feedback Form */}
              <div className="feedback-form-box">
                <h4>Обратная связь преподавателя</h4>
                <textarea
                  rows={4}
                  placeholder="Напишите рецензию: что получилось отлично, а что стоит доработать..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                />
                <div className="feedback-form-actions">
                  <button
                    type="button"
                    className="button button-muted"
                    onClick={() => handleReview('changes_requested')}
                  >
                    ↩ Запросить доработку
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => handleReview('approved')}
                  >
                    ✓ Принять работу
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-submission-placeholder">
            <p>Выберите работу из списка слева для проверки.</p>
          </div>
        )}
      </div>
    </section>
  )
}
