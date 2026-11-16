import type { Component } from 'svelte'

// Stage icons are Lucide names from config.json ("notebook-pen"). The whole icon set is one lazily loaded chunk, so
// any name works and the first paint does not wait for it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Icon = Component<any>
let all: Record<string, Icon> | null = null
let loading: Promise<Record<string, Icon>> | null = null

const pascal = (name: string) => name.replace(/(^|[-_ ])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())

export function cachedIcon(name: string): Icon | null | undefined {
  if (!all) return undefined
  return all[pascal(name)] ?? null
}

export async function loadIcon(name: string): Promise<Icon | null> {
  loading ??= import('@lucide/svelte/icons').then((m) => (all = m.icons as unknown as Record<string, Icon>))
  await loading
  return cachedIcon(name) ?? null
}
