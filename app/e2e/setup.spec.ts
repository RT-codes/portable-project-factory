import { expect, test, view } from './launch'

test.describe('a first run', () => {
  test.use({ open: false })

  test('asks for a project', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open a project' })).toBeVisible()
  })
})

test.describe('a repo without a factory', () => {
  test.use({ factory: false })

  test('says how to get a board', async ({ page }) => {
    await view(page, 'Board')
    await expect(page.getByRole('heading', { name: 'No factory in this repo yet' })).toBeVisible()
    await expect(page.getByText('npx -y github:RT-codes/portable-project-factory')).toBeVisible()
  })
})

test.describe('a machine without the GitHub CLI', () => {
  test.use({ gh: 'missing' })

  test('says what is missing, and everything local still works', async ({ page }) => {
    await view(page, 'Pull requests')
    await expect(page.getByRole('heading', { name: 'GitHub is not connected' })).toBeVisible()
    await expect(page.getByText('The GitHub CLI (gh) is not installed.')).toBeVisible()
    await view(page, 'Issues')
    await expect(page.getByRole('heading', { name: 'GitHub is not connected' })).toBeVisible()
    await view(page, 'Changes')
    await expect(page.locator('[data-file]')).toHaveCount(2)
    await view(page, 'Board')
    await expect(page.getByText('Support gift cards at checkout')).toBeVisible()
  })
})

test('switches views from the keyboard, in the order of the sidebar', async ({ page }) => {
  const shows = (name: string) => expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible()
  await page.keyboard.press('Control+2')
  await shows('Board')
  await page.keyboard.press('Control+6')
  await shows('Code')
  await page.keyboard.press('Control+7')
  await shows('History')
  await page.keyboard.press('Control+8')
  await shows('Journal')
  await page.keyboard.press('Control+9')
  await shows('Agents')
  await page.keyboard.press('Control+1')
  await shows('Home')
  // the sidebar says which key is which
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Journal' })).toHaveAttribute('title', /\+8\)$/)
})

test('folds the sidebar to its icons, and remembers that', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Views' })
  const width = async () => Math.round((await nav.evaluate(async (el) => (await Promise.all(el.getAnimations().map((a) => a.finished)), el.getBoundingClientRect().width))) as number)
  // the sidebar is sized in rem, and the theme sets how big a rem is
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
  expect(await width()).toBe(Math.round(14 * rem))
  await page.getByRole('button', { name: 'Fold the sidebar' }).click()
  await expect(nav).toHaveAttribute('data-folded', 'true')
  expect(await width()).toBe(Math.round(3.5 * rem))
  // the icons are still the way to every view, and the labels are gone from sight
  await expect(nav.getByText('Pull requests')).not.toBeInViewport()
  await view(page, 'Issues')
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  // the project menu still opens from its icon
  await nav.getByRole('button', { name: /^Project: shop/ }).click()
  await expect(page.getByRole('menuitem', { name: /Open a project/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(nav).toHaveAttribute('data-folded', 'true')
  await page.keyboard.press('Control+KeyB')
  await expect(nav).toHaveAttribute('data-folded', 'false')
  expect(await width()).toBe(Math.round(14 * rem))
  await expect(page.getByRole('button', { name: 'Fold the sidebar' })).toBeVisible()
})

test('the page can only reach projects the user opened, and only inside them', async ({ page, fixture }) => {
  // the bridge the page itself uses (electron/preload.ts), called as a script on the page could
  type Bridge = { factoryApp: { invoke(method: string, args: unknown[]): Promise<unknown> } }
  const call = (method: string, args: unknown[]) => page.evaluate(([m, a]) => (globalThis as unknown as Bridge).factoryApp.invoke(m as string, a as unknown[]), [method, args] as const)
  // a folder that was never opened
  expect(await call('file', ['/etc', 'WORKTREE', 'passwd'])).toEqual({ ok: false, error: 'unknown project' })
  expect(await call('tree', ['/', 'WORKTREE'])).toEqual({ ok: false, error: 'unknown project' })
  // out of the project through the path, or through the revision
  expect(await call('file', [fixture.repo, 'WORKTREE', '../gh/state.json'])).toMatchObject({ ok: false })
  expect(await call('file', [fixture.repo, '--output=/tmp/x', 'README.md'])).toMatchObject({ ok: false })
  expect(await call('factoryFile', [fixture.repo, '..', 'config.json'])).toMatchObject({ ok: false })
  // not a method of the api
  expect(await call('constructor', [])).toEqual({ ok: false, error: 'not allowed' })
  // and what is allowed works
  expect(await call('file', [fixture.repo, 'WORKTREE', 'README.md'])).toMatchObject({ ok: true, value: { binary: false, missing: false } })
})
