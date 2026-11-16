import type { Page } from '@playwright/test'
import { expect, test, view } from './launch'

async function openPull(page: Page) {
  await view(page, 'Pull requests')
  await page.getByRole('button', { name: /Discount codes/ }).click()
  await expect(page.getByText('wants to merge')).toBeVisible()
}

async function openChanges(page: Page) {
  await openPull(page)
  await page.getByRole('navigation', { name: 'Pull request' }).getByRole('button', { name: /^Changes/ }).click()
  await expect(page.locator('[data-file]')).toHaveCount(9)
}

const file = (page: Page, path: string) => page.locator(`[data-file="${path}"]`)
/** Bring a file of the diff into view: files far down the list are only drawn when they come near. */
const show = (page: Page, path: string) => page.locator(`[data-path="${path}"]`).click()
const line = (page: Page, path: string, anchor: string) => file(page, path).locator(`[data-anchor="${anchor}"]`)

/** Write a pending comment on a diff line. */
async function comment(page: Page, path: string, anchor: string, text: string) {
  await show(page, path)
  const row = line(page, path, anchor)
  await row.scrollIntoViewIfNeeded()
  await row.hover()
  await row.getByRole('button', { name: 'Comment on this line' }).click()
  await page.getByPlaceholder(`Comment on line ${anchor.split(':')[1]}`).fill(text)
  await page.getByRole('button', { name: 'Add to review' }).click()
}

