import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { UserRole } from '../types'

interface AuthPageProps {
  mode: 'login' | 'register'
  onLoginSuccess?: (role: UserRole) => void
}

export function AuthPage({ mode, onLoginSuccess }: AuthPageProps) {
  const isRegister = mode === 'register'
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('student')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onLoginSuccess?.(role)
    if (role === 'teacher') {
      navigate('/teacher/courses')
    } else {
      navigate('/dashboard')
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <Link className="brand" to="/">
          <span className="brand-mark">S</span>
          <span className="brand-text">SkillMind</span>
        </Link>

        <p className="eyebrow">{isRegister ? 'Добро пожаловать' : 'С возвращением'}</p>
        <h1>{isRegister ? 'Создайте аккаунт' : 'Войдите в SkillMind'}</h1>

        {isRegister && (
          <>
            <label>
              Ваше имя
              <input
                type="text"
                placeholder="Алия Абдуллина"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>

            <label>
              Цель на платформе
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="auth-role-select"
              >
                <option value="student">🎓 Хочу проходить курсы (Студент)</option>
                <option value="teacher">✏️ Хочу обучать и создавать курсы (Преподаватель)</option>
              </select>
            </label>
          </>
        )}

        <label>
          Электронная почта
          <input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Пароль
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button className="button button-block" type="submit">
          {isRegister ? 'Зарегистрироваться' : 'Войти в аккаунт'}
        </button>

        <p className="auth-footer-text">
          {isRegister ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?'}{' '}
          <Link to={isRegister ? '/login' : '/register'}>
            {isRegister ? 'Войти' : 'Зарегистрироваться'}
          </Link>
        </p>
      </form>
    </section>
  )
}
