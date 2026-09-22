import { useState } from 'react'
import { applyYoutubeBundle, type VideoBundleRecord, type VideoLanguageDraft } from '../lib/authorDraft'
import type { CourseDraftLesson } from '../lib/courseRepository'
import { publishAiBundle, saveAiBundle } from '../lib/skillmindApi'
import { youtubeEmbedUrl } from '../lib/youtube'
import { t } from '../i18n'

const LANGS = ['ru', 'kk', 'en'] as const

export function VideoBundleEditor({
  bundle,
  lesson,
  onBundle,
  onLesson,
}: {
  bundle: VideoBundleRecord
  lesson: CourseDraftLesson
  onBundle: (bundle: VideoBundleRecord) => void
  onLesson: (lesson: CourseDraftLesson) => void
}) {
  const [lang, setLang] = useState<(typeof LANGS)[number]>('ru')
  const [draft, setDraft] = useState(bundle)
  const [seek, setSeek] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const current = draft.languages[lang]
  const published = draft.status === 'published'
  const youtubeId = draft.youtube_id

  const updateLanguage = (patch: Partial<VideoLanguageDraft>) => {
    setDraft((value) => ({
      ...value,
      languages: { ...value.languages, [lang]: { ...value.languages[lang], ...patch } },
    }))
  }

  const updateCue = (index: number, patch: Partial<{ start: number; end: number; text: string; uncertain: boolean }>) => {
    const cues = [...(current.cues ?? [])]
    cues[index] = { ...cues[index], ...patch }
    updateLanguage({ cues })
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const saved = await saveAiBundle(draft.id, draft.content_revision, draft.languages)
      onBundle(saved)
      setMessage(t('builder.aiBundleSaved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('builder.aiYoutubeError'))
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const saved = await saveAiBundle(draft.id, draft.content_revision, draft.languages)
      const publishedBundle = await publishAiBundle(saved.id, saved.content_revision)
      onBundle(publishedBundle)
      onLesson(applyYoutubeBundle(lesson, {
        kind: 'video_bundle',
        youtube_id: publishedBundle.youtube_id || '',
        languages: publishedBundle.languages,
      }))
      setMessage(t('builder.aiBundlePublished'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('builder.aiYoutubeError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="builder-ai-editor">
      <p className="builder-ai-title">{t('builder.aiEditorTitle')}</p>
      {youtubeId && (
        <div className="builder-ai-player">
          <iframe
            title={t('builder.aiEditorTitle')}
            src={youtubeEmbedUrl(youtubeId, seek)}
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      <div className="builder-ai-lang-tabs" role="tablist" aria-label={t('builder.aiBundleTitle')}>
        {LANGS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={lang === item}
            className={lang === item ? 'is-active' : ''}
            onClick={() => setLang(item)}
          >
            {item === 'ru' ? t('builder.aiLangRu') : item === 'kk' ? t('builder.aiLangKk') : t('builder.aiLangEn')}
          </button>
        ))}
      </div>
      <label>
        {t('builder.aiLectureTitle')}
        <input value={current.title} disabled={published || busy} onChange={(event) => updateLanguage({ title: event.target.value })} />
      </label>
      <label>
        {t('builder.aiSummaryResult')}
        <textarea rows={3} value={current.summary} disabled={published || busy} onChange={(event) => updateLanguage({ summary: event.target.value })} />
      </label>
      {(current.lecture?.sections ?? []).map((section, index) => (
        <label key={`${lang}-section-${index}`}>
          {t('builder.aiLectureSection', { number: index + 1 })}
          <textarea
            rows={3}
            value={[section.heading, section.body].filter(Boolean).join('\n')}
            disabled={published || busy}
            onChange={(event) => {
              const [heading, ...rest] = event.target.value.split('\n')
              const sections = [...(current.lecture?.sections ?? [])]
              sections[index] = { ...section, heading, body: rest.join('\n') }
              updateLanguage({ lecture: { ...current.lecture, sections } })
            }}
          />
        </label>
      ))}
      <div className="builder-ai-cues">
        <p>{t('learning.subtitles')}</p>
        {(current.cues ?? []).map((cue, index) => (
          <div className={cue.uncertain ? 'builder-ai-cue is-uncertain' : 'builder-ai-cue'} key={`${lang}-cue-${index}`}>
            <label>
              {t('builder.aiCueStart')}
              <input type="number" min={0} step={0.1} value={cue.start} disabled={published || busy} onChange={(event) => updateCue(index, { start: Number(event.target.value) })} />
            </label>
            <label>
              {t('builder.aiCueEnd')}
              <input type="number" min={0} step={0.1} value={cue.end} disabled={published || busy} onChange={(event) => updateCue(index, { end: Number(event.target.value) })} />
            </label>
            <label className="builder-ai-cue-text">
              {t('builder.aiCueText')}
              <input value={cue.text} disabled={published || busy} onChange={(event) => updateCue(index, { text: event.target.value })} />
            </label>
            <button type="button" className="button button-muted" disabled={!youtubeId} onClick={() => setSeek(cue.start)}>
              {t('builder.aiSeekCue')}
            </button>
            <label className="builder-ai-cue-flag">
              <input
                type="checkbox"
                checked={Boolean(cue.uncertain)}
                disabled={published || busy}
                onChange={(event) => updateCue(index, { uncertain: event.target.checked })}
              />
              {t('builder.aiCueUncertain')}
            </label>
          </div>
        ))}
        {!published && (
          <button
            type="button"
            className="button button-muted"
            onClick={() => updateLanguage({ cues: [...(current.cues ?? []), { start: 0, end: 1, text: '' }] })}
          >
            {t('builder.aiAddCue')}
          </button>
        )}
      </div>
      {!published && (
        <div className="builder-ai-editor-actions">
          <button type="button" className="button button-muted" disabled={busy} onClick={() => void save()}>{t('builder.aiSaveBundle')}</button>
          <label className="builder-required">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            {t('builder.aiPublishConfirm')}
          </label>
          <button type="button" className="button" disabled={busy || !checked} onClick={() => void publish()}>{t('builder.aiPublishBundle')}</button>
        </div>
      )}
      {message && <p className="builder-subtitle">{message}</p>}
    </div>
  )
}
