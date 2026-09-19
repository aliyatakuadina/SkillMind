import { Link } from 'react-router-dom'
import { t } from '../i18n'

export function NotFoundPage() {
  return (
    <section className="page-wrap empty-page">
      <p className="eyebrow">{t('notFound.eyebrow')}</p>
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.description')}</p>
      <div className="not-found-actions">
        <Link className="button" to="/courses">
          {t('notFound.catalog')}
        </Link>
        <Link className="button button-muted" to="/">
          {t('notFound.home')}
        </Link>
      </div>
    </section>
  )
}
