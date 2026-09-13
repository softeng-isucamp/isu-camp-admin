export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
export const nowLabel = () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
export const formatDateTime = (value?: string | null) => {
  if (!value?.trim()) return '—'

  const normalized = value.replace(/\s·\s/g, ' ').trim()
  if (normalized === 'Just now') return normalized

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
}
