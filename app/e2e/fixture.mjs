// A project for the desktop app to open without touching the real GitHub: a git repo with history, a pull request
// that can really be fetched, uncommitted work, a factory with tickets, and the state fake-gh.mjs answers from.
//
//   node e2e/fixture.mjs <dir>     build it and print how to open the app on it (npm run demo does both)
//
// The end-to-end tests import createFixture().
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FACTORY_REPO = path.resolve(here, '..', '..')
const REMOTE_URL = 'https://github.com/acme/shop.git'

const base = {
  'README.md': `# Shop

A small storefront: a cart, prices, and a checkout.

## Develop

\`\`\`bash
npm install
npm test
\`\`\`
`,
  'package.json': JSON.stringify({ name: 'shop', private: true, type: 'module', scripts: { test: 'vitest run' } }, null, 2) + '\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, baseUrl: '.', paths: { '@/*': ['src/*'] } } }, null, 2) + '\n',
  'src/money.ts': `/** Amounts are integer cents: no floating point anywhere near money. */
export type Cents = number

export function format(cents: Cents, currency = 'EUR'): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100)
}

export function sum(amounts: Cents[]): Cents {
  return amounts.reduce((a, b) => a + b, 0)
}
`,
  'src/catalog.ts': `import type { Cents } from './money'

export interface Product {
  id: string
  name: string
  price: Cents
  category: 'book' | 'game' | 'music'
}

export const catalog: Product[] = [
  { id: 'b-1', name: 'The Pragmatic Programmer', price: 3999, category: 'book' },
  { id: 'g-1', name: 'Outer Wilds', price: 2499, category: 'game' },
  { id: 'm-1', name: 'Kind of Blue', price: 1299, category: 'music' },
]

export function find(id: string): Product | undefined {
  return catalog.find((p) => p.id === id)
}
`,
  'src/pricing.ts': `import { sum, type Cents } from './money'
import type { Product } from './catalog'

export interface Line {
  product: Product
  quantity: number
}

const VAT = 0.21

export function subtotal(lines: Line[]): Cents {
  return sum(lines.map((l) => l.product.price * l.quantity))
}

export function vat(lines: Line[]): Cents {
  return Math.round(subtotal(lines) * VAT)
}

export function total(lines: Line[]): Cents {
  return subtotal(lines) + vat(lines)
}
`,
  'src/cart.ts': `import { find } from './catalog'
import { total, type Line } from './pricing'

export class Cart {
  lines: Line[] = []

