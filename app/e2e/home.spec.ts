import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, view } from './launch'

const card = (page: Page, name: string) => page.getByRole('region', { name })
const panes = (page: Page) => page.locator('[data-pane]')
const version = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version

test('a project opens on Home, and what needs you is a click from the ticket', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  const needs = card(page, 'Needs you')
  await expect(needs).toContainText('#002')
  await expect(needs).toContainText('Do gift cards cover VAT, or only the subtotal?')
  await needs.getByRole('button', { name: /Support gift cards at checkout/ }).click()
  // the board, with that ticket open
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Support gift cards at checkout', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Needs you')
})

test('the numbers at a glance lead to their views', async ({ page }) => {
  const glance = card(page, 'At a glance')
  const stat = (label: string) => glance.getByRole('button', { name: new RegExp(`^${label}`) })
  await expect(stat('In progress')).toContainText('0')
  await expect(stat('Done')).toContainText('1')
  await expect(stat('Uncommitted')).toContainText('2')
  await expect(stat('Pull requests')).toContainText('1')
  await expect(stat('Issues')).toContainText('2')
  await expect(stat('Journal')).toContainText('3')

  await stat('Uncommitted').click()
  await expect(page.getByRole('heading', { name: 'Uncommitted changes' })).toBeVisible()
  await view(page, 'Home')
  await stat('Pull requests').click()
  await expect(page.getByRole('button', { name: /Discount codes/ })).toBeVisible()
  await view(page, 'Home')
  await stat('Done').click()
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible()
})

test('the latest changes, and why, open in the journal', async ({ page }) => {
  const recent = card(page, 'Recent changes and why')
  const entries = recent.getByRole('listitem')
  await expect(entries).toHaveCount(3)
  // newest first, with the first lines of why
  await expect(entries.nth(0)).toContainText('Show the VAT amount on the receipt')
  await expect(entries.nth(0)).toContainText('Feature')
  await expect(entries.nth(0)).toContainText('Customers asked what they paid in tax')
  await expect(entries.nth(1)).toContainText('Fix')
  await expect(entries.nth(2)).toContainText('Decision')

  await entries.nth(1).getByRole('button').click()
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Entry' }).getByRole('heading', { name: 'Round the VAT once, on the subtotal' })).toBeVisible()
})

test('changes how agents work: the rules, a role, the models', async ({ page, fixture }) => {
  const rules = card(page, 'Change how agents work here')
  await rules.getByRole('button', { name: /^Rules/ }).click()
  // the Agents view here, and the rules in the editor beside it
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(0).getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect(panes(page).nth(1).locator('[data-editing=".factory/rules.md"]')).toBeVisible()
  const firstLine = fs
    .readFileSync(path.join(fixture.repo, '.factory/rules.md'), 'utf8')
    .split('\n')
    .find((l) => l.trim())!
  await expect(panes(page).nth(1).locator('.cm-content')).toContainText(firstLine.trim())

  await panes(page).nth(0).getByRole('heading', { name: 'Agents' }).click()
  await view(page, 'Home')
  await rules.getByRole('button', { name: /^Roles/ }).click()
  // the same panel beside is used again
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1).locator('[data-editing=".factory/roles/planner.md"]')).toBeVisible()

  await panes(page).nth(0).getByRole('heading', { name: 'Agents' }).click()
  await view(page, 'Home')
  await rules.getByRole('button', { name: /^Models and effort/ }).click()
  await expect(panes(page).nth(0).getByRole('heading', { name: 'Models and effort' })).toBeVisible()
  // the sidebar counts it as part of Home
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
})

test('the setup checklist comes from the factory, and says what to do', async ({ page, fixture }) => {
  const setup = card(page, 'Setup')
  const items = setup.getByRole('list', { name: 'Checklist' }).getByRole('listitem')
  // what the factory's health check found, then what the app knows itself
  await expect(items.first()).toBeVisible()
  expect(await items.count()).toBeGreaterThan(3)
  // the version file's first line is the version
  await expect(setup).toContainText(`kit ${fs.readFileSync(path.join(fixture.repo, '.factory/version'), 'utf8').split('\n')[0].trim()}`)
  await expect(setup).toContainText('GitHub connected: acme/shop, signed in as octo-dev')
  await expect(setup).toContainText(`Factory app ${version}`)

  // take the checks away: the list says so, and what to do about it
  const config = path.join(fixture.repo, '.factory/config.json')
  fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(fs.readFileSync(config, 'utf8')), checks: [] }, null, 2))
  const before = await setup.locator('[data-ok="false"]').count()
  await setup.getByRole('button', { name: 'Check again' }).click()
  await expect(setup.locator('[data-ok="false"]')).toHaveCount(before + 1)
  await expect(setup.locator('[data-ok="false"]').filter({ hasText: /check/i }).first()).toBeVisible()
})

