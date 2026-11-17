import fs from 'node:fs/promises'
import path from 'node:path'
import type { Config, Job, Live, LiveStep, RunInfo, Work, WorkFile } from '../src/lib/types'
import { git } from './git'

// What is happening on a ticket right now, worked out from files the factory already writes. Nothing here asks the
// factory's CLI anything, and the CLI needs no change for it: the run's own file says whether a run is alive, the
// stage's log (round-N/<stage>.log, appended to while the agent works) says what the agent just did, and the
// ticket's worktree says how far the work is.

const MAX_STEPS = 40
const MAX_READ = 8 * 1024 * 1024
const MAX_TAILS = 200
const CLIP = 200

const clip = (s: string, n = CLIP) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const firstLine = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? ''

// ---------------------------------------------------------------- the run

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // not ours to signal, but there
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The run that is alive now: .factory/run/run.json, written by `run` and removed when it ends. */
export async function currentRun(factoryDir: string): Promise<RunInfo | null> {
  try {
    const info = JSON.parse(await fs.readFile(path.join(factoryDir, 'run', 'run.json'), 'utf8'))
    if (!Number.isInteger(info?.pid) || info.pid <= 0 || !isAlive(info.pid)) return null
    const ticket = Array.isArray(info.args) ? (info.args.find((a: unknown) => typeof a === 'string' && !a.startsWith('-')) ?? null) : null
    const until = typeof info.waiting?.until === 'string' && Date.parse(info.waiting.until) > Date.now() ? info.waiting.until : null
    return { pid: info.pid, started_at: String(info.started_at ?? ''), ticket, ...(until ? { waiting: { until, reason: String(info.waiting.reason ?? '') } } : {}) }
  } catch {
    return null
  }
}

/** Whether the run works this ticket: a run asked for one ticket (`run 3`) leaves the others alone. */
function worksOn(run: RunInfo | null, job: Job): boolean {
  if (!run) return false
  if (!run.ticket) return true
  return run.ticket === job.id || Number(run.ticket) === job.number || job.id.startsWith(`${run.ticket}-`)
}

// ---------------------------------------------------------------- a stage's log, read as it grows

interface Tail {
  /** the file's first bytes: a log written anew starts differently (its first line is dated) */
  head: string
  offset: number
  /** the bytes after the last whole line */
  rest: Buffer
  started: string | null
  agent: string | null
  cwd: string | null
  model: string | null
  /** tokens per message of the agent: one message arrives as several events with the same count */
  usage: Map<string, number>
  steps: LiveStep[]
  ended: boolean
  /** Codex prints blocks under a one-word line: which block the lines now belong to, and the one before it */
  block: string | null
  before: string | null
}

const tails = new Map<string, Tail>()

const fresh = (head: string): Tail => ({ head, offset: 0, rest: Buffer.alloc(0), started: null, agent: null, cwd: null, model: null, usage: new Map(), steps: [], ended: false, block: null, before: null })

function push(t: Tail, step: LiveStep) {
  t.steps.push(step)
  if (t.steps.length > MAX_STEPS) t.steps.splice(0, t.steps.length - MAX_STEPS)
}

/** A path as the reader knows it: inside the worktree, or inside the ticket's folder. */
function short(file: unknown, cwd: string | null): string {
  if (typeof file !== 'string' || !file) return 'a file'
  const p = file.replaceAll('\\', '/')
  const root = cwd?.replaceAll('\\', '/').replace(/\/+$/, '')
  // the ticket's own files read best by their name there: "plan.md", "round-1/review.md"
  const inJob = /\/\.factory\/jobs\/[^/]+\/(.+)$/.exec(p)
  if (inJob) return inJob[1]
  if (root && p.startsWith(root + '/')) return p.slice(root.length + 1)
  return p.split('/').slice(-3).join('/')
}

interface Block {
  type?: string
  name?: string
  text?: string
  thinking?: string
  input?: Record<string, unknown>
}

