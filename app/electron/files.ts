import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEntry, AgentFile, Saved } from '../shared/api'

// The files that tell agents what to do, read and written for the Agents view: everything under .claude/, the
// instruction files at the repo's root, and the factory's rules, role prompts and pipeline. This is the one place
// the app writes agent files to the project, so it is strict about where: a fixed set of places, never through a
// link that leaves them. The factory's state (.factory/jobs, journal, worktrees), its CLI and local.json are not
// among them.

/** Folders whose whole content is the app's to edit. */
const ROOT_DIRS = ['.claude', '.factory/roles', '.factory/skills']
/** Of those, the ones that may be a link (to a dotfiles repo, say). The factory's folders are the repo's own. */
const LINKABLE = ['.claude']
/** Files at the repo's root that instruct agents. They may be created, renamed among themselves, and deleted. */
const ROOT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', '.mcp.json', '.cursorrules']
/** The factory's own files: edited here, but not renamed, deleted or made by hand (the factory needs them where they are). */
const FIXED_FILES = ['.factory/config.json', '.factory/rules.md', '.factory/roles/planner.md', '.factory/roles/builder.md', '.factory/roles/reviewer.md']

const MAX_TEXT = 1_000_000
const MAX_ENTRIES = 3000
const MAX_DEPTH = 10
const SKIP = new Set(['node_modules', '.git'])

/** A repo path from the window, as forward-slash segments: nothing absolute, nothing that climbs. */
function clean(rel: string): string {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) throw new Error('not a file the app manages')
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error('not a file the app manages')
  return parts.join('/')
}

interface Zone {
  kind: 'dir' | 'root' | 'fixed'
  /** the folder the zone is, from the repo's root ('' for the root itself) */
  base: string
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

function zoneOf(rel: string): Zone {
  if (FIXED_FILES.includes(rel)) return { kind: 'fixed', base: parentOf(rel) }
  const dir = ROOT_DIRS.find((d) => rel === d || rel.startsWith(d + '/'))
  if (dir) return { kind: 'dir', base: dir }
  if (ROOT_FILES.includes(rel)) return { kind: 'root', base: '' }
  throw new Error(`${rel} is not a file the app manages`)
}

const within = (p: string, base: string) => p === base || p.startsWith(base + path.sep)

/**
 * Where a managed path is on disk. The folder it sits in must really be inside its zone: a symlink somewhere in
 * the path that leads out of it is refused. (.claude itself may be a link, to a dotfiles repo say: then its target
 * is the zone. The factory's folders may not.)
 */
async function locate(repo: string, relIn: string, opts: { parentMustExist?: boolean } = {}): Promise<{ rel: string; full: string; zone: Zone }> {
  const rel = clean(relIn)
  const zone = zoneOf(rel)
  const root = await fs.realpath(repo)
  const full = path.join(root, ...rel.split('/'))
  const zoneDir = path.join(root, ...zone.base.split('/').filter(Boolean))
  // every folder between the root and the zone is a real folder of the repo, not a link out of it
  for (let up = path.dirname(zoneDir); within(up, root) && up !== root; up = path.dirname(up)) {
    if ((await fs.lstat(up).catch(() => null))?.isSymbolicLink()) throw new Error(`${rel} leads outside the project`)
  }
  const real = await fs.realpath(zoneDir).catch(() => null)
  if (real && real !== zoneDir && !LINKABLE.includes(zone.base)) throw new Error(`${rel} leads outside the project`)
  const base = real ?? zoneDir
  // the nearest folder that exists, resolved: it must be the zone or inside it, or (while the zone does not exist
  // yet) a real folder above it
  let dir = path.dirname(full)
  for (;;) {
    const at = await fs.realpath(dir).catch(() => null)
    if (at) {
      const inside = within(at, base) || (!real && at === dir && within(zoneDir, dir))
      if (!inside) throw new Error(`${rel} leads outside the project`)
      break
    }
    if (opts.parentMustExist) throw new Error(`the folder of ${rel} does not exist`)
    const up = path.dirname(dir)
    if (up === dir) throw new Error(`${rel} leads outside the project`)
    dir = up
  }
  // the file itself must not be a link out either (an instruction file at the root may point at another one)
  const self = await fs.lstat(full).catch(() => null)
  if (self?.isSymbolicLink()) {
    const target = await fs.realpath(full).catch(() => null)
    if (!target || !(within(target, base) || (zone.kind === 'root' && path.dirname(target) === root))) throw new Error(`${rel} is a link to outside the project`)
  }
  return { rel, full, zone }
}

const isBinary = (data: Buffer) => data.subarray(0, 8000).includes(0)
const stamp = (st: { mtimeMs: number; size: number }): Saved => ({ mtime: st.mtimeMs, size: st.size })

async function walk(root: string, rel: string, depth: number, out: AgentEntry[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
  const entries = await fs.readdir(path.join(root, ...rel.split('/')), { withFileTypes: true }).catch(() => [])
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_ENTRIES || SKIP.has(e.name)) continue
    const child = `${rel}/${e.name}`
    const st = await fs.stat(path.join(root, ...child.split('/'))).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      out.push({ path: child, dir: true, size: 0, mtime: st.mtimeMs })
      await walk(root, child, depth + 1, out)
    } else if (st.isFile()) out.push({ path: child, dir: false, size: st.size, mtime: st.mtimeMs })
  }
}

