import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { getPublishedAiBundle, type PublishedAiBundle } from '../lib/learningRepository'
import { parseYoutubeId, youtubeEmbedUrl } from '../lib/youtube'
import { t } from '../i18n'

const LANGS = ['ru', 'kk', 'en'] as const

export function LessonVideoPlayer({
  lesson,
  resourceUrl,
}: {
  lesson: Lesson
  resourceUrl: string
}) {
  const [bundle, setBundle] = useState<PublishedAiBundle | null>(null)
  const [lang, setLang] = useState<(typeof LANGS)[number]>('ru')
  const [seek, setSeek] = useState(0)

  useEffect(() => {
    let active = true
    void getPublishedAiBundle(lesson.id)
      .then((value) => { if (active) setBundle(value) })
      .catch(() => { if (active) setBundle(null) })
    return () => { active = false }
  }, [lesson.id])

  const youtubeId = parseYoutubeId(lesson.videoUrl || '')
  const current = bundle?.languages[lang]
  const vtt = current?.vtt_text || ''
  const vttUrl = useMemo(() => (vtt ? URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })) : ''), [vtt])

  useEffect(() => () => { if (vttUrl) URL.revokeObjectURL(vttUrl) }, [vttUrl])

  const cues = current?.cues ?? []
  const sections = current?.lecture?.sections ?? []

  const player = useMemo(() => {
    if (youtubeId) {
      return (
        <div className="lesson-ai-player">
          <iframe
            title={lesson.title}
            src={youtubeEmbedUrl(youtubeId, seek)}
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )
    }
    if (resourceUrl) {
      return (
        <video className="lesson-media" controls src={resourceUrl}>
          {vttUrl && <track kind="subtitles" src={vttUrl} srcLang={lang} label={lang} default />}
          {t('learning.videoUnsupported')}
        </video>
      )
    }
    return <div className="video-placeholder"><span>{t('learning.videoMissing')}</span></div>
  }, [youtubeId, lesson.title, seek, resourceUrl, vttUrl, lang])

  return (
    <div className="lesson-ai-layout">
      {player}
      {bundle && (
        <div className="lesson-ai-bundle">
          <div className="builder-ai-lang-tabs" role="tablist" aria-label={t('learning.language')}>
            {LANGS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={lang === item}
                className={lang === item ? 'is-active' : ''}
                onClick={() => setLang(item)}
              >
                {item === 'ru' ? t('learning.langRu') : item === 'kk' ? t('learning.langKk') : t('learning.langEn')}
              </button>
            ))}
          </div>
          {current && (
            <>
              <h2>{current.title || t('learning.lecture')}</h2>
              <p>{current.summary}</p>
              {sections.map((section, index) => (
                <section key={`${lang}-section-${index}`}>
                  {section.heading && <h3>{section.heading}</h3>}
                  {section.body && <p>{section.body}</p>}
                </section>
              ))}
              {cues.length > 0 && (
                <div className="lesson-ai-cues">
                  <p>{t('learning.subtitles')}</p>
                  <ul>
                    {cues.map((cue, index) => (
                      <li key={`${lang}-cue-${index}`}>
                        <button type="button" className="lesson-ai-cue" onClick={() => setSeek(cue.start)}>
                          <span>{formatCueTime(cue.start)}</span>
                          {cue.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatCueTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
