#!/usr/bin/env node
// The Factory CLI. One file, Node 20+ standard library only, the same on Linux, macOS and Windows.
//
// It is the only writer of .factory/jobs/<id>/job.json. Every ticket is a folder in .factory/jobs/. This file
// creates them, moves them between the stages in .factory/config.json, and refuses any move the config does
// not allow or the files do not justify. It also runs the pipeline (each stage's agent as a subprocess of the
// agent CLI you already use), keeps the journal of why things changed, and opens the desktop app.
//
// Run `node .factory/cli.mjs help` for the commands. <id> is the full id (004-dark-mode) or its number (4).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IS_WIN = process.platform === 'win32'
const BLOCKED = 'blocked'
const DROPPED = 'dropped'
const KINDS = ['feature', 'fix', 'refactor', 'chore', 'decision']
// A branch must not change what it is judged by: the checks, the CLI, the role prompts or the rules.
const PROTECTED = ['.factory/config.json', '.factory/cli.mjs', '.factory/rules.md', '.factory/roles/', '.factory/skills/']
const JOURNAL_MARK = '=== JOURNAL ==='
const DEFAULT_REPO = 'RT-codes/portable-project-factory'

// ---------------------------------------------------------------- small helpers

class Refusal extends Error {}

function refuse(msg) {
  throw new Refusal(msg)
}

// Same shape as the Python script wrote (isoformat with +00:00), so the app reads old and new tickets alike.
function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

function nowZ() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    refuse(`${file} is not valid JSON: ${e.message}`)
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

// Only read stdin when something was piped in: a TTY would wait for the user, and an error means no input.
function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function posix(p) {
  return p.split(path.sep).join('/')
}

function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// A tiny parser: booleans, string options, repeatable options, and `-m`, which (as in the old script) takes
// the rest of the line so `block 4 -m waiting on the API key` needs no quotes.
function parseArgs(argv, spec = {}) {
  const bools = new Set(spec.bool || [])
  const strs = new Set(spec.str || [])
  const multi = new Set(spec.multi || [])
  const out = { _: [] }
  for (const k of multi) out[k] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-m' && spec.message) {
      out.m = argv.slice(i + 1).join(' ').trim()
      break
    }
    if (a === '--') {
      out._.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=')
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
      if (bools.has(key)) {
        out[key] = true
        continue
      }
      if (strs.has(key) || multi.has(key)) {
        const value = eq > 0 ? a.slice(eq + 1) : argv[++i]
        if (value === undefined) refuse(`--${key} needs a value`)
        if (multi.has(key)) out[key].push(value)
        else out[key] = value
        continue
      }
      refuse(`unknown option ${a} (see \`node .factory/cli.mjs help\`)`)
    }
    out._.push(a)
  }
  return out
}

// ---------------------------------------------------------------- where things are

let CTX = null

function ctx() {
  if (CTX) return CTX
  const here = path.dirname(fileURLToPath(import.meta.url))
  let repo = path.dirname(here)
  // A copy of this file inside a ticket's worktree must still act on the main checkout, where the tickets,
  // the run and the config the branch is judged by live. Git's common dir points there from any worktree.
  const r = git(['rev-parse', '--git-common-dir'], here)
  if (r.ok) {
    const common = path.resolve(here, r.out.trim())
    if (path.basename(common) === '.git') repo = path.dirname(common)
  }
  const factory = path.join(repo, '.factory')
  const configFile = path.join(factory, 'config.json')
  if (!fs.existsSync(configFile)) refuse(`no ${configFile}: is the Factory installed in this repo?`)
  const config = readJson(configFile)
  const local = readJson(path.join(factory, 'local.json'), {})
  const stages = Object.fromEntries(config.stages.map((s) => [s.key, s]))
  const order = config.stages.map((s) => s.key)
  // A ticket in any of these stages is finished, waiting on a human, or waiting for a slot: it holds no slot.
  const idle = new Set([BLOCKED, DROPPED, order[0], ...config.stages.filter((s) => s.terminal).map((s) => s.key)])
  CTX = { repo, factory, jobs: path.join(factory, 'jobs'), config, local, stages, order, idle }
  return CTX
}

// The checkout the user (or agent) is standing in: the main one, or a ticket's worktree.
function checkoutRoot() {
  const r = git(['rev-parse', '--show-toplevel'], process.cwd())
  if (r.ok) {
    const top = path.resolve(r.out.trim())
    const common = git(['rev-parse', '--git-common-dir'], top)
    if (common.ok && path.dirname(path.resolve(top, common.out.trim())) === ctx().repo) return top
  }
  return ctx().repo
}

function kitVersion() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'version')
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim() || null
}

// ---------------------------------------------------------------- git

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, code: r.status, out: r.stdout || '', err: (r.stderr || r.error?.message || '').trim() }
}

function gitLines(args, cwd) {
  const r = git(args, cwd)
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : []
}

// ---------------------------------------------------------------- locking

// An exclusive lock file instead of flock, which Windows does not have. Critical sections take milliseconds,
// so a lock older than a minute, or one whose process is gone, was left by a crash and is taken over.
let lockDepth = 0

function withLock(fn) {
  if (lockDepth > 0) return fn()
  const { jobs } = ctx()
  fs.mkdirSync(jobs, { recursive: true })
  const lock = path.join(jobs, '.lock')
  const deadline = Date.now() + 30000
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      fs.closeSync(fd)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (staleLock(lock)) {
        try {
          fs.unlinkSync(lock)
        } catch {}
        continue
      }
      if (Date.now() > deadline) refuse(`${lock} has been held for 30s; if no factory command is running, delete it`)
      sleep(20)
    }
  }
  lockDepth++
  try {
    return fn()
  } finally {
    lockDepth--
    try {
      fs.unlinkSync(lock)
    } catch {}
  }
}

