import { useState } from 'react'
import {
  applyQuizProposal,
  applyStructureProposal,
  applySummaryProposal,
  type QuizProposal,
  type StructureProposal,
  type SummaryProposal,
} from '../lib/authorDraft'
import type { CourseDraft, CourseDraftLesson } from '../lib/courseRepository'
import { enqueueAiJob, isSkillmindApiConfigured, waitForAiJob } from '../lib/skillmindApi'
import { t } from '../i18n'

export function AuthorAiPanel({
  enabled,
  draft,
  onDraft,
}: {
  enabled: boolean
  draft: CourseDraft
  onDraft: (draft: CourseDraft) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [audience, setAudience] = useState('')
  const [goals, setGoals] = useState('')
  const [structure, setStructure] = useState<StructureProposal | null>(null)
  const [summary, setSummary] = useState<SummaryProposal | null>(null)
  const [quiz, setQuiz] = useState<QuizProposal | null>(null)
  const [selectedModules, setSelectedModules] = useState<number[]>([])
  const [selectedQuestions, setSelectedQuestions] = useState<number[]>([])
  const [targetLesson, setTargetLesson] = useState('')

  const lessons = draft.modules.flatMap((module) => module.lessons.map((lesson) => ({ moduleId: module.id, lesson })))
  const activeLessonId = targetLesson || lessons[0]?.lesson.id || ''

  if (!enabled) return null

  const current = lessons.find((item) => item.lesson.id === activeLessonId)

  const run = async (taskType: 'course_structure' | 'lesson_summary' | 'quiz') => {
    if (!draft.id) {
      setMessage(t('builder.aiSaveFirst'))
      return
    }
    if (!isSkillmindApiConfigured()) {
      setMessage(t('builder.aiApiMissing'))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const payload = taskType === 'course_structure'
        ? { topic: draft.title || t('builder.newCourse'), audience, goals, duration: draft.duration }
        : { title: current?.lesson.title ?? '', content: lessonMaterial(current?.lesson) }
      const started = await enqueueAiJob({
        taskType,
        idempotencyKey: crypto.randomUUID(),
        courseId: draft.id,
        lessonId: taskType === 'course_structure' ? undefined : current?.lesson.id,
        payload,
      })
      const finished = await waitForAiJob(started.id)
      if (finished.status === 'failed') {
        setMessage(finished.error_code || t('builder.aiAuthorError'))
        return
      }
      const output = finished.output as Record<string, unknown> | null | undefined
      if (output?.kind === 'course_structure') {
        const proposal = output as unknown as StructureProposal
        setStructure(proposal)
        setSelectedModules(proposal.modules.map((_, index) => index))
      } else if (output?.kind === 'lesson_summary') {
        setSummary(output as unknown as SummaryProposal)
      } else if (output?.kind === 'quiz') {
        const proposal = output as unknown as QuizProposal
        setQuiz(proposal)
        setSelectedQuestions(proposal.questions.map((_, index) => index))
      } else {
        setMessage(t('builder.aiAuthorError'))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('builder.aiAuthorError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="builder-ai-author">
      <p className="builder-ai-title">{t('builder.aiAuthorTitle')}</p>
      <p className="builder-subtitle">{t('builder.aiAuthorHint')}</p>
      <label>{t('builder.aiAudience')}<input value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
      <label>{t('builder.aiGoals')}<textarea rows={2} value={goals} onChange={(event) => setGoals(event.target.value)} /></label>
      <label>{t('builder.aiTargetLesson')}
        <select value={activeLessonId} onChange={(event) => setTargetLesson(event.target.value)}>
          {lessons.map((item) => <option key={item.lesson.id} value={item.lesson.id}>{item.lesson.title}</option>)}
        </select>
      </label>
      <div className="admin-ai-actions">
        <button type="button" className="button button-muted" disabled={busy} onClick={() => void run('course_structure')}>{t('builder.aiStructure')}</button>
        <button type="button" className="button button-muted" disabled={busy || !current} onClick={() => void run('lesson_summary')}>{t('builder.aiSummary')}</button>
        <button type="button" className="button button-muted" disabled={busy || !current} onClick={() => void run('quiz')}>{t('builder.aiQuiz')}</button>
      </div>
      {busy && <p role="status">{t('builder.aiAuthorWait')}</p>}
      {message && <p className="builder-subtitle">{message}</p>}

      {structure && (
        <div className="builder-ai-proposal">
          <p>{t('builder.aiStructureResult')}</p>
          {structure.modules.map((module, index) => (
            <label key={`${module.title}-${index}`} className="builder-required">
              <input type="checkbox" checked={selectedModules.includes(index)} onChange={() => setSelectedModules(toggle(selectedModules, index))} />
              {module.title} ({module.lessons.length})
            </label>
          ))}
          <button type="button" className="button button-small" onClick={() => { onDraft(applyStructureProposal(draft, structure, selectedModules)); setMessage(t('builder.aiApplied')) }}>{t('builder.aiApplySelected')}</button>
        </div>
      )}

      {summary && current && (
        <div className="builder-ai-proposal">
          <p>{t('builder.aiSummaryResult')}</p>
          <p className="admin-ai-probe-text">{summary.summary}</p>
          <button type="button" className="button button-small" onClick={() => {
            onDraft({
              ...draft,
              modules: draft.modules.map((module) => module.id === current.moduleId
                ? { ...module, lessons: module.lessons.map((lesson) => lesson.id === current.lesson.id ? applySummaryProposal(lesson, summary) : lesson) }
                : module),
            })
            setMessage(t('builder.aiApplied'))
          }}>{t('builder.aiApplySelected')}</button>
        </div>
      )}

      {quiz && current && (
        <div className="builder-ai-proposal">
          <p>{t('builder.aiQuizResult')}</p>
          {quiz.questions.map((question, index) => (
            <label key={`${question.prompt}-${index}`} className="builder-required">
              <input type="checkbox" checked={selectedQuestions.includes(index)} onChange={() => setSelectedQuestions(toggle(selectedQuestions, index))} />
              {question.prompt}
            </label>
          ))}
          <button type="button" className="button button-small" onClick={() => {
            onDraft({
              ...draft,
              modules: draft.modules.map((module) => module.id === current.moduleId
                ? { ...module, lessons: module.lessons.map((lesson) => lesson.id === current.lesson.id ? applyQuizProposal(lesson, quiz, selectedQuestions) : lesson) }
                : module),
            })
            setMessage(t('builder.aiApplied'))
          }}>{t('builder.aiApplySelected')}</button>
        </div>
      )}
    </div>
  )
}

function lessonMaterial(lesson?: CourseDraftLesson) {
  if (!lesson) return ''
  return [lesson.title, lesson.description, lesson.content].filter(Boolean).join('\n')
}

function toggle(values: number[], index: number) {
  return values.includes(index) ? values.filter((item) => item !== index) : [...values, index]
}
