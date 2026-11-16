import type { Api } from '$shared/api'

/** The main process's api (shared/api.ts), called as plain async functions. A failure rejects with its message. */
export const api = new Proxy({} as Api, {
  get:
    (_, method: string) =>
    async (...args: unknown[]) => {
      // the api speaks JSON; reactive state (a proxy) has to be made plain before it can cross to the main process
      const res = await window.factoryApp!.invoke(method, JSON.parse(JSON.stringify(args)))
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
})

/** 'focus' when the window gets focus, 'projects' when the main process opened a project (menu, command line). */
export const onAppEvent = (listener: (name: string) => void) => window.factoryApp!.onEvent(listener)

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
