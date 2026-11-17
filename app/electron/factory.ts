import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AgentCatalog, Doctor, DoctorItem, JournalEntry, JournalSection, LastRun, ModelOption, ModelSettings } from '../shared/api'
import { ROLES, type FactoryState, type Job, type JobFile, type LocalSettings, type Role, type RoleConfig, type RoleSettings, type Work } from '../src/lib/types'
import { run } from './exec'
import { currentRun, liveOf, workOf } from './live'

// The factory of a repo, as the app sees it: everything lives in .factory/. The app reads its files directly
// (config.json, jobs/, journal/), asks its CLI (.factory/cli.mjs) to file tickets and check its health, and writes
// one file of its own: .factory/local.json, this user's choice of models.

const MAX_FILE = 2_000_000
const MAX_ENTRY = 256 * 1024
const MAX_ENTRIES = 2000

const dirOf = (repo: string) => path.join(repo, '.factory')

async function jobFiles(dir: string): Promise<JobFile[]> {
  const files: JobFile[] = []
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'job.json' || entry.name.endsWith('.tmp')) continue
    const full = path.join(entry.parentPath, entry.name)
    const st = await fs.stat(full)
    files.push({ path: path.relative(dir, full).split(path.sep).join('/'), size: st.size, mtime: st.mtimeMs / 1000 })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function hasFactory(repo: string): Promise<boolean> {
  return fs.access(path.join(dirOf(repo), 'config.json')).then(
    () => true,
    () => false
  )
}

