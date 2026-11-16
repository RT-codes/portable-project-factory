import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, view } from './launch'

const entries = (page: Page) => page.getByLabel('Entries').locator('[data-entry]')
const entry = (page: Page, title: string | RegExp) => page.getByLabel('Entries').getByRole('button', { name: title })
const detail = (page: Page) => page.getByRole('complementary', { name: 'Entry' })
const facts = (page: Page) => detail(page).getByLabel('Facts')
const panes = (page: Page) => page.locator('[data-pane]')

test('lists why things changed, newest first, by month', async ({ page }) => {
  await view(page, 'Journal')
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible()
  await expect(page.getByText('Why things changed · 3 entries')).toBeVisible()
  await expect(entries(page)).toHaveCount(3)
  await expect(entries(page).nth(0)).toContainText('Show the VAT amount on the receipt')
  await expect(entries(page).nth(0)).toContainText('Feature')
  await expect(entries(page).nth(0)).toContainText('#001')
  await expect(entries(page).nth(0)).toContainText('checkout.ts')
  await expect(entries(page).nth(1)).toContainText('Round the VAT once, on the subtotal')
  await expect(entries(page).nth(2)).toContainText('Keep every amount in integer cents')
  // the decision was last month: a month of its own
  const months = page.getByLabel('Entries').getByRole('heading', { level: 2 })
  await expect(months).toHaveCount(2)
})

test('searches titles, tags, files and prose, and filters by kind', async ({ page }) => {
  await view(page, 'Journal')
  const search = page.getByLabel('Search the journal')
  const kind = (name: string) => page.getByRole('group', { name: 'Kind' }).getByRole('button', { name, exact: true })

  // the prose
  await search.fill('floating point')
  await expect(entries(page)).toHaveCount(1)
  await expect(entries(page).first()).toContainText('Keep every amount in integer cents')
  // a file
  await search.fill('pricing.ts')
  await expect(entries(page)).toHaveCount(2)
  // a tag, and words in any order
  await search.fill('money')
  await expect(entries(page)).toHaveCount(1)
  await search.fill('cent rounding')
  await expect(entries(page)).toHaveCount(1)
  await expect(entries(page).first()).toContainText('Round the VAT once')
  await search.fill('nothing like this')
  await expect(entries(page)).toHaveCount(0)
  await expect(page.getByText('No entry matches "nothing like this"')).toBeVisible()
  await page.getByRole('button', { name: 'Clear the search' }).click()
  await expect(entries(page)).toHaveCount(3)

  await kind('Fix').click()
  await expect(entries(page)).toHaveCount(1)
  await expect(entries(page).first()).toContainText('Fix')
  // kinds with no entries cannot be picked
  await expect(kind('Refactor')).toBeDisabled()
  await kind('All').click()
  await expect(entries(page)).toHaveCount(3)
})

test('shows an entry: its sections, then the facts', async ({ page, fixture }) => {
  await view(page, 'Journal')
  await entry(page, /Show the VAT amount on the receipt/).click()
  await expect(detail(page).getByRole('heading', { name: 'Show the VAT amount on the receipt' })).toBeVisible()
  for (const heading of ['What changed', 'Why', 'Decisions']) await expect(detail(page).getByRole('heading', { name: heading })).toBeVisible()
  await expect(detail(page)).toContainText('Customers asked what they paid in tax')
  // markdown, rendered
  await expect(detail(page).locator('.md code').filter({ hasText: 'vat()' })).toBeVisible()
  await expect(facts(page)).toContainText('001-show-the-vat-amount')
  await expect(facts(page)).toContainText('receipt')
  // who did it
  await expect(facts(page)).toContainText('claude')

  // the commit is here: its diff opens beside the journal
  await facts(page).getByRole('button', { name: new RegExp(fixture.vatSha!.slice(0, 7)) }).click()
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1).getByRole('heading', { name: 'Show the VAT on the receipt' })).toBeVisible()
  await expect(panes(page).nth(1).locator('[data-file="src/checkout.ts"]')).toContainText('of which')

  // a file opens in Code, in the same panel beside
  await panes(page).nth(0).getByRole('heading', { name: 'Journal', exact: true }).click()
  await facts(page).getByRole('button', { name: 'src/checkout.ts' }).click()
  await expect(panes(page)).toHaveCount(2)
  await expect(panes(page).nth(1).getByRole('heading', { name: /checkout\.ts/ })).toBeVisible()

  // the ticket opens on the board
  await panes(page).nth(0).getByRole('heading', { name: 'Journal', exact: true }).click()
  await facts(page).getByRole('button', { name: '001-show-the-vat-amount' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Show the VAT amount on the receipt', level: 2 })).toBeVisible()
})

