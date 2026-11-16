import type { DiffFile, DiffLine, Hunk, Side } from '$shared/api'

// Turning a file's hunks into the rows the diff viewer draws: unified or side by side, with the unchanged
// stretches between hunks folded into gaps that can be opened.

export interface LineRow {
  type: 'line'
  line: DiffLine
  /** part of the diff GitHub knows (a hunk line): only these can carry a review comment */
  inHunk: boolean
  /** the changed part of the line, as a character range */
  mark: [number, number] | null
}

export interface GapRow {
  type: 'gap'
  /** stable per file: the index of the hunk the gap comes before (hunks.length for the tail) */
  id: number
  /** hidden lines, as line numbers in the new file */
  from: number
  count: number
  /** old line number = new line number - shift */
  shift: number
  /** there is a hunk above / below to grow from */
  above: boolean
  below: boolean
}

export interface HunkRow {
  type: 'hunk'
  section: string
}

export type Row = LineRow | GapRow | HunkRow

export interface SplitRow {
  type: 'pair'
  left: LineRow | null
  right: LineRow | null
}

/** How much of each gap is open: lines revealed below the hunk above it, and above the hunk below it. */
export type Expanded = Record<number, { top: number; bottom: number }>

export const EXPAND_STEP = 25

/** Where a comment on this line attaches: deletions on the old side, everything else on the new. */
export function anchorOf(line: DiffLine): { side: Side; line: number } {
  return line.kind === 'del' ? { side: 'LEFT', line: line.old! } : { side: 'RIGHT', line: line.new! }
}

export const anchorKey = (side: Side, line: number) => `${side}:${line}`

// git gives a hunk with no lines on one side the line *before* it as its start
const oldStart = (h: Hunk) => (h.oldLines === 0 ? h.oldStart + 1 : h.oldStart)
const newStart = (h: Hunk) => (h.newLines === 0 ? h.newStart + 1 : h.newStart)

/** The changed span of a line pair: what is left between their common start and common end. */
function changedSpan(a: string, b: string): [[number, number], [number, number]] | null {
  const max = Math.min(a.length, b.length)
  let pre = 0
  while (pre < max && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  // lines with nothing but indentation in common are different lines, not an edit of one
  const common = a.slice(0, pre).trim().length + a.slice(a.length - suf).trim().length
  if (common < 3 || common < Math.min(a.trim().length, b.trim().length) * 0.4) return null
  return [
    [pre, a.length - suf],
    [pre, b.length - suf],
  ]
}

function hunkRows(hunk: Hunk): LineRow[] {
  const rows: LineRow[] = hunk.lines.map((line) => ({ type: 'line', line, inHunk: true, mark: null }))
  // within a run of deletions followed by additions, the nth deletion and nth addition are one edited line
  for (let i = 0; i < rows.length; ) {
    if (rows[i].line.kind !== 'del') {
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d].line.kind === 'del') d++
    let a = d
    while (a < rows.length && rows[a].line.kind === 'add') a++
    for (let k = 0; k < Math.min(d - i, a - d); k++) {
      const span = changedSpan(rows[i + k].line.text, rows[d + k].line.text)
      if (span) {
        rows[i + k].mark = span[0]
        rows[d + k].mark = span[1]
      }
    }
    i = a
  }
  return rows
}

/**
 * The file as unified rows. `newLines` is the new file's text by line (null until loaded): opened gaps are drawn
 * from it, and the gap after the last hunk only exists once the file's length is known.
 */
export function unifiedRows(file: DiffFile, expanded: Expanded, newLines: string[] | null): Row[] {
  const rows: Row[] = []
  const reveal = (from: number, count: number, shift: number) => {
    for (let n = from; n < from + count; n++) {
      rows.push({ type: 'line', line: { kind: 'ctx', old: n - shift, new: n, text: newLines?.[n - 1] ?? '' }, inHunk: false, mark: null })
    }
  }
  const gap = (id: number, from: number, count: number, shift: number, above: boolean, below: boolean) => {
    if (count <= 0) return
    const open = newLines ? (expanded[id] ?? { top: 0, bottom: 0 }) : { top: 0, bottom: 0 }
    const top = Math.min(open.top, count)
    const bottom = Math.min(open.bottom, count - top)
    reveal(from, top, shift)
    if (count - top - bottom > 0) rows.push({ type: 'gap', id, from: from + top, count: count - top - bottom, shift, above, below })
    reveal(from + count - bottom, bottom, shift)
  }
  let next = 1 // the first new-file line not yet drawn
  file.hunks.forEach((hunk, i) => {
    const start = newStart(hunk)
    gap(i, next, start - next, start - oldStart(hunk), i > 0, true)
    if (hunk.section && (i > 0 || start > 1)) rows.push({ type: 'hunk', section: hunk.section })
    rows.push(...hunkRows(hunk))
    next = start + hunk.newLines
  })
  const last = file.hunks.at(-1)
  if (last && newLines && file.status !== 'deleted') {
    // a file ending in a newline splits into one empty string too many
    const total = newLines.at(-1) === '' ? newLines.length - 1 : newLines.length
    gap(file.hunks.length, next, total - next + 1, newStart(last) + last.newLines - (oldStart(last) + last.oldLines), true, false)
  }
  return rows
}

/** Unified rows side by side: deletions on the left, the additions that replace them on the right. */
export function splitRows(rows: Row[]): (SplitRow | GapRow | HunkRow)[] {
  const out: (SplitRow | GapRow | HunkRow)[] = []
  for (let i = 0; i < rows.length; ) {
    const row = rows[i]
    if (row.type !== 'line') {
      out.push(row)
      i++
      continue
    }
    if (row.line.kind === 'ctx') {
      out.push({ type: 'pair', left: row, right: row })
      i++
      continue
    }
    const dels: LineRow[] = []
    const adds: LineRow[] = []
    for (let r = rows[i]; r?.type === 'line' && r.line.kind === 'del'; r = rows[++i]) dels.push(r)
    for (let r = rows[i]; r?.type === 'line' && r.line.kind === 'add'; r = rows[++i]) adds.push(r)
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ type: 'pair', left: dels[k] ?? null, right: adds[k] ?? null })
  }
  return out
}

/** Files nobody reviews line by line: collapsed until asked for. */
export function isGenerated(path: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$|\.snap$|(^|\/)(dist|vendor)\//.test(
    path
  )
}
