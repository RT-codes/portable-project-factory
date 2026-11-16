<script lang="ts">
	import { cn } from '$lib/utils'
	import { app, type Route } from '../app.svelte'
	import { getTile } from '../pane'
	import ActivityPart from './ActivityPart.svelte'
	import BoardView from './BoardView.svelte'
	import HistoryView from './HistoryView.svelte'
	import IssuesView from './IssuesView.svelte'
	import PullsView from './PullsView.svelte'

	// What is going on in the repo, in one view. On top a strip with the pull requests, the issues and the history
	// side by side; under it the board. A pull request or an issue picked in the strip takes the board's place, and
	// its back arrow brings the board back. The parts are the views themselves (the same components), each in an
	// ActivityPart; it is all one view in one panel, so the sidebar swaps the whole of it. A handle between the
	// strip and the rest drags to share the height.
	let { now }: { now: number } = $props()
	const tile = getTile()
	const github = $derived(!!app.info?.github)
	const git = $derived(app.info ? app.info.isGit : true)

	/** what the lower part shows: the board, or the pull request / issue (or their list) picked above */
	const sub = $derived(tile.route.sub ?? null)
	const main = $derived<Route>(sub ? { view: sub, number: tile.route.number, from: 'board' } : { view: 'board', path: tile.route.path })

	/** A part asks to show something: what belongs to Activity stays in Activity, the rest takes the panel. */
	function go(route: Route) {
		if (route.view === 'pulls' || route.view === 'issues') tile.go({ view: 'activity', sub: route.view, ...(route.number !== undefined ? { number: route.number } : {}) })
		else if (route.view === 'board') tile.go({ view: 'activity', ...(route.path ? { path: route.path } : {}) })
		else tile.go(route)
	}
	/** A column of the strip shows its list, always: asked for the list itself, it has nothing to do. */
	const fromStrip = (view: Route['view']) => (route: Route) => {
		if (route.view === view && route.number === undefined) return
		go(route)
	}

	// ---- the handle between the strip and the rest
	const SHARE = 'factory-activity-share'
	const clamp = (n: number) => Math.min(0.7, Math.max(0.12, n))
	let share = $state(
		(() => {
			try {
				const n = Number(JSON.parse(localStorage.getItem(SHARE) ?? 'null'))
				return Number.isFinite(n) && n > 0 ? clamp(n) : 0.25
			} catch {
				return 0.25
			}
		})()
	)
	const keep = () => {
		try {
			localStorage.setItem(SHARE, JSON.stringify(share))
		} catch {
			/* then it lasts for this visit */
		}
	}
	let box = $state<HTMLElement | null>(null)
	let resizing = $state(false)
	function resizeStart(e: PointerEvent) {
		if (e.button !== 0) return
		e.preventDefault()
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		resizing = true
	}
	function resizeMove(e: PointerEvent) {
		if (!resizing || !box) return
		const r = box.getBoundingClientRect()
		share = clamp((e.clientY - r.top) / r.height)
	}
	function resizeEnd() {
		if (resizing) keep()
		resizing = false
	}
	function resizeKey(e: KeyboardEvent) {
		const step = { ArrowUp: -0.02, ArrowDown: 0.02 }[e.key]
		if (step === undefined) return
		e.preventDefault()
		share = clamp(share + step)
		keep()
	}
</script>

<div bind:this={box} class={cn('flex min-h-0 flex-1 flex-col', resizing && 'select-none')} data-activity>
	<!-- the strip: side by side when the panel is wide; stacked, and scrolled as one, when it is not -->
	<div class="grid min-h-0 auto-rows-max overflow-y-auto @5xl/pane:auto-rows-fr @5xl/pane:grid-flow-col @5xl/pane:auto-cols-fr @5xl/pane:overflow-hidden" style:flex="{share} 1 0%" data-strip>
		<ActivityPart route={{ view: 'pulls' }} go={fromStrip('pulls')} class={column} data-column="pulls"><PullsView {now} /></ActivityPart>
		<!-- without GitHub the two would say the same thing: once is enough -->
		{#if github}
			<ActivityPart route={{ view: 'issues' }} go={fromStrip('issues')} class={column} data-column="issues"><IssuesView {now} /></ActivityPart>
		{/if}
		{#if git}
			<ActivityPart route={{ view: 'history' }} go={fromStrip('history')} class={column} data-column="history"><HistoryView {now} /></ActivityPart>
		{/if}
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- a separator that can be moved is interactive (ARIA's window splitter) -->
	<div
		role="separator"
		aria-orientation="horizontal"
		aria-label="Resize the strip and the board"
		aria-valuenow={Math.round(share * 100)}
		aria-valuemin="12"
		aria-valuemax="70"
		tabindex="0"
		class="group/handle grid h-2.5 shrink-0 cursor-row-resize touch-none place-items-center border-y bg-muted/40 focus-visible:outline-none"
		onpointerdown={resizeStart}
		onpointermove={resizeMove}
		onpointerup={resizeEnd}
		onpointercancel={resizeEnd}
		onkeydown={resizeKey}
		ondblclick={() => ((share = 0.25), keep())}
	>
		<span class={cn('h-1 w-9 bg-muted-foreground/40 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary', resizing && 'bg-primary')} style:border-radius="9999px"></span>
	</div>

	<!-- the board, or what was picked above in its place -->
	{#key sub}
		<ActivityPart route={main} {go} class="" data-main={sub ?? 'board'} style="flex: {1 - share} 1 0%">
			{#if sub === 'pulls'}
				<PullsView {now} />
			{:else if sub === 'issues'}
				<IssuesView {now} />
			{:else}
				<BoardView {now} />
			{/if}
		</ActivityPart>
	{/key}
</div>

<script lang="ts" module>
	const column = 'min-h-[26rem] border-b last:border-b-0 @5xl/pane:min-h-0 @5xl/pane:border-e @5xl/pane:border-b-0 @5xl/pane:last:border-e-0'
</script>
