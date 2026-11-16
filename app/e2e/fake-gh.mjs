#!/usr/bin/env node
// A stand-in for the `gh` CLI, for the end-to-end tests and `npm run demo`. It answers the calls the app makes
// (electron/github.ts) from $FAKE_GH_DIR/state.json, applies writes to that file, and appends every call to
// $FAKE_GH_DIR/calls.jsonl so a test can check what would have gone to GitHub.
import fs from 'node:fs'
import path from 'node:path'

const dir = process.env.FAKE_GH_DIR
const stateFile = path.join(dir, 'state.json')
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const args = process.argv.slice(2)
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : ''

const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
const out = (value) => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value))
const fail = (message, code = 1) => {
  process.stderr.write(`gh: ${message}\n`)
  process.exit(code)
}
const now = () => new Date().toISOString()
const me = () => ({ login: state.viewer, avatarUrl: '' })
const url = (kind, n) => `${state.repo.url}/${kind}/${n}`

fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args, input: input ? JSON.parse(input) : null }) + '\n')

const labels = (l) => ({ nodes: l })
const comment = (c, kind, n) => ({ ...c, url: `${url(kind, n)}#c${c.databaseId}` })

const issueNode = (i) => ({
  number: i.number,
  title: i.title,
  state: i.state,
  stateReason: i.stateReason,
  author: i.author,
  labels: labels(i.labels),
  body: i.body,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  url: url('issues', i.number),
  comments: { totalCount: i.comments.length },
  thread: { nodes: i.comments.map((c) => comment(c, 'issues', i.number)) },
})

function rollup(checks) {
  if (!checks.length) return null
  const bad = checks.some((c) => c.status === 'COMPLETED' && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion))
  const running = checks.some((c) => c.status !== 'COMPLETED')
  return { state: bad ? 'FAILURE' : running ? 'PENDING' : 'SUCCESS', contexts: { nodes: checks } }
}

const pullNode = (p) => ({
  number: p.number,
  title: p.title,
  state: p.state,
  isDraft: p.isDraft,
  author: p.author,
  labels: labels(p.labels),
  body: p.body,
  baseRefName: p.baseRefName,
  headRefName: p.headRefName,
  baseRefOid: p.baseRefOid,
  headRefOid: p.headRefOid,
  additions: p.additions,
  deletions: p.deletions,
  changedFiles: p.changedFiles,
  reviewDecision: p.reviewDecision,
  mergeable: p.mergeable,
  mergeStateStatus: p.mergeStateStatus,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  url: url('pull', p.number),
  comments: { totalCount: p.comments.length },
  thread: { nodes: p.comments.map((c) => comment(c, 'pull', p.number)) },
  commits: { nodes: [{ commit: { statusCheckRollup: rollup(p.checks) } }] },
  reviews: { nodes: p.reviews.map((r) => ({ ...r, url: url('pull', p.number) })) },
  reviewThreads: { nodes: p.threads.map((t) => ({ ...t, comments: { nodes: t.comments.map((c) => comment(c, 'pull', p.number)) } })) },
})

function graphql({ query, variables }) {
  if (query.includes('search(')) {
    const q = variables.q
    const pulls = q.includes('is:pr')
    const open = q.includes('is:open')
    const words = q.split(' ').filter((w) => !w.includes(':'))
    const items = (pulls ? state.pulls : state.issues)
      .filter((x) => (x.state === 'OPEN') === open)
      .filter((x) => words.every((w) => `${x.title} ${x.body}`.toLowerCase().includes(w.toLowerCase())))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { search: { issueCount: items.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: items.map(pulls ? pullNode : issueNode) } }
  }
  if (query.includes('resolveReviewThread')) {
    for (const p of state.pulls) for (const t of p.threads) if (t.id === variables.id) t.isResolved = !query.includes('unresolveReviewThread')
    save()
    return { thread: { id: variables.id } }
  }
  if (query.includes('pullRequest(number')) {
    const p = state.pulls.find((x) => x.number === variables.number)
    if (!p) throw new Error(`Could not resolve to a PullRequest with the number of ${variables.number}.`)
    return { repository: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, pullRequest: pullNode(p) } }
  }
  if (query.includes('issue(number')) {
    const i = state.issues.find((x) => x.number === variables.number)
    if (!i) throw new Error(`Could not resolve to an Issue with the number of ${variables.number}.`)
    return { repository: { issue: issueNode(i) } }
  }
  throw new Error('fake-gh: unknown query')
}

