import type { DiffFile, ImportGraph } from '$shared/api'
import { basename, dirname } from './tree'

// Laying out the import graph of a change, left to right in the direction of "imports".
// On the left, a map of the project as a tree: every folder a box, its subfolders boxes inside it (indented, as
// in a file tree), its files chips under them. The chips of the changed files are lit, and the chips of files
// that import a changed file stand out. The map is one column, so a line from a chip to the right only leaves
// the folders the chip is in. In a big project, folders the change does not touch are folded to a line. On the right, the changed files in one
// column, and right of them the files they import. A changed file's chip is tied to its box in the column; a
// file that imports a changed file has an arrow from its chip to that file's box.

/** A file as a box: a changed file in the column, or a file a changed file imports, right of it. */
export interface Box {
  id: string
  path: string
  name: string
  dir: string
  kind: 'changed' | 'dependency'
  file: DiffFile | null
  /** files importing this one that have no arrow, to keep the graph readable */
  hidden: number
  x: number
  y: number
}

/** A file on the map of the project. */
export interface Chip {
  id: string
  path: string
  name: string
  /** changed: in the diff. dependent: imports a changed file. plain: the rest of the project. */
  role: 'changed' | 'dependent' | 'plain'
  file: DiffFile | null
  /** how long the file is, in lines, when that is known */
  lines: number | null
  x: number
  y: number
  w: number
  h: number
}

export interface Folder {
  /** the folder's whole path (the key); `label` is what it adds to the folder it is drawn in */
  dir: string
  label: string
  /** folded: the number of files in it, none of them drawn */
  folded: number | null
  /** how many folders it is inside of */
  depth: number
  x: number
  y: number
  w: number
  h: number
}

export interface Link {
  /** ids of the chip or box at each end */
  from: string
  to: string
  /** same: a changed file's chip to its own box. imports: the file at `from` imports the one at `to`. */
  kind: 'same' | 'imports'
  /** for 'same': the changed file, whose status colours the line */
  file: DiffFile | null
  d: string
}

export interface Layout {
  folders: Folder[]
  chips: Chip[]
  boxes: Box[]
  links: Link[]
  width: number
  height: number
  /** where the column of changed files is: what a fit keeps in sight when the whole does not fit */
  focus: { x: number; y: number; w: number; h: number }
}

export const BOX_W = 208
export const BOX_H = 44
export const CHIP_H = 24
export const FOLDER_HEAD = 22
const CHIP_GAP = 6
/** how wide the map is, and what a folder takes off that for what is inside it */
const MAP_W = 380
const INSET_LEFT = 14
const INSET_RIGHT = 8
const INSET_BOTTOM = 8
/** folders deeper than this are not indented further: their chips would get too narrow to read */
const MAX_INDENT = 6
/** a chip narrower than this gets the whole row */
const CHIP_MIN = 104
const ITEM_GAP = 6
/** with more files than this, the folders the change does not touch are folded */
const FOLD_OVER = 300
/** between the map and the changed files: room for the lines to fan out */
const GAP_MAP = 128
const GAP_X = 64
/** angular lines: the room between a lane and the boxes beside it */
const LANE_MARGIN = 22
const GAP_Y = 14
const PAD = 24

interface Dir {
  path: string
  label: string
  dirs: Map<string, Dir>
  files: string[]
  /** files in it and under it, and whether one of them is in the graph */
  count: number
  touched: boolean
}

const columnHeight = (count: number) => (count ? count * BOX_H + (count - 1) * GAP_Y : 0)

export interface LayoutOptions {
  /** leave the rest of the project off the map: only the changed files and the files that import them */
  affected: boolean
  /** show the files the changed files import, right of them */
  imports: boolean
  /** how much taller a long file's chip is than a short one's: 0 (all the same) to 1 */
  scale: number
  /** lines with square corners, running in lanes, instead of curves */
  angular: boolean
  /** angular: how far apart the lanes are, and the lines where they leave and arrive, in px; 0 lays them over each other */
  spacing: number
}

export const DEFAULT_OPTIONS: LayoutOptions = { affected: false, imports: true, scale: 0.4, angular: false, spacing: 4 }
/** the longest file's chip is this many times taller than the shortest's at full scale, plus one */
const SCALE_MAX = 2.5
/** a file that is longer than nearly all others does not make the rest look the same: this share sets the measure */
const SCALE_QUANTILE = 0.97

