import { useEffect, useState } from 'react'
import { getAssignmentForLesson, submitAssignment, type AssignmentData } from '../lib/learningRepository'
import { t } from '../i18n'

export function AssignmentPanel({
  lessonId,
  onSubmitted,
  onAccepted,
}: {
  lessonId: string
  onSubmitted: () => Promise<void>
  onAccepted?: (grade: number) => Promise<void>
}) {
  const [assignment, setAssignment] = useState<AssignmentData | null>(null)
  const [textAnswer, setTextAnswer] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getAssignmentForLesson(lessonId)
      .then(async (data) => {
        if (!active) return
        setAssignment(data)
        if (data.status === 'graded' && (data.grade ?? 0) >= 70) {
          await onAccepted?.(data.grade ?? 0)
        }
      })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // Intentionally once per lesson; onAccepted is idempotent on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!assignment) return
    if (!textAnswer.trim() && files.length === 0) {
      setError(t('assignment.needAnswer'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await submitAssignment(assignment, textAnswer, files)
      setAssignment({ ...assignment, status: 'submitted' })
      await onSubmitted()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('assignment.submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="homework-container"><p>{t('assignment.loading')}</p></div>
  if (!assignment) return <div className="homework-container"><p>{error || t('assignment.notConfigured')}</p></div>
  if (assignment.status === 'submitted') return <div className="homework-success-banner"><span className="success-icon">✓</span><div><h4>{t('assignment.submittedTitle')}</h4><p>{t('assignment.submittedDescription')}</p></div></div>
  if (assignment.status === 'graded') return <div className="homework-success-banner"><span className="success-icon">✓</span><div><h4>{t('assignment.graded', { grade: assignment.grade ?? 0 })}</h4><p>{assignment.feedback}</p></div></div>

  return <div className="homework-container"><div className="homework-header"><span className="homework-tag">{t('assignment.tag')}</span><p>{assignment.instructions}</p>{assignment.status === 'returned' ? <div className="form-message error">{t('assignment.returned', { feedback: assignment.feedback ?? '' })}</div> : null}</div>
    <form className="homework-form" onSubmit={handleSubmit}><label>{t('assignment.answer')}<textarea rows={4} value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} placeholder={t('assignment.answerPlaceholder')} /></label><label className="file-dropzone">{t('assignment.files', { count: assignment.maxFiles, size: Math.round(assignment.maxFileSizeBytes / 1048576) })}<input type="file" multiple accept={assignment.allowedMimeTypes.join(',')} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>{files.length ? <small>{t('assignment.filesSelected', { count: files.length })}</small> : null}{error && <div className="form-message error" role="alert">{error}</div>}<button type="submit" className="button" disabled={submitting}>{submitting ? t('assignment.sending') : assignment.status === 'returned' ? t('assignment.resubmit') : t('assignment.submit')}</button></form>
  </div>
}
