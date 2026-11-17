import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { claudeFinal, parseJournalDraft, protectedFiles, splitReview, validateDraft, verdict } from '../.factory/cli.mjs'
import { cli, factoryRepo, git, lastLine } from './helpers.mjs'

const jobDir = (dir, id) => path.join(dir, '.factory', 'jobs', id)
const write = (dir, id, file, text) => {
  fs.mkdirSync(path.dirname(path.join(jobDir(dir, id), file)), { recursive: true })
  fs.writeFileSync(path.join(jobDir(dir, id), file), text)
}

test('verdict reads the first word leniently, as the Python script did', () => {
  assert.equal(verdict('PASS'), 'PASS')
  assert.equal(verdict('\n\n## VERDICT: pass - looks good'), 'PASS')
  assert.equal(verdict('> **READY**'), 'READY')
  assert.equal(verdict('STATUS: blocked - need a key'), 'BLOCKED')
  assert.equal(verdict('   \n'), '')
  assert.equal(verdict('123 go'), '')
})

test('review and journal split, drafts parse and validate', () => {
  const { review, journal } = splitReview('PASS\n\n## Summary\n- ok\n=== JOURNAL ===\ntitle: T\nkind: fix\n\n## What changed\nA.\n## Why\nB.\n')
  assert.equal(review, 'PASS\n\n## Summary\n- ok')
  const d = parseJournalDraft(journal)
  assert.deepEqual([d.title, d.kind, d.tags], ['T', 'fix', []])
  assert.deepEqual(validateDraft(d), [])
  assert.deepEqual(splitReview('CHANGES\n1. x').journal, null)
  const fenced = parseJournalDraft('```markdown\ntitle: X\nkind: feature\ntags: A, b\n\n## What changed\nx\n## Why\ny\n```')
  assert.deepEqual([fenced.title, fenced.tags], ['X', ['a', 'b']])
  assert.deepEqual(validateDraft({ title: '', kind: 'oops', body: '## What changed\nx' }).length, 3)
})

test('claude stream-json final message and protected paths', () => {
  const ok = claudeFinal('{"type":"system"}\nnoise\n{"type":"result","subtype":"success","is_error":false,"result":"READY\\nplan"}\n')
  assert.deepEqual(ok, { ok: true, text: 'READY\nplan' })
  assert.equal(claudeFinal('{"type":"result","subtype":"error_max_turns","is_error":true}').ok, false)
  assert.equal(claudeFinal('').ok, false)
  assert.deepEqual(protectedFiles(['.factory/roles/x.md', '.factory/config.json', 'src/a.ts', '.factory/journal/2026/a.md']), ['.factory/roles/x.md', '.factory/config.json'])
})

test('new, list, show, status and note', () => {
  const { dir, env, job } = factoryRepo()
  let r = cli(dir, ['new', 'Add', 'a', 'dark', 'mode', 'toggle'], { env, input: 'Use the system setting.\n' })
  assert.equal(r.code, 0, r.err)
  assert.equal(lastLine(r.out), '001-add-a-dark-mode')
  r = cli(dir, ['new', 'Second one', '--body', 'flag body'], { env })
  assert.equal(lastLine(r.out), '002-second-one')
  assert.equal(fs.readFileSync(path.join(jobDir(dir, '001-add-a-dark-mode'), 'ticket.md'), 'utf8'), '# Add a dark mode toggle\n\nUse the system setting.\n')
  assert.equal(fs.readFileSync(path.join(jobDir(dir, '002-second-one'), 'ticket.md'), 'utf8'), '# Second one\n\nflag body\n')
  const j = job('001-add-a-dark-mode')
  assert.deepEqual(Object.keys(j), ['id', 'number', 'title', 'stage', 'round', 'created_at', 'updated_at', 'activity'])
  assert.match(j.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/)
  assert.match(cli(dir, ['list'], { env }).out, /001-add-a-dark-mode\s+inbox\s+r0  Add a dark mode toggle/)
  assert.equal(JSON.parse(cli(dir, ['list', '--json'], { env }).out).length, 2)
  assert.equal(JSON.parse(cli(dir, ['show', '2'], { env }).out).id, '002-second-one')
  assert.equal(cli(dir, ['note', '1', 'remember', 'this'], { env }).code, 0)
  assert.equal(job('001-add-a-dark-mode').activity.at(-1).text, 'remember this')
  const s = JSON.parse(cli(dir, ['status', '--json'], { env }).out)
  assert.equal(s.in_progress.length, 2)
  assert.equal(s.run, null)
  r = cli(dir, ['show', '9'], { env })
  assert.equal(r.code, 1)
  assert.match(r.err, /^refused: no ticket '9'/)
})

