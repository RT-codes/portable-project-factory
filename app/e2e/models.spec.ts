import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { bridge, expect, test, view } from './launch'

const agentName = { claude: 'Claude Code', codex: 'Codex' } as const
type Agent = keyof typeof agentName
/** The dropdown of a role's model or effort on one agent. */
const field = (page: Page, what: 'Model' | 'Effort', name: string, agent: Agent) => page.getByRole('combobox', { name: new RegExp(`^${what} of the ${name} on ${agentName[agent]}:`) })
const settingsOf = (page: Page, name: string, agent: Agent) => page.locator(`[data-settings="${name}:${agent}"]`)

/** Open a dropdown by clicking the field (anywhere on it) and pick an option by its name. */
async function choose(page: Page, dropdown: ReturnType<typeof field>, option: string | RegExp) {
  await dropdown.click()
  await page.getByRole('option', { name: option }).click()
}

async function open(page: Page) {
  await view(page, 'Home')
  await page.getByRole('region', { name: 'Change how agents work here' }).getByRole('button', { name: /^Models and effort/ }).click()
  await expect(page.getByRole('heading', { name: 'Models and effort' })).toBeVisible()
}

/** Whatever git sees in the repo: a setting saved here must not show up in it. */
const status = (repo: string) => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' })
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * The model lists the two agent CLIs keep in the user's home, as they look on a real machine, in the made-up
 * home the app is pointed at (FACTORY_APP_HOME in launch.ts). The app reads these; it never asks the network.
 */
function agentHome(repo: string) {
  const home = path.join(repo, '..', 'home')
  const model = (id: string, name: string) => ({ id, name, description: `${name} for testing`, runtime: { effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] } })
  fs.mkdirSync(path.join(home, '.claude/cache/model-catalog'), { recursive: true })
  fs.writeFileSync(
    path.join(home, '.claude/cache/model-catalog/abc-cc.json'),
    JSON.stringify({
      version: 2,
      catalog: {
        surface: 'cc',
        config: {
          models: [model('claude-opus-5-5', 'Opus 5.5'), model('claude-fable-5-2', 'Fable 5.2'), model('claude-sonnet-5-5', 'Sonnet 5.5'), model('claude-haiku-5-5', 'Haiku 5.5'), model('claude-opus-4-7', 'Opus 4.7')],
          provider_alias_targets: { fable: { default: 'claude-fable-5-2' }, haiku: { default: 'claude-haiku-5-5' }, opus: { default: 'claude-opus-5-5' }, sonnet: { default: 'claude-sonnet-5-5' } },
        },
        state: { model: 'claude-fable-5-2', thinking: { type: 'effort', effort: 'medium' } },
      },
    })
  )
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex/config.toml'), 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n\n[profiles.x]\nmodel = "other"\n')
  const codex = (slug: string, display_name: string, visibility = 'list') => ({ slug, display_name, description: `${display_name} for testing`, visibility, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'ultra' }] })
  fs.writeFileSync(path.join(home, '.codex/models_cache.json'), JSON.stringify({ models: [codex('gpt-6.1-sol', 'GPT-6.1-Sol'), codex('gpt-6-luna', 'GPT-6-Luna'), codex('codex-auto-review', 'Codex Auto Review', 'hide')] }))
}

