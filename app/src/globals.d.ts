interface Window {
  /** Set by electron/preload.ts; absent in a browser. */
  factoryApp?: {
    platform: string
    invoke(method: string, args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>
    onEvent(listener: (name: string) => void): () => void
  }
}
