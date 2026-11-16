import fs from 'node:fs'
import path from 'node:path'
import { expect, test, view } from './launch'

test('lists issues and shows one with its comments', async ({ page }) => {
  await view(page, 'Issues')
  await expect(page.getByRole('button', { name: /Totals are off by a cent/ })).toContainText('#12')
  await page.getByRole('button', { name: /Totals are off by a cent/ }).click()
  await expect(page.getByRole('heading', { name: /Totals are off by a cent for some carts/ })).toBeVisible()
  // GitHub markdown: task lists and <details> render, as HTML that is safe to show
  await expect(page.getByText('Happens on main')).toBeVisible()
  await expect(page.locator('details summary')).toHaveText('Guess')
  await expect(page.getByText('Then the receipt is the one that is wrong.')).toBeVisible()

  await page.getByRole('button', { name: 'closed', exact: true }).click()
  await expect(page.getByRole('button', { name: /Prices show in dollars/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Totals are off/ })).toHaveCount(0)
})

test('searches issues', async ({ page }) => {
  await view(page, 'Issues')
  await page.getByPlaceholder('Search issues').fill('remove')
  await expect(page.getByRole('button', { name: /Let customers remove one item/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Totals are off/ })).toHaveCount(0)
})

test('comments on an issue, closes it and reopens it', async ({ page, fixture }) => {
  await view(page, 'Issues')
  await page.getByRole('button', { name: /Totals are off by a cent/ }).click()
  await page.getByPlaceholder('Leave a comment').fill('Looking into it.')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Looking into it.' })).toContainText('octo-dev')
  expect(fixture.calls().find((c) => c.args.includes('repos/acme/shop/issues/12/comments'))?.input).toEqual({ body: 'Looking into it.' })

  await page.getByPlaceholder('Leave a comment').fill('Fixed in #7.')
  await page.getByRole('button', { name: 'Close with comment' }).click()
  await expect(page.getByText('Closed', { exact: true })).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: 'Fixed in #7.' })).toBeVisible()
  const patch = fixture.calls().find((c) => c.args.includes('PATCH'))
  expect(patch?.args).toContain('repos/acme/shop/issues/12')
  expect(patch?.input).toEqual({ state: 'closed' })
  // it has left the open list
  await expect(page.getByRole('button', { name: /Totals are off/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Totals are off/ })).toBeVisible()
})

test('creates an issue', async ({ page, fixture }) => {
  await view(page, 'Issues')
  await page.getByRole('button', { name: 'New issue' }).click()
  await page.getByLabel('Title').fill('Cart badge shows the wrong count')
  await page.getByPlaceholder('Describe it (optional)').fill('It counts lines, not items.')
  await page.getByRole('button', { name: 'Create issue' }).click()
  await expect(page.getByRole('heading', { name: /Cart badge shows the wrong count/ })).toContainText('#13')
  await expect(page.getByRole('button', { name: /Cart badge shows the wrong count/ })).toBeVisible()
  expect(fixture.calls().find((c) => c.args.at(3) === 'repos/acme/shop/issues')?.input).toEqual({ title: 'Cart badge shows the wrong count', body: 'It counts lines, not items.' })
})

test('hands an issue to the factory as a ticket', async ({ page, fixture }) => {
  await view(page, 'Issues')
  await page.getByRole('button', { name: /Totals are off by a cent/ }).click()
  await page.getByRole('button', { name: 'Send to factory' }).click()
  await page.getByRole('button', { name: /Filed as 004/ }).click()
  // the board opens on it, in the inbox
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Totals are off by a cent for some carts', level: 2 })).toBeVisible()
  await expect(sheet).toContainText('Inbox')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /#004.*Totals are off by a cent for some carts/ })).toBeVisible()
  const ticket = fs.readFileSync(path.join(fixture.repo, '.factory/jobs/004-totals-are-off-by/ticket.md'), 'utf8')
  expect(ticket).toContain('# Totals are off by a cent for some carts')
  expect(ticket).toContain('From GitHub issue #12: https://github.com/acme/shop/issues/12')
})
