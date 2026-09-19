import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '../i18n'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function CertificateVerifyPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = token.trim()
    if (!uuidPattern.test(normalized)) {
      setError(t('certificateVerify.invalid'))
      return
    }
    navigate(`/verify/${normalized}`)
  }

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <Link className="brand" to="/"><span className="brand-mark">S</span><span className="brand-text">SkillMind</span></Link>
        <p className="eyebrow">{t('certificateVerify.eyebrow')}</p>
        <h1>{t('certificateVerify.title')}</h1>
        <p>{t('certificateVerify.description')}</p>
        {error && <div className="form-message error" role="alert">{error}</div>}
        <label>{t('certificateVerify.token')}<input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></label>
        <button className="button button-block" type="submit">{t('certificateVerify.submit')}</button>
      </form>
    </section>
  )
}
