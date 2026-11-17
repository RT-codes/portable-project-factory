import type { Route, View } from './app.svelte'

// The main area as tiles, the way a tiling window manager lays out windows: a tree of splits whose leaves are
// panels, each showing a view of its own. A split divides its space in two, side by side ('row') or one above the
// other ('col'), at a ratio. Panels are drawn from the rectangles the tree works out, not as nested boxes, so a
// panel keeps its state (and glides) when it is moved to another place in the tree.

export interface PaneNode {
  kind: 'pane'
  id: string
  /** null: an empty panel, offering the views to open */
  route: Route | null
}

export interface SplitNode {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  /** the share of the space the first child takes, 0 to 1 */
  ratio: number
  a: Node
  b: Node
}

export type Node = PaneNode | SplitNode

/** A rectangle as fractions of the whole area. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'left' | 'right' | 'top' | 'bottom'

export const MAX_PANES = 8
const VIEWS: View[] = ['home', 'board', 'activity', 'changes', 'pulls', 'issues', 'code', 'history', 'journal', 'usage', 'agents', 'edit', 'guide', 'models', 'settings']
const STORE = 'factory-layout:'

// ids count up, so sorting panels by id is the order they were made in
let seq = 0
const newId = () => `n${String(++seq).padStart(6, '0')}`
const pane = (route: Route | null): PaneNode => ({ kind: 'pane', id: newId(), route })

function leaves(node: Node, out: PaneNode[] = []): PaneNode[] {
  if (node.kind === 'pane') out.push(node)
  else {
    leaves(node.a, out)
    leaves(node.b, out)
  }
  return out
}

/** The split a node hangs under, and which child it is. */
function parentOf(root: Node, id: string): { split: SplitNode; key: 'a' | 'b' } | null {
  if (root.kind === 'pane') return null
  for (const key of ['a', 'b'] as const) {
    if (root[key].id === id) return { split: root, key }
    const deeper = parentOf(root[key], id)
    if (deeper) return deeper
  }
  return null
}

function rects(node: Node, rect: Rect, panes: Map<string, Rect>, splits: Map<string, Rect>) {
  if (node.kind === 'pane') {
    panes.set(node.id, rect)
    return
  }
  splits.set(node.id, rect)
  const { dir, ratio } = node
  const a = dir === 'row' ? { ...rect, w: rect.w * ratio } : { ...rect, h: rect.h * ratio }
  const b = dir === 'row' ? { ...rect, x: rect.x + a.w, w: rect.w - a.w } : { ...rect, y: rect.y + a.h, h: rect.h - a.h }
  rects(node.a, a, panes, splits)
  rects(node.b, b, panes, splits)
}

/** A route read back from storage: only what a route can hold. */
function cleanRoute(raw: unknown): Route | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Route>
  if (!VIEWS.includes(r.view as View)) return null
  const route: Route = { view: r.view as View }
  if (r.sub === 'pulls' || r.sub === 'issues') route.sub = r.sub
  if (Number.isInteger(r.number) && r.number! > 0) route.number = r.number
  if (typeof r.path === 'string') route.path = r.path
  if (typeof r.rev === 'string') route.rev = r.rev
  const s = r.source
  if (s && typeof s.base === 'string' && typeof s.head === 'string') route.source = { base: s.base, head: s.head, ...(typeof s.title === 'string' ? { title: s.title } : {}) }
  return route
}

function cleanNode(raw: unknown, budget: { left: number }): Node | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Partial<SplitNode> & Partial<PaneNode>
  if (n.kind === 'pane') {
    if (budget.left-- <= 0) return null
    return pane(cleanRoute(n.route))
  }
  if (n.kind !== 'split') return null
  const a = cleanNode(n.a, budget)
  const b = cleanNode(n.b, budget)
  if (!a || !b) return a ?? b
  const ratio = typeof n.ratio === 'number' && n.ratio > 0.05 && n.ratio < 0.95 ? n.ratio : 0.5
  return { kind: 'split', id: newId(), dir: n.dir === 'col' ? 'col' : 'row', ratio, a, b }
}

