import { Link } from 'react-router-dom'
import type { Course } from '../types'

interface CourseCardProps {
  course: Course
}

export function CourseCard({ course }: CourseCardProps) {
  return (
    <article className="course-card">
      <div className={`course-cover cover-${course.accent}`}>
        <span className="course-category-badge">{course.category}</span>
        <b className="course-cover-title">{course.title.split(':')[0]}</b>
      </div>
      <div className="course-card-body">
        <div className="course-card-meta">
          <span className="meta-category">{course.category}</span>
          <span className="meta-dot">·</span>
          <span className="meta-duration">{course.duration}</span>
          {course.rating && (
            <>
              <span className="meta-dot">·</span>
              <span className="meta-rating">★ {course.rating}</span>
            </>
          )}
        </div>
        <h3 className="course-card-heading">
          <Link to={`/courses/${course.id}`}>{course.title}</Link>
        </h3>
        <p className="course-card-desc">{course.description}</p>
        <div className="course-card-author">
          <small>Автор: {course.author}</small>
        </div>
        <div className="course-card-footer">
          <span className="lessons-count">{course.lessonsCount} уроков</span>
          <Link className="card-action-link" to={`/courses/${course.id}`}>
            Подробнее →
          </Link>
        </div>
      </div>
    </article>
  )
}
