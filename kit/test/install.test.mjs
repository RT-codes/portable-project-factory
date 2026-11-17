import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ROOT, git, install, makeRepo, readJson, tmp } from './helpers.mjs'

const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8')
const exists = (dir, f) => fs.existsSync(path.join(dir, f))
const count = (text, s) => text.split(s).length - 1

test('install writes the kit and nothing else', () => {
  const dir = makeRepo()
  const r = install(dir)
  assert.equal(r.code, 0, r.err)
  const files = git(dir, 'ls-files', '--others', '--exclude-standard').split('\n').sort()
  assert.deepEqual(files, [
    '.claude/CLAUDE.md',
    '.claude/skills/factory/SKILL.md',
    '.factory/.gitignore',
    '.factory/cli.mjs',
    '.factory/config.json',
    '.factory/roles/builder.md',
    '.factory/roles/planner.md',
    '.factory/roles/reviewer.md',
    '.factory/rules.md',
    '.factory/version',
    'AGENTS.md',
  ])
  assert.match(read(dir, '.factory/version'), /^1\.1\.0\n/)
  assert.equal(read(dir, '.factory/.gitignore'), read(ROOT, 'kit/.factory/gitignore'))
  assert.match(read(dir, '.claude/CLAUDE.md'), /^<!-- factory:start -->\n@\.\.\/AGENTS\.md\n<!-- factory:end -->\n$/)
  assert.match(read(dir, 'AGENTS.md'), /FACTORY ROLE:/)
  assert.match(r.out, /Next:\n  1\./)
})

test('install sets base_branch to the repo default branch', () => {
  const dir = makeRepo({ branch: 'trunk' })
  assert.equal(install(dir).code, 0)
  assert.equal(readJson(path.join(dir, '.factory/config.json')).base_branch, 'trunk')
})

