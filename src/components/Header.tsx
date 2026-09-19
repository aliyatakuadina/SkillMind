import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { UserRole } from '../types'
import { t } from '../i18n'

interface HeaderProps {
  currentRole: UserRole
  userEmail: string
  onLogout: () => Promise<void>
}

export function Header({ currentRole, userEmail, onLogout }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()
  const isAuthenticated = Boolean(userEmail)

  const handleLogout = async () => {
    setMobileMenuOpen(false)
    await onLogout()
    navigate('/login')
  }

  const roleLabel =
    currentRole === 'teacher' ? t('role.teacher') :
    currentRole === 'admin' ? t('role.admin') :
    t('role.student')

  const roleIcon =
    currentRole === 'admin' ? '⚙' :
    currentRole === 'teacher' ? '✏' :
    '🎓'

  return (
    <header className="site-header">
      <div className="header-container">
        <Link className="brand" to="/" aria-label={t('brand.homeLabel')} onClick={() => setMobileMenuOpen(false)}>
          <span className="brand-mark">S</span>
          <span className="brand-text">SkillMind</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="main-nav" aria-label={t('nav.mainLabel')}>
          <NavLink to="/courses" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.catalog')}
          </NavLink>
          {isAuthenticated && <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.learning')}
          </NavLink>}
          {isAuthenticated && (currentRole === 'teacher' || currentRole === 'admin') && (
            <NavLink to="/teacher/courses" className={({ isActive }) => (isActive ? 'active' : '')}>
              {t('nav.courses')}
            </NavLink>
          )}
          {isAuthenticated && currentRole === 'admin' && (
            <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : '')}>
              {t('nav.management')}
            </NavLink>
          )}
        </nav>

        {/* Header Right Actions */}
        <div className="header-actions">
          {/* User info pill */}
          {isAuthenticated ? <><div className="user-info-pill">
            <span className="user-avatar-dot">{roleIcon}</span>
            <span className="user-role-label" title={userEmail}>{roleLabel}</span>
          </div>

          <button
            type="button"
            className="button button-small button-muted"
            onClick={handleLogout}
          >
            {t('auth.logout')}
          </button>
          </> : <div className="guest-auth-actions">
            <Link className="button button-small button-muted" to="/login">{t('auth.loginLink')}</Link>
            <Link className="button button-small" to="/register">{t('auth.register')}</Link>
          </div>}

          {/* Mobile hamburger button */}
          <button
            type="button"
            className={`mobile-menu-btn ${mobileMenuOpen ? 'open' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={mobileMenuOpen}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="mobile-nav-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-nav-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-nav-header">
              <span className="mobile-nav-title">{t('nav.menu')}</span>
              <button
                type="button"
                className="close-btn"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={t('nav.close')}
              >
                ✕
              </button>
            </div>
            <nav className="mobile-nav-links">
              <NavLink to="/courses" onClick={() => setMobileMenuOpen(false)}>
                📚 {t('footer.catalog')}
              </NavLink>
              {isAuthenticated && <NavLink to="/dashboard" onClick={() => setMobileMenuOpen(false)}>
                🎓 {t('nav.learning')}
              </NavLink>}
              {isAuthenticated && <NavLink to="/profile" onClick={() => setMobileMenuOpen(false)}>
                👤 {t('nav.profile')}
              </NavLink>}
              {isAuthenticated && (currentRole === 'teacher' || currentRole === 'admin') && (
                <NavLink to="/teacher/courses" onClick={() => setMobileMenuOpen(false)}>
                  ✏️ {t('nav.teacher')}
                </NavLink>
              )}
              {isAuthenticated && (currentRole === 'teacher' || currentRole === 'admin') && (
                <NavLink to="/teacher/submissions" onClick={() => setMobileMenuOpen(false)}>
                  📝 {t('nav.submissions')}
                </NavLink>
              )}
              {isAuthenticated && currentRole === 'admin' && (
                <NavLink to="/admin/users" onClick={() => setMobileMenuOpen(false)}>
                  ⚙️ {t('nav.admin')}
                </NavLink>
              )}
              <NavLink to="/verify" onClick={() => setMobileMenuOpen(false)}>
                🏆 {t('nav.certificateVerify')}
              </NavLink>
            </nav>
            <div className="mobile-nav-footer">
              <div className="mobile-auth-links">
                {isAuthenticated ? <button
                  type="button"
                  className="button button-muted"
                  style={{ width: '100%' }}
                  onClick={handleLogout}
                >
                  {t('auth.logoutAccount')}
                </button> : <><Link className="button button-muted" to="/login" onClick={() => setMobileMenuOpen(false)}>{t('auth.loginLink')}</Link><Link className="button" to="/register" onClick={() => setMobileMenuOpen(false)}>{t('auth.register')}</Link></>}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