function staleLock(lock) {
  try {
    const st = fs.statSync(lock)
    const age = Date.now() - st.mtimeMs
    const text = fs.readFileSync(lock, 'utf8')
    if (!text) return age > 5000
    const { pid } = JSON.parse(text)
    return age > 60000 || !isAlive(pid)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- tickets

export function slug(title, words = 4) {
  const parts = title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
  return parts.slice(0, words).join('-') || 'ticket'
}

/** The first word of the first non-empty line, so `PASS - all good` and `## VERDICT: PASS` both read PASS. */
export function verdict(text) {
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/^[#>*\s]+/, '').trim()
    if (!line) continue
    line = line.replace(/^(STATUS|VERDICT|RESULT)\s*:\s*/i, '')
    const m = line.match(/^[A-Za-z][A-Za-z_-]*/)
    return m ? m[0].toUpperCase() : ''
  }
  return ''
}

function firstLine(text) {
  return (text.split(/\r?\n/).find((l) => l.trim()) || '').trim()
}

function ticketNumber(name) {
  const m = name.match(/^(\d+)-/)
  return m ? Number(m[1]) : null
}

function allJobs() {
  const { jobs } = ctx()
  if (!fs.existsSync(jobs)) return []
  return fs
    .readdirSync(jobs)
    .filter((n) => ticketNumber(n) !== null && fs.existsSync(path.join(jobs, n, 'job.json')))
    .sort()
    .map((n) => JSON.parse(fs.readFileSync(path.join(jobs, n, 'job.json'), 'utf8')))
}

function resolveDir(ref) {
  const { jobs } = ctx()
  ref = String(ref || '')
  if (/^\d+$/.test(ref) && fs.existsSync(jobs)) {
    const hits = fs.readdirSync(jobs).filter((n) => ticketNumber(n) === Number(ref))
    if (hits.length === 1) return path.join(jobs, hits[0])
  } else if (ref && fs.existsSync(path.join(jobs, ref, 'job.json'))) {
    return path.join(jobs, ref)
  }
  refuse(`no ticket '${ref}' (see \`node .factory/cli.mjs list\`)`)
}

function load(ref) {
  const dir = resolveDir(ref)
  return { dir, job: JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')) }
}

function save(dir, job) {
  job.updated_at = now()
  writeAtomic(path.join(dir, 'job.json'), JSON.stringify(job, null, 2) + '\n')
}

function log(job, kind, text, extra = {}) {
  job.activity.push({ at: now(), kind, text, ...extra })
}

function outputPath(dir, job, stageKey) {
  const out = ctx().stages[stageKey]?.output
  return out ? path.join(dir, out.replace('{round}', String(job.round))) : null
}

function rel(dir, file) {
  return posix(path.relative(dir, file))
}

function worktreePath(job) {
  return job.worktree ? path.join(ctx().repo, job.worktree) : ctx().repo
}

function ensureWorktree(job) {
  if (job.worktree) return
  const { repo, config } = ctx()
  const wtRel = `.factory/worktrees/${job.id}`
  const wt = path.join(repo, wtRel)
  const branch = `factory/${job.id}`
  if (!fs.existsSync(wt)) {
    // A worktree folder deleted by hand leaves a registration behind that would make `worktree add` fail.
    git(['worktree', 'prune'], repo)
    const exists = git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], repo).ok
    if (!exists && !git(['rev-parse', '--verify', '-q', `${config.base_branch}^{commit}`], repo).ok) {
      refuse(`base branch '${config.base_branch}' has no commit (set base_branch in .factory/config.json, or commit first)`)
    }
    const args = exists ? ['worktree', 'add', wt, branch] : ['worktree', 'add', '-b', branch, wt, config.base_branch]
    const r = git(args, repo)
    if (!r.ok) refuse(`could not create the worktree: ${r.err}`)
  }
  job.worktree = wtRel
  job.branch = branch
}

function isOpen(job) {
  return job.stage !== BLOCKED && job.stage !== DROPPED && !ctx().stages[job.stage]?.terminal
}

/** The highest number a deleted ticket had (jobs/.last): numbers only go up. */
function lastDeleted() {
  try {
    return Number(fs.readFileSync(path.join(ctx().jobs, '.last'), 'utf8')) || 0
  } catch {
    return 0
  }
}

function createTicket(title, body) {
  title = title.trim()
  if (!title) refuse('a ticket needs a title: new <title>')
  const { jobs, order } = ctx()
  return withLock(() => {
    // a deleted ticket's number is not handed out again: the journal still speaks of it
    const n = Math.max(0, lastDeleted(), ...fs.readdirSync(jobs).map(ticketNumber).filter((x) => x !== null)) + 1
    const id = `${String(n).padStart(3, '0')}-${slug(title)}`
    const dir = path.join(jobs, id)
    fs.mkdirSync(dir)
    body = (body || '').trim()
    fs.writeFileSync(path.join(dir, 'ticket.md'), body ? `# ${title}\n\n${body}\n` : `# ${title}\n`)
    const job = { id, number: n, title, stage: order[0], round: 0, created_at: now(), updated_at: now(), activity: [] }
    log(job, 'created', 'Ticket created')
    save(dir, job)
    return job
  })
}

function advance(ref, dst, note = '') {
  const { stages, config } = ctx()
  return withLock(() => {
    const { dir, job } = load(ref)
    const src = job.stage
    if (src === BLOCKED || src === DROPPED) refuse(`${job.id} is ${src}; use \`unblock\``)
    const allowed = stages[src]?.next || {}
    if (!(dst in allowed)) {
      refuse(`${src} → ${dst} is not in config.json (allowed: ${Object.keys(allowed).join(', ') || 'none'}, or \`block\`)`)
    }
    const out = outputPath(dir, job, src)
    const need = allowed[dst]
    if (out && !fs.existsSync(out)) refuse(`${src} has not written ${rel(dir, out)} yet`)
    if (need !== null && need !== undefined) {
      const got = verdict(fs.readFileSync(out, 'utf8'))
      if (got !== need) refuse(`${rel(dir, out)} says ${got || 'nothing'}, ${src} → ${dst} needs ${need}`)
    }
    if (stages[dst]?.starts_round) {
      if (job.round >= config.max_rounds) refuse(`${job.id} used all ${config.max_rounds} rounds; \`block\` it for a human`)
      job.round += 1
      ensureWorktree(job)
    }
    // The reason for a change travels with the change: no ticket finishes without its journal entry,
    // committed on its own branch.
    let entry = null
    if (stages[dst]?.terminal) entry = commitTicketJournal(dir, job)
    job.stage = dst
    log(job, 'moved', note || `${stages[src].label} → ${stages[dst].label}`, { from: src, to: dst })
    if (entry) log(job, 'journal', `Journal entry ${entry.id} committed on ${job.branch}`)
    save(dir, job)
    return job
  })
}

function block(ref, reason) {
  return withLock(() => {
    const { dir, job } = load(ref)
    if (!isOpen(job)) refuse(`${job.id} is already ${job.stage}`)
    job.blocked_from = job.stage
    job.stage = BLOCKED
    job.blocked_reason = reason
    log(job, 'blocked', reason, { from: job.blocked_from, to: BLOCKED })
    save(dir, job)
    return job
  })
}

function blockQuietly(ref, reason) {
  try {
    return block(ref, reason)
  } catch (e) {
    if (!(e instanceof Refusal)) throw e
    return null
  }
}

function unblock(ref, stage, note) {
  const { stages, order } = ctx()
  return withLock(() => {
    const { dir, job } = load(ref)
    if (job.stage !== BLOCKED) refuse(`${job.id} is not blocked`)
    const dst = stage || job.blocked_from || order[0]
    if (!stages[dst] || stages[dst].terminal) refuse(`unknown or terminal stage '${dst}'`)
    if (stages[dst].starts_round && job.blocked_from !== dst) {
      job.round += 1
      ensureWorktree(job)
    }
    job.stage = dst
    delete job.blocked_reason
    log(job, 'moved', note || `Unblocked → ${stages[dst].label}`, { from: BLOCKED, to: dst })
    save(dir, job)
    return job
  })
}

function drop(ref, reason) {
  return withLock(() => {
    const { dir, job } = load(ref)
    const src = job.stage
    job.stage = DROPPED
    log(job, 'dropped', reason, { from: src, to: DROPPED })
    save(dir, job)
    return job
  })
}

/**
 * Delete a ticket for good: its folder, its worktree and its branch. Unlike `drop`, nothing of it stays on the
 * board, so the journal gets an entry that says what was deleted and why: whoever works here next, a person or
 * an agent, can still find out that it existed and what became of its work.
 */
function deleteTicket(ref, reason) {
  const { repo, jobs, config, stages, order } = ctx()
  return withLock(() => {
    const { dir, job } = load(ref)
    const run = currentRun()
    if (run && isOpen(job) && job.stage !== order[0]) refuse(`a run is working ${job.id} (pid ${run.pid}): \`cancel\` the run first`)
    const had = git(['rev-parse', '--verify', '-q', `refs/heads/${job.branch}`], repo).ok && !!job.branch
    const tip = had ? git(['rev-parse', '--short', job.branch], repo).out.trim() : null
    const commits = had ? gitLines(['rev-list', `${config.base_branch}..${job.branch}`], repo).length : 0
    const merged = had && git(['merge-base', '--is-ancestor', job.branch, config.base_branch], repo).ok
    if (job.worktree) {
      const wt = path.join(repo, job.worktree)
      // --force: work that was never committed goes with the ticket, which is what deleting it means
      if (fs.existsSync(wt) && !git(['worktree', 'remove', '--force', wt], repo).ok) fs.rmSync(wt, { recursive: true, force: true })
      git(['worktree', 'prune'], repo)
    }
    if (had) {
      const r = git(['branch', '-D', job.branch], repo)
      if (!r.ok) refuse(`could not delete the branch ${job.branch}: ${r.err}`)
    }
    fs.writeFileSync(path.join(jobs, '.last'), String(Math.max(job.number, lastDeleted())))
    fs.rmSync(dir, { recursive: true, force: true })

    const number = String(job.number).padStart(3, '0')
    const where = job.stage === BLOCKED ? `blocked (from ${stages[job.blocked_from]?.label || job.blocked_from || '?'})` : stages[job.stage]?.label || job.stage
    const work = !had
      ? 'It had no branch yet: no code was written for it.'
      : commits === 0
        ? `Its branch \`${job.branch}\` had no commits of its own; the branch and its worktree were removed.`
        : merged
          ? `Its branch \`${job.branch}\` (${commits} ${commits === 1 ? 'commit' : 'commits'}, tip ${tip}) was already merged into ${config.base_branch}; the branch and its worktree were removed.`
          : `Its branch \`${job.branch}\` (${commits} ${commits === 1 ? 'commit' : 'commits'}, tip ${tip}) was not merged into ${config.base_branch}: that work was discarded with the branch and its worktree.`
    const at = nowZ()
    const host = process.env.FACTORY_STAGE ? null : chooseAgent(process.env, {}, () => false)
    const meta = {
      id: entryId(`Deleted ticket ${number}`, at, [repo]),
      at,
      title: `Deleted ticket ${number}: ${job.title}`,
      kind: 'decision',
      ticket: job.id,
      branch: null,
      commits: [],
      files: [],
      tags: ['deleted', 'ticket'],
      by: host ? { agent: host } : null,
      // what it took before it was deleted was still spent
      ...(usageRows(job).length ? { usage: usageRows(job) } : {}),
    }
    const file = writeEntry(repo, meta, `## What changed\nTicket ${number} ("${job.title}") was deleted for good while it was in ${where}, round ${job.round}. ${work}\n\n## Why\n${reason.trim()}`)
    return { job, entry: meta.id, file, commits, merged }
  })
}

// ---------------------------------------------------------------- landing
//
// A finished ticket is on its own branch, made from the base branch as it was when the build started. Landing
// brings it into the base branch as that is now: the base is merged into the ticket's branch, the checks run on
// the result, and only then does the base branch move (fast-forward, so it never holds anything unchecked).
// One ticket lands at a time: each landing changes what the next one has to fit.
// What does not fit goes back to the pipeline, not to a special case: the ticket returns to its build stage with
// the conflict (or the failing checks) written down, and the builder, the checks and the reviewer do their work.

function landLock() {
  const file = path.join(ctx().factory, 'run', 'land.lock')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
      return () => fs.rmSync(file, { force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const pid = Number(fs.readFileSync(file, 'utf8')) || 0
      if (pid && isAlive(pid)) refuse(`another ticket is landing (pid ${pid}): one at a time`)
      fs.rmSync(file, { force: true })
    }
  }
  refuse('could not take the landing lock')
}

/** Back to the build stage, with what has to be dealt with written where the builder is told to look. */
function sendBack(ref, title, text) {
  const { config, stages } = ctx()
  return withLock(() => {
    const { dir, job } = load(ref)
    const n = fs.readdirSync(dir).filter((f) => /^feedback-.*\.md$/.test(f)).length + 1
    fs.writeFileSync(path.join(dir, `feedback-${n}.md`), `# ${title}\n\n${text.trim()}\n`)
    const build = config.stages.find((s) => s.starts_round)
    const src = job.stage
    if (!build || job.round >= config.max_rounds) {
      job.blocked_from = build ? build.key : src
      job.stage = BLOCKED
      job.blocked_reason = `${title} (feedback-${n}.md)${build ? `, and all ${config.max_rounds} rounds are used` : ''}. Resolve it in ${job.worktree}, then \`unblock\`.`
      log(job, 'blocked', job.blocked_reason, { from: src, to: BLOCKED })
    } else {
      job.round += 1
      job.stage = build.key
      log(job, 'moved', `${title}: back to ${stages[build.key].label} (feedback-${n}.md)`, { from: src, to: build.key })
    }
    save(dir, job)
    return job
  })
}

async function land(ref, say) {
  const { repo, config, stages } = ctx()
  const base = config.base_branch
  const { job } = load(ref)
  if (!stages[job.stage]?.terminal) refuse(`${job.id} is in ${job.stage}: only a finished ticket lands`)
  if (job.landed) refuse(`${job.id} has landed already (${job.landed.sha})`)
  if (!job.branch || !job.worktree) refuse(`${job.id} has no branch to land`)
  const wt = worktreePath(job)
  if (!fs.existsSync(wt)) refuse(`${job.id}'s worktree ${job.worktree} is gone`)
  if (git(['status', '--porcelain'], wt).out.trim()) refuse(`${job.worktree} has uncommitted changes: commit or discard them first`)
  const release = landLock()
  try {
    const baseTip = git(['rev-parse', base], repo).out.trim()
    // the base moved since the ticket branched: the ticket takes it in, and has to hold with it
    if (!git(['merge-base', '--is-ancestor', baseTip, 'HEAD'], wt).ok) {
      say(`${job.id}: ${base} has moved; merging it into ${job.branch}`)
      const m = git(['merge', '--no-edit', '-m', `Merge ${base} into ${job.branch}`, baseTip], wt)
      if (!m.ok) {
        const files = gitLines(['diff', '--name-only', '--diff-filter=U'], wt)
        // the merge is left as it stands: the files hold both sides between conflict markers
        const j = sendBack(job.id, `Conflicts with ${base}`, `Landing this ticket merged \`${base}\` into its branch, and these files conflict:\n\n${files.map((f) => `- \`${f}\``).join('\n')}\n\nThe merge is in progress in the worktree: each file holds both sides between conflict markers. Resolve every one so that both changes keep working (read \`git log ${base}\` for what the other side did and why), remove the markers, and leave the result in the worktree or commit it. Then run the checks.`)
        say(`${job.id}: ${files.length} ${files.length === 1 ? 'file conflicts' : 'files conflict'} with ${base} → ${j.stage}${j.stage === BLOCKED ? '' : ` (round ${j.round}); \`run\` has the builder resolve it`}`)
        return { landed: false, stage: j.stage }
      }
      say(`${job.id}: running the checks on the merged result`)
      const c = await checksIn(wt)
      if (c.failed) {
        const j = sendBack(job.id, `The checks fail with ${base} merged in`, `Landing this ticket merged \`${base}\` into its branch without conflicts, but the checks fail on the result:\n\n\`\`\`\n${c.out.join('\n')}\n\`\`\`\n\nThe merge is committed on the branch. Fix what fails; the whole output is in \`.factory/cache/checks.log\` in the worktree.`)
        say(`${job.id}: the checks fail with ${base} merged in → ${j.stage}${j.stage === BLOCKED ? '' : ` (round ${j.round})`}`)
        return { landed: false, stage: j.stage }
      }
    }
    const tip = git(['rev-parse', 'HEAD'], wt).out.trim()
    // move the base branch: in the checkout that has it open (git refuses if that would overwrite work there),
    // or as a ref when no checkout has it
    const open = gitLines(['worktree', 'list', '--porcelain'], repo).join('\n').split('\n\n').map((b) => ({ dir: /^worktree (.+)$/m.exec(b)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] })).find((w) => w.branch === base)
    const r = open ? git(['merge', '--ff-only', tip], open.dir) : git(['fetch', '-q', '.', `${tip}:refs/heads/${base}`], repo)
    if (!r.ok) refuse(`could not move ${base} to ${job.branch}: ${r.err.split('\n').slice(0, 3).join(' ')}`)
    // the ticket's work is in the base branch now: its worktree and branch have done their job
    if (!git(['worktree', 'remove', '--force', wt], repo).ok) fs.rmSync(wt, { recursive: true, force: true })
    git(['worktree', 'prune'], repo)
    git(['branch', '-D', job.branch], repo)
    const done = withLock(() => {
      const { dir, job: j } = load(job.id)
      j.landed = { at: now(), sha: tip.slice(0, 7), into: base }
      delete j.worktree
      log(j, 'landed', `Landed in ${base} (${j.landed.sha})`)
      save(dir, j)
      return j
    })
    say(`${done.id}: landed in ${base} (${done.landed.sha})`)
    return { landed: true, stage: done.stage }
  } finally {
    release()
  }
}

function addNote(ref, text) {
  return withLock(() => {
    const { dir, job } = load(ref)
    log(job, 'note', text)
    save(dir, job)
    return job
  })
}

// ---------------------------------------------------------------- processes

const children = new Set()

function which(name) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const file = path.join(dir, name + ext)
      try {
        if (!fs.statSync(file).isFile()) continue
        if (!IS_WIN) fs.accessSync(file, fs.constants.X_OK)
        return file
      } catch {}
    }
  }
  return null
}

