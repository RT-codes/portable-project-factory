import fs from 'node:fs'
import path from 'node:path'
import type { Project, ProjectList } from '../shared/api'

const MAX_RECENT = 12

/** The repos the user has opened, most recent first, kept in the app's data folder. Only these can be read. */
export class Projects {
  #file: string
  #recent: string[] = []
  #current: string | null = null

  constructor(dataDir: string) {
    this.#file = path.join(dataDir, 'projects.json')
    try {
      const saved = JSON.parse(fs.readFileSync(this.#file, 'utf8'))
      this.#recent = (Array.isArray(saved.recent) ? saved.recent : []).filter((p: unknown): p is string => typeof p === 'string' && isDir(p))
      this.#current = this.#recent.includes(saved.current) ? saved.current : (this.#recent[0] ?? null)
    } catch {
      /* first run, or an unreadable file: start empty */
    }
  }

  list(): ProjectList {
    return { recent: this.#recent.map(toProject), current: this.#current }
  }

  /** Add (or move to the front) and make current. */
  open(dir: string): Project {
    const full = path.resolve(dir)
    if (!isDir(full)) throw new Error(`${full} is not a folder`)
    this.#recent = [full, ...this.#recent.filter((p) => p !== full)].slice(0, MAX_RECENT)
    this.#current = full
    this.#save()
    return toProject(full)
  }

  select(dir: string): void {
    this.check(dir)
    this.open(dir)
  }

  forget(dir: string): void {
    this.#recent = this.#recent.filter((p) => p !== dir)
    if (this.#current === dir) this.#current = this.#recent[0] ?? null
    this.#save()
  }

  /** Every call from the renderer names a project; it must be one the user opened. */
  check(dir: string): string {
    if (!this.#recent.includes(dir)) throw new Error('unknown project')
    return dir
  }

  #save(): void {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    fs.writeFileSync(this.#file, JSON.stringify({ recent: this.#recent, current: this.#current }, null, 2))
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function toProject(p: string): Project {
  return { path: p, name: path.basename(p) || p }
}
