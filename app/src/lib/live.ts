import type { Live, StepKind, Work } from './types'

/** "42s", "2m 14s", "1h 05m": how long something has been going on. */
export function elapsed(since: string | number | null, now: number): string {
  if (since === null) return ''
  const t = typeof since === 'number' ? since : Date.parse(since)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** "840", "34.1K", "2.65M" */
export function count(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** A model's name without its maker: "claude-sonnet-5-5" reads "sonnet-5-5" on a card. */
export const shortModel = (model: string) => model.replace(/^claude-/, '')

/** What a ticket's state reads as when no step is known yet. */
export function liveWord(live: Live, stage: string): string {
  if (live.state === 'queued') return 'Queued'
  if (live.state === 'stalled') return 'Not running'
  return stage
}

export const stepTone: Record<StepKind, string> = {
  read: 'text-tone-sky',
  edit: 'text-tone-green',
  run: 'text-tone-amber',
  search: 'text-tone-sky',
  say: 'text-foreground/80',
  think: 'text-tone-violet',
  other: 'text-muted-foreground',
}

/** "2 commits · 3 files" */
export function workWords(work: Work): string {
  const parts: string[] = []
  if (work.commits) parts.push(`${work.commits} ${work.commits === 1 ? 'commit' : 'commits'}`)
  if (work.files.length) parts.push(`${work.files.length} ${work.files.length === 1 ? 'file' : 'files'}`)
  return parts.join(' · ')
}