function quoteWin(arg) {
  return /^[\w.\-\\/:=@,+]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`
}

// Agent CLIs installed with npm are `.cmd` shims on Windows, which only cmd.exe can start. Node refuses to
// spawn them without a shell, and with a shell it does not quote, so the arguments are quoted here.
function spawnCmd(bin, args, opts = {}) {
  const base = { windowsHide: true, ...opts }
  if (IS_WIN && /\.(cmd|bat)$/i.test(bin)) return spawn([bin, ...args].map(quoteWin).join(' '), { ...base, shell: true })
  return spawn(bin, args, base)
}

// The whole tree: an agent or a check starts processes of its own, and a timeout must stop all of them.
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }, 5000).unref()
}

function killChildren() {
  for (const c of children) killTree(c)
}

/** Run a process to the end: stdin from `input`, stdout and stderr appended to `logFd`, stdout also returned. */
function runProcess(bin, args, { cwd, input = null, logFd = null, timeoutMs = 0, env = process.env, shell = false } = {}) {
  return new Promise((resolve) => {
    const opts = { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: !IS_WIN }
    let child
    try {
      child = shell ? spawn(bin, { ...opts, shell: true, windowsHide: true }) : spawnCmd(bin, args, opts)
    } catch (e) {
      resolve({ code: null, timedOut: false, stdout: '', error: e.message })
      return
    }
    children.add(child)
    const out = []
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, timeoutMs)
      : null
    const write = (chunk) => logFd !== null && fs.writeSync(logFd, chunk)
    child.stdout.on('data', (c) => {
      out.push(c)
      write(c)
    })
    child.stderr.on('data', write)
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? '')
    let error = null
    child.on('error', (e) => (error = e.message))
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      children.delete(child)
      resolve({ code, signal, timedOut, stdout: Buffer.concat(out).toString('utf8'), error })
    })
  })
}

// ---------------------------------------------------------------- checks

function changedOnBranch(job) {
  const wt = worktreePath(job)
  const base = ctx().config.base_branch
  return [
    ...new Set([
      ...gitLines(['diff', '--name-only', `${base}...HEAD`], wt),
      ...gitLines(['diff', '--name-only', 'HEAD'], wt),
      ...gitLines(['ls-files', '--others', '--exclude-standard'], wt),
    ]),
  ]
}

export function protectedFiles(files) {
  return files.filter((f) => PROTECTED.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)))
}

async function runChecks(ref) {
  const { config, stages, repo } = ctx()
  const { dir, job } = withLock(() => load(ref))
  const stage = stages[job.stage]
  if (!stage?.run) refuse(`${job.stage} has no checks to run`)
  if (!job.worktree) refuse(`${job.id} has no worktree yet: checks run on the ticket's branch`)
  const out = outputPath(dir, job, job.stage)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const logFile = out.replace(/\.md$/, '') + '.log'
  const cwd = worktreePath(job)
  const where = posix(path.relative(repo, cwd)) || '.'
  // The checks come from the main checkout's config, never the branch's: a branch cannot change its judges.
  const checks = config.checks || []
  const fd = fs.openSync(logFile, 'w')
  const lines = []
  let result = 'PASS'
  const started = Date.now()
  const touched = protectedFiles(changedOnBranch(job))
  if (touched.length) {
    result = 'FAIL'
    const msg = `The branch changes files the factory protects: ${touched.join(', ')}. Undo those changes (the diff against ${config.base_branch} must not touch them).`
    fs.writeSync(fd, `[factory] ${msg}\n`)
    lines.push(`- ${msg}`)
  } else if (!checks.length) {
    lines.push('- No checks are configured: add the repo\'s commands to `checks` in .factory/config.json.')
    fs.writeSync(fd, '[factory] no checks are configured\n')
  } else {
    const deadline = started + (config.check_timeout_s || 1800) * 1000
    for (const cmd of checks) {
      fs.writeSync(fd, `\n$ ${cmd}\n`)
      const t0 = Date.now()
      const r = await runProcess(cmd, [], { cwd, logFd: fd, timeoutMs: Math.max(1000, deadline - Date.now()), shell: true })
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      const code = r.timedOut ? 124 : r.code ?? 1
      if (r.timedOut) fs.writeSync(fd, '\n[factory] timed out\n')
      if (r.error) fs.writeSync(fd, `\n[factory] ${r.error}\n`)
      lines.push(`- \`${cmd}\` exited ${code}${r.timedOut ? ' (timed out)' : ''} in ${secs}s.`)
      if (code !== 0) {
        result = 'FAIL'
        break
      }
    }
  }
  fs.closeSync(fd)
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const tail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-40).join('\n')
  fs.writeFileSync(
    out,
    `${result}\n\n## Summary\n\n${lines.join('\n')}\n- Ran in \`${where}\` in ${secs}s. Full log: \`${rel(dir, logFile)}\`.\n\n## Last lines\n\n\`\`\`\n${tail}\n\`\`\`\n`,
  )
  withLock(() => {
    const { dir: d, job: j } = load(ref)
    log(j, 'check', `checks: ${result} in ${secs}s`, { result })
    save(d, j)
  })
  return result
}

/**
 * The repo's checks, for whoever is working in a checkout (a builder in its worktree, a person): what passed in a
 * line each, what failed with the end of its output, and the whole output in a file. An agent that reads a
 * thousand lines of passing tests pays for every one of them, on every later turn; this way it reads what it
 * needs, and nothing is hidden: the file has all of it.
 */
async function checksIn(root) {
  const { config } = ctx()
  const checks = config.checks || []
  const logFile = path.join(root, '.factory', 'cache', 'checks.log')
  const out = []
  if (!checks.length) return { failed: false, out: ['No checks are configured (`checks` in .factory/config.json).'], logFile }
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, 'w')
  let failed = false
  const deadline = Date.now() + (config.check_timeout_s || 1800) * 1000
  for (const cmd of checks) {
    const from = fs.fstatSync(fd).size
    fs.writeSync(fd, `\n$ ${cmd}\n`)
    const t0 = Date.now()
    const r = await runProcess(cmd, [], { cwd: root, logFd: fd, timeoutMs: Math.max(1000, deadline - Date.now()), shell: true })
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    const code = r.timedOut ? 124 : r.code ?? 1
    if (code === 0) {
      out.push(`ok    ${cmd} (${secs}s)`)
      continue
    }
    failed = true
    const lines = fs.readFileSync(logFile, 'utf8').slice(from).trim().split(/\r?\n/).slice(1)
    const tail = lines.slice(-CHECK_TAIL)
    out.push(`FAIL  ${cmd} (exit ${code}${r.timedOut ? ', timed out' : ''}, ${secs}s)${lines.length > tail.length ? `, the last ${tail.length} of ${lines.length} lines:` : ':'}`)
    out.push(tail.join('\n'))
    break
  }
  fs.closeSync(fd)
  return { failed, out, logFile }
}

async function cmdChecks() {
  const r = await checksIn(checkoutRoot())
  for (const line of r.out) say(line)
  if (!(ctx().config.checks || []).length) return
  const relLog = posix(path.relative(process.cwd(), r.logFile)) || r.logFile
  say(`The whole output: ${relLog}${r.failed ? ' (search it for the first error rather than running the checks again)' : ''}`)
  say(`CHECKS: ${r.failed ? 'FAIL' : 'PASS'}`)
  if (r.failed) process.exitCode = 1
}
const CHECK_TAIL = 60

// ---------------------------------------------------------------- agents

/** Which agent CLI runs the stages: explicit choice, then the one we are inside, then whatever is installed. */
export function chooseAgent(env, local, onPath) {
  const pick = env.FACTORY_AGENT || local?.agent
  if (pick) return pick
  if (env.CLAUDECODE === '1') return 'claude'
  // Codex sets these in the environment of every command it runs.
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return 'codex'
  return ['claude', 'codex'].find(onPath) || null
}

function resolveAgent() {
  const agent = chooseAgent(process.env, ctx().local, (n) => !!which(n))
  if (!agent) refuse('no agent CLI found: install Claude Code (`claude`) or Codex (`codex`), or set FACTORY_AGENT')
  if (!['claude', 'codex'].includes(agent)) refuse(`unknown agent '${agent}' (FACTORY_AGENT or local.json "agent"): use claude or codex`)
  if (process.env.FACTORY_RUNNER) return { agent, bin: process.execPath, pre: [path.resolve(process.env.FACTORY_RUNNER)] }
  const bin = which(agent)
  if (!bin) refuse(`'${agent}' is not on PATH`)
  return { agent, bin, pre: [] }
}

/**
 * The model and effort a role runs with, on one agent CLI. Model names belong to an agent ("sonnet" means nothing
 * to Codex), so a role's settings may hold a part per agent: { model, effort, claude: { model }, codex: { model } }.
 * Per field, the most specific wins: this user's local.json for this agent, then local.json for any agent, then
 * the team's config.json for this agent, then config.json for any agent.
 */
export function roleSettings(config, local, role, agent) {
  const layers = [local?.roles?.[role]?.[agent], local?.roles?.[role], config.roles?.[role]?.[agent], config.roles?.[role]]
  const pick = (field) => layers.map((l) => l?.[field]).find((v) => typeof v === 'string' && v) || 'default'
  return { model: pick('model'), effort: pick('effort') }
}

const READ_TOOLS = ['Read', 'Grep', 'Glob']
const GIT_READ = ['diff', 'log', 'show', 'status'].flatMap((c) => [`Bash(git ${c})`, `Bash(git ${c} *)`])

/** The exact command line for one stage. The prompt always goes on stdin, never as an argument. */
export function agentArgs({ agent, role, model, effort, cwd, jobDir, finalFile }) {
  const set = (v) => v && v !== 'default'
  if (agent === 'claude') {
    // A stage agent is a lean session: only the tools its role needs, none of the user's MCP servers, skills or
    // slash commands. Without this every stage loads the user's whole setup (hundreds of tool definitions) into
    // every turn, which on a real machine cost more than ten times the work itself.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--disable-slash-commands']
    if (set(model)) args.push('--model', model)
    if (set(effort)) args.push('--effort', effort)
    if (role === 'builder') {
      const tools = [...READ_TOOLS, 'Edit', 'Write', 'Bash']
      args.push('--permission-mode', 'acceptEdits', '--tools', tools.join(','), '--allowedTools', ...tools)
    } else if (role === 'reviewer') {
      args.push('--permission-mode', 'dontAsk', '--tools', [...READ_TOOLS, 'Bash'].join(','), '--allowedTools', ...READ_TOOLS, ...GIT_READ)
    } else {
      args.push('--permission-mode', 'dontAsk', '--tools', READ_TOOLS.join(','), '--allowedTools', ...READ_TOOLS)
    }
    // The ticket folder sits outside the worktree; the agent must be able to read ticket.md and plan.md.
    if (path.resolve(jobDir) !== path.resolve(cwd) && !path.resolve(jobDir).startsWith(path.resolve(cwd) + path.sep)) {
      args.push('--add-dir', jobDir)
    }
    return args
  }
  const args = ['exec', '--color', 'never', '--skip-git-repo-check', '-C', cwd, '-s', role === 'builder' ? 'workspace-write' : 'read-only', '-o', finalFile]
  if (set(model)) args.push('-m', model)
  if (set(effort)) args.push('-c', `model_reasoning_effort=${effort}`)
  args.push('-')
  return args
}

/** The final message of a `claude -p --output-format stream-json` run: its last `result` event. */
export function claudeFinal(stdout) {
  let result = null
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    try {
      const ev = JSON.parse(line)
      if (ev.type === 'result') result = ev
    } catch {}
  }
  if (!result) return { ok: false, reason: 'no result in the output' }
  if (result.is_error || (result.subtype && result.subtype !== 'success')) {
    return { ok: false, reason: `${result.subtype || 'error'}: ${String(result.result || '').slice(0, 200)}` }
  }
  return { ok: true, text: String(result.result || '') }
}

/**
 * What a stage run really used, read from the agent's own output: the model it resolved to (a role set to
 * "default" or to an alias like "sonnet" says nothing about the version), and what it took. Every field is
 * optional: an agent that does not report one leaves it out.
 */
export function runFacts(agent, stdout) {
  const facts = {}
  if (agent === 'claude') {
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith('{')) continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') facts.model = ev.model
      if (ev.type === 'result') {
        if (Number.isFinite(ev.num_turns)) facts.turns = ev.num_turns
        // the price of the tokens at API rates: on a subscription it is a measure of usage, not a bill
        if (Number.isFinite(ev.total_cost_usd)) facts.cost_usd = Math.round(ev.total_cost_usd * 1000) / 1000
        const u = ev.usage || {}
        // kept apart as well as summed: a token read from the cache costs about a tenth of a fresh one, so the
        // sum alone cannot say what a run cost
        const parts = { input: u.input_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens, output: u.output_tokens }
        for (const [k, v] of Object.entries(parts)) if (Number.isFinite(v) && v > 0) facts[k] = v
        const tokens = Object.values(parts).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0)
        if (tokens > 0) facts.tokens = tokens
      }
    }
    return facts
  }
  // Codex prints a header (model, reasoning effort) before the session and "tokens used" after it.
  const model = /^model: (.+)$/m.exec(stdout)
  if (model) facts.model = model[1].trim()
  const effort = /^reasoning effort: (.+)$/m.exec(stdout)
  if (effort && effort[1].trim() !== 'none') facts.effort = effort[1].trim()
  const tokens = /tokens used\s*\n?\s*([\d,.]+)/i.exec(stdout)
  if (tokens) facts.tokens = Number(tokens[1].replace(/[,.]/g, '')) || undefined
  if (facts.tokens === undefined) delete facts.tokens
  return facts
}

// Session variables of the host agent must not leak into a stage agent: it is a new session, not a child
// of ours, and the role's effort must not be overridden by the host's.
function stageEnv(role) {
  const env = { ...process.env, FACTORY_STAGE: role }
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|EXECPATH)|CODEX_THREAD_ID|CODEX_TOOL_CALL_ID)$/.test(k)) delete env[k]
  }
  return env
}

function header(dir, job, stageKey) {
  const { repo, config, stages } = ctx()
  const wt = worktreePath(job)
  const out = stages[stageKey].output.replace('{round}', String(job.round))
  return [
    `Ticket: ${job.id}. Ticket folder: ${dir}${path.sep}. Main checkout: ${repo}. Worktree: ${wt}. ` +
      `Branch: ${job.branch || '(main checkout)'}. Base branch: ${config.base_branch}. Round: ${job.round}.`,
    `Your final message becomes ${out} in the ticket folder: the factory writes that file from it, you do not.`,
  ].join('\n')
}

function passSentence(dir, job, role) {
  const { config } = ctx()
  const n = job.round
  const prev = path.join(dir, `round-${n - 1}`)
  const feedback = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^feedback-.*\.md$/.test(f)).sort() : []
  const notes = []
  if (role === 'planner') {
    notes.push(fs.existsSync(path.join(dir, 'plan.md'))
      ? 'This ticket was planned before and came back: read the old plan.md and the latest activity in job.json, then plan again.'
      : 'First pass: plan the ticket.')
  } else if (role === 'builder') {
    if (n <= 1) notes.push('Round 1: build the plan.')
    else if (fs.existsSync(path.join(prev, 'checks.md')) && verdict(fs.readFileSync(path.join(prev, 'checks.md'), 'utf8')) === 'FAIL') {
      notes.push(`Round ${n}: the checks failed in round ${n - 1}. Read round-${n - 1}/checks.md and round-${n - 1}/checks.log and fix every failure.`)
    } else if (fs.existsSync(path.join(prev, 'review.md'))) {
      notes.push(`Round ${n}: the review in round ${n - 1} asked for changes. Read round-${n - 1}/review.md and address every Required point.`)
    } else notes.push(`Round ${n}: read the latest activity in job.json for why this round started.`)
    if (feedback.length) notes.push(`The user left feedback: read ${feedback.join(', ')}.`)
    if (job.branch && gitLines(['rev-list', `${config.base_branch}..HEAD`], worktreePath(job)).length) {
      notes.push(`Earlier work is already committed on this branch: read build.md and \`git log ${config.base_branch}..HEAD\` first.`)
    }
  } else {
    notes.push(`Review round ${n}.`)
  }
  return `This pass: ${notes.join(' ')}`
}

