// The contract between the desktop app's main process (electron/) and its renderer (src/).
// Every method takes plain JSON and returns plain JSON, so it crosses the IPC bridge unchanged.
// The main process implements `Api`; the renderer calls it through `window.factoryApp` (see electron/preload.ts).

import type { FactoryState, LocalSettings, Role, RoleSettings } from '../src/lib/types'

// ---------------------------------------------------------------- projects

export interface Project {
  path: string
  name: string
}

export interface GithubRepo {
  owner: string
  repo: string
  url: string
  defaultBranch: string
  /** the login `gh` is signed in as */
  viewer: string
  /** WRITE, MAINTAIN or ADMIN: may merge and close */
  canWrite: boolean
}

export interface ProjectInfo extends Project {
  isGit: boolean
  /** the checked-out branch, null when detached or not a repo */
  branch: string | null
  hasFactory: boolean
  github: GithubRepo | null
  /** why `github` is null, in words a person can act on */
  githubError: string | null
}

export interface ProjectList {
  recent: Project[]
  current: string | null
}

// ---------------------------------------------------------------- git

/** The uncommitted state of the checkout, usable wherever a revision is. */
export const WORKTREE = 'WORKTREE'

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed'

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del'
  /** 1-based line number in the old file (null for an added line) */
  old: number | null
  /** 1-based line number in the new file (null for a deleted line) */
  new: number | null
  text: string
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** what git prints after the second @@: usually the enclosing function */
  section: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  /** the path before a rename */
  oldPath: string | null
  status: FileStatus
  binary: boolean
  additions: number
  deletions: number
  hunks: Hunk[]
  /** the diff was left out because it is huge; additions and deletions still count it */
  tooLarge: boolean
}

export interface Commit {
  sha: string
  subject: string
  author: string
  date: string
}

export interface Compare {
  /** what the old side of every file is read from (the merge base) */
  base: string
  /** what the new side is read from: a commit, or WORKTREE */
  head: string
  files: DiffFile[]
  commits: Commit[]
}

export interface FileContent {
  /** null when the file is binary, missing or too large to show */
  text: string | null
  binary: boolean
  missing: boolean
  size: number
}

export interface TreeFile {
  path: string
  /** uncommitted state, only for the WORKTREE tree */
  change?: 'modified' | 'added' | 'deleted' | 'untracked'
}

export interface Branch {
  name: string
  sha: string
  current: boolean
  date: string
}

/** Which refs a history starts from: what is checked out, the local branches, the remote ones, or everything. */
export type HistoryScope = 'head' | 'local' | 'remote' | 'all'

export interface Ref {
  /** "main", "origin/main", "v1.2" */
  name: string
  kind: 'branch' | 'remote' | 'tag'
  /** the branch HEAD points at */
  head?: boolean
}

export interface LogCommit {
  sha: string
  parents: string[]
  subject: string
  author: string
  date: string
  refs: Ref[]
  /** HEAD is here without a branch (a detached checkout) */
  detachedHead?: boolean
}

export interface Worktree {
  path: string
  /** the folder's name */
  name: string
  /** null when detached or bare */
  branch: string | null
  head: string | null
  /** the worktree the app has open */
  current: boolean
  detached: boolean
  bare: boolean
  locked: boolean
  /** its folder is gone */
  prunable: boolean
  /** uncommitted files; null when it could not be read */
  changes: number | null
}

/** A file or folder the Agents view manages: under .claude/, an instruction file at the root, the factory's rules, roles and pipeline. */
export interface AgentEntry {
  path: string
  dir: boolean
  size: number
  mtime: number
}

/** What a save leaves on disk: handed back with the next save, so a change made by someone else is noticed. */
export interface Saved {
  mtime: number
  size: number
}

export interface AgentFile extends Saved {
  path: string
  /** null when the file is not text the app can edit */
  text: string | null
  reason: 'binary' | 'large' | null
  /** the factory needs it where it is: it can be edited, not renamed or deleted */
  fixed: boolean
}