class Layout {
  root = $state<Node>(pane(null))
  activeId = $state('')
  /** the panel being dragged to another place (with Alt held) */
  dragging = $state<string | null>(null)
  #project: string | null = null
  /** the panel each panel last opened something beside itself in: it is used again rather than splitting anew */
  #beside = new Map<string, string>()

  panes = $derived(leaves(this.root))
  /**
   * The panels in an order that never changes while they live. They are drawn in this order: a panel that moves in
   * the tree then only changes its rectangle, and is not taken out of the page and put back (which would lose its
   * scroll positions and cut its glide short).
   */
  drawn = $derived([...this.panes].sort((a, b) => a.id.localeCompare(b.id)))
  active = $derived(this.panes.find((p) => p.id === this.activeId) ?? this.panes[0])
  single = $derived(this.panes.length === 1)
  canSplit = $derived(this.panes.length < MAX_PANES)
  geometry = $derived.by(() => {
    const panes = new Map<string, Rect>()
    const splits = new Map<string, Rect>()
    rects(this.root, { x: 0, y: 0, w: 1, h: 1 }, panes, splits)
    return { panes, splits }
  })
  /** every split, for its resize handle */
  splits = $derived.by(() => {
    const out: SplitNode[] = []
    const walk = (n: Node) => {
      if (n.kind !== 'split') return
      out.push(n)
      walk(n.a)
      walk(n.b)
    }
    walk(this.root)
    return out
  })

  constructor() {
    this.activeId = this.root.id
  }

  /** The layout of a project: as it was left, or one panel showing `fallback`. */
  load(project: string | null, fallback: Route) {
    this.#project = project
    let root: Node | null = null
    let activeIndex = 0
    try {
      const saved = project ? JSON.parse(localStorage.getItem(STORE + project) ?? 'null') : null
      if (saved) {
        root = cleanNode(saved.root, { left: MAX_PANES })
        activeIndex = Number.isInteger(saved.active) ? saved.active : 0
      }
    } catch {
      /* unreadable: start over */
    }
    this.root = root ?? pane(fallback)
    this.activeId = (this.panes[activeIndex] ?? this.panes[0]).id
  }

  focus(id: string) {
    if (this.activeId !== id && this.panes.some((p) => p.id === id)) {
      this.activeId = id
      this.save()
    }
  }

  /** Show a view in a panel (the active one unless told otherwise). */
  go(route: Route, id = this.active.id) {
    const target = this.panes.find((p) => p.id === id)
    if (!target) return
    target.route = route
    this.save()
  }

  /**
   * Split a panel in two and make the new, empty half the active one.
   * 'row' puts the new panel to the right, 'col' below.
   */
  split(dir: 'row' | 'col', id = this.active.id, route: Route | null = null): string | null {
    if (!this.canSplit) return null
    const target = this.panes.find((p) => p.id === id)
    if (!target) return null
    const fresh = pane(route)
    this.#replace(id, { kind: 'split', id: newId(), dir, ratio: 0.5, a: $state.snapshot(target) as PaneNode, b: fresh })
    this.activeId = fresh.id
    this.save()
    return fresh.id
  }

  /**
   * Show a view next to a panel: in an empty panel if there is one, else in a new split along the panel's longer
   * side (as a tiling window manager places a new window), or the way `dir` says ('col': below, 'row': right).
   */
  openBeside(route: Route, id = this.active.id, dir?: 'row' | 'col') {
    const again = this.#beside.get(id)
    const reuse = this.panes.find((p) => p.id === again) ?? this.panes.find((p) => p.route === null && p.id !== id)
    if (reuse) {
      reuse.route = route
      this.#beside.set(id, reuse.id)
      this.activeId = reuse.id
      this.save()
      return
    }
    const rect = this.geometry.panes.get(id)
    // the area is wider than tall, so equal fractions mean a wide panel: split it side by side
    const made = this.split(dir ?? (rect && rect.h > rect.w * 1.2 ? 'col' : 'row'), id, route)
    if (made) this.#beside.set(id, made)
    else this.go(route, id)
  }

