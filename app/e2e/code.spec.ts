import { expect, test, view } from './launch'

test('browses the project and reads a file', async ({ page }) => {
  await view(page, 'Code')
  // the tree starts closed: folders open on a click
  await expect(page.locator('[data-path="src/cart.ts"]')).toHaveCount(0)
  await page.getByRole('tree').getByRole('button', { name: 'src', exact: true }).click()
  await page.locator('[data-path="src/cart.ts"]').click()
  await expect(page.getByRole('heading', { name: /cart\.ts/ })).toBeVisible()
  await expect(page.getByText('export class Cart {')).toBeVisible()
  await expect(page.locator('.code span[style*="color"]').first()).toBeVisible()
  // uncommitted files are marked in the tree
  await expect(page.locator('[data-path="src/money.ts"]')).toContainText('M')
  await expect(page.locator('[data-path="src/locale.ts"]')).toContainText('U')
})

test('finds a file by name and keeps it in view when the search is cleared', async ({ page }) => {
  await view(page, 'Code')
  await page.getByPlaceholder('Find a file').fill('cartview')
  await page.locator('[data-path="src/ui/CartView.svelte"]').click()
  await expect(page.getByText('let { cart }: { cart: Cart } = $props()')).toBeVisible()
  await page.getByPlaceholder('Find a file').fill('')
  await expect(page.locator('[data-path="src/ui/CartView.svelte"]')).toBeVisible()
  await expect(page.locator('[data-path="src/ui/CartView.svelte"]')).toHaveAttribute('class', /bg-accent/)
})

test('reads markdown rendered, or as source', async ({ page }) => {
  await view(page, 'Code')
  await page.locator('[data-path="README.md"]').click()
  await expect(page.getByRole('heading', { name: 'Shop', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Source' }).click()
  await expect(page.getByText('# Shop')).toBeVisible()
})

test("opens a file of a pull request as the pull request has it", async ({ page, fixture }) => {
  await view(page, 'Pull requests')
  await page.getByRole('button', { name: /Discount codes/ }).click()
  await page.getByRole('navigation', { name: 'Pull request' }).getByRole('button', { name: /^Changes/ }).click()
  await page.locator('[data-file="src/discounts.ts"]').getByRole('button', { name: 'Open the whole file' }).click()
  // discounts.ts does not exist in the checkout: it is read from the pull request's commit
  await expect(page.getByText(`at ${fixture.headSha.slice(0, 7)}`)).toBeVisible()
  await expect(page.getByText('export function lookup(code: string)')).toBeVisible()
  await page.getByRole('button', { name: 'Back to the checkout' }).click()
  await expect(page.getByText('This file does not exist in the checkout.')).toBeVisible()
})
