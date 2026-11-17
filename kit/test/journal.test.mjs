import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { formatEntry, parseEntry, rank, stem } from '../.factory/cli.mjs'
import { cli, factoryRepo, git, lastLine } from './helpers.mjs'

function entry(dir, { id, at, title, kind = 'feature', files = [], tags = [], why = 'Because.', what = 'Something changed.', extra = '' }) {
  const file = path.join(dir, '.factory/journal', at.slice(0, 4), `${id}.md`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, formatEntry({ id, at, title, kind, files, tags }, `## What changed\n${what}\n\n## Why\n${why}\n${extra}`))
}

test('entries round-trip: JSON or bare string values', () => {
  const meta = { id: '2026-11-15-x', at: '2026-11-15T14:03:00Z', title: 'A: "quoted" title', kind: 'fix', ticket: '004-x', commits: ['abc1234'], files: ['src/a.ts'], tags: [], by: { planner: 'claude:default' }, odd: '2024' }
  const text = formatEntry(meta, '## What changed\nx\n\n## Why\ny')
  assert.match(text, /^---\nid: 2026-11-15-x\nat: 2026-11-15T14:03:00Z\ntitle: A: "quoted" title\nkind: fix\nticket: 004-x\ncommits: \["abc1234"\]\nfiles: \["src\/a.ts"\]\ntags: \[\]\nby: \{"planner":"claude:default"\}\nodd: "2024"\n---\n## What changed/)
  const back = parseEntry(text)
  assert.deepEqual(back.meta, meta)
  assert.equal(back.body, '## What changed\nx\n\n## Why\ny')
  assert.equal(stem('toggles'), 'toggle')
  assert.equal(stem('libraries'), 'library')
})

test('journal add writes an uncommitted entry with facts from HEAD; list and show read it', () => {
  const { dir, env } = factoryRepo()
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src/login.ts'), 'x')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'raise the login timeout')
  const head = git(dir, 'rev-parse', '--short', 'HEAD')
  let r = cli(dir, ['journal', 'add', '--title', 'Raise the login timeout', '--kind', 'fix', '--tags', 'Auth,login', '--what', 'Login waits 30s.', '--why', 'Slow networks timed out.', '--decision', 'Not configurable yet.'], { env })
  assert.equal(r.code, 0, r.err)
  const id = lastLine(r.out)
  assert.match(id, /^\d{4}-\d\d-\d\d-raise-the-login-timeout$/)
  assert.match(r.out, /not committed/)
  const file = path.join(dir, '.factory/journal', id.slice(0, 4), `${id}.md`)
  const { meta, body } = parseEntry(fs.readFileSync(file, 'utf8'))
  assert.deepEqual([meta.kind, meta.commits, meta.files, meta.tags, meta.branch], ['fix', [head], ['src/login.ts'], ['auth', 'login'], 'main'])
  assert.equal(meta.ticket, undefined)
  assert.equal(body, '## What changed\nLogin waits 30s.\n\n## Why\nSlow networks timed out.\n\n## Decisions\n- Not configurable yet.')
  assert.match(git(dir, 'status', '--porcelain'), /\.factory\/journal\//)

  // Prose on stdin, explicit files, and a second entry with the same title gets a suffix.
  r = cli(dir, ['journal', 'add', '--title', 'Raise the login timeout', '--files', 'src/a.ts,src/b.ts'], { env, input: '## What changed\nAgain.\n\n## Why\nStill slow.\n' })
  assert.equal(r.code, 0, r.err)
  assert.equal(lastLine(r.out), `${id}-2`)
  const second = parseEntry(fs.readFileSync(path.join(dir, '.factory/journal', id.slice(0, 4), `${id}-2.md`), 'utf8')).meta
  assert.deepEqual([second.kind, second.files, second.commits], ['chore', ['src/a.ts', 'src/b.ts'], []])

  r = cli(dir, ['journal', 'add', '--title', 'No reason', '--what', 'x'], { env })
  assert.equal(r.code, 1)
  assert.match(r.err, /no "## Why" section/)
  r = cli(dir, ['journal', 'add', '--title', 'Bad', '--what', 'x', '--why', 'y', '--commit', 'nope'], { env })
  assert.match(r.err, /'nope' is not a commit/)

  const list = JSON.parse(cli(dir, ['journal', 'list', '--json'], { env }).out)
  assert.equal(list.length, 2)
  assert.match(cli(dir, ['journal', 'list'], { env }).out, /raise-the-login-timeout\s+fix\s+Raise the login timeout/)
  assert.equal(cli(dir, ['journal', 'show', id], { env }).out, fs.readFileSync(file, 'utf8'))
  assert.match(cli(dir, ['journal', 'show', 'nothing'], { env }).err, /no journal entry 'nothing'/)
})

test('recall ranks by words and by path, then folder', () => {
  const { dir, env } = factoryRepo()
  entry(dir, { id: '2026-01-02-dark-mode', at: '2026-01-02T10:00:00Z', title: 'Add a dark mode toggle', tags: ['ui', 'theme'], files: ['src/ui/theme.css'], what: 'Settings has a dark mode toggle.', why: 'Users work at night.' })
  entry(dir, { id: '2026-02-03-login-timeout', at: '2026-02-03T10:00:00Z', title: 'Raise the login timeout', kind: 'fix', tags: ['auth'], files: ['src/auth/login.ts'], why: 'Slow networks timed out during login.' })
  entry(dir, { id: '2026-03-04-session-store', at: '2026-03-04T10:00:00Z', title: 'Keep sessions in memory', kind: 'refactor', tags: ['auth'], files: ['src/auth/session.ts'], why: 'The file store was slow.' })
  entry(dir, { id: '2026-04-05-readme', at: '2026-04-05T10:00:00Z', title: 'Explain the setup', kind: 'chore', files: ['README.md'], why: 'People asked about dark corners of setup.' })
  const ids = (q) => JSON.parse(cli(dir, ['recall', ...q.split(' '), '--json'], { env }).out).map((h) => h.id)
  assert.deepEqual(ids('dark mode toggles').slice(0, 1), ['2026-01-02-dark-mode'])
  assert.deepEqual(ids('src/auth/login.ts'), ['2026-02-03-login-timeout', '2026-03-04-session-store'])
  assert.deepEqual(ids('src/auth').sort(), ['2026-02-03-login-timeout', '2026-03-04-session-store'])
  assert.deepEqual(ids('theme.css'), ['2026-01-02-dark-mode'])
  assert.deepEqual(ids('login slow').slice(0, 1), ['2026-02-03-login-timeout'])
  assert.deepEqual(ids('kubernetes'), [])
  const text = cli(dir, ['recall', 'login', 'timeout'], { env }).out
  assert.match(text, /^1\. 2026-02-03 fix: Raise the login timeout \(2026-02-03-login-timeout\)\n   files: src\/auth\/login\.ts\n   > Slow networks timed out during login\./)
  assert.match(text, /journal show <id>/)
  // Pure and deterministic.
  const es = [{ id: 'a', at: '1', title: 'same', kind: '', files: [], tags: [], body: '' }, { id: 'b', at: '2', title: 'same', kind: '', files: [], tags: [], body: '' }]
  assert.deepEqual(rank(es, 'same').map((h) => h.entry.id), ['b', 'a'])
})

test('context is layered and bounded with a long history, and --for brings old matches first', () => {
  const { dir, env } = factoryRepo()
  // A long history: 72 entries over three years, one old one touching src/legacy/parser.ts.
  for (let i = 0; i < 72; i++) {
    const d = new Date(Date.UTC(2023, 0, 1) + i * 15 * 86400000)
    const at = d.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const files = i === 3 ? ['src/legacy/parser.ts'] : [`src/mod${i % 7}/file${i}.ts`, `src/mod${i % 7}/other${i}.ts`, 'package.json']
    entry(dir, { id: `${at.slice(0, 10)}-change-${i}`, at, title: `Change number ${i} with a fairly long descriptive title`, files, tags: [`area${i % 4}`], what: 'Line one.\n'.repeat(20), why: 'A long reason. '.repeat(80), extra: '\n## Decisions\n- one\n- two\n\n## Watch out\n- careful\n' })
  }
  fs.writeFileSync(path.join(dir, '.factory/rules.md'), Array.from({ length: 150 }, (_, i) => `- rule ${i}`).join('\n'))
  for (let i = 0; i < 25; i++) cli(dir, ['new', `Ticket ${i}`], { env })
  for (let i = 1; i <= 12; i++) cli(dir, ['block', String(i), '-m', 'needs a decision '.repeat(20)], { env })

  const out = cli(dir, ['context'], { env }).out
  assert.equal(out, cli(dir, ['context'], { env }).out, 'deterministic')
  const lines = out.split('\n')
  assert.ok(lines.length < 300, `context has ${lines.length} lines`)
  assert.ok(lines.every((l) => l.length <= 400), 'no huge lines')
  const order = ['## Workflow', '## Rules', '## Tickets', '## Journal (72 entries', '### Recent', '### Earlier', '### Older, by month', 'Dig deeper']
  let at = -1
  for (const h of order) {
    const i = out.indexOf(h)
    assert.ok(i > at, `${h} in order`)
    at = i
  }
  assert.match(out, /\.\.\. \(90 more lines in \.factory\/rules\.md\)/)
  assert.match(out, /\.\.\. and \d+ more \(`status`\)/)
  const recent = out.slice(out.indexOf('### Recent'), out.indexOf('### Earlier'))
  assert.equal((recent.match(/^- \d{4}/gm) || []).length, 5)
  assert.match(recent, /  Why: A long reason/)
  const earlier = out.slice(out.indexOf('### Earlier'), out.indexOf('### Older'))
  assert.equal((earlier.match(/^- \d{4}/gm) || []).length, 20)
  assert.match(out, /^- \d{4}-\d\d: \d entr(y|ies); tags area\d \(\d\)/m)
  assert.doesNotMatch(out, /parser\.ts/)

  const focused = cli(dir, ['context', '--for', 'src/legacy/parser.ts'], { env }).out
  assert.ok(focused.split('\n').length < 300)
  const touching = focused.slice(focused.indexOf('### Touching src/legacy/parser.ts'), focused.indexOf('### Recent'))
  assert.match(touching, /change-3\)/)
  assert.match(touching, /## Why/)
  assert.ok(focused.indexOf('change-3)') < focused.indexOf('### Recent'))

  const json = JSON.parse(cli(dir, ['context', '--json', '--for', 'src/legacy'], { env }).out)
  assert.equal(json.entries.length, 72)
  assert.deepEqual(json.for, ['src/legacy'])
  assert.match(json.text, /### Touching src\/legacy/)
})

test('context on an empty repo says what to do', () => {
  const { dir, env } = factoryRepo()
  const out = cli(dir, ['context'], { env }).out
  assert.match(out, /- none open/)
  assert.match(out, /- no entries yet/)
  assert.match(out, /Run: none in progress/)
})

test('the CLI in a ticket worktree acts on the main checkout', () => {
  const { dir, env } = factoryRepo()
  cli(dir, ['new', 'Thing'], { env })
  cli(dir, ['block', '1', '-m', 'x'], { env })
  cli(dir, ['unblock', '1', 'build'], { env })
  const wt = path.join(dir, '.factory/worktrees/001-thing')
  const r = cli(wt, ['status', '--json'], { env })
  assert.equal(r.code, 0, r.err)
  assert.equal(JSON.parse(r.out).tickets[0].id, '001-thing')
  assert.ok(!fs.existsSync(path.join(wt, '.factory/jobs')))
})

test('reads what a run really used from the agent\'s own output', async () => {
  const { runFacts } = await import('../.factory/cli.mjs')
  const claude = [
    'noise',
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }),
    JSON.stringify({ type: 'result', subtype: 'success', num_turns: 4, total_cost_usd: 0.75412, usage: { input_tokens: 8, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 72 } }),
  ].join('\n')
  assert.deepEqual(runFacts('claude', claude), { model: 'claude-sonnet-5-5', turns: 4, cost_usd: 0.754, input: 8, cache_read: 100, cache_write: 20, output: 72, tokens: 200 })
  const codex = 'OpenAI Codex v0.167.2\n--------\nmodel: gpt-6.1-sol\nprovider: openai\nreasoning effort: medium\n--------\nuser\nhi\ntokens used\n8,214\n'
  assert.deepEqual(runFacts('codex', codex), { model: 'gpt-6.1-sol', effort: 'medium', tokens: 8214 })
  // an agent that reports nothing leaves nothing
  assert.deepEqual(runFacts('codex', 'hello'), {})
  assert.deepEqual(runFacts('claude', ''), {})
})
