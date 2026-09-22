import { MediaSourceUploader } from './MediaSourceUploader'
import type { TranslationKey } from '../i18n'
import type { CourseDraftLesson, QuizQuestionDraft, QuizQuestionType } from '../lib/courseRepository'
import type { LessonType } from '../types'
import { t } from '../i18n'

const lessonTypes: { value: LessonType; label: TranslationKey }[] = [
  { value: 'video', label: 'builder.typeVideo' },
  { value: 'text', label: 'builder.typeText' },
  { value: 'pdf', label: 'builder.typePdf' },
  { value: 'document', label: 'builder.typeDocx' },
  { value: 'quiz', label: 'builder.typeQuiz' },
  { value: 'homework', label: 'builder.typeHomework' },
]

export function LessonDraftCard({
  lesson,
  number,
  canMoveUp,
  canMoveDown,
  materialName,
  sourceName,
  courseId,
  videoEnabled,
  onChange,
  onMove,
  onRemove,
  onMaterial,
  onSource,
  onLessonReplace,
}: {
  lesson: CourseDraftLesson
  number: number
  canMoveUp: boolean
  canMoveDown: boolean
  materialName?: string
  sourceName?: string
  courseId?: string
  videoEnabled: boolean
  onChange: (updates: Partial<CourseDraftLesson>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onMaterial: (file: File) => void
  onSource: (file: File) => void
  onLessonReplace: (lesson: CourseDraftLesson) => void
}) {
  return (
    <article className="builder-lesson-card">
      <header className="builder-lesson-head">
        <span className="builder-mod-badge">{String(number).padStart(2, '0')}</span>
        <label className="builder-field">
          {t('builder.lessonTitle')}
          <input value={lesson.title} onChange={(event) => onChange({ title: event.target.value })} />
        </label>
        <div className="builder-lesson-actions">
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={t('builder.moveLessonUp')}>↑</button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={t('builder.moveLessonDown')}>↓</button>
          <button type="button" onClick={onRemove} aria-label={t('builder.deleteLesson')}>✕</button>
        </div>
      </header>

      <div className="builder-lesson-meta">
        <label className="builder-field">
          {t('builder.lessonType')}
          <select value={lesson.type} onChange={(event) => onChange({ type: event.target.value as LessonType })}>
            {lessonTypes.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
          </select>
        </label>
        <label className="builder-field">
          {t('builder.lessonDuration')}
          <input value={lesson.duration} onChange={(event) => onChange({ duration: event.target.value })} placeholder={t('builder.defaultDuration')} />
        </label>
        <label className="builder-required builder-field">
          <span>{t('builder.required')}</span>
          <input type="checkbox" checked={lesson.isRequired} onChange={(event) => onChange({ isRequired: event.target.checked })} />
        </label>
      </div>

      <label className="builder-field">
        {t('builder.lessonDescription')}
        <textarea value={lesson.description} rows={3} onChange={(event) => onChange({ description: event.target.value })} placeholder={t('builder.lessonDescriptionHint')} />
      </label>

      <div className="builder-lesson-panel">
        {lesson.type === 'text' && (
          <label className="builder-field">
            {t('builder.lessonText')}
            <textarea value={lesson.content} rows={6} onChange={(event) => onChange({ content: event.target.value })} placeholder={t('builder.lessonText')} />
          </label>
        )}

        {lesson.type === 'video' && (
          <>
            <label className="builder-field">
              {t('builder.videoLink')}
              <input value={lesson.resourceUrl} onChange={(event) => onChange({ resourceUrl: event.target.value })} placeholder="https://" />
            </label>
            <p className="builder-subtitle">{t('builder.videoOrFile')}</p>
            <FilePick label={t('builder.materialFile')} accept="video/mp4,video/webm" fileName={materialName} saved={Boolean(lesson.resourceUrl) && !materialName} onFile={onMaterial} />
            <MediaSourceUploader courseId={courseId} lesson={lesson} enabled={videoEnabled} onLesson={onLessonReplace} />
          </>
        )}

        {lesson.type === 'pdf' && (
          <FilePick label={t('builder.materialFile')} accept="application/pdf" fileName={materialName} saved={Boolean(lesson.resourceUrl) && !materialName} onFile={onMaterial} />
        )}

        {lesson.type === 'document' && (
          <div className="builder-file-grid">
            <FilePick label={t('builder.previewPdf')} accept="application/pdf" fileName={materialName} saved={Boolean(lesson.resourceUrl) && !materialName} onFile={onMaterial} />
            <FilePick label={t('builder.sourceDocx')} accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document" fileName={sourceName} saved={Boolean(lesson.sourceUrl) && !sourceName} onFile={onSource} />
          </div>
        )}

        {lesson.type === 'quiz' && (
          <QuizFields lesson={lesson} onChange={onChange} />
        )}

        {lesson.type === 'homework' && (
          <div className="builder-lesson-meta">
            <label className="builder-field">
              {t('builder.homeworkInstructions')}
              <textarea value={lesson.content} rows={4} onChange={(event) => onChange({ content: event.target.value })} />
            </label>
            <label className="builder-field">
              {t('builder.maxFiles')}
              <input type="number" min="0" max="10" value={lesson.maxFiles} onChange={(event) => onChange({ maxFiles: Number(event.target.value) })} />
            </label>
            <label className="builder-field">
              {t('builder.fileLimit')}
              <input type="number" min="1" max="50" value={Math.round(lesson.maxFileSizeBytes / 1048576)} onChange={(event) => onChange({ maxFileSizeBytes: Number(event.target.value) * 1048576 })} />
            </label>
          </div>
        )}
      </div>
    </article>
  )
}

function FilePick({
  label,
  accept,
  fileName,
  saved,
  onFile,
}: {
  label: string
  accept: string
  fileName?: string
  saved: boolean
  onFile: (file: File) => void
}) {
  return (
    <label className="builder-file-pick">
      <span>{label}</span>
      <input type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file) }} />
      <small>{fileName || (saved ? t('builder.fileSaved') : t('builder.fileEmpty'))}</small>
    </label>
  )
}

