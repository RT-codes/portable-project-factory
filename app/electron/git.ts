import fs from 'node:fs/promises'
import path from 'node:path'
import { EMPTY_TREE, WORKTREE, type HistoryScope, type LogCommit, type Ref, type Worktree, type Branch, type Commit, type Compare, type DiffFile, type DiffLine, type FileContent, type FileStatus, type Hunk, type TreeFile } from '../shared/api'
import { run, type RunOptions } from './exec'

/** Above this a file's text is not sent to the window. */
const MAX_TEXT = 2_000_000
/** Above this many changed lines a file's diff is left out (lock files, generated code). */
const MAX_DIFF_LINES = 6000
const MAX_UNTRACKED = 400

export function git(repo: string, args: string[], opts: RunOptions = {}) {
  // paths as they are (not octal-escaped), and nothing the user's config could make interactive or slow
  return run('git', ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], {
    cwd: repo,
    ...opts,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  })
}

const text = async (repo: string, args: string[], opts?: RunOptions) => (await git(repo, args, opts)).stdout.toString('utf8')

/** A revision comes from the window; it must be a name, never an option. */
function rev(name: string): string {
  if (!name || name.startsWith('-') || /[\s:\\]|\.\.|[\x00-\x1f]/.test(name)) throw new Error(`not a revision: ${name}`)
  return name
}

/** A repo path as git prints it: forward slashes, no leading slash, no way up. */
function repoPath(p: string): string {
  if (!p || p.startsWith('/') || p.includes('\0') || p.split('/').includes('..')) throw new Error(`not a path in the repo: ${p}`)
  return p
}

export async function isGit(repo: string): Promise<boolean> {
  const res = await git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).catch(() => null)
  return res?.code === 0
}

export async function currentBranch(repo: string): Promise<string | null> {
  const res = await git(repo, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true })
  return res.code === 0 ? res.stdout.toString('utf8').trim() || null : null
}

export async function resolve(repo: string, name: string): Promise<string | null> {
  const res = await git(repo, ['rev-parse', '--verify', '-q', `${rev(name)}^{commit}`], { allowFail: true })
  return res.code === 0 ? res.stdout.toString('utf8').trim() : null
}

export async function branches(repo: string): Promise<Branch[]> {
  const out = await text(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(committerdate:iso-strict)', 'refs/heads'])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, sha, head, date] = line.split('\0')
      return { name, sha, current: head === '*', date }
    })
}

/** The remote that points at a GitHub repo, if one does. */
export async function remoteFor(repo: string, owner: string, name: string): Promise<string | null> {
  const want = `${owner}/${name}`.toLowerCase()
  for (const line of (await text(repo, ['remote', '-v'])).split('\n')) {
    const [remote, url] = line.split(/\s+/)
    const m = url?.match(/github\.com[:/]+(.+?)(?:\.git)?\/?$/i)
    if (m && m[1].toLowerCase() === want) return remote
  }
  return null
}

// ---------------------------------------------------------------- tree and files