async function readConfig(repo: string) {
  try {
    return JSON.parse(await fs.readFile(path.join(dirOf(repo), 'config.json'), 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`.factory/config.json: ${(e as Error).message}`)
  }
}

// A worktree's state takes a few git calls to read. While a run is alive it is read at every look, because it is
// changing; a ticket that waits (blocked, or with no run) is read again only now and then.
const WORK_TTL_MS = 15_000
const worked = new Map<string, { at: number; work: Work | undefined }>()

async function work(worktree: string, base: string, running: boolean): Promise<Work | undefined> {
  const key = `${worktree}\n${base}`
  const had = worked.get(key)
  if (had && !running && Date.now() - had.at < WORK_TTL_MS) return had.work
  const now = await workOf(worktree, base).catch(() => undefined)
  if (worked.size > 500) worked.clear()
  worked.set(key, { at: Date.now(), work: now })
  return now
}

export async function factoryState(repo: string): Promise<FactoryState | null> {
  const config = await readConfig(repo)
  if (!config) return null
  const jobs: Job[] = []
  const jobsDir = path.join(dirOf(repo), 'jobs')
  const ids = await fs.readdir(jobsDir).catch(() => [] as string[])
  const live = await currentRun(dirOf(repo))
  await Promise.all(
    ids.sort().map(async (id) => {
      try {
        const job: Job = JSON.parse(await fs.readFile(path.join(jobsDir, id, 'job.json'), 'utf8'))
        job.files = await jobFiles(path.join(jobsDir, id))
        // what the app adds to a ticket: what is happening on it now, and how far its work is
        const [now, done] = await Promise.all([
          liveOf(path.join(jobsDir, id), job, config, live).catch(() => undefined),
          job.worktree ? work(path.join(repo, job.worktree), config.base_branch, !!live) : undefined,
        ])
        if (now) job.live = now
        if (done) job.work = done
        jobs.push(job)
      } catch {
        /* not a ticket folder, or mid-write: the next poll gets it */
      }
    })
  )
  jobs.sort((a, b) => a.id.localeCompare(b.id))
  return { config, jobs, run: live }
}

export async function factoryFile(repo: string, job: string, rel: string): Promise<string> {
  const jobsDir = path.resolve(dirOf(repo), 'jobs')
  const root = path.resolve(jobsDir, job)
  const target = path.resolve(root, rel)
  if (!job || path.dirname(root) !== jobsDir || !target.startsWith(root + path.sep)) throw new Error('not found')
  const data = await fs.readFile(target)
  return data.subarray(0, MAX_FILE).toString('utf8')
}

// ---------------------------------------------------------------- the CLI

/**
 * Run the repo's factory CLI. It is a Node script, and the app is Node too when asked (ELECTRON_RUN_AS_NODE), so
 * this works on a machine without Node installed.
 */
async function cli(repo: string, args: string[], opts: { input?: string; allowFail?: boolean; timeoutMs?: number } = {}) {
  const script = path.join(dirOf(repo), 'cli.mjs')
  if (!(await fs.stat(script).catch(() => null))?.isFile()) throw new Error("This repo's factory has no .factory/cli.mjs. Install it again to get one.")
  return run(process.execPath, [script, ...args], { cwd: repo, input: opts.input, allowFail: opts.allowFail, timeoutMs: opts.timeoutMs ?? 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
}

/**
 * Install the factory into a repo, from the installer and kit the app carries (so it works offline, before the
 * repo it would otherwise be fetched from is even reachable, and without Node on the machine). The installer is
 * the same one `npx` runs: it writes inside the repo only, asks nothing and needs no admin rights.
 */
export async function factoryInstall(repo: string, installer: string): Promise<string> {
  if (!(await fs.stat(installer).catch(() => null))?.isFile()) throw new Error('This copy of the app does not carry the installer. Use the command instead.')
  if (await hasFactory(repo)) throw new Error('This repo already has a factory.')
  const res = await run(process.execPath, [installer, repo], { cwd: repo, allowFail: true, timeoutMs: 60_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const out = res.stdout.toString('utf8').trim()
  // the installer says why it refused (not a git repo, say) on its last line
  if (res.code !== 0) throw new Error((res.stderr || out).trim().split('\n').at(-1)?.replace(/^(error|refused):\s*/i, '') || `the installer exited ${res.code}`)
  return out
}

/** File a ticket through the CLI, the only writer of ticket state. Resolves to the new ticket's id. */
export async function factoryCreate(repo: string, title: string, body: string): Promise<string> {
  if (typeof title !== 'string' || !title.trim()) throw new Error('a ticket needs a title')
  const res = await cli(repo, ['new', title.trim()], { input: typeof body === 'string' ? body : '' })
  return res.stdout.toString('utf8').trim().split('\n').at(-1)?.trim() ?? ''
}

/**
 * Ask the CLI to do something, and say why in its own words when it refuses. A factory older than the app may
 * not know the command: that is said as what it is, with what to do about it.
 */
async function act(repo: string, args: string[], timeoutMs?: number): Promise<string> {
  const res = await cli(repo, args, { allowFail: true, timeoutMs })
  if (res.code === 0) return res.stdout.toString('utf8').trim()
  const why = (res.stderr || res.stdout.toString('utf8')).trim().split('\n').find((l) => l.trim()) ?? `the factory's CLI exited ${res.code}`
  if (/unknown command/.test(why)) throw new Error(`This repo's factory is older than the app and cannot ${args[0]} yet. Update it: npx -y github:RT-codes/portable-project-factory --update`)
  throw new Error(why.replace(/^(error|refused):\s*/i, '').replace(/^./, (c) => c.toUpperCase()))
}

/** Start a run in the background. It outlives the app: closing the window does not stop the work. */
export async function factoryRun(repo: string): Promise<void> {
  await act(repo, ['run', '--detach'])
}

export async function factoryPause(repo: string): Promise<void> {
  await act(repo, ['cancel'])
}

/** Land a finished ticket. The checks may run on the way, so this can take as long as they do. */
export async function factoryLand(repo: string, job: string): Promise<string> {
  if (typeof job !== 'string' || !/^[\w.-]+$/.test(job)) throw new Error('not a ticket')
  const config = await readConfig(repo)
  const out = await act(repo, ['land', job], ((config?.check_timeout_s as number) || 1800) * 1000 + 120_000)
  // its last line says what happened, after the ticket's id
  return (out.split('\n').at(-1) ?? '').replace(/^[\w.-]+:\s*/, '').replace(/^./, (c) => c.toUpperCase())
}

export async function factoryDelete(repo: string, job: string, reason: string): Promise<void> {
  if (typeof job !== 'string' || !/^[\w.-]+$/.test(job)) throw new Error('not a ticket')
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('Say why: the journal keeps the reason.')
  await act(repo, ['delete', job, '-m', reason.trim()])
}

export async function doctor(repo: string, appVersion: string): Promise<Doctor> {
  // its first line is the version; what follows says where it was installed from
  const kitVersion = (await fs.readFile(path.join(dirOf(repo), 'version'), 'utf8').catch(() => null))?.split('\n')[0].trim().slice(0, 40) || null
  const out: Doctor = { items: [], error: null, kitVersion, appVersion }
  if (!(await hasFactory(repo))) return out
  try {
    // it exits non-zero when something is not ok; what it printed still says what
    const res = await cli(repo, ['doctor', '--json'], { allowFail: true, timeoutMs: 30_000 })
    const text = res.stdout.toString('utf8').trim()
    const json = JSON.parse(text.slice(text.indexOf('[')))
    if (!Array.isArray(json)) throw new Error('not a list')
    out.items = json
      .filter((i): i is DoctorItem => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.text === 'string')
      .slice(0, 50)
      .map((i) => ({ id: i.id, ok: i.ok === true, text: i.text.slice(0, 500) }))
    if (out.items.length === 0 && res.code !== 0) out.error = res.stderr.split('\n')[0] || `exit ${res.code}`
  } catch (e) {
    out.error = `The factory's health check failed: ${(e as Error).message}`
  }
  return out
}

// ---------------------------------------------------------------- the journal

/** A frontmatter value: JSON when it parses, the bare text when it does not. */
function value(raw: string): unknown {
  const t = raw.trim()
  if (!t) return ''
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null).slice(0, 500) : [])

/** One journal file as an entry, or null when it is not one (no frontmatter, no title, no time). */
export function parseEntry(text: string, file: string): JournalEntry | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return null
  const meta: Record<string, unknown> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):(.*)$/.exec(line)
    if (kv) meta[kv[1]] = value(kv[2])
  }
  const title = str(meta.title)
  const at = str(meta.at)
  if (!title || !at || Number.isNaN(Date.parse(at))) return null
  const by: Record<string, string> = {}
  if (meta.by && typeof meta.by === 'object' && !Array.isArray(meta.by)) {
    for (const [k, v] of Object.entries(meta.by as Record<string, unknown>).slice(0, 20)) if (str(v)) by[k] = str(v)!
  }
  // the body is markdown in sections, each under a "## " heading; anything above the first heading is kept too
  const sections: JournalSection[] = []
  let current: JournalSection | null = null
  for (const line of text.slice(m[0].length).split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      current = { heading: h[1], body: '' }
      sections.push(current)
    } else {
      if (!current) {
        if (!line.trim()) continue
        current = { heading: '', body: '' }
        sections.push(current)
      }
      current.body += line + '\n'
    }
  }
  for (const s of sections) s.body = s.body.trim()
  return {
    id: str(meta.id) ?? path.basename(file, '.md'),
    at: new Date(at).toISOString(),
    title,
    kind: (str(meta.kind) ?? '').toLowerCase(),
    ticket: str(meta.ticket),
    branch: str(meta.branch),
    commits: strings(meta.commits),
    files: strings(meta.files),
    tags: strings(meta.tags),
    by,
    sections: sections.filter((s) => s.heading || s.body),
    path: file,
  }
}

