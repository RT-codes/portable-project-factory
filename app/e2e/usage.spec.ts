import path from 'node:path'
import type { Page } from '@playwright/test'
// @ts-expect-error -- a plain script, shared with `npm run demo`
import { hold, release } from './fixture.mjs'
import { expect, test, view } from './launch'

const total = (page: Page, name: string) => page.locator(`[data-total="${name}"]`)
const period = (page: Page, name: string) => page.getByRole('group', { name: 'Period' }).getByRole('button', { name, exact: true }).click()
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.waitForTimeout(400)
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) })
}

test.describe('with weeks of tickets behind it', () => {
  test.use({ usage: true })

  test('adds up what the agent runs took, and one row of filters scopes all of it', async ({ page }) => {
    await view(page, 'Usage')
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
    // the last 30 days: six of the nine finished tickets
    await expect(total(page, 'runs')).toContainText('on 6 tickets')
    await expect(total(page, 'cost')).toContainText('at API prices')
    await expect(page.locator('[data-usage-ticket]')).toHaveCount(6)
    await shot(page, '20-usage-30-days')

    await period(page, 'All')
    await expect(total(page, 'runs')).toContainText('on 9 tickets')
    await expect(page.locator('[data-usage-ticket]')).toHaveCount(9)
    // the dearest ticket first: three rounds on the larger model
    await expect(page.locator('[data-usage-ticket]').first()).toContainText('Move pricing rules out of the cart')
    await expect(page.getByLabel('By model')).toContainText('opus-5-5')
    // a ticket that was deleted still counts: it was paid for
    await expect(page.locator('[data-usage-ticket]').filter({ hasText: 'Sync the cart across tabs' })).toContainText('Deleted')
    await shot(page, '21-usage-all')

    // a bar tells its day, on hover and on focus
    await page.locator('[data-bar="on"]').first().hover()
    await expect(page.locator('[data-tip]')).toContainText(/\d+ runs?/)

    // tokens, by kind
    await page.getByRole('group', { name: 'What the charts measure' }).getByRole('button', { name: 'Tokens' }).click()
    await expect(page.getByLabel('Over time').getByLabel('Legend')).toContainText('Read from the cache')
    await shot(page, '22-usage-tokens')

    // a model, picked from its bar or from the filter, scopes everything
    await page.getByLabel('By model').getByRole('button', { name: /gpt-6\.1-sol/ }).click()
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-6.1-sol')
    await expect(page.locator('[data-usage-ticket]')).toHaveCount(1)
    await expect(total(page, 'cost')).toContainText('not reported')
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.locator('[data-usage-ticket]')).toHaveCount(9)
  })
})

test('a ticket worked on this machine counts as it goes, and its card says how heavy it has been', async ({ page, fixture }) => {
  await view(page, 'Usage')
  await expect(page.getByText('Nothing has run yet')).toBeVisible()

  hold(fixture.repo, ['reviewer'])
  await view(page, 'Board')
  await page.getByRole('main').getByRole('button', { name: 'Run', exact: true }).click()
  const card = page.locator('[data-ticket="003-remember-the-cart-between"]')
  await expect(card).toContainText('Review')
  await expect(card.locator('[data-weight]')).toHaveText('light')
  release(fixture.repo, 'reviewer')
  await expect(card).toContainText('Journal entry', { timeout: 30_000 })

  await view(page, 'Usage')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(total(page, 'runs')).toContainText('on 1 ticket')
  await expect(page.locator('[data-usage-ticket]')).toContainText('Remember the cart between visits')
  await expect(page.locator('[data-usage-ticket]')).toContainText('Done, not merged')
  await expect(page.getByLabel('By stage')).toContainText('build')
})