test('lists the models of each agent with their versions, in a dropdown', async ({ page, fixture }) => {
  agentHome(fixture.repo)
  await open(page)
  // what "default" means on this machine, readable at a glance
  await expect(page.locator('[data-default="claude"]')).toContainText('Fable 5.2')
  await expect(page.locator('[data-default="claude"]')).toContainText('claude-fable-5-2')
  await expect(page.locator('[data-default="codex"]')).toContainText('GPT-6.1-Sol')
  await expect(page.locator('[data-default="codex"]')).toContainText('effort medium')

  // the whole field is the dropdown, and its arrow is always there
  const model = field(page, 'Model', 'planner', 'claude')
  await expect(model).toContainText('Default (Fable 5.2)')
  await expect(model.locator('svg')).toBeVisible()
  await model.click({ position: { x: 20, y: 10 } })
  const list = page.getByRole('listbox')
  // names with versions, the short name's meaning spelled out, and an older model by its own id
  await expect(list.getByRole('option', { name: /^Sonnet 5\.5/ })).toContainText('claude-sonnet-5-5')
  await expect(list.getByRole('option', { name: /^Sonnet 5\.5/ })).toContainText('always the newest Sonnet')
  await expect(list.getByRole('option', { name: /^Opus 5\.5/ })).toBeVisible()
  await expect(list.getByRole('option', { name: /^Opus 4\.7/ })).toContainText('claude-opus-4-7')
  await expect(list.getByRole('option', { name: /GPT/ })).toHaveCount(0)
  // it works from the keyboard, and Escape closes it without choosing
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(model).toContainText('Default (Fable 5.2)')

  // Codex has its own models; the ones it marks as not for picking are left out
  await field(page, 'Model', 'planner', 'codex').click()
  await expect(list.getByRole('option', { name: /^GPT-6-Luna/ })).toContainText('gpt-6-luna')
  await expect(list.getByRole('option', { name: /Auto Review/ })).toHaveCount(0)
  await expect(list.getByRole('option', { name: /Sonnet/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // and its own effort levels
  await field(page, 'Effort', 'planner', 'codex').click()
  await expect(list.getByRole('option', { name: 'Ultra' })).toBeVisible()
  await expect(list.getByRole('option', { name: 'Xhigh' })).toHaveCount(0)
})

test('still works when an agent keeps no model list', async ({ page }) => {
  // an empty home: nothing to read
  await open(page)
  await expect(page.locator('[data-default="claude"]')).toContainText('Chosen by Claude Code')
  await field(page, 'Model', 'builder', 'claude').click()
  // the names that always work
  for (const name of ['Default', 'Sonnet', 'Opus', 'Haiku']) await expect(page.getByRole('listbox').getByRole('option', { name: new RegExp(`^${name}`) })).toBeVisible()
  await page.keyboard.press('Escape')
  await field(page, 'Model', 'builder', 'codex').click()
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1)
})

test("shows the team's defaults next to each field", async ({ page, fixture }) => {
  agentHome(fixture.repo)
  const file = path.join(fixture.repo, '.factory/config.json')
  const config = read(file)
  // for any agent, and a part for one agent
  fs.writeFileSync(file, JSON.stringify({ ...config, roles: { ...config.roles, builder: { effort: 'high', claude: { model: 'opus' }, codex: { model: 'gpt-6-luna' } } } }, null, 2))
  await open(page)
  await expect(page.getByText('Yours only: saved in .factory/local.json, which git ignores')).toBeVisible()
  await expect(settingsOf(page, 'builder', 'claude')).toContainText('Team default: Opus 5.5')
  await expect(settingsOf(page, 'builder', 'claude')).toContainText('Team default: High')
  await expect(field(page, 'Model', 'builder', 'claude')).toContainText('Opus 5.5')
  await expect(settingsOf(page, 'builder', 'codex')).toContainText('Team default: GPT-6-Luna')
  await expect(field(page, 'Effort', 'builder', 'codex')).toContainText('High')
  await expect(settingsOf(page, 'planner', 'claude')).toContainText('Team default: Default (Fable 5.2)')
  // nothing is overridden yet
  await expect(page.getByRole('button', { name: 'Use the team default' })).toHaveCount(0)
})

test('saves my choices to .factory/local.json, per agent, and nothing else', async ({ page, fixture }) => {
  agentHome(fixture.repo)
  const local = path.join(fixture.repo, '.factory/local.json')
  const config = fs.readFileSync(path.join(fixture.repo, '.factory/config.json'), 'utf8')
  const before = status(fixture.repo)
  await open(page)

  await choose(page, field(page, 'Model', 'planner', 'claude'), /^Sonnet 5\.5/)
  // the short name is what is saved: it keeps meaning the newest Sonnet
  await expect.poll(() => fs.existsSync(local) && read(local)).toEqual({ roles: { planner: { claude: { model: 'sonnet' } } } })
  await expect(field(page, 'Model', 'planner', 'claude')).toContainText('Sonnet 5.5')
  await choose(page, field(page, 'Model', 'planner', 'codex'), /^GPT-6-Luna/)
  await choose(page, field(page, 'Effort', 'reviewer', 'claude'), 'Low')
  await page.getByRole('group', { name: 'Agent' }).getByRole('button', { name: 'Codex' }).click()
  await expect.poll(() => read(local)).toEqual({ agent: 'codex', roles: { planner: { claude: { model: 'sonnet' }, codex: { model: 'gpt-6-luna' } }, reviewer: { claude: { effort: 'low' } } } })
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // the team's file is as it was, and git sees nothing new: local.json is ignored
  expect(fs.readFileSync(path.join(fixture.repo, '.factory/config.json'), 'utf8')).toBe(config)
  expect(status(fixture.repo)).toBe(before)
  execFileSync('git', ['check-ignore', '-q', '.factory/local.json'], { cwd: fixture.repo })

  // it is read back when the view opens again
  await view(page, 'Home')
  await open(page)
  await expect(field(page, 'Model', 'planner', 'claude')).toContainText('Sonnet 5.5')
  await expect(field(page, 'Model', 'planner', 'codex')).toContainText('GPT-6-Luna')
  await expect(settingsOf(page, 'planner', 'claude')).toContainText('yours')
  // the other agent's settings of that role are not touched
  await expect(settingsOf(page, 'reviewer', 'codex')).not.toContainText('yours')
})

test('takes a model typed by hand, for one that is not in the list', async ({ page, fixture }) => {
  agentHome(fixture.repo)
  const local = path.join(fixture.repo, '.factory/local.json')
  await open(page)
  await page.getByRole('button', { name: 'Type a model for the builder on Claude Code' }).click()
  const input = page.getByLabel('Custom model of the builder on Claude Code')
  await expect(input).toBeFocused()
  await input.fill('claude-opus-4-5[1m]')
  await input.press('Enter')
  await expect.poll(() => fs.existsSync(local) && read(local)).toEqual({ roles: { builder: { claude: { model: 'claude-opus-4-5[1m]' } } } })
  // shown as what it is: not one of the list's
  await expect(field(page, 'Model', 'builder', 'claude')).toContainText('claude-opus-4-5[1m]')
  await expect(field(page, 'Model', 'builder', 'claude')).toContainText('custom')

  // Escape, or the cross, goes back to the list without changing anything
  await page.getByRole('button', { name: 'Type a model for the builder on Claude Code' }).click()
  await expect(input).toHaveValue('claude-opus-4-5[1m]')
  await input.fill('something-else')
  await input.press('Escape')
  await page.getByRole('button', { name: 'Type a model for the builder on Codex' }).click()
  await page.getByLabel('Custom model of the builder on Codex').fill('nope')
  await page.getByRole('button', { name: 'Back to the list' }).click()
  expect(read(local)).toEqual({ roles: { builder: { claude: { model: 'claude-opus-4-5[1m]' } } } })
  // a name that is not a model name is refused, and says so
  await page.getByRole('button', { name: 'Type a model for the builder on Codex' }).click()
  await page.getByLabel('Custom model of the builder on Codex').fill('two words')
  await page.getByRole('button', { name: 'Use this model' }).click()
  await expect(page.getByRole('alert')).toContainText('model name')
  expect(read(local)).toEqual({ roles: { builder: { claude: { model: 'claude-opus-4-5[1m]' } } } })
})

test('goes back to the team default, one field at a time', async ({ page, fixture }) => {
  agentHome(fixture.repo)
  const local = path.join(fixture.repo, '.factory/local.json')
  // per agent as the app saves it, and one hand-written setting for any agent (the builder's)
  fs.writeFileSync(local, JSON.stringify({ agent: 'claude', roles: { planner: { claude: { model: 'opus', effort: 'high' }, codex: { model: 'gpt-6-luna' } }, builder: { model: 'haiku' } } }))
  await open(page)
  await expect(field(page, 'Model', 'planner', 'claude')).toContainText('Opus 5.5')
  await expect(field(page, 'Effort', 'planner', 'claude')).toContainText('High')
  await expect(field(page, 'Model', 'builder', 'claude')).toContainText('Haiku 5.5')

  // the planner's model on Claude Code: back to the team's; its effort, and Codex's model, stay mine
  await settingsOf(page, 'planner', 'claude').getByRole('button', { name: 'Use the team default' }).first().click()
  await expect.poll(() => read(local)).toEqual({ agent: 'claude', roles: { planner: { claude: { effort: 'high' }, codex: { model: 'gpt-6-luna' } }, builder: { model: 'haiku' } } })
  await expect(field(page, 'Model', 'planner', 'claude')).toContainText('Default (Fable 5.2)')
  // choosing Default in the list is a choice of mine too, and can be taken back like any other
  await settingsOf(page, 'builder', 'claude').getByRole('button', { name: 'Use the team default' }).click()
  await expect.poll(() => read(local)).toEqual({ agent: 'claude', roles: { planner: { claude: { effort: 'high' }, codex: { model: 'gpt-6-luna' } } } })
  // and the agent: Auto is no override at all
  await page.getByRole('region', { name: 'Agent' }).getByRole('button', { name: 'Use the team default' }).click()
  await settingsOf(page, 'planner', 'claude').getByRole('button', { name: 'Use the team default' }).click()
  await settingsOf(page, 'planner', 'codex').getByRole('button', { name: 'Use the team default' }).click()
  await expect.poll(() => read(local)).toEqual({})
})

test('takes only settings of the right shape, and writes only local.json', async ({ page, fixture }) => {
  const call = bridge(page)
  const repo = fixture.repo
  const local = path.join(repo, '.factory/local.json')
  const bad: unknown[] = [
    null,
    'claude',
    [],
    { agent: 'gpt' },
    { agent: 1 },
    { extra: true },
    { roles: [] },
    { roles: { hacker: { model: 'opus' } } },
    { roles: { planner: 'opus' } },
    { roles: { planner: { model: 'x'.repeat(101) } } },
    { roles: { planner: { model: 'opus sonnet' } } },
    { roles: { planner: { model: '../../etc/passwd' } } },
    { roles: { planner: { model: '' } } },
    { roles: { planner: { model: 7 } } },
    { roles: { planner: { effort: 'MAX!' } } },
    { roles: { planner: { claude: 'opus' } } },
    { roles: { planner: { claude: { model: 'opus', other: 1 } } } },
    { roles: { planner: { gemini: { model: 'pro' } } } },
    { roles: { planner: { codex: { model: 'a b' } } } },
    { roles: { planner: { model: 'opus', path: '/tmp/x' } } },
  ]
  for (const settings of bad) expect(await call('saveLocalSettings', [repo, settings]), JSON.stringify(settings)).toMatchObject({ ok: false })
  expect(fs.existsSync(local)).toBe(false)
  // only projects the user opened
  expect(await call('saveLocalSettings', [path.join(repo, '..'), {}])).toEqual({ ok: false, error: 'unknown project' })

  // the right shape is written, and read back
  const good = { agent: 'claude', roles: { reviewer: { model: 'claude-opus-4-5[1m]', effort: 'medium', codex: { model: 'gpt-6-luna', effort: 'ultra' } } } }
  expect(await call('saveLocalSettings', [repo, good])).toEqual({ ok: true, value: good })
  expect(JSON.parse(fs.readFileSync(local, 'utf8'))).toEqual(good)
  expect(await call('modelSettings', [repo])).toMatchObject({ ok: true, value: { local: good } })

  // never through a link
  const outside = path.join(repo, '..', 'outside.json')
  fs.writeFileSync(outside, '{}')
  fs.rmSync(local)
  fs.symlinkSync(outside, local)
  expect(await call('saveLocalSettings', [repo, good])).toMatchObject({ ok: false })
  expect(fs.readFileSync(outside, 'utf8')).toBe('{}')
})

test.describe('a repo without a factory', () => {
  test.use({ factory: false })

  test('keeps no settings where there is no factory', async ({ page, fixture }) => {
    expect(await bridge(page)('saveLocalSettings', [fixture.repo, {}])).toMatchObject({ ok: false })
    expect(fs.existsSync(path.join(fixture.repo, '.factory'))).toBe(false)
  })
})

test('shows the exact model each role last ran on', async ({ page, fixture }) => {
  agentHome(fixture.repo)
  // stages as the CLI records them after a real run: the name asked for was "default", this is what ran
  const jobs = path.join(fixture.repo, '.factory/jobs')
  const id = fs.readdirSync(jobs).find((d) => d.startsWith('001-'))!
  const file = path.join(jobs, id, 'job.json')
  const job = read(file)
  job.activity.push(
    { at: '2026-11-01T10:00:00Z', kind: 'agent', text: 'Plan (claude:claude-sonnet-5-5): READY', role: 'planner', agent: 'claude', model: 'claude-sonnet-5-5', turns: 9, cost_usd: 3.253, tokens: 2653984 },
    { at: new Date().toISOString(), kind: 'agent', text: 'Plan (claude:claude-sonnet-5-5): READY', role: 'planner', agent: 'claude', model: 'claude-sonnet-5-5', turns: 7, cost_usd: 0.056, tokens: 34336 },
    { at: new Date().toISOString(), kind: 'agent', text: 'Review (codex:gpt-6.1-sol): PASS', role: 'reviewer', agent: 'codex', model: 'gpt-6.1-sol', effort: 'medium', tokens: 8214 }
  )
  fs.writeFileSync(file, JSON.stringify(job, null, 2))

  await open(page)
  // the newest run of the role on that agent, with the version and what it took
  const planner = page.locator('[data-last-run="planner:claude"]')
  await expect(planner).toContainText('Last ran on claude-sonnet-5-5')
  await expect(planner).toContainText('7 turns · 34K tokens · $0.06 at API prices')
  await expect(page.locator('[data-last-run="planner:codex"]')).toContainText('Not run on Codex yet')
  // an agent that reports no price shows none
  const reviewer = page.locator('[data-last-run="reviewer:codex"]')
  await expect(reviewer).toContainText('Last ran on gpt-6.1-sol')
  await expect(reviewer).toContainText('effort medium · 8K tokens')
  await expect(reviewer).not.toContainText('API prices')
})
