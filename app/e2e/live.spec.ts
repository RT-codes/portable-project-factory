import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
// @ts-expect-error -- a plain script, shared with `npm run demo`
import { hold, release, startRun } from './fixture.mjs'
import { expect, test, view } from './launch'

// A real run of the fixture's factory, with a slow stand-in for the agent that waits where a test tells it to
// (slow-agent.mjs): what the app shows while a ticket is being worked.

interface Run {
  release(role: string): void
  stop(): void
  done: Promise<unknown>
}
const TICKET = '003-remember-the-cart-between'
const card = (page: Page) => page.locator(`[data-ticket="${TICKET}"]`)
/** SHOTS=<folder> keeps pictures of each state, for a person to look at */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.waitForTimeout(600)
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) })
}

test('a ticket shows what is happening to it, from the board to the history, while a run works it', async ({ page, fixture }) => {
  const run: Run = startRun(fixture.repo, { pace: 120, hold: ['planner', 'builder', 'reviewer'] })
  try {
    // ---- planning: the card says a run is working it, in which stage, for how long, and the agent's latest step
    await view(page, 'Board')
    await expect(card(page)).toHaveAttribute('data-live', 'running')
    await expect(card(page)).toContainText('Plan')
    await expect(card(page).locator('[data-step]')).toHaveText('Looking for src/**/*.ts')
    await expect(card(page).locator('[data-elapsed]')).toHaveText(/^\d+s$/)
    await expect(card(page).locator('[data-facts]')).toContainText('sonnet-5-5 · 2 turns')
    await expect(page.locator('[data-run="on"]')).toContainText('1 ticket being worked')
    await expect(page.getByLabel('Board').getByText('1 running')).toBeVisible()
    await shot(page, '1-board-planning')

    // its sheet opens on the live feed
    await card(page).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.locator('[data-now="running"]')).toContainText('The planner is working')
    await expect(sheet.locator('[data-feed] li')).toHaveText([/Reading ticket\.md/, /Looking for src\/\*\*\/\*\.ts/])
    await shot(page, '2-sheet-planning')
    await page.keyboard.press('Escape')

    // History draws the ticket before it has a branch, growing from the base branch
    await view(page, 'History')
    const wip = page.locator(`[data-wip="${TICKET}"]`)
    await expect(wip).toHaveAttribute('data-wip-live', 'running')
    await expect(wip).toContainText('no branch yet')
    await shot(page, '3-history-planning')

    // ---- building: the worktree exists, and work that is not committed yet shows
    run.release('planner')
    await expect(wip).toContainText(`Writing src/remember-the-cart-between.ts`)
    await expect(page.getByRole('complementary', { name: 'Worktrees' }).getByRole('button', { name: new RegExp(TICKET) })).toContainText('1 uncommitted file')
    await expect(wip.locator('[data-work]')).toContainText('1 file')
    await shot(page, '4-history-building')
    await view(page, 'Board')
    await expect(card(page)).toContainText('Build')
    await expect(card(page)).toContainText(`factory/${TICKET}`)
    await expect(card(page).locator('[data-work]')).toHaveText(/1 file\s*\+10/)
    await shot(page, '5-board-building')
    await card(page).click()
    await sheet.getByRole('tab', { name: /Changes/ }).click()
    await expect(sheet).toContainText('not committed')
    await shot(page, '6-sheet-changes')
    await page.keyboard.press('Escape')

    // ---- reviewing: the builder's commits are in the history
    run.release('builder')
    await expect(card(page)).toContainText('Review')
    await expect(card(page).locator('[data-work]')).toContainText('2 commits · 3 files')
    await view(page, 'History')
    await expect(page.locator('[data-commit]').filter({ hasText: 'Add the remember-the-cart-between module' })).toBeVisible()
    await expect(page.locator('[data-commit]').filter({ hasText: 'Remember the cart between visits' })).toContainText(`factory/${TICKET}`)
    // nothing is uncommitted there, but the reviewer is at work in it
    await expect(wip).toContainText('Review')
    await shot(page, '7-history-reviewing')

    // ---- done: the run ends, and nothing claims to be going on
    run.release('reviewer')
    await run.done
    await expect(wip).toHaveCount(0)
    await view(page, 'Board')
    await expect(card(page)).not.toHaveAttribute('data-live')
    await expect(page.locator('[data-run]')).toHaveCount(0)
    await card(page).click()
    await sheet.getByRole('tab', { name: /Activity/ }).click()
    await expect(sheet.locator('[data-facts]').first()).toContainText('sonnet-5-5')
    await shot(page, '8-sheet-done')
  } finally {
    run.stop()
  }
})

