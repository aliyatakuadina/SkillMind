const ID = /^[A-Za-z0-9_-]{11}$/

export function parseYoutubeId(value: string): string | null {
  const raw = value.trim()
  if (ID.test(raw)) return raw
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
      return ID.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const fromQuery = url.searchParams.get('v')
      if (fromQuery && ID.test(fromQuery)) return fromQuery
      const parts = url.pathname.split('/').filter(Boolean)
      if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') && parts[1] && ID.test(parts[1])) {
        return parts[1]
      }
    }
  } catch {
    return null
  }
  return null
}

export function youtubeEmbedUrl(videoId: string, start?: number) {
  const seconds = Math.max(0, Math.floor(start ?? 0))
  const query = seconds > 0 ? `?start=${seconds}` : ''
  return `https://www.youtube-nocookie.com/embed/${videoId}${query}`
}
