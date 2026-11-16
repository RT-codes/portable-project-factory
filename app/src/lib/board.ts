import { BLOCKED, DROPPED, type Config, type Job, type Stage } from './types'

/** How a stage reads at a glance. Kinds follow from config.json, so a new stage needs no code: a stage that names a
 * role is an agent's, one that runs something (the checks) is a script's. */
export type Tone = 'idle' | 'agent' | 'script' | 'done' | 'blocked' | 'dropped'

export function toneOf(stage: Stage | undefined, key: string, first: string): Tone {
  if (key === BLOCKED) return 'blocked'
  if (key === DROPPED) return 'dropped'
  if (!stage || key === first) return 'idle'
  if (stage.terminal) return 'done'
  if (stage.run) return 'script'
  if (stage.role) return 'agent'
  return 'idle'
}

export const toneText: Record<Tone, string> = {
  idle: 'text-muted-foreground',
  agent: 'text-glow',
  script: 'text-tone-sky',
  done: 'text-tone-green',
  blocked: 'text-tone-amber',
  dropped: 'text-muted-foreground',
}

export const toneChip: Record<Tone, string> = {
  idle: 'bg-muted text-muted-foreground',
  agent: 'bg-primary/15 text-primary',
  script: 'bg-tone-sky/15 text-tone-sky',
  done: 'bg-tone-green/15 text-tone-green',
  blocked: 'bg-tone-amber/15 text-tone-amber',
  dropped: 'bg-muted text-muted-foreground',
}

export const BLOCKED_STAGE: Stage = {
  key: BLOCKED,
  label: 'Needs you',
  icon: 'hand',
  description: 'Parked until you answer, unblock or drop it.',
}
export const DROPPED_STAGE: Stage = { key: DROPPED, label: 'Dropped', icon: 'archive-x', description: 'Closed without being done.' }

export function stageOf(config: Config, key: string): Stage | undefined {
  if (key === BLOCKED) return BLOCKED_STAGE
  if (key === DROPPED) return DROPPED_STAGE
  return config.stages.find((s) => s.key === key)
}

export interface Column {
  stage: Stage
  tone: Tone
  jobs: Job[]
}

/** The board: every configured stage in order, with "Needs you" after the working stages and before the terminal one. */
export function columns(config: Config, jobs: Job[]): Column[] {
  const first = config.stages[0]?.key ?? ''
  const newest = (a: Job, b: Job) => b.updated_at.localeCompare(a.updated_at)
  const col = (stage: Stage): Column => ({
    stage,
    tone: toneOf(stage, stage.key, first),
    jobs: jobs.filter((j) => j.stage === stage.key).sort(newest),
  })
  const working = config.stages.filter((s) => !s.terminal).map(col)
  const terminal = config.stages.filter((s) => s.terminal).map(col)
  return [...working, col(BLOCKED_STAGE), ...terminal]
}

/** A ticket an agent or script is working on right now (not waiting in the inbox, on a human, or finished). */
export function isActive(config: Config, job: Job): boolean {
  const stage = config.stages.find((s) => s.key === job.stage)
  return !!stage && !stage.terminal && stage.key !== config.stages[0]?.key
}
