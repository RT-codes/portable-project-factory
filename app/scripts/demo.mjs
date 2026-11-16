// The desktop app on a made-up project with a made-up GitHub (e2e/fixture.mjs, e2e/fake-gh.mjs): every view has
// something in it, and nothing you click reaches the real GitHub.
//   npm run demo
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFixture } from '../e2e/fixture.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-demo-'))
const fixture = createFixture(dir)
const electron = (await import('electron')).default
const child = spawn(electron, ['.', fixture.repo], { stdio: 'inherit', env: { ...process.env, ...fixture.env } })
child.on('exit', (code) => {
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
