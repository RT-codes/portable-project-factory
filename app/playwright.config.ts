import { defineConfig } from '@playwright/test'

// End-to-end tests of the desktop app (e2e/). They drive the built app, so `npm test` builds it first.
// Each test opens the app on a project of its own (e2e/fixture.mjs) with a stand-in for `gh` (e2e/fake-gh.mjs):
// nothing reaches the real GitHub.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
})
