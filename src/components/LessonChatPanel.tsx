import { useState, type FormEvent } from 'react'
import { askLessonChat, isSkillmindApiConfigured, type ChatMessage } from '../lib/skillmindApi'
import { t } from '../i18n'

function clock(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return ''
  const total = Math.max(0, Math.floor(Number(value)))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function LessonChatPanel({
  enabled,
  courseId,
  lessonId,
  lessonTitle,
}: {
  enabled: boolean
  courseId: string
  lessonId: string
  lessonTitle?: string
}) {
  const [language, setLanguage] = useState<'ru' | 'kk' | 'en'>('ru')
  const [threadId, setThreadId] = useState<string | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!enabled) return null

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    if (!isSkillmindApiConfigured()) {
      setError(t('builder.aiApiMissing'))
      return
    }
    setBusy(true)
    setError(null)
    setDraft('')
    const localUser: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text }
    setMessages((current) => [...current, localUser])
    try {
      const result = await askLessonChat({
        courseId,
        lessonId,
        message: text,
        language,
        threadId,
        idempotencyKey: crypto.randomUUID(),
      })
      setThreadId(result.thread_id)
      setMessages((current) => [...current.filter((item) => item.id !== localUser.id), localUser, result.message])
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== localUser.id))
      setError(caught instanceof Error ? caught.message : t('learning.chatError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lesson-chat" aria-label={t('learning.chatTitle')}>
      <div className="lesson-chat-head">
        <h2>{t('learning.chatTitle')}</h2>
        <label>
          {t('learning.language')}
          <select value={language} onChange={(event) => setLanguage(event.target.value as 'ru' | 'kk' | 'en')}>
            <option value="ru">{t('learning.langRu')}</option>
            <option value="kk">{t('learning.langKk')}</option>
            <option value="en">{t('learning.langEn')}</option>
          </select>
        </label>
      </div>
      <p className="builder-subtitle">{t('learning.chatHint')}</p>
      {error ? <div className="notification-banner error" role="alert">{error}</div> : null}
      <div className="lesson-chat-log">
        {messages.length === 0 ? <p className="muted">{t('learning.chatEmpty')}</p> : null}
        {messages.map((message) => (
          <div key={message.id} className={`lesson-chat-bubble is-${message.role}`}>
            <p>{message.content}</p>
            {message.citations && message.citations.length > 0 ? (
              <ul className="lesson-chat-citations">
                {message.citations.map((citation, index) => (
                  <li key={`${message.id}-${index}`}>
                    {t('learning.chatCitation', {
                      lesson: citation.lesson_title || (citation.lesson_id === lessonId ? lessonTitle : '') || t('learning.chatThisLesson'),
                      time: clock(citation.start_seconds) || '—',
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      <form className="lesson-chat-form" onSubmit={(event) => void send(event)}>
        <label className="sr-only" htmlFor={`chat-${lessonId}`}>{t('learning.chatPlaceholder')}</label>
        <textarea
          id={`chat-${lessonId}`}
          rows={3}
          value={draft}
          disabled={busy}
          placeholder={t('learning.chatPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="button" type="submit" disabled={busy || !draft.trim()}>
          {busy ? t('learning.chatSending') : t('learning.chatSend')}
        </button>
      </form>
    </section>
  )
}
