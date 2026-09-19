import { ru } from './ru'

export type TranslationKey = keyof typeof ru

export function t(key: TranslationKey, values?: Record<string, string | number>): string {
  const message = ru[key]
  if (!values) return message
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
    message as string,
  )
}