test('advance refuses what the config and the files do not allow', () => {
  const { dir, env, job } = factoryRepo()
  cli(dir, ['new', 'Thing'], { env })
  const id = '001-thing'
  const refused = (args, re) => {
    const r = cli(dir, args, { env })
    assert.equal(r.code, 1, r.out)
    assert.match(r.err, re)
  }
  refused(['advance', '1', 'build'], /inbox → build is not in config.json \(allowed: plan/)
  assert.equal(cli(dir, ['advance', '1', 'plan'], { env }).code, 0)
  refused(['advance', '1', 'build'], /plan has not written plan.md yet/)
  write(dir, id, 'plan.md', 'BLOCKED - which colour?\n')
  refused(['advance', '1', 'build'], /plan.md says BLOCKED, plan → build needs READY/)
  write(dir, id, 'plan.md', 'READY\n')
  const r = cli(dir, ['advance', '1', 'build', '-m', 'go', 'on'], { env })
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out.trim(), `${id}: plan → build (round 1)`)
  const j = job(id)
  assert.equal(j.round, 1)
  assert.equal(j.branch, `factory/${id}`)
  assert.equal(j.worktree, `.factory/worktrees/${id}`)
  assert.equal(j.activity.at(-1).text, 'go on')
  assert.deepEqual([j.activity.at(-1).from, j.activity.at(-1).to], ['plan', 'build'])
  assert.ok(fs.existsSync(path.join(dir, j.worktree, 'README.md')))
  assert.equal(git(path.join(dir, j.worktree), 'branch', '--show-current'), `factory/${id}`)
  // A ticket cannot reach done without its journal.
  write(dir, id, 'build.md', 'READY\n')
  cli(dir, ['advance', '1', 'check'], { env })
  write(dir, id, 'round-1/checks.md', 'PASS\n')
  cli(dir, ['advance', '1', 'review'], { env })
  write(dir, id, 'round-1/review.md', 'PASS\n')
  refused(['advance', '1', 'done'], /has no journal.md/)
  write(dir, id, 'journal.md', 'title: x\nkind: nonsense\n\n## Why\nbecause\n')
  refused(['advance', '1', 'done'], /journal.md is not valid: kind must be one of .*; no "## What changed" section/)
  assert.equal(job(id).stage, 'review')
})

