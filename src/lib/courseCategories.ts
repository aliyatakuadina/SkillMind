const STORAGE_KEY = 'skillmind.custom-categories'

export const courseCategoryGroups: { group: string; items: string[] }[] = [
  {
    group: 'Искусство и гуманитарные науки',
    items: ['История', 'Музыка и искусство', 'Философия', 'Литература'],
  },
  {
    group: 'Бизнес',
    items: ['Лидерство и управление', 'Финансы', 'Маркетинг', 'Предпринимательство', 'Бизнес-стратегия', 'Основы бизнеса'],
  },
  {
    group: 'Информатика',
    items: ['Разработка программного обеспечения', 'Мобильная и веб-разработка', 'Алгоритмы', 'Безопасность и сети', 'Дизайн и продукт'],
  },
  {
    group: 'Наука о данных',
    items: ['Анализ данных', 'Машинное обучение', 'Вероятность и статистика'],
  },
  {
    group: 'Информационные технологии',
    items: ['Облачные вычисления', 'Информационная безопасность', 'Управление данными', 'Сети', 'Поддержка и эксплуатация'],
  },
  {
    group: 'Здоровье',
    items: ['Здоровье животных', 'Фундаментальные науки', 'Медицинская информатика', 'Управление здравоохранением', 'Питание', 'Уход за пациентами', 'Общественное здоровье', 'Исследования в здоровье', 'Психология'],
  },
  {
    group: 'Математика и логика',
    items: ['Математика', 'Логика'],
  },
  {
    group: 'Личностное развитие',
    items: ['Коммуникация', 'Карьера', 'Личная эффективность'],
  },
  {
    group: 'Естественные науки и инженерия',
    items: ['Электротехника', 'Машиностроение', 'Химия', 'Науки об окружающей среде', 'Физика и астрономия', 'Методы исследований'],
  },
  {
    group: 'Социальные науки',
    items: ['Экономика', 'Образование', 'Общество и управление', 'Право'],
  },
  {
    group: 'Изучение языков',
    items: ['Английский язык', 'Другие языки'],
  },
]

export function builtinCategories() {
  return courseCategoryGroups.flatMap((group) => group.items)
}

export function readCustomCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  } catch {
    return []
  }
}

export function rememberCategory(name: string) {
  const trimmed = name.trim()
  if (!trimmed || builtinCategories().includes(trimmed)) return readCustomCategories()
  const next = [...new Set([trimmed, ...readCustomCategories()])].slice(0, 40)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
