import type { FactoryState } from './types'

/** Where the factory's state is read from: the main process, for the project that is open. */
export interface FactorySource {
  /** null when there is no factory to read (the desktop app, in a repo without one) */
  state(): Promise<FactoryState | null>
  file(job: string, path: string): Promise<string>
}

// The factory's state, polled. Polling pauses while the window is hidden, and quickens while a run is alive:
// what a run does is worth seeing as it happens.
const POLL_MS = 2500
const POLL_RUNNING_MS = 1000

class Factory {
  state = $state<FactoryState | null>(null)
  error = $state<string | null>(null)
  lastOk = $state<number | null>(null)
  // there is no source until a project is open
  #source: FactorySource | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  /** Read from another source (the desktop app switches project this way). What was shown is dropped. */
  use(source: FactorySource) {
    this.#source = source
    this.state = null
    this.error = null
    this.lastOk = null
    void this.refresh()
  }

  async refresh() {
    const source = this.#source
    if (!source) return
    try {
      const state = await source.state()
      if (source !== this.#source) return
      this.state = state
      this.error = null
      this.lastOk = Date.now()
    } catch (e) {
      if (source === this.#source) this.error = e instanceof Error ? e.message : String(e)
    }
  }

  file(job: string, path: string) {
    if (!this.#source) return Promise.reject(new Error('no project is open'))
    return this.#source.file(job, path)
  }

  start() {
    let stopped = false
    const loop = async () => {
      if (!document.hidden) await this.refresh()
      if (!stopped) this.#timer = setTimeout(loop, this.state?.run ? POLL_RUNNING_MS : POLL_MS)
    }
    void loop()
    const onVisible = () => !document.hidden && this.refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (this.#timer) clearTimeout(this.#timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

export const factory = new Factory()

export const readFile = (job: string, path: string) => factory.file(job, path)
