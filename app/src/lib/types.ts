// The factory's files as the app reads them: .factory/config.json (the team's, committed), .factory/local.json (one
// user's overrides, not committed) and .factory/jobs/<id>/job.json (written by the factory's CLI).

export interface Stage {
  key: string
  label: string
  icon?: string
  description?: string
  /** the role whose agent works this stage */
  role?: Role
  /** 'checks': the stage runs the configured checks instead of an agent */
  run?: string
  output?: string
  terminal?: boolean
  starts_round?: boolean
  next?: Record<string, string | null>
}

export const ROLES = ['planner', 'builder', 'reviewer'] as const
export type Role = (typeof ROLES)[number]

/** Which model a role runs on, and how hard it thinks. "default" leaves the choice to the agent CLI. */
export interface RoleSettings {
  model: string
  effort: string
}

/**
 * A role's settings as stored: for any agent, and a part per agent. Model names belong to an agent ("sonnet"
 * means nothing to Codex), so the app saves per agent; the plain fields are what a hand-written config may hold.
 */
export type RoleConfig = Partial<RoleSettings> & { claude?: Partial<RoleSettings>; codex?: Partial<RoleSettings> }

export interface Config {
  name?: string
  base_branch: string
  concurrency: number
  max_rounds: number
  /** a ticket that finishes lands in the base branch at once (off unless set) */
  auto_land?: boolean
  /** shell commands the check stage runs; empty when none are configured yet */
  checks?: string[]
  check_timeout_s?: number
  roles?: Partial<Record<Role, RoleConfig>>
  /** how much of the journal an agent is handed: the latest entries in full, and more by title */
  journal?: { recent: number; titles: number }
  stages: Stage[]
}

/** The agent CLI that runs the stages: null lets the factory pick the one it finds. */
export type AgentCli = 'claude' | 'codex' | null

/** .factory/local.json: one user's choices, which win over config.json field by field. */
export interface LocalSettings {
  agent?: AgentCli
  roles?: Partial<Record<Role, RoleConfig>>
}

export interface Activity {
  at: string
  kind: 'created' | 'moved' | 'check' | 'note' | 'blocked' | 'dropped' | string
  text: string
  from?: string
  to?: string
  result?: string
  /** on a stage an agent ran (kind 'agent'): which role, and what really ran it */
  role?: string
  agent?: string
  /** the model the run resolved to, as the agent CLI reported it ("claude-sonnet-5-5"), not the alias asked for */
  model?: string
  effort?: string
  turns?: number
  /** the price of the run's tokens at API rates: on a subscription, a measure of usage rather than a bill */
  cost_usd?: number
  tokens?: number
  /** the tokens by kind, when the agent reports them apart */
  input?: number
  cache_read?: number
  cache_write?: number
  output?: number
  /** on a run: the stage and round it was, and how long it took */
  stage?: string
  round?: number
  secs?: number
}

export interface JobFile {
  path: string
  size: number
  mtime: number
}

/** One thing a stage did, read from its log while it runs: a file read, an edit, a command. */
export type StepKind = 'read' | 'edit' | 'run' | 'search' | 'say' | 'think' | 'other'

export interface LiveStep {
  /** null when the log does not date its lines (Codex, the checks) */
  at: string | null
  kind: StepKind
  /** "Reading src/cart.ts" */
  text: string
  /** a command's own words, or the last line it printed */
  detail?: string
}

/**
 * What is happening on a ticket right now. The app works this out from files the factory already writes: the
 * run's own file (is a run alive?) and the stage's log (what did the agent just do?).
 *  - running: a run is alive and this ticket is in a stage it works
 *  - queued: a run is alive, and the ticket waits in the first stage for a free slot
 *  - stalled: the ticket is in a working stage, and no run is working it
 *  - waiting: a run is alive and holds it until a usage limit resets (or the agent's service answers again)
 */
export interface Live {
  state: 'running' | 'queued' | 'stalled' | 'waiting'
  /** when the stage's work started; null when not known */
  since: string | null
  agent?: string
  model?: string
  turns?: number
  tokens?: number
  /** the latest step: what it is doing now */
  step: LiveStep | null
  /** the latest steps, oldest first */
  steps: LiveStep[]
  /** the stage's log, in the ticket folder */
  log?: string
}

export interface WorkFile {
  path: string
  additions: number
  deletions: number
  /** changed in the worktree, in no commit yet */
  uncommitted: boolean
}

/** What a ticket's worktree holds against the base branch: commits made, and the files that differ (committed or not). */
export interface Work {
  head: string | null
  commits: number
  additions: number
  deletions: number
  /** files that are changed and not committed yet */
  uncommitted: number
  files: WorkFile[]
}

export interface Job {
  id: string
  number: number
  title: string
  stage: string
  round: number
  created_at: string
  updated_at: string
  branch?: string
  worktree?: string
  blocked_from?: string
  blocked_reason?: string
  /** set when the ticket's branch was brought into the base branch: its worktree and branch are gone then */
  landed?: { at: string; sha: string; into: string }
  activity: Activity[]
  files: JobFile[]
  /** added by the app, not in job.json: absent when nothing is expected to happen on the ticket */
  live?: Live
  /** added by the app for a ticket that has a worktree: empty once its branch is merged */
  work?: Work
}

export interface RunInfo {
  pid: number
  started_at: string
  /** the one ticket the run was asked to work, when it was */
  ticket: string | null
  /** the run is alive and holding its work: a usage limit was reached, or the agent's service did not answer */
  waiting?: { until: string; reason: string }
}

export interface FactoryState {
  config: Config
  jobs: Job[]
  /** the run that is alive now, if any */
  run: RunInfo | null
}

/** The two stages every factory has besides the configured ones. */
export const BLOCKED = 'blocked'
export const DROPPED = 'dropped'
