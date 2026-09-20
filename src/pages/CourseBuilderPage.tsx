import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getCourseDraft,
  saveCourseDraft,
  uploadCourseAsset,
  CourseSaveConflictError,
  type CourseDraft,
  type CourseDraftLesson,
  type CourseDraftModule,
  type QuizQuestionDraft,
  type QuizQuestionType,
} from '../lib/courseRepository'
import type { LessonType } from '../types'
import { t } from '../i18n'

const newLesson = (number: number): CourseDraftLesson => ({
  id: crypto.randomUUID(),
  title: t('builder.defaultLesson', { number }),
  description: '',
  type: 'video',
  duration: t('builder.defaultDuration'),
  content: '',
  resourceUrl: '',
  sourceUrl: '',
  isRequired: true,
  passingScore: 70,
  attemptLimit: 3,
  questions: [],
  maxFiles: 3,
  maxFileSizeBytes: 10485760,
})

const newDraft = (): CourseDraft => ({
  title: '', description: '', category: t('catalog.design'), duration: t('builder.defaultCourseDuration'),
  modules: [{ id: crypto.randomUUID(), title: t('builder.defaultModule'), lessons: [newLesson(1)] }],
})

const newQuestion = (): QuizQuestionDraft => ({
  id: crypto.randomUUID(),
  type: 'single_choice',
  prompt: '',
  options: ['', ''],
  correctOptions: [0],
  pairs: [{ left: '', right: '' }, { left: '', right: '' }],
  points: 1,
})

function isInvalidQuestion(question: QuizQuestionDraft) {
  if (!question.prompt.trim()) return true
  if (question.type === 'matching') {
    return question.pairs.length < 2 || question.pairs.some((pair) => !pair.left.trim() || !pair.right.trim())
  }
  if (question.options.length < 2 || question.options.some((option) => !option.trim())) return true
  if (question.type === 'single_choice') return question.correctOptions.length !== 1
  return question.correctOptions.length === 0
}

export function CourseBuilderPage() {
  const { courseId } = useParams<{ courseId: string }>()
  return <CourseBuilderEditor key={courseId ?? 'new'} courseId={courseId} />
}

