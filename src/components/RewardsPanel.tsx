import { useEffect, useState, type FormEvent } from 'react'
import type { TranslationKey } from '../i18n'
import {
  getCourseLeaderboard,
  getMyRewards,
  isSkillmindApiConfigured,
  joinCourseRanking,
  leaveCourseRanking,
  updateRewardPreferences,
} from '../lib/skillmindApi'
import { t } from '../i18n'

const ACHIEVEMENT_KEYS: Record<string, TranslationKey> = {
  first_lesson: 'learning.achievement.first_lesson',
  first_quiz: 'learning.achievement.first_quiz',
  ten_lessons: 'learning.achievement.ten_lessons',
  first_certificate: 'learning.achievement.first_certificate',
  three_weekly_goals: 'learning.achievement.three_weekly_goals',
}

export function RewardsPanel({
  enabled,
  courseId,
}: {
  enabled: boolean
  courseId: string
}) {
  const [totalXp, setTotalXp] = useState(0)
  const [level, setLevel] = useState(1)
  const [achievements, setAchievements] = useState<string[]>([])
  const [alias, setAlias] = useState('')
  const [leaders, setLeaders] = useState<{ rank: number; alias: string; xp: number; is_me: boolean }[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled || !isSkillmindApiConfigured()) return
    let active = true
    void Promise.all([getMyRewards(), getCourseLeaderboard(courseId)])
      .then(([me, board]) => {
        if (!active) return
        setTotalXp(me.total_xp)
        setLevel(me.level)
        setAchievements(me.achievements.map((item) => item.achievement_code))
        setAlias(me.preferences?.public_alias ?? '')
        setLeaders(board.leaders)
        setWeekStart(board.week_start)
      })
      .catch((caught: Error) => {
        if (active) setMessage(caught.message)
      })
    return () => {
      active = false
    }
  }, [enabled, courseId])

  const reload = async () => {
    if (!enabled || !isSkillmindApiConfigured()) return
    const [me, board] = await Promise.all([getMyRewards(), getCourseLeaderboard(courseId)])
    setTotalXp(me.total_xp)
    setLevel(me.level)
    setAchievements(me.achievements.map((item) => item.achievement_code))
    setAlias(me.preferences?.public_alias ?? '')
    setLeaders(board.leaders)
    setWeekStart(board.week_start)
  }

  if (!enabled) return null

  const saveAlias = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await updateRewardPreferences({ publicAlias: alias })
      await reload()
      setMessage(t('learning.rewardsSaved'))
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t('learning.rewardsError'))
    } finally {
      setBusy(false)
    }
  }

  const join = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await joinCourseRanking(courseId)
      await reload()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t('learning.rewardsError'))
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await leaveCourseRanking(courseId)
      await reload()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t('learning.rewardsError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lesson-rewards" aria-label={t('learning.rewardsTitle')}>
      <h2>{t('learning.rewardsTitle')}</h2>
      <p className="builder-subtitle">{t('learning.rewardsHint')}</p>
      <p className="lesson-rewards-stats">{t('learning.rewardsLevel', { level, xp: totalXp })}</p>
      {achievements.length > 0 ? (
        <ul className="lesson-rewards-achievements">
          {achievements.map((code) => (
            <li key={code}>{ACHIEVEMENT_KEYS[code] ? t(ACHIEVEMENT_KEYS[code]) : code}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('learning.rewardsNoAchievements')}</p>
      )}
      <form className="lesson-rewards-alias" onSubmit={(event) => void saveAlias(event)}>
        <label>
          {t('learning.rewardsAlias')}
          <input value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={40} />
        </label>
        <button className="button button-muted" type="submit" disabled={busy}>{t('learning.rewardsSaveAlias')}</button>
      </form>
      <div className="lesson-rewards-board">
        <div className="lesson-rewards-board-head">
          <h3>{t('learning.rewardsBoard', { week: weekStart || '—' })}</h3>
          <div className="admin-ai-actions">
            <button className="button button-muted" type="button" disabled={busy} onClick={() => void join()}>{t('learning.rewardsJoin')}</button>
            <button className="button button-muted" type="button" disabled={busy} onClick={() => void leave()}>{t('learning.rewardsLeave')}</button>
          </div>
        </div>
        {leaders.length === 0 ? <p className="muted">{t('learning.rewardsBoardEmpty')}</p> : (
          <ol>
            {leaders.map((row) => (
              <li key={`${row.rank}-${row.alias}`} className={row.is_me ? 'is-me' : undefined}>
                #{row.rank} {row.alias} — {row.xp} XP
              </li>
            ))}
          </ol>
        )}
      </div>
      {message ? <p className="muted" role="status">{message}</p> : null}
    </section>
  )
}
