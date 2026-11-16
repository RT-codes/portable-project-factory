// A project for the desktop app to open without touching the real GitHub: a git repo with history, a pull request
// that can really be fetched, uncommitted work, a factory with tickets, and the state fake-gh.mjs answers from.
//
//   node e2e/fixture.mjs <dir>     build it and print how to open the app on it (npm run demo does both)
//
// The end-to-end tests import createFixture().
import { execFileSync } from 'node:child_process'
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

function sh(cwd, cmd, args, input) {
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

/**
 * Build the fixture in `dir` (which must be empty or absent). Returns what a launch needs:
 * the project folder, the environment that points the app at fake-gh, and the file the fake logs its calls to.
 */
export function createFixture(dir, { factory = true } = {}) {
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
      cli(['journal', 'add', ...e.args], e.body)
      // the CLI dates an entry now; these two are older, as if written days and weeks ago
      if (e.at) amend(path.join(repo, '.factory/journal'), e.args[1], (t) => t.replace(/^at: .*$/m, `at: ${e.at}`))
      if (e.gone) amend(path.join(repo, '.factory/journal'), e.args[1], (t) => t.replace(/^commits: .*\n/m, '').replace(/^title: /m, `commits: ["${e.gone}"]\ntitle: `))
    }
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
