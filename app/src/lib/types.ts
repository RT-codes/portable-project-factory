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
}

export interface JobFile {
  path: string
  size: number
  mtime: number
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
  activity: Activity[]
  files: JobFile[]
}

export interface FactoryState {
  config: Config
  jobs: Job[]
}

/** The two stages every factory has besides the configured ones. */
export const BLOCKED = 'blocked'
export const DROPPED = 'dropped'
