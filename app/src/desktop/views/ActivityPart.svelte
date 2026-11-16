<script lang="ts">
	import type { Snippet } from 'svelte'
	import { cn } from '$lib/utils'
	import type { Route } from '../app.svelte'
	import { getTile, setTile } from '../pane'

	// One part of the Activity view: a whole view (pull requests, issues, history, the board) in a place of its
	// own inside Activity's panel. The view inside believes it has a panel: `route` is what it is told it shows,
	// and what it asks to show goes through `go`, which Activity turns into a route of its own. So everything
	// stays one view: the sidebar swaps all of Activity out, never a part of it.
	let { route, go, class: className, children, ...rest }: { route: Route; go: (route: Route) => void; class?: string; style?: string; children: Snippet; [key: `data-${string}`]: string } = $props()

	const tile = getTile()
	setTile({
		id: tile.id,
		get route() {
			return route
		},
		get active() {
			return tile.active
		},
		go: (next: Route) => go(next),
		openBeside: (next, dir) => tile.openBeside(next, dir),
		close: (fallback) => tile.close(fallback),
	})
</script>

<!-- a container of its own, under the panel's name: the view inside lays itself out for the room it has here -->
<section class={cn('@container/pane flex min-h-0 min-w-0 flex-col', className)} {...rest}>
	{@render children()}
</section>