  add(id: string, quantity = 1): void {
    const product = find(id)
    if (!product) throw new Error(\`unknown product: \${id}\`)
    const line = this.lines.find((l) => l.product.id === id)
    if (line) line.quantity += quantity
    else this.lines.push({ product, quantity })
  }

  remove(id: string): void {
    this.lines = this.lines.filter((l) => l.product.id !== id)
  }

  get total() {
    return total(this.lines)
  }
}
`,
  'src/checkout.ts': `import { Cart } from './cart'
import { format } from '@/money'
import { charge } from './api/payments'

export async function checkout(cart: Cart, card: string): Promise<string> {
  if (cart.lines.length === 0) throw new Error('the cart is empty')
  const receipt = await charge(card, cart.total)
  return \`Paid \${format(cart.total)} (\${receipt})\`
}
`,
  'src/api/payments.ts': `import type { Cents } from '../money'

export async function charge(card: string, amount: Cents): Promise<string> {
  const res = await fetch('/api/charge', { method: 'POST', body: JSON.stringify({ card, amount }) })
  if (!res.ok) throw new Error('payment failed')
  return (await res.json()).receipt
}
`,
  'src/legacy/coupons.ts': `// The old coupon codes. Nothing reads these any more.
export const coupons: Record<string, number> = {
  WELCOME: 10,
  SPRING: 15,
}
`,
  'src/ui/CartView.svelte': `<script lang="ts">
	import { Cart } from '../cart'
	import { format } from '../money'

	let { cart }: { cart: Cart } = $props()
</script>

<ul>
	{#each cart.lines as line (line.product.id)}
		<li>{line.quantity} × {line.product.name}</li>
	{/each}
</ul>
<p>Total: {format(cart.total)}</p>
`,
  'src/ui/CheckoutButton.svelte': `<script lang="ts">
	import { checkout } from '../checkout'
	import type { Cart } from '../cart'

	let { cart }: { cart: Cart } = $props()
</script>

<button onclick={() => checkout(cart, 'card')}>Pay</button>
`,
  'tests/pricing.test.ts': `import { expect, test } from 'vitest'
import { find } from '../src/catalog'
import { total } from '../src/pricing'

test('total includes VAT', () => {
  expect(total([{ product: find('m-1')!, quantity: 1 }])).toBe(1572)
})
`,
  // the repo's own Claude Code agents, which have nothing to do with the factory
  '.claude/agents/copywriter.md': `---
name: copywriter
description: Writes the shop's product descriptions and error messages.
tools: Read, Edit
---

You are the copywriter. Short sentences, no jargon.
`,
  '.claude/agents/security-reviewer.md': `---
name: security-reviewer
description: Reviews changes that touch payments.
tools: Read, Grep, Glob
---

You review anything under src/api/ for ways money could leak.
`,
}

/** The pull request: discount codes. Touches pricing and the cart, adds a module, renames one, deletes one. */
const pull = {
  'src/discounts.ts': `import type { Cents } from './money'

export interface Discount {
  code: string
  /** percent off the subtotal, 0 to 100 */
  percent: number
}

const codes: Discount[] = [
  { code: 'WELCOME', percent: 10 },
  { code: 'SPRING', percent: 15 },
]

export function lookup(code: string): Discount | undefined {
  return codes.find((d) => d.code === code.trim().toUpperCase())
}

export function apply(amount: Cents, discount: Discount | undefined): Cents {
  if (!discount) return amount
  return Math.round(amount * (1 - discount.percent / 100))
}
`,
  'src/pricing.ts': `import { sum, type Cents } from './money'
import type { Product } from './catalog'
import { apply, type Discount } from './discounts'

export interface Line {
  product: Product
  quantity: number
}

const VAT_RATE = 0.21

export function subtotal(lines: Line[], discount?: Discount): Cents {
  return apply(sum(lines.map((l) => l.product.price * l.quantity)), discount)
}

export function vat(lines: Line[], discount?: Discount): Cents {
  return Math.round(subtotal(lines, discount) * VAT_RATE)
}

export function total(lines: Line[], discount?: Discount): Cents {
  return subtotal(lines, discount) + vat(lines, discount)
}
`,
  'src/cart.ts': `import { find } from './catalog'
import { lookup, type Discount } from './discounts'
import { total, type Line } from './pricing'

export class Cart {
  lines: Line[] = []
  discount: Discount | undefined

  add(id: string, quantity = 1): void {
    const product = find(id)
    if (!product) throw new Error(\`unknown product: \${id}\`)
    const line = this.lines.find((l) => l.product.id === id)
    if (line) line.quantity += quantity
    else this.lines.push({ product, quantity })
  }

  remove(id: string): void {
    this.lines = this.lines.filter((l) => l.product.id !== id)
  }

  /** Returns false when the code is not one we know. */
  redeem(code: string): boolean {
    this.discount = lookup(code)
    return this.discount !== undefined
  }

  get total() {
    return total(this.lines, this.discount)
  }
}
`,
  'src/ui/CartView.svelte': `<script lang="ts">
	import { Cart } from '../cart'
	import { format } from '../money'

	let { cart }: { cart: Cart } = $props()
	let code = $state('')
	let rejected = $state(false)
</script>

<ul>
	{#each cart.lines as line (line.product.id)}
		<li>{line.quantity} × {line.product.name}</li>
	{/each}
</ul>
<form onsubmit={() => (rejected = !cart.redeem(code))}>
	<input bind:value={code} placeholder="Discount code" />
	{#if rejected}<p>We don't know that code.</p>{/if}
</form>
<p>Total: {format(cart.total)}</p>
`,
  'tests/pricing.test.ts': `import { expect, test } from 'vitest'
import { find } from '../src/catalog'
import { lookup } from '../src/discounts'
import { total } from '../src/pricing'

test('total includes VAT', () => {
  expect(total([{ product: find('m-1')!, quantity: 1 }])).toBe(1572)
})

test('a discount comes off before VAT', () => {
  expect(total([{ product: find('m-1')!, quantity: 1 }], lookup('welcome'))).toBe(1414)
})
`,
  'README.md': `# Shop

A small storefront: a cart, prices, discount codes, and a checkout.

## Develop

\`\`\`bash
npm install
npm test
\`\`\`
`,
}

/** The journal entries the fixture adds: why the VAT shows, a decision, and an older fix (last month). */
function journal(ticket, vatSha) {
  const lastMonth = new Date(Date.now() - 34 * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  return [
    {
      args: ['--title', 'Keep every amount in integer cents', '--kind', 'decision', '--files', 'src/money.ts,src/pricing.ts', '--tags', 'money,pricing'],
      at: lastMonth,
      // a commit that is not in this clone (made elsewhere, then rewritten away): the CLI would refuse to name it
      gone: 'deadbee',
      body: '## What changed\n\nNothing yet: this records how money is handled from now on.\n\n## Why\n\nFloating point drifts by a cent on some carts. Integer cents never do.\n\n## Decisions\n\n- `Cents` is a plain `number`, always whole.\n- Formatting happens only at the edges.\n',
    },
    {
      args: ['--title', 'Round the VAT once, on the subtotal', '--kind', 'fix', '--files', 'src/pricing.ts', '--tags', 'pricing,vat'],
      at: new Date(Date.now() - 3 * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z'),
      body: '## What changed\n\n`vat()` rounds the whole subtotal, not each line.\n\n## Why\n\nRounding per line made totals a cent off for carts with several copies of one thing.\n\n## Watch out\n\n- The receipt must use `vat()` too, or the two disagree again.\n',
    },
    {
      args: ['--title', 'Show the VAT amount on the receipt', '--kind', 'feature', '--ticket', ticket, '--files', 'src/checkout.ts', '--tags', 'receipt,vat', '--commit', vatSha],
      body: '## What changed\n\nThe receipt names the VAT as its own line, next to the total.\n\n## Why\n\nCustomers asked what they paid in tax, and the receipt is where they look.\n\n## Decisions\n\n- The VAT comes from `vat()`, the same function the total uses.\n',
    },
  ]
}

/** Change the journal entry with this title, as if it had been written that way. */
function amend(dir, title, change) {
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = path.join(entry.parentPath, entry.name)
    const text = fs.readFileSync(file, 'utf8')
    const head = text.slice(0, text.indexOf('\n---', 4))
    if (!head.split('\n').some((l) => l.replace(/^title:\s*/, '').replace(/^"|"$/g, '') === title)) continue
    fs.writeFileSync(file, change(text))
    return
  }
  throw new Error(`no journal entry titled ${title}`)
}

function sh(cwd, cmd, args, input, env = {}) {
  return execFileSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Mona Lisa',
      GIT_AUTHOR_EMAIL: 'mona@example.com',
      GIT_COMMITTER_NAME: 'Mona Lisa',
      GIT_COMMITTER_EMAIL: 'mona@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
    },
  }).trim()
}

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
}

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
const user = (login) => ({ login, avatarUrl: '' })

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Mona Lisa',
  GIT_AUTHOR_EMAIL: 'mona@example.com',
  GIT_COMMITTER_NAME: 'Mona Lisa',
  GIT_COMMITTER_EMAIL: 'mona@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

