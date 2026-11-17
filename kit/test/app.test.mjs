import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { assetName } from '../.factory/cli.mjs'
import { cli, factoryRepo, readJson, run, tmp } from './helpers.mjs'

// A stand-in for the app: records its arguments; with FAKE_SANDBOX it fails like Chromium without user
// namespaces unless it gets --no-sandbox.
function fakeApp(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_APP_LOG, JSON.stringify(args) + '\\n')
if (process.env.FAKE_SANDBOX && !args.includes('--no-sandbox')) {
  console.error('FATAL:zygote_host_impl_linux.cc No usable sandbox! Update your kernel or use --no-sandbox.')
  process.exit(1)
}
`,
  )
  fs.chmodSync(file, 0o755)
  return file
}

const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])

test('asset names per platform', () => {
  assert.equal(assetName('1.2.3', 'linux', 'x64'), 'Factory-1.2.3-linux-x64.tar.gz')
  assert.equal(assetName('1.2.3', 'linux', 'arm64'), 'Factory-1.2.3-linux-arm64.tar.gz')
  assert.equal(assetName('1.2.3', 'win32', 'x64'), 'Factory-1.2.3-win-x64.zip')
  assert.equal(assetName('1.2.3', 'darwin', 'arm64'), 'Factory-1.2.3-mac-arm64.zip')
  assert.equal(assetName('1.2.3', 'darwin', 'x64'), 'Factory-1.2.3-mac-x64.zip')
})

test('start opens FACTORY_APP_BIN on the repo and prints the context; stop asks it to quit', () => {
  const { dir, env } = factoryRepo()
  const log = path.join(tmp('app'), 'calls.jsonl')
  const bin = fakeApp(path.join(tmp('app'), 'fake-app'))
  const e = { ...env, FACTORY_APP_BIN: bin, FAKE_APP_LOG: log }
  let r = cli(dir, ['start'], { env: e })
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(calls(log), [[dir]])
  assert.match(r.out, /^Opened the Factory app on /)
  assert.match(r.out, /# Factory context: Factory/)
  r = cli(dir, ['stop'], { env: e })
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(calls(log)[1], ['--quit'])
  assert.match(r.out, /Asked the Factory app to quit/)
})

test('start retries with --no-sandbox when Chromium has no usable sandbox (Linux)', { skip: process.platform !== 'linux' }, () => {
  const { dir, env } = factoryRepo()
  const log = path.join(tmp('app'), 'calls.jsonl')
  const bin = fakeApp(path.join(tmp('app'), 'fake-app'))
  const r = cli(dir, ['start'], { env: { ...env, FACTORY_APP_BIN: bin, FAKE_APP_LOG: log, FAKE_SANDBOX: '1' } })
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(calls(log), [[dir], ['--no-sandbox', dir]])
  assert.match(r.out, /retrying with --no-sandbox/)
})

test('start downloads the app into the home folder from FACTORY_RELEASE_BASE, then reuses it', { skip: process.platform !== 'linux' }, () => {
  const { dir, env } = factoryRepo()
  const release = tmp('release')
  const stage = tmp('stage')
  fakeApp(path.join(stage, 'Factory-1.1.0', 'factory-app'))
  fs.writeFileSync(path.join(stage, 'Factory-1.1.0', 'README'), 'x')
  assert.equal(run('tar', ['-czf', path.join(release, 'Factory-1.1.0-linux-x64.tar.gz'), '-C', stage, 'Factory-1.1.0']).code, 0)
  if (process.arch === 'arm64') fs.copyFileSync(path.join(release, 'Factory-1.1.0-linux-x64.tar.gz'), path.join(release, 'Factory-1.1.0-linux-arm64.tar.gz'))
  const log = path.join(tmp('app'), 'calls.jsonl')
  const e = { ...env, FACTORY_RELEASE_BASE: release, FAKE_APP_LOG: log }
  let r = cli(dir, ['start'], { env: e })
  assert.equal(r.code, 0, r.err)
  const home = env.HOME
  const current = readJson(path.join(home, '.factory/app/current.json'))
  assert.equal(current.version, '1.1.0')
  assert.equal(current.bin, path.join(home, '.factory/app/1.1.0/Factory-1.1.0/factory-app'))
  assert.deepEqual(calls(log), [[dir]])
  assert.match(r.out, /Installed the Factory app 1\.1\.0/)
  assert.deepEqual(fs.readdirSync(path.join(home, '.factory/app')).sort(), ['1.1.0', 'current.json', 'downloads', 'launch.log'])
  // The second start finds it installed and downloads nothing.
  fs.rmSync(release, { recursive: true })
  r = cli(dir, ['start'], { env: e })
  assert.equal(r.code, 0, r.err)
  assert.doesNotMatch(r.out, /Installed/)
  assert.equal(calls(log).length, 2)
  // The doctor sees it.
  const doctor = JSON.parse(cli(dir, ['doctor', '--json'], { env: e }).out)
  assert.equal(doctor.find((c) => c.id === 'app').ok, true)
})

test('a missing release is a clear error; stop without an app exits 0', () => {
  const { dir, env } = factoryRepo()
  const e = { ...env, FACTORY_RELEASE_BASE: tmp('empty') }
  let r = cli(dir, ['start'], { env: e })
  assert.equal(r.code, 1)
  assert.match(r.err, /does not exist \(FACTORY_RELEASE_BASE\)/)
  r = cli(dir, ['stop'], { env: e })
  assert.equal(r.code, 0)
  assert.match(r.out, /not installed/)
})

test('doctor --json reports every check and always exits 0', () => {
  const { dir, env } = factoryRepo({ checks: [] })
  const r = cli(dir, ['doctor', '--json'], { env })
  assert.equal(r.code, 0)
  const checks = JSON.parse(r.out)
  assert.deepEqual(checks.map((c) => c.id), ['node', 'git', 'kit', 'agents-md', 'claude-md', 'checks', 'agents', 'app', 'journal', 'run'])
  for (const c of checks) assert.deepEqual(Object.keys(c), ['id', 'ok', 'text'])
  const by = Object.fromEntries(checks.map((c) => [c.id, c]))
  assert.equal(by.kit.text, 'kit 1.1.0')
  assert.equal(by['agents-md'].ok, true)
  assert.equal(by['claude-md'].ok, true)
  assert.equal(by.checks.ok, false)
  assert.equal(by.app.ok, false)
  assert.equal(by.journal.text, '0 journal entries')
  assert.match(cli(dir, ['doctor'], { env }).out, /^ok   node/)
  assert.match(cli(dir, ['help'], { env }).out, /journal add --title/)
  assert.equal(cli(dir, ['version'], { env }).out.trim(), '1.1.0')
  const bad = cli(dir, ['bogus'], { env })
  assert.equal(bad.code, 1)
  assert.match(bad.err, /unknown command 'bogus'/)
})
