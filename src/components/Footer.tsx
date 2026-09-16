import { Link } from 'react-router-dom'

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
            Платформа для осмысленного онлайн-обучения с понятной программой и закреплением на практике.
          </p>
        </div>

        <div className="footer-nav-grid">
          <div className="footer-col">
            <h4>Обучение</h4>
            <Link to="/courses">Каталог курсов</Link>
            <Link to="/dashboard">Моё обучение</Link>
            <Link to="/certificates/cert-ux-2026-982">Проверка сертификата</Link>
          </div>
          <div className="footer-col">
            <h4>Преподавание</h4>
            <Link to="/teacher/courses">Кабинет автора</Link>
            <Link to="/teacher/courses/create">Создать курс</Link>
            <Link to="/teacher/submissions">Проверка заданий</Link>
          </div>
          <div className="footer-col">
            <h4>Платформа</h4>
            <Link to="/admin/users">Панель управления</Link>
            <Link to="/login">Вход в систему</Link>
            <Link to="/register">Регистрация</Link>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© 2026 SkillMind LMS. Все права защищены.</p>
        <div className="footer-meta">
          <span>React 19 + Vite</span>
          <span>•</span>
          <span>Готово к подключению Supabase</span>
        </div>
      </div>
    </footer>
  )
}
