import { Link } from 'react-router-dom'
import { t } from '../i18n'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand-col">
          <Link className="brand" to="/">
            <span className="brand-mark">S</span>
            <span className="brand-text">SkillMind</span>
          </Link>
          <p className="footer-tagline">
            {t('footer.tagline')}
          </p>
        </div>

        <div className="footer-nav-grid">
          <div className="footer-col">
            <h4>{t('footer.learning')}</h4>
            <Link to="/courses">{t('footer.catalog')}</Link>
            <Link to="/dashboard">{t('nav.learning')}</Link>
            <Link to="/verify">{t('nav.certificateVerify')}</Link>
          </div>
          <div className="footer-col">
            <h4>{t('footer.teaching')}</h4>
            <Link to="/teacher/courses">{t('footer.author')}</Link>
            <Link to="/teacher/courses/create">{t('footer.createCourse')}</Link>
            <Link to="/teacher/submissions">{t('nav.submissions')}</Link>
          </div>
          <div className="footer-col">
            <h4>{t('footer.platform')}</h4>
            <Link to="/admin/users">{t('footer.controlPanel')}</Link>
            <Link to="/login">{t('footer.systemLogin')}</Link>
            <Link to="/register">{t('footer.registration')}</Link>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>{t('footer.copyright')}</p>
        <div className="footer-meta">
          <span>React 19 + Vite</span>
          <span>•</span>
          <span>{t('footer.supabaseReady')}</span>
        </div>
      </div>
    </footer>
  )
}