/**
 * Start a real run of the fixture's factory, with slow-agent.mjs in the place of the agent: `pace` is its
 * milliseconds per step, `hold` the roles ("builder") that wait halfway through their work until released.
 * Resolves to `{ release(role), stop() }`; `stop` ends the run and whatever it started.
 */
/** Where the slow agent of a fixture looks for the roles it must hold (see slow-agent.mjs). */
const holdDirOf = (repo) => path.join(path.dirname(repo), 'hold')

/** Make these roles of the slow agent wait halfway through their work, until `release(repo, role)`. */
export function hold(repo, roles) {
  fs.mkdirSync(holdDirOf(repo), { recursive: true })
  for (const role of roles) fs.writeFileSync(path.join(holdDirOf(repo), role), '')
}
export const release = (repo, role) => fs.rmSync(path.join(holdDirOf(repo), role), { force: true })

/**
 * The environment in which a run of the fixture's factory uses slow-agent.mjs as its agent: for the app (whose
 * Run button starts the run) and for a run started by hand.
 */
export function agentEnv(repo, pace = 1200) {
  const { GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL } = AUTHOR
  return { GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL, FACTORY_AGENT: 'claude', FACTORY_RUNNER: path.join(here, 'slow-agent.mjs'), SLOW_PACE: String(pace), SLOW_HOLD: holdDirOf(repo) }
}

