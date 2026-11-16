import type { Project, ProjectInfo } from '$shared/api'
import { WORKTREE } from '$shared/api'
import { factory } from '$lib/factory.svelte'
import { api, message } from './api'
import { layout } from './layout.svelte'

/** 'edit' is the editor of one agent file, opened from Agents; 'models' is opened from Home. Neither is in the sidebar. */
export type View = 'home' | 'board' | 'activity' | 'changes' | 'pulls' | 'issues' | 'code' | 'history' | 'journal' | 'agents' | 'edit' | 'guide' | 'models' | 'settings'

/** What the Changes view compares. The default is the uncommitted work in the checkout. */
export interface ChangeSource {
  base: string
  head: string
  /** what the header calls it: a ticket's title, a branch name */
  title?: string
}

export interface Route {
  view: View
  /** Activity: what its lower part shows instead of the board, with `number`: a pull request or an issue */
  sub?: 'pulls' | 'issues'
  /**
   * Never stored: Activity gives it to the view in its lower part, which then knows that "back" leads to the
   * board (see ActivityPart.svelte).
   */
  from?: 'board'
  /** an open pull request or issue */
  number?: number
  /** Changes: what to compare */
  source?: ChangeSource
  /** Code: the open file, and the revision it is read from. Edit: the file. Journal: the open entry's id. */
  path?: string
  rev?: string
}

class App {
  recent = $state<Project[]>([])
  project = $state<string | null>(null)
  info = $state<ProjectInfo | null>(null)
  loading = $state(true)
  error = $state<string | null>(null)
  /** counts shown in the sidebar; null until known */
  counts = $state<{ pulls: number | null; issues: number | null; changes: number | null }>({ pulls: null, issues: null, changes: null })
  #gen = 0
  #onFocus = new Set<() => void>()

  /** Run `fn` each time the window gets focus back: what it shows may have changed meanwhile. Returns the undo. */
  onFocus(fn: () => void) {
    this.#onFocus.add(fn)
    return () => void this.#onFocus.delete(fn)
  }

  focused() {
    void this.refreshInfo()
    for (const fn of this.#onFocus) fn()
  }

  async load() {
    try {
      const list = await api.projects()
      this.recent = list.recent
      if (list.current !== this.project) await this.#enter(list.current)
    } catch (e) {
      this.error = message(e)
    } finally {
      this.loading = false
    }
  }

  async open() {
    const picked = await api.openProject()
    if (picked) await this.load()
  }

  async select(path: string) {
    await api.selectProject(path)
    await this.load()
  }

  async forget(path: string) {
    await api.forgetProject(path)
    await this.load()
  }

  /** Show a view in the active panel (the sidebar and the keyboard shortcuts do this). */
  go(route: Route) {
    layout.go(route)
  }

  /** The current project's facts again: branch, GitHub login. Cheap enough to do when the window gets focus. */
  async refreshInfo() {
    const project = this.project
    if (!project) return
    try {
      const info = await api.projectInfo(project)
      if (project === this.project) this.info = info
    } catch (e) {
      if (project === this.project) this.error = message(e)
    }
    void this.refreshCounts()
  }

  async refreshCounts() {
    const project = this.project
    const info = this.info
    if (!project || !info) return
    const set = (patch: Partial<App['counts']>) => project === this.project && (this.counts = { ...this.counts, ...patch })
    if (info.isGit)
      api.compare(project, 'HEAD', WORKTREE).then(
        (c) => set({ changes: c.files.length }),
        () => set({ changes: null })
      )
    if (info.github) {
      api.pulls(project, { state: 'open' }).then(
        (p) => set({ pulls: p.total }),
        () => set({ pulls: null })
      )
      api.issues(project, { state: 'open' }).then(
        (p) => set({ issues: p.total }),
        () => set({ issues: null })
      )
    }
  }

  async #enter(project: string | null) {
    const gen = ++this.#gen
    this.project = project
    this.info = null
    this.error = null
    this.counts = { pulls: null, issues: null, changes: null }
    layout.load(project, { view: 'home' })
    if (!project) return
    factory.use({ state: () => api.factoryState(project), file: (job, path) => api.factoryFile(project, job, path) })
    const info = await api.projectInfo(project)
    if (gen !== this.#gen) return
    this.info = info
    void this.refreshCounts()
  }
}

export const app = new App()
