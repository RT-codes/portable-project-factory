import fs from 'node:fs'
import path from 'node:path'
import { expect, test, view } from './launch'

test('shows the uncommitted work in the checkout', async ({ page }) => {
  await view(page, 'Changes')
  await expect(page.getByRole('heading', { name: 'Uncommitted changes' })).toBeVisible()
  await expect(page.locator('[data-file]')).toHaveCount(2)
  // a tracked file that was edited, and a file git does not know yet
  await expect(page.locator('[data-file="src/money.ts"] [data-anchor="LEFT:4"]')).toContainText("currency = 'EUR'): string")
  await expect(page.locator('[data-file="src/money.ts"] [data-anchor="RIGHT:4"]')).toContainText("locale = 'en'")
  await expect(page.locator('[data-file="src/locale.ts"] [data-anchor="RIGHT:1"]')).toContainText('export const locales')
  // nothing to comment on: this is not a pull request
  await page.locator('[data-file="src/money.ts"] [data-anchor="RIGHT:4"]').hover()
  await expect(page.getByRole('button', { name: 'Comment on this line' })).toHaveCount(0)
  // the sidebar counts them
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Changes/ })).toContainText('2')
})

test('picks up new work on refresh', async ({ page, fixture }) => {
  await view(page, 'Changes')
  await expect(page.locator('[data-file]')).toHaveCount(2)
  fs.writeFileSync(path.join(fixture.repo, 'NOTES.md'), 'todo\n')
  fs.rmSync(path.join(fixture.repo, 'src/legacy/coupons.ts'))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('[data-file]')).toHaveCount(4)
  await expect(page.locator('[data-file="src/legacy/coupons.ts"]')).toContainText('D')
  await expect(page.locator('[data-file="NOTES.md"] [data-anchor="RIGHT:1"]')).toContainText('todo')
})

test("reviews a ticket's branch from the board", async ({ page }) => {
  await view(page, 'Board')
  await page.getByRole('button', { name: /Show the VAT amount on the receipt/ }).click()
  await page.getByRole('button', { name: 'Review changes' }).click()
  await expect(page.getByRole('heading', { name: 'Show the VAT amount on the receipt' })).toBeVisible()
  // the change, and the journal entry the factory wrote when the ticket was done
  await expect(page.getByText('factory/001-show-the-vat-amount against main · 2 commits')).toBeVisible()
  await expect(page.locator('[data-file]')).toHaveCount(2)
  await expect(page.locator('[data-file^=".factory/journal/"]')).toHaveCount(1)
  await expect(page.locator('[data-file="src/checkout.ts"]')).toContainText('of which ${format(vat(cart.lines))} VAT')

  // any branch can be compared with the base branch
  await page.getByLabel('Compare').selectOption('uncommitted changes')
  await expect(page.getByRole('heading', { name: 'Uncommitted changes' })).toBeVisible()
})

test.describe('a clean checkout', () => {
  test('says so', async ({ page, fixture }) => {
    fs.rmSync(path.join(fixture.repo, 'src/locale.ts'))
    fs.writeFileSync(path.join(fixture.repo, 'src/money.ts'), fs.readFileSync(path.join(fixture.repo, 'src/money.ts'), 'utf8').replace(", locale = 'en'", '').replace('NumberFormat(locale', "NumberFormat('en'"))
    await view(page, 'Changes')
    await expect(page.getByRole('heading', { name: 'Nothing uncommitted' })).toBeVisible()
  })
})

