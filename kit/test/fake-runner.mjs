#!/usr/bin/env node
// A stand-in for `claude` and `codex` in the tests: FACTORY_RUNNER points the CLI at this file, which gets the
// exact arguments the real agent CLI would get, and the prompt on stdin.
//
// FAKE_SCRIPT is a JSON file: { "<role>": [step, step, ...] }, one step per call (the last one repeats).
// A step is the final message as a string, or an object:
//   { "say": "<final message>", "write": { "<file in cwd>": "<content>" }, "commit": true, "exit": 1, "sleep": 100 }
// FAKE_STATE is a folder for the per-role call counters; FAKE_LOG gets one JSON line per call.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const prompt = fs.readFileSync(0, 'utf8')
const role = (prompt.match(/^FACTORY ROLE: (\w+)/) || [])[1] || 'unknown'
const args = process.argv.slice(2)
const agent = process.env.FACTORY_RUNNER_AGENT

if (process.env.FAKE_LOG) {
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ role, agent, args, cwd: process.cwd(), stage: process.env.FACTORY_STAGE, prompt }) + '\n')
}

const script = process.env.FAKE_SCRIPT ? JSON.parse(fs.readFileSync(process.env.FAKE_SCRIPT, 'utf8')) : {}
const counter = path.join(process.env.FAKE_STATE || '.', `${role}.count`)
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0
fs.writeFileSync(counter, String(n + 1))
const steps = script[role] || ['READY']
let step = steps[Math.min(n, steps.length - 1)]
if (typeof step === 'string') step = { say: step }

if (step.sleep) await new Promise((r) => setTimeout(r, step.sleep))
for (const [file, content] of Object.entries(step.write || {})) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, content)
}
if (step.commit) {
  execFileSync('git', ['add', '-A'])
  execFileSync('git', ['commit', '-q', '-m', `fake ${role} ${n + 1}`])
}
if (step.exit) {
  console.error(`fake ${role}: failing with ${step.exit}`)
  process.exit(step.exit)
}

const say = step.say ?? ''
if (agent === 'codex') {
  const i = args.indexOf('-o')
  console.log(`codex fake: working as ${role}`)
  fs.writeFileSync(args[i + 1], say)
} else {
  // as Claude Code reports them: the model it resolved to, and what the run took
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'fake-sonnet-1' }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: say, num_turns: 3, total_cost_usd: 0.0125, usage: { input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 60 } }))
}