/** Every entry under .factory/journal/, newest first. One that cannot be read is skipped, not fatal. */
export async function journal(repo: string): Promise<JournalEntry[]> {
  const root = path.join(dirOf(repo), 'journal')
  const listed = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  const entries: JournalEntry[] = []
  for (const e of listed) {
    if (entries.length >= MAX_ENTRIES) break
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const full = path.join(e.parentPath, e.name)
    try {
      const st = await fs.stat(full)
      if (st.size > MAX_ENTRY) continue
      const rel = path.relative(repo, full).split(path.sep).join('/')
      const entry = parseEntry(await fs.readFile(full, 'utf8'), rel)
      if (entry) entries.push(entry)
    } catch {
      /* gone meanwhile, or unreadable */
    }
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}

// ---------------------------------------------------------------- models and effort

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]+-]{0,99}$/
/** an effort level is a short word; which ones exist is the agent CLI's to say (low, high, xhigh, max...) */
const EFFORT = /^[a-z]{2,12}$/
const AGENTS = ['claude', 'codex'] as const

function plainSettings(raw: unknown): Partial<RoleSettings> {
  const out: Partial<RoleSettings> = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (typeof r.model === 'string' && MODEL.test(r.model)) out.model = r.model
  if (typeof r.effort === 'string' && EFFORT.test(r.effort)) out.effort = r.effort
  return out
}

