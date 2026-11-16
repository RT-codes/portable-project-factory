<script lang="ts">
	import ChevronIcon from '@lucide/svelte/icons/chevron-right'
	import FolderIcon from '@lucide/svelte/icons/folder'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import MaximizeIcon from '@lucide/svelte/icons/maximize'
	import MinusIcon from '@lucide/svelte/icons/minus'
	import PlusIcon from '@lucide/svelte/icons/plus'
	import type { DiffFile, ImportGraph } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { tick } from 'svelte'
	import { fade } from 'svelte/transition'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { BOX_H, BOX_W, DEFAULT_OPTIONS, FOLDER_HEAD, layout, type Box, type Chip } from '../lib/graph'
	import { STATUS_TONE } from '../lib/review'

	// The change as a graph. On the left a map of the project, a box per folder: the changed files are lit in it,
	// and the files that import them stand out (what the change can reach). Right of the map the changed files in
	// one column, each tied to its place on the map, and right of them the files they import (what the change leans
	// on). An arrow reads "imports".
	let {
		project,
		head,
		scope,
		files,
		viewed,
		onpick,
	}: {
		project: string
		head: string
		/** names this diff (a pull request, a branch, the checkout): where the graph was left is remembered for each */
		scope: string
		files: DiffFile[]
		viewed: (path: string) => boolean
		/** a box was clicked */
		onpick: (path: string, changed: boolean) => void
	} = $props()

	let graph = $state<ImportGraph | null>(null)
	let error = $state<string | null>(null)
	let stage = $state<HTMLElement | null>(null)
	let hover = $state<string | null>(null)
	/** where the graph is drawn now; it glides to `target` (see `moveTo`) */
	let view = $state({ x: 0, y: 0, k: 1 })
	let fitted = false

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

	// what the user chose, remembered: the background, and what is left out of the graph
	const BACKDROPS = ['dots', 'grid', 'plain'] as const
	let backdrop = $state<(typeof BACKDROPS)[number]>(BACKDROPS.find((b) => b === load<string>('factory-graph-backdrop', '')) ?? 'dots')
	let onlyAffected = $state(load<unknown>('factory-graph-affected', false) === true)
	let showImports = $state(load<unknown>('factory-graph-imports', true) !== false)
	$effect(() => save('factory-graph-backdrop', backdrop))
	$effect(() => save('factory-graph-affected', onlyAffected))
	$effect(() => save('factory-graph-imports', showImports))
	/** chips as tall as their files are long, and how much so (0 to 1) */
	const number = (key: string, fallback: number, min: number, max: number) => {
		const n = Number(load<unknown>(key, fallback))
		return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
	}
	let scaled = $state(load<unknown>('factory-graph-scaled', true) !== false)
	let scale = $state(number('factory-graph-scale', DEFAULT_OPTIONS.scale, 0.1, 1))
	/** lines with square corners, and how far apart they run (0 to 10 px) */
	let angular = $state(load<unknown>('factory-graph-angular', false) === true)
	let spacing = $state(number('factory-graph-spacing', DEFAULT_OPTIONS.spacing, 0, 10))
	$effect(() => save('factory-graph-scaled', scaled))
	$effect(() => save('factory-graph-scale', scale))
	$effect(() => save('factory-graph-angular', angular))
	$effect(() => save('factory-graph-spacing', spacing))

	$effect(() => {
		let current = true
		graph = null
		error = null
		fitted = false
		api.importGraph(project, head, files.map((f) => f.path)).then(
			(g) => current && (graph = g),
			(e) => current && (error = message(e))
		)
		return () => (current = false)
	})

	// ---- file types: any of them can be left out of the graph (remembered, for every project)
	const typeOf = (path: string) => {
		const name = path.slice(path.lastIndexOf('/') + 1)
		const dot = name.lastIndexOf('.')
		return dot < 0 ? 'no extension' : name.slice(dot + 1).toLowerCase() || 'no extension'
	}
	let hiddenTypes = $state<string[]>((() => {
		const saved = load<unknown>('factory-graph-hidden-types', [])
		return Array.isArray(saved) ? saved.filter((t): t is string => typeof t === 'string') : []
	})())
	$effect(() => save('factory-graph-hidden-types', hiddenTypes))
	let typesOpen = $state(false)
	/** the options can be folded away too, to leave a small graph its room; remembered */
	let optionsOpen = $state(load<unknown>('factory-graph-options-open', true) !== false)
	$effect(() => save('factory-graph-options-open', optionsOpen))
	/** the types in this project, the most common first, with how many files each has */
	const types = $derived.by(() => {
		const count = new Map<string, number>()
		for (const path of new Set([...(graph?.files ?? []), ...(graph?.nodes ?? []).map((n) => n.path)])) count.set(typeOf(path), (count.get(typeOf(path)) ?? 0) + 1)
		return [...count].map(([type, files]) => ({ type, files })).sort((a, b) => b.files - a.files || a.type.localeCompare(b.type))
	})
	const hiddenHere = $derived(types.filter((t) => hiddenTypes.includes(t.type)).length)
	function setType(type: string, on: boolean) {
		hiddenTypes = on ? hiddenTypes.filter((t) => t !== type) : [...new Set([...hiddenTypes, type])]
		void refit()
	}
	function setAllTypes(on: boolean) {
		const here = types.map((t) => t.type)
		hiddenTypes = on ? hiddenTypes.filter((t) => !here.includes(t)) : [...new Set([...hiddenTypes, ...here])]
		void refit()
	}
	/** the graph without the files of the types that are switched off, and without the lines to and from them */
	const shown = $derived.by(() => {
		if (!graph || !hiddenHere) return graph
		const off = new Set(hiddenTypes)
		const keep = (path: string) => !off.has(typeOf(path))
		return { ...graph, nodes: graph.nodes.filter((n) => keep(n.path)), edges: graph.edges.filter((e) => keep(e.from) && keep(e.to)), files: graph.files.filter(keep) }
	})

	const laid = $derived(shown ? layout(shown, files, { affected: onlyAffected, imports: showImports, scale: scaled ? scale : 0, angular, spacing }) : null)
	/** the chip or box under the pointer, and everything a line ties it to (by id: a changed file is drawn twice) */
	const near = $derived.by(() => {
		if (!hover || !laid) return null
		const set = new Set([hover])
		for (const l of laid.links) {
			if (l.from === hover) set.add(l.to)
			if (l.to === hover) set.add(l.from)
		}
		return set
	})
	const counts = $derived({
		changed: shown?.nodes.filter((n) => n.kind === 'changed').length ?? 0,
		dependents: shown?.nodes.filter((n) => n.kind === 'dependent').length ?? 0,
		dependencies: shown?.nodes.filter((n) => n.kind === 'dependency').length ?? 0,
		hidden: shown?.nodes.reduce((n, x) => n + (x.hiddenDependents ?? 0), 0) ?? 0,
	})

	// ---- moving: every move sets a target, and the view glides to it. Wheel steps and button presses add up in
	// the target, so a quick series of them is one smooth move. Only the transform of one element changes per frame.
	/** how fast the view closes in on its target: the time, in ms, to cover about two thirds of what is left */
	const EASE = 110
	/** the height the panels at the top take from the stage */
	const TOP = 44
	let target = { x: 0, y: 0, k: 1 }
	let frame = 0
	let last = 0
	// where the graph was left (place and zoom) is kept for each diff, so coming back to it finds it as it was
	// svelte-ignore state_referenced_locally -- which diff this is does not change while it is shown
	const viewKey = `factory-graph-view:${project}:${scope}`
	let saving: ReturnType<typeof setTimeout> | undefined
	function remember() {
		clearTimeout(saving)
		saving = setTimeout(() => save(viewKey, target), 200)
	}
	function recall(): { x: number; y: number; k: number } | null {
		const v = load<Partial<{ x: number; y: number; k: number }> | null>(viewKey, null)
		const ok = v && [v.x, v.y, v.k].every((n) => typeof n === 'number' && Number.isFinite(n)) && v.k! >= 0.15 && v.k! <= 2
		return ok ? { x: v.x!, y: v.y!, k: v.k! } : null
	}
	function step(now: number) {
		const a = 1 - Math.exp(-Math.min(64, now - last) / EASE)
		last = now
		const next = { x: view.x + (target.x - view.x) * a, y: view.y + (target.y - view.y) * a, k: view.k + (target.k - view.k) * a }
		if (Math.abs(target.x - next.x) < 0.25 && Math.abs(target.y - next.y) < 0.25 && Math.abs(target.k - next.k) < 0.0005) {
			view = { ...target }
			frame = 0
			return
		}
		view = next
		frame = requestAnimationFrame(step)
	}
	function moveTo(next: { x: number; y: number; k: number }, at_once = false) {
		target = next
		remember()
		if (at_once) {
			cancelAnimationFrame(frame)
			frame = 0
			view = { ...next }
		} else if (!frame) {
			last = performance.now()
			frame = requestAnimationFrame(step)
		}
	}
	$effect(() => () => {
		cancelAnimationFrame(frame)
		// leaving before the wait is over: what was last aimed at is what is kept
		if (saving !== undefined) {
			clearTimeout(saving)
			save(viewKey, target)
		}
	})

	function fit(at_once = false) {
		if (!stage || !laid) return
		const w = stage.clientWidth
		// the panels at the top float over the graph: it is fitted into what is below them
		const h = stage.clientHeight - TOP
		// never so small that the names are hard to read; what does not fit then is reached by panning
		const k = Math.max(0.8, Math.min(1, w / laid.width, h / laid.height))
		// too wide: the right end stays in sight (the changed files and what they import), the map runs off to the left.
		// too tall: the changed files are centred.
		const x = laid.width * k <= w ? (w - laid.width * k) / 2 : w - laid.width * k
		const y = TOP + (laid.height * k <= h ? (h - laid.height * k) / 2 : Math.min(0, Math.max(h - laid.height * k, h / 2 - (laid.focus.y + laid.focus.h / 2) * k)))
		moveTo({ k, x, y }, at_once)
	}
	$effect(() => {
		if (laid && stage && !fitted) {
			fitted = true
			const left = recall()
			if (left) moveTo(left, true)
			else fit(true)
		}
	})
	/** An option changed what is drawn: once it is laid out anew, glide to where it fits. */
	const refit = () => tick().then(() => fit())

	/** Zoom by a factor around a point of the stage (its middle unless told), from where the view is heading. */
	function zoom(factor: number, cx?: number, cy?: number) {
		if (!stage) return
		const px = cx ?? stage.clientWidth / 2
		const py = cy ?? stage.clientHeight / 2
		const k = Math.min(2, Math.max(0.15, target.k * factor))
		moveTo({ k, x: px - ((px - target.x) / target.k) * k, y: py - ((py - target.y) / target.k) * k })
	}

	function onwheel(e: WheelEvent) {
		e.preventDefault()
		const rect = stage!.getBoundingClientRect()
		if (e.ctrlKey || e.metaKey) {
			// a notch of a mouse wheel is a small step (about 13%), however far the system says it turned; a pinch
			// on a touchpad comes as many small steps and stays as fine as it is
			const turn = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 16)
			zoom(Math.exp(-turn * 0.0075), e.clientX - rect.left, e.clientY - rect.top)
		} else moveTo({ ...target, x: target.x - e.deltaX * 0.8, y: target.y - e.deltaY * 0.8 })
	}

	// the background moves and scales with the graph; zoomed far out, every other dot is left out, and again
	const tile = $derived.by(() => {
		let size = 24 * view.k
		while (size < 14) size *= 2
		return size
	})

	// Nothing in the graph can be selected as text, or dragged the way the browser drags a selection or a link: a
	// drag is always a pan. (A selection left by one drag used to make the next drag one of those: the pan stopped
	// after a few pixels.)
	let drag: { x: number; y: number; moved: boolean } | null = null
	/** What the pointer is over is only lit while the graph is still: a graph gliding under a resting pointer would
	    light and dim everything it passes, and restyle the whole graph each time. */
	function point(id: string | null) {
		if (id === null) hover = null
		else if (!drag?.moved && !frame) hover = id
	}
	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0) return
		drag = { x: e.clientX, y: e.clientY, moved: false }
	}
	function onpointermove(e: PointerEvent) {
		if (!drag) return
		const dx = e.clientX - drag.x
		const dy = e.clientY - drag.y
		if (!drag.moved && Math.hypot(dx, dy) < 4) return
		if (!drag.moved) {
			stage?.setPointerCapture(e.pointerId)
			hover = null
		}
		drag = { x: e.clientX, y: e.clientY, moved: true }
		// a drag is followed as it is: the graph stays under the pointer
		moveTo({ ...view, x: view.x + dx, y: view.y + dy }, true)
	}
	function onpointerup() {
		// a drag that ends on a box must not count as a click on it
		const moved = drag?.moved
		drag = null
		if (moved) window.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true })
	}

	/** how the things in the graph move to a new place, and come and go */
	const GLIDE = 'transition-[transform,width,height,opacity,border-color] duration-300 ease-out'
	const FADE = { duration: 200 }
	const boxTone = (b: Box) => (b.kind === 'changed' ? 'border-foreground/20 bg-card' : 'border-dashed border-foreground/25 bg-background text-muted-foreground')
	const chipTone = (c: Chip) =>
		c.role === 'changed'
			? // lit in the colour of what happened to the file
				cn(STATUS_TONE[c.file?.status ?? 'modified'], 'border-current bg-[color-mix(in_oklab,currentColor_16%,var(--background))] font-medium shadow-[0_0_12px_-3px_currentColor]')
			: c.role === 'dependent'
				? 'border-foreground/45 bg-card text-foreground'
				: 'border-border bg-background text-muted-foreground'
	/** a folder's background: the card, a little lighter for every folder it is inside of */
	const shade = (depth: number) => `color-mix(in oklab, var(--card), var(--foreground) ${Math.min(depth, 6) * 2.5}%)`
	const LEGEND = [
		{ tone: STATUS_TONE.added, label: 'Added' },
		{ tone: STATUS_TONE.modified, label: 'Changed' },
		{ tone: STATUS_TONE.deleted, label: 'Removed' },
		{ tone: STATUS_TONE.renamed, label: 'Renamed' },
	]
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
	{#if error}
		<p class="p-6 text-sm text-destructive">Could not build the graph: {error}</p>
	{:else if !laid || !graph}
		<p class="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Reading imports…</p>
	{:else}
		<div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
			<span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-sm border border-current bg-[color-mix(in_oklab,currentColor_16%,var(--background))] text-tone-amber"></span>{counts.changed} changed</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm border border-foreground/45 bg-card"></span>{counts.dependents} importing them{counts.hidden ? ` (+${counts.hidden} more)` : ''}
			</span>
			<span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-sm border border-dashed border-foreground/40"></span>{counts.dependencies} imported by them</span>
			<span class="inline-flex items-center gap-1.5">
				<svg viewBox="0 0 28 8" class="h-2 w-7" aria-hidden="true"><path d="M0 4h24M20 1l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.25" /></svg>imports
			</span>
			<span class="ms-auto">{shown?.files.length ?? 0} project files{graph.hiddenFiles ? ` (+${graph.hiddenFiles} further away)` : ''}{laid.folders.some((f) => f.folded !== null) ? ', untouched folders folded' : ''}</span>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -- pan and zoom are a mouse convenience; every box is a button -->
		<div
			bind:this={stage}
			class="forge-glow relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
			{onwheel}
			ondragstart={(e) => e.preventDefault()}
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			onpointercancel={onpointerup}
		>
			{#if backdrop !== 'plain'}
				<!-- a sheet a tile larger than the stage on every side, shifted by what is left of the pan after whole
				     tiles: moving it is a transform, and nothing is painted again -->
				<div
					class="pointer-events-none absolute will-change-transform"
					style:inset="-{tile}px"
					style:background-image={backdrop === 'dots'
						? 'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1.5px)'
						: 'linear-gradient(to right, color-mix(in oklab, var(--foreground) 5.5%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 5.5%, transparent) 1px, transparent 1px)'}
					style:background-size="{tile}px {tile}px"
					style:transform="translate({((view.x % tile) + tile) % tile}px, {((view.y % tile) + tile) % tile}px)"
					data-backdrop={backdrop}
				></div>
			{/if}
			<!-- Everything in here is placed with a transform and glides when the layout changes (an option, a new diff);
			     what appears or goes fades. Panning and zooming only change the transform of this one box. -->
			<div class="absolute top-0 left-0 origin-top-left will-change-transform" style:width="{laid.width}px" style:height="{laid.height}px" style:transform="translate({view.x}px, {view.y}px) scale({view.k})" data-canvas>
				<!-- the folders of the map, under the lines: a line from a chip runs over the folders it is in, and under the chips.
				     Every level of the tree is a shade lighter, and nothing shows through. -->
				{#each laid.folders as f (f.dir)}
					<div
						class={cn('absolute top-0 left-0 rounded-lg border', GLIDE)}
						style:background={shade(f.depth)}
						style:transform="translate({f.x}px, {f.y}px)"
						style:width="{f.w}px"
						style:height="{f.h}px"
						transition:fade={FADE}
						data-folder={f.dir}
						data-folded={f.folded !== null}
					></div>
				{/each}
				<svg width={laid.width} height={laid.height} class="absolute inset-0 overflow-visible" aria-hidden="true">
					<defs>
						<marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1l6 3-6 3" fill="none" stroke="context-stroke" stroke-width="1.25" /></marker>
					</defs>
					{#each laid.links as l (l.kind + l.from + '\n' + l.to)}
						{@const lit = near !== null && (l.from === hover || l.to === hover)}
						{#if l.kind === 'same'}
							<!-- a changed file's place on the map, tied to its box: in the colour of what happened to it -->
							<path style:d="path('{l.d}')" fill="none" stroke-linejoin="round" transition:fade={FADE} class={cn('stroke-current transition-[d,opacity] duration-300 ease-out', STATUS_TONE[l.file?.status ?? 'modified'], near && !lit ? 'opacity-20' : lit ? 'opacity-100' : 'opacity-70')} stroke-width={lit ? 2 : 1.5} data-tie />
						{:else}
							<path
								style:d="path('{l.d}')"
								fill="none"
								stroke-linejoin="round"
								marker-end="url(#arrow)"
								transition:fade={FADE}
								class={cn('transition-[d,opacity] duration-300 ease-out', lit ? 'stroke-glow' : 'stroke-muted-foreground/45', near && !lit && 'opacity-25')}
								stroke-width={lit ? 1.75 : 1.25}
							/>
						{/if}
					{/each}
				</svg>
				<!-- the names of the folders, over the lines: a line never runs through a name (and is only hidden by the name,
				     not by the whole top edge of the folder) -->
				{#each laid.folders as f (f.dir)}
					<p
						class={cn('pointer-events-none absolute top-0 left-0 flex w-fit items-center gap-1.5 rounded-lg px-2 font-mono text-[0.625rem] text-muted-foreground', GLIDE)}
						style:background={shade(f.depth)}
						style:transform="translate({f.x + 1}px, {f.y + 1}px)"
						style:max-width="{f.w - 2}px"
						style:height="{FOLDER_HEAD - 2}px"
						transition:fade={FADE}
						title={f.dir}
					>
						<FolderIcon class="size-3 shrink-0 opacity-70" />
						<span class="min-w-0 truncate">{f.label}/</span>
						{#if f.folded !== null}<span class="shrink-0 opacity-70">· {f.folded} {f.folded === 1 ? 'file' : 'files'}</span>{/if}
					</p>
				{/each}
				{#each laid.chips as c (c.id)}
					<button
						type="button"
						class={cn(
							'absolute top-0 left-0 flex flex-col justify-center rounded-md border px-2 text-left font-mono text-[0.6875rem] leading-4 hover:border-glow/70',
							GLIDE,
							chipTone(c),
							near && !near.has(c.id) && c.role !== 'plain' && 'opacity-35'
						)}
						style:transform="translate({c.x}px, {c.y}px)"
						transition:fade={FADE}
						style:width="{c.w}px"
						style:height="{c.h}px"
						title="{c.path}{c.lines !== null ? ` · ${c.lines} lines` : ''}{c.role === 'changed' ? ' (changed)' : c.role === 'dependent' ? ' (imports a changed file)' : ''}"
						data-map={c.path}
						data-role={c.role}
						onpointerenter={() => point(c.id)}
						onpointerleave={() => point(null)}
						onclick={() => onpick(c.path, c.role === 'changed')}
					>
						<span class="w-full truncate">{c.name}</span>
						<!-- a tall chip has room to say how long the file is -->
						{#if c.lines !== null && c.h >= 42}<span class="w-full truncate text-[0.5625rem] leading-3 opacity-60">{c.lines} lines</span>{/if}
					</button>
				{/each}
				{#each laid.boxes as b (b.id)}
					<button
						type="button"
						class={cn(
							'absolute top-0 left-0 flex items-center gap-2 rounded-lg border px-2.5 text-left shadow-sm hover:border-glow/70',
							GLIDE,
							boxTone(b),
							near && !near.has(b.id) && 'opacity-35',
							b.kind === 'changed' && viewed(b.path) && 'opacity-60'
						)}
						style:transform="translate({b.x}px, {b.y}px)"
						transition:fade={FADE}
						style:width="{BOX_W}px"
						style:height="{BOX_H}px"
						title={b.path}
						data-node={b.path}
						onpointerenter={() => point(b.id)}
						onpointerleave={() => point(null)}
						onclick={() => onpick(b.path, b.kind === 'changed')}
					>
						{#if b.file}
							<span class={cn('h-6 w-0.5 shrink-0 rounded-full bg-current', STATUS_TONE[b.file.status])}></span>
						{/if}
						<span class="min-w-0 flex-1">
							<span class={cn('block truncate font-mono text-xs', b.kind === 'changed' && 'font-medium text-foreground')}>{b.name}</span>
							<span class="block truncate font-mono text-[0.625rem] text-muted-foreground">{b.dir || '.'}</span>
						</span>
						{#if b.file}
							<span class="shrink-0 text-right font-mono text-[0.625rem] leading-tight tabular-nums">
								<span class="block text-tone-green">+{b.file.additions}</span>
								<span class="block text-tone-rose">-{b.file.deletions}</span>
							</span>
						{/if}
						{#if b.hidden > 0}
							<span class="absolute -top-2 -left-2 rounded-full border bg-muted px-1.5 font-mono text-[0.625rem] text-muted-foreground" title="{b.hidden} more files import this one">+{b.hidden}</span>
						{/if}
					</button>
				{/each}
			</div>
			<!-- the panels float over the graph: a press on them is not the start of a drag. At the top, the background on
			     the left and how to read the colours in the middle (it moves aside when there is no room for that). -->
			<div class="pointer-events-none absolute inset-x-3 top-3 grid grid-cols-[minmax(max-content,1fr)_auto_minmax(0,1fr)] items-start gap-2">
				<div class="pointer-events-auto flex items-center gap-2 justify-self-start rounded-lg border bg-card py-1 ps-2.5 pe-1 text-[0.6875rem] text-muted-foreground shadow-sm" role="group" aria-label="Background" onpointerdown={(e) => e.stopPropagation()}>
					Background
					<div class="flex h-6 items-center rounded-md bg-muted p-[3px]">
						{#each BACKDROPS as b (b)}
							<button
								type="button"
								class={cn('h-full rounded-sm px-2 font-medium capitalize transition-colors hover:text-foreground', backdrop === b && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
								aria-pressed={backdrop === b}
								onclick={() => (backdrop = b)}
							>
								{b}
							</button>
						{/each}
					</div>
				</div>
				<ul class="pointer-events-auto flex h-[2.125rem] items-center gap-4 rounded-lg border bg-card px-3.5 text-[0.6875rem] whitespace-nowrap text-muted-foreground shadow-sm" aria-label="What the colours mean" onpointerdown={(e) => e.stopPropagation()}>
					{#each LEGEND as item (item.label)}
						<li class="flex items-center gap-2">
							<span class={cn('size-2 rounded-full bg-current shadow-[0_0_8px_2px_currentColor]', item.tone)} aria-hidden="true"></span>{item.label}
						</li>
					{/each}
				</ul>
			</div>
			<div class="absolute end-3 bottom-3 flex w-60 flex-col items-end gap-2" onpointerdown={(e) => e.stopPropagation()}>
				<!-- which kinds of files are drawn: folded to one line until asked for -->
				<div class="w-full rounded-lg border bg-card text-xs text-muted-foreground shadow-sm" role="group" aria-label="File types">
					<button type="button" class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:text-foreground" aria-expanded={typesOpen} onclick={() => (typesOpen = !typesOpen)}>
						<ChevronIcon class={cn('size-3 shrink-0 transition-transform', typesOpen && 'rotate-90')} />
						<span class="flex-1">File types</span>
						<span class={cn('font-mono text-[0.625rem]', hiddenHere ? 'text-tone-amber' : 'opacity-70')}>{hiddenHere ? `${hiddenHere} hidden` : `all ${types.length}`}</span>
					</button>
					{#if typesOpen}
						<div class="border-t px-2.5 pt-1.5 pb-2">
							<ul class="max-h-44 space-y-1 overflow-y-auto pe-1" onwheel={(e) => e.stopPropagation()}>
								{#each types as t (t.type)}
									<li>
										<label class="flex cursor-pointer items-center gap-2 select-none hover:text-foreground">
											<input type="checkbox" class="size-3 accent-primary" checked={!hiddenTypes.includes(t.type)} data-type={t.type} onchange={(e) => setType(t.type, e.currentTarget.checked)} />
											<span class="flex-1 truncate font-mono text-[0.6875rem]">{t.type === 'no extension' ? t.type : `.${t.type}`}</span>
											<span class="font-mono text-[0.625rem] tabular-nums opacity-70">{t.files}</span>
										</label>
									</li>
								{/each}
							</ul>
							<div class="mt-1.5 flex gap-1 border-t pt-1.5">
								<Button variant="ghost" size="xs" class="h-5 flex-1 text-[0.6875rem]" disabled={!hiddenHere} onclick={() => setAllTypes(true)}>Show all</Button>
								<Button variant="ghost" size="xs" class="h-5 flex-1 text-[0.6875rem]" disabled={hiddenHere === types.length} onclick={() => setAllTypes(false)}>Hide all</Button>
							</div>
						</div>
					{/if}
				</div>
				<div class="w-full rounded-lg border bg-card text-xs text-muted-foreground shadow-sm" role="group" aria-label="Graph options">
					<button type="button" class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:text-foreground" aria-expanded={optionsOpen} onclick={() => (optionsOpen = !optionsOpen)}>
						<ChevronIcon class={cn('size-3 shrink-0 transition-transform', optionsOpen && 'rotate-90')} />
						<span class="flex-1">Options</span>
					</button>
					{#if optionsOpen}
						<div class="space-y-1.5 border-t px-2.5 py-2">
							<label class="flex cursor-pointer items-center gap-2 select-none hover:text-foreground">
								<input type="checkbox" class="size-3 accent-primary" bind:checked={onlyAffected} onchange={refit} />
								Only affected files
							</label>
							<label class="flex cursor-pointer items-center gap-2 select-none hover:text-foreground">
								<input type="checkbox" class="size-3 accent-primary" bind:checked={showImports} onchange={refit} />
								Files they import
							</label>
							<!-- a slider is followed as it is dragged; the view fits itself again when it is let go -->
							<div class="flex items-center gap-3">
								<label class="flex flex-1 cursor-pointer items-center gap-2 whitespace-nowrap select-none hover:text-foreground">
									<input type="checkbox" class="size-3 accent-primary" bind:checked={scaled} onchange={refit} />
									Size by length
								</label>
								<input type="range" class="h-1 w-20 accent-primary disabled:opacity-40" min="0.1" max="1" step="0.05" bind:value={scale} onchange={refit} disabled={!scaled} aria-label="How much taller a long file is" />
							</div>
							<div class="flex items-center gap-3">
								<label class="flex flex-1 cursor-pointer items-center gap-2 whitespace-nowrap select-none hover:text-foreground">
									<input type="checkbox" class="size-3 accent-primary" bind:checked={angular} onchange={refit} />
									Angular lines
								</label>
								<input type="range" class="h-1 w-20 accent-primary disabled:opacity-40" min="0" max="10" step="0.5" bind:value={spacing} onchange={refit} disabled={!angular} aria-label="Space between the lines" />
							</div>
						</div>
					{/if}
				</div>
				<div class="flex gap-1 rounded-lg border bg-card p-1 shadow-sm">
					<Button variant="ghost" size="icon-xs" onclick={() => zoom(1 / 1.25)} aria-label="Zoom out"><MinusIcon /></Button>
					<Button variant="ghost" size="icon-xs" onclick={() => zoom(1.25)} aria-label="Zoom in"><PlusIcon /></Button>
					<Button variant="ghost" size="icon-xs" onclick={() => fit()} aria-label="Fit the graph"><MaximizeIcon /></Button>
				</div>
			</div>
			{#if !laid.links.some((l) => l.kind === 'imports')}
				<p class="absolute start-4 bottom-4 max-w-sm text-xs text-muted-foreground">
					No imports found between these files and the rest of the repo. The graph reads JavaScript, TypeScript, Svelte, Vue, CSS and Python imports.
				</p>
			{/if}
		</div>
	{/if}
</div>
