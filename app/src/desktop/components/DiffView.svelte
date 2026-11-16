<script lang="ts">
	import ColumnsIcon from '@lucide/svelte/icons/columns-2'
	import BothIcon from '@lucide/svelte/icons/panel-left'
	import MessageSquareIcon from '@lucide/svelte/icons/message-square'
	import RowsIcon from '@lucide/svelte/icons/rows-2'
	import SearchIcon from '@lucide/svelte/icons/search'
	import WaypointsIcon from '@lucide/svelte/icons/waypoints'
	import FileDiffIcon from '@lucide/svelte/icons/file-diff'
	import { tick } from 'svelte'
	import { SvelteSet } from 'svelte/reactivity'
	import type { Compare, DiffFile } from '$shared/api'
	import { cn } from '$lib/utils'
	import { keys } from '../keys.svelte'
	import { getTile } from '../pane'
	import { signature, STATUS_LETTER, STATUS_TONE, type ReviewHooks } from '../lib/review'
	import { buildTree, flatten } from '../lib/tree'
	import DiffFileView from './DiffFileView.svelte'
	import FileTree from './FileTree.svelte'
	import ImportGraphView from './ImportGraphView.svelte'

	// A whole diff, shown as every file's diff in one scroll (with the changed files as a tree on the left), as the
	// import graph of the change, or as both: the graph on the left and the diff on the right, with a handle between
	// to drag. In the graph, a changed file brings its diff up on the right; any other file opens in a panel below.
	// j / k step through files, v marks the current one as viewed.
	let {
		project,
		compare,
		hooks = null,
		scope,
		graph = false,
		now,
		onopen,
	}: {
		project: string
		compare: Compare
		hooks?: ReviewHooks | null
		/** names this diff in storage, so the files marked as viewed are remembered per pull request or branch */
		scope: string
		/** start with the graph under the diff (until the user picks otherwise: that is remembered, per kind of diff) */
		graph?: boolean
		now: number
		onopen: (path: string) => void
	} = $props()

	const load = <T,>(key: string, fallback: T): T => {
		try {
			return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
		} catch {
			return fallback
		}
	}
	const save = (key: string, value: unknown) => {
		try {
			localStorage.setItem(key, JSON.stringify(value))
		} catch {
			/* storage is a convenience */
		}
	}

	const tile = getTile()

	let split = $state(load('factory-diff-split', false))
	type Pane = 'diff' | 'both' | 'graph'
	// svelte-ignore state_referenced_locally -- which kind of diff this is does not change while it is shown
	const paneKey = `factory-diff-pane:${graph ? 'changes' : 'review'}`
	// svelte-ignore state_referenced_locally
	let pane = $state<Pane>((['diff', 'both', 'graph'] as const).find((p) => p === load<string>(paneKey, '')) ?? (graph ? 'both' : 'diff'))
	/** with both shown: the share of the width the graph takes */
	const RATIO = 'factory-diff-graph-share'
	let ratio = $state(Math.min(0.85, Math.max(0.15, Number(load(RATIO, 0.5)) || 0.5)))
	let stack = $state<HTMLElement | null>(null)
	let resizing = $state(false)
	let filter = $state('')
	let active = $state<string | null>(null)
	let scroller = $state<HTMLElement | null>(null)
	const toggled = new SvelteSet<string>()

	// path -> the signature of the diff that was viewed
	const viewedKey = $derived(`factory-viewed:${project}:${scope}`)
	let viewedMap = $state<Record<string, string>>({})
	$effect(() => {
		viewedMap = load(viewedKey, {})
	})
	const signatures = $derived(new Map(compare.files.map((f) => [f.path, signature(f)])))
	const isViewed = (path: string) => viewedMap[path] !== undefined && viewedMap[path] === signatures.get(path)
	function setViewed(path: string, viewed: boolean) {
		const next = { ...viewedMap }
		if (viewed) next[path] = signatures.get(path)!
		else delete next[path]
		viewedMap = next
		save(viewedKey, next)
	}

	const shown = $derived(filter.trim() ? compare.files.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase())) : compare.files)
	const tree = $derived(buildTree(shown))
	/** the files in the order the tree lists them: the order they are stacked in, too */
	const ordered = $derived(flatten(tree))
	const totals = $derived({
		additions: compare.files.reduce((n, f) => n + f.additions, 0),
		deletions: compare.files.reduce((n, f) => n + f.deletions, 0),
		viewed: compare.files.filter((f) => isViewed(f.path)).length,
	})
	const comments = $derived.by(() => {
		const count = new Map<string, number>()
		for (const t of hooks?.threads ?? []) if (!t.resolved) count.set(t.path, (count.get(t.path) ?? 0) + 1)
		for (const d of hooks?.drafts ?? []) count.set(d.path, (count.get(d.path) ?? 0) + 1)
		return count
	})

	const sectionOf = (path: string) => scroller?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`)

	async function goTo(path: string) {
		// from the graph alone: the diff comes up beside it
		if (pane === 'graph') pane = 'both'
		active = path
		await tick()
		sectionOf(path)?.scrollIntoView({ block: 'start' })
	}

	// the file under the top edge of the scroll area is the current one
	let frame = 0
	function onscroll() {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(() => {
			if (!scroller) return
			const top = scroller.getBoundingClientRect().top + 64
			let current: string | null = null
			for (const el of scroller.querySelectorAll<HTMLElement>('[data-file]')) {
				if (el.getBoundingClientRect().top > top) break
				current = el.dataset.file!
			}
			active = current ?? ordered[0]?.path ?? null
		})
	}

	function onkeydown(e: KeyboardEvent) {
		// with several panels open, the keys go to the one that has focus
		if (e.defaultPrevented || pane === 'graph' || !tile.active) return
		const target = e.target as HTMLElement
		// typing is typing; a ticked checkbox or a pressed button is not
		if (target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable], [role="dialog"]')) return
		const key = keys.find(e)
		const i = ordered.findIndex((f) => f.path === (active ?? ordered[0]?.path))
		if (key === 'diff.next' && i < ordered.length - 1) void goTo(ordered[i + 1].path)
		else if (key === 'diff.prev' && i > 0) void goTo(ordered[i - 1].path)
		else if (key === 'diff.viewed' && i >= 0) {
			const path = ordered[i].path
			setViewed(path, !isViewed(path))
			// viewed: on to the next file that is not
			const next = ordered.slice(i + 1).find((f) => !isViewed(f.path))
			if (isViewed(path) && next) void goTo(next.path)
		} else return
		e.preventDefault()
	}

	$effect(() => save('factory-diff-split', split))
	$effect(() => save(paneKey, pane))

	// ---- the handle between the diff and the graph
	const setRatio = (r: number) => (ratio = Math.min(0.85, Math.max(0.15, r)))
	function resizeStart(e: PointerEvent) {
		if (e.button !== 0) return
		e.preventDefault()
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		resizing = true
	}
	function resizeMove(e: PointerEvent) {
		if (!resizing || !stack) return
		const box = stack.getBoundingClientRect()
		setRatio((e.clientX - box.left) / box.width)
	}
	function resizeEnd() {
		if (resizing) save(RATIO, ratio)
		resizing = false
	}
	function resizeKey(e: KeyboardEvent) {
		const step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key]
		if (step === undefined) return
		e.preventDefault()
		setRatio(ratio + step)
		save(RATIO, ratio)
	}
</script>

<svelte:window {onkeydown} />

<div class="flex min-h-0 flex-1">
	<!-- with the graph shown, its boxes are the files: the tree makes room for it -->
	<aside class={cn('hidden w-56 shrink-0 flex-col border-e @3xl/pane:flex @6xl/pane:w-72', pane !== 'diff' && '!hidden')} aria-label="Changed files">
		<div class="p-2">
			<label class="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
				<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
				<input bind:value={filter} placeholder="Filter changed files" class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70" />
			</label>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
			{#if ordered.length === 0}
				<p class="px-2 py-3 text-xs text-muted-foreground">No file matches.</p>
			{/if}
			<FileTree nodes={tree} selected={active ?? ordered[0]?.path ?? null} defaultOpen {toggled} onpick={(f) => goTo(f.path)} dim={(f) => isViewed(f.path)}>
				{#snippet leading(f: DiffFile)}
					<span class={cn('w-3 shrink-0 text-center font-mono text-[0.6875rem] font-semibold', STATUS_TONE[f.status])}>{STATUS_LETTER[f.status]}</span>
				{/snippet}
				{#snippet trailing(f: DiffFile)}
					{#if comments.get(f.path)}
						<span class="inline-flex shrink-0 items-center gap-0.5 text-[0.625rem] text-tone-amber tabular-nums"><MessageSquareIcon class="size-3" />{comments.get(f.path)}</span>
					{/if}
					<span class="shrink-0 font-mono text-[0.625rem] tabular-nums">
						{#if f.additions}<span class="text-tone-green">+{f.additions}</span>{/if}
						{#if f.deletions}<span class="ms-0.5 text-tone-rose">-{f.deletions}</span>{/if}
					</span>
				{/snippet}
			</FileTree>
		</div>
		<p class="shrink-0 border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
			{@render key('diff.next')} {@render key('diff.prev')} next / previous ·
			{@render key('diff.viewed')} viewed
		</p>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex h-11 shrink-0 items-center gap-3 overflow-hidden border-b px-4 text-xs whitespace-nowrap">
			<span class="shrink-0 text-muted-foreground">
				<span class="font-medium text-foreground tabular-nums">{compare.files.length}</span>
				{compare.files.length === 1 ? 'file' : 'files'}
				<span class="ms-1.5 font-mono text-tone-green tabular-nums">+{totals.additions}</span>
				<span class="ms-1 font-mono text-tone-rose tabular-nums">-{totals.deletions}</span>
			</span>
			<span class="hidden items-center gap-2 text-muted-foreground @2xl/pane:flex" title="Files marked as viewed">
				<span class="h-1 w-20 overflow-hidden rounded-full bg-muted">
					<span class="block h-full rounded-full bg-primary transition-[width]" style:width="{compare.files.length ? (totals.viewed / compare.files.length) * 100 : 0}%"></span>
				</span>
				<span class="tabular-nums">{totals.viewed}/{compare.files.length} viewed</span>
			</span>

			<div class="ms-auto flex shrink-0 items-center gap-2">
				{#if pane !== 'graph'}
					{@render segment([
						{ value: false, label: 'Unified', icon: RowsIcon },
						{ value: true, label: 'Split', icon: ColumnsIcon },
					], split, (v) => (split = v))}
				{/if}
				{@render segment([
					{ value: 'diff' as const, label: 'Diff', icon: FileDiffIcon },
					{ value: 'both' as const, label: 'Both', icon: BothIcon },
					{ value: 'graph' as const, label: 'Graph', icon: WaypointsIcon },
				], pane, (v) => (pane = v))}
			</div>
		</div>

		<div bind:this={stack} class={cn('flex min-h-0 flex-1', resizing && 'select-none')}>
			{#if pane !== 'diff'}
				<div class="flex min-h-0 min-w-0 flex-col" style:flex="{pane === 'both' ? ratio : 1} 1 0%" data-graph>
					<!-- a changed file's diff comes up on the right; any other file opens in a panel below this one -->
					<ImportGraphView
						{project}
						head={compare.head}
						{scope}
						files={compare.files}
						viewed={isViewed}
						onpick={(path, changed) => (changed ? goTo(path) : tile.openBeside({ view: 'code', path, rev: compare.head }, 'col'))}
					/>
				</div>
			{/if}
			{#if pane === 'both'}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- a separator that can be moved is interactive (ARIA's window splitter) -->
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize the graph and the diff"
					aria-valuenow={Math.round(ratio * 100)}
					aria-valuemin="15"
					aria-valuemax="85"
					tabindex="0"
					class="group/handle grid w-2.5 shrink-0 cursor-col-resize touch-none place-items-center border-x bg-muted/40 focus-visible:outline-none"
					onpointerdown={resizeStart}
					onpointermove={resizeMove}
					onpointerup={resizeEnd}
					onpointercancel={resizeEnd}
					onkeydown={resizeKey}
					ondblclick={() => (setRatio(0.5), save(RATIO, ratio))}
				>
					<span class={cn('h-9 w-1 bg-muted-foreground/40 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary', resizing && 'bg-primary')} style:border-radius="9999px"></span>
				</div>
			{/if}
			{#if pane !== 'graph'}
				<!-- the padding is on the inner box: a file's header sticks to the very top of the scroll area, with nothing showing above it -->
				<div bind:this={scroller} {onscroll} data-scroller class="min-h-0 min-w-0 overflow-y-auto" style:flex="{pane === 'both' ? 1 - ratio : 1} 1 0%">
					<div class="space-y-3 p-4">
						{#each ordered as file (file.path)}
							<DiffFileView {project} base={compare.base} head={compare.head} {file} {split} viewed={isViewed(file.path)} {hooks} {now} onviewed={(v) => setViewed(file.path, v)} {onopen} />
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
{#snippet key(id: string)}
	{#each keys.parts(keys.binding(id)) as part, i (i)}<kbd class="rounded border bg-muted px-1 font-mono">{part.length === 1 ? part.toLowerCase() : part}</kbd>{:else}<span class="opacity-70">not set</span>{/each}
{/snippet}

{#snippet segment<V>(options: { value: V; label: string; icon: any }[], value: V, set: (v: V) => void)}
	<div class="flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group">
		{#each options as o (o.label)}
			<button
				type="button"
				class={cn(
					'flex h-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
					o.value === value && 'bg-background text-foreground shadow-xs dark:bg-input/60'
				)}
				aria-pressed={o.value === value}
				onclick={() => set(o.value)}
			>
				<o.icon class="size-3.5" />{o.label}
			</button>
		{/each}
	</div>
{/snippet}
