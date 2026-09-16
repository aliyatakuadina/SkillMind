import { useState, useMemo } from 'react'
import { CourseCard } from '../components/CourseCard'
import { mockCourses } from '../data/mockData'

const categories = ['Все', 'Дизайн', 'Разработка', 'Навыки'] as const

export function CatalogPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('Все')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCourses = useMemo(() => {
    return mockCourses.filter((course) => {
      // Only show published courses in public catalog
      if (course.status !== 'published') return false

      const matchesCategory = selectedCategory === 'Все' || course.category === selectedCategory
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        query === '' ||
        course.title.toLowerCase().includes(query) ||
        course.description.toLowerCase().includes(query) ||
        course.author.toLowerCase().includes(query)

      return matchesCategory && matchesSearch
    })
  }, [selectedCategory, searchQuery])

  return (
    <section className="page-wrap catalog-page">
      <div className="catalog-header">
        <p className="eyebrow">Образовательные программы</p>
        <h1>Каталог курсов</h1>
        <p className="catalog-lead">
          Практические курсы от практикующих специалистов с поддержкой, проверкой домашних заданий и сертификатом.
        </p>
      </div>

      {/* Search and Filters Bar */}
      <div className="catalog-controls">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="search"
            placeholder="Поиск по названию курса, теме или автору..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            aria-label="Поиск по каталогу курсов"
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Очистить поиск"
            >
              ✕
            </button>
          )}
        </div>

        <div className="category-pills" role="tablist" aria-label="Фильтр по категориям">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`category-pill ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-results-info">
        <span>Найдено программ: <strong>{filteredCourses.length}</strong></span>
      </div>

      {/* Courses Grid */}
      {filteredCourses.length > 0 ? (
        <div className="course-grid">
          {filteredCourses.map((course) => (
            <CourseCard course={course} key={course.id} />
          ))}
        </div>
      ) : (
        <div className="empty-catalog-state">
          <span className="empty-icon">📂</span>
          <h3>Курсы не найдены</h3>
          <p>Попробуйте изменить поисковый запрос или выбрать другую категорию.</p>
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              setSelectedCategory('Все')
              setSearchQuery('')
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      )}
    </section>
  )
}
