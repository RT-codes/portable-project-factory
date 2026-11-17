#!/usr/bin/env node
// A stand-in for `claude` that takes its time, for the demo and the end-to-end tests: FACTORY_RUNNER points the
// factory's CLI at this file, which gets the arguments the real `claude` would get and the stage's prompt on stdin.
// It does what a stage agent does, at a pace a person can watch, and reports it the way Claude Code does
// (`--output-format stream-json`): it reads files, writes real files in the ticket's worktree, makes real commits,
// and ends with the stage's final message. So a run with it is a real run of the factory: its own run file, logs,
// worktrees and commits, with nothing asked of a model.
//
//   SLOW_PACE   milliseconds between steps (default 1200)
//   SLOW_HOLD   a folder: while it holds a file named after the role ("builder"), that role waits halfway through
//               its work, so a test can look at a stage that is going on for as long as it needs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const prompt = fs.readFileSync(0, 'utf8')
const role = (prompt.match(/^FACTORY ROLE: (\w+)/) || [])[1] || 'unknown'
const jobDir = (prompt.match(/Ticket folder: (.+?)[\\/]\. Main checkout:/) || [])[1] || process.cwd()
const base = (prompt.match(/Base branch: (\S+?)\. /) || [])[1] || 'main'
const pace = Number(process.env.SLOW_PACE ?? 1200)
const cwd = process.cwd()
const name = path.basename(jobDir).replace(/^\d+-/, '') || 'change'
const title = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8')).title
  } catch {
    return name
  }
})()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const emit = (ev) => console.log(JSON.stringify(ev))
let turn = 0
let read = 4200

/** One message of the agent, as Claude Code prints it: its content, and what the turn took. */
async function message(content) {
  turn++
  read += 900
  emit({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { id: `msg_${role}_${turn}`, role: 'assistant', content, usage: { input_tokens: 4, cache_read_input_tokens: read, cache_creation_input_tokens: 600, output_tokens: 180 } },
  })
  await sleep(pace)
}
const tool = (toolName, input) => message([{ type: 'tool_use', id: `toolu_${turn}`, name: toolName, input }])
const say = (text) => message([{ type: 'text', text }])

async function hold() {
  const file = process.env.SLOW_HOLD && path.join(process.env.SLOW_HOLD, role)
  while (file && fs.existsSync(file)) await sleep(40)
}

const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
function write(rel, text) {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true })
  fs.writeFileSync(path.join(cwd, rel), text)
}
const source = fs.existsSync(path.join(cwd, 'src/cart.ts')) ? 'src/cart.ts' : 'README.md'

emit({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', cwd })
await sleep(pace)

let final = 'READY'
if (role === 'planner') {
  await tool('Read', { file_path: path.join(jobDir, 'ticket.md') })
  await tool('Glob', { pattern: 'src/**/*.ts' })
  await hold()
  await tool('Read', { file_path: path.join(cwd, source) })
  await tool('Grep', { pattern: 'export function', path: path.join(cwd, 'src') })
  await say('The change fits in a module of its own, with one call from the cart.')
  final = `READY\n\n## Plan\n\n1. Add \`src/${name}.ts\` with the new behaviour.\n2. Call it from \`${source}\`.\n3. Cover it with a test.\n`
} else if (role === 'builder') {
  await tool('Read', { file_path: path.join(jobDir, 'plan.md') })
  await tool('Read', { file_path: path.join(cwd, source) })
  await say('I will start with the module, then wire it in.')
  await tool('Write', { file_path: path.join(cwd, `src/${name}.ts`) })
  write(`src/${name}.ts`, `// ${title}\nexport const KEY = '${name}'\n\nexport function load(): string | null {\n  return globalThis.localStorage?.getItem(KEY) ?? null\n}\n\nexport function save(value: string): void {\n  globalThis.localStorage?.setItem(KEY, value)\n}\n`)
  await sleep(pace)
  await hold()
  await tool('Bash', { command: 'npm test', description: 'Run the tests' })
  await tool('Bash', { command: `git add -A && git commit -m "Add the ${name} module"`, description: 'Commit the module' })
  git('add', '-A')
  git('commit', '-q', '-m', `Add the ${name} module`)
  await sleep(pace)
  await tool('Edit', { file_path: path.join(cwd, source) })
  fs.appendFileSync(path.join(cwd, source), `\n// ${title}: see src/${name}.ts\n`)
  await tool('Write', { file_path: path.join(cwd, `tests/${name}.test.ts`) })
  write(`tests/${name}.test.ts`, `import { expect, test } from 'vitest'\nimport { KEY } from '../src/${name}'\n\ntest('has a key', () => {\n  expect(KEY).toBe('${name}')\n})\n`)
  await sleep(pace)
  await tool('Bash', { command: 'npm test', description: 'Run the tests again' })
  await tool('Bash', { command: `git add -A && git commit -m "${title}"`, description: 'Commit the change' })
  git('add', '-A')
  git('commit', '-q', '-m', title)
  final = `READY\n\n## Summary\n\n- Added \`src/${name}.ts\` and a test for it.\n- \`${source}\` points at it.\n\n## Changes\n\n- \`src/${name}.ts\`: the new module.\n- \`tests/${name}.test.ts\`: its test.\n`
} else {
  await tool('Bash', { command: `git diff ${base}...HEAD`, description: 'Read the diff' })
  await tool('Read', { file_path: path.join(jobDir, 'plan.md') })
  await hold()
  await tool('Read', { file_path: path.join(cwd, `src/${name}.ts`) })
  await say('The diff does what the plan says, and nothing else.')
  final = `PASS\n\n## Summary\n- The diff does what the plan says.\n\n=== JOURNAL ===\ntitle: ${title}\nkind: feature\ntags: demo\n\n## What changed\n${title}: a module of its own, and a test.\n\n## Why\nThe ticket asked for it.\n\n## Decisions\n- A module of its own, so the cart stays small.\n`
}

emit({ type: 'result', subtype: 'success', is_error: false, result: final, num_turns: turn, total_cost_usd: 0.042, usage: { input_tokens: 4 * turn, cache_read_input_tokens: read * turn, cache_creation_input_tokens: 600 * turn, output_tokens: 180 * turn } })
