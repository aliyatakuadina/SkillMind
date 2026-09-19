import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { UserRole } from '../types'
import { t } from '../i18n'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register'
  const navigate = useNavigate()
  const location = useLocation()
  const requestedPath = (location.state as { from?: string } | null)?.from
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('student')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!supabase) {
      setError(t('auth.supabaseMissing'))
      return
    }
    setSubmitting(true)
    try {
      if (isRegister) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim(), role } },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setMessage(t('auth.accountCreated'))
          return
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      }
      navigate(requestedPath || '/dashboard', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('auth.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <Link className="brand" to="/"><span className="brand-mark">S</span><span className="brand-text">SkillMind</span></Link>
        <p className="eyebrow">{isRegister ? t('auth.welcome') : t('auth.welcomeBack')}</p>
        <h1>{isRegister ? t('auth.createAccount') : t('auth.signInTitle')}</h1>
        {!isSupabaseConfigured && <div className="form-message error">{t('auth.supabaseShort')}</div>}
        {error && <div className="form-message error" role="alert">{error}</div>}
        {message && <div className="form-message success" role="status">{message}</div>}
        {isRegister && <>
          <label>{t('auth.name')}<input type="text" placeholder={t('auth.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>{t('auth.goal')}
            <select value={role} onChange={(event) => setRole(event.target.value as Exclude<UserRole, 'admin'>)} className="auth-role-select">
              <option value="student">{t('auth.studentGoal')}</option>
              <option value="teacher">{t('auth.teacherGoal')}</option>
            </select>
          </label>
        </>}
        <label>{t('auth.email')}<input type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>{t('auth.password')}<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={6} placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="button button-block" type="submit" disabled={submitting || !isSupabaseConfigured}>{submitting ? t('auth.wait') : isRegister ? t('auth.register') : t('auth.signIn')}</button>
        <p className="auth-footer-text">{isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}<Link to={isRegister ? '/login' : '/register'} state={requestedPath ? { from: requestedPath } : undefined}>{isRegister ? t('auth.loginLink') : t('auth.register')}</Link></p>
      </form>
    </section>
  )
}
