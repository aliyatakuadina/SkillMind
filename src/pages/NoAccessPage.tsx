import { Link } from 'react-router-dom'
import { t } from '../i18n'

export function NoAccessPage() {
  return (
    <section className="page-wrap empty-catalog-state">
      <span className="empty-icon">🔒</span>
      <h1>{t('access.title')}</h1>
      <p>{t('access.description')}</p>
      <Link className="button" to="/dashboard">{t('access.back')}</Link>
    </section>
  )
}
