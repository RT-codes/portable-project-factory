import type { Activity, Job } from './types'

// How much a ticket, or anything else, took. Tokens are not all alike: one read from the cache costs about a
// tenth of a fresh one, and one written out about five times as much. So a ticket's size is told in tokens
// weighed by kind (as if all were fresh input), which is also what its cost follows.

interface Kinds {
  input?: number
  cache_read?: number
  cache_write?: number
  output?: number
}

/** Tokens weighed by what their kind costs next to fresh input. A total without kinds is taken as mostly cache reads. */
export function weigh(kinds: Kinds, unsplit = 0): number {
  return (kinds.input ?? 0) + (kinds.cache_write ?? 0) * 1.25 + (kinds.output ?? 0) * 5 + (kinds.cache_read ?? 0) * 0.1 + unsplit * 0.25
}

export type Weight = 'light' | 'medium' | 'heavy'
/** Where light ends and heavy begins, in weighed tokens: about $1 and $5 of a mid-priced model at API prices. */
export const MEDIUM_FROM = 300_000
export const HEAVY_FROM = 1_500_000

export interface TicketWeight {
  level: Weight
  weighed: number
  tokens: number
  cost_usd: number
  runs: number
}

/** How heavy a ticket has been so far: every agent run on it, and the one going on now. Null before the first. */
export function weightOf(job: Job): TicketWeight | null {
  let weighed = 0
  let tokens = 0
  let cost = 0
  let runs = 0
  for (const a of job.activity) {
    if (!(a as Activity & { by?: string }).by && !a.model) continue
    const split = (a.input ?? 0) + (a.cache_read ?? 0) + (a.cache_write ?? 0) + (a.output ?? 0)
    if (!split && !a.tokens) continue
    runs++
    tokens += split || (a.tokens ?? 0)
    weighed += weigh(a, split ? 0 : (a.tokens ?? 0))
    cost += a.cost_usd ?? 0
  }
  // the run going on now only has a total yet
  if (job.live?.state === 'running' && job.live.tokens) {
    runs++
    tokens += job.live.tokens
    weighed += weigh({}, job.live.tokens)
  }
  if (!runs) return null
  return { level: weighed >= HEAVY_FROM ? 'heavy' : weighed >= MEDIUM_FROM ? 'medium' : 'light', weighed, tokens, cost_usd: cost, runs }
}

export const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString()}`)