/** Every managed file and folder that exists, as repo paths. */
export async function agentFiles(repo: string): Promise<AgentEntry[]> {
  const root = await fs.realpath(repo)
  const out: AgentEntry[] = []
  // a .factory that is a link out of the repo is not listed: none of it could be opened
  const factoryReal = (await fs.realpath(path.join(root, '.factory')).catch(() => null)) === path.join(root, '.factory')
  const listable = (rel: string) => factoryReal || !rel.startsWith('.factory/')
  for (const dir of ROOT_DIRS.filter(listable)) {
    const st = await fs.stat(path.join(root, dir)).catch(() => null)
    if (!st?.isDirectory()) continue
    out.push({ path: dir, dir: true, size: 0, mtime: st.mtimeMs })
    await walk(root, dir, 1, out)
  }
  for (const file of [...ROOT_FILES, ...FIXED_FILES].filter(listable)) {
    // the role prompts were listed with their folder
    if (out.some((e) => e.path === file)) continue
    const st = await fs.stat(path.join(root, ...file.split('/'))).catch(() => null)
    if (st?.isFile()) out.push({ path: file, dir: false, size: st.size, mtime: st.mtimeMs })
  }
  return out
}

export async function agentRead(repo: string, rel: string): Promise<AgentFile> {
  const at = await locate(repo, rel)
  const st = await fs.stat(at.full).catch(() => null)
  if (!st?.isFile()) throw new Error(`${at.rel} does not exist`)
  const fixed = at.zone.kind === 'fixed'
  if (st.size > MAX_TEXT) return { path: at.rel, text: null, reason: 'large', fixed, ...stamp(st) }
  const data = await fs.readFile(at.full)
  if (isBinary(data)) return { path: at.rel, text: null, reason: 'binary', fixed, ...stamp(st) }
  return { path: at.rel, text: data.toString('utf8'), reason: null, fixed, ...stamp(st) }
}

/**
 * Write a file. `expected` is the modification time the window last saw: null means "this is a new file" (and it
 * must not exist yet); a number must still match the file, or someone else (an agent, an editor) changed it
 * meanwhile and the write is refused, unless `force`. The write goes through a temporary file, so a crash
 * halfway never leaves half a file.
 */
