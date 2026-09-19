import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CourseCard } from '../components/CourseCard'
import { listPublishedCourses } from '../lib/learningRepository'
import type { Course } from '../types'
import { t } from '../i18n'

export function HomePage() {
  const [publishedCourses, setPublishedCourses] = useState<Course[]>([])

  useEffect(() => {
    let active = true
    void listPublishedCourses().then((courses) => {
      if (active) setPublishedCourses(courses.slice(0, 3))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  return (
    <div className="home-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1>
            {t('home.title')} <em>{t('home.forward')}</em>
          </h1>
          <p className="hero-text">
            {t('home.lead')}
          </p>
          <div className="hero-actions">
            <Link className="button" to="/courses">
              {t('home.chooseCourse')}
            </Link>
            <Link className="text-action" to="/teacher/courses">
              {t('home.teacher')} <span>→</span>
            </Link>
          </div>
          <div className="hero-proof">
            <div className="avatar-stack" aria-hidden="true">
              <span>А</span>
              <span>М</span>
              <span>С</span>
            </div>
            <p>
              <strong>1 200+</strong> {t('home.studentsProof')}
            </p>
          </div>
        </div>

        <div className="hero-art" aria-label={t('home.progressCard')}>
          <div className="art-sun" />
          <div className="art-card art-card-top">
            <span className="round-icon">✦</span>
            <div>
              <b>{t('home.newGoal')}</b>
              <small>{t('home.launchProject')}</small>
            </div>
          </div>
          <div className="art-main-card">
            <span>{t('home.yourProgress')}</span>
            <strong>64%</strong>
            <div className="progress-bar">
              <i style={{ width: '64%' }} />
            </div>
            <p>{t('home.lessonsFinished')}</p>
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
              <b>{t('home.lessonFinished')}</b>
              <small>{t('home.greatWork')}</small>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Strip */}
      <section className="logo-strip">
        <span>{t('home.clearProgram')}</span>
        <i />
        <span>{t('home.practice')}</span>
        <i />
        <span>{t('home.teacherReview')}</span>
        <i />
        <span>{t('home.officialCertificate')}</span>
      </section>

      {/* Courses Section */}
      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('home.direction')}</p>
            <h2>{t('home.popular')}</h2>
          </div>
          <Link className="text-action" to="/courses">
            {t('dashboard.allCatalog')} <span>→</span>
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
          <p className="eyebrow">{t('home.how')}</p>
          <h2>
            {t('home.lessNoise')}
            <br />
            {t('home.moreResult')}
          </h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>{t('home.stepChoose')}</h3>
              <p>{t('home.stepChooseDescription')}</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>{t('home.stepLearn')}</h3>
              <p>{t('home.stepLearnDescription')}</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>{t('home.stepCertificate')}</h3>
              <p>{t('home.stepCertificateDescription')}</p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}
