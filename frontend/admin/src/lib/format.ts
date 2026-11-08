export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
export const formatDateTime = (value?: string | null) => {
  if (!value?.trim()) return '—'

  const normalized = value.replace(/\s·\s/g, ' ').trim()
  if (normalized === 'Just now') return normalized

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
}

/** Parses a timestamp the way `formatDateTime` does; null when it is not a real date ("Just now" included). */
const parseTimestamp = (value?: string | null) => {
  if (!value?.trim()) return null
  const date = new Date(value.replace(/\s·\s/g, ' ').trim())
  return Number.isNaN(date.getTime()) ? null : date
}

/** Compact local time for table rows, e.g. "Nov 3, 2026, 11:26 PM"; the zone is shown once by the caller. */
export const formatDateTimeCompact = (value?: string | null) => {
  const date = parseTimestamp(value)
  if (!date) return formatDateTime(value)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
}

/** The viewer's own zone as a short label (e.g. "GMT+8", "PST") and its IANA name, derived from the browser. */
export const viewerTimeZone = (at: Date = new Date()) => {
  const name = new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone
  const short = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? name
  return { short, name }
}

/** Full timestamp with seconds and the zone, for a tooltip, e.g. "November 3, 2026 at 11:26:05 PM GMT+8". */
export const formatDateTimeFull = (value?: string | null) => {
  const date = parseTimestamp(value)
  if (!date) return formatDateTime(value)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'long' }).format(date)
}

/** Machine-readable form for `<time dateTime>`; undefined when the value is not a real date. */
export const timestampIso = (value?: string | null) => parseTimestamp(value)?.toISOString()