test('a ticket in a working stage that no run works says so', async ({ page, fixture }) => {
  execFileSync(process.execPath, ['.factory/cli.mjs', 'advance', TICKET, 'plan'], { cwd: fixture.repo })
  await view(page, 'Board')
  await expect(card(page)).toHaveAttribute('data-live', 'stalled')
  await expect(card(page)).toContainText('Not running')
  await expect(page.locator('[data-run="off"]')).toContainText('1 ticket waits')
  await card(page).click()
  await expect(page.getByRole('dialog').locator('[data-now="stalled"]')).toContainText('No run is working this ticket')
  await shot(page, '9-stalled')
})

test('a Codex stage is followed too: its log is plain text', async ({ page, fixture }) => {
  execFileSync(process.execPath, ['.factory/cli.mjs', 'advance', TICKET, 'plan'], { cwd: fixture.repo })
  const round = path.join(fixture.repo, '.factory/jobs', TICKET, 'round-0')
  fs.mkdirSync(round, { recursive: true })
  // as `codex exec` prints it (0.167), under the header the factory's CLI writes
  fs.writeFileSync(
    path.join(round, 'plan.log'),
    [
      `[factory] ${new Date().toISOString()} codex exec --color never -s read-only -`,
      `[factory] cwd: ${fixture.repo}`,
      '',
      'OpenAI Codex v0.167.2',
      '--------',
      `workdir: ${fixture.repo}`,
      'model: gpt-6.1-sol',
      'reasoning effort: medium',
      '--------',
      'user',
      'FACTORY ROLE: planner',
      'exec',
      'this line of the prompt is not a command',
      '',
      'hook: UserPromptSubmit',
      'codex',
      'I will read the ticket first.',
      '',
      'hook: PreToolUse',
      'exec',
      `/usr/bin/bash -lc 'cat ticket.md' in ${fixture.repo}`,
      ' succeeded in 0ms:',
      'Keep the cart in localStorage.',
      '',
    ].join('\n')
  )
  await view(page, 'Board')
  await card(page).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('[data-now]')).toContainText('gpt-6.1-sol')
  await sheet.getByRole('tab', { name: 'Live' }).click()
  await expect(sheet.locator('[data-feed] li')).toHaveText([/I will read the ticket first\./, /Running cat ticket\.md/])
})

test('two tickets worked at once grow side by side in the history', async ({ page, fixture }) => {
  execFileSync(process.execPath, ['.factory/cli.mjs', 'new', 'Offer free shipping over 50 euros'], { cwd: fixture.repo, input: 'Orders over 50 euros ship free.' })
  const run: Run = startRun(fixture.repo, { pace: 60, hold: ['builder'] })
  try {
    await view(page, 'History')
    const wips = page.locator('[data-wip-live="running"]')
    // each has its own worktree, with work in it that is not committed yet
    await expect(wips).toHaveCount(2)
    await expect(wips.nth(0)).toContainText('1 file')
    await expect(wips.nth(1)).toContainText('1 file')
    await expect(page.getByRole('complementary', { name: 'Worktrees' }).getByRole('button')).toHaveCount(4)
    await shot(page, '10-history-two-at-once')
    await view(page, 'Board')
    await expect(page.locator('[data-run="on"]')).toContainText('2 tickets being worked')
    await expect(page.locator('[data-live="running"]')).toHaveCount(2)
    await shot(page, '11-board-two-at-once')
    // the commits arrive while the history is open
    await view(page, 'History')
    run.release('builder')
    await expect(page.locator('[data-commit]').filter({ hasText: 'Add the offer-free-shipping-over module' })).toBeVisible()
    await expect(page.locator('[data-commit]').filter({ hasText: 'Add the remember-the-cart-between module' })).toBeVisible()
    await shot(page, '12-history-two-committed')
  } finally {
    run.stop()
  }
})

test('Run starts the factory from the board, and Pause stops it where it is', async ({ page, fixture }) => {
  hold(fixture.repo, ['planner'])
  await view(page, 'Board')
  const board = page.getByRole('main')
  await board.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(card(page)).toHaveAttribute('data-live', 'running')
  await expect(page.locator('[data-run="on"]')).toBeVisible()
  await shot(page, '13-run-started')

  // paused: the ticket stays in its stage, and says that nothing works it now
  await board.getByRole('button', { name: 'Pause' }).click()
  await expect(card(page)).toHaveAttribute('data-live', 'stalled')
  await expect(page.locator('[data-run="off"]')).toContainText('1 ticket waits')
  await shot(page, '14-paused')

  // and Run takes it up again, to the end
  release(fixture.repo, 'planner')
  await board.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(card(page)).toContainText('Journal entry', { timeout: 30_000 })
  await expect(page.locator('[data-run]')).toHaveCount(0)
  await expect(board.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0)
})

