import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types'
import { t } from '../i18n'

export function ProfilePage({ user, role }: { user: User | null; role: UserRole }) {
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !supabase) return
    void supabase.from('profiles').select('full_name').eq('id', user.id).single().then(({ data }) => {
      setFullName(data?.full_name ?? String(user.user_metadata.full_name ?? ''))
      setLoading(false)
    })
  }, [user])

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user || !supabase) return
    setMessage(null)
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', user.id)
    setMessage(error ? error.message : t('profile.saved'))
  }

  const roleLabel = role === 'admin' ? t('role.admin') : role === 'teacher' ? t('role.teacher') : t('role.student')
  return (
    <section className="page-wrap profile-page">
      <div className="section-heading"><div><p className="eyebrow">{t('profile.account')}</p><h1>{t('profile.title')}</h1></div></div>
      <form className="profile-card" onSubmit={saveProfile}>
        <label>{t('profile.name')}<input value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={loading} required /></label>
        <label>{t('auth.email')}<input value={user?.email ?? ''} disabled /></label>
        <label>{t('profile.role')}<input value={roleLabel} disabled /></label>
        {message && <div className="form-message" role="status">{message}</div>}
        <button className="button" type="submit" disabled={loading}>{t('profile.save')}</button>
      </form>
    </section>
  )
}
