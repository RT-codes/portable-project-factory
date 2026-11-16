import type { Page } from '@playwright/test'
import { expect, test, view } from './launch'

const row = (page: Page, subject: string | RegExp) => page.getByLabel('Commits').getByRole('button', { name: subject })
const scope = (page: Page, name: string) => page.getByRole('group', { name: 'Whose history' }).getByRole('button', { name, exact: true }).click()
const commits = (page: Page) => page.locator('[data-commit]')

test('draws the history with what is checked out where', async ({ page }) => {
  await view(page, 'History')
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByText('On main')).toBeVisible()
  // the local branches: main's three commits and the ticket's two (its change, and the journal entry for it)
  await expect(commits(page)).toHaveCount(5)
  // the checkout the app has open is marked, with its branch
  await expect(row(page, /Journal: the VAT on the receipt/)).toContainText('HEAD')
  await expect(row(page, /Journal: the VAT on the receipt/)).toContainText('main')
  // the remote's main is a commit behind
  await expect(row(page, /Storefront: cart, pricing, checkout/)).toContainText('origin/main')
  // the factory's worktree for the ticket has its branch checked out
  await expect(row(page, /Journal: Show the VAT amount/)).toContainText('factory/001-show-the-vat-amount')
  await expect(row(page, /Journal: Show the VAT amount/)).toContainText('001-show-the-vat-amount')
  // children are drawn above their parents
  const y = async (s: RegExp) => (await row(page, s).boundingBox())!.y
  expect(await y(/Journal: the VAT on the receipt/)).toBeLessThan(await y(/Install the factory/))
  expect(await y(/Journal: Show the VAT amount/)).toBeLessThan(await y(/Show the VAT on the receipt/))
  expect(await y(/Install the factory/)).toBeLessThan(await y(/Storefront/))
  expect(await y(/Show the VAT on the receipt/)).toBeLessThan(await y(/Install the factory/))

  // the worktrees, beside the graph
  const trees = page.getByRole('complementary', { name: 'Worktrees' })
  await expect(trees.getByRole('button', { name: /shop/ })).toContainText('open here')
  await expect(trees.getByRole('button', { name: /shop/ })).toContainText('2 uncommitted files')
  await expect(trees.getByRole('button', { name: /001-show-the-vat-amount/ })).toContainText('Clean')
  // a worktree leads to the commit it has checked out
  await trees.getByRole('button', { name: /001-show-the-vat-amount/ }).click()
  await expect(row(page, /Journal: Show the VAT amount/)).toHaveAttribute('aria-pressed', 'true')
})

test('switches between this checkout, the local branches and the remote', async ({ page }) => {
  await view(page, 'History')
  await expect(commits(page)).toHaveCount(5)
  await scope(page, 'Checked out')
  await expect(commits(page)).toHaveCount(3)
  await expect(row(page, /Show the VAT on the receipt/)).toHaveCount(0)
  await scope(page, 'Remote')
  await expect(commits(page)).toHaveCount(1)
  await expect(row(page, /Storefront/)).toContainText('origin/main')
  // the checkout's uncommitted work is not the remote's
  await expect(page.getByText('Uncommitted changes')).toHaveCount(0)
  await scope(page, 'All')
  await expect(commits(page)).toHaveCount(5)
  await expect(page.getByText('Uncommitted changes')).toBeVisible()
})

test('shows a commit and opens its diff beside the history', async ({ page }) => {
  await view(page, 'History')
  await row(page, /Show the VAT on the receipt/).click()
  const detail = page.getByRole('complementary', { name: 'Commit' })
  await expect(detail.getByRole('heading', { name: 'Show the VAT on the receipt' })).toBeVisible()
  await expect(detail).toContainText('Mona Lisa')
  await expect(detail).toContainText('1 file')
  await expect(detail).toContainText('src/checkout.ts')

  await detail.getByRole('button', { name: 'Open the diff' }).click()
  const panes = page.locator('[data-pane]')
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1).getByRole('heading', { name: 'Show the VAT on the receipt' })).toBeVisible()
  await expect(panes.nth(1).locator('[data-file="src/checkout.ts"]')).toContainText('of which')
  // the history is still there, next to it
  await expect(panes.nth(0).getByRole('heading', { name: 'History' })).toBeVisible()

  // the first commit has no parent: all of it is new
  await row(page, /Storefront/).click()
  await expect(detail).toContainText('src/cart.ts')
  // its parent link is absent, and its diff opens in the same second panel, not a third
  await expect(detail.getByText('Parent')).toHaveCount(0)
  await detail.getByRole('button', { name: 'Open the diff' }).click()
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1).getByRole('heading', { name: 'Storefront: cart, pricing, checkout' })).toBeVisible()
  await expect(panes.nth(1).locator('[data-file="src/cart.ts"] [data-anchor="RIGHT:1"]')).toContainText("import { find } from './catalog'")
})

test('opens the uncommitted work from the top of the graph', async ({ page }) => {
  await view(page, 'History')
  await page.getByRole('button', { name: /Uncommitted changes/ }).click()
  await expect(page.locator('[data-pane]').nth(1).getByRole('heading', { name: 'Uncommitted changes' })).toBeVisible()
})

test.describe('without a remote branch', () => {
  test('the remote history is empty, and says why', async ({ page, fixture }) => {
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: fixture.repo })
    await view(page, 'History')
    await scope(page, 'Remote')
    await expect(page.getByText('No remote branches here.')).toBeVisible()
  })
})
