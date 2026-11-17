import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error -- a plain script, shared with `npm run demo`
import { agentEnv, createFixture } from './fixture.mjs'

export interface Fixture {
  repo: string
  headSha: string
  baseSha: string
  /** the commit on the finished ticket's branch (null without a factory) */
  vatSha: string | null
  /** what the app sent to (the stand-in for) GitHub, in order: the gh arguments and the JSON body */
  calls(): { args: string[]; input: unknown }[]
  /** what the app handed to the system to open: "open <file>" and "reveal <file>" */
  opened(): string[]
}

interface Options {
  /** install the factory into the project (default true) */
  factory: boolean
  /** give the project weeks of finished tickets with what their agent runs took, for the Usage view (default false) */
  usage: boolean
  /** 'fake' answers like GitHub would; 'missing' is a machine without the gh CLI */
  gh: 'fake' | 'missing'
  /** start with the project open (default true); false is a first run */
  open: boolean
}

/** A test gets the app open on a fresh project, and that project. */
export const test = base.extend<Options & { fixture: Fixture; electronApp: ElectronApplication; page: Page }>({
  factory: [true, { option: true }],
  usage: [false, { option: true }],
  gh: ['fake', { option: true }],
  open: [true, { option: true }],

  fixture: async ({ factory, usage }, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-app-'))
    const f = createFixture(dir, { factory, usage })
    await use({
      repo: f.repo,
      headSha: f.headSha,
      baseSha: f.baseSha,
      vatSha: f.vatSha,
      calls: () =>
        fs
          .readFileSync(f.calls, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l)),
      opened: () => (fs.existsSync(path.join(dir, 'opened.log')) ? fs.readFileSync(path.join(dir, 'opened.log'), 'utf8').split('\n').filter(Boolean) : []),
      // @ts-expect-error -- for the launcher below, not for tests
      // nothing a test deletes goes to the real trash, and nothing it opens starts a real editor
      // FACTORY_APP_HOME: where the app looks for the agent CLIs' own settings (never this machine's real ones)
      // a run started from the app uses the slow stand-in for an agent, never a real one
      env: { ...f.env, ...agentEnv(f.repo, 60), FACTORY_APP_NO_TRASH: '1', FACTORY_APP_OPEN_LOG: path.join(dir, 'opened.log'), FACTORY_APP_HOME: path.join(dir, 'home') },
    })
    fs.rmSync(dir, { recursive: true, force: true })
  },

  electronApp: async ({ fixture, gh, open }, use) => {
    const env = { ...(fixture as unknown as { env: Record<string, string> }).env }
    if (gh === 'missing') env.FACTORY_APP_GH = path.join(fixture.repo, 'no-such-gh')
    const app = await electron.launch({
      // no window on screen: the app draws offscreen, so the tests run the same on a desktop and in CI
      args: [...(process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox'] : []), path.resolve('dist-electron/main.cjs'), ...(open ? [fixture.repo] : [])],
      env: { ...process.env, ...env } as Record<string, string>,
    })
    await use(app)
    await app.close()
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(e.message))
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    await page.locator('nav, main').first().waitFor()
    await use(page)
    // a test that passes with errors in the console has not passed
    if (problems.length) throw new Error(`console errors:\n${problems.join('\n')}`)
  },
})

export { expect } from '@playwright/test'

export const view = (page: Page, name: string) => page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name }).click()

/** Call the main process the way the page does, through its bridge (electron/preload.ts): as a script on the page could. */
export function bridge(page: Page) {
  type Bridge = { factoryApp: { invoke(method: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown; error?: string }> } }
  return (method: string, args: unknown[]) => page.evaluate(([m, a]) => (globalThis as unknown as Bridge).factoryApp.invoke(m as string, a as unknown[]), [method, args] as const)
}
