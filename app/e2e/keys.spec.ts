import type { Page } from '@playwright/test'
import { expect, test, view } from './launch'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' })
const row = (page: Page, id: string) => dialog(page).locator(`[data-action="${id}"]`)
const keysOf = (page: Page, id: string) => row(page, id).locator('[data-keys]')
const change = (page: Page, id: string) => row(page, id).getByRole('button', { name: /^Change the keys/ })
const nav = (page: Page) => page.getByRole('navigation', { name: 'Views' })
const shows = (page: Page, name: string) => expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible()
const panes = (page: Page) => page.locator('[data-pane]')

test('the shortcuts panel opens from the keyboard, floats a little below the middle, and closes', async ({ page }) => {
  await page.keyboard.press('Control+Alt+KeyK')
  await expect(dialog(page)).toBeVisible()
  // the search has the focus, so typing filters at once
  await expect(dialog(page).getByRole('searchbox', { name: 'Search shortcuts' })).toBeFocused()

  const box = (await dialog(page).boundingBox())!
  const size = page.viewportSize()!
  expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThan(1)
  const middle = box.y + box.height / 2
  expect(middle).toBeGreaterThan(size.height / 2 + 10)
  expect(middle).toBeLessThan(size.height * 0.6)

  // every shortcut of the app is listed with its keys, the splits among them
  await expect(keysOf(page, 'keys.open')).toHaveText('CtrlAltK')
  await expect(keysOf(page, 'pane.split.right')).toHaveText('Ctrl\\')
  await expect(keysOf(page, 'pane.split.down')).toHaveText('CtrlShift\\')
  await expect(keysOf(page, 'pane.focus.left')).toHaveText('Alt←')
  await expect(keysOf(page, 'view.next')).toHaveText('CtrlAlt↓')
  await expect(keysOf(page, 'diff.next')).toHaveText('J')
  // the list is longer than the panel: it scrolls
  const list = dialog(page).locator('[data-keys-list]')
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await row(page, 'editor.save').scrollIntoViewIfNeeded()
  await expect(row(page, 'editor.save')).toBeInViewport()

  // the app's shortcuts rest while it is open
  await page.keyboard.press('Control+2')
  await shows(page, 'Home')

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  // a click outside closes it too, and so does its own shortcut
  await nav(page).getByRole('button', { name: 'Shortcuts' }).click()
  await expect(dialog(page)).toBeVisible()
  await page.mouse.click(700, 40)
  await expect(dialog(page)).toHaveCount(0)
  await page.keyboard.press('Control+Alt+KeyK')
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Control+Alt+KeyK')
  await expect(dialog(page)).toHaveCount(0)
  // closed, the shortcuts work again
  await page.keyboard.press('Control+2')
  await shows(page, 'Board')
})

test('searches the shortcuts by action and by keys', async ({ page }) => {
  await page.keyboard.press('Control+Alt+KeyK')
  const rows = dialog(page).locator('[data-action]')
  await page.keyboard.type('split')
  await expect(rows).toHaveCount(3)
  await expect(row(page, 'pane.split.right')).toBeVisible()
  await expect(row(page, 'pane.split.down')).toBeVisible()
  await expect(row(page, 'pane.rotate')).toBeVisible()

  await dialog(page).getByRole('searchbox').fill('ctrl+alt')
  await expect(rows).toHaveCount(6)
  await expect(row(page, 'view.prev')).toBeVisible()
  await expect(row(page, 'pane.close')).toBeVisible()

  await dialog(page).getByRole('searchbox').fill('no such thing')
  await expect(rows).toHaveCount(0)
  await expect(dialog(page).getByText('No shortcut matches "no such thing".')).toBeVisible()
})

