import type { Page } from '@playwright/test'
import { expect, test, view } from './launch'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Views' })
const panes = (page: Page) => page.locator('[data-pane]')
const column = (page: Page, name: string) => page.locator(`[data-column="${name}"]`)
const strip = (page: Page) => page.locator('[data-strip]')
const main = (page: Page) => page.locator('[data-main]')

test('Activity is one view: a strip of what is going on, over the board', async ({ page }) => {
  // above the board in the sidebar, counting what is open
  const names = await nav(page).getByRole('listitem').allInnerTexts()
  expect(names.map((n) => n.split('\n')[0]).slice(1, 3)).toEqual(['Activity', 'Board'])
  await view(page, 'Activity')
  await expect(nav(page).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  await expect(nav(page).getByRole('button', { name: 'Activity' })).toContainText('3')

  // one panel: the strip on top with a quarter of the height, the board under it with the rest
  await expect(panes(page)).toHaveCount(1)
  await expect(main(page).getByText('Support gift cards at checkout')).toBeVisible()
  const [t, b] = [(await strip(page).boundingBox())!, (await main(page).boundingBox())!]
  expect(b.y).toBeGreaterThan(t.y + t.height - 1)
  expect(b.height / (t.height + b.height)).toBeGreaterThan(0.7)
  expect(b.height / (t.height + b.height)).toBeLessThan(0.8)

  // in the strip: the pull requests, the issues and the history, left to right
  await expect(column(page, 'pulls').getByRole('heading', { name: 'Pull requests' })).toBeVisible()
  await expect(column(page, 'pulls').getByRole('button', { name: /Discount codes/ })).toBeVisible()
  await expect(column(page, 'issues').getByRole('button', { name: /Totals are off by a cent/ })).toBeVisible()
  await expect(column(page, 'history').getByRole('heading', { name: 'History' })).toBeVisible()
  const [a, c] = [(await column(page, 'pulls').boundingBox())!, (await column(page, 'history').boundingBox())!]
  expect((await column(page, 'issues').boundingBox())!.x).toBeGreaterThan(a.x + a.width - 1)
  expect(c.x).toBeGreaterThan(a.x + a.width * 2 - 2)

  // the handle between the two moves from the keyboard, and where it was left is kept
  const handle = page.getByRole('separator', { name: 'Resize the strip and the board' })
  await handle.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
  await expect.poll(async () => (await strip(page).boundingBox())!.height).toBeGreaterThan(t.height + 40)
  const taller = (await strip(page).boundingBox())!.height

  // another view takes the whole of it, not a part
  await view(page, 'Code')
  await expect(page.locator('[data-activity]')).toHaveCount(0)
  await expect(panes(page)).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Code', exact: true })).toBeVisible()
  await view(page, 'Activity')
  await expect(strip(page)).toBeVisible()
  expect(Math.abs((await strip(page).boundingBox())!.height - taller)).toBeLessThan(2)
})

test('what is picked in the strip takes the place of the board, and back brings the board back', async ({ page }) => {
  await view(page, 'Activity')
  await column(page, 'pulls').getByRole('button', { name: /Discount codes/ }).click()
  // the strip stays, the pull request is under it, and it is still Activity
  await expect(strip(page)).toBeVisible()
  await expect(main(page).getByRole('navigation', { name: 'Pull request' })).toBeVisible()
  await expect(nav(page).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  await expect(panes(page)).toHaveCount(1)
  // it is where it was after the app was closed
  await page.reload()
  await expect(main(page).getByRole('navigation', { name: 'Pull request' })).toBeVisible()
  await main(page).getByRole('button', { name: 'Back to the board' }).click()
  await expect(main(page).getByText('Support gift cards at checkout')).toBeVisible()

  // an issue the same way, with the room to itself (the list is in the strip); then another one
  await column(page, 'issues').getByRole('button', { name: /Totals are off by a cent/ }).click()
  await expect(main(page).getByRole('heading', { level: 2, name: /Totals are off by a cent/ })).toBeVisible()
  await expect(main(page).getByRole('button', { name: /Let customers remove one item/ })).toHaveCount(0)
  await column(page, 'issues').getByRole('button', { name: /Let customers remove one item/ }).click()
  await expect(main(page).getByRole('heading', { level: 2, name: /Let customers remove one item/ })).toBeVisible()
  await main(page).getByRole('button', { name: 'Back to the board' }).click()
  await expect(main(page).getByText('Support gift cards at checkout')).toBeVisible()
  await expect(strip(page)).toBeVisible()

  // from its own view, back leads to its own list
  await view(page, 'Pull requests')
  await page.getByRole('button', { name: /Discount codes/ }).click()
  await page.getByRole('button', { name: 'Back to pull requests' }).click()
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible()
  await expect(page.locator('[data-activity]')).toHaveCount(0)
})

test('a new issue is written in its column', async ({ page }) => {
  await view(page, 'Activity')
  await column(page, 'issues').getByRole('button', { name: 'New issue' }).click()
  await expect(column(page, 'issues').getByRole('heading', { name: 'New issue' })).toBeVisible()
  await expect(column(page, 'pulls').getByRole('heading', { name: 'Pull requests' })).toBeVisible()
  await expect(main(page).getByText('Support gift cards at checkout')).toBeVisible()
})

test.describe('a machine without the GitHub CLI', () => {
  test.use({ gh: 'missing' })
  test('says once that GitHub is missing, and still shows the history and the board', async ({ page }) => {
    await view(page, 'Activity')
    await expect(page.getByText('GitHub is not connected')).toHaveCount(1)
    await expect(column(page, 'history').getByRole('heading', { name: 'History' })).toBeVisible()
    await expect(main(page).getByText('Support gift cards at checkout')).toBeVisible()
  })
})
