import type { Locator, Page } from '@playwright/test'
import { expect, test, view } from './launch'

const tool = (page: Page, name: string | RegExp) => page.getByRole('toolbar', { name: 'Panels' }).getByRole('button', { name })
const panes = (page: Page) => page.locator('[data-pane]')
const active = (page: Page) => page.locator('[data-pane][data-active="true"]')
/** Where a panel is once it has stopped moving (panels glide to their place). */
async function box(pane: Locator) {
  await pane.evaluate(async (el) => {
    // let a change that was just made reach the page, then wait for the glide it started
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})))
  })
  return (await pane.boundingBox())!
}
const variable = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)

test('splits the main area and opens a view in the new panel', async ({ page }) => {
  await expect(panes(page)).toHaveCount(1)
  // one panel cannot be closed, turned or swapped
  await expect(tool(page, 'Close this panel')).toBeDisabled()
  await expect(tool(page, /Turn the split/)).toBeDisabled()

  await tool(page, 'Split right').click()
  await expect(panes(page)).toHaveCount(2)
  // the new panel is to the right, is the active one, and offers the views
  const [left, right] = [panes(page).nth(0), panes(page).nth(1)]
  const [a, b] = [await box(left), await box(right)]
  expect(b.x).toBeGreaterThan(a.x + a.width - 1)
  expect(Math.abs(a.y - b.y)).toBeLessThan(1)
  await expect(right).toHaveAttribute('data-active', 'true')
  await expect(right.getByText('Open in this panel')).toBeVisible()

  await right.getByRole('button', { name: /Pull requests/ }).click()
  await expect(right.getByRole('button', { name: /Discount codes/ })).toBeVisible()
  // the first panel still shows what it showed
  await expect(left.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

  // split the right one down: three panels, the new one under it
  await tool(page, 'Split down').click()
  await expect(panes(page)).toHaveCount(3)
  const [p, n] = [await box(panes(page).nth(1)), await box(panes(page).nth(2))]
  expect(n.y).toBeGreaterThan(p.y + p.height - 1)
  expect(Math.abs(n.x - p.x)).toBeLessThan(1)
})

test('the sidebar and the keyboard act on the active panel', async ({ page }) => {
  await tool(page, 'Split right').click()
  await view(page, 'Issues')
  const [left, right] = [panes(page).nth(0), panes(page).nth(1)]
  await expect(right.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await expect(left.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

  // a click in a panel makes it the active one; the sidebar marks what it shows
  await left.getByRole('heading', { name: 'Home', exact: true }).click()
  await expect(left).toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await view(page, 'Code')
  await expect(left.getByRole('heading', { name: 'Code', exact: true })).toBeVisible()
  await expect(right.getByRole('heading', { name: 'Issues' })).toBeVisible()

  // focus moves between panels from the keyboard
  await page.keyboard.press('Alt+ArrowRight')
  await expect(right).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(left).toHaveAttribute('data-active', 'true')
  // and panels split and close from it
  await page.keyboard.press('Control+Backslash')
  await expect(panes(page)).toHaveCount(3)
  await page.keyboard.press('Control+Alt+KeyW')
  await expect(panes(page)).toHaveCount(2)
})

test('closes a panel, and the neighbour takes its room', async ({ page }) => {
  await tool(page, 'Split right').click()
  const full = await box(page.locator('[data-panes]'))
  // an empty panel closes itself too
  await panes(page).nth(1).getByText('Close this panel').click()
  await expect(panes(page)).toHaveCount(1)
  const only = await box(panes(page).first())
  // a single panel fills the area, edge to edge
  expect(only.width).toBeGreaterThan(full.width - 1)
  await expect(panes(page).first().getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

  await tool(page, 'Split down').click()
  await panes(page).nth(0).getByRole('heading', { name: 'Home', exact: true }).click()
  await tool(page, 'Close this panel').click()
  await expect(panes(page)).toHaveCount(1)
  await expect(page.getByText('Open in this panel')).toBeVisible()
})

test('turns a split from side by side to stacked, and swaps its halves', async ({ page }) => {
  await tool(page, 'Split right').click()
  const [first, second] = [panes(page).nth(0), panes(page).nth(1)]
  await tool(page, /Turn the split/).click()
  let [a, b] = [await box(first), await box(second)]
  expect(b.y).toBeGreaterThan(a.y + a.height - 1)
  expect(Math.abs(a.x - b.x)).toBeLessThan(1)

  await tool(page, 'Swap with its neighbour').click()
  ;[a, b] = [await box(first), await box(second)]
  expect(a.y).toBeGreaterThan(b.y + b.height - 1)

  await tool(page, /Turn the split/).click()
  ;[a, b] = [await box(first), await box(second)]
  expect(a.x).toBeGreaterThan(b.x + b.width - 1)
})

test('resizes a split by dragging its handle', async ({ page }) => {
  await tool(page, 'Split right').click()
  const handle = page.getByRole('separator', { name: 'Resize panels' })
  const left = panes(page).nth(0)
  const before = await box(left)
  const h = await box(handle)
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 - 200, h.y + h.height / 2, { steps: 5 })
  await page.mouse.up()
  const after = await box(left)
  expect(Math.round(before.width - after.width)).toBe(200)
  // the other panel took the room
  const right = await box(panes(page).nth(1))
  expect(right.x).toBeLessThan(before.x + before.width - 150)

  // from the keyboard too, and a double click evens it out
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  expect((await box(left)).width).toBeGreaterThan(after.width + 5)
  await handle.dblclick()
  expect(Math.abs((await box(left)).width - before.width)).toBeLessThan(1)
})

test('moves a panel by dragging it with Alt held, as it is dragged', async ({ page }) => {
  await tool(page, 'Split right').click()
  await view(page, 'Issues')
  const [home, issues] = [panes(page).nth(0), panes(page).nth(1)]
  // something typed in the panel, to see that it is the same panel afterwards and not a new one
  await issues.getByPlaceholder('Search issues').fill('remove')
  await expect(issues.getByRole('button', { name: /Let customers remove one item/ })).toBeVisible()

  const from = await box(issues)
  const over = await box(home)
  await page.keyboard.down('Alt')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // towards the left edge of the home panel: the issues panel goes to its left, before the button is let go
  await page.mouse.move(over.x + 60, over.y + over.height / 2, { steps: 8 })
  expect((await box(issues)).x).toBeLessThan((await box(home)).x)
  // on to its bottom edge: now it sits under it
  const now = await box(home)
  await page.mouse.move(now.x + now.width / 2, now.y + now.height - 40, { steps: 8 })
  const [b, i] = [await box(home), await box(issues)]
  expect(i.y).toBeGreaterThan(b.y + b.height - 1)
  expect(Math.abs(i.x - b.x)).toBeLessThan(1)
  await page.mouse.up()
  await page.keyboard.up('Alt')

  await expect(issues).toHaveAttribute('data-active', 'true')
  await expect(issues.getByPlaceholder('Search issues')).toHaveValue('remove')
  // without Alt a drag is just a drag: nothing moves
  const still = await box(issues)
  await page.mouse.move(still.x + 200, still.y + 20)
  await page.mouse.down()
  await page.mouse.move(still.x + 200, still.y - 300, { steps: 5 })
  await page.mouse.up()
  expect((await box(issues)).y).toBe(still.y)
})

test('spaces the panels as the theme says', async ({ page }) => {
  await tool(page, 'Split right').click()
  const area = page.locator('[data-panes]').locator('..')
  const gaps = async () => {
    const [a, b, outer] = [await box(panes(page).nth(0)), await box(panes(page).nth(1)), await box(area)]
    return { between: Math.round(b.x - (a.x + a.width)), around: Math.round(a.x - outer.x), top: Math.round(a.y - outer.y) }
  }
  expect(await gaps()).toEqual({ between: 8, around: 8, top: 8 })

  await page.getByRole('button', { name: 'Appearance settings' }).click()
  await page.getByLabel('Between panels').fill('24')
  await page.getByLabel('Around the panels').fill('2')
  expect(await variable(page, '--pane-gap')).toBe('24px')
  expect(await gaps()).toEqual({ between: 24, around: 2, top: 2 })
  await page.getByLabel('Between panels').fill('0')
  await page.getByLabel('Around the panels').fill('0')
  expect(await gaps()).toEqual({ between: 0, around: 0, top: 0 })
})

test('remembers the layout of a project', async ({ page }) => {
  await tool(page, 'Split right').click()
  await panes(page).nth(1).getByRole('button', { name: /Pull requests/ }).click()
  await panes(page).nth(1).getByRole('button', { name: /Discount codes/ }).click()
  await expect(panes(page).nth(1).getByText('wants to merge')).toBeVisible()
  await tool(page, 'Split down').click()
  await panes(page).nth(2).getByRole('button', { name: /Code/ }).click()

  await page.reload()
  await expect(panes(page)).toHaveCount(3)
  await expect(panes(page).nth(0).getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(panes(page).nth(1).getByText('wants to merge')).toBeVisible()
  await expect(panes(page).nth(2).getByRole('heading', { name: 'Code', exact: true })).toBeVisible()
  await expect(active(page)).toContainText('Code')
})

test('views fit a narrow panel', async ({ page }) => {
  await tool(page, 'Split right').click()
  await tool(page, 'Split right').click()
  await view(page, 'Issues')
  const pane = active(page)
  // not enough room for the list and an issue side by side: one at a time, with a way back
  await pane.getByRole('button', { name: /Totals are off by a cent/ }).click()
  await expect(pane.getByRole('heading', { name: /Totals are off by a cent for some carts/ })).toBeVisible()
  await expect(pane.getByPlaceholder('Search issues')).toBeHidden()
  await pane.getByRole('button', { name: 'Back to the issues' }).click()
  await expect(pane.getByPlaceholder('Search issues')).toBeVisible()
})

test('stops splitting at eight panels', async ({ page }) => {
  for (let i = 0; i < 7; i++) await tool(page, i % 2 ? 'Split down' : 'Split right').click()
  await expect(panes(page)).toHaveCount(8)
  await expect(tool(page, 'Split right')).toBeDisabled()
  await expect(tool(page, 'Split down')).toBeDisabled()
})

test('the bar to split and close sits on the active panel', async ({ page }) => {
  const bar = page.getByRole('toolbar', { name: 'Panels' })
  await expect(bar).toHaveCount(1)
  await tool(page, 'Split down').click()
  const [top, bottom] = [panes(page).nth(0), panes(page).nth(1)]
  // one bar, inside the new (active) panel at the bottom
  await expect(bar).toHaveCount(1)
  await expect(bottom.getByRole('toolbar', { name: 'Panels' })).toBeVisible()
  await expect(top.getByRole('toolbar', { name: 'Panels' })).toHaveCount(0)
  // the other panel keeps a strip of the same height, naming what it shows: nothing jumps when focus moves
  await expect(top.getByText('Home', { exact: true }).first()).toBeVisible()
  const heading = top.getByRole('heading', { name: 'Home', exact: true })
  // the panel first: that waits for its glide, and the bar moves with it
  const p = await box(bottom)
  const b = await box(bar)
  const before = (await box(heading)).y
  expect(b.y).toBeGreaterThan(p.y - 1)
  expect(b.y).toBeLessThan(p.y + 8)

  // it follows the focus
  await heading.click()
  await expect(top.getByRole('toolbar', { name: 'Panels' })).toBeVisible()
  expect(Math.abs((await box(heading)).y - before)).toBeLessThan(1)
  await expect(bottom.getByRole('toolbar', { name: 'Panels' })).toHaveCount(0)
})
