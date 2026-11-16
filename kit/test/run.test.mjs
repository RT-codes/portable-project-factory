import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { agentArgs, chooseAgent, parseEntry, roleSettings } from '../.factory/cli.mjs'
import { PASS_WITH_JOURNAL, cli, factoryRepo, git } from './helpers.mjs'

const BUILD = { say: 'READY\n\n## Summary\n- Added hello.txt', write: { 'hello.txt': 'hello\n' }, commit: true }
const ID = '001-add-a-greeting'

function newTicket(f) {
  const r = cli(f.dir, ['new', 'Add a greeting', '--body', 'A hello file.'], { env: f.env })
  assert.equal(r.code, 0, r.err)
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

test('a full run takes a ticket to done and commits its journal entry on the branch', () => {
  const f = factoryRepo({ script: { planner: ['READY\n\n## Summary\n- Add hello.txt'], builder: [BUILD], reviewer: [PASS_WITH_JOURNAL] } })
  newTicket(f)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /001-add-a-greeting: inbox → plan/)
  assert.match(r.out, /plan READY → build \(round 1\)/)
  assert.match(r.out, /check PASS → review/)
  assert.match(r.out, /review PASS → done/)
  const job = f.job(ID)
  assert.equal(job.stage, 'done')
  assert.equal(job.round, 1)
  const jd = path.join(f.dir, '.factory/jobs', ID)
  assert.match(fs.readFileSync(path.join(jd, 'plan.md'), 'utf8'), /^READY/)
  assert.match(fs.readFileSync(path.join(jd, 'build.md'), 'utf8'), /^READY/)
  assert.equal(fs.readFileSync(path.join(jd, 'round-1/review.md'), 'utf8'), 'PASS\n\n## Summary\n- Looks good.\n')
  assert.match(fs.readFileSync(path.join(jd, 'journal.md'), 'utf8'), /^title: Add a greeting file/)
  // each stage's activity says which model really ran it and what the run took
  const ran = JSON.parse(fs.readFileSync(path.join(jd, 'job.json'), 'utf8')).activity.filter((x) => x.kind === 'agent')
  assert.deepEqual(ran.map((x) => x.role), ['planner', 'builder', 'reviewer'])
  for (const x of ran) assert.deepEqual({ agent: x.agent, model: x.model, turns: x.turns, cost_usd: x.cost_usd, tokens: x.tokens }, { agent: 'claude', model: 'fake-sonnet-1', turns: 3, cost_usd: 0.013, tokens: 300 })
  for (const log of ['round-0/plan.log', 'round-1/build.log', 'round-1/review.log', 'round-1/checks.log']) assert.ok(fs.existsSync(path.join(jd, log)), log)

  // The entry is on the ticket's branch, not in the main checkout, with facts from git.
  const branch = `factory/${ID}`
  const files = git(f.dir, 'ls-tree', '-r', '--name-only', branch, '.factory/journal').split('\n')
  assert.equal(files.length, 1)
  assert.match(files[0], /^\.factory\/journal\/\d{4}\/\d{4}-\d\d-\d\d-add-a-greeting-file\.md$/)
  assert.ok(!fs.existsSync(path.join(f.dir, '.factory/journal')))
  const { meta, body } = parseEntry(git(f.dir, 'show', `${branch}:${files[0]}`))
  const builderCommit = git(f.dir, 'log', '--format=%h', '-1', `${branch}~1`)
  assert.equal(meta.title, 'Add a greeting file')
  assert.equal(meta.kind, 'feature')
  assert.equal(meta.ticket, ID)
  assert.equal(meta.branch, branch)
  assert.deepEqual(meta.commits, [builderCommit])
  assert.deepEqual(meta.files, ['hello.txt'])
  assert.deepEqual(meta.tags, ['greeting', 'docs'])
  // credited to the model that really ran each stage, not to the alias it was asked for
  assert.deepEqual(meta.by, { planner: 'claude:fake-sonnet-1', builder: 'claude:fake-sonnet-1', reviewer: 'claude:fake-sonnet-1' })
  assert.match(meta.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  assert.match(body, /^## What changed\nThe repo now has a greeting file\./)
  assert.equal(git(f.dir, 'log', '-1', '--format=%s', branch), 'Journal: Add a greeting file')
  assert.equal(git(f.dir, 'status', '--porcelain'), '')

  // What each stage was given.
  const calls = f.calls()
  assert.deepEqual(calls.map((c) => c.role), ['planner', 'builder', 'reviewer'])
  for (const c of calls) {
    assert.ok(c.prompt.startsWith(`FACTORY ROLE: ${c.role}\nTicket: ${ID}.`))
    assert.match(c.prompt, /# This repo's rules \(\.factory\/rules\.md\)/)
    assert.equal(c.stage, c.role)
  }
  assert.equal(calls[0].cwd, fs.realpathSync(f.dir))
  assert.equal(calls[1].cwd, fs.realpathSync(path.join(f.dir, '.factory/worktrees', ID)))
  assert.deepEqual(calls[0].args, ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read', 'Grep', 'Glob'])
  assert.deepEqual(calls[1].args.slice(6), ['--permission-mode', 'acceptEdits', '--tools', 'Read,Grep,Glob,Edit,Write,Bash', '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', '--add-dir', path.join(f.dir, '.factory/jobs', ID)])
  assert.ok(calls[2].args.includes('Bash(git diff *)'))
  assert.ok(!calls[2].args.includes('Edit'))

  // Done waits on the user until the branch is merged; the entry then reaches the main checkout.
  let s = JSON.parse(cli(f.dir, ['status', '--json'], { env: f.env }).out)
  assert.deepEqual(s.waiting.map((t) => t.id), [ID])
  git(f.dir, 'merge', '-q', '--no-edit', branch)
  s = JSON.parse(cli(f.dir, ['status', '--json'], { env: f.env }).out)
  assert.deepEqual([s.waiting.length, s.tickets[0].merged], [0, true])
  assert.ok(fs.existsSync(path.join(f.dir, files[0])))
  assert.doesNotMatch(cli(f.dir, ['context'], { env: f.env }).out, /ready to merge/)
})

test('reviewer CHANGES sends the ticket back to build; PASS in round 2 finishes it', () => {
  const f = factoryRepo({
    script: {
      planner: ['READY'],
      builder: [BUILD, { say: 'READY\n\n## Round 2\n- Fixed it', write: { 'hello.txt': 'hello, world\n' }, commit: true }],
      reviewer: ['CHANGES\n\n## Required\n1. hello.txt: say world', PASS_WITH_JOURNAL],
    },
  })
  newTicket(f)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /review CHANGES → build \(round 2\)/)
  const job = f.job(ID)
  assert.equal(job.stage, 'done')
  assert.equal(job.round, 2)
  const builder2 = f.calls().filter((c) => c.role === 'builder')[1]
  assert.match(builder2.prompt, /the review in round 1 asked for changes\. Read round-1\/review\.md/)
  assert.match(builder2.prompt, /Earlier work is already committed on this branch/)
  const entry = git(f.dir, 'ls-tree', '-r', '--name-only', `factory/${ID}`, '.factory/journal')
  const { meta } = parseEntry(git(f.dir, 'show', `factory/${ID}:${entry}`))
  assert.equal(meta.commits.length, 2)
})

test('failing checks use up the rounds and then block the ticket', () => {
  const f = factoryRepo({ checks: ['node -e "process.exit(1)"'], config: (c) => (c.max_rounds = 2), script: { planner: ['READY'], builder: [BUILD, { say: 'READY', write: { 'b.txt': 'b' }, commit: true }] } })
  newTicket(f)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  const job = f.job(ID)
  assert.equal(job.stage, 'blocked')
  assert.equal(job.blocked_from, 'check')
  assert.match(job.blocked_reason, /used all 2 rounds/)
  assert.equal(f.calls().filter((c) => c.role === 'builder').length, 2)
  assert.match(f.calls().filter((c) => c.role === 'builder')[1].prompt, /the checks failed in round 1/)
})

test('a builder that touches a protected file fails the round', () => {
  const f = factoryRepo({
    script: {
      planner: ['READY'],
      builder: [{ say: 'READY', write: { 'hello.txt': 'x', '.factory/rules.md': 'anything goes\n' }, commit: true }, { say: 'READY', write: { '.factory/rules.md': fs.readFileSync(new URL('../.factory/rules.md', import.meta.url), 'utf8') }, commit: true }],
      reviewer: [PASS_WITH_JOURNAL],
    },
  })
  newTicket(f)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /check FAIL → build \(round 2\)/)
  const checks = fs.readFileSync(path.join(f.dir, '.factory/jobs', ID, 'round-1/checks.md'), 'utf8')
  assert.match(checks, /^FAIL\n/)
  assert.match(checks, /protects: \.factory\/rules\.md/)
  // Round 2 restored the file, so the diff no longer touches it and the ticket finishes.
  assert.equal(f.job(ID).stage, 'done')
})

test('uncommitted builder work is committed by the factory; a failing agent blocks the ticket', () => {
  const f = factoryRepo({ script: { planner: ['READY'], builder: [{ say: 'READY', write: { 'left.txt': 'x' } }], reviewer: [{ exit: 2 }] } })
  newTicket(f)
  cli(f.dir, ['run'], { env: f.env })
  const job = f.job(ID)
  assert.equal(job.stage, 'blocked')
  assert.match(job.blocked_reason, /^reviewer \(claude:default\) failed: exited 2\. Log: round-1\/review\.log$/)
  assert.match(git(f.dir, 'log', '-1', '--format=%B', `factory/${ID}`), /work the builder left uncommitted/)
  assert.equal(git(f.dir, 'show', `factory/${ID}:left.txt`), 'x')
})

test('a planner that is BLOCKED or says nothing usable blocks the ticket with its reason', () => {
  const f = factoryRepo({ script: { planner: ['BLOCKED - which greeting?', ''] } })
  newTicket(f)
  cli(f.dir, ['run'], { env: f.env })
  assert.equal(f.job(ID).blocked_reason, 'planner: BLOCKED - which greeting?')
  cli(f.dir, ['unblock', '1'], { env: f.env })
  cli(f.dir, ['run'], { env: f.env })
  assert.match(f.job(ID).blocked_reason, /returned no final message/)
  assert.match(f.calls()[1].prompt, /planned before and came back/)
})

test('a PASS without the journal part blocks instead of finishing', () => {
  const f = factoryRepo({ script: { planner: ['READY'], builder: [BUILD], reviewer: ['PASS\n\n## Summary\n- fine'] } })
  newTicket(f)
  cli(f.dir, ['run'], { env: f.env })
  assert.equal(f.job(ID).stage, 'blocked')
  assert.match(f.job(ID).blocked_reason, /no journal\.md/)
})

test('codex runs with its sandbox per role and its final message from -o', () => {
  const f = factoryRepo({ agent: 'codex', script: { planner: ['READY'], builder: [BUILD], reviewer: [PASS_WITH_JOURNAL] } })
  fs.writeFileSync(path.join(f.dir, '.factory/local.json'), JSON.stringify({ roles: { builder: { model: 'gpt-x', effort: 'high' } } }))
  newTicket(f)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.equal(f.job(ID).stage, 'done')
  const [planner, builder, reviewer] = f.calls()
  const wt = path.join(f.dir, '.factory/worktrees', ID)
  const final = (stage, round) => path.join(f.dir, '.factory/jobs', ID, `round-${round}`, `${stage}.final.md`)
  assert.deepEqual(planner.args, ['exec', '--color', 'never', '--skip-git-repo-check', '-C', f.dir, '-s', 'read-only', '-o', final('plan', 0), '-'])
  assert.deepEqual(builder.args, ['exec', '--color', 'never', '--skip-git-repo-check', '-C', wt, '-s', 'workspace-write', '-o', final('build', 1), '-m', 'gpt-x', '-c', 'model_reasoning_effort=high', '-'])
  assert.deepEqual(reviewer.args.slice(5, 8), [wt, '-s', 'read-only'])
  const entry = git(f.dir, 'ls-tree', '-r', '--name-only', `factory/${ID}`, '.factory/journal')
  assert.deepEqual(parseEntry(git(f.dir, 'show', `factory/${ID}:${entry}`)).meta.by, { planner: 'codex:default', builder: 'codex:gpt-x', reviewer: 'codex:default' })
})

test('run --once does one step; concurrency holds tickets in the inbox', () => {
  const f = factoryRepo({ config: (c) => (c.concurrency = 1), script: { planner: ['READY'], builder: [BUILD], reviewer: [PASS_WITH_JOURNAL] } })
  newTicket(f)
  cli(f.dir, ['new', 'Second'], { env: f.env })
  cli(f.dir, ['run', '--once'], { env: f.env })
  assert.equal(f.job(ID).stage, 'plan')
  assert.equal(f.job('002-second').stage, 'inbox')
  cli(f.dir, ['run', '1', '--once'], { env: f.env })
  assert.equal(f.job(ID).stage, 'build')
  assert.equal(f.calls().length, 1)
  const r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.equal(f.job(ID).stage, 'done')
  assert.equal(f.job('002-second').stage, 'done')
})

test('run --detach returns at once; status shows it; a second run is refused; cancel stops it', () => {
  const f = factoryRepo({ script: { planner: [{ sleep: 20000, say: 'READY' }] } })
  newTicket(f)
  let r = cli(f.dir, ['run', '--detach'], { env: f.env })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /Started a background run \(pid \d+\)/)
  let s
  for (let i = 0; i < 100; i++) {
    s = JSON.parse(cli(f.dir, ['status', '--json'], { env: f.env }).out)
    if (s.run && f.calls().length) break
    sleepMs(50)
  }
  assert.ok(s.run, 'the run shows in status')
  assert.match(cli(f.dir, ['status'], { env: f.env }).out, /Run in progress \(pid \d+/)
  r = cli(f.dir, ['run'], { env: f.env })
  assert.equal(r.code, 1)
  assert.match(r.err, /a run is already in progress/)
  r = cli(f.dir, ['cancel'], { env: f.env })
  assert.match(r.out, /Stopped the run/)
  assert.equal(JSON.parse(cli(f.dir, ['status', '--json'], { env: f.env }).out).run, null)
  assert.equal(f.job(ID).stage, 'plan')
  const logs = fs.readdirSync(path.join(f.dir, '.factory/run')).filter((n) => n.endsWith('.log'))
  assert.equal(logs.length, 1)
  assert.match(cli(f.dir, ['cancel'], { env: f.env }).out, /No run in progress/)
})

test('a stage agent cannot start a run, and a missing agent CLI is a clear error', () => {
  const f = factoryRepo()
  let r = cli(f.dir, ['run'], { env: { ...f.env, FACTORY_STAGE: 'builder' } })
  assert.match(r.err, /a stage agent cannot start a run/)
  const { FACTORY_RUNNER, FACTORY_AGENT, ...bare } = f.env
  r = cli(f.dir, ['run'], { env: { ...bare, PATH: path.dirname(process.execPath) } })
  assert.equal(r.code, 1)
  assert.match(r.err, /no agent CLI found/)
})

test('agent choice, role settings and command lines', () => {
  const none = () => false
  assert.equal(chooseAgent({ FACTORY_AGENT: 'codex', CLAUDECODE: '1' }, { agent: 'claude' }, none), 'codex')
  assert.equal(chooseAgent({ CLAUDECODE: '1' }, { agent: 'codex' }, none), 'codex')
  assert.equal(chooseAgent({ CLAUDECODE: '1' }, {}, none), 'claude')
  assert.equal(chooseAgent({ CODEX_THREAD_ID: 'x' }, {}, none), 'codex')
  assert.equal(chooseAgent({}, {}, (n) => n === 'codex'), 'codex')
  assert.equal(chooseAgent({}, {}, none), null)
  const config = { roles: { builder: { model: 'opus', effort: 'default' } } }
  assert.deepEqual(roleSettings(config, { roles: { builder: { effort: 'high' } } }, 'builder', 'claude'), { model: 'opus', effort: 'high' })
  assert.deepEqual(roleSettings(config, {}, 'reviewer', 'claude'), { model: 'default', effort: 'default' })
  // a model belongs to an agent: the part for the agent that runs wins, and the other agent's is not used
  const perAgent = { roles: { builder: { model: 'opus', effort: 'low', codex: { model: 'gpt-6-luna' } } } }
  const mine = { roles: { builder: { effort: 'medium', claude: { model: 'sonnet', effort: 'high' }, codex: { effort: 'max' } } } }
  assert.deepEqual(roleSettings(perAgent, {}, 'builder', 'codex'), { model: 'gpt-6-luna', effort: 'low' })
  assert.deepEqual(roleSettings(perAgent, {}, 'builder', 'claude'), { model: 'opus', effort: 'low' })
  assert.deepEqual(roleSettings(perAgent, mine, 'builder', 'claude'), { model: 'sonnet', effort: 'high' })
  assert.deepEqual(roleSettings(perAgent, mine, 'builder', 'codex'), { model: 'gpt-6-luna', effort: 'max' })
  const args = agentArgs({ agent: 'claude', role: 'reviewer', model: 'sonnet', effort: 'low', cwd: '/r/.factory/worktrees/1', jobDir: '/r/.factory/jobs/1' })
  // lean: none of the user's MCP servers or skills come along
  assert.deepEqual(args.slice(0, 10), ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--disable-slash-commands', '--model', 'sonnet', '--effort', 'low'])
  const builder = agentArgs({ agent: 'claude', role: 'builder', model: 'default', effort: 'default', cwd: '/r/.factory/worktrees/1', jobDir: '/r/.factory/jobs/1' })
  assert.equal(builder[builder.indexOf('--tools') + 1], 'Read,Grep,Glob,Edit,Write,Bash')
  assert.ok(!builder.includes('--model') && !builder.includes('--effort'))
  assert.deepEqual(args.slice(-2), ['--add-dir', '/r/.factory/jobs/1'])
})
