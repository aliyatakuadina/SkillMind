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
} from '../lib/courseRepository'
import { AuthorAiPanel } from '../components/AuthorAiPanel'
import { CategoryField } from '../components/CategoryField'
import { LessonDraftCard } from '../components/LessonDraftCard'
import { getAiRuntimeFlags } from '../lib/skillmindApi'
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
  title: '', description: '', category: 'Разработка программного обеспечения', duration: t('builder.defaultCourseDuration'),
  modules: [{ id: crypto.randomUUID(), title: t('builder.defaultModule'), lessons: [newLesson(1)] }],
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
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [authorToolsEnabled, setAuthorToolsEnabled] = useState(false)

  useEffect(() => {
    if (!courseId) return
    let active = true
    void getCourseDraft(courseId)
      .then((course) => { if (active) setDraft(course) })
      .catch((error: Error) => { if (active) setNotification({ kind: 'error', text: error.message }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  useEffect(() => {
    let active = true
    void getAiRuntimeFlags()
      .then((flags) => {
        if (active) {
          setVideoEnabled(flags.videoEnabled)
          setAuthorToolsEnabled(flags.authorToolsEnabled)
        }
      })
      .catch(() => {
        if (active) {
          setVideoEnabled(false)
          setAuthorToolsEnabled(false)
        }
      })
    return () => { active = false }
  }, [])

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
          <CategoryField value={draft.category} onChange={(category) => updateDraft({ category })} />
          <label>{t('builder.duration')}<input value={draft.duration} onChange={(event) => updateDraft({ duration: event.target.value })} placeholder={t('builder.durationPlaceholder')} /></label>
          <label>{t('builder.description')}<textarea value={draft.description} maxLength={2000} rows={5} onChange={(event) => updateDraft({ description: event.target.value })} /></label>
          <div className="builder-tip-box"><b>{t('builder.tipTitle')}</b><p>{t('builder.tip')}</p></div>
          <AuthorAiPanel enabled={authorToolsEnabled} draft={draft} onDraft={setDraft} />
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
                    <LessonDraftCard
                      key={lesson.id}
                      lesson={lesson}
                      number={lessonIndex + 1}
                      canMoveUp={lessonIndex > 0}
                      canMoveDown={lessonIndex < module.lessons.length - 1}
                      materialName={pendingFiles[lesson.id]?.material?.name}
                      sourceName={pendingFiles[lesson.id]?.source?.name}
                      courseId={draft.id}
                      videoEnabled={videoEnabled}
                      onChange={(updates) => updateLesson(module.id, lesson.id, updates)}
                      onMove={(direction) => moveLesson(module.id, lessonIndex, direction)}
                      onRemove={() => updateModule(module.id, (current) => ({ ...current, lessons: current.lessons.filter((item) => item.id !== lesson.id) }))}
                      onMaterial={(file) => setPendingFiles((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], material: file } }))}
                      onSource={(file) => setPendingFiles((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], source: file } }))}
                      onLessonReplace={(updated) => updateLesson(module.id, lesson.id, updated)}
                    />
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
