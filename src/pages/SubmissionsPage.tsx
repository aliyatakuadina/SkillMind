import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getSubmissionFileUrl,
  listSubmissionsForReview,
  reviewSubmission,
  type SubmissionReview,
} from '../lib/submissionRepository'
import { t } from '../i18n'

export function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<SubmissionReview[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [grade, setGrade] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const active = submissions.find((submission) => submission.id === selectedId) ?? null

  useEffect(() => {
    let mounted = true
    void listSubmissionsForReview()
      .then((data) => {
        if (!mounted) return
        setSubmissions(data)
        setSelectedId(data[0]?.id ?? null)
      })
      .catch((caught: Error) => { if (mounted) setMessage({ kind: 'error', text: caught.message }) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const selectSubmission = (submission: SubmissionReview) => {
    setSelectedId(submission.id)
    setFeedback(submission.feedback ?? '')
    setGrade(submission.grade == null ? '' : String(submission.grade))
    setMessage(null)
  }

  const handleReview = async (decision: 'returned' | 'graded') => {
    if (!active) return
    setSaving(true)
    setMessage(null)
    try {
      const numericGrade = grade === '' ? null : Number(grade)
      await reviewSubmission(active.id, decision, feedback, numericGrade)
      setSubmissions((current) => current.map((submission) => submission.id === active.id
        ? { ...submission, status: decision, feedback, grade: decision === 'graded' ? numericGrade : null }
        : submission))
      setMessage({ kind: 'success', text: decision === 'graded' ? t('submissions.accepted') : t('submissions.returned') })
    } catch (caught) {
      setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : t('submissions.decisionError') })
    } finally {
      setSaving(false)
    }
  }

  const openFile = async (path: string) => {
    try {
      const url = await getSubmissionFileUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : t('submissions.fileError') })
    }
  }

  return (
    <section className="page-wrap submissions-page">
      <nav className="breadcrumbs"><Link to="/teacher/courses">{t('teacher.eyebrow')}</Link><span className="breadcrumb-separator">/</span><span>{t('nav.submissions')}</span></nav>
      <div className="section-heading"><div><p className="eyebrow">{t('teacher.eyebrow')}</p><h1>{t('submissions.title')}</h1></div><span className="count-badge">{t('submissions.awaitingCount', { count: submissions.filter((submission) => submission.status === 'submitted').length })}</span></div>
      {message && <div className={`notification-banner ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
      {loading ? <p>{t('submissions.loading')}</p> : submissions.length === 0 ? <div className="empty-catalog-state"><h3>{t('submissions.emptyTitle')}</h3><p>{t('submissions.emptyDescription')}</p></div> : <div className="submissions-layout">
        <div className="submissions-sidebar-list"><h3>{t('submissions.list')}</h3>{submissions.map((submission) => <button type="button" key={submission.id} className={`submission-card-item ${submission.id === selectedId ? 'selected' : ''}`} onClick={() => selectSubmission(submission)}><div className="submission-avatar">{submission.studentName.slice(0, 1)}</div><div className="submission-info"><h4>{submission.studentName}</h4><p>{submission.taskTitle}</p><small>{submission.courseTitle}</small></div><div className="submission-status-col"><span className={`status ${submission.status}`}>{submission.status === 'submitted' ? t('submissions.awaiting') : submission.status === 'graded' ? t('submissions.gradedStatus') : t('submissions.rework')}</span><small>{submission.submittedAt ? new Intl.DateTimeFormat('ru-RU').format(new Date(submission.submittedAt)) : ''}</small></div></button>)}</div>
        {active ? <div className="submission-detail-panel"><div className="submission-detail-header"><div><span className="eyebrow">{active.courseTitle}</span><h2>{active.taskTitle}</h2><p className="detail-meta">{t('submissions.student', { name: active.studentName })}</p></div></div><div className="submission-detail-body"><h4>{t('submissions.answer')}</h4><blockquote className="student-comment-quote">{active.textAnswer || t('submissions.noText')}</blockquote><h4>{t('submissions.materials')}</h4><div className="submission-files-list">{active.files.length ? active.files.map((file) => <div key={file.id} className="submission-file-chip"><span>📄 {file.name}</span><button type="button" className="download-file-btn" onClick={() => void openFile(file.path)}>{t('submissions.open')}</button></div>) : <p className="text-muted">{t('submissions.noFiles')}</p>}</div><div className="feedback-form-box"><h4>{t('submissions.feedback')}</h4><textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={t('submissions.feedbackPlaceholder')} /><label>{t('submissions.grade')}<input type="number" min="0" max="100" value={grade} onChange={(event) => setGrade(event.target.value)} /></label><div className="feedback-form-actions"><button type="button" className="button button-muted" disabled={saving} onClick={() => void handleReview('returned')}>{t('submissions.requestRework')}</button><button type="button" className="button" disabled={saving} onClick={() => void handleReview('graded')}>{t('submissions.accept')}</button></div></div></div></div> : null}
      </div>}
    </section>
  )
}
