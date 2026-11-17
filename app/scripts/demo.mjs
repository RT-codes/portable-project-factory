// The desktop app on a made-up project with a made-up GitHub (e2e/fixture.mjs, e2e/fake-gh.mjs): every view has
// something in it, and nothing you click reaches the real GitHub.
//   npm run demo
//
// Press Run on the board: a real run of the project's factory starts on two tickets at once, with a slow stand-in
// for the agent (e2e/slow-agent.mjs). The board, a ticket's sheet and History show it as it happens; Pause stops it.
//   DEMO_PACE=600 npm run demo     milliseconds per step of the stand-in (default 2500)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { agentEnv, createFixture } from '../e2e/fixture.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-demo-'))
const fixture = createFixture(dir, { usage: true })
const electron = (await import('electron')).default
// a second ticket in the inbox, so two worktrees grow side by side
execFileSync(process.execPath, ['.factory/cli.mjs', 'new', 'Offer free shipping over 50 euros'], { cwd: fixture.repo, input: 'Orders over 50 euros ship free.' })
// the app must not think it runs inside an agent's session, wherever the demo is started from
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX|FACTORY_)/.test(k)))
const child = spawn(electron, ['.', fixture.repo], { stdio: 'inherit', env: { ...clean, ...fixture.env, ...agentEnv(fixture.repo, Number(process.env.DEMO_PACE ?? 2500)) } })
child.on('exit', (code) => {
  // a run started from the app outlives it: not this one
  try {
    execFileSync(process.execPath, ['.factory/cli.mjs', 'cancel'], { cwd: fixture.repo, stdio: 'ignore' })
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
