#!/usr/bin/env node
// Install the Factory kit into a git repo. Node 20+ standard library only, the same on every OS.
//
//   From GitHub, inside the target repo:   npx -y github:RT-codes/portable-project-factory
//   From a checkout of this repo:          node install.mjs [<target-repo>] [--update] [--force] [--remove]
//
//   (no flag)   install; refused when .factory/ already exists
//   --update    refresh the files the factory owns (cli.mjs, version, .gitignore, the /factory skill, the
//               managed blocks) and keep yours (config.json, rules.md, roles/, journal/)
//   --force     overwrite everything except journal/, jobs/ and local.json
//   --remove    take the factory out: its own files and managed blocks. Your config, rules, roles and
//               journal stay unless you add --force (the journal, tickets and worktrees always stay).
//
// It writes only inside the target repo, asks nothing, and needs no admin rights.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.join(HERE, 'kit')
const START = '<!-- factory:start -->'
const END = '<!-- factory:end -->'

// Files the factory owns: written every time. Source (in kit/) → destination (in the target repo).
const OWNED = [
  ['.factory/cli.mjs', '.factory/cli.mjs'],
  ['.factory/gitignore', '.factory/.gitignore'],
  ['.claude/skills/factory/SKILL.md', '.claude/skills/factory/SKILL.md'],
]
// Files you are meant to change: written once, kept by --update.
const CUSTOM = ['.factory/config.json', '.factory/rules.md', '.factory/roles/planner.md', '.factory/roles/builder.md', '.factory/roles/reviewer.md']

function die(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { ok: r.status === 0, out: (r.stdout || '').trim() }
}