// ---------------------------------------------------------------- skills

/**
 * The repo's skills: how to do one kind of task here (cut a release, add a migration), one markdown file each in
 * .factory/skills/. Unlike the rules, a skill is not loaded up front: an agent sees its name and one-line
 * description, and reads the file only when the task at hand calls for it. Any agent can do that, so skills are
 * not tied to one agent's own skill system.
 */
export function readSkills(factoryDir) {
  const dir = path.join(factoryDir, 'skills')
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md'))
  } catch {}
  return names
    .sort()
    .slice(0, 200)
    .map((file) => {
      let text = ''
      try {
        text = fs.readFileSync(path.join(dir, file), 'utf8')
      } catch {}
      const { meta, body } = parseEntry(text)
      const name = file.replace(/\.md$/i, '')
      // a skill without a description is described by its first line of prose
      const first = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || ''
      const description = clip(String(typeof meta.description === 'string' && meta.description.trim() ? meta.description : first), 200)
      return { name, description, file: `.factory/skills/${file}`, body }
    })
}

/** The skills as an agent is first told of them: a line each, and how to read one. */
export function skillLines(skills, how) {
  if (!skills.length) return []
  return [...skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`), how]
}

function buildPrompt(dir, job, stageKey, role) {
  const { factory } = ctx()
  const roleFile = path.join(factory, 'roles', `${role}.md`)
  if (!fs.existsSync(roleFile)) refuse(`no role prompt ${roleFile}`)
  const rulesFile = path.join(factory, 'rules.md')
  const rules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8').trim() : '(none)'
  const skills = readSkills(factory)
  return [
    `FACTORY ROLE: ${role}`,
    header(dir, job, stageKey),
    passSentence(dir, job, role),
    '',
    fs.readFileSync(roleFile, 'utf8').trim(),
    '',
    '# This repo\'s rules (.factory/rules.md)',
    '',
    rules,
    '',
    ...(skills.length ? ['# This repo\'s skills (.factory/skills/)', '', ...skillLines(skills, 'When one fits what you are doing, read its file (`.factory/skills/<name>.md`) and follow it.'), ''] : []),
  ].join('\n')
}

/** Split a reviewer's final message into the review and, after the marker line, the journal draft. */
export function splitReview(text) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => l.trim() === JOURNAL_MARK)
  if (i < 0) return { review: text.trim(), journal: null }
  return { review: lines.slice(0, i).join('\n').trim(), journal: lines.slice(i + 1).join('\n').trim() || null }
}

function commitLeftovers(job, round) {
  const wt = worktreePath(job)
  if (!git(['status', '--porcelain'], wt).out.trim()) return null
  // Codex's sandbox may not let the builder commit; nothing it wrote should be lost because of that.
  let r = git(['add', '-A'], wt)
  if (r.ok) r = git(['commit', '-q', '-m', `${job.title}\n\nFactory ticket ${job.id}, round ${round}: work the builder left uncommitted.`], wt)
  return r.ok ? null : `could not commit the builder's changes: ${r.err}`
}

/**
 * Why a stage's agent stopped, when the work is not to blame: a usage limit (a subscription's window, a rate
 * limit), or the service not answering. Null for everything else. A limit says when it resets when the agent
 * CLI does (Claude Code reports it in a `rate_limit_event`).
 */
export function stopReason(agent, stdout, text) {
  let until = null
  let rejected = false
  if (agent === 'claude') {
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes('"rate_limit_event"')) continue
      try {
        const info = JSON.parse(line).rate_limit_info
        if (info?.status === 'rejected') {
          rejected = true
          if (Number.isFinite(info.resetsAt)) until = info.resetsAt * 1000
        }
      } catch {}
    }
  }
  if (rejected || /\b(usage|rate|session|weekly|5-hour) limits?\b|limit reached|hit your limit|out of (extra )?usage|too many requests/i.test(text)) return { kind: 'limit', until }
  if (/overloaded|\b(500|502|503|529)\b|service unavailable|ECONNRESET|ETIMEDOUT|ENOTFOUND|network error|connection error/i.test(text)) return { kind: 'unavailable', until: null }
  return null
}

// A run that meets a limit does not fail its tickets: it waits, all of it, and takes them up again. The wait is
// the run's, not a ticket's: every ticket draws on the same limit.
const WAIT_LIMIT_MS = 15 * 60_000
const WAIT_UNAVAILABLE_MS = 2 * 60_000
const WAIT_MAX_MS = 6 * 3600_000
const MAX_UNAVAILABLE = 3
let waitUntil = 0
const unavailable = new Map()

function patchRun(patch) {
  const file = runFile()
  const info = readJson(file, null)
  if (!info || info.pid !== process.pid) return
  const next = { ...info, ...patch }
  for (const k of Object.keys(next)) if (next[k] === null && k === 'waiting') delete next[k]
  writeAtomic(file, JSON.stringify(next, null, 2))
}

/** Hold every stage until `until`. Says so in the run's file, where `status` and the app read it. */
function holdRun(until, reason) {
  if (until <= waitUntil) return
  waitUntil = until
  patchRun({ waiting: { until: new Date(until).toISOString(), reason } })
}

async function gate() {
  let waited = false
  while (Date.now() < waitUntil) {
    waited = true
    await new Promise((r) => setTimeout(r, Math.min(1000, waitUntil - Date.now())))
  }
  if (waited) patchRun({ waiting: null })
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

async function runAgentStage(ref, say) {
  const { config, stages, repo, local } = ctx()
  const { dir, job } = withLock(() => load(ref))
  const stageKey = job.stage
  const stage = stages[stageKey]
  const role = stage.role
  const startRound = job.round
  const { agent, bin, pre } = resolveAgent()
  const { model, effort } = roleSettings(config, local, role, agent)
  const asked = `${agent}:${model}`
  if (role !== 'planner' && !job.worktree) refuse(`${job.id} has no worktree for the ${role}`)
  const cwd = role === 'planner' ? repo : worktreePath(job)
  const roundDir = path.join(dir, `round-${job.round}`)
  fs.mkdirSync(roundDir, { recursive: true })
  const logFile = path.join(roundDir, `${stageKey}.log`)
  const finalFile = path.join(roundDir, `${stageKey}.final.md`)
  fs.rmSync(finalFile, { force: true })
  const args = [...pre, ...agentArgs({ agent, role, model, effort, cwd, jobDir: dir, finalFile })]
  const prompt = buildPrompt(dir, job, stageKey, role)
  // a limit met by another ticket holds this one too
  await gate()
  const startedAt = Date.now()
  say(`${job.id}: ${role} started (${asked}, round ${job.round})`)
  const fd = fs.openSync(logFile, 'w')
  fs.writeSync(fd, `[factory] ${new Date().toISOString()} ${agent} ${args.slice(pre.length).join(' ')}\n[factory] cwd: ${cwd}\n\n`)
  const r = await runProcess(bin, args, {
    cwd,
    input: prompt,
    logFd: fd,
    timeoutMs: (config.agent_timeout_s || 3600) * 1000,
    env: { ...stageEnv(role), FACTORY_RUNNER_AGENT: agent },
  })
  fs.writeSync(fd, `\n[factory] exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ' (timed out)' : ''}\n`)
  fs.closeSync(fd)
  const logRel = rel(dir, logFile)

  // The ticket may have been dropped or moved by hand while the agent ran: its output no longer applies.
  const current = withLock(() => load(ref).job)
  if (current.stage !== stageKey || current.round !== startRound) {
    addNote(ref, `${role} output discarded: the ticket moved to ${current.stage} while it ran`)
    return
  }
  let final = ''
  let failure = null
  // from here on the stage is credited to the model that really ran it, not to the alias it was asked for
  // (Codex prints its session header on stderr, which only the log file keeps.)
  let logged = ''
  try {
    logged = fs.readFileSync(logFile, 'utf8')
  } catch {}
  const facts = runFacts(agent, agent === 'claude' ? r.stdout || '' : logged)
  const by = `${agent}:${facts.model || model}`
  if (r.error) failure = r.error
  else if (r.timedOut) failure = `timed out after ${config.agent_timeout_s || 3600}s`
  else if (agent === 'claude') {
    const f = claudeFinal(r.stdout)
    if (r.code !== 0) failure = `exited ${r.code}${r.stdout.includes('"type":"result"') && !f.ok ? ` (${f.reason})` : ''}`
    else if (f.ok) final = f.text
    else failure = f.reason
  } else {
    if (r.code !== 0) failure = `exited ${r.code}`
    else if (fs.existsSync(finalFile)) final = fs.readFileSync(finalFile, 'utf8')
  }
  fs.rmSync(finalFile, { force: true })
  if (!failure && !final.trim()) failure = 'it returned no final message'
  // what the run took is recorded whether it worked or not: a failed stage was paid for too
  const spent = { stage: stageKey, round: startRound, role, by, agent, secs: Math.round((Date.now() - startedAt) / 1000), ...(effort !== 'default' && !facts.effort ? { effort } : {}), ...facts }
  if (failure) {
    const stop = stopReason(agent, agent === 'claude' ? r.stdout || '' : '', `${failure}\n${logged.split(/\r?\n/).slice(-15).join('\n')}`)
    const tries = stop?.kind === 'unavailable' ? (unavailable.get(job.id) || 0) + 1 : 0
    // FACTORY_WAIT_MS: a fixed wait, for the tests
    const fixed = Number(process.env.FACTORY_WAIT_MS) || 0
    const until = !stop ? 0 : fixed ? Date.now() + fixed : stop.kind === 'unavailable' ? Date.now() + WAIT_UNAVAILABLE_MS : stop.until && stop.until > Date.now() ? stop.until + 30_000 : Date.now() + WAIT_LIMIT_MS
    if (stop && tries <= MAX_UNAVAILABLE && until - Date.now() <= WAIT_MAX_MS) {
      // not the ticket's fault: it keeps its stage, the run waits, and the stage is run again
      unavailable.set(job.id, tries)
      const why = stop.kind === 'limit' ? 'a usage limit was reached' : 'the agent\'s service did not answer'
      holdRun(until, stop.kind === 'limit' ? 'usage limit' : 'service unavailable')
      withLock(() => {
        const { dir: d, job: j } = load(ref)
        log(j, 'waiting', `${stage.label} stopped: ${why} (${by}). The run tries again at ${clock(until)}.`, { result: 'WAIT', ...spent })
        save(d, j)
      })
      say(`${job.id}: ${role} stopped (${why}); waiting until ${clock(until)}`)
      await gate()
      return
    }
    withLock(() => {
      const { dir: d, job: j } = load(ref)
      log(j, 'agent', `${stage.label} (${by}) failed: ${failure}`, { result: 'ERROR', ...spent })
      save(d, j)
    })
    const limited = stop?.kind === 'limit' && stop.until ? ` The limit resets ${new Date(stop.until).toLocaleString()}: \`unblock\` it then.` : ''
    const j = blockQuietly(ref, `${role} (${by}) failed: ${failure}.${limited} Log: ${logRel}`)
    if (j) say(`${job.id}: ${role} failed → blocked (${failure})`)
    return
  }

  const out = outputPath(dir, job, stageKey)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (role === 'reviewer') {
    const { review, journal } = splitReview(final)
    fs.writeFileSync(out, review + '\n')
    fs.rmSync(path.join(dir, 'journal.md'), { force: true })
    if (journal) fs.writeFileSync(path.join(dir, 'journal.md'), journal + '\n')
  } else {
    fs.writeFileSync(out, final.trim() + '\n')
  }
  if (role === 'builder') {
    const err = commitLeftovers(job, job.round)
    if (err) {
      blockQuietly(ref, err)
      say(`${job.id}: blocked (${err})`)
      return
    }
  }
  const text = fs.readFileSync(out, 'utf8')
  const got = verdict(text)
  withLock(() => {
    const { dir: d, job: j } = load(ref)
    unavailable.delete(job.id)
    log(j, 'agent', `${stage.label} (${by}): ${firstLine(text).slice(0, 200)}`, { result: got, ...spent })
    save(d, j)
  })
  const dst = Object.entries(stage.next || {}).find(([, need]) => need === got)?.[0]
  if (!dst) {
    blockQuietly(ref, `${role}: ${firstLine(text).slice(0, 300) || 'no verdict'}`)
    say(`${job.id}: ${stageKey} ${got || '?'} → blocked`)
    return
  }
  moveOrBlock(ref, dst, `${stageKey} ${got}`, say)
}

function moveOrBlock(ref, dst, what, say) {
  try {
    const j = advance(ref, dst)
    say(`${j.id}: ${what} → ${dst} (round ${j.round})`)
  } catch (e) {
    if (!(e instanceof Refusal)) throw e
    const j = blockQuietly(ref, e.message)
    if (j) say(`${j.id}: ${what} → blocked (${e.message})`)
  }
}

// ---------------------------------------------------------------- the run

function runFile() {
  return path.join(ctx().factory, 'run', 'run.json')
}

function currentRun() {
  const info = readJson(runFile(), null)
  return info && isAlive(info.pid) ? info : null
}

// One run at a time: two would start the same stage twice. The run file is created exclusively, and one
// whose process is gone is taken over.
function claimRun(args) {
  const file = runFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, started_at: now(), args, log: process.env.FACTORY_RUN_LOG || null }, null, 2))
      fs.closeSync(fd)
      const release = () => {
        try {
          if (readJson(file, {}).pid === process.pid) fs.unlinkSync(file)
        } catch {}
      }
      process.on('exit', release)
      return release
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const info = currentRun()
      if (info) refuse(`a run is already in progress (pid ${info.pid}, since ${info.started_at}); \`status\` shows it, \`cancel\` stops it`)
      fs.rmSync(file, { force: true })
    }
  }
  refuse('could not claim the run')
}

