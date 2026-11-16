<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import SearchIcon from '@lucide/svelte/icons/search'
	import type { Snippet } from 'svelte'
	import { Button } from '$lib/components/ui/button/index.js'
	import { cn } from '$lib/utils'

	// The bar above a list of issues or pull requests: open / closed, a search, refresh.
	let {
		status = $bindable(),
		search = $bindable(),
		placeholder,
		loading,
		onrefresh,
		children,
	}: {
		status: 'open' | 'closed'
		/** applied when typing pauses */
		search: string
		placeholder: string
		loading: boolean
		onrefresh: () => void
		children?: Snippet
	} = $props()

	// svelte-ignore state_referenced_locally -- the field starts from the applied search and then leads it
	let typed = $state(search)
	let timer: ReturnType<typeof setTimeout> | undefined
	function oninput() {
		clearTimeout(timer)
		timer = setTimeout(() => (search = typed), 350)
	}
</script>

<div class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
	<div class="flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group">
		{#each ['open', 'closed'] as const as s (s)}
			<button
				type="button"
				class={cn(
					'h-full rounded-md px-2.5 text-xs font-medium text-muted-foreground capitalize transition-colors hover:text-foreground',
					status === s && 'bg-background text-foreground shadow-xs dark:bg-input/60'
				)}
				aria-pressed={status === s}
				onclick={() => (status = s)}
			>
				{s}
			</button>
		{/each}
	</div>
	<label class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
		<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
		<input
			bind:value={typed}
			{oninput}
			onkeydown={(e) => e.key === 'Enter' && (clearTimeout(timer), (search = typed))}
			{placeholder}
			class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70"
		/>
	</label>
	<Button variant="ghost" size="icon-sm" onclick={onrefresh} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
	{@render children?.()}
</div>
