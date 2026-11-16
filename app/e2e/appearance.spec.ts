import type { Page } from '@playwright/test'
import { expect, test } from './launch'

const themes = (page: Page) => page.getByRole('complementary', { name: 'Themes' })
/** The settings as the app shows them first: on Carbon, the theme it starts in. */
const settings = (page: Page) => page.getByRole('button', { name: 'Appearance settings' }).click()
/**
 * The settings on Themis Dark, the built-in theme that changes nothing in app.css: the tests below start from
 * it so that every variable they see set was set by them.
 */
async function open(page: Page) {
  await settings(page)
  const plain = themes(page).getByRole('button', { name: /^Themis Dark/ })
  if ((await plain.getAttribute('aria-pressed')) !== 'true') await plain.click()
}
/** A CSS variable as set on <html> by the theme ('' when the theme leaves it to app.css). */
const variable = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)
const computed = (page: Page, selector: string, property: string) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property)

/** How the browser reports a corner shape: it answers in its own notation ("bevel" comes back as superellipse(0)). */
const shape = (page: Page, keyword: string) =>
  page.evaluate((k) => {
    const probe = document.body.appendChild(document.createElement('div'))
    probe.style.setProperty('corner-top-left-shape', k)
    const value = getComputedStyle(probe).getPropertyValue('corner-top-left-shape')
    probe.remove()
    return value
  }, keyword)

async function saveAs(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save as new theme' }).click()
  await page.getByLabel('Name the theme').fill(name)
  await page.getByRole('button', { name: 'Save theme' }).click()
}

test('switches between the built-in themes and remembers the choice', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await themes(page).getByRole('button', { name: /Themis Light/ }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await settings(page)
  await expect(themes(page).getByRole('button', { name: /Themis Light/ })).toHaveAttribute('aria-pressed', 'true')
})