/** The tree of a commit with nothing in it: the base to compare a first commit against. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface GraphNode {
  path: string
  /** changed: part of the diff. dependent: imports a changed file. dependency: imported by a changed file. */
  kind: 'changed' | 'dependent' | 'dependency'
  /** dependents of this changed file that were left out to keep the graph readable */
  hiddenDependents?: number
}

export interface GraphEdge {
  /** the importing file */
  from: string
  /** the imported file */
  to: string
}

export interface ImportGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** the project around the change: every file in it and the changed files, to draw as a map (sorted) */
  files: string[]
  /** how long the files that were read are, in lines, by path: the source files and the changed ones */
  lines: Record<string, number>
  /** project files left off the map to keep it readable: the ones furthest from the change */
  hiddenFiles: number
  /** source files read to build it */
  scanned: number
  /** the repo has more source files than the scan reads, so some dependents may be missing */
  partial: boolean
}

/** What the repo knows of a commit a journal entry names. `full` is null when the commit is not here. */
export interface CommitFacts {
  /** as the entry wrote it, often abbreviated */
  sha: string
  full: string | null
  /** its first parent, null for a first commit */
  parent: string | null
  subject: string | null
}

// ---------------------------------------------------------------- the factory's journal and settings

export const JOURNAL_KINDS = ['feature', 'fix', 'refactor', 'chore', 'decision'] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

export interface JournalSection {
  /** "What changed", "Why", "Decisions", "Watch out" */
  heading: string
  /** markdown */
  body: string
}

/** One run of an agent on one stage of a ticket, and what it took. */
export interface UsageRun {
  ticket: string
  title: string
  /** open: on the board; done: finished here, not merged; merged: only its journal entry is left; dropped; deleted */
  state: 'open' | 'done' | 'merged' | 'dropped' | 'deleted'
  /** ISO time: when the run ended (for a ticket known only from the journal: when its entry was written) */
  at: string
  stage: string
  round: number
  agent: string
  model: string
  /** the stage's verdict (READY, PASS, CHANGES), ERROR for a run that failed, WAIT for one stopped by a limit */
  result: string
  secs: number
  turns: number
  /** tokens, by kind: one read from the cache costs about a tenth of a fresh one */
  input: number
  cache_read: number
  cache_write: number
  output: number
  /** tokens of a run that only reported a total (Codex, and runs recorded before the kinds were kept apart) */
  unsplit: number
  /** at API prices, as the agent reported it: 0 when it did not (Codex) */
  cost_usd: number
}

/** One entry of .factory/journal/: why something changed, written when a ticket finished (or by hand). */
export interface JournalEntry {
  id: string
  /** ISO time */
  at: string
  title: string
  /** one of JOURNAL_KINDS, or whatever the entry says */
  kind: string
  ticket: string | null
  branch: string | null
  commits: string[]
  files: string[]
  tags: string[]
  /** role -> "agent:model" */
  by: Record<string, string>
  sections: JournalSection[]
  /** the entry's file, from the repo's root */
  path: string
}

/** One line of the factory's own health check (`cli.mjs doctor --json`). */
export interface DoctorItem {
  id: string
  ok: boolean
  /** what it found, or what to do */
  text: string
}

export interface Doctor {
  /** empty when the factory could not be asked (not installed, or its CLI failed: see `error`) */
  items: DoctorItem[]
  error: string | null
  /** the version in .factory/version, null when there is no factory */
  kitVersion: string | null
  /** this app's version */
  appVersion: string
}

/** The model and effort of each role: the team's defaults (config.json) and this user's overrides (local.json). */
export interface ModelSettings {
  /** the team's default for each role on each agent, from config.json */
  team: Record<Role, Record<Agent, RoleSettings>>
  local: LocalSettings
  /** the last time each role ran on each agent: the exact model it resolved to and what the run took */
  lastRuns: Partial<Record<Role, Partial<Record<Agent, LastRun>>>>
  /** the models each agent CLI offers on this machine, and what its "default" is */
  catalog: Record<Agent, AgentCatalog>
}

export type Agent = 'claude' | 'codex'