test('lists pull requests and shows one', async ({ page }) => {
  await view(page, 'Pull requests')
  await expect(page.getByRole('button', { name: /Discount codes/ })).toContainText('#7')
  await expect(page.getByRole('button', { name: /Discount codes/ })).toContainText('discount-codes → main')

  await page.getByRole('button', { name: 'closed', exact: true }).click()
  await expect(page.getByRole('button', { name: /Default to EUR/ })).toBeVisible()
  await page.getByRole('button', { name: 'open', exact: true }).click()

  await openPull(page)
  await expect(page.getByText('taken off before VAT')).toBeVisible()
  await expect(page.getByText('No conflicts with the base branch.')).toBeVisible()
  // the commits come from the fetched pull request, not from GitHub's answer
  await expect(page.getByText('Redeem a code in the cart')).toBeVisible()
  await expect(page.getByText('Add discount codes to pricing')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Open review threads' })).toContainText('src/discounts.ts:15')
})

test('shows the diff with its review threads', async ({ page }) => {
  await openChanges(page)
  await expect(file(page, 'src/api/charge.ts')).toContainText('src/api/payments.ts')
  await expect(file(page, 'src/api/charge.ts')).toContainText('Renamed without changes.')
  await expect(line(page, 'src/legacy/coupons.ts', 'LEFT:1')).toContainText('The old coupon codes')
  await show(page, 'src/pricing.ts')
  await expect(line(page, 'src/pricing.ts', 'LEFT:9')).toContainText('const VAT = 0.21')
  await expect(line(page, 'src/pricing.ts', 'RIGHT:10')).toContainText('const VAT_RATE = 0.21')
  // only what changed within the line is marked
  await expect(line(page, 'src/pricing.ts', 'RIGHT:10').locator('.chg')).toHaveText('_RATE')
  // code is coloured
  await expect(line(page, 'src/pricing.ts', 'RIGHT:10').locator('span[style*="color"]').first()).toBeVisible()

  // the open thread sits under its line; the resolved one is folded
  await show(page, 'src/discounts.ts')
  const thread = file(page, 'src/discounts.ts').locator('[data-thread="PRRT_1"]')
  await expect(thread).toContainText('Should an unknown code be an error')
  await show(page, 'src/pricing.ts')
  await expect(file(page, 'src/pricing.ts').locator('[data-thread="PRRT_2"]')).toContainText('Resolved thread · hubot · 1 comment')
  await file(page, 'src/pricing.ts').locator('[data-thread="PRRT_2"]').getByRole('button').click()
  await expect(file(page, 'src/pricing.ts').locator('[data-thread="PRRT_2"]')).toContainText('VAT_RATE reads better')
})

test('opens the unchanged lines between hunks', async ({ page }) => {
  await openChanges(page)
  const cart = file(page, 'src/cart.ts')
  await expect(line(page, 'src/cart.ts', 'RIGHT:14')).toHaveCount(0)
  await show(page, 'src/cart.ts')
  await cart.getByRole('button', { name: /Show \d+ unchanged lines?/ }).first().click()
  await expect(line(page, 'src/cart.ts', 'RIGHT:14')).toContainText('else this.lines.push')
  // an opened line is not part of the diff GitHub knows, so it takes no comment
  await line(page, 'src/cart.ts', 'RIGHT:14').hover()
  await expect(line(page, 'src/cart.ts', 'RIGHT:14').getByRole('button', { name: 'Comment on this line' })).toHaveCount(0)
})

test('writes comments on lines and submits them as one review', async ({ page, fixture }) => {
  await openChanges(page)
  await comment(page, 'src/cart.ts', 'RIGHT:24', 'Should `redeem` clear an old discount on a bad code?')
  await comment(page, 'src/pricing.ts', 'LEFT:9', 'Good riddance.')
  await expect(page.locator('[data-draft]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /Submit review/ })).toContainText('2')
  expect(fixture.calls().some((c) => c.args.includes('-X'))).toBe(false) // nothing sent yet

  // a pending comment can be edited
  await file(page, 'src/pricing.ts').locator('[data-draft]').getByRole('button', { name: 'Edit' }).click()
  await file(page, 'src/pricing.ts').getByRole('textbox').fill('Good riddance to the magic number.')
  await file(page, 'src/pricing.ts').getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: /Submit review/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Submit review' })
  await dialog.getByRole('textbox').fill('Two small things.')
  await dialog.getByRole('button', { name: 'Submit with 2 comments' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-draft]')).toHaveCount(0)

  const sent = fixture.calls().find((c) => c.args.includes('repos/acme/shop/pulls/7/reviews'))
  expect(sent?.args.slice(0, 3)).toEqual(['api', '-X', 'POST'])
  expect(sent?.input).toEqual({
    commit_id: fixture.headSha,
    event: 'COMMENT',
    body: 'Two small things.',
    comments: [
      { path: 'src/cart.ts', line: 24, side: 'RIGHT', body: 'Should `redeem` clear an old discount on a bad code?' },
      { path: 'src/pricing.ts', line: 9, side: 'LEFT', body: 'Good riddance to the magic number.' },
    ],
  })
  // and they come back as threads on their lines
  await expect(file(page, 'src/cart.ts').locator('[data-thread]')).toContainText('Should redeem clear an old discount')
  await expect(file(page, 'src/pricing.ts').locator('[data-thread]').filter({ hasText: 'magic number' })).toBeVisible()
})

test('keeps pending comments when the app is left and reopened on the pull request', async ({ page }) => {
  await openChanges(page)
  await comment(page, 'src/cart.ts', 'RIGHT:24', 'Remember me.')
  await view(page, 'Board')
  await openChanges(page)
  await expect(file(page, 'src/cart.ts').locator('[data-draft]')).toContainText('Remember me.')
  await file(page, 'src/cart.ts').locator('[data-draft]').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('[data-draft]')).toHaveCount(0)
})

test('replies to a thread and resolves it', async ({ page, fixture }) => {
  await openChanges(page)
  await show(page, 'src/discounts.ts')
  const thread = file(page, 'src/discounts.ts').locator('[data-thread="PRRT_1"]')
  await thread.getByRole('button', { name: 'Reply…' }).click()
  await thread.getByPlaceholder('Reply').fill('Agreed, quiet is fine.')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(thread).toContainText('Agreed, quiet is fine.')
  expect(fixture.calls().find((c) => c.args.includes('repos/acme/shop/pulls/7/comments/701/replies'))?.input).toEqual({ body: 'Agreed, quiet is fine.' })

  await thread.getByRole('button', { name: 'Resolve' }).click()
  await expect(thread).toContainText('Resolved thread · hubot · 3 comments')
  const resolve = fixture.calls().find((c) => JSON.stringify(c.input).includes('resolveReviewThread'))
  expect((resolve?.input as { variables: unknown }).variables).toEqual({ id: 'PRRT_1' })
})

test('approves and merges', async ({ page, fixture }) => {
  await openPull(page)
  await page.getByRole('button', { name: /Submit review/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Submit review' })
  await dialog.getByText('Approve', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Submit review' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('approved', { exact: true })).toBeVisible()
  expect(fixture.calls().find((c) => c.args.includes('repos/acme/shop/pulls/7/reviews'))?.input).toMatchObject({ event: 'APPROVE', comments: [] })

  // merging asks twice
  await page.getByRole('button', { name: 'Squash and merge' }).click()
  expect(fixture.calls().some((c) => c.args.includes('repos/acme/shop/pulls/7/merge'))).toBe(false)
  await page.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(page.getByText('Merged into main.')).toBeVisible()
  const merge = fixture.calls().find((c) => c.args.includes('repos/acme/shop/pulls/7/merge'))
  expect(merge?.args.slice(0, 3)).toEqual(['api', '-X', 'PUT'])
  expect(merge?.input).toEqual({ merge_method: 'squash', sha: fixture.headSha })
  await expect(page.getByRole('button', { name: /Submit review/ })).toHaveCount(0)
})

test('marks files as viewed, with the keyboard too', async ({ page }) => {
  await openChanges(page)
  await expect(page.getByText('0/9 viewed')).toBeVisible()
  await show(page, 'src/legacy/coupons.ts')
  await file(page, 'src/legacy/coupons.ts').getByLabel('Viewed').check()
  await expect(page.getByText('1/9 viewed')).toBeVisible()
  // viewed folds the file
  await expect(line(page, 'src/legacy/coupons.ts', 'LEFT:1')).toHaveCount(0)

  // j moves to the next file, v marks it and moves on
  await page.keyboard.press('j')
  await page.keyboard.press('v')
  await expect(page.getByText('2/9 viewed')).toBeVisible()

  // remembered for this pull request
  await view(page, 'Board')
  await openChanges(page)
  await expect(page.getByText('2/9 viewed')).toBeVisible()
  await expect(file(page, 'src/legacy/coupons.ts').getByLabel('Viewed')).toBeChecked()
})

test('shows the diff side by side', async ({ page }) => {
  await openChanges(page)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await show(page, 'src/pricing.ts')
  // the old and the new line of an edit sit in one row
  const old = line(page, 'src/pricing.ts', 'LEFT:9')
  const next = line(page, 'src/pricing.ts', 'RIGHT:10')
  await expect(old).toContainText('const VAT = 0.21')
  const [a, b] = [await old.boundingBox(), await next.boundingBox()]
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  expect(b!.x).toBeGreaterThan(a!.x + 100)
  // comments still land on the right side of the right line
  await comment(page, 'src/pricing.ts', 'LEFT:9', 'From the split view.')
  await expect(file(page, 'src/pricing.ts').locator('[data-draft]')).toContainText('From the split view.')
})

test('draws the import graph of the change', async ({ page }) => {
  await openChanges(page)
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  const node = (path: string) => page.locator(`[data-node="${path}"]`)
  const chip = (path: string) => page.locator(`[data-map="${path}"]`)
  const folder = (dir: string) => page.locator(`[data-folder="${dir}"]`)
  await expect(node('src/discounts.ts')).toBeVisible()
  await expect(page.getByText('9 changed')).toBeVisible()
  await expect(page.getByText('1 importing them')).toBeVisible()

  // the project is a map on the left: a box per folder, with its files in it
  await expect(folder('src')).toBeVisible()
  await expect(folder('src/ui')).toBeVisible()
  const inside = async (path: string, dir: string) => {
    const [c, f] = [(await chip(path).boundingBox())!, (await folder(dir).boundingBox())!]
    return c.x >= f.x && c.y >= f.y && c.x + c.width <= f.x + f.width && c.y + c.height <= f.y + f.height
  }
  expect(await inside('src/cart.ts', 'src')).toBe(true)
  expect(await inside('src/ui/CheckoutButton.svelte', 'src/ui')).toBe(true)
  // on it, the changed files are lit, a file that imports one stands out, and the rest is just there
  await expect(chip('src/discounts.ts')).toHaveAttribute('data-role', 'changed')
  await expect(chip('src/ui/CheckoutButton.svelte')).toHaveAttribute('data-role', 'dependent')
  await expect(chip('src/catalog.ts')).toHaveAttribute('data-role', 'plain')

  // the changed files are one column right of the map, each tied to its place on it
  const at = async (path: string) => (await node(path).boundingBox())!
  const [cart, pricing, discounts] = [await at('src/cart.ts'), await at('src/pricing.ts'), await at('src/discounts.ts')]
  expect(Math.abs(cart.x - pricing.x)).toBeLessThan(1)
  expect(Math.abs(pricing.x - discounts.x)).toBeLessThan(1)
  const mapEdge = (await folder('src').boundingBox())!
  expect(cart.x).toBeGreaterThan(mapEdge.x + mapEdge.width)
  await expect(page.locator('[data-tie]')).toHaveCount(9)
  // a file the change leans on, though it is not in the diff, is right of them
  expect((await at('src/money.ts')).x).toBeGreaterThan(cart.x + cart.width)

  // a changed file's box leads to its diff
  await node('src/discounts.ts').click()
  await expect(line(page, 'src/discounts.ts', 'RIGHT:15')).toBeInViewport()
})

test('the graph moves smoothly, changes its background, and leaves the rest of the project out when asked', async ({ page }) => {
  await openChanges(page)
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  const node = (path: string) => page.locator(`[data-node="${path}"]`)
  const chip = (path: string) => page.locator(`[data-map="${path}"]`)
  const canvas = page.locator('[data-canvas]')
  const scale = () => canvas.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
  await expect(node('src/discounts.ts')).toBeVisible()

  // dots behind the graph by default; the panel at the top changes that, and it is remembered
  const background = page.getByRole('group', { name: 'Background' })
  await expect(page.locator('[data-backdrop="dots"]')).toBeVisible()
  await background.getByRole('button', { name: 'grid' }).click()
  await expect(page.locator('[data-backdrop="grid"]')).toBeVisible()
  await background.getByRole('button', { name: 'plain' }).click()
  await expect(page.locator('[data-backdrop]')).toHaveCount(0)

  // one notch of the wheel with Ctrl zooms a little, and gets there gradually
  const before = await scale()
  const box = (await page.locator('[data-canvas]').locator('..').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await expect.poll(scale).toBeGreaterThan(before * 1.1)
  await page.waitForTimeout(700)
  const after = await scale()
  expect(after).toBeGreaterThan(before * 1.1)
  expect(after).toBeLessThan(before * 1.2)

  // only what the change touches: the rest of the project leaves the map, the lines stay
  const options = page.getByRole('group', { name: 'Graph options' })
  await expect(chip('src/catalog.ts')).toBeVisible()
  await options.getByLabel('Only affected files').check()
  await expect(chip('src/catalog.ts')).toHaveCount(0)
  await expect(page.locator('[data-folder=".claude/agents"]')).toHaveCount(0)
  await expect(chip('src/discounts.ts')).toBeVisible()
  await expect(chip('src/ui/CheckoutButton.svelte')).toBeVisible()
  await expect(page.locator('[data-tie]')).toHaveCount(9)
  // and without the files the change leans on
  await expect(node('src/money.ts')).toBeVisible()
  await options.getByLabel('Files they import').uncheck()
  await expect(node('src/money.ts')).toHaveCount(0)

  // the choices are kept
  await page.reload()
  await openPull(page)
  await page.getByRole('navigation', { name: 'Pull request' }).getByRole('button', { name: /^Changes/ }).click()
  // (the graph itself was the last thing shown here: that is kept too)
  await expect(node('src/discounts.ts')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Graph options' }).getByLabel('Only affected files')).toBeChecked()
  await expect(chip('src/catalog.ts')).toHaveCount(0)
  await expect(page.locator('[data-backdrop]')).toHaveCount(0)
})

test('the graph explains its colours, sizes files by their length, and squares its lines when asked', async ({ page }) => {
  await openChanges(page)
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  const chip = (path: string) => page.locator(`[data-map="${path}"]`)
  const height = async (path: string) => Math.round((await chip(path).evaluate((el) => (el as HTMLElement).offsetHeight)) as number)
  await expect(chip('src/discounts.ts')).toBeVisible()

  // how to read the colours, in the middle at the top
  const legend = page.getByRole('list', { name: 'What the colours mean' })
  for (const name of ['Added', 'Changed', 'Removed', 'Renamed']) await expect(legend.getByText(name, { exact: true })).toBeVisible()

  // a long file is taller than a short one, and the slider says by how much
  const options = page.getByRole('group', { name: 'Graph options' })
  const amount = options.getByLabel('How much taller a long file is')
  const [long, short] = [await height('src/discounts.ts'), await height('src/money.ts')]
  expect(long).toBeGreaterThan(short)
  await amount.fill('1')
  await expect.poll(() => height('src/discounts.ts')).toBeGreaterThan(long)
  // a folder is never see-through: what is behind it does not show
  expect(await page.locator('[data-folder="src"]').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/\/ 0\.|, 0\.\d+\)$/)
  await options.getByLabel('Size by length').uncheck()
  await expect.poll(async () => (await height('src/discounts.ts')) === (await height('src/money.ts')) && (await height('src/money.ts')) === 24).toBe(true)
  await expect(amount).toBeDisabled()

  // lines are curves, or run straight with square corners
  const shape = () => page.locator('[data-tie]').first().evaluate((el) => getComputedStyle(el).getPropertyValue('d'))
  const spacing = options.getByLabel('Space between the lines')
  expect(await shape()).toContain('C')
  await expect(spacing).toBeDisabled()
  await options.getByLabel('Angular lines').check()
  await expect.poll(shape).not.toContain('C')
  // every corner is a right angle: each stretch keeps its x or its y
  const corners = () =>
    page.locator('[data-canvas] path[marker-end], [data-tie]').evaluateAll((paths) =>
      paths.every((p) => {
        const n = (getComputedStyle(p).getPropertyValue('d').match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
        for (let i = 2; i + 1 < n.length; i += 2) if (Math.abs(n[i] - n[i - 2]) > 0.01 && Math.abs(n[i + 1] - n[i - 1]) > 0.01) return false
        return n.length >= 4
      })
    )
  await expect.poll(corners).toBe(true)
  // apart, the lines into one file arrive at different heights; over each other, at one
  const arrivals = () =>
    page.locator('[data-canvas] path[marker-end]').evaluateAll((paths) => {
      const ends = paths.map((p) => (getComputedStyle(p).getPropertyValue('d').match(/-?\d+(\.\d+)?/g) ?? []).map(Number).slice(-2).join(','))
      return new Set(ends).size
    })
  await spacing.fill('6')
  const apart = await arrivals()
  await spacing.fill('0')
  await expect.poll(arrivals).toBeLessThan(apart)
})
