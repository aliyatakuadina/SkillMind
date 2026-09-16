import { Link } from 'react-router-dom'
import { CourseCard } from '../components/CourseCard'
import { mockCourses } from '../data/mockData'

export function HomePage() {
  const publishedCourses = mockCourses.filter((c) => c.status === 'published')

  return (
    <div className="home-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Учитесь в своём темпе</p>
          <h1>
            Знания, которые ведут <em>вперёд.</em>
          </h1>
          <p className="hero-text">
            Онлайн-курсы с понятной программой, практическими заданиями, тестами и проверкой работ преподавателями.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/courses">
              Выбрать курс
            </Link>
            <Link className="text-action" to="/teacher/courses">
              Я преподаватель <span>→</span>
            </Link>
          </div>
          <div className="hero-proof">
            <div className="avatar-stack">
              <span>А</span>
              <span>М</span>
              <span>С</span>
            </div>
            <p>
              <strong>1 200+</strong> студентов уже учатся с нами
            </p>
          </div>
        </div>

        <div className="hero-art" aria-label="Карточка учебного прогресса">
          <div className="art-sun" />
          <div className="art-card art-card-top">
            <span className="round-icon">✦</span>
            <div>
              <b>Новая цель</b>
              <small>Запустить проект</small>
            </div>
          </div>
          <div className="art-main-card">
            <span>ВАШ ПРОГРЕСС</span>
            <strong>64%</strong>
            <div className="progress-bar">
              <i style={{ width: '64%' }} />
            </div>
            <p>12 из 18 уроков завершены</p>
            <div className="mini-chart">
              <i style={{ height: '19px' }} />
              <i style={{ height: '28px' }} />
              <i style={{ height: '23px' }} />
              <i style={{ height: '35px' }} />
              <i style={{ height: '30px' }} />
              <i style={{ height: '42px' }} />
              <i style={{ height: '37px' }} />
            </div>
          </div>
          <div className="art-card art-card-bottom">
            <span className="round-icon green">✓</span>
            <div>
              <b>Урок завершён</b>
              <small>Отличная работа!</small>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Strip */}
      <section className="logo-strip">
        <span>Понятная программа</span>
        <i />
        <span>Практические задания</span>
        <i />
        <span>Проверка преподавателем</span>
        <i />
        <span>Официальный сертификат</span>
      </section>

      {/* Courses Section */}
      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Выберите направление</p>
            <h2>Популярные курсы</h2>
          </div>
          <Link className="text-action" to="/courses">
            Все курсы в каталоге <span>→</span>
          </Link>
        </div>
        <div className="course-grid">
          {publishedCourses.map((course) => (
            <CourseCard course={course} key={course.id} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="how-it-works">
        <div>
          <p className="eyebrow">Как это работает</p>
          <h2>
            Меньше шума.
            <br />
            Больше результата.
          </h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Выберите курс</h3>
              <p>Изучите подробную программу и начните тогда, когда удобно вам.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Учитесь и практикуйтесь</h3>
              <p>Смотрите короткие видео, читайте конспекты, сдавайте тесты и домашние задания.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Получите сертификат</h3>
              <p>После выполнения всех обязательных уроков и тестов вам выдаётся номерной сертификат.</p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}
