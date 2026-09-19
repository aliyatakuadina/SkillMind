import { useEffect, useMemo, useState } from 'react'
import { CourseCard } from '../components/CourseCard'
import { listPublishedCourses } from '../lib/learningRepository'
import type { Course } from '../types'
import { t } from '../i18n'

const categories = [t('catalog.all'), t('catalog.design'), t('catalog.development'), t('catalog.skills')] as const

export function CatalogPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>(t('catalog.all'))
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listPublishedCourses()
      .then((data) => { if (active) setCourses(data) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const filteredCourses = useMemo(() => courses.filter((course) => {
    const matchesCategory = selectedCategory === t('catalog.all') || course.category === selectedCategory
    const query = searchQuery.trim().toLocaleLowerCase('ru')
    return matchesCategory && (!query || `${course.title} ${course.description} ${course.author}`.toLocaleLowerCase('ru').includes(query))
  }), [courses, selectedCategory, searchQuery])

  return (
    <section className="page-wrap catalog-page">
      <div className="catalog-header"><p className="eyebrow">{t('catalog.eyebrow')}</p><h1>{t('catalog.title')}</h1><p className="catalog-lead">{t('catalog.lead')}</p></div>
      <div className="catalog-controls">
        <div className="search-box"><span className="search-icon">🔍</span><input type="search" placeholder={t('catalog.searchPlaceholder')} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="search-input" aria-label={t('catalog.searchLabel')} />{searchQuery ? <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')} aria-label={t('catalog.clearSearch')}>✕</button> : null}</div>
        <div className="category-pills" role="group" aria-label={t('catalog.filterLabel')}>{categories.map((category) => <button key={category} type="button" className={`category-pill ${selectedCategory === category ? 'active' : ''}`} onClick={() => setSelectedCategory(category)}>{category}</button>)}</div>
      </div>
      {error && <div className="notification-banner error" role="alert">{error}</div>}
      <div className="catalog-results-info"><span>{t('catalog.found')} <strong>{filteredCourses.length}</strong></span></div>
      {loading ? <p>{t('common.loadingCatalog')}</p> : filteredCourses.length > 0 ? (
        <div className="course-grid">{filteredCourses.map((course) => <CourseCard course={course} key={course.id} />)}</div>
      ) : (
        <div className="empty-catalog-state"><span className="empty-icon">📂</span><h3>{t('catalog.emptyTitle')}</h3><p>{t('catalog.emptyDescription')}</p><button type="button" className="button button-small" onClick={() => { setSelectedCategory(t('catalog.all')); setSearchQuery('') }}>{t('catalog.reset')}</button></div>
      )}
    </section>
  )
}