function CourseBuilderEditor({ courseId }: { courseId?: string }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<CourseDraft>(newDraft)
  const [pendingFiles, setPendingFiles] = useState<Record<string, { material?: File; source?: File }>>({})
  const [loading, setLoading] = useState(Boolean(courseId))
  const [saving, setSaving] = useState(false)
  const [notification, setNotification] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [revisionConflict, setRevisionConflict] = useState(false)

  useEffect(() => {
    if (!courseId) return
    let active = true
    void getCourseDraft(courseId)
      .then((course) => { if (active) setDraft(course) })
      .catch((error: Error) => { if (active) setNotification({ kind: 'error', text: error.message }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  const updateDraft = (updates: Partial<CourseDraft>) => setDraft((current) => ({ ...current, ...updates }))

  const updateModule = (moduleId: string, update: (module: CourseDraftModule) => CourseDraftModule) => {
    updateDraft({ modules: draft.modules.map((module) => module.id === moduleId ? update(module) : module) })
  }

  const updateLesson = (moduleId: string, lessonId: string, updates: Partial<CourseDraftLesson>) => {
    updateModule(moduleId, (module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, ...updates } : lesson),
    }))
  }

  const moveModule = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.modules.length) return
    const modules = [...draft.modules]
    ;[modules[index], modules[target]] = [modules[target], modules[index]]
    updateDraft({ modules })
  }

  const moveLesson = (moduleId: string, index: number, direction: -1 | 1) => {
    updateModule(moduleId, (module) => {
      const target = index + direction
      if (target < 0 || target >= module.lessons.length) return module
      const lessons = [...module.lessons]
      ;[lessons[index], lessons[target]] = [lessons[target], lessons[index]]
      return { ...module, lessons }
    })
  }

  const validate = () => {
    if (draft.title.trim().length < 3) return t('builder.titleValidation')
    if (draft.modules.length === 0) return t('builder.moduleValidation')
    if (draft.modules.some((module) => !module.title.trim())) return t('builder.moduleTitleValidation')
    if (draft.modules.some((module) => module.lessons.some((lesson) => !lesson.title.trim()))) return t('builder.lessonTitleValidation')
    if (draft.modules.some((module) => module.lessons.some((lesson) => lesson.type === 'quiz' && lesson.questions.length === 0))) return t('builder.quizValidation')
    if (draft.modules.some((module) => module.lessons.some((lesson) => lesson.type === 'quiz' && lesson.questions.some(isInvalidQuestion)))) return t('builder.questionValidation')
    if (draft.modules.some((module) => module.lessons.some((lesson) => lesson.type === 'document' && !(lesson.resourceUrl || pendingFiles[lesson.id]?.material)))) return t('builder.previewValidation')
    if (draft.modules.some((module) => module.lessons.some((lesson) => lesson.type === 'document' && !(lesson.sourceUrl || pendingFiles[lesson.id]?.source)))) return t('builder.sourceValidation')
    return null
  }

  const handleSave = async (submit: boolean) => {
    if (revisionConflict) return
    const validationError = validate()
    if (validationError) {
      setNotification({ kind: 'error', text: validationError })
      return
    }
    setSaving(true)
    setNotification(null)
    try {
      let savedDraft = { ...draft, ...await saveCourseDraft(draft, false) }
      // Keep the successful revision even if a subsequent upload fails.
      setDraft(savedDraft)
      const hasUploads = Object.keys(pendingFiles).length > 0
      if (hasUploads) {
        const uploads = await Promise.all(Object.entries(pendingFiles).map(async ([lessonId, files]) => ({
          lessonId,
          material: files.material ? await uploadCourseAsset(savedDraft.id, files.material) : undefined,
          source: files.source ? await uploadCourseAsset(savedDraft.id, files.source) : undefined,
        })))
        const uploadedPaths = new Map(uploads.map((upload) => [upload.lessonId, upload]))
        savedDraft = {
          ...savedDraft,
          modules: savedDraft.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) => ({
              ...lesson,
              resourceUrl: uploadedPaths.get(lesson.id)?.material ?? lesson.resourceUrl,
              sourceUrl: uploadedPaths.get(lesson.id)?.source ?? lesson.sourceUrl,
            })),
          })),
        }
        setDraft(savedDraft)
        setPendingFiles({})
      }
      if (submit || hasUploads) {
        savedDraft = { ...savedDraft, ...await saveCourseDraft(savedDraft, submit) }
        setDraft(savedDraft)
      }
      setNotification({ kind: 'success', text: submit ? t('builder.submitted') : t('builder.saved') })
      if (!courseId) navigate(`/teacher/courses/${savedDraft.id}/edit`, { replace: true })
    } catch (error) {
      setRevisionConflict(error instanceof CourseSaveConflictError)
      setNotification({ kind: 'error', text: error instanceof Error ? error.message : t('builder.saveError') })
    } finally {
      setSaving(false)
    }
  }

  const downloadDraft = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `skillmind-draft-${draft.id ?? 'new'}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const reloadServerDraft = async () => {
    if (!draft.id) return
    setSaving(true)
    try {
      setDraft(await getCourseDraft(draft.id))
      setPendingFiles({})
      setRevisionConflict(false)
      setNotification(null)
    } catch (error) {
      setNotification({ kind: 'error', text: error instanceof Error ? error.message : t('builder.saveError') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="page-wrap"><p>{t('common.loadingCourse')}</p></section>

  return (
    <section className="page-wrap builder-page">
      <nav className="breadcrumbs"><Link to="/teacher/courses">{t('teacher.eyebrow')}</Link><span className="breadcrumb-separator">/</span><span>{courseId ? t('builder.editCourse') : t('builder.newCourse')}</span></nav>
      <div className="section-heading">
        <div><p className="eyebrow">{courseId ? t('builder.editing') : t('builder.creating')}</p><h1>{draft.title || t('builder.newCourse')}</h1></div>
        <div className="builder-header-actions">
          <button className="button button-muted" type="button" disabled={saving || revisionConflict} onClick={() => void handleSave(false)}>{t('builder.saveDraft')}</button>
          <button className="button" type="button" disabled={saving || revisionConflict} onClick={() => void handleSave(true)}>{saving ? t('builder.saving') : t('builder.submit')}</button>
        </div>
      </div>

      {notification && <div className={`notification-banner ${notification.kind}`} role={notification.kind === 'error' ? 'alert' : 'status'}><span>{notification.text}</span></div>}
      {revisionConflict && <div className="builder-conflict-actions">
        <button className="button button-muted" type="button" onClick={downloadDraft}>{t('builder.downloadDraft')}</button>
        <button className="button button-muted" type="button" disabled={saving} onClick={() => void reloadServerDraft()}>{t('builder.reloadServerDraft')}</button>
      </div>}

      <fieldset className="builder-grid" disabled={saving}>
        <form className="builder-form" onSubmit={(event) => event.preventDefault()}>
          <h3>{t('builder.parameters')}</h3>
          <label>{t('builder.courseTitle')}<input value={draft.title} maxLength={160} onChange={(event) => updateDraft({ title: event.target.value })} required /></label>
          <label>{t('builder.category')}<select value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })}><option>{t('catalog.design')}</option><option>{t('catalog.development')}</option><option>{t('catalog.skills')}</option></select></label>
          <label>{t('builder.duration')}<input value={draft.duration} onChange={(event) => updateDraft({ duration: event.target.value })} placeholder={t('builder.durationPlaceholder')} /></label>
          <label>{t('builder.description')}<textarea value={draft.description} maxLength={2000} rows={5} onChange={(event) => updateDraft({ description: event.target.value })} /></label>
          <div className="builder-tip-box"><b>{t('builder.tipTitle')}</b><p>{t('builder.tip')}</p></div>
        </form>

        <aside className="builder-outline">
          <div className="section-heading"><div><h2>{t('course.program')}</h2><p className="builder-subtitle">{t('builder.materials')}</p></div>
            <button type="button" className="button button-small" onClick={() => updateDraft({ modules: [...draft.modules, { id: crypto.randomUUID(), title: t('builder.newModule', { number: draft.modules.length + 1 }), lessons: [] }] })}>{t('builder.addModule')}</button>
          </div>
          <div className="builder-modules-stack">
            {draft.modules.map((module, moduleIndex) => (
              <div key={module.id} className="builder-module-card">
                <div className="builder-module-top">
                  <span className="builder-mod-badge">{String(moduleIndex + 1).padStart(2, '0')}</span>
                  <input className="builder-module-title-input" value={module.title} onChange={(event) => updateModule(module.id, (current) => ({ ...current, title: event.target.value }))} />
                  <button type="button" className="builder-order-btn" disabled={moduleIndex === 0} onClick={() => moveModule(moduleIndex, -1)} aria-label={t('builder.moveModuleUp')}>↑</button>
                  <button type="button" className="builder-order-btn" disabled={moduleIndex === draft.modules.length - 1} onClick={() => moveModule(moduleIndex, 1)} aria-label={t('builder.moveModuleDown')}>↓</button>
                  <button type="button" className="builder-delete-btn" onClick={() => updateDraft({ modules: draft.modules.filter((item) => item.id !== module.id) })} aria-label={t('builder.deleteModule')}>🗑</button>
                </div>
                <div className="builder-lessons-list">
                  {module.lessons.map((lesson, lessonIndex) => (
                    <div key={lesson.id} className="builder-lesson-item builder-lesson-expanded">
                      <div className="builder-lesson-fields">
                        <input className="builder-lesson-name-input" value={lesson.title} onChange={(event) => updateLesson(module.id, lesson.id, { title: event.target.value })} />
                        <select className="builder-type-select" value={lesson.type} onChange={(event) => updateLesson(module.id, lesson.id, { type: event.target.value as LessonType })}>
                          <option value="video">{t('builder.typeVideo')}</option><option value="text">{t('builder.typeText')}</option><option value="pdf">{t('builder.typePdf')}</option><option value="document">{t('builder.typeDocx')}</option><option value="quiz">{t('builder.typeQuiz')}</option><option value="homework">{t('builder.typeHomework')}</option>
                        </select>
                        <input value={lesson.duration} onChange={(event) => updateLesson(module.id, lesson.id, { duration: event.target.value })} placeholder={t('builder.defaultDuration')} aria-label={t('builder.lessonDuration')} />
                        <textarea value={lesson.description} onChange={(event) => updateLesson(module.id, lesson.id, { description: event.target.value })} placeholder={t('builder.lessonDescription')} rows={2} />
                        {lesson.type === 'text' && <textarea value={lesson.content} onChange={(event) => updateLesson(module.id, lesson.id, { content: event.target.value })} placeholder={t('builder.lessonText')} rows={4} />}
                        {lesson.type === 'video' && <input value={lesson.resourceUrl} onChange={(event) => updateLesson(module.id, lesson.id, { resourceUrl: event.target.value })} placeholder={t('builder.videoLink')} />}
                        {(lesson.type === 'video' || lesson.type === 'pdf') && <label className="builder-file-label">{t('builder.materialFile')}<input type="file" accept={lesson.type === 'video' ? 'video/mp4' : 'application/pdf'} onChange={(event) => { const file = event.target.files?.[0]; if (file) setPendingFiles((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], material: file } })) }} /></label>}
                        {lesson.type === 'document' && <div className="builder-inline-fields"><label className="builder-file-label">{t('builder.previewPdf')}<input type="file" accept="application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPendingFiles((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], material: file } })) }} /></label><label className="builder-file-label">{t('builder.sourceDocx')}<input type="file" accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPendingFiles((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], source: file } })) }} /></label></div>}
                        {lesson.type === 'quiz' && <div className="builder-quiz-editor">
                          <div className="builder-inline-fields"><label>{t('builder.passingScore')}<input type="number" min="0" max="100" value={lesson.passingScore} onChange={(event) => updateLesson(module.id, lesson.id, { passingScore: Number(event.target.value) })} /></label><label>{t('builder.attempts')}<input type="number" min="1" max="20" value={lesson.attemptLimit ?? ''} onChange={(event) => updateLesson(module.id, lesson.id, { attemptLimit: event.target.value ? Number(event.target.value) : null })} /></label></div>
                          {lesson.questions.map((question, questionIndex) => <div className="builder-question" key={question.id}>
                            <div className="builder-question-heading"><b>{t('builder.question', { number: questionIndex + 1 })}</b><button type="button" onClick={() => updateLesson(module.id, lesson.id, { questions: lesson.questions.filter((item) => item.id !== question.id) })}>{t('builder.deleteQuestion')}</button></div>
                            <input value={question.prompt} placeholder={t('builder.questionText')} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item) })} />
                            <label>{t('builder.questionType')}<select value={question.type} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, type: event.target.value as QuizQuestionType, correctOptions: [0] } : item) })}><option value="single_choice">{t('builder.singleChoice')}</option><option value="multiple_choice">{t('builder.multipleChoice')}</option><option value="matching">{t('builder.matching')}</option></select></label>
                            {question.type === 'matching' ? <>
                              {question.pairs.map((pair, pairIndex) => <div className="builder-inline-fields" key={`${question.id}-pair-${pairIndex}`}><input value={pair.left} placeholder={t('builder.matchLeft', { number: pairIndex + 1 })} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, pairs: item.pairs.map((value, index) => index === pairIndex ? { ...value, left: event.target.value } : value) } : item) })} /><input value={pair.right} placeholder={t('builder.matchRight', { number: pairIndex + 1 })} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, pairs: item.pairs.map((value, index) => index === pairIndex ? { ...value, right: event.target.value } : value) } : item) })} /></div>)}
                              <button type="button" className="table-action-btn" onClick={() => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, pairs: [...item.pairs, { left: '', right: '' }] } : item) })}>{t('builder.addPair')}</button>
                            </> : <>
                              {question.options.map((option, optionIndex) => <label className="builder-answer-option" key={`${question.id}-${optionIndex}`}><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={`correct-${question.id}`} checked={question.correctOptions.includes(optionIndex)} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, correctOptions: question.type === 'single_choice' ? [optionIndex] : event.target.checked ? [...item.correctOptions, optionIndex].sort((a, b) => a - b) : item.correctOptions.filter((index) => index !== optionIndex) } : item) })} /><input value={option} placeholder={t('builder.option', { number: optionIndex + 1 })} onChange={(event) => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, options: item.options.map((value, index) => index === optionIndex ? event.target.value : value) } : item) })} /></label>)}
                              <button type="button" className="table-action-btn" onClick={() => updateLesson(module.id, lesson.id, { questions: lesson.questions.map((item) => item.id === question.id ? { ...item, options: [...item.options, ''] } : item) })}>{t('builder.addOption')}</button>
                            </>}
                          </div>)}
                          <button type="button" className="button button-small button-muted" onClick={() => updateLesson(module.id, lesson.id, { questions: [...lesson.questions, newQuestion()] })}>{t('builder.addQuestion')}</button>
                        </div>}
                        {lesson.type === 'homework' && <div className="builder-inline-fields"><label>{t('builder.maxFiles')}<input type="number" min="0" max="10" value={lesson.maxFiles} onChange={(event) => updateLesson(module.id, lesson.id, { maxFiles: Number(event.target.value) })} /></label><label>{t('builder.fileLimit')}<input type="number" min="1" max="50" value={Math.round(lesson.maxFileSizeBytes / 1048576)} onChange={(event) => updateLesson(module.id, lesson.id, { maxFileSizeBytes: Number(event.target.value) * 1048576 })} /></label></div>}
                        <label className="builder-required"><input type="checkbox" checked={lesson.isRequired} onChange={(event) => updateLesson(module.id, lesson.id, { isRequired: event.target.checked })} /> {t('builder.required')}</label>
                      </div>
                      <div className="builder-lesson-actions">
                        <button type="button" disabled={lessonIndex === 0} onClick={() => moveLesson(module.id, lessonIndex, -1)} aria-label={t('builder.moveLessonUp')}>↑</button>
                        <button type="button" disabled={lessonIndex === module.lessons.length - 1} onClick={() => moveLesson(module.id, lessonIndex, 1)} aria-label={t('builder.moveLessonDown')}>↓</button>
                        <button type="button" onClick={() => updateModule(module.id, (current) => ({ ...current, lessons: current.lessons.filter((item) => item.id !== lesson.id) }))} aria-label={t('builder.deleteLesson')}>✕</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="builder-add-lesson-btn" onClick={() => updateModule(module.id, (current) => ({ ...current, lessons: [...current.lessons, newLesson(current.lessons.length + 1)] }))}>{t('builder.addLesson')}</button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </fieldset>
    </section>
  )
}
