import { _electron as electron } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from './launch'

// `factory-app --quit` (what the factory's CLI runs on `stop`): the running app quits; with none running, it
// exits at once without a window.
const electronPath = createRequire(import.meta.url)('electron') as string
const headless = process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox'] : []
const main = path.resolve('dist-electron/main.cjs')

/** Run the app with --quit and resolve with its exit code. */
function quit(env: Record<string, string>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [...headless, main, '--quit'], { env: { ...process.env, ...env }, stdio: 'ignore' })
    const timer = setTimeout(() => (child.kill(), reject(new Error('--quit did not exit'))), 15_000)
    child.on('exit', (code) => (clearTimeout(timer), resolve(code)))
  })
}

test('a second launch with --quit closes the running app', async ({ fixture }) => {
  const env = (fixture as unknown as { env: Record<string, string> }).env
  const app = await electron.launch({ args: [...headless, main, fixture.repo], env: { ...process.env, ...env } as Record<string, string> })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  const running = app.process()
  const closed = new Promise<number | null>((resolve) => running.once('exit', (code) => resolve(code)))
  expect(await quit(env)).toBe(0)
  expect(await closed).toBe(0)
})

test('--quit with nothing running exits at once, without a window', async ({ fixture }) => {
  const env = (fixture as unknown as { env: Record<string, string> }).env
  const started = Date.now()
  expect(await quit(env)).toBe(0)
  expect(Date.now() - started).toBeLessThan(10_000)
})
