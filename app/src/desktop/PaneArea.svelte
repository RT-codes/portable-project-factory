<script lang="ts">
	import RotateIcon from '@lucide/svelte/icons/rotate-cw-square'
	import SplitRightIcon from '@lucide/svelte/icons/square-split-horizontal'
	import SplitDownIcon from '@lucide/svelte/icons/square-split-vertical'
	import SwapIcon from '@lucide/svelte/icons/arrow-left-right'
	import XIcon from '@lucide/svelte/icons/x'
	import { Button } from '$lib/components/ui/button/index.js'
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import { cn } from '$lib/utils'
	import type { View } from './app.svelte'
	import { keys } from './keys.svelte'
	import { layout, type Side, type SplitNode } from './layout.svelte'
	import PaneView from './PaneView.svelte'

	// The main area: the panels, tiled. The active panel carries a bar to split, turn, swap and close it.
	// Panels are placed by the rectangles the layout works out (percentages, with the theme's gaps taken off), so
	// one that moves keeps what it shows and slides to its new place. Between two halves of a split sits a handle
	// to drag. Holding Alt and dragging a panel moves it: it lands on the side of the panel under the pointer.
	let { now }: { now: number } = $props()

	let grid = $state<HTMLElement | null>(null)
	let resizing = $state<string | null>(null)

	const pct = (n: number) => `${n * 100}%`
	const viewName: Record<View, string> = {
		home: 'Home',
		board: 'Board',
		activity: 'Activity',
		changes: 'Changes',
		pulls: 'Pull requests',
		issues: 'Issues',
		code: 'Code',
		history: 'History',
		journal: 'Journal', usage: 'Usage',
		agents: 'Agents',
		edit: 'Editor',
		guide: 'Guide',
		models: 'Models and effort',
		settings: 'Appearance',
	}

	// ---- resizing a split by its handle
	function ratioAt(split: SplitNode, e: PointerEvent): number {
		const box = grid!.getBoundingClientRect()
		const r = layout.geometry.splits.get(split.id)!
		return split.dir === 'row' ? (e.clientX - box.left - r.x * box.width) / (r.w * box.width) : (e.clientY - box.top - r.y * box.height) / (r.h * box.height)
	}
	function resizeStart(split: SplitNode, e: PointerEvent) {
		if (e.button !== 0) return
		e.preventDefault()
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		resizing = split.id
	}
	function resizeMove(split: SplitNode, e: PointerEvent) {
		if (resizing === split.id) layout.setRatio(split.id, ratioAt(split, e))
	}
	function resizeEnd() {
		if (resizing) layout.save()
		resizing = null
	}
	function resizeKey(split: SplitNode, e: KeyboardEvent) {
		const step = { ArrowLeft: -0.02, ArrowUp: -0.02, ArrowRight: 0.02, ArrowDown: 0.02 }[e.key]
		if (step === undefined) return
		e.preventDefault()
		layout.setRatio(split.id, split.ratio + step)
		layout.save()
	}

	// ---- moving a panel: Alt + drag
	let lastDrop = ''
	function paneDown(e: PointerEvent, id: string) {
		layout.focus(id)
		if (!e.altKey || e.button !== 0 || layout.single) return
		// the panel is being moved, not clicked: nothing inside it should react
		e.preventDefault()
		e.stopPropagation()
		layout.dragging = id
		lastDrop = ''
		window.addEventListener('pointermove', dragMove)
		window.addEventListener('pointerup', dragEnd, { once: true })
		window.addEventListener('pointercancel', dragEnd, { once: true })
	}
	function dragMove(e: PointerEvent) {
		const id = layout.dragging
		if (!id || !grid) return
		const box = grid.getBoundingClientRect()
		const fx = (e.clientX - box.left) / box.width
		const fy = (e.clientY - box.top) / box.height
		for (const [target, r] of layout.geometry.panes) {
			if (fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue
			// over itself: it is where it was just put
			if (target === id) return
			// which of the panel's four edges the pointer is nearest to
			const u = (fx - r.x) / r.w
			const v = (fy - r.y) / r.h
			const side: Side = u < v ? (u < 1 - v ? 'left' : 'bottom') : u > 1 - v ? 'right' : 'top'
			const drop = `${target}:${side}`
			if (drop !== lastDrop) {
				lastDrop = drop
				layout.move(id, target, side)
			}
			return
		}
	}
	function dragEnd() {
		window.removeEventListener('pointermove', dragMove)
		layout.dragging = null
		layout.save()
	}

	const tools = $derived([
		{ label: 'Split right', keys: keys.text('pane.split.right'), icon: SplitRightIcon, off: !layout.canSplit, run: () => layout.split('row') },
		{ label: 'Split down', keys: keys.text('pane.split.down'), icon: SplitDownIcon, off: !layout.canSplit, run: () => layout.split('col') },
		{ label: 'Turn the split: side by side or stacked', keys: keys.text('pane.rotate'), icon: RotateIcon, off: layout.single, run: () => layout.rotate() },
		{ label: 'Swap with its neighbour', keys: keys.text('pane.swap'), icon: SwapIcon, off: layout.single, run: () => layout.swap() },
		{ label: 'Close this panel', keys: keys.text('pane.close'), icon: XIcon, off: layout.single, run: () => layout.close() },
	])
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	<!-- one panel fills the area edge to edge; the theme's gaps apply once there is more than one -->
	<div class="relative min-h-0 flex-1 overflow-hidden" style:--pane-gap={layout.single ? '0px' : undefined} style:--pane-outer={layout.single ? '0px' : undefined}>
		<div
			bind:this={grid}
			class={cn('absolute', layout.dragging && 'cursor-grabbing select-none')}
			style:inset="calc(var(--pane-outer) - var(--pane-gap) / 2)"
			data-panes={layout.panes.length}
		>
			{#each layout.drawn as pane (pane.id)}
				{@const r = layout.geometry.panes.get(pane.id)!}
				{@const active = pane.id === layout.active.id}
				<!-- svelte-ignore a11y_no_static_element_interactions -- focus follows any click inside the panel; its content is what is interactive -->
				<div
					class={cn(
						'absolute flex',
						!resizing && 'transition-[left,top,width,height] duration-200 ease-out',
						layout.dragging === pane.id && 'z-20 opacity-90'
					)}
					style:left="calc({pct(r.x)} + var(--pane-gap) / 2)"
					style:top="calc({pct(r.y)} + var(--pane-gap) / 2)"
					style:width="calc({pct(r.w)} - var(--pane-gap))"
					style:height="calc({pct(r.h)} - var(--pane-gap))"
					data-pane={pane.id}
					data-active={active}
					onpointerdowncapture={(e) => paneDown(e, pane.id)}
				>
					<div
						class={cn(
							'@container/pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background',
							!layout.single && 'rounded-xl border transition-[border-color,box-shadow]',
							!layout.single && active && 'border-primary/70 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent),0_0_18px_-6px_var(--glow)]',
							layout.dragging === pane.id && 'shadow-float',
							layout.dragging && 'pointer-events-none'
						)}
					>
						<!-- Every panel has the strip, so nothing shifts under the pointer when focus moves (a click would
						     miss what it aimed at). Only the active panel's strip carries the buttons. -->
						{@render bar(active, pane.route?.view ?? null)}
						<PaneView {pane} {now} />
					</div>
				</div>
			{/each}

			{#each layout.splits as split (split.id)}
				{@const r = layout.geometry.splits.get(split.id)!}
				{@const row = split.dir === 'row'}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- a separator that can be moved is interactive (ARIA's window splitter) -->
				<div
					role="separator"
					aria-orientation={row ? 'vertical' : 'horizontal'}
					aria-label="Resize panels"
					aria-valuenow={Math.round(split.ratio * 100)}
					aria-valuemin="10"
					aria-valuemax="90"
					tabindex="0"
					class={cn(
						'group/handle absolute z-10 grid touch-none place-items-center focus-visible:outline-none',
						row ? 'cursor-col-resize' : 'cursor-row-resize',
						!resizing && 'transition-[left,top,width,height] duration-200 ease-out',
						layout.dragging && 'pointer-events-none'
					)}
					style:left={row ? `calc(${pct(r.x + r.w * split.ratio)} - max(var(--pane-gap), 10px) / 2)` : `calc(${pct(r.x)} + var(--pane-gap) / 2)`}
					style:top={row ? `calc(${pct(r.y)} + var(--pane-gap) / 2)` : `calc(${pct(r.y + r.h * split.ratio)} - max(var(--pane-gap), 10px) / 2)`}
					style:width={row ? 'max(var(--pane-gap), 10px)' : `calc(${pct(r.w)} - var(--pane-gap))`}
					style:height={row ? `calc(${pct(r.h)} - var(--pane-gap))` : 'max(var(--pane-gap), 10px)'}
					data-split={split.dir}
					onpointerdown={(e) => resizeStart(split, e)}
					onpointermove={(e) => resizeMove(split, e)}
					onpointerup={resizeEnd}
					onpointercancel={resizeEnd}
					onkeydown={(e) => resizeKey(split, e)}
					ondblclick={() => (layout.setRatio(split.id, 0.5), layout.save())}
				>
					<span
						class={cn(
							'bg-muted-foreground/40 transition-colors group-hover/handle:bg-primary group-focus-visible/handle:bg-primary',
							row ? 'h-9 w-1' : 'h-1 w-9',
							resizing === split.id && 'bg-primary'
						)}
						style:border-radius="9999px"
					></span>
				</div>
			{/each}
		</div>
	</div>
</div>

{#snippet bar(active: boolean, shows: View | null)}
	<div class={cn('flex h-8 shrink-0 items-center gap-0.5 border-b px-1.5', active ? 'bg-muted/40' : 'text-muted-foreground')} role={active ? 'toolbar' : undefined} aria-label={active ? 'Panels' : undefined}>
		{#if !active}
			<span class="truncate px-1.5 text-[0.6875rem]">{shows ? viewName[shows] : 'Empty'}</span>
		{:else}
		{#each tools as tool, i (tool.label)}
			{#if i === 2}<span class="mx-1 h-4 border-s"></span>{/if}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-xs" class="size-6" disabled={tool.off} onclick={tool.run} aria-label={tool.label}><tool.icon class="size-3.5" /></Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom">{tool.label}{#if tool.keys} <span class="ms-1 font-mono opacity-70">{tool.keys}</span>{/if}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
		{#if !layout.single}
			<span class="ms-auto min-w-0 truncate ps-3 text-[0.6875rem] text-muted-foreground">
				hold <kbd class="rounded border bg-muted px-1 font-mono">Alt</kbd> and drag to move
			</span>
		{/if}
		{/if}
	</div>
{/snippet}
