import type { LogCommit } from '$shared/api'

// Drawing a commit history as a graph, the way `git log --graph` does: each row is a commit, each column a
// lane, and a lane is a line of history waiting for its next commit. Commits come children first.

export interface GraphRow {
  commit: LogCommit
  /** the lane the commit's dot sits in */
  lane: number
  /** lanes that run straight through this row, past the commit */
  through: number[]
  /** lanes that end in this commit, coming from above (its children) */
  from: number[]
  /** lanes its parents continue in, going down */
  to: number[]
}

export interface Graph {
  rows: GraphRow[]
  /** the widest the graph gets, in lanes */
  width: number
}

export function lanesOf(commits: LogCommit[]): Graph {
  // lanes[i] is the commit lane i is waiting for, or null when the lane is free
  const lanes: (string | null)[] = []
  const free = () => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }
  let width = 0
  const rows = commits.map((commit): GraphRow => {
    // every lane waiting for this commit ends here; the commit takes the leftmost of them
    const from = lanes.flatMap((sha, i) => (sha === commit.sha ? [i] : []))
    const lane = from[0] ?? free()
    const through = lanes.flatMap((sha, i) => (sha !== null && sha !== commit.sha ? [i] : []))
    for (const i of from) lanes[i] = null
    lanes[lane] = null
    const to = commit.parents.map((parent, n) => {
      // a parent some other lane already waits for: join that lane
      const waiting = lanes.indexOf(parent)
      if (waiting !== -1) return waiting
      // the first parent carries on in the commit's own lane; another parent (a merge) opens a lane
      const i = n === 0 ? lane : free()
      lanes[i] = parent
      return i
    })
    width = Math.max(width, lane + 1, ...through.map((i) => i + 1), ...to.map((i) => i + 1))
    return { commit, lane, through, from, to }
  })
  return { rows, width }
}

export const LANE_W = 16
export const ROW_H = 30
/** Lane colours, by lane number: the theme's status tones, in an order that keeps neighbours apart. */
export const LANE_COLORS = ['var(--glow)', 'var(--tone-sky)', 'var(--tone-green)', 'var(--tone-violet)', 'var(--tone-amber)', 'var(--tone-rose)']
export const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]

const x = (lane: number) => lane * LANE_W + LANE_W / 2
const MID = ROW_H / 2

/** The line from the top of a row (in lane `from`) to the commit's dot. */
export function pathIn(from: number, lane: number): string {
  if (from === lane) return `M${x(lane)},0 V${MID}`
  return `M${x(from)},0 C${x(from)},${MID * 0.8} ${x(lane)},${MID * 0.2} ${x(lane)},${MID}`
}

/** The line from the commit's dot to the bottom of the row (in lane `to`). */
export function pathOut(lane: number, to: number): string {
  if (to === lane) return `M${x(lane)},${MID} V${ROW_H}`
  return `M${x(lane)},${MID} C${x(lane)},${MID + MID * 0.8} ${x(to)},${MID + MID * 0.2} ${x(to)},${ROW_H}`
}

export const pathThrough = (lane: number) => `M${x(lane)},0 V${ROW_H}`
export const dotX = x
