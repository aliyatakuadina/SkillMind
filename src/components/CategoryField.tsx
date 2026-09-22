import { useMemo, useState } from 'react'
import { courseCategoryGroups, readCustomCategories, rememberCategory } from '../lib/courseCategories'
import { t } from '../i18n'

export function CategoryField({
  value,
  onChange,
}: {
  value: string
  onChange: (category: string) => void
}) {
  const [query, setQuery] = useState('')
  const [customName, setCustomName] = useState('')
  const [custom, setCustom] = useState<string[]>(() => readCustomCategories())
  const needle = query.trim().toLocaleLowerCase('ru')

  const groups = useMemo(() => courseCategoryGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !needle || `${group.group} ${item}`.toLocaleLowerCase('ru').includes(needle)),
    }))
    .filter((group) => group.items.length > 0), [needle])

  const customVisible = custom.filter((item) => !needle || item.toLocaleLowerCase('ru').includes(needle))

  const addCustom = () => {
    const name = customName.trim()
    if (name.length < 2 || name.length > 80) return
    const next = rememberCategory(name)
    setCustom(next)
    setCustomName('')
    onChange(name)
  }

  return (
    <div className="builder-category">
      <label className="builder-field">
        {t('builder.categorySearch')}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('builder.categorySearchPlaceholder')} />
      </label>
      <label className="builder-field">
        {t('builder.category')}
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {value && !customVisible.includes(value) && !groups.some((group) => group.items.includes(value)) ? <option value={value}>{value}</option> : null}
          {customVisible.length > 0 ? (
            <optgroup label={t('builder.myCategories')}>
              {customVisible.map((item) => <option key={item} value={item}>{item}</option>)}
            </optgroup>
          ) : null}
          {groups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => <option key={item} value={item}>{item}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="builder-category-create">
        <label className="builder-field">
          {t('builder.newCategory')}
          <input value={customName} maxLength={80} onChange={(event) => setCustomName(event.target.value)} placeholder={t('builder.newCategoryPlaceholder')} />
        </label>
        <button className="button button-muted" type="button" onClick={addCustom} disabled={customName.trim().length < 2}>{t('builder.addCategory')}</button>
      </div>
    </div>
  )
}