function rest(method, route, body) {
  const m = (re) => route.match(re)
  let hit
  if (method === 'POST' && m(/^repos\/[^/]+\/[^/]+\/issues$/)) {
    const number = Math.max(0, ...state.issues.map((i) => i.number), ...state.pulls.map((p) => p.number)) + 1
    state.issues.push({ number, title: body.title, state: 'OPEN', stateReason: null, author: me(), labels: [], body: body.body ?? '', createdAt: now(), updatedAt: now(), comments: [] })
    return { number }
  }
  if (method === 'POST' && (hit = m(/\/issues\/(\d+)\/comments$/))) {
    const target = state.issues.find((i) => i.number === +hit[1]) ?? state.pulls.find((p) => p.number === +hit[1])
    if (!target) fail('Not Found (HTTP 404)')
    target.comments.push({ databaseId: state.nextId++, author: me(), body: body.body, createdAt: now() })
    target.updatedAt = now()
    return {}
  }
  if (method === 'PATCH' && (hit = m(/\/issues\/(\d+)$/))) {
    const issue = state.issues.find((i) => i.number === +hit[1])
    issue.state = body.state === 'closed' ? 'CLOSED' : 'OPEN'
    issue.stateReason = body.state === 'closed' ? 'COMPLETED' : null
    issue.updatedAt = now()
    return {}
  }
  if (method === 'POST' && (hit = m(/\/pulls\/(\d+)\/reviews$/))) {
    const pull = state.pulls.find((p) => p.number === +hit[1])
    if (body.commit_id !== pull.headRefOid) fail('Unprocessable Entity: commit_id is not part of the pull request (HTTP 422)')
    if (body.event !== 'COMMENT' && pull.author.login === state.viewer) fail('Unprocessable Entity: Can not approve your own pull request (HTTP 422)')
    for (const c of body.comments ?? []) {
      pull.threads.push({
        id: `PRRT_${state.nextId}`,
        isResolved: false,
        isOutdated: false,
        path: c.path,
        line: c.line,
        diffSide: c.side,
        comments: [{ databaseId: state.nextId++, author: me(), body: c.body, createdAt: now() }],
      })
    }
    pull.reviews.push({ author: me(), state: { COMMENT: 'COMMENTED', APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' }[body.event], body: body.body ?? '', submittedAt: now() })
    if (body.event === 'APPROVE') pull.reviewDecision = 'APPROVED'
    if (body.event === 'REQUEST_CHANGES') pull.reviewDecision = 'CHANGES_REQUESTED'
    pull.updatedAt = now()
    return {}
  }
  if (method === 'POST' && (hit = m(/\/pulls\/(\d+)\/comments\/(\d+)\/replies$/))) {
    const pull = state.pulls.find((p) => p.number === +hit[1])
    const thread = pull.threads.find((t) => t.comments.some((c) => c.databaseId === +hit[2]))
    if (!thread) fail('Not Found (HTTP 404)')
    thread.comments.push({ databaseId: state.nextId++, author: me(), body: body.body, createdAt: now() })
    return {}
  }
  if (method === 'PUT' && (hit = m(/\/pulls\/(\d+)\/merge$/))) {
    const pull = state.pulls.find((p) => p.number === +hit[1])
    if (body.sha !== pull.headRefOid) fail('Head branch was modified. Review and try the merge again. (HTTP 409)')
    pull.state = 'MERGED'
    pull.updatedAt = now()
    return { merged: true }
  }
  fail(`fake-gh: no route for ${method} ${route}`)
}

if (args[0] === 'repo' && args[1] === 'view') out(state.repo)
else if (args[0] === 'api' && args[1] === 'user') out(state.viewer + '\n')
else if (args[0] === 'api' && args[1] === 'graphql') {
  try {
    out({ data: graphql(JSON.parse(input)) })
  } catch (e) {
    fail(`GraphQL: ${e.message}`)
  }
} else if (args[0] === 'api' && args[1] === '-X') {
  const result = rest(args[2], args[3], JSON.parse(input))
  save()
  out(result)
} else fail(`fake-gh: unknown command: ${args.join(' ')}`)
