import type { JournalEntry } from '$shared/api'

// How the journal reads: a tone per kind of change, the gist of an entry, and the search over entries.

export const KIND_LABEL: Record<string, string> = { feature: 'Feature', fix: 'Fix', refactor: 'Refactor', chore: 'Chore', decision: 'Decision' }

const KIND_CHIP: Record<string, string> = {
  feature: 'bg-tone-green/15 text-tone-green',
  fix: 'bg-tone-rose/15 text-tone-rose',
  refactor: 'bg-tone-violet/15 text-tone-violet',
  chore: 'bg-muted text-muted-foreground',
  decision: 'bg-tone-sky/15 text-tone-sky',
}

export const kindChip = (kind: string) => KIND_CHIP[kind] ?? 'bg-muted text-muted-foreground'
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Note')

/** A section's text without its markdown: for a line or two of preview. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const section = (e: JournalEntry, heading: string) => e.sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())?.body ?? ''

/** Why it changed, in a sentence or two; what changed when the entry has no why. */
export const gist = (e: JournalEntry) => plain(section(e, 'Why') || section(e, 'What changed') || (e.sections[0]?.body ?? ''))

/** Every word of the query appears somewhere in the entry: its title, kind, tags, files, ticket or prose. */
export function matches(e: JournalEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [e.title, e.kind, e.id, e.ticket ?? '', e.branch ?? '', ...e.tags, ...e.files, ...e.sections.map((s) => `${s.heading}\n${s.body}`)].join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

export const month = (iso: string) => monthFmt.format(new Date(iso))
export const day = (iso: string) => dayFmt.format(new Date(iso))

/** Entries (newest first) in runs of the same month. */
export function byMonth(entries: JournalEntry[]): { month: string; entries: JournalEntry[] }[] {
  const out: { month: string; entries: JournalEntry[] }[] = []
  for (const e of entries) {
    const m = month(e.at)
    if (out.at(-1)?.month === m) out.at(-1)!.entries.push(e)
    else out.push({ month: m, entries: [e] })
  }
  return out
}