async function runPipeline({ ref, once, say }) {
  const { config, stages, order, idle } = ctx()
  const target = ref ? load(ref).job.id : null
  const active = new Map()
  const stuck = new Map()
  // landings queue up: one at a time
  let landing = Promise.resolve()
  // the activity's length too: times are kept to the second, and a step can do its work within one
  const signature = (j) => `${j.stage}|${j.round}|${j.updated_at}|${j.activity.length}`
  const step = (job) => {
    const stage = stages[job.stage]
    if (job.stage === order[0] || (!stage.role && !stage.run)) {
      const next = Object.keys(stage.next || {})
      if (next.length !== 1) return () => blockQuietly(job.id, `stage ${job.stage} has no role or checks and ${next.length} next stages`)
      return () => moveOrBlock(job.id, next[0], job.stage, say)
    }
    if (stage.role) return () => runAgentStage(job.id, say)
    return async () => {
      const result = await runChecks(job.id)
      const dst = Object.entries(stage.next || {}).find(([, need]) => need === result)?.[0]
      if (!dst) blockQuietly(job.id, `checks ${result} and no next stage for it`)
      else moveOrBlock(job.id, dst, `check ${result}`, say)
    }
  }
  for (let pass = 0; ; pass++) {
    const jobs = allJobs()
    let free = config.concurrency - jobs.filter((j) => !idle.has(j.stage)).length
    for (const job of jobs) {
      if (target && job.id !== target) continue
      if (active.has(job.id) || stuck.get(job.id) === signature(job)) continue
      if (!isOpen(job) || !stages[job.stage]) continue
      if (job.stage === order[0]) {
        // An explicit `run <id>` works that ticket now; otherwise the inbox waits for a free slot.
        if (!target && free <= 0) continue
        free--
      }
      const before = signature(job)
      const task = Promise.resolve()
        .then(step(job))
        .catch((e) => {
          const msg = e instanceof Refusal ? e.message : e.stack || String(e)
          blockQuietly(job.id, `the factory could not run ${job.stage}: ${msg.split('\n')[0]}`)
          say(`${job.id}: ${job.stage} → blocked (${msg.split('\n')[0]})`)
        })
        .then(async () => {
          // opt-in (config.json "auto_land"): a ticket that finishes lands at once, for work that should keep moving
          const now = allJobs().find((j) => j.id === job.id)
          if (config.auto_land && now && stages[now.stage]?.terminal && !now.landed && !stages[job.stage]?.terminal) {
            await landing
            landing = land(job.id, say).catch((e) => say(`${job.id}: not landed (${e instanceof Refusal ? e.message : String(e).split('\n')[0]})`))
            await landing
          }
        })
        .then(() => {
          // A step that changed nothing must not be retried forever in this run.
          const after = allJobs().find((j) => j.id === job.id)
          if (after && signature(after) === before) stuck.set(job.id, before)
        })
      active.set(job.id, task)
    }
    if (!active.size) break
    if (once) {
      await Promise.all(active.values())
      break
    }
    const done = await Promise.race([...active].map(([id, p]) => p.then(() => id)))
    active.delete(done)
  }
}

// ---------------------------------------------------------------- journal: format

function isPlainString(v) {
  return typeof v === 'string' && v === v.trim() && v !== '' && !v.includes('\n') && !/^[[{"]/.test(v) && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(v)
}

function formatValue(v) {
  return isPlainString(v) ? v : JSON.stringify(v)
}

function parseValue(v) {
  v = v.trim()
  if (/^[[{"]/.test(v) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(v)) {
    try {
      return JSON.parse(v)
    } catch {}
  }
  return v
}

const META_ORDER = ['id', 'at', 'title', 'kind', 'ticket', 'branch', 'commits', 'files', 'tags', 'by']

/** An entry as text: frontmatter (every value JSON or a bare string), then the markdown body. */
export function formatEntry(meta, body) {
  const keys = [...META_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !META_ORDER.includes(k))]
  const lines = keys.filter((k) => meta[k] !== undefined && meta[k] !== null).map((k) => `${k}: ${formatValue(meta[k])}`)
  return `---\n${lines.join('\n')}\n---\n${body.trim()}\n`
}

export function parseEntry(text) {
  text = text.replace(/\r\n/g, '\n')
  const meta = {}
  if (!text.startsWith('---\n')) return { meta, body: text.trim() }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta, body: text.trim() }
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/)
    if (m) meta[m[1]] = parseValue(m[2])
  }
  return { meta, body: text.slice(end + 4).replace(/^[^\n]*\n?/, '').trim() }
}

/** `## Heading` sections of a body, keyed by lowercased heading. */
export function sections(body) {
  const out = {}
  let key = null
  for (const line of body.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      key = m[1].toLowerCase()
      out[key] = []
    } else if (key) out[key].push(line)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]))
}

/**
 * What the reviewer (or `journal add`) supplies: a few `key: value` lines (title, kind, tags), a blank line,
 * then the prose sections. Everything else in an entry is computed from git and the ticket.
 */
export function parseJournalDraft(text) {
  text = text.replace(/\r\n/g, '\n').trim()
  // Agents sometimes wrap the whole entry in a code fence, copying the role prompt's example.
  const fenced = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenced) text = fenced[1]
  const lines = text.split('\n')
  const head = {}
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(title|kind|tags)\s*:\s*(.*)$/i)
    if (!m) break
    head[m[1].toLowerCase()] = m[2].trim()
  }
  return {
    title: head.title || '',
    kind: (head.kind || '').toLowerCase(),
    tags: splitList(head.tags || '').map((t) => t.toLowerCase()),
    body: lines.slice(i).join('\n').trim(),
  }
}

export function validateDraft(d) {
  const errors = []
  if (!d.title) errors.push('no title')
  if (!KINDS.includes(d.kind)) errors.push(`kind must be one of ${KINDS.join(', ')} (got '${d.kind || ''}')`)
  const s = sections(d.body)
  if (!s['what changed']) errors.push('no "## What changed" section')
  if (!s.why) errors.push('no "## Why" section')
  return errors
}

function splitList(s) {
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function journalDir(root) {
  return path.join(root, '.factory', 'journal')
}

function entryId(title, at, roots) {
  const base = `${at.slice(0, 10)}-${slug(title, 6)}`
  const taken = (id) => roots.some((r) => fs.existsSync(path.join(journalDir(r), at.slice(0, 4), `${id}.md`)))
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}-${n}`
  return id
}

function writeEntry(root, meta, body) {
  const file = path.join(journalDir(root), meta.at.slice(0, 4), `${meta.id}.md`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, formatEntry(meta, body))
  return file
}

function notJournal(files) {
  return files.filter((f) => !f.startsWith('.factory/journal/'))
}

/**
 * What a ticket's stages took, for its journal entry: one short row per agent run, so the cost of a change
 * travels with the change (and with nothing else: no file of its own, nothing to merge).
 * A row is [stage, round, agent:model, result, seconds, turns, input, cache read, cache write, output, cost in USD];
 * a number the agent did not report is 0. Codex reports one total: it is under input.
 */
export const USAGE_COLUMNS = ['stage', 'round', 'by', 'result', 'secs', 'turns', 'input', 'cache_read', 'cache_write', 'output', 'cost_usd']
export function usageRows(job) {
  return job.activity
    .filter((a) => (a.kind === 'agent' || a.kind === 'waiting') && a.by)
    .map((a) => {
      const split = a.input || a.cache_read || a.cache_write || a.output
      return [a.stage || a.role || '', a.round ?? 0, a.by, a.result || '', a.secs || 0, a.turns || 0, split ? a.input || 0 : a.tokens || 0, a.cache_read || 0, a.cache_write || 0, a.output || 0, a.cost_usd || 0]
    })
}

function commitTicketJournal(dir, job) {
  const { config, repo } = ctx()
  const draftFile = path.join(dir, 'journal.md')
  if (!fs.existsSync(draftFile)) refuse(`${job.id} has no journal.md: the reviewer's PASS must include the journal part`)
  const draft = parseJournalDraft(fs.readFileSync(draftFile, 'utf8'))
  if (!draft.kind) draft.kind = 'feature'
  if (!draft.title) draft.title = job.title
  const errors = validateDraft(draft)
  if (errors.length) refuse(`${job.id}'s journal.md is not valid: ${errors.join('; ')}`)
  if (!job.worktree) refuse(`${job.id} has no worktree to commit its journal entry on`)
  const wt = worktreePath(job)
  const base = config.base_branch
  const at = nowZ()
  // Facts come from git and the ticket, never from an agent.
  const by = {}
  for (const a of job.activity) if (a.kind === 'agent' && a.role && a.by) by[a.role] = a.by
  // a ticket that finishes a second time (it came back from landing) keeps its one entry, brought up to date
  const before = job.entry && fs.existsSync(path.join(wt, job.entry.file)) ? job.entry : null
  const meta = {
    id: before ? before.id : entryId(draft.title, at, [wt, repo]),
    at: before ? before.at : at,
    title: draft.title,
    kind: draft.kind,
    ticket: job.id,
    branch: job.branch,
    commits: gitLines(['log', '--reverse', '--format=%h', `${base}..HEAD`], wt),
    files: notJournal(gitLines(['diff', '--name-only', `${base}...HEAD`], wt)),
    tags: draft.tags,
    by,
    usage: usageRows(job),
  }
  if (!meta.usage.length) delete meta.usage
  const file = writeEntry(wt, meta, draft.body)
  const relFile = posix(path.relative(wt, file))
  job.entry = { id: meta.id, at: meta.at, file: relFile }
  let r = git(['add', '--', relFile], wt)
  if (r.ok) r = git(['commit', '-q', '-m', `Journal: ${meta.title}\n\nFactory ticket ${job.id}.`, '--', relFile], wt)
  if (!r.ok) {
    fs.rmSync(file, { force: true })
    refuse(`could not commit the journal entry on ${job.branch}: ${r.err}`)
  }
  return meta
}

// ---------------------------------------------------------------- journal: read

function readEntries() {
  const roots = [...new Set([ctx().repo, checkoutRoot()])]
  const seen = new Map()
  for (const root of roots) {
    const jd = journalDir(root)
    if (!fs.existsSync(jd)) continue
    for (const year of fs.readdirSync(jd).sort()) {
      const yd = path.join(jd, year)
      if (!fs.statSync(yd).isDirectory()) continue
      for (const name of fs.readdirSync(yd).sort()) {
        if (!name.endsWith('.md')) continue
        const file = path.join(yd, name)
        const { meta, body } = parseEntry(fs.readFileSync(file, 'utf8'))
        const id = String(meta.id || name.slice(0, -3))
        if (seen.has(id)) continue
        seen.set(id, toEntry(meta, body, id, file))
      }
    }
  }
  return sortEntries([...seen.values()])
}

function toEntry(meta, body, id, file = null) {
  const list = (v) => (Array.isArray(v) ? v.map(String) : v ? splitList(v) : [])
  return {
    id,
    at: String(meta.at || id.slice(0, 10)),
    title: String(meta.title || id),
    kind: String(meta.kind || ''),
    ticket: meta.ticket ? String(meta.ticket) : null,
    branch: meta.branch ? String(meta.branch) : null,
    commits: list(meta.commits),
    files: list(meta.files),
    tags: list(meta.tags),
    by: meta.by ?? null,
    body,
    file,
  }
}