test('shows the import graph beside the diff, and remembers another choice', async ({ page }) => {
  await view(page, 'Changes')
  const diff = page.locator('[data-scroller]')
  const graph = page.locator('[data-graph]')
  const panes = page.locator('[data-pane]')
  await expect(page.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'true')
  await expect(graph.locator('[data-node="src/money.ts"]')).toBeVisible()
  await expect(graph.locator('[data-map="src/money.ts"]')).toHaveAttribute('data-role', 'changed')
  await expect(page.locator('[data-file="src/money.ts"]')).toBeVisible()
  // the graph is on the left, the diff on the right, and the two share the width
  const [g, d] = [(await graph.boundingBox())!, (await diff.boundingBox())!]
  expect(d.x).toBeGreaterThan(g.x + g.width - 1)
  expect(Math.abs(g.y - d.y)).toBeLessThan(1)
  expect(Math.abs(g.height - d.height)).toBeLessThan(1)

  // the handle between them moves from the keyboard
  const handle = page.getByRole('separator', { name: 'Resize the graph and the diff' })
  await handle.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  expect((await graph.boundingBox())!.width).toBeLessThan(g.width - 20)

  // a changed file brings its diff up on the right, and the graph stays
  await graph.locator('[data-node="src/locale.ts"]').click()
  await expect(page.locator('[data-file="src/locale.ts"]')).toBeInViewport()
  await expect(graph).toBeVisible()
  await expect(panes).toHaveCount(1)
  // also from the graph alone: the diff comes back beside it
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  await expect(diff).toHaveCount(0)
  await graph.locator('[data-map="src/money.ts"]').click()
  await expect(page.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-file="src/money.ts"]')).toBeInViewport()

  // a file the change did not touch opens in a panel below, and the graph and the diff stay where they are
  await graph.locator('[data-map="src/catalog.ts"]').click()
  await expect(panes).toHaveCount(2)
  const [top, bottom] = [panes.nth(0), panes.nth(1)]
  await expect(bottom.getByRole('heading', { name: 'Code', exact: true })).toBeVisible()
  await expect(bottom.getByText('catalog.ts').first()).toBeVisible()
  // (the panels glide to their places)
  await expect
    .poll(async () => {
      const [t, bb] = [(await top.boundingBox())!, (await bottom.boundingBox())!]
      return bb.y - (t.y + t.height) > -1 && Math.abs(bb.x - t.x) < 1
    })
    .toBe(true)
  await expect(top.locator('[data-graph]')).toBeVisible()
  await expect(top.locator('[data-file="src/money.ts"]')).toBeVisible()
  // the next one uses that same panel
  await top.locator('[data-map="src/cart.ts"]').click()
  await expect(panes).toHaveCount(2)
  await expect(bottom.getByText('cart.ts').first()).toBeVisible()

  // the diff alone, if that is wanted: it stays that way
  await top.getByRole('button', { name: 'Diff', exact: true }).click()
  await expect(graph).toHaveCount(0)
  await page.reload()
  await expect(panes).toHaveCount(2)
  await expect(page.locator('[data-file]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(graph).toHaveCount(0)
})

test('the graph is found as it was left, and leaves out the file types that are switched off', async ({ page }) => {
  await view(page, 'Changes')
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  const canvas = page.locator('[data-canvas]')
  const chip = (path: string) => page.locator(`[data-map="${path}"]`)
  const camera = () => canvas.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return [Math.round(m.e), Math.round(m.f), Math.round(m.a * 100)] })
  await expect(chip('src/money.ts')).toBeVisible()

  // move and zoom, go somewhere else, come back: the graph is where it was
  const start = await camera()
  const stage = (await canvas.locator('..').boundingBox())!
  await page.mouse.move(stage.x + 300, stage.y + 300)
  await page.mouse.down()
  await page.mouse.move(stage.x + 180, stage.y + 240, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.waitForTimeout(900)
  const left = await camera()
  expect(left).not.toEqual(start)
  await view(page, 'Board')
  await view(page, 'Changes')
  await expect(chip('src/money.ts')).toBeVisible()
  expect(await camera()).toEqual(left)
  // also after the app was closed
  await page.reload()
  await view(page, 'Changes')
  await expect(chip('src/money.ts')).toBeVisible()
  expect(await camera()).toEqual(left)

  // file types: folded to a line, opened to switch any of them off
  const types = page.getByRole('group', { name: 'File types' })
  await expect(types.getByRole('checkbox')).toHaveCount(0)
  await types.getByRole('button', { name: /File types/ }).click()
  await expect(types.locator('[data-type="ts"]')).toBeChecked()
  await expect(chip('package.json')).toBeVisible()
  await types.locator('[data-type="json"]').uncheck()
  await expect(chip('package.json')).toHaveCount(0)
  await expect(chip('src/money.ts')).toBeVisible()
  await expect(types.getByText('1 hidden')).toBeVisible()
  // a type that is off takes its changed files and their lines along
  await types.locator('[data-type="ts"]').uncheck()
  await expect(chip('src/money.ts')).toHaveCount(0)
  await expect(page.locator('[data-node="src/money.ts"]')).toHaveCount(0)
  await expect(page.locator('[data-tie]')).toHaveCount(0)
  // kept, like the rest
  await page.reload()
  await view(page, 'Changes')
  await expect(page.getByRole('group', { name: 'File types' }).getByText('2 hidden')).toBeVisible()
  await page.getByRole('group', { name: 'File types' }).getByRole('button', { name: /File types/ }).click()
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(chip('src/money.ts')).toBeVisible()
  await expect(chip('package.json')).toBeVisible()
})

test('drag after drag pans the graph, wherever the drag starts', async ({ page }) => {
  await view(page, 'Changes')
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  const canvas = page.locator('[data-canvas]')
  const camera = () => canvas.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return [Math.round(m.e), Math.round(m.f)] })
  await expect(page.locator('[data-map="src/money.ts"]')).toBeVisible()
  // start on a file's name: the text under the pointer must not get selected, or the next drag would drag that
  const from = (await page.locator('[data-map="src/catalog.ts"]').boundingBox())!
  const [x, y] = [from.x + from.width / 2, from.y + from.height / 2]
  for (let i = 0; i < 6; i++) {
    const before = await camera()
    const dir = i % 2 ? -1 : 1
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++) await page.mouse.move(x + dir * step * 12, y + step * 4)
    await page.mouse.up()
    const after = await camera()
    expect(Math.abs(after[0] - before[0] - dir * 120), `drag ${i + 1}`).toBeLessThanOrEqual(2)
    expect(Math.abs(after[1] - before[1] - 40), `drag ${i + 1}`).toBeLessThanOrEqual(2)
  }
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
})