test('install refuses a folder that is not a git repo, this repo, and an existing install', () => {
  const plain = tmp('plain')
  let r = install(plain)
  assert.equal(r.code, 1)
  assert.match(r.err, /not a git repository/)
  r = install(ROOT)
  assert.equal(r.code, 1)
  assert.match(r.err, /factory's own repo/)
  const dir = makeRepo()
  assert.equal(install(dir).code, 0)
  r = install(dir)
  assert.equal(r.code, 1)
  assert.match(r.err, /--update/)
})

test('update refreshes owned files and keeps user files; blocks are replaced, never duplicated', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Our agents\n\nBe kind.\n')
  assert.equal(install(dir).code, 0)
  const agents = read(dir, 'AGENTS.md')
  assert.ok(agents.startsWith('# Our agents\n\nBe kind.\n\n<!-- factory:start -->'))
  // The user edits their files and adds text after the block; the owned CLI gets stale.
  fs.writeFileSync(path.join(dir, '.factory/rules.md'), 'my rules\n')
  fs.writeFileSync(path.join(dir, '.factory/roles/builder.md'), 'my builder\n')
  fs.writeFileSync(path.join(dir, '.factory/config.json'), JSON.stringify({ name: 'Mine', stages: [] }))
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\n## After\nKeep me.\n')
  fs.writeFileSync(path.join(dir, '.factory/cli.mjs'), 'stale')
  fs.mkdirSync(path.join(dir, '.factory/journal/2026'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.factory/journal/2026/x.md'), 'entry')

  for (let i = 0; i < 2; i++) assert.equal(install(dir, '--update').code, 0)
  assert.equal(read(dir, '.factory/rules.md'), 'my rules\n')
  assert.equal(read(dir, '.factory/roles/builder.md'), 'my builder\n')
  assert.equal(readJson(path.join(dir, '.factory/config.json')).name, 'Mine')
  assert.equal(read(dir, '.factory/cli.mjs'), read(ROOT, 'kit/.factory/cli.mjs'))
  assert.equal(read(dir, '.factory/journal/2026/x.md'), 'entry')
  const after = read(dir, 'AGENTS.md')
  assert.equal(count(after, '<!-- factory:start -->'), 1)
  assert.ok(after.startsWith('# Our agents\n\nBe kind.\n\n<!-- factory:start -->'))
  assert.ok(after.endsWith('<!-- factory:end -->\n\n## After\nKeep me.\n'))
  assert.equal(count(read(dir, '.claude/CLAUDE.md'), '@../AGENTS.md'), 1)
})

test('force overwrites user files but keeps the journal, tickets and local.json', () => {
  const dir = makeRepo()
  assert.equal(install(dir).code, 0)
  fs.writeFileSync(path.join(dir, '.factory/rules.md'), 'my rules\n')
  fs.writeFileSync(path.join(dir, '.factory/local.json'), '{"agent":"codex"}')
  fs.mkdirSync(path.join(dir, '.factory/journal/2026'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.factory/journal/2026/x.md'), 'entry')
  assert.equal(install(dir, '--force').code, 0)
  assert.equal(read(dir, '.factory/rules.md'), read(ROOT, 'kit/.factory/rules.md'))
  assert.equal(read(dir, '.factory/local.json'), '{"agent":"codex"}')
  assert.equal(read(dir, '.factory/journal/2026/x.md'), 'entry')
})

test('an existing CLAUDE.md gets the import it lacks; one that imports AGENTS.md is left alone', () => {
  const a = makeRepo()
  fs.writeFileSync(path.join(a, 'CLAUDE.md'), '# Claude\n')
  assert.equal(install(a).code, 0)
  assert.equal(read(a, 'CLAUDE.md'), '# Claude\n\n<!-- factory:start -->\n@AGENTS.md\n<!-- factory:end -->\n')
  assert.ok(!exists(a, '.claude/CLAUDE.md'))
  assert.equal(install(a, '--update').code, 0)
  assert.equal(count(read(a, 'CLAUDE.md'), '@AGENTS.md'), 1)

  const b = makeRepo()
  fs.mkdirSync(path.join(b, '.claude'))
  fs.writeFileSync(path.join(b, '.claude/CLAUDE.md'), 'Read this:\n@../AGENTS.md\n')
  assert.equal(install(b).code, 0)
  assert.equal(read(b, '.claude/CLAUDE.md'), 'Read this:\n@../AGENTS.md\n')
  assert.ok(!exists(b, 'CLAUDE.md'))
})

test('remove takes out owned files and blocks, keeps user content unless --force', () => {
  const dir = makeRepo()
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Our agents\n')
  assert.equal(install(dir).code, 0)
  fs.mkdirSync(path.join(dir, '.factory/journal/2026'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.factory/journal/2026/x.md'), 'entry')
  let r = install(dir, '--remove')
  assert.equal(r.code, 0, r.err)
  assert.equal(read(dir, 'AGENTS.md'), '# Our agents\n')
  assert.ok(!exists(dir, '.claude'))
  assert.ok(!exists(dir, '.factory/cli.mjs'))
  assert.ok(!exists(dir, '.factory/.gitignore'))
  assert.ok(exists(dir, '.factory/config.json'))
  assert.ok(exists(dir, '.factory/roles/planner.md'))
  r = install(dir, '--remove', '--force')
  assert.equal(r.code, 0, r.err)
  assert.ok(!exists(dir, '.factory/config.json'))
  assert.ok(!exists(dir, '.factory/roles'))
  assert.equal(read(dir, '.factory/journal/2026/x.md'), 'entry')

  // With tickets on disk the .gitignore stays, so they never show up as files to commit.
  const busy = makeRepo()
  assert.equal(install(busy).code, 0)
  git(busy, 'add', '-A')
  git(busy, 'commit', '-q', '-m', 'install')
  fs.mkdirSync(path.join(busy, '.factory/jobs/001-x'), { recursive: true })
  fs.writeFileSync(path.join(busy, '.factory/jobs/001-x/job.json'), '{}')
  assert.equal(install(busy, '--remove').code, 0)
  assert.ok(exists(busy, '.factory/.gitignore'))
  assert.doesNotMatch(git(busy, 'status', '--porcelain', '--untracked-files=all'), /jobs/)

  const fresh = makeRepo()
  assert.equal(install(fresh).code, 0)
  assert.equal(install(fresh, '--remove', '--force').code, 0)
  assert.ok(!exists(fresh, 'AGENTS.md'))
  assert.ok(!exists(fresh, '.factory'))
  assert.equal(git(fresh, 'status', '--porcelain'), '')
})