function sortEntries(entries) {
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

function findEntry(id) {
  const entries = readEntries()
  const exact = entries.find((e) => e.id === id)
  if (exact) return exact
  const hits = entries.filter((e) => e.id.startsWith(id))
  if (hits.length === 1) return hits[0]
  refuse(hits.length ? `'${id}' matches ${hits.length} entries: ${hits.slice(0, 5).map((e) => e.id).join(', ')}` : `no journal entry '${id}' (see \`journal list\`)`)
}

// ---------------------------------------------------------------- recall

const STOP = new Set('a an and are as at be but by for from has have in into is it its of on or that the this to was were will with not no'.split(' '))

/** A light stemmer, applied alike to entries and queries, so "toggles" finds "toggle". */
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function words(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map(stem)
}

function pathTerms(file) {
  const parts = file.split('/')
  const terms = [`path:${file}`, `base:${parts[parts.length - 1]}`]
  for (let i = 1; i < parts.length; i++) terms.push(`dir:${parts.slice(0, i).join('/')}`)
  return terms
}

export function looksLikePath(q) {
  return /[\\/]/.test(q) || /^[\w.-]+\.[A-Za-z][\w]{0,7}$/.test(q)
}

function normPath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

const FIELD_WEIGHT = { title: 3, tags: 2, files: 1.5, body: 1, paths: 1 }

function indexEntry(e) {
  const fields = { title: words(e.title), tags: words(e.tags.join(' ')), files: words(e.files.join(' ')), body: words(e.body), paths: e.files.flatMap(pathTerms) }
  const tf = new Map()
  let len = 0
  for (const [field, terms] of Object.entries(fields)) {
    for (const t of terms) {
      tf.set(t, (tf.get(t) || 0) + FIELD_WEIGHT[field])
      len += FIELD_WEIGHT[field]
    }
  }
  return { tf, len }
}

export function queryTerms(query) {
  const terms = new Map()
  const add = (t, w) => terms.set(t, Math.max(terms.get(t) || 0, w))
  for (const part of String(query).split(/\s+/).filter(Boolean)) {
    if (looksLikePath(part)) {
      const p = normPath(part)
      // A path finds the entries that touched it, then those that touched its folder.
      add(`path:${p}`, 4)
      add(`dir:${p}`, 3)
      if (!p.includes('/')) add(`base:${p}`, 3)
      // A file also finds its neighbours; a folder only what is inside it, not its parent's other children.
      const dir = p.split('/').slice(0, -1).join('/')
      if (dir && /\.[^./]+$/.test(p)) add(`dir:${dir}`, 1)
      // Only the file's own name counts as words: folder names like "src" are in every entry.
      for (const w of words(p.split('/').pop().replace(/\.[^.]*$/, ''))) add(w, 0.3)
    } else for (const w of words(part)) add(w, 1)
  }
  return terms
}

/** BM25 over title, tags, files and prose, with path-aware terms. Deterministic: ties go to the newer entry. */
export function rank(entries, query, limit = 5) {
  const q = queryTerms(query)
  if (!q.size || !entries.length) return []
  const docs = entries.map((e) => ({ e, ...indexEntry(e) }))
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1
  const df = new Map()
  for (const d of docs) for (const t of q.keys()) if (d.tf.has(t)) df.set(t, (df.get(t) || 0) + 1)
  const k1 = 1.2
  const b = 0.75
  const scored = []
  for (const d of docs) {
    let score = 0
    for (const [t, w] of q) {
      const tf = d.tf.get(t)
      if (!tf) continue
      const n = df.get(t)
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      score += w * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.len) / avg)))
    }
    if (score > 0) scored.push({ entry: d.e, score })
  }
  scored.sort((x, y) => y.score - x.score || (x.entry.at < y.entry.at ? 1 : x.entry.at > y.entry.at ? -1 : 0) || (x.entry.id < y.entry.id ? -1 : 1))
  return scored.slice(0, limit).map((s) => ({ ...s, snippet: snippet(s.entry, q) }))
}

function snippet(e, q) {
  const want = new Set([...q.keys()].filter((t) => !t.includes(':')))
  let best = ''
  let bestScore = -1
  for (const line of e.body.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const score = words(l).filter((w) => want.has(w)).length
    if (score > bestScore) {
      best = l
      bestScore = score
    }
  }
  return clip(best.replace(/^[-*]\s+/, ''), 200)
}

function clip(s, n) {
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s
}

// ---------------------------------------------------------------- context

function fileMatch(files, target) {
  let best = 0
  const tdir = target.split('/').slice(0, -1).join('/')
  for (const f of files) {
    if (f === target) best = Math.max(best, 3)
    else if (f.startsWith(target + '/')) best = Math.max(best, 2)
    else if (tdir && f.split('/').slice(0, -1).join('/') === tdir) best = Math.max(best, 1)
  }
  return best
}

function entryLine(e) {
  const files = e.files.slice(0, 2).join(', ') + (e.files.length > 2 ? ` (+${e.files.length - 2})` : '')
  return `- ${e.at.slice(0, 10)} ${e.kind || '-'}: ${clip(e.title, 90)}${files ? ` [${files}]` : ''} (${e.id})`
}

function trimmedEntry(e) {
  const s = sections(e.body)
  const out = [entryLine(e)]
  for (const [key, label, n] of [['what changed', 'What changed', 240], ['why', 'Why', 320], ['decisions', 'Decisions', 240]]) {
    if (s[key]) out.push(`  ${label}: ${clip(s[key].replace(/^[-*]\s+/gm, ''), n)}`)
  }
  return out
}

// Every section, each cut to a few lines: a long "What changed" must not push "Why" out.
function fullEntry(e, perSection = 4) {
  const lines = [entryLine(e)]
  let cut = false
  let kept = 0
  for (const line of e.body.split('\n')) {
    if (!line.trim()) continue
    if (/^#{1,6}\s/.test(line)) {
      lines.push(`  ${clip(line, 120)}`)
      kept = 0
    } else if (kept < perSection) {
      lines.push(`  ${clip(line, 240)}`)
      kept++
    } else cut = true
  }
  if (cut) lines.push(`  ... (\`journal show ${e.id}\` for all of it)`)
  return lines
}

function topCounts(values, n) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k, c]) => `${k} (${c})`)
}

function folderOf(f) {
  const parts = f.split('/')
  return parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? parts[0] : '.'
}

/**
 * The layers an agent loads before work, bounded however long the history grows: rules; tickets; the
 * journal (matches for --for in full, the latest few trimmed, then one line each, then one line a month).
 */
export function buildContext({ name, rules, tickets, run, entries, skills = [], forPaths = [], recent = 5, titles = 20 }) {
  const L = []
  L.push(`# Factory context: ${name}`, '')
  L.push('## Workflow')
  L.push('- CLI: `node .factory/cli.mjs <command>` (`help` lists everything).')
  L.push('- More than a trivial fix: `new "<title>" --body "<details>"`, then `run --detach`. `status` shows progress.')
  L.push('- A change you make outside a ticket: record why with `journal add` (facts and reasons only).')
  L.push('')
  const ruleLines = (rules || '').trim().split(/\r?\n/)
  L.push('## Rules (.factory/rules.md)')
  if (!rules?.trim()) L.push('(no rules written yet)')
  else {
    // The rules' own headings go two levels down, so they nest under this section's heading.
    L.push(...ruleLines.slice(0, 60).map((l) => clip(l.replace(/^(#{1,4})\s/, '##$1 '), 240) || ''))
    if (ruleLines.length > 60) L.push(`... (${ruleLines.length - 60} more lines in .factory/rules.md)`)
  }
  L.push('')

  // only their names and what each is for: the text of a skill is read when a task calls for it
  if (skills.length) {
    L.push('## Skills (.factory/skills/)')
    L.push(...skillLines(skills.slice(0, 40), 'When one fits the task, read it first: `node .factory/cli.mjs skill <name>`.'))
    if (skills.length > 40) L.push(`... (${skills.length - 40} more: \`node .factory/cli.mjs skills\`)`)
    L.push('')
  }

  L.push('## Tickets')
  const open = tickets.filter((t) => t.open)
  const blocked = tickets.filter((t) => t.stage === BLOCKED)
  const done = tickets.filter((t) => t.done).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
  const capped = (list, n, fmt) => [...list.slice(0, n).map(fmt), ...(list.length > n ? [`  ... and ${list.length - n} more (\`status\`)`] : [])]
  if (!open.length && !blocked.length && !done.length) L.push('- none open')
  if (open.length) L.push('Open:', ...capped(open, 10, (t) => `  - ${t.id}: ${t.stage}, round ${t.round}: ${clip(t.title, 80)}`))
  if (blocked.length || done.length) {
    L.push('Waiting on the user:')
    L.push(...capped(blocked, 8, (t) => `  - ${t.id}: blocked: ${clip(t.blocked_reason || '', 140)}`))
    L.push(...capped(done, 5, (t) => `  - ${t.id}: done, ${t.branch || 'its branch'} is ready to land (\`land ${t.id.split('-')[0]}\`)`))
  }
  L.push(run ? `Run: in progress (pid ${run.pid}, since ${run.started_at})` : 'Run: none in progress')
  L.push('')

  L.push(`## Journal (${entries.length} entries: why things changed)`)
  const shown = new Set()
  const targets = forPaths.map(normPath).filter(Boolean)
  if (targets.length) {
    const hits = entries
      .map((e) => ({ e, score: Math.max(...targets.map((t) => fileMatch(e.files, t))) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || (a.e.at < b.e.at ? 1 : -1))
    L.push(`### Touching ${targets.join(', ')}`)
    if (!hits.length) L.push('- no entry touched these paths or their folders')
    for (const h of hits.slice(0, 5)) {
      L.push(...fullEntry(h.e))
      shown.add(h.e.id)
    }
    if (hits.length > 5) {
      L.push('Also touched them:')
      for (const h of hits.slice(5, 15)) {
        L.push(entryLine(h.e))
        shown.add(h.e.id)
      }
      if (hits.length > 15) L.push(`... and ${hits.length - 15} more (\`recall ${targets[0]}\`)`)
    }
  }
  const rest = entries.filter((e) => !shown.has(e.id))
  if (rest.length) {
    L.push('### Recent')
    for (const e of rest.slice(0, recent)) L.push(...trimmedEntry(e))
  }
  const middle = rest.slice(recent, recent + titles)
  if (middle.length) L.push('### Earlier', ...middle.map(entryLine))
  const old = rest.slice(recent + titles)
  if (old.length) {
    L.push('### Older, by month')
    const months = new Map()
    for (const e of old) {
      const m = e.at.slice(0, 7)
      if (!months.has(m)) months.set(m, [])
      months.get(m).push(e)
    }
    const list = [...months]
    for (const [m, es] of list.slice(0, 12)) {
      const tags = topCounts(es.flatMap((e) => e.tags), 3)
      const folders = topCounts(es.flatMap((e) => [...new Set(e.files.map(folderOf))]), 3)
      L.push(`- ${m}: ${es.length} entr${es.length === 1 ? 'y' : 'ies'}${tags.length ? `; tags ${tags.join(', ')}` : ''}${folders.length ? `; folders ${folders.join(', ')}` : ''}`)
    }
    if (list.length > 12) {
      const earlier = list.slice(12)
      L.push(`- before ${earlier[0][0]}: ${earlier.reduce((s, [, es]) => s + es.length, 0)} entries since ${earlier[earlier.length - 1][0]}`)
    }
  }
  if (!entries.length) L.push('- no entries yet')
  L.push('', 'Dig deeper: `node .factory/cli.mjs recall <words or a path>`, then `node .factory/cli.mjs journal show <id>`.')
  return L.join('\n') + '\n'
}

function contextData(forPaths) {
  const { config, factory } = ctx()
  const rulesFile = path.join(factory, 'rules.md')
  const tickets = allJobs().map((j) => ({
    id: j.id,
    title: j.title,
    stage: j.stage,
    round: j.round,
    branch: j.branch || null,
    blocked_reason: j.blocked_reason || null,
    updated_at: j.updated_at,
    open: isOpen(j),
    done: !!ctx().stages[j.stage]?.terminal && !isMerged(j),
  }))
  const root = checkoutRoot()
  const paths = forPaths.map((p) => {
    const abs = path.resolve(p)
    const r = path.relative(root, abs)
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? posix(r) : normPath(p)
  })
  return {
    name: config.name || 'Factory',
    rules: fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : '',
    tickets,
    run: currentRun(),
    entries: readEntries(),
    skills: readSkills(factory).map(({ body, ...s }) => s),
    forPaths: paths,
    recent: config.journal?.recent ?? 5,
    titles: config.journal?.titles ?? 20,
  }
}

// ---------------------------------------------------------------- the app

function appHome() {
  return path.join(os.homedir(), '.factory', 'app')
}

export function assetName(version, platform = process.platform, arch = process.arch) {
  if (platform === 'linux') return `Factory-${version}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`
  if (platform === 'win32') return `Factory-${version}-win-x64.zip`
  if (platform === 'darwin') return `Factory-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
  refuse(`no Factory app build for ${platform}`)
}

function installedApp() {
  if (process.env.FACTORY_APP_BIN) return { version: 'env', bin: process.env.FACTORY_APP_BIN }
  const cur = readJson(path.join(appHome(), 'current.json'), null)
  return cur?.bin && fs.existsSync(cur.bin) ? cur : null
}

function findAppBin(root, depth = 4) {
  const target = IS_WIN ? 'Factory.exe' : process.platform === 'darwin' ? 'Factory.app' : 'factory-app'
  let level = [root]
  for (let d = 0; d <= depth && level.length; d++) {
    const next = []
    for (const dir of level) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = path.join(dir, ent.name)
        if (ent.name === target) {
          if (process.platform === 'darwin') {
            const bin = path.join(p, 'Contents', 'MacOS', 'Factory')
            if (fs.existsSync(bin)) return bin
          } else if (ent.isFile()) return p
        }
        if (ent.isDirectory() && !ent.name.endsWith('.app')) next.push(p)
      }
    }
    level = next
  }
  return null
}

async function fetchAsset(asset, version, dest, say) {
  const base = process.env.FACTORY_RELEASE_BASE
  const repo = process.env.FACTORY_REPO || DEFAULT_REPO
  const tag = `app-v${version}`
  if (base && !/^https?:\/\//i.test(base)) {
    const src = path.join(base, asset)
    if (!fs.existsSync(src)) refuse(`${src} does not exist (FACTORY_RELEASE_BASE)`)
    fs.copyFileSync(src, dest)
    return
  }
  const errors = []
  // A private repo's assets need a login: gh has one when it is installed and logged in.
  if (!base && which('gh') && spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', windowsHide: true }).status === 0) {
    say(`Downloading ${asset} from ${repo} (${tag}) with gh`)
    const r = spawnSync('gh', ['release', 'download', tag, '-R', repo, '-p', asset, '-O', dest, '--clobber'], { encoding: 'utf8', windowsHide: true })
    if (r.status === 0) return
    errors.push(`gh: ${(r.stderr || '').trim()}`)
  }
  const url = base ? `${base.replace(/\/+$/, '')}/${asset}` : `https://github.com/${repo}/releases/download/${tag}/${asset}`
  say(`Downloading ${url}`)
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
    return
  } catch (e) {
    errors.push(`${url}: ${e.message}`)
  }
  refuse(`could not download the Factory app ${version}:\n  ${errors.join('\n  ')}\nSet FACTORY_APP_VERSION to a released version, or FACTORY_APP_BIN to an app you have.`)
}

function extract(archive, dir) {
  let r
  if (process.platform === 'linux') r = spawnSync('tar', ['-xzf', archive, '-C', dir], { encoding: 'utf8' })
  else if (IS_WIN) {
    // Windows' own bsdtar reads zip files; a GNU tar earlier on PATH (Git Bash) does not, so name it fully.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    r = spawnSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', archive, '-C', dir], { encoding: 'utf8', windowsHide: true })
  } else r = spawnSync('ditto', ['-x', '-k', archive, dir], { encoding: 'utf8' })
  if (r.status !== 0) refuse(`could not extract ${archive}: ${(r.stderr || r.error?.message || '').trim()}`)
}

async function downloadApp(version, say) {
  const home = appHome()
  const asset = assetName(version)
  const downloads = path.join(home, 'downloads')
  fs.mkdirSync(downloads, { recursive: true })
  const archive = path.join(downloads, asset)
  await fetchAsset(asset, version, archive, say)
  // Extract next to the final folder and rename it into place, so a broken download never looks installed.
  const staging = path.join(home, `.${version}.partial-${process.pid}`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  extract(archive, staging)
  const found = findAppBin(staging)
  if (!found) {
    fs.rmSync(staging, { recursive: true, force: true })
    refuse(`${asset} has no ${IS_WIN ? 'Factory.exe' : process.platform === 'darwin' ? 'Factory.app' : 'factory-app'} inside`)
  }
  const final = path.join(home, version)
  fs.rmSync(final, { recursive: true, force: true })
  fs.renameSync(staging, final)
  fs.rmSync(archive, { force: true })
  const bin = path.join(final, path.relative(staging, found))
  if (!IS_WIN) fs.chmodSync(bin, 0o755)
  const cur = { version, bin }
  writeAtomic(path.join(home, 'current.json'), JSON.stringify(cur, null, 2) + '\n')
  say(`Installed the Factory app ${version} in ${final}`)
  return cur
}

async function ensureApp(say) {
  const have = installedApp()
  if (process.env.FACTORY_APP_BIN) return have
  const want = process.env.FACTORY_APP_VERSION || kitVersion()
  if (have && (!want || have.version === want)) return have
  if (!want) refuse('no app version to download: set FACTORY_APP_VERSION')
  try {
    return await downloadApp(want, say)
  } catch (e) {
    if (!have || !(e instanceof Refusal)) throw e
    say(`Could not get the app ${want} (${e.message.split('\n')[0]}); opening the installed ${have.version}.`)
    return have
  }
}

function waitExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: null, signal: null, error: e.message })
    })
  })
}