/** One step per thing the agent did in a message: its tool calls, and what it said. */
function claudeSteps(content: Block[], at: string | null, cwd: string | null): LiveStep[] {
  const steps: LiveStep[] = []
  for (const b of content) {
    const input = b.input ?? {}
    if (b.type === 'tool_use') {
      const file = short(input.file_path ?? input.notebook_path ?? input.path, cwd)
      if (b.name === 'Read') steps.push({ at, kind: 'read', text: `Reading ${file}` })
      else if (b.name === 'Edit' || b.name === 'MultiEdit' || b.name === 'NotebookEdit') steps.push({ at, kind: 'edit', text: `Editing ${file}` })
      else if (b.name === 'Write') steps.push({ at, kind: 'edit', text: `Writing ${file}` })
      else if (b.name === 'Bash') {
        const command = clip(firstLine(String(input.command ?? '')))
        const says = typeof input.description === 'string' ? clip(firstLine(input.description)) : ''
        steps.push({ at, kind: 'run', text: says || `Running ${command}`, ...(says && command ? { detail: command } : {}) })
      } else if (b.name === 'Grep') steps.push({ at, kind: 'search', text: `Searching for ${clip(String(input.pattern ?? ''), 80)}` })
      else if (b.name === 'Glob') steps.push({ at, kind: 'search', text: `Looking for ${clip(String(input.pattern ?? ''), 80)}` })
      else steps.push({ at, kind: 'other', text: `Using ${b.name ?? 'a tool'}` })
    } else if (b.type === 'text' && b.text?.trim()) {
      steps.push({ at, kind: 'say', text: clip(firstLine(b.text).replace(/^[#>*\s]+/, '').replace(/\*\*/g, '')) })
    } else if (b.type === 'thinking') {
      const about = firstLine(b.thinking ?? '').replace(/\*\*/g, '')
      steps.push({ at, kind: 'think', text: 'Thinking', ...(about ? { detail: clip(about) } : {}) })
    }
  }
  return steps
}

const CODEX_BLOCKS = new Set(['user', 'thinking', 'exec', 'codex', 'tokens used'])

function agentLine(t: Tail, line: string) {
  if (line.startsWith('[factory] ')) {
    const rest = line.slice(10)
    const header = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (\S+)/.exec(rest)
    if (header && !t.started) {
      t.started = header[1]
      t.agent = header[2]
    } else if (rest.startsWith('cwd: ')) t.cwd = rest.slice(5).trim()
    else if (rest.startsWith('exit ')) t.ended = true
    return
  }
  if (line.startsWith('{')) {
    let ev: { type?: string; subtype?: string; model?: unknown; timestamp?: unknown; message?: { id?: string; content?: unknown; usage?: Record<string, unknown> } }
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') t.model = ev.model
    if (ev.type !== 'assistant' || !ev.message) return
    const u = ev.message.usage
    if (u && ev.message.id) {
      const n = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, u.output_tokens].reduce<number>((sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0)
      t.usage.set(ev.message.id, n)
    }
    if (Array.isArray(ev.message.content)) for (const s of claudeSteps(ev.message.content as Block[], typeof ev.timestamp === 'string' ? ev.timestamp : null, t.cwd)) push(t, s)
    return
  }
  if (t.agent !== 'codex') return
  // Codex prints plain text: a header (model: ...), then blocks, each under a line that names it
  const text = line.trim()
  // its hooks and its own dated errors are not the agent's work
  if (!text || text.startsWith('hook: ') || /^\d{4}-\d\d-\d\dT\S+ (ERROR|WARN|INFO) /.test(text)) return
  const model = /^model: (.+)$/.exec(text)
  if (model && !t.block) {
    t.model = model[1].trim()
    return
  }
  if (CODEX_BLOCKS.has(text)) {
    t.before = t.block
    t.block = text
    if (text === 'thinking') push(t, { at: null, kind: 'think', text: 'Thinking' })
    return
  }
  const last = t.steps.at(-1)
  if (t.block === 'thinking' && last?.kind === 'think' && !last.detail) last.detail = clip(text.replace(/\*\*/g, ''))
  else if (t.block === 'exec') {
    // a command is printed with where it runs; an "exec" without that was a line of the prompt Codex echoes
    if (!/ in (?:\/|[A-Za-z]:\\)\S*$/.test(text)) {
      t.block = t.before
      return
    }
    // the command, then its output: only the command is a step
    // "/usr/bin/bash -lc 'npm test' in /the/worktree": the command is what was asked for
    const command = text
      .replace(/ in (?:\/|[A-Za-z]:\\)\S*$/, '')
      .replace(/^(?:\S*[\\/])?(?:bash|sh|zsh)(?:\.exe)? -lc /, '')
      .replace(/^(['"])(.*)\1$/, '$2')
    push(t, { at: null, kind: 'run', text: `Running ${clip(command)}` })
    t.block = 'output'
  } else if (t.block === 'tokens used') {
    const n = Number(text.replace(/[,.\s]/g, ''))
    if (Number.isFinite(n) && n > 0) t.usage.set('codex', n)
    t.block = null
  } else if (t.block === 'codex') {
    push(t, { at: null, kind: 'say', text: clip(text.replace(/^[#>*\s]+/, '').replace(/\*\*/g, '')) })
    t.block = 'said'
  }
}

function checksLine(t: Tail, line: string) {
  const text = line.trim()
  if (!text) return
  if (line.startsWith('$ ')) push(t, { at: null, kind: 'run', text: `Running ${clip(line.slice(2).trim())}` })
  else if (line.startsWith('[factory] ')) push(t, { at: null, kind: 'other', text: clip(line.slice(10).replace(/^./, (c) => c.toUpperCase())) })
  else {
    // what the command printed last says how far it is
    const last = t.steps.at(-1)
    if (last?.kind === 'run') last.detail = clip(text)
  }
}

/** Read what a log gained since the last look. Null when there is no log. */
async function readTail(file: string, kind: 'agent' | 'checks'): Promise<Tail | null> {
  let handle: fs.FileHandle
  try {
    handle = await fs.open(file, 'r')
  } catch {
    tails.delete(file)
    return null
  }
  try {
    const stat = await handle.stat()
    const headBuf = Buffer.alloc(Math.min(96, stat.size))
    await handle.read(headBuf, 0, headBuf.length, 0)
    const head = headBuf.toString('latin1')
    let t = tails.get(file)
    // written anew (a stage that runs again in the same round): start over
    // a log only grows: one that is shorter, or starts differently, was written anew (a stage that runs again in
    // the same round), and is read from the start
    if (!t || stat.size < t.offset || !head.startsWith(t.head)) {
      t = fresh(head)
      // the map keeps the logs being followed: the oldest go when it has grown far past any real number of them
      tails.delete(file)
      if (tails.size >= MAX_TAILS) tails.delete(tails.keys().next().value!)
      tails.set(file, t)
    } else t.head = head
    if (kind === 'checks' && !t.started) t.started = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString()
    while (t.offset < stat.size) {
      const chunk = Buffer.alloc(Math.min(MAX_READ, stat.size - t.offset))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, t.offset)
      if (bytesRead === 0) break
      t.offset += bytesRead
      const data = Buffer.concat([t.rest, chunk.subarray(0, bytesRead)])
      const end = data.lastIndexOf(0x0a)
      t.rest = end === -1 ? data : data.subarray(end + 1)
      if (end === -1) continue
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) (kind === 'agent' ? agentLine : checksLine)(t, line.replace(/\r$/, ''))
    }
    return t
  } finally {
    await handle.close()
  }
}

// ---------------------------------------------------------------- a ticket, live

/** Where a stage's log is, in the ticket's folder: the CLI's own naming. */
function logOf(config: Config, job: Job): { rel: string; kind: 'agent' | 'checks' } | null {
  const stage = config.stages.find((s) => s.key === job.stage)
  if (!stage) return null
  if (stage.run) return stage.output ? { rel: stage.output.replace('{round}', String(job.round)).replace(/\.md$/, '') + '.log', kind: 'checks' } : null
  if (stage.role) return { rel: `round-${job.round}/${stage.key}.log`, kind: 'agent' }
  return null
}

export async function liveOf(jobDir: string, job: Job, config: Config, run: RunInfo | null): Promise<Live | undefined> {
  const stage = config.stages.find((s) => s.key === job.stage)
  // blocked, dropped or finished: nothing is expected to happen
  if (!stage || stage.terminal) return undefined
  const working = worksOn(run, job)
  const log = logOf(config, job)
  if (!log || stage.key === config.stages[0]?.key) return working ? { state: 'queued', since: null, step: null, steps: [] } : undefined

  const entered = [...job.activity].reverse().find((a) => a.kind === 'moved' && a.to === job.stage)?.at ?? null
  let tail = await readTail(path.join(jobDir, log.rel), log.kind).catch(() => null)
  // a log from an earlier pass through this stage is not this pass's
  if (tail?.started && entered && Date.parse(tail.started) < Date.parse(entered) - 2000) tail = null
  const tokens = tail ? [...tail.usage.values()].reduce((a, b) => a + b, 0) : 0
  return {
    state: !working ? 'stalled' : run?.waiting ? 'waiting' : 'running',
    since: tail?.started ?? entered,
    ...(tail?.agent ? { agent: tail.agent } : {}),
    ...(tail?.model ? { model: tail.model } : {}),
    // a turn is a message of Claude's; Codex only says what the whole session took
    ...(tail && tail.usage.size ? { ...(tail.usage.has('codex') ? {} : { turns: tail.usage.size }), tokens } : {}),
    step: tail?.steps.at(-1) ?? null,
    steps: tail?.steps.slice() ?? [],
    ...(tail ? { log: log.rel } : {}),
  }
}

// ---------------------------------------------------------------- a ticket's worktree

const MAX_WORK_FILES = 200
const MAX_COUNTED = 30
const MAX_COUNT_SIZE = 400_000

const out = async (cwd: string, args: string[]) => {
  const r = await git(cwd, ['-c', 'core.quotepath=off', ...args], { allowFail: true, timeoutMs: 20_000 })
  return r.code === 0 ? r.stdout.toString('utf8') : null
}

/** How far a ticket's work is: its commits on top of the base branch, and every file that differs from it. */
export async function workOf(worktree: string, base: string): Promise<Work | undefined> {
  if (!(await fs.stat(worktree).catch(() => null))?.isDirectory()) return undefined
  const [head, fork, status] = await Promise.all([out(worktree, ['rev-parse', 'HEAD']), out(worktree, ['merge-base', base, 'HEAD']), out(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])])
  if (!head || !fork || status === null) return undefined
  const from = fork.trim()
  const [count, numstat] = await Promise.all([out(worktree, ['rev-list', '--count', `${from}..HEAD`]), out(worktree, ['diff', '--no-renames', '--numstat', from])])
  const files = new Map<string, WorkFile>()
  for (const line of (numstat ?? '').split('\n')) {
    const [a, d, ...rest] = line.split('\t')
    const file = rest.join('\t')
    if (!file) continue
    files.set(file, { path: file, additions: Number(a) || 0, deletions: Number(d) || 0, uncommitted: false })
  }
  const entries = status.split('\0')
  let counted = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    const code = e.slice(0, 2)
    const file = e.slice(3)
    // a rename is followed by the name it had
    if (code[0] === 'R' || code[0] === 'C') i++
    const known = files.get(file)
    if (known) known.uncommitted = true
    else if (code === '??') {
      // a new file git does not follow yet: all of it is new
      let additions = 0
      if (counted++ < MAX_COUNTED) {
        const full = path.join(worktree, file)
        const st = await fs.stat(full).catch(() => null)
        if (st?.isFile() && st.size <= MAX_COUNT_SIZE) {
          const data = await fs.readFile(full).catch(() => null)
          if (data && !data.subarray(0, 8000).includes(0)) additions = data.toString('utf8').split('\n').length - (data.at(-1) === 0x0a ? 1 : 0)
        }
      }
      files.set(file, { path: file, additions, deletions: 0, uncommitted: true })
    } else files.set(file, { path: file, additions: 0, deletions: 0, uncommitted: true })
  }
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
  return {
    head: head.trim(),
    commits: Number(count?.trim()) || 0,
    additions: list.reduce((n, f) => n + f.additions, 0),
    deletions: list.reduce((n, f) => n + f.deletions, 0),
    uncommitted: list.filter((f) => f.uncommitted).length,
    files: list.slice(0, MAX_WORK_FILES),
  }
}