test('block, unblock, drop and max rounds', () => {
  const { dir, env, job } = factoryRepo({ config: (c) => (c.max_rounds = 2) })
  cli(dir, ['new', 'Thing'], { env })
  const id = '001-thing'
  let r = cli(dir, ['block', '1'], { env })
  assert.match(r.err, /say why/)
  assert.equal(cli(dir, ['block', '1', '-m', 'waiting', 'on', 'a', 'key'], { env }).code, 0)
  assert.deepEqual([job(id).stage, job(id).blocked_from, job(id).blocked_reason], ['blocked', 'inbox', 'waiting on a key'])
  r = cli(dir, ['advance', '1', 'plan'], { env })
  assert.match(r.err, /is blocked; use `unblock`/)
  r = cli(dir, ['block', '1', '-m', 'again'], { env })
  assert.match(r.err, /already blocked/)
  assert.equal(cli(dir, ['unblock', '1', 'done'], { env }).code, 1)
  r = cli(dir, ['unblock', '1', 'build', '-m', 'skip the plan'], { env })
  assert.equal(r.code, 0, r.err)
  assert.equal(job(id).stage, 'build')
  assert.equal(job(id).round, 1)
  assert.equal(job(id).blocked_reason, undefined)
  r = cli(dir, ['unblock', '1'], { env })
  assert.match(r.err, /is not blocked/)
  // Round 2 is the last one: the next move into build is refused.
  write(dir, id, 'build.md', 'READY\n')
  cli(dir, ['advance', '1', 'check'], { env })
  write(dir, id, 'round-1/checks.md', 'FAIL\n')
  assert.equal(cli(dir, ['advance', '1', 'build'], { env }).code, 0)
  cli(dir, ['advance', '1', 'check'], { env })
  write(dir, id, 'round-2/checks.md', 'FAIL\n')
  r = cli(dir, ['advance', '1', 'build'], { env })
  assert.match(r.err, /used all 2 rounds/)
  r = cli(dir, ['drop', '1'], { env })
  assert.match(r.err, /say why/)
  assert.equal(cli(dir, ['drop', '1', '-m', 'not needed'], { env }).code, 0)
  assert.equal(job(id).stage, 'dropped')
  assert.match(cli(dir, ['block', '1', '-m', 'x'], { env }).err, /already dropped/)
})

test('check runs the configured checks in the worktree and writes checks.md', () => {
  const { dir, env, job } = factoryRepo({ checks: ['node -e "console.log(process.cwd())"', 'node -e "process.exit(3)"', 'node -e "console.log(1)"'] })
  cli(dir, ['new', 'Thing'], { env })
  const id = '001-thing'
  cli(dir, ['unblock', '1'], { env })
  assert.match(cli(dir, ['check', '1'], { env }).err, /inbox has no checks to run/)
  cli(dir, ['block', '1', '-m', 'x'], { env })
  cli(dir, ['unblock', '1', 'build'], { env })
  write(dir, id, 'build.md', 'READY\n')
  cli(dir, ['advance', '1', 'check'], { env })
  const r = cli(dir, ['check', '1'], { env })
  assert.equal(r.out.trim(), 'CHECK: FAIL')
  const md = fs.readFileSync(path.join(jobDir(dir, id), 'round-1/checks.md'), 'utf8')
  assert.match(md, /^FAIL\n/)
  assert.match(md, /exited 3/)
  assert.doesNotMatch(md, /console.log\(1\)/)
  const logText = fs.readFileSync(path.join(jobDir(dir, id), 'round-1/checks.log'), 'utf8')
  assert.ok(logText.includes(path.join(dir, '.factory', 'worktrees', id)))
  assert.equal(job(id).activity.at(-1).result, 'FAIL')
})

test('no checks configured passes with a note', () => {
  const { dir, env } = factoryRepo({ checks: [] })
  cli(dir, ['new', 'Thing'], { env })
  cli(dir, ['block', '1', '-m', 'x'], { env })
  cli(dir, ['unblock', '1', 'build'], { env })
  write(dir, '001-thing', 'build.md', 'READY\n')
  cli(dir, ['advance', '1', 'check'], { env })
  assert.equal(cli(dir, ['check', '1'], { env }).out.trim(), 'CHECK: PASS')
  assert.match(fs.readFileSync(path.join(jobDir(dir, '001-thing'), 'round-1/checks.md'), 'utf8'), /No checks are configured/)
})

test('a stale lock left by a dead process is taken over', () => {
  const { dir, env } = factoryRepo()
  fs.mkdirSync(path.join(dir, '.factory/jobs'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.factory/jobs/.lock'), JSON.stringify({ pid: 999999, at: Date.now() }))
  const r = cli(dir, ['new', 'After a crash'], { env })
  assert.equal(r.code, 0, r.err)
  assert.ok(!fs.existsSync(path.join(dir, '.factory/jobs/.lock')))
})

test('concurrent creates get distinct numbers', async () => {
  const { dir, env } = factoryRepo()
  const { spawn } = await import('node:child_process')
  const one = (i) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(dir, '.factory/cli.mjs'), 'new', `Ticket ${i}`], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.on('data', (c) => (out += c))
      p.on('close', () => resolve(out.trim()))
    })
  const ids = await Promise.all([1, 2, 3, 4, 5, 6].map(one))
  assert.equal(new Set(ids.map((id) => id.slice(0, 3))).size, 6)
})