/** Start the app detached. A Chromium sandbox failure on Linux (restricted user namespaces) is retried once. */
async function launchApp(bin, args, { waitMs, say }) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  fs.mkdirSync(appHome(), { recursive: true })
  const logFile = path.join(appHome(), 'launch.log')
  const attempt = async (extra) => {
    const fd = fs.openSync(logFile, 'w')
    const child = spawnCmd(bin, [...extra, ...args], { detached: true, stdio: ['ignore', fd, fd], env })
    fs.closeSync(fd)
    const exit = await waitExit(child, waitMs)
    if (!exit) child.unref()
    return { exit, output: fs.readFileSync(logFile, 'utf8') }
  }
  let r = await attempt([])
  if (process.platform === 'linux' && r.exit && r.exit.code !== 0 && /sandbox/i.test(r.output)) {
    say('The app hit Chromium\'s sandbox restriction (unprivileged user namespaces); retrying with --no-sandbox.')
    r = await attempt(['--no-sandbox'])
  }
  if (r.exit?.error) refuse(`could not start ${bin}: ${r.exit.error}`)
  return r
}

// ---------------------------------------------------------------- doctor

function claudeImportsAgents(repo) {
  for (const f of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')]) {
    const p = path.join(repo, f)
    if (!fs.existsSync(p)) continue
    const agents = path.join(repo, 'AGENTS.md')
    if (fs.existsSync(agents) && fs.realpathSync(p) === fs.realpathSync(agents)) return f
    if (/^@(\.\/|\.\.\/)?AGENTS\.md\s*$/m.test(fs.readFileSync(p, 'utf8'))) return f
  }
  return null
}

function doctorChecks() {
  const out = []
  const add = (id, ok, text) => out.push({ id, ok, text })
  const major = Number(process.versions.node.split('.')[0])
  add('node', major >= 20, `node ${process.versions.node}${major >= 20 ? '' : ' (20 or newer is needed)'}`)
  let c = null
  try {
    c = ctx()
  } catch (e) {
    add('factory', false, e.message)
    return out
  }
  const isGit = git(['rev-parse', '--is-inside-work-tree'], c.repo).ok
  add('git', isGit, isGit ? `git repo at ${c.repo}` : `${c.repo} is not a git repo`)
  const v = kitVersion()
  add('kit', !!v, v ? `kit ${v}` : 'no .factory/version (reinstall with the installer)')
  const agentsFile = path.join(c.repo, 'AGENTS.md')
  const block = fs.existsSync(agentsFile) && fs.readFileSync(agentsFile, 'utf8').includes('<!-- factory:start -->')
  add('agents-md', block, block ? 'AGENTS.md has the Factory block' : 'AGENTS.md has no Factory block (run the installer with --update)')
  const claude = claudeImportsAgents(c.repo)
  add('claude-md', !!claude, claude ? `${posix(claude)} loads AGENTS.md for Claude Code` : 'no CLAUDE.md imports AGENTS.md (run the installer with --update)')
  const checks = c.config.checks || []
  add('checks', checks.length > 0, checks.length ? `${checks.length} check${checks.length > 1 ? 's' : ''} configured` : 'no checks configured: add commands to "checks" in .factory/config.json')
  const found = ['claude', 'codex'].filter((n) => which(n))
  add('agents', found.length > 0, found.length ? `agent CLIs on PATH: ${found.join(', ')}` : 'neither claude nor codex is on PATH')
  const app = installedApp()
  add('app', !!app, app ? `app ${app.version} at ${app.bin}` : 'app not installed (`start` downloads it)')
  const n = readEntries().length
  add('journal', true, `${n} journal entr${n === 1 ? 'y' : 'ies'}`)
  const run = currentRun()
  add('run', true, run ? `a run is in progress (pid ${run.pid}, since ${run.started_at})` : 'no run in progress')
  return out
}

// ---------------------------------------------------------------- commands

const HELP = `Factory CLI: node .factory/cli.mjs <command>      (<id> is a ticket's full id or its number)

Tickets
  new <title...> [--body <text>]     create a ticket in the inbox (body from --body or stdin); prints the id last
  list [--json]                      every ticket: id, stage, round, title
  show <id>                          a ticket's job.json
  status [--json]                    what is where, what waits on you, whether a run is in progress
  note <id> <text...>                add a line to a ticket's activity
  block <id> -m <reason>             park a ticket for a human
  unblock <id> [<stage>] [-m <note>] back to the stage it was blocked in, or to <stage>
  drop <id> -m <reason>              close a ticket without doing it (it stays, with its branch)
  land <id>                          bring a finished ticket into the base branch: merges the base into it, runs the
                                     checks on the result, then moves the base branch; what conflicts goes back to build
  delete <id> -m <reason>            remove a ticket for good, with its worktree and branch; the journal records it
  advance <id> <stage> [-m <note>]   move a ticket by hand; refused unless config.json and its files allow it
  check <id>                         run the checks for a ticket in its check stage; prints CHECK: PASS or FAIL
  checks                             run the checks in the checkout you are in: a line per check that passes, the
                                     end of the output of one that fails, all of it in .factory/cache/checks.log

Pipeline
  run [<id>] [--once] [--detach]     work open tickets through their stages, concurrency at a time
                                     --once: one step each, then return; --detach: in the background
  cancel                             stop a background run

Skills (how to do one kind of task in this repo: .factory/skills/<name>.md)
  skills [--json]                    the skills: name and what each is for
  skill <name>                       read one

Journal (why things changed)
  context [--for <path>]... [--json] what to load before work: rules, tickets, the journal in layers
  journal add --title <t> [--kind k] [--ticket id] [--tags a,b] [--files a,b] [--commit sha]...
              [--what <text> --why <text> [--decision <text>]... [--watch <text>]...]
                                     record why a change outside a ticket was made (prose on stdin, or the flags)
  journal list [--json] [--limit n]
  journal show <id>
  recall <query...> [--limit n] [--json]   find entries by words or by a file or folder path

App
  start                              open the Factory desktop app on this repo, then print the context
  stop                               close the app
  doctor [--json]                    check the setup
  help | version
`

function say(line) {
  console.log(line)
}

function requireId(args, usage) {
  if (!args._[0]) refuse(`usage: ${usage}`)
  return args._[0]
}

// A finished ticket waits on the user until its branch is merged into the base branch.
function isMerged(job) {
  if (job.landed) return true
  return !!job.branch && !!ctx().stages[job.stage]?.terminal && git(['merge-base', '--is-ancestor', job.branch, ctx().config.base_branch], ctx().repo).ok
}

function statusData() {
  const jobs = allJobs().map((j) => ({ ...j, merged: isMerged(j) }))
  const { stages } = ctx()
  const enrich = (j) => ({ id: j.id, title: j.title, stage: j.stage, round: j.round, branch: j.branch || null, merged: j.merged, blocked_reason: j.blocked_reason || null, updated_at: j.updated_at })
  return {
    tickets: jobs.map(enrich),
    in_progress: jobs.filter(isOpen).map(enrich),
    waiting: jobs.filter((j) => j.stage === BLOCKED || (stages[j.stage]?.terminal && !j.merged)).map(enrich),
    run: currentRun(),
  }
}

async function cmdRun(args) {
  if (process.env.FACTORY_STAGE) refuse('a stage agent cannot start a run (FACTORY_STAGE is set)')
  const { factory } = ctx()
  const ref = args._[0] || null
  if (ref) load(ref)
  resolveAgent()
  if (args.detach) {
    const info = currentRun()
    if (info) refuse(`a run is already in progress (pid ${info.pid}, since ${info.started_at}); \`cancel\` stops it`)
    const runDir = path.join(factory, 'run')
    fs.mkdirSync(runDir, { recursive: true })
    const logFile = path.join(runDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
    const fd = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', ...(ref ? [ref] : []), ...(args.once ? ['--once'] : [])], {
      cwd: ctx().repo,
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: { ...process.env, FACTORY_RUN_LOG: logFile },
    })
    fs.closeSync(fd)
    child.unref()
    const relLog = posix(path.relative(process.cwd(), logFile)) || logFile
    say(`Started a background run (pid ${child.pid}).`)
    say(`Follow it: node .factory/cli.mjs status   (log: ${relLog})`)
    say('Stop it:   node .factory/cli.mjs cancel')
    return
  }
  claimRun(process.argv.slice(3))
  const stop = () => {
    killChildren()
    process.exit(130)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  if (process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1') say('Note: this runs inside Codex\'s sandbox without network; stage agents need network to reach their API.')
  const stamp = (l) => say(process.env.FACTORY_RUN_LOG ? `${new Date().toISOString()} ${l}` : l)
  await runPipeline({ ref, once: !!args.once, say: stamp })
  const s = statusData()
  stamp(`Run finished. ${s.in_progress.length} in progress, ${s.waiting.length} waiting on you (\`status\`).`)
}

function cmdCancel() {
  const info = currentRun()
  if (!info) {
    say('No run in progress.')
    return
  }
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(info.pid), '/T', '/F'], { windowsHide: true })
  else process.kill(info.pid, 'SIGTERM')
  for (let i = 0; i < 100 && isAlive(info.pid); i++) sleep(50)
  if (!isAlive(info.pid)) fs.rmSync(runFile(), { force: true })
  say(isAlive(info.pid) ? `Asked the run (pid ${info.pid}) to stop; it is still shutting down.` : `Stopped the run (pid ${info.pid}). Tickets stay where they are; \`run\` resumes them.`)
}

