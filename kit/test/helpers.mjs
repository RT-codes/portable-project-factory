// Shared setup for the kit's tests: real temporary git repos, the real installer, the installed CLI, and a
// fake agent runner instead of claude or codex.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const INSTALL = path.join(ROOT, 'install.mjs')
export const FAKE_RUNNER = path.join(ROOT, 'kit', 'test', 'fake-runner.mjs')

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'))
process.on('exit', () => fs.rmSync(SCRATCH, { recursive: true, force: true }))

export function tmp(name = 'd') {
  return fs.mkdtempSync(path.join(SCRATCH, `${name}-`))
}

// The tests run inside whatever agent the developer uses: none of its variables, nor the user's git
// config (signing, hooks) or home folder, may leak into them.
export function cleanEnv(extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|CODEX|FACTORY_|FAKE_|GIT_)/.test(k)) continue
    env[k] = v
  }
  const home = tmp('home')
  const gitconfig = path.join(home, '.gitconfig')
  fs.writeFileSync(gitconfig, '[user]\n\tname = Factory Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n')
  return { ...env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', ...extra }
}

export const ENV = cleanEnv()

export function run(cmd, args, { cwd, env = ENV, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input: input ?? '', encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

export function git(dir, ...args) {
  const r = run('git', args, { cwd: dir })
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.err}`)
  return r.out.trim()
}

export function makeRepo({ branch = 'main' } = {}) {
  const dir = tmp('repo')
  git(dir, 'init', '-q', '-b', branch)
  fs.writeFileSync(path.join(dir, 'README.md'), '# test repo\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

export function install(dir, ...flags) {
  return run(process.execPath, [INSTALL, dir, ...flags], { cwd: ROOT })
}

export function cli(dir, args, opts = {}) {
  return run(process.execPath, [path.join(dir, '.factory', 'cli.mjs'), ...args], { cwd: dir, ...opts })
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function editConfig(dir, fn) {
  const file = path.join(dir, '.factory', 'config.json')
  const config = readJson(file)
  fn(config)
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}

/** A repo with the factory installed and committed, and an environment that runs the fake agent. */
export function factoryRepo({ checks = ['node --version'], script = {}, agent = 'claude', config = () => {} } = {}) {
  const dir = makeRepo()
  const r = install(dir)
  if (r.code !== 0) throw new Error(r.err)
  editConfig(dir, (c) => {
    c.checks = checks
    config(c)
  })
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'install factory')
  const state = tmp('fake')
  const scriptFile = path.join(state, 'script.json')
  fs.writeFileSync(scriptFile, JSON.stringify(script))
  const env = { ...cleanEnv(), FACTORY_AGENT: agent, FACTORY_RUNNER: FAKE_RUNNER, FAKE_SCRIPT: scriptFile, FAKE_STATE: state, FAKE_LOG: path.join(state, 'calls.jsonl') }
  return { dir, env, calls: () => readCalls(env.FAKE_LOG), job: (id) => readJson(path.join(dir, '.factory', 'jobs', id, 'job.json')) }
}

function readCalls(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export const JOURNAL = [
  'title: Add a greeting file',
  'kind: feature',
  'tags: greeting, docs',
  '',
  '## What changed',
  'The repo now has a greeting file.',
  '',
  '## Why',
  'New contributors asked where to start.',
  '',
  '## Decisions',
  '- A plain text file, not a web page.',
].join('\n')

export const PASS_WITH_JOURNAL = `PASS\n\n## Summary\n- Looks good.\n\n=== JOURNAL ===\n${JOURNAL}\n`

export function lastLine(text) {
  return text.trim().split('\n').pop()
}