export async function tree(repo: string, at: string): Promise<TreeFile[]> {
  if (at !== WORKTREE) {
    const out = await text(repo, ['ls-tree', '-r', '-z', '--name-only', rev(at)])
    return out.split('\0').filter(Boolean).map((p) => ({ path: p }))
  }
  const [listed, status] = await Promise.all([
    text(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    text(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const change = new Map<string, TreeFile['change']>()
  const entries = status.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    const xy = e.slice(0, 2)
    const p = e.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++ // the entry after a rename is its old path
    change.set(p, xy === '??' ? 'untracked' : xy.includes('D') ? 'deleted' : xy.includes('A') ? 'added' : 'modified')
  }
  const paths = new Set(listed.split('\0').filter(Boolean))
  return [...paths].sort().map((p) => (change.has(p) ? { path: p, change: change.get(p) } : { path: p }))
}

const isBinary = (data: Buffer) => data.subarray(0, 8000).includes(0)

function content(data: Buffer): FileContent {
  const binary = isBinary(data)
  return { text: binary || data.length > MAX_TEXT ? null : data.toString('utf8'), binary, missing: false, size: data.length }
}

const MISSING: FileContent = { text: null, binary: false, missing: true, size: 0 }

/** Resolve a repo path on disk, refusing anything that leaves the repo, through `..` or a symlink. */
async function onDisk(repo: string, p: string): Promise<string | null> {
  const root = await fs.realpath(repo)
  const rel = repoPath(p)
  try {
    const full = await fs.realpath(path.join(root, rel))
    return full.startsWith(root + path.sep) ? full : null
  } catch {
    return null
  }
}

export async function file(repo: string, at: string, p: string): Promise<FileContent> {
  if (at === WORKTREE) {
    const full = await onDisk(repo, p)
    if (!full) return MISSING
    const st = await fs.stat(full)
    if (!st.isFile()) return MISSING
    if (st.size > MAX_TEXT) return { text: null, binary: false, missing: false, size: st.size }
    return content(await fs.readFile(full))
  }
  const res = await git(repo, ['cat-file', 'blob', `${rev(at)}:${repoPath(p)}`], { allowFail: true })
  return res.code === 0 ? content(res.stdout) : MISSING
}

// ---------------------------------------------------------------- diffs

const STATUS: Record<string, FileStatus> = { A: 'added', D: 'deleted', R: 'renamed', C: 'added' }

interface Named {
  path: string
  oldPath: string | null
  status: FileStatus
}

function parseNameStatus(out: string): Named[] {
  const parts = out.split('\0')
  const files: Named[] = []
  for (let i = 0; i + 1 < parts.length; ) {
    const code = parts[i++][0]
    if (code === 'R' || code === 'C') {
      const oldPath = parts[i++]
      files.push({ path: parts[i++], oldPath: code === 'R' ? oldPath : null, status: STATUS[code] })
    } else {
      files.push({ path: parts[i++], oldPath: null, status: STATUS[code] ?? 'modified' })
    }
  }
  return files
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** One file's section of `git diff` output (everything after its `diff --git` line) into hunks. */
function parseSection(lines: string[], file: DiffFile): void {
  let i = 0
  let changed = 0
  for (; i < lines.length && !lines[i].startsWith('@@'); i++) {
    if (lines[i].startsWith('Binary files ') || lines[i] === 'GIT binary patch') file.binary = true
  }
  while (i < lines.length) {
    const m = HUNK.exec(lines[i++])
    if (!m) continue
    const hunk: Hunk = { oldStart: +m[1], oldLines: +(m[2] ?? 1), newStart: +m[3], newLines: +(m[4] ?? 1), section: m[5], lines: [] }
    let o = hunk.oldStart
    let n = hunk.newStart
    let oldLeft = hunk.oldLines
    let newLeft = hunk.newLines
    while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
      const raw = lines[i++]
      const mark = raw[0]
      const body = raw.slice(1).replace(/\r$/, '')
      let line: DiffLine
      if (mark === '+') {
        line = { kind: 'add', old: null, new: n++, text: body }
        newLeft--
        file.additions++
      } else if (mark === '-') {
        line = { kind: 'del', old: o++, new: null, text: body }
        oldLeft--
        file.deletions++
      } else if (mark === '\\') {
        continue // "\ No newline at end of file"
      } else {
        line = { kind: 'ctx', old: o++, new: n++, text: body }
        oldLeft--
        newLeft--
      }
      if (line.kind !== 'ctx') changed++
      hunk.lines.push(line)
    }
    file.hunks.push(hunk)
  }
  if (changed > MAX_DIFF_LINES) {
    file.tooLarge = true
    file.hunks = []
  }
}

function parsePatch(patch: string, named: Named[]): DiffFile[] {
  const files: DiffFile[] = named.map((n) => ({ ...n, binary: false, additions: 0, deletions: 0, hunks: [], tooLarge: false }))
  const lines = patch.split('\n')
  let index = -1
  let start = 0
  const flush = (end: number) => {
    if (index >= 0 && index < files.length) parseSection(lines.slice(start, end), files[index])
  }
  // A section opens with an unprefixed "diff --git" line; inside a hunk every line carries a +, - or space.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('diff --git ')) {
      flush(i)
      index++
      start = i + 1
    }
  }
  flush(lines.length)
  return files
}

async function untracked(repo: string): Promise<DiffFile[]> {
  const paths = (await text(repo, ['ls-files', '-z', '--others', '--exclude-standard'])).split('\0').filter(Boolean)
  const files: DiffFile[] = []
  for (const p of paths.slice(0, MAX_UNTRACKED)) {
    const full = path.join(repo, p)
    const st = await fs.lstat(full).catch(() => null)
    if (!st?.isFile()) continue
    const f: DiffFile = { path: p, oldPath: null, status: 'added', binary: false, additions: 0, deletions: 0, hunks: [], tooLarge: false }
    if (st.size > MAX_TEXT) {
      f.tooLarge = true
    } else {
      const data = await fs.readFile(full)
      if (isBinary(data)) {
        f.binary = true
      } else if (data.length > 0) {
        const body = data.toString('utf8').replace(/\n$/, '').split('\n')
        f.additions = body.length
        if (body.length > MAX_DIFF_LINES) f.tooLarge = true
        else {
          const lines = body.map((t, i): DiffLine => ({ kind: 'add', old: null, new: i + 1, text: t.replace(/\r$/, '') }))
          f.hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, section: '', lines }]
        }
      }
    }
    files.push(f)
  }
  return files
}

