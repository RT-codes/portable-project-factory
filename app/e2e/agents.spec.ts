import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, view } from './launch'

const tree = (page: Page, file: string) => page.locator(`[data-path="${file}"]`)
const editor = (page: Page, file: string) => page.locator(`[data-editing="${file}"]`)
const fileTool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'File' }).getByRole('button', { name, exact: true })
const panes = (page: Page) => page.locator('[data-pane]')

/** Type at the end of the file in the editor. */
async function type(page: Page, text: string) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

async function open(page: Page, file: string) {
  await view(page, 'Agents')
  await tree(page, file).click()
  await expect(editor(page, file)).toBeVisible()
}

/** A line of a file as it is on disk, to find it in the editor. */
const lineOf = (repo: string, file: string) =>
  fs
    .readFileSync(path.join(repo, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3 && !/^(---|#+\s*$)/.test(l))!

test('lists the agent files as a tree and opens one beside it', async ({ page, fixture }) => {
  await view(page, 'Agents')
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  for (const file of ['.factory/roles/planner.md', '.factory/roles/builder.md', '.factory/roles/reviewer.md', '.factory/rules.md', '.factory/config.json', '.claude/agents/copywriter.md', '.claude/skills/factory/SKILL.md', 'AGENTS.md'])
    await expect(tree(page, file)).toBeVisible()
  // not the project's code, nor the factory's own state: only what instructs agents
  for (const file of ['src/cart.ts', 'README.md', '.factory/cli.mjs', '.factory/version', '.factory/jobs/001-show-the-vat-amount/job.json', '.factory/journal'])
    await expect(tree(page, file)).toHaveCount(0)

  await tree(page, '.factory/roles/planner.md').click()
  await expect(panes(page)).toHaveCount(2)
  const edit = panes(page).nth(1)
  await expect(edit.getByRole('heading', { name: /planner\.md/ })).toBeVisible()
  await expect(edit.locator('.cm-content')).toContainText(lineOf(fixture.repo, '.factory/roles/planner.md'))
  // the tree stays where it was; another file opens in the same second panel
  await tree(page, '.factory/roles/reviewer.md').click()
  await expect(panes(page)).toHaveCount(2)
  await expect(edit.locator('.cm-content')).toContainText(lineOf(fixture.repo, '.factory/roles/reviewer.md'))
})

test('edits a file and saves it', async ({ page, fixture }) => {
  const file = '.factory/roles/planner.md'
  const disk = () => fs.readFileSync(path.join(fixture.repo, file), 'utf8')
  await open(page, file)
  await expect(fileTool(page, 'Save')).toBeDisabled()
  await type(page, '\nAlways name the files you will touch.\n')
  await expect(editor(page, file).getByText('Unsaved')).toBeVisible()
  // the tree marks it, and so does the sidebar
  await expect(tree(page, file).getByLabel('Unsaved changes')).toBeVisible()
  expect(disk()).not.toContain('Always name the files')

  await fileTool(page, 'Save').click()
  await expect(editor(page, file).getByText('Saved')).toBeVisible()
  await expect(editor(page, file).getByText('Unsaved')).toBeHidden()
  expect(disk()).toContain('Always name the files you will touch.')
  await expect(tree(page, file).getByLabel('Unsaved changes')).toHaveCount(0)

  // from the keyboard too
  await type(page, 'And the tests.\n')
  await page.keyboard.press('Control+s')
  await expect.poll(disk).toContain('And the tests.')

  // revert throws the unsaved text away
  await type(page, 'Never mind this.')
  await fileTool(page, 'Revert').click()
  await expect(page.locator('.cm-content')).not.toContainText('Never mind this.')
  await expect(fileTool(page, 'Save')).toBeDisabled()
})

test('shows a markdown file raw or as it reads', async ({ page }) => {
  await open(page, '.claude/agents/copywriter.md')
  await expect(fileTool(page, 'Raw')).toHaveAttribute('aria-pressed', 'true')
  await fileTool(page, 'Rich').click()
  const rich = page.locator('[data-rich]')
  // the frontmatter as fields, the rest as a document
  await expect(rich.locator('dl')).toContainText('name')
  await expect(rich.locator('dl')).toContainText('copywriter')
  await expect(rich.locator('.md')).not.toContainText('---')
  await expect(page.locator('.cm-content')).toHaveCount(0)
  // an edit made raw shows rich
  await fileTool(page, 'Raw').click()
  await type(page, '\n## A new section\n')
  await fileTool(page, 'Rich').click()
  await expect(rich.getByRole('heading', { name: 'A new section' })).toBeVisible()
  // and saving works from the rich view
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
})

test('renames and deletes a file', async ({ page, fixture }) => {
  const at = (rel: string) => path.join(fixture.repo, rel)
  await open(page, '.claude/agents/security-reviewer.md')
  await fileTool(page, 'Rename').click()
  await page.getByLabel('New path').fill('.claude/agents/critic.md')
  await page.getByRole('form', { name: 'Rename' }).getByRole('button', { name: 'Rename' }).click()
  await expect(editor(page, '.claude/agents/critic.md')).toBeVisible()
  await expect(tree(page, '.claude/agents/critic.md')).toBeVisible()
  await expect(tree(page, '.claude/agents/security-reviewer.md')).toHaveCount(0)
  expect(fs.existsSync(at('.claude/agents/critic.md'))).toBe(true)
  expect(fs.existsSync(at('.claude/agents/security-reviewer.md'))).toBe(false)

  // onto a name that is taken: refused, nothing lost
  await fileTool(page, 'Rename').click()
  await page.getByLabel('New path').fill('.claude/agents/copywriter.md')
  await page.getByRole('form', { name: 'Rename' }).getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('alert')).toContainText('already exists')
  await page.getByRole('form', { name: 'Rename' }).getByRole('button', { name: 'Cancel' }).click()

  // deleting asks twice, then the editor's panel goes with the file
  await fileTool(page, 'Delete').click()
  expect(fs.existsSync(at('.claude/agents/critic.md'))).toBe(true)
  await page.getByRole('button', { name: 'Move to the trash' }).click()
  await expect(tree(page, '.claude/agents/critic.md')).toHaveCount(0)
  await expect(panes(page)).toHaveCount(1)
  expect(fs.existsSync(at('.claude/agents/critic.md'))).toBe(false)
})

test('creates files and folders', async ({ page, fixture }) => {
  await view(page, 'Agents')
  await page.getByRole('button', { name: 'New file' }).click()
  await page.getByLabel('Path of the new file').fill('.claude/agents/tester.md')
  await page.getByRole('button', { name: 'Create' }).click()
  // a new agent starts from the frontmatter Claude Code reads, and opens ready to edit
  await expect(editor(page, '.claude/agents/tester.md').locator('.cm-content')).toContainText('name: tester')
  expect(fs.readFileSync(path.join(fixture.repo, '.claude/agents/tester.md'), 'utf8')).toMatch(/^---\nname: tester\ndescription: /)

  await panes(page).nth(0).getByRole('heading', { name: 'Agents' }).click()
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Path of the new folder').fill('.claude/commands')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(tree(page, '.claude/commands')).toContainText('empty')
  expect(fs.statSync(path.join(fixture.repo, '.claude/commands')).isDirectory()).toBe(true)

  // the instruction file at the root
  await page.getByRole('button', { name: 'New file' }).click()
  await page.getByLabel('Path of the new file').fill('CLAUDE.md')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(tree(page, 'CLAUDE.md')).toBeVisible()
  // but not anywhere in the project
  await page.getByRole('button', { name: 'New file' }).click()
  await page.getByLabel('Path of the new file').fill('src/evil.ts')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('alert')).toContainText('not a file the app manages')
  expect(fs.existsSync(path.join(fixture.repo, 'src/evil.ts'))).toBe(false)
})

test('checks and tidies JSON, and keeps the factory files in place', async ({ page, fixture }) => {
  // the factory needs its rules and role prompts where they are: they can be edited, not renamed or deleted
  await view(page, 'Agents')
  for (const file of ['.factory/rules.md', '.factory/roles/builder.md']) {
    await panes(page).nth(0).locator(`[data-path="${file}"]`).click()
    await expect(editor(page, file)).toBeVisible()
    await expect(fileTool(page, 'Save')).toBeVisible()
    await expect(fileTool(page, 'Rename')).toHaveCount(0)
    await expect(fileTool(page, 'Delete')).toHaveCount(0)
  }
  await panes(page).nth(0).locator('[data-path=".factory/config.json"]').click()
  await expect(editor(page, '.factory/config.json')).toBeVisible()
  await expect(fileTool(page, 'Rename')).toHaveCount(0)
  await expect(fileTool(page, 'Delete')).toHaveCount(0)
  await type(page, 'oops')
  await expect(page.getByText(/Not valid JSON/)).toBeVisible()
  await expect(fileTool(page, 'Format')).toBeDisabled()
  await fileTool(page, 'Revert').click()
  await expect(page.getByText(/Not valid JSON/)).toHaveCount(0)

  fs.writeFileSync(path.join(fixture.repo, '.claude/settings.json'), '{"permissions":{"allow":["Bash(npm test)"]}}')
  await panes(page).nth(0).getByRole('button', { name: 'Refresh' }).click()
  await tree(page, '.claude/settings.json').click()
  await fileTool(page, 'Format').click()
  await fileTool(page, 'Save').click()
  await expect.poll(() => fs.readFileSync(path.join(fixture.repo, '.claude/settings.json'), 'utf8')).toBe('{\n  "permissions": {\n    "allow": [\n      "Bash(npm test)"\n    ]\n  }\n}\n')
})

test('notices when an agent changed the file meanwhile', async ({ page, fixture }) => {
  const file = '.factory/roles/builder.md'
  const full = path.join(fixture.repo, file)
  await open(page, file)
  await type(page, '\nMine.\n')
  fs.appendFileSync(full, '\nTheirs.\n')
  await fileTool(page, 'Save').click()
  const warning = page.getByRole('alert').filter({ hasText: 'changed on disk' })
  await expect(warning).toBeVisible()
  expect(fs.readFileSync(full, 'utf8')).not.toContain('Mine.')

  // take theirs: the file as it is on disk, my edit gone
  await warning.getByRole('button', { name: 'Load theirs' }).click()
  await expect(page.locator('.cm-content')).toContainText('Theirs.')
  await expect(page.locator('.cm-content')).not.toContainText('Mine.')

  // or keep mine: written over theirs, on purpose
  await type(page, '\nMine again.\n')
  fs.appendFileSync(full, '\nTheirs again.\n')
  await fileTool(page, 'Save').click()
  await warning.getByRole('button', { name: 'Save mine over it' }).click()
  await expect(warning).toBeHidden()
  expect(fs.readFileSync(full, 'utf8')).toContain('Mine again.')
  expect(fs.readFileSync(full, 'utf8')).not.toContain('Theirs again.')
})

test('keeps unsaved text when the editor panel is closed', async ({ page }) => {
  const file = '.factory/rules.md'
  await open(page, file)
  await type(page, '\nHalf a thought\n')
  await page.getByRole('toolbar', { name: 'Panels' }).getByRole('button', { name: 'Close this panel' }).click()
  await expect(panes(page)).toHaveCount(1)
  await expect(tree(page, file).getByLabel('Unsaved changes')).toBeVisible()
  await tree(page, file).click()
  await expect(page.locator('.cm-content')).toContainText('Half a thought')
  await expect(editor(page, file).getByText('Unsaved')).toBeVisible()
})

test('hands a file to the system editor and the file manager', async ({ page, fixture }) => {
  const file = '.claude/skills/factory/SKILL.md'
  await open(page, file)
  await fileTool(page, 'Open in editor').click()
  await fileTool(page, 'Show in folder').click()
  await expect.poll(() => fixture.opened()).toEqual([`open ${path.join(fs.realpathSync(fixture.repo), file)}`, `reveal ${path.join(fs.realpathSync(fixture.repo), file)}`])
})

test('writes only where agent files live, and never through a link out of there', async ({ page, fixture }) => {
  type Bridge = { factoryApp: { invoke(method: string, args: unknown[]): Promise<{ ok: boolean; error?: string }> } }
  const call = (method: string, args: unknown[]) => page.evaluate(([m, a]) => (globalThis as unknown as Bridge).factoryApp.invoke(m as string, a as unknown[]), [method, args] as const)
  const repo = fixture.repo
  // the project's own code, and ways around the folder
  // and the factory's own state, CLI and per-user file, which live next to its rules and roles
  const vatTicket = '.factory/jobs/001-show-the-vat-amount'
  for (const target of [
    'src/cart.ts',
    'package.json',
    '.claude/../package.json',
    '../outside.md',
    '/etc/passwd',
    '.claude\\..\\x',
    '.git/config',
    '.factory/cli.mjs',
    '.factory/version',
    '.factory/local.json',
    '.factory/.gitignore',
    `${vatTicket}/job.json`,
    `${vatTicket}/plan.md`,
    '.factory/journal/2026/x.md',
    '.factory/worktrees/001-show-the-vat-amount/src/cart.ts',
    '.factory/roles/../cli.mjs',
    '.factory/rolesx/a.md',
  ]) {
    expect(await call('agentWrite', [repo, target, 'x', null, true]), target).toMatchObject({ ok: false })
    expect(await call('agentRead', [repo, target]), target).toMatchObject({ ok: false })
  }
  expect(fs.existsSync(path.join(repo, '.factory/local.json'))).toBe(false)
  expect(await call('agentMkdir', [repo, '.factory/jobs/evil'])).toMatchObject({ ok: false })
  for (const fixed of ['.claude', '.factory/roles', '.factory/config.json', '.factory/rules.md', '.factory/roles/planner.md']) expect(await call('agentDelete', [repo, fixed]), fixed).toMatchObject({ ok: false })
  expect(await call('agentRename', [repo, '.claude/agents/copywriter.md', 'src/copywriter.md'])).toMatchObject({ ok: false })
  expect(await call('agentRename', [repo, '.factory/roles/planner.md', '.factory/roles/thinker.md'])).toMatchObject({ ok: false })
  expect(await call('agentRename', [repo, '.claude/agents/copywriter.md', '.factory/cli.mjs'])).toMatchObject({ ok: false })
  // a ticket's plan, read through a role file's name: refused too
  expect(await call('agentRead', [repo, `.factory/roles/../jobs/001-show-the-vat-amount/plan.md`])).toMatchObject({ ok: false })

  // a link inside .claude that points out of the project
  const outside = path.join(repo, '..', 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
  fs.symlinkSync(outside, path.join(repo, '.claude/escape'))
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(repo, '.claude/agents/link.md'))
  expect(await call('agentWrite', [repo, '.claude/escape/new.md', 'x', null])).toMatchObject({ ok: false })
  expect(await call('agentRead', [repo, '.claude/escape/secret.md'])).toMatchObject({ ok: false })
  expect(await call('agentRead', [repo, '.claude/agents/link.md'])).toMatchObject({ ok: false })
  expect(await call('agentWrite', [repo, '.claude/agents/link.md', 'x', 0, true])).toMatchObject({ ok: false })
  // the same in the role prompts' folder, and a role file that is a link out
  fs.symlinkSync(outside, path.join(repo, '.factory/roles/escape'))
  fs.rmSync(path.join(repo, '.factory/roles/reviewer.md'))
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(repo, '.factory/roles/reviewer.md'))
  expect(await call('agentWrite', [repo, '.factory/roles/escape/new.md', 'x', null])).toMatchObject({ ok: false })
  expect(await call('agentRead', [repo, '.factory/roles/reviewer.md'])).toMatchObject({ ok: false })
  expect(await call('agentWrite', [repo, '.factory/roles/reviewer.md', 'x', 0, true])).toMatchObject({ ok: false })
  expect(fs.readdirSync(outside)).toEqual(['secret.md'])
  expect(fs.readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe('secret')

  // what is allowed still works
  expect(await call('agentWrite', [repo, '.claude/notes/today.md', '# ok\n', null])).toMatchObject({ ok: true })
  expect(fs.readFileSync(path.join(repo, '.claude/notes/today.md'), 'utf8')).toBe('# ok\n')
  expect(await call('agentWrite', [repo, '.factory/roles/designer.md', '# designer\n', null])).toMatchObject({ ok: true })
  expect(fs.readFileSync(path.join(repo, '.factory/roles/designer.md'), 'utf8')).toBe('# designer\n')

  // .factory itself as a link out of the project: nothing in it is the app's to touch then
  fs.renameSync(path.join(repo, '.factory'), path.join(outside, 'factory'))
  fs.symlinkSync(path.join(outside, 'factory'), path.join(repo, '.factory'))
  expect(await call('agentWrite', [repo, '.factory/roles/x.md', 'x', null])).toMatchObject({ ok: false })
  expect(await call('agentRead', [repo, '.factory/rules.md'])).toMatchObject({ ok: false })
  expect(fs.existsSync(path.join(outside, 'factory/roles/x.md'))).toBe(false)
})

test('makes a skill for the repo, with the guide to writing one beside it', async ({ page, fixture }) => {
  // from Home: the Agents view ready on the skills folder, and the guide in the panel beside
  await view(page, 'Home')
  await page.getByRole('region', { name: 'Change how agents work here' }).getByRole('button', { name: /^Skills/ }).click()
  await expect(panes(page)).toHaveCount(2)
  const guide = panes(page).nth(1)
  // the panel's own title: the guide under it starts with "Writing a skill for this repo"
  await expect(guide.getByRole('heading', { name: 'Writing a skill', exact: true })).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'Rule, role or skill?' })).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'The description is the trigger' })).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'Make it specific to this repo' })).toBeVisible()

  const browser = panes(page).nth(0)
  const where = browser.getByLabel('Path of the new file')
  await expect(where).toHaveValue('.factory/skills/')
  await expect(browser.getByText('A skill is one markdown file, named after the task')).toBeVisible()
  await browser.getByRole('heading', { name: 'Agents' }).click()
  await where.fill('.factory/skills/add-migration.md')
  await browser.getByRole('button', { name: 'Create' }).click()

  // it starts from the shape the guide describes, open in the editor (which takes the guide's place)
  const file = path.join(fixture.repo, '.factory/skills/add-migration.md')
  // the app writes it after the click: wait for it rather than read at once
  await expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')).toMatch(/^---\nname: add-migration\ndescription: Use when /)
  for (const section of ['## Steps', '## Watch out', '## Done when']) expect(fs.readFileSync(file, 'utf8')).toContain(section)
  await expect(editor(page, '.factory/skills/add-migration.md').locator('.cm-content')).toContainText('name: add-migration')
  await expect(tree(page, '.factory/skills/add-migration.md')).toBeVisible()

  // any agent finds it: the factory's own CLI lists it, as the agents will see it
  const { execFileSync } = await import('node:child_process')
  expect(execFileSync(process.execPath, ['.factory/cli.mjs', 'skills'], { cwd: fixture.repo, encoding: 'utf8' })).toMatch(/^add-migration: Use when /m)

  // the guide is a click away from the Agents view at any time
  await browser.getByRole('button', { name: 'How to write a skill' }).click()
  await expect(panes(page).nth(1).getByRole('heading', { name: 'Writing a skill', exact: true })).toBeVisible()

  // a skill can be renamed and deleted like any agent file
  await tree(page, '.factory/skills/add-migration.md').click()
  await fileTool(page, 'Delete').click()
  await page.getByRole('button', { name: 'Move to the trash' }).click()
  expect(fs.existsSync(file)).toBe(false)
})