export function layout(graph: ImportGraph, files: DiffFile[], options: LayoutOptions = DEFAULT_OPTIONS): Layout {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const kinds = new Map(graph.nodes.map((n) => [n.path, n]))
  const changedPaths = graph.nodes.filter((n) => n.kind === 'changed').map((n) => n.path)
  const dependencyPaths = options.imports ? graph.nodes.filter((n) => n.kind === 'dependency').map((n) => n.path) : []

  // ---- the map: the project as a tree of folder boxes
  const touched = graph.nodes.filter((n) => n.kind !== 'dependency').map((n) => n.path)
  const mapped = (options.affected ? touched : [...new Set([...graph.files, ...graph.nodes.map((n) => n.path)])]).sort((a, b) => a.localeCompare(b))
  const dir = (path: string, label: string): Dir => ({ path, label, dirs: new Map(), files: [], count: 0, touched: false })
  const root = dir('', '')
  for (const path of mapped) {
    let at = root
    const parts = path.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      let next = at.dirs.get(parts[i])
      if (!next) at.dirs.set(parts[i], (next = dir(parts.slice(0, i + 1).join('/'), parts[i])))
      at = next
    }
    at.files.push(path)
  }
  const tally = (d: Dir) => {
    d.count = d.files.length
    d.touched = d.files.some((f) => kinds.has(f))
    for (const [key, child] of d.dirs) {
      // a folder that only holds one folder is drawn as one box: "src/lib"
      let c = child
      while (c.files.length === 0 && c.dirs.size === 1) {
        const only = [...c.dirs.values()][0]
        c = { ...only, label: `${c.label}/${only.label}` }
      }
      d.dirs.set(key, c)
      tally(c)
      d.count += c.count
      d.touched ||= c.touched
    }
  }
  tally(root)
  const folding = root.count > FOLD_OVER

  // a chip's height says how long the file is, against the long files of the project (the square root: a file
  // four times as long is twice as tall, so the short ones are not lost)
  const known = mapped.map((p) => graph.lines[p] ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
  const measure = known.length ? known[Math.min(known.length - 1, Math.floor(known.length * SCALE_QUANTILE))] : 0
  const chipHeight = (path: string) => {
    const lines = graph.lines[path] ?? 0
    if (!options.scale || !measure || !lines) return CHIP_H
    return Math.round(CHIP_H * (1 + options.scale * SCALE_MAX * Math.sqrt(Math.min(1, lines / measure))))
  }

  const folders: Folder[] = []
  const chips = new Map<string, Chip>()
  /** Draws what is in a folder from `y` down, and returns where it ends. */
  const fill = (d: Dir, x: number, y: number, w: number, depth: number): number => {
    for (const child of [...d.dirs.values()].sort((a, b) => a.label.localeCompare(b.label))) {
      const folder: Folder = { dir: child.path, label: child.label, folded: null, depth, x, y, w, h: FOLDER_HEAD }
      folders.push(folder)
      if (folding && !child.touched) folder.folded = child.count
      else {
        const inset = depth < MAX_INDENT
        const end = fill(child, x + (inset ? INSET_LEFT : 0), y + FOLDER_HEAD, w - (inset ? INSET_LEFT + INSET_RIGHT : 0), depth + 1)
        folder.h = end - ITEM_GAP + INSET_BOTTOM - y
      }
      y += folder.h + ITEM_GAP
    }
    const perRow = (w - CHIP_GAP) / 2 >= CHIP_MIN ? 2 : 1
    const chipW = (w - (perRow - 1) * CHIP_GAP) / perRow
    // the files fill the columns like bricks: each goes where there is room highest up (with chips of one height,
    // that is row by row)
    const ends = Array.from({ length: perRow }, () => y)
    for (const path of d.files) {
      const node = kinds.get(path)
      const column = ends.indexOf(Math.min(...ends))
      const h = chipHeight(path)
      chips.set(path, {
        id: `map:${path}`,
        path,
        name: basename(path),
        role: node?.kind === 'changed' ? 'changed' : node?.kind === 'dependent' ? 'dependent' : 'plain',
        file: byPath.get(path) ?? null,
        lines: graph.lines[path] ?? null,
        x: x + column * (chipW + CHIP_GAP),
        y: ends[column],
        w: chipW,
        h,
      })
      ends[column] += h + CHIP_GAP
    }
    return d.files.length ? Math.max(...ends) - CHIP_GAP + ITEM_GAP : y
  }
  const mapHeight = mapped.length ? fill(root, PAD, 0, MAP_W, 0) - ITEM_GAP : 0
  const mapWidth = mapped.length ? MAP_W : 0

  // ---- the changed files, in one column, in the order of their chips: their ties to the map then barely cross
  const where = (path: string) => {
    const chip = chips.get(path)
    return chip ? chip.y * 10_000 + chip.x : 0
  }
  const changed = changedPaths.sort((a, b) => where(a) - where(b) || a.localeCompare(b))
  const changedIndex = new Map(changed.map((p, i) => [p, i]))
  // the files they import: each as near as it can be to the files that import it
  const importers = new Map<string, number[]>()
  for (const e of graph.edges) {
    const i = changedIndex.get(e.from)
    if (i !== undefined && kinds.get(e.to)?.kind === 'dependency') importers.set(e.to, [...(importers.get(e.to) ?? []), i])
  }
  const mean = (path: string) => {
    const at = importers.get(path) ?? []
    return at.length ? at.reduce((a, b) => a + b, 0) / at.length : 0
  }
  const dependencies = dependencyPaths.sort((a, b) => mean(a) - mean(b) || a.localeCompare(b))

  const inner = Math.max(mapHeight, columnHeight(changed.length), columnHeight(dependencies.length))
  const height = inner + PAD * 2
  const top = (h: number) => PAD + (inner - h) / 2
  // the map was laid out from 0: centre it like the columns
  const mapTop = top(mapHeight)
  for (const f of folders) f.y += mapTop
  for (const c of chips.values()) c.y += mapTop

  // what the lines will be: known before anything on the right is placed, as angular lines need room for their lanes
  const wires: { from: string; to: string; kind: Link['kind'] }[] = []
  for (const path of changed) if (chips.has(path)) wires.push({ from: path, to: path, kind: 'same' })
  for (const e of graph.edges) {
    const to = kinds.get(e.to)?.kind
    if (to === 'changed' ? chips.has(e.from) : to === 'dependency' && options.imports && changedIndex.has(e.from)) wires.push({ from: e.from, to: e.to, kind: 'imports' })
  }
  const spacing = options.angular ? Math.max(0, options.spacing) : 0
  const intoChanged = wires.filter((w) => changedIndex.has(w.to)).length
  const gapMap = options.angular ? Math.max(96, LANE_MARGIN * 2 + intoChanged * spacing) : GAP_MAP
  const gapX = options.angular ? Math.max(GAP_X, LANE_MARGIN * 2 + (wires.length - intoChanged) * spacing) : GAP_X
  const changedX = PAD + (mapWidth ? mapWidth + gapMap : 0)
  const dependencyX = changedX + BOX_W + gapX
  const boxes = new Map<string, Box>()
  const column_ = (paths: string[], kind: Box['kind'], x: number, y0: number) => {
    paths.forEach((path, i) =>
      boxes.set(path, { id: `${kind}:${path}`, path, name: basename(path), dir: dirname(path), kind, file: byPath.get(path) ?? null, hidden: kinds.get(path)?.hiddenDependents ?? 0, x, y: y0 + i * (BOX_H + GAP_Y) })
    )
  }
  // The changed files sit level with the part of the map their lines come from, not with the middle of the whole
  // map: in a big project that could be a long way off. What they import sits level with them.
  const sources = wires.filter((w) => changedIndex.has(w.to)).flatMap((w) => chips.get(w.from) ?? [])
  const level = sources.length ? sources.reduce((sum, c) => sum + c.y + c.h / 2, 0) / sources.length : PAD + inner / 2
  const beside = (h: number) => Math.min(PAD + inner - h, Math.max(PAD, level - h / 2))
  const changedTop = beside(columnHeight(changed.length))
  column_(changed, 'changed', changedX, changedTop)
  column_(dependencies, 'dependency', dependencyX, beside(columnHeight(dependencies.length)))
  const width = (dependencies.length ? dependencyX + BOX_W : changedX + BOX_W) + PAD

  // ---- the lines
  // Each runs from the right edge of a chip or box to the left edge of a box.
  interface Run {
    wire: (typeof wires)[number]
    file: DiffFile | null
    fromId: string
    toId: string
    x1: number
    y1: number
    /** how far from the middle of its edge a line may leave or arrive */
    room1: number
    x2: number
    y2: number
    room2: number
    /** which gap it crosses: between the map and the changed files, or between them and what they import */
    gap: 'map' | 'imports'
  }
  const runs: Run[] = []
  for (const wire of wires) {
    const to = boxes.get(wire.to)!
    const chip = to.kind === 'changed' ? chips.get(wire.from)! : null
    const from = chip ? null : boxes.get(wire.from)!
    runs.push({
      wire,
      file: wire.kind === 'same' ? to.file : null,
      fromId: chip ? chip.id : from!.id,
      toId: to.id,
      x1: chip ? chip.x + chip.w : from!.x + BOX_W,
      y1: chip ? chip.y + chip.h / 2 : from!.y + BOX_H / 2,
      room1: (chip ? chip.h : BOX_H) / 2 - 5,
      x2: to.x,
      y2: to.y + BOX_H / 2,
      room2: BOX_H / 2 - 7,
      gap: chip ? 'map' : 'imports',
    })
  }
  const links: Link[] = []
  if (!options.angular) {
    for (const r of runs) {
      const bend = Math.max(36, (r.x2 - r.x1) / 2)
      links.push({ from: r.fromId, to: r.toId, kind: r.wire.kind, file: r.file, d: `M${r.x1},${r.y1} C${r.x1 + bend},${r.y1} ${r.x2 - bend},${r.y2} ${r.x2},${r.y2}` })
    }
  } else {
    // Lines that share an end are spread along that edge, in the order of their other ends, so they do not cross
    // on the way in or out; they are pressed closer when the edge is too short for them.
    const spread = (group: Run[], end: 1 | 2) => {
      const room = end === 1 ? group[0].room1 : group[0].room2
      const step = group.length > 1 ? Math.min(spacing, (room * 2) / (group.length - 1)) : 0
      group
        .sort((a, b) => (end === 1 ? a.y2 - b.y2 : a.y1 - b.y1))
        .forEach((r, i) => {
          const off = (i - (group.length - 1) / 2) * step
          if (end === 1) r.y1 += off
          else r.y2 += off
        })
    }
    const by = (key: (r: Run) => string) => {
      const groups = new Map<string, Run[]>()
      for (const r of runs) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
      return [...groups.values()]
    }
    // the far ends first: where the lines leave is then ordered by where they really arrive
    for (const group of by((r) => r.toId)) spread(group, 2)
    for (const group of by((r) => r.fromId)) spread(group, 1)
    // Each line turns in a lane of its own, counted from the right. Lines going down take the lanes first, the one
    // starting highest the rightmost; then the lines going up, the one starting lowest first. Lines of one
    // direction then never cross each other.
    for (const gap of ['map', 'imports'] as const) {
      const mine = runs.filter((r) => r.gap === gap)
      const level = (r: Run) => Math.abs(r.y2 - r.y1) < 0.5
      const down = mine.filter((r) => !level(r) && r.y2 > r.y1).sort((a, b) => a.y1 - b.y1)
      const up = mine.filter((r) => !level(r) && r.y2 < r.y1).sort((a, b) => b.y1 - a.y1)
      const right = (gap === 'map' ? changedX : dependencyX) - LANE_MARGIN
      const lane = new Map([...down, ...up].map((r, i) => [r, right - i * spacing]))
      for (const r of mine) {
        const x = lane.get(r) ?? (r.x1 + r.x2) / 2
        links.push({ from: r.fromId, to: r.toId, kind: r.wire.kind, file: r.file, d: `M${r.x1},${r.y1} L${x},${r.y1} L${x},${r.y2} L${r.x2},${r.y2}` })
      }
    }
  }

  return {
    folders,
    chips: [...chips.values()],
    boxes: [...boxes.values()],
    links,
    width,
    height,
    focus: { x: changedX, y: changedTop, w: BOX_W, h: columnHeight(changed.length) },
  }
}