async function diff(repo: string, range: string[]): Promise<DiffFile[]> {
  const common = ['--no-color', '--no-ext-diff', '--no-textconv', '-M']
  const [names, patch] = await Promise.all([
    text(repo, ['diff', ...common, '--name-status', '-z', ...range, '--']),
    text(repo, ['diff', ...common, '--src-prefix=a/', '--dst-prefix=b/', '-U3', ...range, '--']),
  ])
  return parsePatch(patch, parseNameStatus(names))
}

/** `head` against its merge base with `base`: what a pull request of `head` into `base` would show. */
export async function compare(repo: string, base: string, head: string): Promise<Compare> {
  if (head === WORKTREE) {
    const baseSha = (await resolve(repo, base)) ?? EMPTY_TREE
    const files = [...(await diff(repo, [baseSha])), ...(await untracked(repo))]
    return { base: baseSha, head: WORKTREE, files: files.sort((a, b) => a.path.localeCompare(b.path)), commits: [] }
  }
  const headSha = await resolve(repo, head)
  if (!headSha) throw new Error(`no such branch or commit: ${head}`)
  // a first commit has no parent: it is compared against the empty tree
  if (base === EMPTY_TREE) return between(repo, EMPTY_TREE, headSha)
  const baseSha = await resolve(repo, base)
  if (!baseSha) throw new Error(`no such branch or commit: ${base}`)
  return between(repo, (await mergeBase(repo, baseSha, headSha)) ?? baseSha, headSha)
}

/** Where two commits' histories part, or null when this repo cannot tell (unrelated, or a shallow clone). */
export async function mergeBase(repo: string, a: string, b: string): Promise<string | null> {
  const res = await git(repo, ['merge-base', rev(a), rev(b)], { allowFail: true })
  return res.code === 0 ? res.stdout.toString('utf8').trim() : null
}

/** The diff and the commits from one commit to another. */
export async function between(repo: string, from: string, headSha: string): Promise<Compare> {
  const [files, log] = await Promise.all([
    diff(repo, [from, headSha]),
    from === EMPTY_TREE ? Promise.resolve('') : text(repo, ['log', '--format=%H%x00%s%x00%an%x00%aI', '-n', '250', `${from}..${headSha}`]),
  ])
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line): Commit => {
      const [sha, subject, author, date] = line.split('\0')
      return { sha, subject, author, date }
    })
  return { base: from, head: headSha, files, commits }
}

/**
 * Make a pull request's commits available locally. They land under refs/factory-app/, a namespace of the app's
 * own: no branch is created or moved, and the checkout is not touched.
 */
export async function fetchPull(repo: string, remote: string, number: number, baseRef: string, baseSha: string, headSha: string): Promise<void> {
  const has = async (sha: string) => (await git(repo, ['cat-file', '-e', `${rev(sha)}^{commit}`], { allowFail: true })).code === 0
  const fetch = (...refspecs: string[]) => git(repo, ['fetch', '--no-tags', '--quiet', remote, ...refspecs], { allowFail: true })
  if (!(await has(headSha))) {
    const res = await fetch(`+refs/pull/${number}/head:refs/factory-app/pull/${number}`)
    if (res.code !== 0) throw new Error(`could not fetch pull request #${number}: ${res.stderr.split('\n')[0]}`)
  }
  if (!(await has(baseSha))) {
    await fetch(`+refs/heads/${baseRef}:refs/factory-app/base/${baseRef}`)
    if (!(await has(baseSha))) await fetch(baseSha)
    if (!(await has(baseSha))) throw new Error(`could not fetch the base of pull request #${number} (${baseRef})`)
  }
}