function parse(argv) {
  const opts = { target: null, update: false, force: false, remove: false }
  for (const a of argv) {
    if (a === '--update') opts.update = true
    else if (a === '--force') opts.force = true
    else if (a === '--remove') opts.remove = true
    else if (a === '-h' || a === '--help') {
      const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      console.log(text.split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
      process.exit(0)
    } else if (a.startsWith('-')) die(`unknown option ${a}`)
    else if (opts.target) die('give one target repo')
    else opts.target = a
  }
  return opts
}

function same(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

/** Put `body` between the markers: replaced in place when the block exists, appended when it does not. */
export function upsertBlock(text, body) {
  const block = `${START}\n${body.trim()}\n${END}`
  const i = text.indexOf(START)
  const j = i >= 0 ? text.indexOf(END, i) : -1
  if (i >= 0 && j >= 0) return text.slice(0, i) + block + text.slice(j + END.length)
  if (!text.trim()) return block + '\n'
  return text.replace(/\s*$/, '') + '\n\n' + block + '\n'
}

/** Take the block out, and the blank line that separated it, leaving every other byte as it was. */
export function removeBlock(text) {
  const i = text.indexOf(START)
  const j = i >= 0 ? text.indexOf(END, i) : -1
  if (i < 0 || j < 0) return text
  const before = text.slice(0, i).replace(/\n\n$/, '\n')
  const after = text.slice(j + END.length).replace(/^\n/, '')
  return before + after
}

function kitVersion() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version
}

// Only what is known: npm does not tell a package which spec (github:..., a path) it was run from.
function source() {
  const sha = git(['rev-parse', '--short', 'HEAD'], HERE)
  if (fs.existsSync(path.join(HERE, '.git')) && sha.ok) return `checkout ${HERE} @ ${sha.out}`
  if (process.env.npm_command === 'exec') return 'npx'
  return `copy at ${HERE}`
}

function defaultBranch(root) {
  const origin = git(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], root)
  if (origin.ok && origin.out) return origin.out.replace(/^origin\//, '')
  const current = git(['branch', '--show-current'], root)
  return current.ok && current.out ? current.out : 'main'
}

// Claude Code reads CLAUDE.md, not AGENTS.md. When the repo has no CLAUDE.md, one in .claude/ imports
// AGENTS.md; when it has one that does not import AGENTS.md yet, a block with the import is added to it.
function claudeTarget(root) {
  const agents = path.join(root, 'AGENTS.md')
  const candidates = [['CLAUDE.md', '@AGENTS.md'], ['.claude/CLAUDE.md', '@../AGENTS.md']]
  const existing = candidates.filter(([f]) => fs.existsSync(path.join(root, f)))
  for (const [f, imp] of existing) {
    const p = path.join(root, f)
    const text = fs.readFileSync(p, 'utf8')
    if (text.includes(START)) return { file: f, import: imp }
    if (same(p, agents) || /^@(\.\/|\.\.\/)?AGENTS\.md\s*$/m.test(text)) return null
  }
  if (existing.length) return { file: existing[0][0], import: existing[0][1] }
  return { file: '.claude/CLAUDE.md', import: '@../AGENTS.md' }
}

function main() {
  const opts = parse(process.argv.slice(2))
  const target = path.resolve(opts.target || process.cwd())
  const top = git(['rev-parse', '--show-toplevel'], target)
  if (!fs.existsSync(target) || !top.ok) die(`${target} is not a git repository (run git init first)`)
  const root = path.resolve(top.out)
  if (same(root, HERE)) die("that is the factory's own repo; install into another repo")
  const wrote = []
  const at = (f) => path.join(root, f)
  const put = (dest, text) => {
    fs.mkdirSync(path.dirname(at(dest)), { recursive: true })
    fs.writeFileSync(at(dest), text)
    wrote.push(dest)
  }

  if (opts.remove) return remove(root, opts.force)
  const exists = fs.existsSync(at('.factory'))
  if (exists && !opts.update && !opts.force) die(`${at('.factory')} already exists. Use --update to refresh the factory and keep your changes, or --force to overwrite`)

  for (const [src, dest] of OWNED) put(dest, fs.readFileSync(path.join(KIT, src)))
  put('.factory/version', `${kitVersion()}\n${source()}\n`)
  for (const f of CUSTOM) {
    if (fs.existsSync(at(f)) && !opts.force) continue
    let text = fs.readFileSync(path.join(KIT, f), 'utf8')
    // A fresh config.json works on the repo's own default branch.
    if (f === '.factory/config.json') {
      const config = JSON.parse(text)
      config.base_branch = defaultBranch(root)
      text = JSON.stringify(config, null, 2) + '\n'
    }
    put(f, text)
  }

  const agentsBody = fs.readFileSync(path.join(KIT, 'AGENTS.block.md'), 'utf8')
  const agentsText = fs.existsSync(at('AGENTS.md')) ? fs.readFileSync(at('AGENTS.md'), 'utf8') : ''
  put('AGENTS.md', upsertBlock(agentsText, agentsBody))
  const claude = claudeTarget(root)
  if (claude) {
    const text = fs.existsSync(at(claude.file)) ? fs.readFileSync(at(claude.file), 'utf8') : ''
    put(claude.file, upsertBlock(text, claude.import))
  }

  const mode = opts.force ? 'force' : exists ? 'update' : 'install'
  console.log(`Factory ${kitVersion()} (${mode}) in ${root}`)
  for (const f of wrote) console.log(`  wrote ${f}`)
  const kept = CUSTOM.filter((f) => !wrote.includes(f))
  if (kept.length) console.log(`  kept  ${kept.join(', ')}`)
  console.log(`
Next:
  1. Put this repo's checks (lint, typecheck, tests, build) in "checks" in .factory/config.json, and its
     stack and conventions in .factory/rules.md.
  2. Commit .factory/, AGENTS.md${claude ? ` and ${claude.file}` : ''}.
  3. In your agent (Claude Code or Codex), say what to build, or run it yourself:
       node .factory/cli.mjs new "<what you want built>"
       node .factory/cli.mjs run --detach
       node .factory/cli.mjs start        (opens the Factory app)`)
}

function remove(root, force) {
  const at = (f) => path.join(root, f)
  const removed = []
  const rm = (f) => {
    if (!fs.existsSync(at(f))) return
    fs.rmSync(at(f), { recursive: true, force: true })
    removed.push(f)
  }
  for (const [, dest] of OWNED) if (dest !== '.factory/.gitignore') rm(dest)
  rm('.factory/version')
  if (force) {
    for (const f of [...CUSTOM, '.factory/local.json', '.factory/run', '.factory/cache']) rm(f)
    rmEmpty(at('.factory/roles'))
  }
  // The .gitignore stays while anything it hides is still there (tickets, worktrees, local settings):
  // without it they would show up as files to commit.
  const hidden = ['jobs', 'worktrees', 'local.json', 'run', 'cache'].filter((f) => fs.existsSync(at(`.factory/${f}`)))
  if (!hidden.length) rm('.factory/.gitignore')
  rmEmpty(at('.claude/skills/factory'))
  rmEmpty(at('.claude/skills'))
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md']) {
    if (!fs.existsSync(at(f))) continue
    const text = fs.readFileSync(at(f), 'utf8')
    if (!text.includes(START)) continue
    const left = removeBlock(text)
    if (left.trim()) fs.writeFileSync(at(f), left)
    else fs.rmSync(at(f))
    removed.push(`${f} (Factory block)`)
  }
  rmEmpty(at('.claude'))
  rmEmpty(at('.factory'))
  console.log(`Removed the Factory from ${root}`)
  for (const f of removed) console.log(`  removed ${f}`)
  const left = fs.existsSync(at('.factory')) ? fs.readdirSync(at('.factory')) : []
  if (left.length) console.log(`  kept    .factory/: ${left.sort().join(', ')}${force ? '' : ' (add --force to remove your config, rules and roles too)'}`)
  if (hidden.includes('worktrees')) console.log('  Ticket worktrees are still registered with git: `git worktree list`, then `git worktree remove <path>`.')
}

function rmEmpty(dir) {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch {}
}

const invoked = process.argv[1] && same(process.argv[1], fileURLToPath(import.meta.url))
if (invoked) main()