test.describe('a repo without a factory', () => {
  test.use({ factory: false })

  test('leads with how to install it, and still offers what works without it', async ({ page, electronApp }) => {
    const install = card(page, 'Install the factory')
    await expect(install.getByRole('heading', { name: 'Install the factory in this repo' })).toBeVisible()
    await expect(install).toContainText('npx -y github:RT-codes/portable-project-factory')
    await install.getByRole('button', { name: 'Copy the install command' }).click()
    await expect(install.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('npx -y github:RT-codes/portable-project-factory')

    // no board numbers, no journal, no rules: those are the factory's
    await expect(card(page, 'Needs you')).toHaveCount(0)
    await expect(card(page, 'Change how agents work here')).toHaveCount(0)
    await expect(card(page, 'At a glance').getByRole('button', { name: /^In progress/ })).toHaveCount(0)
    await expect(card(page, 'Setup').locator('[data-ok="false"]').first()).toContainText('not installed')

    await card(page, 'Works without it').getByRole('button', { name: 'Changes' }).click()
    await expect(page.getByRole('heading', { name: 'Uncommitted changes' })).toBeVisible()
  })
})

test('introduces the app at the top, and folds that away once read', async ({ page }) => {
  await view(page, 'Home')
  const about = page.getByRole('region', { name: 'About Factory' })
  await expect(about.getByRole('heading', { name: 'Your workflow, with a clearer view.' })).toBeVisible()
  await expect(about).toContainText('You keep your editor, your prompts and your git habits.')
  for (const point of ['Agents pick it up on their own', 'See the whole process', 'Steer it, and extend it']) await expect(about.getByRole('heading', { name: point })).toBeVisible()
  // it sits above the cards
  const [intro, needs] = [await about.boundingBox(), await page.getByRole('region', { name: 'Needs you' }).boundingBox()]
  expect(intro!.y + intro!.height).toBeLessThanOrEqual(needs!.y)

  await about.getByRole('button', { name: 'Hide' }).click()
  await expect(about.getByRole('heading', { name: 'See the whole process' })).toHaveCount(0)
  await page.reload()
  await expect(about).toContainText('What is Factory?')
  await about.getByRole('button').click()
  await expect(about.getByRole('heading', { name: 'See the whole process' })).toBeVisible()
})

test.describe('a repo without a factory', () => {
  test.use({ factory: false })

  test('installs the factory from the app with one click', async ({ page, fixture }) => {
    const { execFileSync } = await import('node:child_process')
    const at = (rel: string) => path.join(fixture.repo, rel)
    await view(page, 'Home')
    const card = page.getByRole('region', { name: 'Install the factory' })
    // it says beforehand what the click does, and that nothing on the system will ask for anything
    await expect(card).toContainText('no download, no admin rights, no system prompt')
    await expect(card).toContainText('all inside this repo and nothing outside it')
    // the command is still there to copy
    await expect(card).toContainText('npx -y github:RT-codes/portable-project-factory')
    expect(fs.existsSync(at('.factory'))).toBe(false)

    await card.getByRole('button', { name: 'Install it in this repo' }).click()
    // the page picks it up: the install card gives way to the factory's own
    await expect(page.getByRole('region', { name: 'Needs you' })).toBeVisible()
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Setup' })).toContainText('AGENTS.md has the Factory block')

    // what the installer puts in a repo, and nothing committed
    for (const file of ['.factory/cli.mjs', '.factory/config.json', '.factory/rules.md', '.factory/roles/planner.md', '.claude/skills/factory/SKILL.md']) expect(fs.existsSync(at(file)), file).toBe(true)
    expect(fs.readFileSync(at('AGENTS.md'), 'utf8')).toContain('<!-- factory:start -->')
    expect(execFileSync('git', ['log', '--oneline'], { cwd: fixture.repo, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1)
    // and it works: the CLI it installed answers
    expect(execFileSync(process.execPath, ['.factory/cli.mjs', 'status'], { cwd: fixture.repo, encoding: 'utf8' })).toContain('No run in progress')
    // the other views that said there was no factory show what they are for
    await view(page, 'Board')
    await expect(page.getByText('No factory in this repo yet')).toHaveCount(0)
  })

  test('says why when it cannot install', async ({ page, fixture }) => {
    // something is in the way: a .factory that is not the factory's
    fs.mkdirSync(path.join(fixture.repo, '.factory'))
    fs.writeFileSync(path.join(fixture.repo, '.factory/notes.txt'), 'mine')
    await view(page, 'Home')
    await page.getByRole('button', { name: 'Install it in this repo' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not install it')
    expect(fs.readFileSync(path.join(fixture.repo, '.factory/notes.txt'), 'utf8')).toBe('mine')
    expect(fs.existsSync(path.join(fixture.repo, '.factory/cli.mjs'))).toBe(false)
  })
})