/** Fetch one commit by its hash (GitHub serves any commit that is reachable from a ref). */
export async function fetchCommit(repo: string, remote: string, sha: string): Promise<void> {
  if ((await git(repo, ['cat-file', '-e', `${rev(sha)}^{commit}`], { allowFail: true })).code === 0) return
  const res = await git(repo, ['fetch', '--no-tags', '--quiet', '--depth', '1', remote, sha], { allowFail: true })
  if (res.code !== 0) throw new Error(`could not fetch commit ${sha.slice(0, 7)}: ${res.stderr.split('\n')[0]}`)
}

// ---------------------------------------------------------------- history and worktrees

function parseRefs(decoration: string): { refs: Ref[]; detachedHead: boolean } {
  const refs: Ref[] = []
  let detachedHead = false
  for (let part of decoration.split(', ').filter(Boolean)) {
    let head = false
    if (part === 'HEAD') {
      detachedHead = true
      continue
    }
    if (part.startsWith('HEAD -> ')) {
      head = true
      part = part.slice(8)
    }
    if (part.startsWith('tag: ')) refs.push({ name: part.slice(5).replace(/^refs\/tags\//, ''), kind: 'tag' })
    else if (part.startsWith('refs/heads/')) refs.push({ name: part.slice(11), kind: 'branch', ...(head ? { head } : {}) })
    // origin/HEAD only says which branch the remote calls its default
    else if (part.startsWith('refs/remotes/') && !part.endsWith('/HEAD')) refs.push({ name: part.slice(13), kind: 'remote' })
  }
  return { refs, detachedHead }
}

/** The commits a scope reaches, children before parents, so a graph can be drawn top to bottom. */
export async function history(repo: string, scope: HistoryScope, limit: number): Promise<LogCommit[]> {
  const hasHead = (await resolve(repo, 'HEAD')) !== null
  const any = async (prefix: string) => (await text(repo, ['for-each-ref', '--count=1', '--format=%(refname)', prefix])).trim() !== ''
  const from: string[] = []
  if (scope !== 'remote' && hasHead) from.push('HEAD')
  if ((scope === 'local' || scope === 'all') && (await any('refs/heads'))) from.push('--branches')
  if ((scope === 'remote' || scope === 'all') && (await any('refs/remotes'))) from.push('--remotes')
  if (scope === 'all' && (await any('refs/tags'))) from.push('--tags')
  // nothing to start from (no commits yet, or no remote): an empty history, not git's fallback to HEAD
  if (from.length === 0) return []
  const out = await text(repo, [
    'log',
    '--topo-order',
    '--decorate=full',
    '--decorate-refs=HEAD',
    '--decorate-refs=refs/heads/',
    '--decorate-refs=refs/remotes/',
    '--decorate-refs=refs/tags/',
    '--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D',
    '-n',
    String(Math.min(Math.max(1, Math.floor(limit)), 5000)),
    ...from,
    '--',
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line): LogCommit => {
      const [sha, parents, subject, author, date, decoration = ''] = line.split('\0')
      const { refs, detachedHead } = parseRefs(decoration)
      return { sha, parents: parents ? parents.split(' ') : [], subject, author, date, refs, ...(detachedHead ? { detachedHead } : {}) }
    })
}

export async function commitMessage(repo: string, sha: string): Promise<string> {
  return (await text(repo, ['show', '-s', '--format=%B', `${rev(sha)}^{commit}`])).trim()
}

/** Every worktree of the repo: where each is, what it has checked out, and how much is uncommitted there. */
export async function worktrees(repo: string): Promise<Worktree[]> {
  const here = await fs.realpath((await text(repo, ['rev-parse', '--show-toplevel'])).trim()).catch(() => repo)
  const blocks = (await text(repo, ['worktree', 'list', '--porcelain'])).split('\n\n').filter((b) => b.trim())
  const list = blocks.slice(0, 40).map((block): Worktree => {
    const w: Worktree = { path: '', name: '', branch: null, head: null, current: false, detached: false, bare: false, locked: false, prunable: false, changes: null }
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'worktree') w.path = value
      else if (key === 'HEAD') w.head = value
      else if (key === 'branch') w.branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'detached') w.detached = true
      else if (key === 'bare') w.bare = true
      else if (key === 'locked') w.locked = true
      else if (key === 'prunable') w.prunable = true
    }
    w.name = path.basename(w.path) || w.path
    return w
  })
  await Promise.all(
    list.map(async (w) => {
      w.current = (await fs.realpath(w.path).catch(() => w.path)) === here
      if (w.bare || w.prunable) return
      const status = await git(w.path, ['status', '--porcelain=v1', '-z'], { allowFail: true }).catch(() => null)
      if (status?.code === 0) w.changes = status.stdout.toString('utf8').split('\0').filter((e) => e.length > 3).length
    })
  )
  return list
}