test('delete removes the ticket, its worktree and its branch, and the journal says so', () => {
  const { dir, env } = factoryRepo()
  cli(dir, ['new', 'Thing'], { env })
  const id = '001-thing'
  cli(dir, ['advance', '1', 'plan'], { env })
  write(dir, id, 'plan.md', 'READY\n')
  cli(dir, ['advance', '1', 'build'], { env })
  const wt = path.join(dir, '.factory', 'worktrees', id)
  fs.writeFileSync(path.join(wt, 'thing.txt'), 'half done\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-q', '-m', 'Half a thing')
  fs.writeFileSync(path.join(wt, 'more.txt'), 'never committed\n')

  let r = cli(dir, ['delete', '1'], { env })
  assert.match(r.err, /say why, for the journal/)
  r = cli(dir, ['delete', '1', '-m', 'The', 'customer', 'cancelled', 'it'], { env })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /001-thing: deleted \(1 unmerged commit discarded\)/)
  assert.equal(fs.existsSync(jobDir(dir, id)), false)
  assert.equal(fs.existsSync(wt), false)
  assert.equal(git(dir, 'branch', '--list', `factory/${id}`), '')
  assert.doesNotMatch(git(dir, 'worktree', 'list'), /001-thing/)
  assert.match(cli(dir, ['show', '1'], { env }).err, /no ticket '1'/)

  // what is gone can still be found: by whoever reads the journal, and by an agent loading its context
  const entry = lastLine(cli(dir, ['journal', 'list'], { env }).out)
  assert.match(entry, /decision\s+Deleted ticket 001: Thing/)
  const text = cli(dir, ['journal', 'show', entry.split(/\s+/)[0]], { env }).out
  assert.match(text, /ticket: 001-thing/)
  assert.match(text, /was deleted for good while it was in Build, round 1/)
  assert.match(text, /\(1 commit, tip [0-9a-f]+\) was not merged into main: that work was discarded/)
  assert.match(text, /## Why\nThe customer cancelled it/)
  assert.match(cli(dir, ['context'], { env }).out, /Deleted ticket 001: Thing/)
  assert.match(cli(dir, ['recall', 'deleted', 'thing'], { env }).out, /Deleted ticket 001/)

  // its number is not handed out again
  assert.equal(lastLine(cli(dir, ['new', 'Another'], { env }).out), '002-another')
  // a ticket with no branch yet goes too
  r = cli(dir, ['delete', '2', '-m', 'filed twice'], { env })
  assert.equal(r.code, 0, r.err)
  assert.match(cli(dir, ['journal', 'show', lastLine(r.out).match(/entry (\S+)/)[1]], { env }).out, /It had no branch yet/)
})

test('a ticket a run is working cannot be deleted from under it', async () => {
  const { dir, env } = factoryRepo({ script: { planner: [{ say: 'READY', sleep: 3000 }] } })
  cli(dir, ['new', 'Thing'], { env })
  assert.equal(cli(dir, ['run', '--detach'], { env }).code, 0)
  try {
    for (let i = 0; i < 100 && JSON.parse(cli(dir, ['show', '1'], { env }).out).stage !== 'plan'; i++) await new Promise((r) => setTimeout(r, 50))
    assert.match(cli(dir, ['delete', '1', '-m', 'changed my mind'], { env }).err, /a run is working 001-thing .*`cancel` the run first/)
  } finally {
    cli(dir, ['cancel'], { env })
  }
  assert.equal(cli(dir, ['delete', '1', '-m', 'changed my mind'], { env }).code, 0)
})
