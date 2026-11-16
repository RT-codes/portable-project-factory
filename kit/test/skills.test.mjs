import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildContext, readSkills } from '../.factory/cli.mjs'
import { cli, factoryRepo, git, lastLine, PASS_WITH_JOURNAL } from './helpers.mjs'

function skill(dir, name, text) {
  fs.mkdirSync(path.join(dir, '.factory/skills'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.factory/skills', `${name}.md`), text)
}

test('skills are listed by name and purpose, and read one at a time', () => {
  const { dir, env } = factoryRepo()
  assert.match(cli(dir, ['skills'], { env }).out, /no skills yet/)
  // nothing about skills in the context while there are none
  assert.doesNotMatch(cli(dir, ['context'], { env }).out, /## Skills/)

  skill(dir, 'release', '---\nname: release\ndescription: Cut a release: version, changelog, tag.\n---\n\n# Release\n\n1. Bump the version.\n2. Tag it.\n')
  // no frontmatter: described by its first line of prose
  skill(dir, 'migration', '# Add a migration\n\nUse when the database schema changes.\n\n1. Write it.\n')
  fs.writeFileSync(path.join(dir, '.factory/skills/notes.txt'), 'not a skill')

  const list = cli(dir, ['skills'], { env }).out
  assert.match(list, /^migration: Use when the database schema changes\.$/m)
  assert.match(list, /^release: Cut a release: version, changelog, tag\.$/m)
  assert.doesNotMatch(list, /notes/)
  assert.deepEqual(JSON.parse(cli(dir, ['skills', '--json'], { env }).out), [
    { name: 'migration', description: 'Use when the database schema changes.', file: '.factory/skills/migration.md' },
    { name: 'release', description: 'Cut a release: version, changelog, tag.', file: '.factory/skills/release.md' },
  ])

  // the context names them and says how to read one; it does not carry their text
  const context = cli(dir, ['context'], { env }).out
  assert.match(context, /## Skills \(\.factory\/skills\/\)\n- migration: Use when the database schema changes\.\n- release: Cut a release: version, changelog, tag\.\nWhen one fits the task, read it first: `node \.factory\/cli\.mjs skill <name>`\./)
  assert.doesNotMatch(context, /Bump the version/)
  assert.equal(JSON.parse(cli(dir, ['context', '--json'], { env }).out).skills.length, 2)

  // one skill, whole, without its frontmatter; a unique start of the name is enough
  assert.equal(cli(dir, ['skill', 'release'], { env }).out, '# Release\n\n1. Bump the version.\n2. Tag it.\n')
  assert.match(cli(dir, ['skill', 'mig'], { env }).out, /^# Add a migration/)
  const missing = cli(dir, ['skill', 'deploy'], { env })
  assert.notEqual(missing.code, 0)
  assert.match(missing.err, /no skill 'deploy' \(there are: migration, release\)/)
})

test('a long list of skills stays a short part of the context', () => {
  const skills = Array.from({ length: 60 }, (_, i) => ({ name: `skill-${String(i).padStart(2, '0')}`, description: 'x'.repeat(400), file: '' }))
  const text = buildContext({ name: 'R', rules: '', tickets: [], run: null, entries: [], skills })
  const section = text.slice(text.indexOf('## Skills'), text.indexOf('## Tickets'))
  assert.equal(section.split('\n').filter((l) => l.startsWith('- ')).length, 40)
  assert.match(section, /\(20 more: `node \.factory\/cli\.mjs skills`\)/)
})

test('stage agents are told of the skills, and a ticket cannot change them', () => {
  // the builder edits a skill on its branch
  const { dir, env, calls } = factoryRepo({ script: { builder: [{ say: 'READY', write: { '.factory/skills/release.md': 'changed by the builder' }, commit: true }], reviewer: [PASS_WITH_JOURNAL] }, config: (c) => (c.max_rounds = 1) })
  skill(dir, 'release', '---\ndescription: Cut a release.\n---\nSteps.\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'add a skill')
  assert.equal(readSkills(path.join(dir, '.factory')).length, 1)
  const id = lastLine(cli(dir, ['new', 'Touch a skill'], { env }).out)
  cli(dir, ['run'], { env })
  // every stage's prompt names the skill and where its file is, not its text
  const planner = calls().find((c) => c.role === 'planner').prompt
  assert.match(planner, /# This repo's skills \(\.factory\/skills\/\)\n\n- release: Cut a release\.\nWhen one fits what you are doing, read its file/)
  assert.doesNotMatch(planner, /^Steps\.$/m)
  // skills steer agents, like the rules: a branch that edits one fails its check
  const checks = fs.readFileSync(path.join(dir, '.factory/jobs', id, 'round-1/checks.md'), 'utf8')
  assert.match(checks, /^FAIL/)
  assert.match(checks, /\.factory\/skills\/release\.md/)
})