/** A role's settings as read: for any agent, and a part per agent. Whatever of it makes sense is kept. */
function roleSettings(raw: unknown): RoleConfig {
  const out: RoleConfig = plainSettings(raw)
  for (const agent of AGENTS) {
    const part = plainSettings((raw as Record<string, unknown> | null)?.[agent])
    if (Object.keys(part).length) out[agent] = part
  }
  return out
}

/** local.json as read: whatever of it makes sense, so a hand-edited file never breaks the view. */
function readLocal(raw: unknown): LocalSettings {
  const out: LocalSettings = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (r.agent === 'claude' || r.agent === 'codex') out.agent = r.agent
  if (r.roles && typeof r.roles === 'object') {
    for (const role of ROLES) {
      const s = roleSettings((r.roles as Record<string, unknown>)[role])
      if (Object.keys(s).length) (out.roles ??= {})[role] = s
    }
  }
  return out
}

export async function modelSettings(repo: string): Promise<ModelSettings> {
  const config = await readConfig(repo)
  if (!config) throw new Error('This repo has no factory.')
  // the team's default per role and agent: the part for that agent, else the part for any agent (as the CLI reads it)
  const team = {} as ModelSettings['team']
  for (const role of ROLES) {
    const s = roleSettings(config.roles?.[role])
    team[role] = { claude: { model: 'default', effort: 'default' }, codex: { model: 'default', effort: 'default' } }
    for (const agent of AGENTS) team[role][agent] = { model: s[agent]?.model ?? s.model ?? 'default', effort: s[agent]?.effort ?? s.effort ?? 'default' }
  }
  const text = await fs.readFile(path.join(dirOf(repo), 'local.json'), 'utf8').catch(() => null)
  let local: LocalSettings = {}
  try {
    local = text ? readLocal(JSON.parse(text)) : {}
  } catch {
    /* not JSON: as if there were no overrides, and the next save writes a good file */
  }
  return { team, local, lastRuns: await lastRuns(repo), catalog: await agentCatalog() }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The most recent run of each role on each agent, from the tickets' activity: the CLI records what every stage really used. */
async function lastRuns(repo: string): Promise<ModelSettings['lastRuns']> {
  const out: ModelSettings['lastRuns'] = {}
  const state = await factoryState(repo).catch(() => null)
  for (const job of state?.jobs ?? []) {
    for (const a of job.activity ?? []) {
      if (a.kind !== 'agent' || typeof a.model !== 'string' || !ROLES.includes(a.role as Role)) continue
      const agent = AGENTS.find((x) => x === a.agent)
      if (!agent) continue
      const role = a.role as Role
      const seen = out[role]?.[agent]
      if (seen && seen.at >= a.at) continue
      const run: LastRun = { agent, model: a.model, effort: typeof a.effort === 'string' ? a.effort : null, turns: num(a.turns), tokens: num(a.tokens), costUsd: num(a.cost_usd), at: a.at, ticket: job.id }
      ;(out[role] ??= {})[agent] = run
    }
  }
  return out
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the agent CLIs' own cache files, read defensively field by field */

const text = (v: unknown, max = 160): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const efforts = (found: Iterable<string>) => {
  const set = new Set([...found].filter((e) => EFFORT.test(e)))
  return [...EFFORT_ORDER.filter((e) => set.delete(e)), ...set]
}

/**
 * The models each agent CLI offers on this machine, with their real names and versions ("Sonnet 5.5",
 * "GPT-6.1-Sol"), and what each CLI falls back to when a role says "default".
 *
 * Both CLIs keep a list of their models in the user's home, refreshed whenever they run. The app reads those
 * files, never the network. They are the CLIs' private cache, not a published format: every field is read
 * defensively, and when a file is missing or has changed shape the list falls back to the names that always
 * work, and the user can still type any model.
 */
async function agentCatalog(): Promise<ModelSettings['catalog']> {
  // FACTORY_APP_HOME: the end-to-end tests point this at a made-up home
  const home = process.env.FACTORY_APP_HOME || os.homedir()
  return { claude: await claudeCatalog(home), codex: await codexCatalog(home) }
}

async function readJson(file: string): Promise<any> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 4_000_000) return null
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function claudeCatalog(home: string): Promise<AgentCatalog> {
  const fallback: AgentCatalog = {
    known: false,
    defaultModel: null,
    defaultEffort: null,
    efforts: ['low', 'medium', 'high'],
    models: ['sonnet', 'opus', 'haiku'].map((alias) => ({ value: alias, label: alias[0].toUpperCase() + alias.slice(1), id: null, note: `the newest ${alias[0].toUpperCase() + alias.slice(1)}` })),
  }
  // Claude Code's model list for the terminal app ("-cc.json"): the newest of the files it keeps
  const dir = path.join(home, '.claude', 'cache', 'model-catalog')
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('-cc.json'))
  let newest: { file: string; mtime: number } | null = null
  for (const name of names.slice(0, 200)) {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null)
    if (stat?.isFile() && (!newest || stat.mtimeMs > newest.mtime)) newest = { file: path.join(dir, name), mtime: stat.mtimeMs }
  }
  const catalog = newest ? (await readJson(newest.file))?.catalog : null
  const list: any[] = Array.isArray(catalog?.config?.models) ? catalog.config.models : []
  const byId = new Map<string, { name: string; description: string | null; efforts: string[] }>()
  for (const m of list.slice(0, 100)) {
    const id = text(m?.id, 100)
    const name = text(m?.name, 60)
    if (!id || !name || !MODEL.test(id)) continue
    const levels = Array.isArray(m?.runtime?.effort_levels) ? m.runtime.effort_levels.map((e: any) => (typeof e === 'string' ? e : e?.id)).filter((e: unknown) => typeof e === 'string') : []
    byId.set(id, { name, description: text(m?.description), efforts: levels })
  }
  if (byId.size === 0) return { ...fallback, defaultModel: await claudeDefault(home, new Map(), new Map()) }

  // the short names ("sonnet") and the model each stands for today
  const targets = new Map<string, string>()
  for (const [alias, target] of Object.entries((catalog?.config?.provider_alias_targets ?? {}) as Record<string, any>)) {
    const id = text(target?.default, 100)
    if (MODEL.test(alias) && id && byId.has(id)) targets.set(alias, id)
  }
  const models: ModelOption[] = []
  for (const [alias, id] of targets) models.push({ value: alias, label: byId.get(id)!.name, id, note: `always the newest ${alias[0].toUpperCase() + alias.slice(1)}` })
  // in the order the catalog lists the models (its own ranking)
  const rank = [...byId.keys()]
  models.sort((a, b) => rank.indexOf(a.id!) - rank.indexOf(b.id!))
  const aliased = new Set(targets.values())
  for (const [id, m] of byId) if (!aliased.has(id)) models.push({ value: id, label: m.name, id, note: m.description })
  return {
    known: true,
    defaultModel: await claudeDefault(home, targets, byId, text(catalog?.state?.model, 100)),
    defaultEffort: text(catalog?.state?.thinking?.effort, 12),
    efforts: efforts([...byId.values()].flatMap((m) => m.efforts)).length ? efforts([...byId.values()].flatMap((m) => m.efforts)) : fallback.efforts,
    models,
  }
}

