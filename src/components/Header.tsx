import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { UserRole } from '../types'

interface HeaderProps {
  currentRole: UserRole
  onRoleChange: (role: UserRole) => void
}

export function Header({ currentRole, onRoleChange }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()

  const handleRoleSelect = (role: UserRole) => {
    onRoleChange(role)
    if (role === 'teacher') navigate('/teacher/courses')
    else if (role === 'admin') navigate('/admin/users')
    else navigate('/dashboard')
    setMobileMenuOpen(false)
  }

  return (
    <header className="site-header">
      <div className="header-container">
        <Link className="brand" to="/" aria-label="SkillMind — на главную" onClick={() => setMobileMenuOpen(false)}>
          <span className="brand-mark">S</span>
          <span className="brand-text">SkillMind</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="main-nav" aria-label="Основная навигация">
          <NavLink to="/courses" className={({ isActive }) => (isActive ? 'active' : '')}>
            Каталог
          </NavLink>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            Моё обучение
          </NavLink>
          <NavLink to="/teacher/courses" className={({ isActive }) => (isActive ? 'active' : '')}>
            Преподавателям
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : '')}>
            Управление
          </NavLink>
        </nav>

        {/* Header Right Actions */}
        <div className="header-actions">
          {/* Role switcher for prototype exploration */}
          <div className="role-switcher" title="Переключить режим роли для тестирования интерфейса">
            <span className="role-switcher-label">Режим:</span>
            <select
              value={currentRole}
              onChange={(e) => handleRoleSelect(e.target.value as UserRole)}
              className="role-select"
              aria-label="Переключить роль пользователя"
            >
              <option value="student">Студент</option>
              <option value="teacher">Преподаватель</option>
              <option value="admin">Администратор</option>
            </select>
          </div>

          <Link className="link-button" to="/login">
            Войти
          </Link>
          <Link className="button button-small" to="/register">
            Регистрация
          </Link>

          {/* Mobile hamburger button */}
          <button
            type="button"
            className={`mobile-menu-btn ${mobileMenuOpen ? 'open' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню навигации'}
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
              <span className="mobile-nav-title">Меню</span>
              <button
                type="button"
                className="close-btn"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <nav className="mobile-nav-links">
              <NavLink to="/courses" onClick={() => setMobileMenuOpen(false)}>
                📚 Каталог курсов
              </NavLink>
              <NavLink to="/dashboard" onClick={() => setMobileMenuOpen(false)}>
                🎓 Моё обучение
              </NavLink>
              <NavLink to="/teacher/courses" onClick={() => setMobileMenuOpen(false)}>
                ✏️ Кабинет преподавателя
              </NavLink>
              <NavLink to="/teacher/submissions" onClick={() => setMobileMenuOpen(false)}>
                📝 Проверка заданий
              </NavLink>
              <NavLink to="/admin/users" onClick={() => setMobileMenuOpen(false)}>
                ⚙️ Панель администратора
              </NavLink>
              <NavLink to="/certificates/cert-ux-2026-982" onClick={() => setMobileMenuOpen(false)}>
                🏆 Пример сертификата
              </NavLink>
            </nav>
            <div className="mobile-nav-footer">
              <p className="mobile-role-text">Демо-роль:</p>
              <div className="mobile-role-buttons">
                <button
                  type="button"
                  className={currentRole === 'student' ? 'active' : ''}
                  onClick={() => handleRoleSelect('student')}
                >
                  Студент
                </button>
                <button
                  type="button"
                  className={currentRole === 'teacher' ? 'active' : ''}
                  onClick={() => handleRoleSelect('teacher')}
                >
                  Преподаватель
                </button>
                <button
                  type="button"
                  className={currentRole === 'admin' ? 'active' : ''}
                  onClick={() => handleRoleSelect('admin')}
                >
                  Админ
                </button>
              </div>
              <div className="mobile-auth-links">
                <Link to="/login" className="button button-muted" onClick={() => setMobileMenuOpen(false)}>
                  Войти
                </Link>
                <Link to="/register" className="button" onClick={() => setMobileMenuOpen(false)}>
                  Регистрация
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
