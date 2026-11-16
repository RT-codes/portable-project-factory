<script lang="ts" generics="T extends { path: string }">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
	import type { Snippet } from 'svelte'
	import type { SvelteSet } from 'svelte/reactivity'
	import { cn } from '$lib/utils'
	import type { TreeNode } from '../lib/tree'
	import FileTree from './FileTree.svelte'

	// A folder tree. Folders open and close; `toggled` holds the ones that differ from `defaultOpen`, so a tree
	// of thousands of files can start closed and a tree of a dozen changed files can start open.
	let {
		nodes,
		depth = 0,
		selected,
		defaultOpen,
		toggled,
		onpick,
		leading,
		trailing,
		dim,
	}: {
		nodes: TreeNode<T>[]
		depth?: number
		selected: string | null
		defaultOpen: boolean
		toggled: SvelteSet<string>
		onpick: (item: T) => void
		leading?: Snippet<[T]>
		trailing?: Snippet<[T]>
		/** files drawn muted (viewed, say) */
		dim?: (item: T) => boolean
	} = $props()

	const isOpen = (path: string) => defaultOpen !== toggled.has(path)
	const toggle = (path: string) => (toggled.has(path) ? toggled.delete(path) : toggled.add(path))
</script>

<ul role={depth === 0 ? 'tree' : 'group'}>
	{#each nodes as node (node.path)}
		<li role="treeitem" aria-selected={node.path === selected} aria-expanded={node.children ? isOpen(node.path) : undefined}>
			{#if node.children}
				<button
					type="button"
					class="flex h-7 w-full items-center gap-1 rounded-md pe-2 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
					style:padding-inline-start="{depth * 12 + 4}px"
					onclick={() => toggle(node.path)}
				>
					<ChevronRightIcon class={cn('size-3.5 shrink-0 transition-transform', isOpen(node.path) && 'rotate-90')} />
					<span class="truncate">{node.name}</span>
				</button>
				{#if isOpen(node.path)}
					<FileTree nodes={node.children} depth={depth + 1} {selected} {defaultOpen} {toggled} {onpick} {leading} {trailing} {dim} />
				{/if}
			{:else if node.item}
				<button
					type="button"
					class={cn(
						'flex h-7 w-full items-center gap-1.5 rounded-md pe-2 text-left text-xs hover:bg-accent/60',
						node.path === selected && 'bg-accent text-accent-foreground',
						dim?.(node.item) && 'text-muted-foreground/70'
					)}
					style:padding-inline-start="{depth * 12 + 8}px"
					title={node.path}
					data-path={node.path}
					onclick={() => onpick(node.item!)}
				>
					{@render leading?.(node.item)}
					<span class="min-w-0 flex-1 truncate">{node.name}</span>
					{@render trailing?.(node.item)}
				</button>
			{/if}
		</li>
	{/each}
</ul>