export async function agentWrite(repo: string, rel: string, text: string, expected: number | null, force = false): Promise<Saved> {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('too large to save from here')
  const at = await locate(repo, rel)
  const st = await fs.stat(at.full).catch(() => null)
  if (st && !st.isFile()) throw new Error(`${at.rel} is not a file`)
  if (expected === null && st) throw new Error(`${at.rel} already exists`)
  if (at.zone.kind === 'fixed' && !st) throw new Error(`${at.rel} belongs to the factory: install it rather than creating this by hand`)
  if (expected !== null && !st && !force) throw new Error('conflict: the file was deleted on disk')
  if (expected !== null && st && Math.abs(st.mtimeMs - expected) > 1 && !force) throw new Error('conflict: the file changed on disk')
  await fs.mkdir(path.dirname(at.full), { recursive: true })
  const tmp = `${at.full}.${process.pid}.tmp`
  try {
    await fs.writeFile(tmp, text, { mode: st ? st.mode : 0o644 })
    await fs.rename(tmp, at.full)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
  return stamp(await fs.stat(at.full))
}

export async function agentMkdir(repo: string, rel: string): Promise<void> {
  const at = await locate(repo, rel)
  if (at.zone.kind !== 'dir') throw new Error('folders can only be made inside .claude, .factory/roles or .factory/skills')
  if (await fs.stat(at.full).catch(() => null)) throw new Error(`${at.rel} already exists`)
  await fs.mkdir(at.full, { recursive: true })
}

/** Rename or move a file or folder. Both ends must be the app's to manage, and the target must be free. */
export async function agentRename(repo: string, from: string, to: string): Promise<void> {
  const [a, b] = [await locate(repo, from), await locate(repo, to)]
  if (a.zone.kind === 'fixed' || b.zone.kind === 'fixed') throw new Error('the factory needs this file where it is')
  if (ROOT_DIRS.includes(a.rel)) throw new Error(`${a.rel} itself cannot be renamed here`)
  if (!(await fs.lstat(a.full).catch(() => null))) throw new Error(`${a.rel} does not exist`)
  if (await fs.lstat(b.full).catch(() => null)) throw new Error(`${b.rel} already exists`)
  if (b.rel.startsWith(a.rel + '/')) throw new Error('a folder cannot be moved into itself')
  await fs.mkdir(path.dirname(b.full), { recursive: true })
  await fs.rename(a.full, b.full)
}

/** Delete a file or folder: to the system's trash, so it can be brought back. */
export async function agentDelete(repo: string, rel: string): Promise<void> {
  const at = await locate(repo, rel)
  if (at.zone.kind === 'fixed') throw new Error('the factory needs this file')
  if (ROOT_DIRS.includes(at.rel)) throw new Error(`${at.rel} itself cannot be deleted here`)
  if (!(await fs.lstat(at.full).catch(() => null))) throw new Error(`${at.rel} does not exist`)
  // FACTORY_APP_NO_TRASH: the end-to-end tests run where there is no trash to move things to
  if (process.env.FACTORY_APP_NO_TRASH) await fs.rm(at.full, { recursive: true })
  else await shell.trashItem(at.full)
}

/** Open a file in whatever the system opens that kind of file with (the user's editor, for most of these). */
export async function agentOpen(repo: string, rel: string): Promise<void> {
  const at = await locate(repo, rel)
  if (!(await fs.stat(at.full).catch(() => null))) throw new Error(`${at.rel} does not exist`)
  // the tests record what would have been opened instead of starting someone's editor
  if (process.env.FACTORY_APP_OPEN_LOG) return fs.appendFile(process.env.FACTORY_APP_OPEN_LOG, `open ${at.full}\n`)
  const failed = await shell.openPath(at.full)
  if (failed) throw new Error(failed)
}

export async function agentReveal(repo: string, rel: string): Promise<void> {
  const at = await locate(repo, rel)
  if (process.env.FACTORY_APP_OPEN_LOG) return fs.appendFile(process.env.FACTORY_APP_OPEN_LOG, `reveal ${at.full}\n`)
  shell.showItemInFolder(at.full)
}
