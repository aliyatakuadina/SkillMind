import { useEffect, useState } from 'react'
import { applyYoutubeBundle, type VideoBundleProposal, type VideoBundleRecord } from '../lib/authorDraft'
import type { CourseDraftLesson } from '../lib/courseRepository'
import { VideoBundleEditor } from './VideoBundleEditor'
import { getLessonAiBundle, isSkillmindApiConfigured, persistJobBundle, registerYoutubeSource, uploadMediaFile, waitForAiJob } from '../lib/skillmindApi'
import { t } from '../i18n'

export function MediaSourceUploader({
  courseId,
  lesson,
  enabled,
  onLesson,
}: {
  courseId?: string
  lesson: CourseDraftLesson
  enabled: boolean
  onLesson: (lesson: CourseDraftLesson) => void
}) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'upload' | 'youtube' | 'wait' | null>(null)
  const [progress, setProgress] = useState(0)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [proposal, setProposal] = useState<VideoBundleProposal | null>(null)
  const [bundle, setBundle] = useState<VideoBundleRecord | null>(null)

  useEffect(() => {
    if (!enabled || !courseId || !isSkillmindApiConfigured()) return
    let active = true
    void getLessonAiBundle(lesson.id)
      .then((record) => { if (active) setBundle(record) })
      .catch(() => undefined)
    return () => { active = false }
  }, [enabled, courseId, lesson.id])

  if (!enabled) return null

  const finishBundleJob = async (jobId: string, fallback: string) => {
    setMode('wait')
    setMessage(t('builder.aiBundleWait'))
    const finished = await waitForAiJob(jobId, 180)
    if (finished.status === 'failed' || finished.status === 'cancelled') {
      setMessage(finished.error_code || fallback)
      return
    }
    try {
      const record = await persistJobBundle(jobId)
      setBundle(record)
      setProposal(null)
      setMessage(t('builder.aiBundleReady'))
    } catch {
      const output = finished.output as Record<string, unknown> | null | undefined
      if (output?.kind === 'video_bundle') {
        setProposal(output as unknown as VideoBundleProposal)
        setMessage(t('builder.aiBundleReady'))
        return
      }
      setMessage(t('builder.aiQueued'))
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!courseId) {
      setMessage(t('builder.aiSaveFirst'))
      return
    }
    if (!isSkillmindApiConfigured()) {
      setMessage(t('builder.aiApiMissing'))
      return
    }
    setBusy(true)
    setMode('upload')
    setMessage(null)
    setProgress(0)
    try {
      const result = await uploadMediaFile({
        courseId,
        lessonId: lesson.id,
        file,
        onProgress: (ratio) => setProgress(Math.round(ratio * 100)),
      })
      if (!result.jobId) {
        setMessage(t('builder.aiUploaded'))
        return
      }
      await finishBundleJob(result.jobId, t('builder.aiUploadError'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('builder.aiUploadError'))
    } finally {
      setBusy(false)
      setMode(null)
    }
  }

  const onYoutube = async () => {
    if (!courseId) {
      setMessage(t('builder.aiSaveFirst'))
      return
    }
    if (!isSkillmindApiConfigured()) {
      setMessage(t('builder.aiApiMissing'))
      return
    }
    setBusy(true)
    setMode('youtube')
    setMessage(null)
    setProposal(null)
    try {
      const started = await registerYoutubeSource({
        courseId,
        lessonId: lesson.id,
        url: youtubeUrl,
      })
      await finishBundleJob(started.job.id, t('builder.aiYoutubeError'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('builder.aiYoutubeError'))
    } finally {
      setBusy(false)
      setMode(null)
    }
  }

  return (
    <div className="builder-ai-upload">
      <p className="builder-ai-title">{t('builder.aiVideoTitle')}</p>
      <p className="builder-subtitle">{t('builder.aiVideoHint')}</p>
      <label className="builder-file-label">
        {t('builder.aiVideoSelect')}
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void onFile(file)
          }}
        />
      </label>
      <div className="builder-ai-youtube">
        <p className="builder-subtitle">{t('builder.aiYoutubeHint')}</p>
        <div className="builder-ai-youtube-row">
          <label className="builder-ai-youtube-field">
            {t('builder.aiYoutubeLabel')}
            <input
              value={youtubeUrl}
              disabled={busy}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>
          <button type="button" className="button button-muted" disabled={busy || !youtubeUrl.trim()} onClick={() => void onYoutube()}>
            {t('builder.aiYoutubeSubmit')}
          </button>
        </div>
      </div>
      {busy && mode === 'upload' && (
        <div className="builder-ai-progress" role="status">
          <span style={{ width: `${progress}%` }} />
          <p>{t('builder.aiUploading', { progress })}</p>
        </div>
      )}
      {busy && (mode === 'youtube' || mode === 'wait') && <p role="status">{t('builder.aiBundleWait')}</p>}
      {message && <p className="builder-subtitle">{message}</p>}
      {bundle && (
        <VideoBundleEditor key={`${bundle.id}:${bundle.content_revision}`} bundle={bundle} lesson={lesson} onBundle={setBundle} onLesson={onLesson} />
      )}
      {!bundle && proposal && (
        <div className="builder-ai-proposal">
          <p>{t('builder.aiBundleTitle')}</p>
          {(['ru', 'kk', 'en'] as const).map((item) => {
            const language = proposal.languages[item]
            if (!language) return null
            return (
              <p key={item}>
                <b>{item.toUpperCase()}</b>
                {': '}
                {language.title}
                {' · '}
                {t('builder.aiBundleCues', { count: language.cues?.length ?? 0 })}
              </p>
            )
          })}
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              onLesson(applyYoutubeBundle(lesson, proposal))
              setMessage(t('builder.aiBundleApplied'))
            }}
          >
            {t('builder.aiApplyLecture')}
          </button>
        </div>
      )}
    </div>
  )
}
