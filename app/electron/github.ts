import type {
  Actor,
  Check,
  CheckState,
  Comment,
  GithubRepo,
  Issue,
  IssueSummary,
  Label,
  ListQuery,
  MergeMethod,
  Page,
  Pull,
  PullSummary,
  Review,
  ReviewInput,
  ReviewThread,
} from '../shared/api'
import { ExecError, run } from './exec'

// GitHub through the `gh` CLI: it already holds the user's login (keyring, SSO, GitHub Enterprise hosts), so the
// app stores no token of its own. Reads are GraphQL (one round trip per screen); writes are REST.

/** FACTORY_APP_GH points the app at another binary; the end-to-end tests use it to stand in for GitHub. */
const GH = process.env.FACTORY_APP_GH || 'gh'
const PAGE = 30

function explain(e: unknown): Error {
  if (!(e instanceof ExecError)) return e as Error
  if (e.code === 'ENOENT') return new Error('The GitHub CLI (gh) is not installed. Install it from cli.github.com, then run `gh auth login`.')
  if (/gh auth login|not logged in|authentication|HTTP 401/i.test(e.stderr)) return new Error('Not signed in to GitHub. Run `gh auth login` in a terminal.')
  if (/no git remotes|none of the git remotes|not a git repository/i.test(e.stderr)) return new Error('This repo has no GitHub remote.')
  // gh prints "gh: <message> (HTTP 422)" and friends; the first line is the one worth showing
  const line = e.stderr.split('\n').find((l) => l.trim()) ?? e.message
  return new Error(line.replace(/^gh: /, '').replace(/^GraphQL: /, ''))
}

async function gh(args: string[], input?: string, cwd?: string): Promise<string> {
  try {
    return (await run(GH, args, { input, cwd })).stdout.toString('utf8')
  } catch (e) {
    throw explain(e)
  }
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const out = JSON.parse(await gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })))
  if (out.errors?.length) throw new Error(out.errors[0].message)
  return out.data
}

async function rest<T = unknown>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const out = await gh(['api', '-X', method, path, '--input', '-'], JSON.stringify(body))
  return out.trim() ? JSON.parse(out) : (undefined as T)
}

// ---------------------------------------------------------------- the repo

let viewer: Promise<string> | null = null

export async function repoOf(dir: string): Promise<GithubRepo> {
  const info = JSON.parse(await gh(['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef,viewerPermission'], undefined, dir))
  viewer ??= gh(['api', 'user', '--jq', '.login']).then((s) => s.trim())
  viewer.catch(() => (viewer = null))
  const [owner, repo] = String(info.nameWithOwner).split('/')
  return {
    owner,
    repo,
    url: info.url,
    defaultBranch: info.defaultBranchRef?.name ?? 'main',
    viewer: await viewer,
    canWrite: ['WRITE', 'MAINTAIN', 'ADMIN'].includes(info.viewerPermission),
  }
}

// ---------------------------------------------------------------- shapes

/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL answers are mapped to typed shapes right here */

const GHOST: Actor = { login: 'ghost', avatarUrl: 'https://avatars.githubusercontent.com/u/10137?v=4' }
const actor = (a: any): Actor => (a ? { login: a.login, avatarUrl: a.avatarUrl } : GHOST)
const labels = (l: any): Label[] => (l?.nodes ?? []).map((n: any) => ({ name: n.name, color: n.color }))
const comment = (c: any): Comment => ({ id: c.databaseId, author: actor(c.author), body: c.body ?? '', createdAt: c.createdAt, url: c.url })

const ACTOR = 'author { login avatarUrl }'
const COMMENT = `databaseId ${ACTOR} body createdAt url`
// `comments` is asked for its count here; a query that also wants the comments themselves aliases them (`thread:`),
// since GraphQL refuses one field with two sets of arguments
const ISSUE_FIELDS = `number title state ${ACTOR} labels(first: 12) { nodes { name color } } comments { totalCount } createdAt updatedAt url`
const PULL_FIELDS = `number title state isDraft ${ACTOR} labels(first: 12) { nodes { name color } } baseRefName headRefName additions deletions
  changedFiles comments { totalCount } reviewDecision createdAt updatedAt url`

const issueSummary = (n: any): IssueSummary => ({
  number: n.number,
  title: n.title,
  state: n.state,
  author: actor(n.author),
  labels: labels(n.labels),
  comments: n.comments?.totalCount ?? 0,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  url: n.url,
})

function rollup(state: string | null | undefined): CheckState | null {
  if (!state) return null
  if (state === 'SUCCESS') return 'SUCCESS'
  if (state === 'PENDING' || state === 'EXPECTED') return 'PENDING'
  return 'FAILURE'
}

function check(n: any): Check {
  if (n.__typename === 'StatusContext') return { name: n.context, state: rollup(n.state) ?? 'PENDING', url: n.targetUrl ?? null }
  const state: CheckState =
    n.status !== 'COMPLETED' ? 'PENDING' : n.conclusion === 'SUCCESS' ? 'SUCCESS' : n.conclusion === 'NEUTRAL' || n.conclusion === 'SKIPPED' ? 'NEUTRAL' : 'FAILURE'
  return { name: n.name, state, url: n.detailsUrl ?? null }
}