export function startRun(repo, { pace = 1200, hold: roles = [], ticket = null } = {}) {
  const holdDir = holdDirOf(repo)
  hold(repo, roles)
  // the run must not think it is inside an agent's session, whatever the tests themselves run in
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX|FACTORY_)/.test(k)))
  const child = spawn(process.execPath, [path.join(repo, '.factory/cli.mjs'), 'run', ...(ticket ? [ticket] : [])], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...env, ...AUTHOR, ...agentEnv(repo, pace) },
  })
  return {
    release: (role) => release(repo, role),
    done: new Promise((resolve) => child.on('exit', resolve)),
    stop: () => {
      fs.rmSync(holdDir, { recursive: true, force: true })
      child.kill('SIGTERM')
    },
  }
}

/**
 * Build the fixture in `dir` (which must be empty or absent). Returns what a launch needs:
 * the project folder, the environment that points the app at fake-gh, and the file the fake logs its calls to.
 */
/**
 * Tickets from the weeks before, as their journal entries tell of them: each with the rows of what its agent runs
 * took (see USAGE_COLUMNS in the factory's CLI). For the Usage view: models, rounds that were redone, a ticket
 * that was deleted, one that Codex worked.
 */
function pastTickets() {
  const sonnet = 'claude:claude-sonnet-5-5'
  const opus = 'claude:claude-opus-5-5'
  // [stage, round, by, result, secs, turns, input, cache read, cache write, output, cost]
  const plan = (by, k = 1) => ['plan', 0, by, 'READY', 48 * k, 9, 2100 * k, 61000 * k, 9000 * k, 1900 * k, +(0.09 * k).toFixed(3)]
  const build = (round, by, k = 1, result = 'READY') => ['build', round, by, result, 410 * k, 38, 5200 * k, 890000 * k, 41000 * k, 15800 * k, +(0.71 * k).toFixed(3)]
  const review = (round, by, result, k = 1) => ['review', round, by, result, 95 * k, 14, 2600 * k, 180000 * k, 12000 * k, 3100 * k, +(0.17 * k).toFixed(3)]
  const once = (by, k = 1) => [plan(by, k), build(1, by, k), review(1, by, 'PASS', k)]
  const twice = (by, k = 1) => [plan(by, k), build(1, by, k), review(1, by, 'CHANGES', k), build(2, by, k * 0.6), review(2, by, 'PASS', k)]
  return [
    { days: 41, n: 12, title: 'Round prices to whole cents', usage: once(sonnet, 0.7) },
    { days: 34, n: 13, title: 'Add product categories to the catalog', usage: twice(sonnet) },
    { days: 33, n: 14, title: 'Validate the shipping address', usage: once(sonnet, 1.4) },
    { days: 26, n: 15, title: 'Move pricing rules out of the cart', usage: [plan(opus, 2), build(1, opus, 2.2), review(1, opus, 'CHANGES', 2), build(2, opus, 1.5), review(2, opus, 'CHANGES', 2), build(3, opus, 1.1), review(3, opus, 'PASS', 2)] },
    { days: 19, n: 16, title: 'Export orders as CSV', usage: [['plan', 0, 'codex:gpt-6.1-sol', 'READY', 61, 0, 48200, 0, 0, 0, 0], ['build', 1, 'codex:gpt-6.1-sol', 'READY', 520, 0, 612000, 0, 0, 0, 0], ['review', 1, 'codex:gpt-6.1-sol', 'PASS', 88, 0, 97400, 0, 0, 0, 0]] },
    { days: 12, n: 17, title: 'Sync the cart across tabs', deleted: true, usage: [plan(sonnet), build(1, sonnet, 1.3), review(1, sonnet, 'CHANGES'), build(2, sonnet, 1, 'ERROR')] },
    { days: 6, n: 18, title: 'Show stock levels on the product page', usage: once(sonnet, 1.1) },
    { days: 3, n: 19, title: 'Send a receipt by email', usage: twice(sonnet, 1.2) },
    { days: 1, n: 20, title: 'Remember the last used address', usage: once(sonnet, 0.8) },
  ].map((t) => {
    const at = new Date(Date.now() - t.days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').slice(0, 4).join('-')
    const id = `${at.slice(0, 10)}-${t.deleted ? `deleted-ticket-0${t.n}` : slug}`
    const title = t.deleted ? `Deleted ticket 0${t.n}: ${t.title}` : t.title
    const body = t.deleted ? `## What changed\nTicket 0${t.n} was deleted for good while it was in Build, round 2.\n\n## Why\nTabs talking to each other turned out to need a server.` : `## What changed\n${t.title}.\n\n## Why\nA customer asked for it.`
    const meta = [`id: ${id}`, `at: ${at}`, `title: ${JSON.stringify(title)}`, `kind: ${t.deleted ? 'decision' : 'feature'}`, `ticket: 0${t.n}-${slug}`, 'commits: []', 'files: []', `tags: ${JSON.stringify(t.deleted ? ['deleted', 'ticket'] : ['shop'])}`, `usage: ${JSON.stringify(t.usage)}`]
    return { file: `${at.slice(0, 4)}/${id}.md`, text: `---\n${meta.join('\n')}\n---\n${body}\n` }
  })
}

export function createFixture(dir, { factory = true, usage = false } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const origin = path.join(dir, 'origin.git')
  const repo = path.join(dir, 'shop')
  const ghDir = path.join(dir, 'gh')
  fs.mkdirSync(repo)
  fs.mkdirSync(ghDir)
  const git = (...args) => sh(repo, 'git', args)

  sh(dir, 'git', ['init', '-q', '--bare', '-b', 'main', origin])
  git('init', '-q', '-b', 'main')
  // the remote reads as GitHub, and resolves to the bare repo next door
  git('config', `url.${origin}.insteadOf`, REMOTE_URL)
  git('remote', 'add', 'origin', REMOTE_URL)

  write(repo, base)
  git('add', '-A')
  git('commit', '-qm', 'Storefront: cart, pricing, checkout')
  const baseSha = git('rev-parse', 'HEAD')

  // the pull request's branch, pushed as GitHub would expose it and then deleted here: the app has to fetch it
  git('checkout', '-qb', 'discount-codes')
  write(repo, { 'src/discounts.ts': pull['src/discounts.ts'], 'src/pricing.ts': pull['src/pricing.ts'] })
  git('rm', '-q', 'src/legacy/coupons.ts')
  git('add', '-A')
  git('commit', '-qm', 'Add discount codes to pricing')
  write(repo, { 'src/cart.ts': pull['src/cart.ts'], 'src/ui/CartView.svelte': pull['src/ui/CartView.svelte'], 'tests/pricing.test.ts': pull['tests/pricing.test.ts'], 'README.md': pull['README.md'] })
  git('mv', 'src/api/payments.ts', 'src/api/charge.ts')
  fs.writeFileSync(path.join(repo, 'src/checkout.ts'), base['src/checkout.ts'].replace('./api/payments', './api/charge'))
  git('add', '-A')
  git('commit', '-qm', 'Redeem a code in the cart')
  const headSha = git('rev-parse', 'HEAD')
  let vatSha = null
  git('push', '-q', 'origin', 'main', 'discount-codes:refs/pull/7/head')
  git('checkout', '-q', 'main')
  git('branch', '-qD', 'discount-codes')
  git('gc', '-q', '--prune=now')

  if (factory) {
    // the real installer and the real CLI, as a user would run them
    sh(repo, process.execPath, [path.join(FACTORY_REPO, 'install.mjs'), repo])
    const configFile = path.join(repo, '.factory/config.json')
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    fs.writeFileSync(configFile, JSON.stringify({ ...config, checks: ['echo "42 tests passed"'] }, null, 2) + '\n')
    git('add', '-A')
    git('commit', '-qm', 'Install the factory')
    const cli = (args, input = '') => sh(repo, process.execPath, ['.factory/cli.mjs', ...args], input)
    const jobs = path.join(repo, '.factory/jobs')
    const created = (out) => out.split('\n').at(-1).trim()

    // 001: built, checked, reviewed, done. Its branch has a commit to review.
    const a = created(cli(['new', 'Show the VAT amount on the receipt'], 'The receipt only shows the total. Show the VAT as its own line.'))
    write(path.join(jobs, a), { 'plan.md': 'READY\n\n## Plan\n\n1. Return the VAT from `checkout()`.\n2. Print it on the receipt.\n' })
    cli(['advance', a, 'plan'])
    cli(['advance', a, 'build'])
    const wt = path.join(repo, '.factory/worktrees', a)
    fs.writeFileSync(
      path.join(wt, 'src/checkout.ts'),
      base['src/checkout.ts']
        .replace("import { charge } from './api/payments'", "import { charge } from './api/payments'\nimport { vat } from './pricing'")
        .replace('return `Paid ${format(cart.total)} (${receipt})`', 'return `Paid ${format(cart.total)}, of which ${format(vat(cart.lines))} VAT (${receipt})`')
    )
    sh(wt, 'git', ['commit', '-qam', 'Show the VAT on the receipt'])
    vatSha = sh(wt, 'git', ['rev-parse', 'HEAD'])
    write(path.join(jobs, a), { 'build.md': 'READY\n\n## What changed\n\n- `src/checkout.ts`: the receipt names the VAT.\n' })
    cli(['advance', a, 'check'])
    cli(['check', a])
    cli(['advance', a, 'review'])
    write(path.join(jobs, a, 'round-1'), { 'review.md': 'PASS\n\nThe diff does what the plan says, and nothing else.\n' })
    write(path.join(jobs, a), { 'journal.md': '## What changed\n\nThe receipt names the VAT as its own line.\n\n## Why\n\nCustomers asked what they paid in tax.\n' })
    cli(['advance', a, 'done'])

    // 002: waiting on a human
    const b = created(cli(['new', 'Support gift cards at checkout'], 'Customers should be able to pay with a gift card.'))
    cli(['advance', b, 'plan'])
    cli(['block', b, '-m', 'Do gift cards cover VAT, or only the subtotal? The ticket does not say.'])

    // 003: in the inbox
    cli(['new', 'Remember the cart between visits'], 'Keep the cart in localStorage.')

    // the journal: why things changed, committed on main
    for (const e of journal(a, vatSha)) {
      // the entry names the agent that wrote it: say which, so it does not depend on where the tests run
      sh(repo, process.execPath, ['.factory/cli.mjs', 'journal', 'add', ...e.args], e.body, { FACTORY_AGENT: 'claude' })
      // the CLI dates an entry now; these two are older, as if written days and weeks ago
      if (e.at) amend(path.join(repo, '.factory/journal'), e.args[1], (t) => t.replace(/^at: .*$/m, `at: ${e.at}`))
      if (e.gone) amend(path.join(repo, '.factory/journal'), e.args[1], (t) => t.replace(/^commits: .*\n/m, '').replace(/^title: /m, `commits: ["${e.gone}"]\ntitle: `))
    }
    if (usage) for (const t of pastTickets()) write(path.join(repo, '.factory/journal'), { [t.file]: t.text })
    git('add', '-A')
    git('commit', '-qm', 'Journal: the VAT on the receipt, cents, rounding')
  }

  // uncommitted work: an edit and a new file
  fs.writeFileSync(path.join(repo, 'src/money.ts'), base['src/money.ts'].replace("currency = 'EUR'", "currency = 'EUR', locale = 'en'").replace("NumberFormat('en'", 'NumberFormat(locale'))
  write(repo, { 'src/locale.ts': "export const locales = ['en', 'nl', 'de'] as const\nexport type Locale = (typeof locales)[number]\n" })

  // ---- what fake-gh answers from
  const state = {
    repo: { nameWithOwner: 'acme/shop', url: 'https://github.com/acme/shop', defaultBranchRef: { name: 'main' }, viewerPermission: 'ADMIN' },
    viewer: 'octo-dev',
    nextId: 9000,
    issues: [
      {
        number: 12,
        title: 'Totals are off by a cent for some carts',
        state: 'OPEN',
        stateReason: null,
        author: user('hubot'),
        labels: [{ name: 'bug', color: 'd73a4a' }],
        body: 'With three copies of *Kind of Blue* the total shows **€47.15**, but the receipt says €47.16.\n\n### Steps\n\n1. Add `m-1` three times\n2. Look at the cart total\n3. Pay, and compare the receipt\n\n- [x] Happens on main\n- [ ] Happens with a discount code\n\n<details><summary>Guess</summary>\nWe round the VAT per line in one place and on the subtotal in the other.\n</details>',
        createdAt: ago(60 * 26),
        updatedAt: ago(42),
        comments: [
          { databaseId: 501, author: user('mona'), body: 'Confirmed. `vat()` rounds once, the receipt rounds per line.', createdAt: ago(60 * 20) },
          { databaseId: 502, author: user('hubot'), body: 'Then the receipt is the one that is wrong.', createdAt: ago(42) },
        ],
      },
      {
        number: 11,
        title: 'Let customers remove one item instead of the whole line',
        state: 'OPEN',
        stateReason: null,
        author: user('mona'),
        labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'good first issue', color: '7057ff' }],
        body: '`Cart.remove()` drops the whole line. A `decrement(id)` would be kinder.',
        createdAt: ago(60 * 72),
        updatedAt: ago(60 * 30),
        comments: [],
      },
      {
        number: 9,
        title: 'Prices show in dollars for Dutch visitors',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        author: user('hubot'),
        labels: [{ name: 'bug', color: 'd73a4a' }],
        body: 'The currency defaults to USD.',
        createdAt: ago(60 * 24 * 9),
        updatedAt: ago(60 * 24 * 6),
        comments: [{ databaseId: 480, author: user('mona'), body: 'Fixed: the default is EUR now.', createdAt: ago(60 * 24 * 6) }],
      },
    ],
    pulls: [
      {
        number: 7,
        title: 'Discount codes',
        state: 'OPEN',
        isDraft: false,
        author: user('mona'),
        labels: [{ name: 'enhancement', color: 'a2eeef' }],
        body: 'Adds discount codes.\n\n- `src/discounts.ts` holds the codes and applies them\n- pricing takes an optional discount, taken off **before** VAT\n- the cart can `redeem(code)`\n- the old `legacy/coupons.ts` goes\n\nCloses #4.',
        baseRefName: 'main',
        headRefName: 'discount-codes',
        baseRefOid: baseSha,
        headRefOid: headSha,
        additions: 51,
        deletions: 15,
        changedFiles: 9,
        reviewDecision: 'REVIEW_REQUIRED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        createdAt: ago(60 * 5),
        updatedAt: ago(18),
        checks: [
          { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/shop/actions/runs/1' },
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/shop/actions/runs/2' },
          { __typename: 'CheckRun', name: 'typecheck', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null },
        ],
        comments: [{ databaseId: 610, author: user('hubot'), body: 'Nice. Does a code survive `remove()`ing every line?', createdAt: ago(60 * 3) }],
        reviews: [],
        threads: [
          {
            id: 'PRRT_1',
            isResolved: false,
            isOutdated: false,
            path: 'src/discounts.ts',
            line: 15,
            diffSide: 'RIGHT',
            comments: [
              { databaseId: 701, author: user('hubot'), body: 'Should an unknown code be an error rather than `undefined`? The cart turns it into `false` anyway.', createdAt: ago(60 * 2) },
              { databaseId: 702, author: user('mona'), body: 'I kept it quiet so the UI decides what to say.', createdAt: ago(55) },
            ],
          },
          {
            id: 'PRRT_2',
            isResolved: true,
            isOutdated: false,
            path: 'src/pricing.ts',
            line: 10,
            diffSide: 'RIGHT',
            comments: [{ databaseId: 703, author: user('hubot'), body: '`VAT_RATE` reads better, thanks.', createdAt: ago(60 * 2) }],
          },
        ],
      },
      {
        number: 6,
        title: 'Default to EUR',
        state: 'MERGED',
        isDraft: false,
        author: user('mona'),
        labels: [],
        body: 'Fixes #9.',
        baseRefName: 'main',
        headRefName: 'eur-default',
        baseRefOid: baseSha,
        headRefOid: baseSha,
        additions: 1,
        deletions: 1,
        changedFiles: 1,
        reviewDecision: 'APPROVED',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNKNOWN',
        createdAt: ago(60 * 24 * 7),
        updatedAt: ago(60 * 24 * 6),
        checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null }],
        comments: [],
        reviews: [{ author: user('hubot'), state: 'APPROVED', body: 'Ship it.', submittedAt: ago(60 * 24 * 6) }],
        threads: [],
      },
    ],
  }
  fs.writeFileSync(path.join(ghDir, 'state.json'), JSON.stringify(state, null, 2))
  fs.writeFileSync(path.join(ghDir, 'calls.jsonl'), '')

  // a launcher of its own, so the app runs `gh` like any other program (and it works on Windows too)
  const fake = path.join(here, 'fake-gh.mjs')
  const bin = path.join(ghDir, process.platform === 'win32' ? 'gh.cmd' : 'gh')
  fs.writeFileSync(bin, process.platform === 'win32' ? `@node "${fake}" %*\r\n` : `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 })

  return {
    repo,
    calls: path.join(ghDir, 'calls.jsonl'),
    headSha,
    baseSha,
    vatSha,
    env: { FACTORY_APP_GH: bin, FAKE_GH_DIR: ghDir, FACTORY_APP_DATA: path.join(dir, 'app-data') },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? '')
  if (!process.argv[2] || (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)) {
    console.error('usage: node e2e/fixture.mjs <new or empty folder>')
    process.exit(1)
  }
  const f = createFixture(dir)
  console.log(JSON.stringify(f, null, 2))
}