test('says so when a commit is not in this repo', async ({ page }) => {
  await view(page, 'Journal')
  await entry(page, /Keep every amount in integer cents/).click()
  const commits = facts(page).getByRole('list', { name: 'Commits' })
  await expect(commits).toContainText('deadbee')
  await expect(commits).toContainText('not in this repo')
  await expect(commits.getByRole('button')).toHaveCount(0)
  // an entry without a ticket says nothing about one
  await expect(facts(page)).not.toContainText('Ticket')
})

test('opens on the entry the route names, and comes back to it', async ({ page }) => {
  // Home sends people to an entry this way
  await page.getByRole('region', { name: 'Recent changes and why' }).getByRole('button', { name: /Keep every amount in integer cents/ }).click()
  await expect(detail(page).getByRole('heading', { name: 'Keep every amount in integer cents' })).toBeVisible()
  await expect(entry(page, /Keep every amount in integer cents/)).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(detail(page).getByRole('heading', { name: 'Keep every amount in integer cents' })).toBeVisible()
  // closing it forgets it
  await detail(page).getByRole('button', { name: 'Close the entry' }).click()
  await expect(detail(page)).toHaveCount(0)
})

test('skips an entry it cannot read, and keeps the rest', async ({ page, fixture }) => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.join(fixture.repo, '.factory/journal/2026')
  fs.writeFileSync(path.join(dir, 'broken.md'), 'no frontmatter at all\n')
  fs.writeFileSync(path.join(dir, 'no-title.md'), '---\nat: 2026-11-01T10:00:00Z\nkind: fix\n---\n## Why\n\nNo title.\n')
  fs.writeFileSync(path.join(dir, 'odd.md'), '---\nid: odd\nat: 2026-11-02T10:00:00Z\ntitle: An entry with odd fields\nkind: experiment\ntags: not a list\ncommits: [1, "abc1234"\n---\nJust prose, no sections.\n')
  await view(page, 'Journal')
  await expect(entries(page)).toHaveCount(4)
  await entry(page, /An entry with odd fields/).click()
  await expect(detail(page)).toContainText('Just prose, no sections.')
  await expect(detail(page)).toContainText('Experiment')
})

test('says what the journal is while it is empty, and how to add to it', async ({ page, fixture }) => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  fs.rmSync(path.join(fixture.repo, '.factory/journal'), { recursive: true })
  await view(page, 'Journal')
  await expect(page.getByRole('heading', { name: 'No journal entries yet' })).toBeVisible()
  await expect(page.getByText('node .factory/cli.mjs journal add')).toBeVisible()
  // Home says the same, briefly
  await view(page, 'Home')
  await expect(page.getByRole('region', { name: 'Recent changes and why' })).toContainText('No entries yet')
})

test.describe('a repo without a factory', () => {
  test.use({ factory: false })

  test('says what the journal is, and how to get one', async ({ page }) => {
    await view(page, 'Journal')
    await expect(page.getByRole('heading', { name: 'No journal entries yet' })).toBeVisible()
    await expect(page.getByText('npx -y github:RT-codes/portable-project-factory')).toBeVisible()
  })
})

test('says at the top what the journal is for, with what agents are handed', async ({ page, fixture }) => {
  // this repo hands agents more than the default
  const file = path.join(fixture.repo, '.factory/config.json')
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), journal: { recent: 8, titles: 30 } }, null, 2))
  await view(page, 'Journal')
  const about = page.getByRole('region', { name: 'About the journal' })
  await expect(about).toContainText("The repo's memory for agents.")
  await expect(about).toContainText('Git records what changed. The journal records why')
  await expect(about).toContainText('the last 8 changes in full, the 30 before as one line each')
  await expect(about).toContainText('Searchable on demand')
  await expect(about).toContainText('never your prompts')

  // read once, it folds to a line, stays folded, and opens again when asked
  await about.getByRole('button', { name: 'Hide' }).click()
  await expect(about).not.toContainText('Searchable on demand')
  await page.reload()
  await view(page, 'Journal')
  await expect(about).toContainText('What is this?')
  await expect(about).not.toContainText('Searchable on demand')
  await about.getByRole('button').click()
  await expect(about).toContainText('Searchable on demand')
})