const pullSummary = (n: any): PullSummary => ({
  number: n.number,
  title: n.title,
  state: n.state,
  draft: n.isDraft,
  author: actor(n.author),
  labels: labels(n.labels),
  baseRef: n.baseRefName,
  headRef: n.headRefName,
  additions: n.additions,
  deletions: n.deletions,
  changedFiles: n.changedFiles,
  comments: n.comments?.totalCount ?? 0,
  reviewDecision: n.reviewDecision ?? null,
  checks: rollup(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  url: n.url,
})

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- lists

async function search<T>(r: GithubRepo, kind: 'issue' | 'pr', q: ListQuery, fields: string, map: (n: unknown) => T): Promise<Page<T>> {
  const text = [`repo:${r.owner}/${r.repo}`, `is:${kind}`, `is:${q.state}`, 'sort:updated-desc', q.search?.trim() ?? ''].join(' ').trim()
  const data = await graphql<{ search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: unknown[] } }>(
    `query($q: String!, $n: Int!, $after: String) {
      search(query: $q, type: ISSUE, first: $n, after: $after) {
        issueCount pageInfo { hasNextPage endCursor }
        nodes { ... on ${kind === 'issue' ? 'Issue' : 'PullRequest'} { ${fields} } }
      }
    }`,
    { q: text, n: PAGE, after: q.after ?? null }
  )
  const s = data.search
  return {
    items: s.nodes.filter((n) => n && Object.keys(n as object).length > 0).map(map),
    next: s.pageInfo.hasNextPage ? s.pageInfo.endCursor : null,
    total: s.issueCount,
  }
}

export const issues = (r: GithubRepo, q: ListQuery) => search(r, 'issue', q, ISSUE_FIELDS, issueSummary)

export const pulls = (r: GithubRepo, q: ListQuery) =>
  search(r, 'pr', q, `${PULL_FIELDS} commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`, pullSummary)

// ---------------------------------------------------------------- one issue, one pull request

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function issue(r: GithubRepo, number: number): Promise<Issue> {
  const data = await graphql<any>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) { ${ISSUE_FIELDS} body stateReason thread: comments(first: 100) { nodes { ${COMMENT} } } }
      }
    }`,
    { owner: r.owner, repo: r.repo, number }
  )
  const n = data.repository.issue
  return { ...issueSummary(n), body: n.body ?? '', stateReason: n.stateReason ?? null, thread: n.thread.nodes.map(comment) }
}

export async function pull(r: GithubRepo, number: number): Promise<Pull> {
  const data = await graphql<any>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
        pullRequest(number: $number) {
          ${PULL_FIELDS} body baseRefOid headRefOid mergeable mergeStateStatus
          thread: comments(first: 100) { nodes { ${COMMENT} } }
          commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } } } } } }
          reviews(last: 50) { nodes { ${ACTOR} state body submittedAt url } }
          reviewThreads(first: 100) { nodes {
            id isResolved isOutdated path line diffSide
            comments(first: 50) { nodes { ${COMMENT} } }
          } }
        }
      }
    }`,
    { owner: r.owner, repo: r.repo, number }
  )
  const repo = data.repository
  const n = repo.pullRequest
  const methods: MergeMethod[] = []
  if (repo.squashMergeAllowed) methods.push('squash')
  if (repo.mergeCommitAllowed) methods.push('merge')
  if (repo.rebaseMergeAllowed) methods.push('rebase')
  return {
    ...pullSummary(n),
    body: n.body ?? '',
    baseSha: n.baseRefOid,
    headSha: n.headRefOid,
    mergeable: n.mergeable,
    mergeState: n.mergeStateStatus,
    mergeMethods: methods,
    checkList: (n.commits.nodes[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []).map(check),
    reviews: n.reviews.nodes
      // a review that only carries inline comments has nothing of its own to show
      .filter((v: any) => v.state !== 'PENDING' && (v.state !== 'COMMENTED' || v.body))
      .map((v: any): Review => ({ author: actor(v.author), state: v.state, body: v.body ?? '', submittedAt: v.submittedAt, url: v.url })),
    thread: n.thread.nodes.map(comment),
    threads: n.reviewThreads.nodes.map(
      (t: any): ReviewThread => ({
        id: t.id,
        path: t.path,
        line: t.line ?? null,
        side: t.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
        resolved: t.isResolved,
        outdated: t.isOutdated,
        comments: t.comments.nodes.map(comment),
      })
    ),
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Where a pull request's branch left its base, as GitHub sees it: for clones too shallow to work it out. */
export async function mergeBase(r: GithubRepo, baseSha: string, headSha: string): Promise<string> {
  return (await gh(['api', `repos/${r.owner}/${r.repo}/compare/${baseSha}...${headSha}`, '--jq', '.merge_base_commit.sha'])).trim()
}

// ---------------------------------------------------------------- writes

const base = (r: GithubRepo) => `repos/${r.owner}/${r.repo}`

export async function issueCreate(r: GithubRepo, title: string, body: string): Promise<number> {
  return (await rest<{ number: number }>('POST', `${base(r)}/issues`, { title, body })).number
}

export async function issueComment(r: GithubRepo, number: number, body: string): Promise<void> {
  await rest('POST', `${base(r)}/issues/${number}/comments`, { body })
}

export async function issueSetState(r: GithubRepo, number: number, state: 'open' | 'closed'): Promise<void> {
  await rest('PATCH', `${base(r)}/issues/${number}`, { state })
}

export async function pullReview(r: GithubRepo, number: number, review: ReviewInput): Promise<void> {
  await rest('POST', `${base(r)}/pulls/${number}/reviews`, {
    commit_id: review.commitId,
    event: review.event,
    body: review.body,
    comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
  })
}

export async function pullReply(r: GithubRepo, number: number, inReplyTo: number, body: string): Promise<void> {
  await rest('POST', `${base(r)}/pulls/${number}/comments/${inReplyTo}/replies`, { body })
}

export async function pullResolve(threadId: string, resolved: boolean): Promise<void> {
  const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  await graphql(`mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { id } } }`, { id: threadId })
}

export async function pullMerge(r: GithubRepo, number: number, method: MergeMethod, headSha: string): Promise<void> {
  await rest('PUT', `${base(r)}/pulls/${number}/merge`, { merge_method: method, sha: headSha })
}