const waitingLine = (run) => (run?.waiting ? `The run is waiting (${run.waiting.reason}) and goes on at ${clock(Date.parse(run.waiting.until))}.` : null)

function printStatus(json) {
  const s = statusData()
  if (json) {
    console.log(JSON.stringify(s, null, 2))
    return
  }
  const { stages } = ctx()
  say(`${s.tickets.length} ticket${s.tickets.length === 1 ? '' : 's'}. ${s.run ? `Run in progress (pid ${s.run.pid}, since ${s.run.started_at}${s.run.log ? `, log ${posix(path.relative(process.cwd(), s.run.log))}` : ''}).` : 'No run in progress.'}`)
  if (waitingLine(s.run)) say(waitingLine(s.run))
  if (s.in_progress.length) {
    say('In progress:')
    for (const t of s.in_progress) say(`  ${t.id.padEnd(32)} ${t.stage.padEnd(10)} r${t.round}  ${t.title}`)
  }
  if (s.waiting.length) {
    say('Waiting on you:')
    for (const t of s.waiting) {
      const why = t.stage === BLOCKED ? t.blocked_reason : stages[t.stage]?.terminal ? `${t.branch || 'branch'} is ready to land (\`land ${t.id.split('-')[0]}\`)` : ''
      say(`  ${t.id.padEnd(32)} ${t.stage.padEnd(10)} ${why}`)
    }
  }
  if (!s.tickets.length) say('No tickets yet: node .factory/cli.mjs new <title>')
}

function cmdJournalAdd(args) {
  const root = checkoutRoot()
  if (!args.title) refuse('journal add needs --title <what changed, in a few words>')
  const kind = (args.kind || 'chore').toLowerCase()
  let body
  if (args.what || args.why) {
    const parts = [`## What changed\n${args.what || ''}`, `## Why\n${args.why || ''}`]
    if (args.decision.length) parts.push(`## Decisions\n${args.decision.map((d) => `- ${d}`).join('\n')}`)
    if (args.watch.length) parts.push(`## Watch out\n${args.watch.map((d) => `- ${d}`).join('\n')}`)
    body = parts.join('\n\n')
  } else body = parseJournalDraft(readStdin()).body
  const draft = { title: args.title.trim(), kind, tags: splitList(args.tags || '').map((t) => t.toLowerCase()), body }
  const errors = validateDraft(draft)
  if (errors.length) refuse(`journal entry not valid: ${errors.join('; ')} (give --what and --why, or pipe "## What changed" and "## Why" sections on stdin)`)
  // Facts: the commits are checked against git, and the files default to what those commits touched.
  let commits = args.commit.map((c) => {
    const r = git(['rev-parse', '--short', `${c}^{commit}`], root)
    if (!r.ok) refuse(`'${c}' is not a commit`)
    return r.out.trim()
  })
  let files = splitList(args.files || '').map(normPath)
  if (!commits.length && !files.length) {
    const head = git(['rev-parse', '--short', 'HEAD'], root)
    if (head.ok) commits = [head.out.trim()]
  }
  if (!files.length) files = [...new Set(commits.flatMap((c) => gitLines(['show', '--name-only', '--format=', c], root)))]
  const at = nowZ()
  const branch = git(['branch', '--show-current'], root).out.trim() || null
  const host = process.env.FACTORY_STAGE ? null : chooseAgent(process.env, {}, () => false)
  const meta = {
    id: entryId(draft.title, at, [root, ctx().repo]),
    at,
    title: draft.title,
    kind: draft.kind,
    ticket: args.ticket || null,
    branch,
    commits,
    files: notJournal(files),
    tags: draft.tags,
    by: host ? { agent: host } : null,
  }
  const file = writeEntry(root, meta, draft.body)
  say(`Wrote ${posix(path.relative(process.cwd(), file)) || file} (not committed; commit it with the change).`)
  say(meta.id)
}

async function cmdStart() {
  const { repo } = ctx()
  const app = await ensureApp(say)
  const r = await launchApp(app.bin, [repo], { waitMs: 2500, say })
  if (r.exit && r.exit.code !== 0) refuse(`the app exited with ${r.exit.code ?? r.exit.signal}: ${clip(r.output, 400)} (log: ${path.join(appHome(), 'launch.log')})`)
  say(`Opened the Factory app on ${repo}.`)
  say('')
  process.stdout.write(buildContext(contextData([])))
}

async function cmdStop() {
  const app = installedApp()
  if (!app) {
    say('The Factory app is not installed; nothing to stop.')
    return
  }
  const r = await launchApp(app.bin, ['--quit'], { waitMs: 15000, say })
  const out = r.output.trim()
  if (out) say(clip(out, 400))
  say(r.exit ? (r.exit.code === 0 ? 'Asked the Factory app to quit (if it was not running, there was nothing to close).' : `The app exited with ${r.exit.code ?? r.exit.signal}.`) : 'Asked the Factory app to quit; it is still closing.')
}

const COMMANDS = {
  new(argv) {
    const a = parseArgs(argv, { str: ['body'] })
    const body = a.body !== undefined ? a.body : readStdin()
    const job = createTicket(a._.join(' '), body)
    say(job.id)
  },
  list(argv) {
    const a = parseArgs(argv, { bool: ['json'] })
    const jobs = allJobs()
    if (a.json) return console.log(JSON.stringify(jobs, null, 2))
    if (!jobs.length) return say('no tickets yet (node .factory/cli.mjs new <title>)')
    for (const j of jobs) say(`${j.id.padEnd(32)} ${j.stage.padEnd(10)} r${j.round}  ${j.title}`)
  },
  show(argv) {
    const a = parseArgs(argv)
    console.log(JSON.stringify(load(requireId(a, 'show <id>')).job, null, 2))
  },
  status(argv) {
    printStatus(parseArgs(argv, { bool: ['json'] }).json)
  },
  note(argv) {
    const id = requireId({ _: argv }, 'note <id> <text...>')
    const text = argv.slice(1).join(' ').trim()
    if (!text) refuse('usage: note <id> <text...>')
    addNote(id, text)
  },
  block(argv) {
    const a = parseArgs(argv, { message: true })
    const id = requireId(a, 'block <id> -m <reason>')
    if (!a.m) refuse('say why: block <id> -m <reason>')
    say(`${block(id, a.m).id}: blocked`)
  },
  unblock(argv) {
    const a = parseArgs(argv, { message: true })
    const job = unblock(requireId(a, 'unblock <id> [<stage>] [-m <note>]'), a._[1], a.m)
    say(`${job.id}: blocked → ${job.stage}`)
  },
  drop(argv) {
    const a = parseArgs(argv, { message: true })
    const id = requireId(a, 'drop <id> -m <reason>')
    if (!a.m) refuse('say why: drop <id> -m <reason>')
    say(`${drop(id, a.m).id}: dropped`)
  },
  async land(argv) {
    await land(requireId(parseArgs(argv), 'land <id>'), say)
  },
  delete(argv) {
    const a = parseArgs(argv, { message: true })
    const id = requireId(a, 'delete <id> -m <reason>')
    if (!a.m || !a.m.trim()) refuse('say why, for the journal: delete <id> -m <reason>')
    const d = deleteTicket(id, a.m)
    say(`${d.job.id}: deleted${d.commits && !d.merged ? ` (${d.commits} unmerged ${d.commits === 1 ? 'commit' : 'commits'} discarded)` : ''}`)
    say(`Journal entry ${d.entry} says so (${posix(path.relative(process.cwd(), d.file)) || d.file}, not committed).`)
  },
  advance(argv) {
    const a = parseArgs(argv, { message: true })
    if (a._.length !== 2) refuse('usage: advance <id> <stage> [-m <note>]')
    const before = load(a._[0]).job.stage
    const job = advance(a._[0], a._[1], a.m)
    say(`${job.id}: ${before} → ${job.stage} (round ${job.round})`)
  },
  async check(argv) {
    say(`CHECK: ${await runChecks(requireId(parseArgs(argv), 'check <id>'))}`)
  },
  checks: () => cmdChecks(),
  run: (argv) => cmdRun(parseArgs(argv, { bool: ['once', 'detach'] })),
  cancel: () => cmdCancel(),
  context(argv) {
    const a = parseArgs(argv, { bool: ['json'], multi: ['for'] })
    const data = contextData([...a.for, ...a._])
    if (a.json) {
      const { rules, tickets, run, entries, forPaths, name, skills } = data
      console.log(JSON.stringify({ name, rules, skills, tickets, run, for: forPaths, entries: entries.map(({ file, ...e }) => e), text: buildContext(data) }, null, 2))
    } else process.stdout.write(buildContext(data))
  },
  journal(argv) {
    const sub = argv[0]
    const rest = argv.slice(1)
    if (sub === 'add') return cmdJournalAdd(parseArgs(rest, { str: ['title', 'kind', 'ticket', 'tags', 'files', 'what', 'why'], multi: ['commit', 'decision', 'watch'] }))
    if (sub === 'list') {
      const a = parseArgs(rest, { bool: ['json'], str: ['limit'] })
      const entries = readEntries()
      const limit = a.limit ? Number(a.limit) : 30
      if (a.json) return console.log(JSON.stringify(entries.slice(0, limit).map(({ body, file, ...e }) => e), null, 2))
      if (!entries.length) return say('no journal entries yet')
      for (const e of entries.slice(0, limit)) say(`${e.id.padEnd(48)} ${(e.kind || '-').padEnd(9)} ${e.title}`)
      if (entries.length > limit) say(`... ${entries.length - limit} more (--limit ${entries.length})`)
      return
    }
    if (sub === 'show') {
      const a = parseArgs(rest)
      const e = findEntry(requireId(a, 'journal show <id>'))
      return process.stdout.write(fs.readFileSync(e.file, 'utf8'))
    }
    refuse('usage: journal add | list | show (see `help`)')
  },
  skills(argv) {
    const a = parseArgs(argv, { bool: ['json'] })
    const skills = readSkills(ctx().factory).map(({ body, ...s }) => s)
    if (a.json) return console.log(JSON.stringify(skills, null, 2))
    if (!skills.length) return say('no skills yet (a skill is a markdown file in .factory/skills/: how to do one kind of task in this repo)')
    for (const s of skills) say(`${s.name}: ${s.description || '(no description)'}`)
    say('Read one: node .factory/cli.mjs skill <name>')
  },
  skill(argv) {
    const want = (argv[0] || '').replace(/\.md$/i, '').toLowerCase()
    if (!want) refuse('usage: skill <name> (`skills` lists them)')
    const skills = readSkills(ctx().factory)
    const hit = skills.find((s) => s.name.toLowerCase() === want) || (skills.filter((s) => s.name.toLowerCase().startsWith(want)).length === 1 ? skills.find((s) => s.name.toLowerCase().startsWith(want)) : null)
    if (!hit) refuse(`no skill '${argv[0]}' (${skills.length ? `there are: ${skills.map((s) => s.name).join(', ')}` : 'there are none yet'})`)
    process.stdout.write(hit.body.trim() + '\n')
  },
  recall(argv) {
    const a = parseArgs(argv, { bool: ['json'], str: ['limit'] })
    const query = a._.join(' ').trim()
    if (!query) refuse('usage: recall <query...>')
    const hits = rank(readEntries(), query, a.limit ? Number(a.limit) : 5)
    if (a.json) return console.log(JSON.stringify(hits.map((h) => ({ id: h.entry.id, score: Number(h.score.toFixed(4)), at: h.entry.at, kind: h.entry.kind, title: h.entry.title, files: h.entry.files, tags: h.entry.tags, snippet: h.snippet })), null, 2))
    if (!hits.length) return say(`nothing in the journal matches '${query}'`)
    hits.forEach((h, i) => {
      say(`${i + 1}. ${h.entry.at.slice(0, 10)} ${h.entry.kind || '-'}: ${h.entry.title} (${h.entry.id})`)
      if (h.entry.files.length) say(`   files: ${h.entry.files.slice(0, 4).join(', ')}${h.entry.files.length > 4 ? ` (+${h.entry.files.length - 4})` : ''}`)
      if (h.snippet) say(`   > ${h.snippet}`)
    })
    say('Whole entry: node .factory/cli.mjs journal show <id>')
  },
  start: () => cmdStart(),
  stop: () => cmdStop(),
  doctor(argv) {
    const checks = doctorChecks()
    if (parseArgs(argv, { bool: ['json'] }).json) return console.log(JSON.stringify(checks, null, 2))
    for (const c of checks) say(`${c.ok ? 'ok  ' : 'warn'} ${c.id.padEnd(10)} ${c.text}`)
  },
  help: () => process.stdout.write(HELP),
  version: () => say(kitVersion() || 'unknown'),
}

export async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') return process.stdout.write(HELP)
  if (cmd === '--version') return COMMANDS.version()
  if (!COMMANDS[cmd]) refuse(`unknown command '${cmd}' (see \`node .factory/cli.mjs help\`)`)
  await COMMANDS[cmd](rest)
}

function isMain() {
  try {
    return process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href
  } catch {
    return false
  }
}

if (isMain()) {
  main(process.argv.slice(2)).catch((e) => {
    if (e instanceof Refusal) {
      console.error(`refused: ${e.message}`)
      process.exit(1)
    }
    console.error(e.stack || String(e))
    process.exit(2)
  })
}