test('changes a shortcut by listening for the new keys, and remembers it', async ({ page }) => {
  await page.keyboard.press('Control+Alt+KeyK')
  await change(page, 'pane.split.right').click()
  await expect(keysOf(page, 'pane.split.right')).toHaveText('Press the new keys…')
  // Escape gives up on the change, not on the panel
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeVisible()
  await expect(keysOf(page, 'pane.split.right')).toHaveText('Ctrl\\')

  await change(page, 'pane.split.right').click()
  await page.keyboard.press('Control+Alt+KeyD')
  await expect(keysOf(page, 'pane.split.right')).toHaveText('CtrlAltD')
  await expect(dialog(page).getByRole('status')).toHaveText('"Split right" is now Ctrl+Alt+D.')
  // a named key alone would be lost to the app: it is refused
  await change(page, 'pane.split.down').click()
  await page.keyboard.press('Enter')
  await expect(dialog(page).getByRole('status')).toHaveText(/needs Ctrl, Alt or Super/)
  await expect(keysOf(page, 'pane.split.down')).toHaveText('Press the new keys…')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // the new keys split, the old ones no longer do, and the toolbar names the new ones
  await page.keyboard.press('Control+Backslash')
  await expect(panes(page)).toHaveCount(1)
  await page.keyboard.press('Control+Alt+KeyD')
  await expect(panes(page)).toHaveCount(2)
  await page.getByRole('toolbar', { name: 'Panels' }).getByRole('button', { name: 'Split right' }).hover()
  await expect(page.getByText('Ctrl+Alt+D', { exact: true }).first()).toBeVisible()

  await page.reload()
  await page.keyboard.press('Control+Alt+KeyD')
  await expect(panes(page)).toHaveCount(3)

  // back to the default
  await page.keyboard.press('Control+Alt+KeyK')
  await row(page, 'pane.split.right').getByRole('button', { name: /^Reset/ }).click()
  await expect(keysOf(page, 'pane.split.right')).toHaveText('Ctrl\\')
  await expect(dialog(page).getByRole('button', { name: 'Reset all' })).toBeDisabled()
})

test('keys taken from another action leave it without, until reset', async ({ page }) => {
  await page.keyboard.press('Control+Alt+KeyK')
  await change(page, 'view.next').click()
  await page.keyboard.press('Control+KeyB')
  await expect(keysOf(page, 'view.next')).toHaveText('CtrlB')
  await expect(keysOf(page, 'sidebar.fold')).toHaveText('Not set')
  await expect(dialog(page).getByRole('status')).toHaveText('"Fold or open the sidebar" used those keys and has none now.')
  // the keys of the app's menu cannot be taken
  await change(page, 'view.prev').click()
  await page.keyboard.press('Control+KeyO')
  await expect(dialog(page).getByRole('status')).toHaveText(/belongs to "Open a project"/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+KeyB')
  await expect(nav(page)).toHaveAttribute('data-folded', 'false')
  await expect(nav(page).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  await expect(nav(page).getByRole('button', { name: 'Fold the sidebar' })).toHaveAttribute('title', 'Fold the sidebar')

  await page.keyboard.press('Control+Alt+KeyK')
  await dialog(page).getByRole('button', { name: 'Reset all' }).click()
  await expect(keysOf(page, 'sidebar.fold')).toHaveText('CtrlB')
  await expect(keysOf(page, 'view.next')).toHaveText('CtrlAlt↓')
})

test('steps through the views of the sidebar, and hops between panels with Alt and the arrows', async ({ page }) => {
  // (stepping only changes what the panel shows: Activity does not bring the board along, as a click on it does)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(nav(page).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  await expect(panes(page)).toHaveCount(1)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await shows(page, 'Board')
  await page.keyboard.press('Control+Alt+ArrowUp')
  await page.keyboard.press('Control+Alt+ArrowUp')
  await shows(page, 'Home')
  // around the end
  await page.keyboard.press('Control+Alt+ArrowUp')
  await shows(page, 'Agents')
  await expect(nav(page).getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Control+Alt+ArrowDown')
  await shows(page, 'Home')

  // right | left over bottom-left
  await page.keyboard.press('Control+Backslash')
  await view(page, 'Issues')
  await page.keyboard.press('Alt+ArrowLeft')
  await page.keyboard.press('Control+Shift+Backslash')
  const [top, right, bottom] = [panes(page).nth(0), panes(page).nth(1), panes(page).nth(2)]
  await expect(bottom).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Alt+ArrowUp')
  await expect(top).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(right).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Alt+ArrowLeft')
  await page.keyboard.press('Alt+ArrowDown')
  await expect(bottom).toHaveAttribute('data-active', 'true')
})

test('the keys of a diff follow the panel too', async ({ page }) => {
  await view(page, 'Changes')
  await expect(page.locator('[data-file]')).toHaveCount(2)
  await page.keyboard.press('Control+Alt+KeyK')
  await change(page, 'diff.viewed').click()
  await page.keyboard.press('KeyX')
  await expect(keysOf(page, 'diff.viewed')).toHaveText('X')
  await page.keyboard.press('Escape')
  await expect(page.getByText('viewed', { exact: false }).locator('kbd').last()).toHaveText('x')
})
