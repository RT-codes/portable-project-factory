const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

/** "3 min ago", "yesterday" */
export function ago(iso: string | number, now = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const s = Math.round((t - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 45) return rtf.format(Math.round(s / 86400), 'day')
  if (abs < 86400 * 345) return rtf.format(Math.round(s / (86400 * 30.44)), 'month')
  return rtf.format(Math.round(s / (86400 * 365.25)), 'year')
}

export function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The verdict a stage file opens with (PASS, CHANGES, READY, BLOCKED...), read the way the factory's CLI reads it. */
export function verdictOf(text: string): string {
  for (let line of text.split('\n')) {
    line = line.replace(/^[#>*\s]+/, '').trim()
    if (!line) continue
    line = line.replace(/^(STATUS|VERDICT|RESULT)\s*:\s*/i, '')
    const m = line.match(/^[A-Za-z][A-Za-z_-]*/)
    return m ? m[0].toUpperCase() : ''
  }
  return ''
}
