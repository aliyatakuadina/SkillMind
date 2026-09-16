import { Link, useParams } from 'react-router-dom'
import { mockCourses } from '../data/mockData'

const studentsData = [
  { id: '1', name: 'Алия Абдуллина', email: 'aliya@example.com', progress: '82%', score: '4.9', status: 'Активен', lastActivity: 'Сегодня' },
  { id: '2', name: 'Дамир Нурланов', email: 'damir@example.com', progress: '54%', score: '4.4', status: 'Активен', lastActivity: 'Вчера' },
  { id: '3', name: 'София Иванова', email: 'sofia@example.com', progress: '96%', score: '5.0', status: 'Завершил(а)', lastActivity: '14 сен' },
  { id: '4', name: 'Артем Смирнов', email: 'artem@example.com', progress: '28%', score: '4.2', status: 'Активен', lastActivity: '11 сен' },
  { id: '5', name: 'Елена Кузнецова', email: 'elena@example.com', progress: '100%', score: '4.8', status: 'Завершил(а)', lastActivity: '9 сен' },
]

export function AnalyticsPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const course = mockCourses.find((c) => c.id === courseId) ?? mockCourses[0]

  const handleExportCSV = () => {
    const headers = 'ID,Имя студента,Email,Прогресс,Средний балл,Статус,Последняя активность\n'
    const rows = studentsData
      .map(
        (s) =>
          `"${s.id}","${s.name}","${s.email}","${s.progress}","${s.score}","${s.status}","${s.lastActivity}"`
      )
      .join('\n')
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `analytics_${course.id}_2026.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="page-wrap analytics-page">
      <nav className="breadcrumbs">
        <Link to="/teacher/courses">Кабинет преподавателя</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Аналитика курса</span>
      </nav>

      <div className="section-heading">
        <div>
          <p className="eyebrow">{course.title}</p>
          <h1>Статистика успеваемости</h1>
        </div>
        <button className="button button-muted" type="button" onClick={handleExportCSV}>
          📥 Экспорт в CSV
        </button>
      </div>

      {/* Key Metrics Grid */}
      <div className="metric-grid">
        <article className="metric">
          <span>Записано студентов</span>
          <strong>126</strong>
        </article>
        <article className="metric">
          <span>Средний прогресс</span>
          <strong>58%</strong>
        </article>
        <article className="metric">
          <span>Завершили курс</span>
          <strong>32</strong>
        </article>
        <article className="metric">
          <span>Средняя оценка</span>
          <strong>4,7</strong>
        </article>
      </div>

      {/* Dynamics Chart Card */}
      <div className="analytics-chart">
        <div className="chart-header">
          <div>
            <h2>Динамика прохождения уроков</h2>
            <p>Количество активных студентов по неделям</p>
          </div>
          <span className="chart-legend">● Активность за 8 недель</span>
        </div>

        <div className="bar-chart">
          {[
            { label: 'Н1', height: '32%', val: '42' },
            { label: 'Н2', height: '45%', val: '58' },
            { label: 'Н3', height: '52%', val: '65' },
            { label: 'Н4', height: '48%', val: '60' },
            { label: 'Н5', height: '68%', val: '86' },
            { label: 'Н6', height: '84%', val: '106' },
            { label: 'Н7', height: '76%', val: '95' },
            { label: 'Н8', height: '94%', val: '118' },
          ].map((bar, i) => (
            <div key={i} className="chart-col">
              <span className="bar-val">{bar.val}</span>
              <i style={{ height: bar.height }} />
              <span className="bar-label">{bar.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Students List */}
      <div className="section-heading" style={{ marginTop: '40px' }}>
        <h2>Студенты на курсе</h2>
        <span className="count-badge">{studentsData.length} отображается</span>
      </div>

      <div className="teacher-table">
        <div className="table-head">
          <span>Студент</span>
          <span>Прогресс</span>
          <span>Средний балл</span>
          <span>Статус</span>
          <span>Активность</span>
        </div>

        {studentsData.map((student) => (
          <div className="table-row" key={student.id}>
            <div>
              <b>{student.name}</b>
              <small>{student.email}</small>
            </div>
            <div>
              <div className="progress-bar mini-table-bar">
                <i style={{ width: student.progress }} />
              </div>
              <small>{student.progress}</small>
            </div>
            <b>{student.score}</b>
            <span className={`status ${student.status === 'Завершил(а)' ? 'published' : 'student'}`}>
              {student.status}
            </span>
            <span className="text-muted">{student.lastActivity}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