  /** Close a panel: its neighbour takes the room. The last panel stays. */
  close(id = this.active.id) {
    const parent = parentOf(this.root, id)
    if (!parent) return
    const sibling = parent.split[parent.key === 'a' ? 'b' : 'a']
    this.#replace(parent.split.id, $state.snapshot(sibling) as Node)
    if (this.activeId === id || !this.panes.some((p) => p.id === this.activeId)) {
      // focus goes to what filled the gap: the nearest panel of the neighbour
      const next = leaves(sibling)
      this.activeId = (parent.key === 'a' ? next[0] : next.at(-1))!.id
    }
    this.save()
  }

  /** Turn the split a panel is in: side by side becomes stacked, and back. */
  rotate(id = this.active.id) {
    const parent = parentOf(this.root, id)
    if (!parent) return
    parent.split.dir = parent.split.dir === 'row' ? 'col' : 'row'
    this.save()
  }

  /** Swap the two halves of the split a panel is in. */
  swap(id = this.active.id) {
    const parent = parentOf(this.root, id)
    if (!parent) return
    const { a, b } = $state.snapshot(parent.split) as SplitNode
    parent.split.a = b
    parent.split.b = a
    parent.split.ratio = 1 - parent.split.ratio
    this.save()
  }

  setRatio(splitId: string, ratio: number) {
    const split = this.splits.find((s) => s.id === splitId)
    if (split) split.ratio = Math.min(0.9, Math.max(0.1, ratio))
  }

  /** Take a panel out of its place and put it on one side of another panel. */
  move(id: string, targetId: string, side: Side) {
    if (id === targetId) return
    const moving = this.panes.find((p) => p.id === id)
    const parent = parentOf(this.root, id)
    if (!moving || !parent || !this.panes.some((p) => p.id === targetId)) return
    const moved = $state.snapshot(moving) as PaneNode
    // already there: the two share a split, in that order and direction
    const dir = side === 'left' || side === 'right' ? 'row' : 'col'
    const first = side === 'left' || side === 'top'
    const sibling = parent.split[parent.key === 'a' ? 'b' : 'a']
    if (sibling.id === targetId && parent.split.dir === dir && (parent.key === 'a') === first) return
    this.#replace(parent.split.id, $state.snapshot(sibling) as Node)
    const target = $state.snapshot(this.panes.find((p) => p.id === targetId)!) as PaneNode
    this.#replace(targetId, { kind: 'split', id: newId(), dir, ratio: 0.5, a: first ? moved : target, b: first ? target : moved })
    this.activeId = id
  }

  /** The panel next to the active one in a direction, if there is one: for moving focus with the keyboard. */
  neighbour(side: Side, id = this.active.id): string | null {
    const from = this.geometry.panes.get(id)
    if (!from) return null
    const eps = 1e-6
    let best: { id: string; overlap: number } | null = null
    for (const [other, r] of this.geometry.panes) {
      if (other === id) continue
      const touches =
        side === 'left' ? Math.abs(r.x + r.w - from.x) < eps : side === 'right' ? Math.abs(r.x - (from.x + from.w)) < eps : side === 'top' ? Math.abs(r.y + r.h - from.y) < eps : Math.abs(r.y - (from.y + from.h)) < eps
      if (!touches) continue
      const overlap = side === 'left' || side === 'right' ? Math.min(r.y + r.h, from.y + from.h) - Math.max(r.y, from.y) : Math.min(r.x + r.w, from.x + from.w) - Math.max(r.x, from.x)
      if (overlap > eps && (!best || overlap > best.overlap)) best = { id: other, overlap }
    }
    return best?.id ?? null
  }

  save() {
    if (!this.#project) return
    try {
      localStorage.setItem(STORE + this.#project, JSON.stringify({ root: this.root, active: this.panes.findIndex((p) => p.id === this.activeId) }))
    } catch {
      /* the layout then lasts for this visit */
    }
  }

  #replace(id: string, node: Node) {
    if (this.root.id === id) {
      this.root = node
      return
    }
    const parent = parentOf(this.root, id)
    if (parent) parent.split[parent.key] = node
  }
}

export const layout = new Layout()
