import { getContext, setContext } from 'svelte'
import type { Route } from './app.svelte'

/** What a view knows about the panel it is shown in. Views navigate through this, never through the whole app. */
export interface Tile {
  readonly id: string
  /** what this panel shows */
  readonly route: Route
  /** the panel keyboard shortcuts go to */
  readonly active: boolean
  /** show something else in this panel */
  go(route: Route): void
  /**
   * Show something next to this panel, splitting it if there is no empty panel to use. A split is along the
   * panel's longer side unless `dir` says: 'col' puts the new panel below, 'row' to the right.
   */
  openBeside(route: Route, dir?: 'row' | 'col'): void
  /** close this panel; when it is the only one, show `fallback` in it instead */
  close(fallback?: Route): void
}

const KEY = Symbol('tile')
export const setTile = (tile: Tile) => setContext(KEY, tile)
export const getTile = () => getContext<Tile>(KEY)