/** One model that can be picked for a role. */
export interface ModelOption {
  /** what is saved and handed to the agent CLI: a short name ("sonnet") or a full model id */
  value: string
  /** the name with its version: "Sonnet 5.5", "GPT-6.1-Sol" */
  label: string
  /** the exact model id it means today, when known */
  id: string | null
  note: string | null
}

export interface AgentCatalog {
  /** false when the CLI's own model list could not be read: the list then holds only the names that always work */
  known: boolean
  models: ModelOption[]
  /** what a role set to "default" runs on, when the CLI's settings say */
  defaultModel: { id: string; label: string } | null
  defaultEffort: string | null
  /** the effort levels this CLI's models take, lowest first */
  efforts: string[]
}

export interface LastRun {
  agent: string
  /** as the agent CLI reported it: "claude-sonnet-5-5", "gpt-6.1-sol" */
  model: string
  effort: string | null
  turns: number | null
  tokens: number | null
  /** at API prices; null when the agent does not report it */
  costUsd: number | null
  at: string
  ticket: string
}

// ---------------------------------------------------------------- github

export interface Actor {
  login: string
  avatarUrl: string
}

export interface Label {
  name: string
  /** hex without the # */
  color: string
}

export interface Comment {
  /** REST id, what a reply refers to */
  id: number
  author: Actor
  body: string
  createdAt: string
  url: string
}

export interface IssueSummary {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  author: Actor
  labels: Label[]
  comments: number
  createdAt: string
  updatedAt: string
  url: string
}

export interface Issue extends IssueSummary {
  body: string
  /** COMPLETED, NOT_PLANNED... */
  stateReason: string | null
  thread: Comment[]
}

export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL'

export interface PullSummary {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  draft: boolean
  author: Actor
  labels: Label[]
  baseRef: string
  headRef: string
  additions: number
  deletions: number
  changedFiles: number
  comments: number
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED */
  reviewDecision: string | null
  checks: CheckState | null
  createdAt: string
  updatedAt: string
  url: string
}

export interface Check {
  name: string
  state: CheckState
  url: string | null
}

export interface Review {
  author: Actor
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED */
  state: string
  body: string
  submittedAt: string
  url: string
}

export type Side = 'LEFT' | 'RIGHT'

export interface ReviewThread {
  /** GraphQL node id, what resolving refers to */
  id: string
  path: string
  /** line in the current diff; null when the thread is outdated or on the whole file */
  line: number | null
  side: Side
  resolved: boolean
  outdated: boolean
  comments: Comment[]
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface Pull extends PullSummary {
  body: string
  baseSha: string
  headSha: string
  /** MERGEABLE, CONFLICTING, UNKNOWN */
  mergeable: string
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT... */
  mergeState: string
  mergeMethods: MergeMethod[]
  checkList: Check[]
  reviews: Review[]
  thread: Comment[]
  threads: ReviewThread[]
}

export interface Page<T> {
  items: T[]
  /** pass back as `after` for the next page; null on the last */
  next: string | null
  total: number
}

export interface ListQuery {
  state: 'open' | 'closed'
  /** free text, GitHub search syntax allowed */
  search?: string
  after?: string | null
}

export interface DraftComment {
  path: string
  line: number
  side: Side
  body: string
}

export interface ReviewInput {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  body: string
  comments: DraftComment[]
  /** the head commit the comments were written against */
  commitId: string
}

// ---------------------------------------------------------------- the api

export interface Api {
  projects(): Promise<ProjectList>
  /** ask for a folder; null when cancelled */
  openProject(): Promise<Project | null>
  selectProject(path: string): Promise<void>
  forgetProject(path: string): Promise<void>
  projectInfo(project: string): Promise<ProjectInfo>