function QuizFields({
  lesson,
  onChange,
}: {
  lesson: CourseDraftLesson
  onChange: (updates: Partial<CourseDraftLesson>) => void
}) {
  const setQuestions = (questions: QuizQuestionDraft[]) => onChange({ questions })
  const patch = (questionId: string, update: (question: QuizQuestionDraft) => QuizQuestionDraft) => {
    setQuestions(lesson.questions.map((item) => item.id === questionId ? update(item) : item))
  }

  return (
    <div className="builder-quiz-editor">
      <div className="builder-lesson-meta">
        <label className="builder-field">{t('builder.passingScore')}<input type="number" min="0" max="100" value={lesson.passingScore} onChange={(event) => onChange({ passingScore: Number(event.target.value) })} /></label>
        <label className="builder-field">{t('builder.attempts')}<input type="number" min="1" max="20" value={lesson.attemptLimit ?? ''} onChange={(event) => onChange({ attemptLimit: event.target.value ? Number(event.target.value) : null })} /></label>
      </div>
      {lesson.questions.map((question, questionIndex) => (
        <div className="builder-question" key={question.id}>
          <div className="builder-question-heading">
            <b>{t('builder.question', { number: questionIndex + 1 })}</b>
            <button type="button" onClick={() => setQuestions(lesson.questions.filter((item) => item.id !== question.id))}>{t('builder.deleteQuestion')}</button>
          </div>
          <label className="builder-field">{t('builder.questionText')}<input value={question.prompt} onChange={(event) => patch(question.id, (item) => ({ ...item, prompt: event.target.value }))} /></label>
          <label className="builder-field">
            {t('builder.questionType')}
            <select value={question.type} onChange={(event) => patch(question.id, (item) => ({ ...item, type: event.target.value as QuizQuestionType, correctOptions: [0] }))}>
              <option value="single_choice">{t('builder.singleChoice')}</option>
              <option value="multiple_choice">{t('builder.multipleChoice')}</option>
              <option value="matching">{t('builder.matching')}</option>
            </select>
          </label>
          {question.type === 'matching' ? (
            <>
              {question.pairs.map((pair, pairIndex) => (
                <div className="builder-inline-fields" key={`${question.id}-pair-${pairIndex}`}>
                  <input value={pair.left} placeholder={t('builder.matchLeft', { number: pairIndex + 1 })} onChange={(event) => patch(question.id, (item) => ({ ...item, pairs: item.pairs.map((value, index) => index === pairIndex ? { ...value, left: event.target.value } : value) }))} />
                  <input value={pair.right} placeholder={t('builder.matchRight', { number: pairIndex + 1 })} onChange={(event) => patch(question.id, (item) => ({ ...item, pairs: item.pairs.map((value, index) => index === pairIndex ? { ...value, right: event.target.value } : value) }))} />
                </div>
              ))}
              <button type="button" className="table-action-btn" onClick={() => patch(question.id, (item) => ({ ...item, pairs: [...item.pairs, { left: '', right: '' }] }))}>{t('builder.addPair')}</button>
            </>
          ) : (
            <>
              {question.options.map((option, optionIndex) => (
                <label className="builder-answer-option" key={`${question.id}-${optionIndex}`}>
                  <input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={`correct-${question.id}`} checked={question.correctOptions.includes(optionIndex)} onChange={(event) => patch(question.id, (item) => ({ ...item, correctOptions: question.type === 'single_choice' ? [optionIndex] : event.target.checked ? [...item.correctOptions, optionIndex].sort((a, b) => a - b) : item.correctOptions.filter((index) => index !== optionIndex) }))} />
                  <input value={option} placeholder={t('builder.option', { number: optionIndex + 1 })} onChange={(event) => patch(question.id, (item) => ({ ...item, options: item.options.map((value, index) => index === optionIndex ? event.target.value : value) }))} />
                </label>
              ))}
              <button type="button" className="table-action-btn" onClick={() => patch(question.id, (item) => ({ ...item, options: [...item.options, ''] }))}>{t('builder.addOption')}</button>
            </>
          )}
        </div>
      ))}
      <button type="button" className="button button-small button-muted" onClick={() => onChange({ questions: [...lesson.questions, { id: crypto.randomUUID(), type: 'single_choice', prompt: '', options: ['', ''], correctOptions: [0], pairs: [{ left: '', right: '' }, { left: '', right: '' }], points: 1 }] })}>{t('builder.addQuestion')}</button>
    </div>
  )
}
