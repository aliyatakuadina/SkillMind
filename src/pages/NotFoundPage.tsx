import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="page-wrap empty-page">
      <p className="eyebrow">Ошибка 404</p>
      <h1>Страница не найдена</h1>
      <p>Возможно, она была перемещена или адрес введен с ошибкой.</p>
      <div className="not-found-actions">
        <Link className="button" to="/courses">
          Перейти в каталог курсов
        </Link>
        <Link className="button button-muted" to="/">
          На главную
        </Link>
      </div>
    </section>
  )
}