  /** null when the repo has no factory installed */
  factoryState(project: string): Promise<FactoryState | null>
  factoryFile(project: string, job: string, path: string): Promise<string>
  /** installs the factory into the repo from the copy the app carries; resolves to what the installer printed */
  factoryInstall(project: string): Promise<string>
  /** files a ticket through the repo's factory CLI; resolves to its id */
  factoryCreate(project: string, title: string, body: string): Promise<string>
  /** starts a run of the factory in the background: it works every open ticket until none is left to work */
  factoryRun(project: string): Promise<void>
  /** stops the run; tickets stay where they are, and the next run takes them up again */
  factoryPause(project: string): Promise<void>
  /**
   * brings a finished ticket into the base branch (the base is merged into it and the checks run first); resolves
   * to what happened, in a sentence: it landed, or it went back to the pipeline and why
   */
  factoryLand(project: string, job: string): Promise<string>
  /** removes a ticket for good, with its worktree and branch; the journal records it, with the reason */
  factoryDelete(project: string, job: string, reason: string): Promise<void>
  /** the journal's entries, newest first; empty when there is none. Entries that cannot be read are left out. */
  journal(project: string): Promise<JournalEntry[]>
  /** every agent run the factory knows of: the tickets on this machine, and the journal's record of the others */
  usage(project: string): Promise<UsageRun[]>
  /** the factory's health check, run through its CLI */
  doctor(project: string): Promise<Doctor>
  modelSettings(project: string): Promise<ModelSettings>
  /** replaces .factory/local.json (and nothing else) with `local`, after checking its shape; resolves to what was written */
  saveLocalSettings(project: string, local: LocalSettings): Promise<LocalSettings>

  branches(project: string): Promise<Branch[]>
  tree(project: string, rev: string): Promise<TreeFile[]>
  file(project: string, rev: string, path: string): Promise<FileContent>
  /** `head` against its merge base with `base`. `head` may be WORKTREE. */
  compare(project: string, base: string, head: string): Promise<Compare>
  importGraph(project: string, rev: string, changed: string[]): Promise<ImportGraph>
  /** commits reachable from the scope's refs, newest first, parents after children */
  history(project: string, scope: HistoryScope, limit: number): Promise<LogCommit[]>
  worktrees(project: string): Promise<Worktree[]>
  /** a commit's whole message */
  commitMessage(project: string, sha: string): Promise<string>
  /** whether these commits are here, and their parents */
  commitFacts(project: string, shas: string[]): Promise<CommitFacts[]>

  issues(project: string, query: ListQuery): Promise<Page<IssueSummary>>
  issue(project: string, number: number): Promise<Issue>
  issueCreate(project: string, title: string, body: string): Promise<number>
  /** also comments on a pull request's conversation */
  issueComment(project: string, number: number, body: string): Promise<void>
  issueSetState(project: string, number: number, state: 'open' | 'closed'): Promise<void>

  pulls(project: string, query: ListQuery): Promise<Page<PullSummary>>
  pull(project: string, number: number): Promise<Pull>
  /** fetches the pull request's commits into the local repo and diffs them */
  pullCompare(project: string, number: number): Promise<Compare>
  pullReview(project: string, number: number, review: ReviewInput): Promise<void>
  pullReply(project: string, number: number, inReplyTo: number, body: string): Promise<void>
  pullResolve(project: string, threadId: string, resolved: boolean): Promise<void>
  pullMerge(project: string, number: number, method: MergeMethod, headSha: string): Promise<void>

  agentFiles(project: string): Promise<AgentEntry[]>
  agentRead(project: string, path: string): Promise<AgentFile>
  /** `expected`: the mtime last seen, or null for a file that must not exist yet. Rejects with "conflict: ..." when the file changed on disk. */
  agentWrite(project: string, path: string, text: string, expected: number | null, force?: boolean): Promise<Saved>
  agentMkdir(project: string, path: string): Promise<void>
  agentRename(project: string, from: string, to: string): Promise<void>
  /** to the system's trash */
  agentDelete(project: string, path: string): Promise<void>
  /** in the app the system opens such a file with */
  agentOpen(project: string, path: string): Promise<void>
  /** in the system's file manager */
  agentReveal(project: string, path: string): Promise<void>

  openExternal(url: string): Promise<void>
}

export type ApiMethod = keyof Api