// ---------------------------------------------------------------- bulk reads (for the import graph)

/** Read many files of one revision in a single git process. Missing and oversized files are skipped. */
export async function readMany(repo: string, at: string, paths: string[], maxSize: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (at === WORKTREE) {
    await Promise.all(
      paths.map(async (p) => {
        try {
          const full = path.join(repo, repoPath(p))
          const st = await fs.stat(full)
          if (st.isFile() && st.size <= maxSize) out.set(p, await fs.readFile(full, 'utf8'))
        } catch {
          /* deleted or unreadable */
        }
      })
    )
    return out
  }
  const names = paths.filter((p) => !p.includes('\n'))
  const res = await git(repo, ['cat-file', '--batch'], { input: names.map((p) => `${rev(at)}:${p}\n`).join('') })
  // each answer is "<sha> <type> <size>\n<bytes>\n", or "<name> missing\n"
  const data = res.stdout
  let pos = 0
  for (const p of names) {
    const eol = data.indexOf(10, pos)
    if (eol === -1) break
    const header = data.toString('utf8', pos, eol)
    pos = eol + 1
    if (header.endsWith(' missing')) continue
    const size = Number(header.slice(header.lastIndexOf(' ') + 1))
    if (size <= maxSize && header.includes(' blob ')) out.set(p, data.toString('utf8', pos, pos + size))
    pos += size + 1
  }
  return out
}

/**
 * What the repo knows of a list of commits, named as a journal entry names them (often abbreviated): the full sha,
 * the first parent and the subject, or nulls for one that is not here (not fetched yet, or rewritten away).
 */
export async function commits(repo: string, names: string[]): Promise<{ sha: string; full: string | null; parent: string | null; subject: string | null }[]> {
  const asked = names.slice(0, 200).filter((n) => typeof n === 'string' && /^[0-9a-f]{4,64}$/i.test(n))
  if (asked.length === 0) return []
  // one process for all of them: "<full> commit <size>" for a commit, "<name> missing" (or ambiguous) otherwise
  const checked = await text(repo, ['cat-file', '--batch-check'], { input: asked.map((n) => `${n}^{commit}\n`).join('') })
  const fulls = checked.split('\n').slice(0, asked.length).map((line) => (/^[0-9a-f]{40,64} commit /.test(line) ? line.split(' ')[0] : null))
  const found = [...new Set(fulls.filter((f): f is string => f !== null))]
  const facts = new Map<string, { parent: string | null; subject: string }>()
  if (found.length) {
    const out = await text(repo, ['log', '--no-walk=unsorted', '--format=%H%x00%P%x00%s', ...found, '--'])
    for (const line of out.split('\n').filter(Boolean)) {
      const [sha, parents, subject] = line.split('\0')
      facts.set(sha, { parent: parents ? parents.split(' ')[0] : null, subject })
    }
  }
  return asked.map((sha, i) => {
    const full = fulls[i]
    const f = full ? facts.get(full) : undefined
    return { sha, full: f ? full : null, parent: f?.parent ?? null, subject: f?.subject ?? null }
  })
}