test('changes a colour live, as a draft that can be discarded', async ({ page }) => {
  await open(page)
  const before = await computed(page, 'body', 'background-color')
  await page.getByLabel('Background, as hex').fill('#102030')
  await page.getByLabel('Background, as hex').press('Enter')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  expect(await variable(page, '--background')).toBe('#102030')
  expect(await computed(page, 'body', 'background-color')).toBe('rgb(16, 32, 48)')
  // the colour picker shows it too
  await expect(page.getByLabel('Background', { exact: true })).toHaveValue('#102030')

  // something that is not a colour changes nothing
  await page.getByLabel('Background, as hex').fill('nope')
  await page.getByLabel('Background, as hex').press('Enter')
  await expect(page.getByLabel('Background, as hex')).toHaveValue('#102030')

  // one colour back to the base
  await page.getByRole('button', { name: 'Reset Background' }).click()
  expect(await variable(page, '--background')).toBe('')

  await page.getByLabel('Text, as hex', { exact: true }).fill('#ffeecc')
  await page.getByLabel('Text, as hex', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  expect(await variable(page, '--foreground')).toBe('')
  expect(await computed(page, 'body', 'background-color')).toBe(before)
})

test('changes border width and corners everywhere', async ({ page }) => {
  await open(page)
  expect(await computed(page, 'nav[aria-label="Views"]', 'border-inline-end-width')).toBe('1px')
  await page.getByLabel('Border width').fill('2')
  expect(await computed(page, 'nav[aria-label="Views"]', 'border-inline-end-width')).toBe('2px')
  expect(await computed(page, 'header', 'border-bottom-width')).toBe('2px')
  await page.getByLabel('Border width').fill('0')
  expect(await computed(page, 'header', 'border-bottom-width')).toBe('0px')

  await page.getByLabel('Corner radius').fill('0')
  expect(await computed(page, '.glow-card', 'border-top-left-radius')).toBe('0px')
})

test('changes the interface and code fonts and their sizes', async ({ page }) => {
  await open(page)
  await page.getByLabel('Interface font').fill('Georgia')
  expect(await computed(page, 'body', 'font-family')).toMatch(/^"?Georgia"?,/)
  await page.getByLabel('Code font').fill('Courier New')
  expect(await computed(page, '.code', 'font-family')).toMatch(/^"Courier New",/)
  // the interface font is not the code font
  expect(await computed(page, '.code', 'font-family')).not.toContain('Georgia')

  await page.getByLabel('Interface size').fill('18')
  expect(await computed(page, 'html', 'font-size')).toBe('18px')
  await page.getByLabel('Code size').fill('15')
  expect(await computed(page, '.code', 'font-size')).toBe('15px')

  // a name cannot smuggle CSS in
  await page.getByLabel('Code font').fill('x"; } body { display: none')
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  expect(await variable(page, '--app-font-mono')).toMatch(/^"x  body  display: none",/)
})

test('changes the syntax colours', async ({ page }) => {
  await open(page)
  const keyword = page.getByRole('complementary', { name: 'Sample' }).locator('.code span[style*="color"]').first()
  await expect(keyword).toBeVisible()
  const before = await keyword.getAttribute('style')
  await page.getByLabel('Syntax colours').selectOption({ label: 'Dracula' })
  await expect(keyword).not.toHaveAttribute('style', before!)
})

test('saves a theme of its own, which survives a restart of the page', async ({ page }) => {
  await open(page)
  await page.getByLabel('Buttons, as hex').fill('#3b82f6')
  await page.getByLabel('Buttons, as hex').press('Enter')
  await page.getByLabel('Border width').fill('2')
  await page.getByLabel('Code font').fill('Courier New')
  await saveAs(page, 'Ocean')
  await expect(themes(page).getByRole('button', { name: /^Ocean/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Unsaved changes')).toBeHidden()

  // the built-in theme it came from is untouched
  await themes(page).getByRole('button', { name: /Themis Dark/ }).click()
  expect(await variable(page, '--primary')).toBe('')
  expect(await computed(page, 'header', 'border-bottom-width')).toBe('1px')
  await themes(page).getByRole('button', { name: /^Ocean/ }).click()

  await page.reload()
  // applied before the app starts, by the script in the page's head
  expect(await variable(page, '--primary')).toBe('#3b82f6')
  await page.getByRole('navigation', { name: 'Views' }).waitFor()
  expect(await computed(page, 'nav[aria-label="Views"]', 'border-inline-end-width')).toBe('2px')
  await settings(page)
  await expect(themes(page).getByRole('button', { name: /^Ocean/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Code font')).toHaveValue('Courier New')
})

test('saves changes to a theme of its own, and deletes it', async ({ page }) => {
  await open(page)
  await page.getByLabel('Border width').fill('3')
  await saveAs(page, 'Thick')

  await page.getByLabel('Border width').fill('2')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  await page.reload()
  await page.getByRole('navigation', { name: 'Views' }).waitFor()
  expect(await computed(page, 'nav[aria-label="Views"]', 'border-inline-end-width')).toBe('2px')

  // a second theme with the same name gets a number
  await settings(page)
  await saveAs(page, 'Thick')
  await expect(themes(page).getByRole('button', { name: /^Thick 2/ })).toBeVisible()

  await themes(page).getByRole('listitem').filter({ hasText: 'Thick 2' }).hover()
  await page.getByRole('button', { name: 'Delete Thick 2' }).click()
  await themes(page).getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(themes(page).getByRole('button', { name: /^Thick 2/ })).toHaveCount(0)
  // deleting the active theme falls back to the built-in one of the same base
  await expect(themes(page).getByRole('button', { name: /^Carbon/ })).toHaveAttribute('aria-pressed', 'true')
  expect(await variable(page, '--line')).toBe('')
})

test('opens the settings from the keyboard', async ({ page }) => {
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
})

test('Neon cuts the corners of panels and buttons', async ({ page }) => {
  await open(page)
  await themes(page).getByRole('button', { name: /^Neon/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-cut', 'tl br')
  expect(await variable(page, '--primary')).toBe('#00f0ff')
  // a panel: the chosen corners are bevelled at the cut's size, the others keep the theme's (square) radius
  const card = '[aria-label="Sample"] .glow-card'
  expect(await computed(page, card, 'corner-top-left-shape')).toBe(await shape(page, 'bevel'))
  expect(await computed(page, card, 'border-top-left-radius')).toBe('12px')
  expect(await computed(page, card, 'corner-bottom-right-shape')).toBe(await shape(page, 'bevel'))
  expect(await computed(page, card, 'corner-top-right-shape')).toBe(await shape(page, 'round'))
  expect(await computed(page, card, 'border-top-right-radius')).toBe('0px')
  // buttons too, at half the size
  // (buttons animate every change, the shape of their corners included: wait for them to arrive)
  await expect.poll(() => computed(page, '[aria-label="Sample"] [data-slot="button"]', 'border-top-left-radius')).toBe('6px')
  expect(await computed(page, '[aria-label="Sample"] [data-slot="button"]', 'corner-top-left-shape')).toBe(await shape(page, 'bevel'))

  // on the next start it is there before the app runs
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-cut', 'tl br')
  await page.getByRole('navigation', { name: 'Views' }).waitFor()

  // and a theme without cutouts takes them away again
  await settings(page)
  await themes(page).getByRole('button', { name: /^Themis Dark/ }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-cut')
  expect(await computed(page, card, 'corner-top-left-shape')).toBe(await shape(page, 'round'))
})

test('cuts corners: which ones, how far and in what shape', async ({ page }) => {
  await open(page)
  const card = '[aria-label="Sample"] .glow-card'
  const before = await computed(page, card, 'border-bottom-right-radius')
  await page.getByRole('switch', { name: 'Cut corners' }).click()
  // bottom right is the corner a new cutout starts with
  await expect(page.locator('html')).toHaveAttribute('data-cut', 'br')
  expect(await computed(page, card, 'corner-bottom-right-shape')).toBe(await shape(page, 'bevel'))
  expect(await computed(page, card, 'border-bottom-right-radius')).toBe('12px')

  await page.getByRole('button', { name: 'Top left' }).click()
  await page.getByRole('button', { name: 'Bottom right' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-cut', 'tl')
  expect(await computed(page, card, 'border-bottom-right-radius')).toBe(before)

  await page.getByLabel('Size', { exact: true }).fill('24')
  await page.getByRole('group', { name: 'Cut shape' }).getByRole('button', { name: 'notch' }).click()
  expect(await computed(page, card, 'border-top-left-radius')).toBe('24px')
  expect(await computed(page, card, 'corner-top-left-shape')).toBe(await shape(page, 'notch'))
  await page.getByRole('group', { name: 'Cut shape' }).getByRole('button', { name: 'scoop' }).click()
  expect(await computed(page, card, 'corner-top-left-shape')).toBe(await shape(page, 'scoop'))

  // buttons only when asked
  const button = '[aria-label="Sample"] [data-slot="button"]'
  expect(await computed(page, button, 'corner-top-left-shape')).toBe(await shape(page, 'round'))
  await page.getByRole('switch', { name: 'Buttons and fields too' }).click()
  const scoop = await shape(page, 'scoop')
  await expect.poll(() => computed(page, button, 'corner-top-left-shape')).toBe(scoop)
  await expect.poll(() => computed(page, button, 'border-top-left-radius')).toBe('12px')

  // no corner picked is no cutout
  await page.getByRole('button', { name: 'Top left' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-cut')
})

test('asks before a switch of theme throws unsaved changes away', async ({ page }) => {
  await open(page)
  await page.getByLabel('Border width').fill('3')
  await themes(page).getByRole('button', { name: /^Themis Light/ }).click()
  const ask = page.getByRole('alertdialog', { name: 'Unsaved changes' })
  await expect(ask).toContainText('Switch to Themis Light')
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await variable(page, '--line')).toBe('3px')

  await themes(page).getByRole('button', { name: /^Themis Light/ }).click()
  await ask.getByRole('button', { name: 'Discard and switch' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  expect(await variable(page, '--line')).toBe('')
})

test('exports a theme to a file and imports it again', async ({ page, electronApp, fixture }) => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const saved = path.join(fixture.repo, '..', 'exported.json')
  // the save dialog is answered for the test
  await electronApp.evaluate(({ session }, to) => session.defaultSession.on('will-download', (_e, item) => item.setSavePath(to)), saved)

  await open(page)
  await themes(page).getByRole('button', { name: /^Neon/ }).click()
  await page.getByLabel('Size', { exact: true }).fill('20')
  await saveAs(page, 'Neon Big')
  await page.getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => fs.existsSync(saved)).toBe(true)
  const exported = JSON.parse(fs.readFileSync(saved, 'utf8'))
  expect(exported).toMatchObject({ factoryTheme: 1, name: 'Neon Big', dark: true, cut: { on: true, size: 20, corners: { tl: true, br: true } } })
  expect(exported.colors.primary).toBe('#00f0ff')
  expect(exported.id).toBeUndefined()

  // into an app that does not have it: delete it, then import the file
  await themes(page).getByRole('listitem').filter({ hasText: 'Neon Big' }).hover()
  await page.getByRole('button', { name: 'Delete Neon Big' }).click()
  await themes(page).getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(themes(page).getByRole('button', { name: /^Neon Big/ })).toHaveCount(0)

  await page.getByLabel('Import a theme file').setInputFiles(saved)
  await expect(themes(page).getByRole('button', { name: /^Neon Big/ })).toHaveAttribute('aria-pressed', 'true')
  expect(await variable(page, '--cut-size')).toBe('20px')

  // a file that is not a theme says so and changes nothing
  await page.getByLabel('Import a theme file').setInputFiles({ name: 'package.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"x"}') })
  await expect(page.getByRole('alert')).toHaveText('That file is not a Factory theme.')
  await page.getByLabel('Import a theme file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{nope') })
  await expect(page.getByRole('alert')).toHaveText('That file is not JSON.')
  await expect(themes(page).getByRole('button', { name: /^Neon Big/ })).toHaveAttribute('aria-pressed', 'true')

  // out-of-range values in a file are brought into range, and CSS in a font name stays text
  const hostile = { factoryTheme: 1, name: 'Odd', dark: true, colors: { background: 'url(x)', primary: '#ABCDEF' }, line: 99, cut: { on: true, size: 999, shape: 'star', corners: { tl: true } }, fontSans: 'a"; } * { display: none' }
  await page.getByLabel('Import a theme file').setInputFiles({ name: 'odd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostile)) })
  await expect(themes(page).getByRole('button', { name: /^Odd/ })).toHaveAttribute('aria-pressed', 'true')
  expect(await variable(page, '--line')).toBe('4px')
  expect(await variable(page, '--cut-size')).toBe('40px')
  expect(await variable(page, '--cut-shape')).toBe('bevel')
  expect(await variable(page, '--background')).toBe('')
  expect(await variable(page, '--primary')).toBe('#ABCDEF')
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
})

test('starts in Carbon', async ({ page }) => {
  // before the settings were ever opened: black, square, one corner cut
  await expect(page.locator('html')).toHaveAttribute('data-cut', 'br')
  expect(await variable(page, '--background')).toBe('#000000')
  expect(await variable(page, '--radius')).toBe('0rem')
  await settings(page)
  await expect(themes(page).getByRole('button', { name: /^Carbon/ })).toHaveAttribute('aria-pressed', 'true')
  // it is the first in the list
  await expect(themes(page).getByRole('listitem').first()).toContainText('Carbon')
  // and it is there before the app starts, from the second start on
  await page.reload()
  expect(await variable(page, '--background')).toBe('#000000')
})

test('saves changes to a built-in theme, and resets it', async ({ page }) => {
  await settings(page)
  const carbon = themes(page).getByRole('listitem').filter({ hasText: 'Carbon' })
  await expect(carbon).toContainText('Built in')
  await expect(page.getByRole('button', { name: 'Reset Carbon' })).toHaveCount(0)

  await page.getByLabel('Buttons, as hex').fill('#ff8800')
  await page.getByLabel('Buttons, as hex').press('Enter')
  await page.getByLabel('Border width').fill('2')
  // both ways to keep it are offered
  await expect(page.getByRole('button', { name: 'Save as new theme' })).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  // still Carbon, not a new theme, and marked as changed
  await expect(themes(page).getByRole('listitem')).toHaveCount(4)
  await expect(carbon).toContainText('Built in · edited')
  await expect(carbon.getByRole('button', { name: /^Carbon/ })).toHaveAttribute('aria-pressed', 'true')

  // it is kept
  await page.reload()
  expect(await variable(page, '--primary')).toBe('#ff8800')
  expect(await variable(page, '--line')).toBe('2px')
  await settings(page)
  await expect(carbon).toContainText('Built in · edited')

  // one colour back to what Carbon shipped with (white), not to the base palette's orange
  await page.getByRole('button', { name: 'Reset Buttons' }).click()
  await expect(page.getByLabel('Buttons, as hex')).toHaveValue('#ffffff')
  await page.getByRole('button', { name: 'Discard' }).click()
  expect(await variable(page, '--primary')).toBe('#ff8800')

  // the whole theme back as it shipped: asks twice
  await page.getByRole('button', { name: 'Reset Carbon' }).click()
  expect(await variable(page, '--primary')).toBe('#ff8800')
  await carbon.getByRole('button', { name: 'Reset', exact: true }).click()
  expect(await variable(page, '--primary')).toBe('#ffffff')
  expect(await variable(page, '--line')).toBe('')
  await expect(carbon).not.toContainText('edited')
  await expect(page.getByRole('button', { name: 'Reset Carbon' })).toHaveCount(0)
  // a theme never edited has nothing to reset
  await expect(page.getByRole('button', { name: /^Reset (Themis|Neon)/ })).toHaveCount(0)
})