test('a ticket is deleted for good, after a confirmation, and the journal keeps why', async ({ page, fixture }) => {
  const done = '001-show-the-vat-amount'
  await view(page, 'Board')
  await page.locator(`[data-ticket="${done}"]`).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Delete', exact: true }).click()
  const form = sheet.locator('[data-delete]')
  await expect(form).toContainText('its worktree and its branch factory/001-show-the-vat-amount are removed')
  // the ticket is done but nobody merged it: deleting it loses its commits, and the form says how many
  await expect(form).toContainText('Its work is not merged into main and will be lost: 2 commits')
  // nothing happens without a reason
  await expect(form.getByRole('button', { name: 'Delete for good' })).toBeDisabled()
  await shot(page, '15-delete-confirm')
  // changing one's mind deletes nothing
  await form.getByRole('button', { name: 'Keep it' }).click()
  await expect(form).toHaveCount(0)
  expect(fs.existsSync(path.join(fixture.repo, '.factory/jobs', done))).toBe(true)

  await sheet.getByRole('button', { name: 'Delete', exact: true }).click()
  await form.getByLabel('Why is it deleted?').fill('Shipped another way')
  await form.getByRole('button', { name: 'Delete for good' }).click()
  await expect(page.locator(`[data-ticket="${done}"]`)).toHaveCount(0)
  await expect(sheet).toHaveCount(0)
  expect(fs.existsSync(path.join(fixture.repo, '.factory/jobs', done))).toBe(false)
  expect(fs.existsSync(path.join(fixture.repo, '.factory/worktrees', done))).toBe(false)
  expect(execFileSync('git', ['branch', '--list', `factory/${done}`], { cwd: fixture.repo, encoding: 'utf8' })).toBe('')

  await view(page, 'Journal')
  await page.getByText('Deleted ticket 001: Show the VAT amount on the receipt').first().click()
  await expect(page.getByText('Shipped another way').first()).toBeVisible()
  await shot(page, '16-journal-deleted')
})

test('a finished ticket lands in the base branch from its sheet', async ({ page, fixture }) => {
  await view(page, 'Board')
  await page.getByRole('main').getByRole('button', { name: 'Run', exact: true }).click()
  await expect(card(page)).toContainText('Journal entry', { timeout: 30_000 })
  await card(page).click()
  const sheet = page.getByRole('dialog')
  await shot(page, '17-land-button')
  await sheet.getByRole('button', { name: 'Land in main' }).click()
  await expect(sheet.locator('[data-landed="yes"]')).toContainText(/Landed in main \([0-9a-f]{7}\)/)
  await expect(sheet).toContainText(/Landed in main at [0-9a-f]{7}/)
  await expect(sheet.getByRole('button', { name: 'Land in main' })).toHaveCount(0)
  await shot(page, '18-landed')
  await page.keyboard.press('Escape')
  await expect(card(page).locator('[data-landed]')).toHaveText('Landed in main')
  // its work is in main, and its branch and worktree are gone
  expect(execFileSync('git', ['log', '--format=%s', 'main'], { cwd: fixture.repo, encoding: 'utf8' })).toContain('Add the remember-the-cart-between module')
  expect(execFileSync('git', ['branch', '--list', `factory/${TICKET}`], { cwd: fixture.repo, encoding: 'utf8' })).toBe('')
  expect(fs.existsSync(path.join(fixture.repo, '.factory/worktrees', TICKET))).toBe(false)
  await view(page, 'History')
  await expect(page.locator('[data-commit]').filter({ hasText: 'Journal: Remember the cart between visits' })).toContainText('main')
  await shot(page, '19-history-landed')
})

test('a ticket that conflicts with the base branch goes back to the builder, and says why', async ({ page }) => {
  // the fixture's finished ticket wrote a file that main has since written too
  const done = '001-show-the-vat-amount'
  await view(page, 'Board')
  const ticket = page.locator(`[data-ticket="${done}"]`)
  await ticket.click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Land in main' }).click()
  await expect(sheet.locator('[data-landed="no"]')).toContainText('1 file conflicts with main')
  // it is a ticket in the build stage again, with the conflict written down for the builder
  await expect(sheet).toContainText('round 2/3')
  await sheet.getByRole('tab', { name: /Files/ }).click()
  await sheet.getByRole('button', { name: 'feedback-1.md' }).click()
  await expect(sheet).toContainText('Conflicts with main')
  await page.keyboard.press('Escape')
  await expect(ticket).toContainText('Not running')
})