/** Claude Code's default model: what the user set in its settings, else what its catalog says is selected. */
async function claudeDefault(home: string, targets: Map<string, string>, byId: Map<string, { name: string }>, selected: string | null = null): Promise<AgentCatalog['defaultModel']> {
  const set = text((await readJson(path.join(home, '.claude', 'settings.json')))?.model, 100)
  const chosen = set ?? selected
  if (!chosen) return null
  const id = targets.get(chosen) ?? chosen
  return { id, label: byId.get(id)?.name ?? chosen }
}

async function codexCatalog(home: string): Promise<AgentCatalog> {
  // the top of config.toml, before its first [section]
  const top = (await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8').catch(() => '')).split(/^\s*\[/m)[0]
  const key = (name: string) => new RegExp(`^${name}\\s*=\\s*"([^"\\n]{1,100})"`, 'm').exec(top)?.[1] ?? null
  const list: any[] = (await readJson(path.join(home, '.codex', 'models_cache.json')))?.models
  const models: ModelOption[] = []
  const levels: string[] = []
  for (const m of Array.isArray(list) ? list.slice(0, 100) : []) {
    const slug = text(m?.slug, 100)
    const name = text(m?.display_name, 60)
    // "hide" marks models that are not for picking (internal reviewers and the like)
    if (!slug || !name || !MODEL.test(slug) || m?.visibility !== 'list') continue
    models.push({ value: slug, label: name, id: slug, note: text(m?.description) })
    for (const l of Array.isArray(m?.supported_reasoning_levels) ? m.supported_reasoning_levels : []) {
      const e = typeof l === 'string' ? l : l?.effort
      if (typeof e === 'string') levels.push(e)
    }
  }
  const chosen = key('model')
  return {
    known: models.length > 0,
    defaultModel: chosen ? { id: chosen, label: models.find((m) => m.value === chosen)?.label ?? chosen } : null,
    defaultEffort: key('model_reasoning_effort'),
    efforts: efforts(levels).length ? efforts(levels) : ['low', 'medium', 'high'],
    models,
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** The settings the window sent, checked field by field: anything that is not exactly the expected shape is refused. */
function checkLocal(raw: unknown): LocalSettings {
  const bad = (why: string): never => {
    throw new Error(`not valid local settings: ${why}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('not an object')
  const r = raw as Record<string, unknown>
  for (const key of Object.keys(r)) if (key !== 'agent' && key !== 'roles') bad(`unknown field "${key.slice(0, 40)}"`)
  const out: LocalSettings = {}
  if ('agent' in r && r.agent !== null && r.agent !== undefined) {
    if (r.agent !== 'claude' && r.agent !== 'codex') bad('agent must be claude, codex or null')
    out.agent = r.agent as 'claude' | 'codex'
  }
  /** { model?, effort? } and nothing else */
  const plain = (where: string, s: unknown): Partial<RoleSettings> => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) bad(`${where} must be an object`)
    const clean: Partial<RoleSettings> = {}
    for (const [key, v] of Object.entries(s as Record<string, unknown>)) {
      if (key === 'model') {
        if (typeof v !== 'string' || !MODEL.test(v)) bad(`${where}.model must be a model name of at most 100 letters, digits and .:/@[]+-_`)
        clean.model = v as string
      } else if (key === 'effort') {
        if (typeof v !== 'string' || !EFFORT.test(v)) bad(`${where}.effort must be an effort level: one short lowercase word`)
        clean.effort = v as string
      } else bad(`unknown field "${where}.${key.slice(0, 40)}"`)
    }
    return clean
  }
  if ('roles' in r && r.roles !== undefined) {
    if (!r.roles || typeof r.roles !== 'object' || Array.isArray(r.roles)) bad('roles must be an object')
    for (const [role, s] of Object.entries(r.roles as Record<string, unknown>)) {
      if (!(ROLES as readonly string[]).includes(role)) bad(`unknown role "${role.slice(0, 40)}"`)
      if (!s || typeof s !== 'object' || Array.isArray(s)) bad(`${role} must be an object`)
      // a role holds settings for any agent, and a part per agent
      const { claude, codex, ...any } = s as Record<string, unknown>
      const clean: RoleConfig = plain(role, any)
      if (claude !== undefined) clean.claude = plain(`${role}.claude`, claude)
      if (codex !== undefined) clean.codex = plain(`${role}.codex`, codex)
      for (const agent of AGENTS) if (clean[agent] && Object.keys(clean[agent]).length === 0) delete clean[agent]
      if (Object.keys(clean).length) (out.roles ??= {})[role as Role] = clean
    }
  }
  return out
}

export async function saveLocalSettings(repo: string, raw: unknown): Promise<LocalSettings> {
  const local = checkLocal(raw)
  const root = await fs.realpath(repo)
  const dir = path.join(root, '.factory')
  const real = await fs.realpath(dir).catch(() => null)
  if (real !== dir || !(await fs.stat(path.join(dir, 'config.json')).catch(() => null))?.isFile()) throw new Error('This repo has no factory to keep settings for.')
  const file = path.join(dir, 'local.json')
  if ((await fs.lstat(file).catch(() => null))?.isSymbolicLink()) throw new Error('.factory/local.json is a link: not writing through it')
  // fields the app does not know (a newer factory's) are kept as they were: they are not the window's to change
  let kept: Record<string, unknown> = {}
  try {
    const before = JSON.parse(await fs.readFile(file, 'utf8'))
    if (before && typeof before === 'object' && !Array.isArray(before)) kept = Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'agent' && k !== 'roles'))
  } catch {
    /* no file yet, or not JSON: nothing to keep */
  }
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify({ ...kept, ...local }, null, 2) + '\n', { mode: 0o644 })
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
  return local
}
