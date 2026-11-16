import type { FactoryState } from './types'

/** Where the factory's state is read from: the main process, for the project that is open. */
export interface FactorySource {
  /** null when there is no factory to read (the desktop app, in a repo without one) */
  state(): Promise<FactoryState | null>
  file(job: string, path: string): Promise<string>
}

// The factory's state, polled. Polling pauses while the window is hidden.
const POLL_MS = 2500

class Factory {
  state = $state<FactoryState | null>(null)
  error = $state<string | null>(null)
  lastOk = $state<number | null>(null)
  // there is no source until a project is open
  #source: FactorySource | null = null
  #timer: ReturnType<typeof setInterval> | null = null

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
    void this.refresh()
    this.#timer = setInterval(() => !document.hidden && this.refresh(), POLL_MS)
    const onVisible = () => !document.hidden && this.refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (this.#timer) clearInterval(this.#timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

export const factory = new Factory()

export const readFile = (job: string, path: string) => factory.file(job, path)
