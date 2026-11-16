<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import { factory } from '$lib/factory.svelte'
	import { ago } from '$lib/format'
	import { cn } from '$lib/utils'

	// Whether the board is being kept up to date, and since when.
	let { now, hint = "Can't read .factory/" }: { now: number; hint?: string } = $props()

	const live = $derived(factory.lastOk !== null && now - factory.lastOk < 10_000 && !factory.error)
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<span {...props} class={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', live ? 'text-tone-green' : 'text-destructive')}>
				<span class={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-tone-green' : 'bg-destructive')}></span>
				{live ? 'Live' : 'Offline'}
			</span>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		{#if factory.error}
			{hint}: {factory.error}
		{:else if factory.lastOk}
			Updated {ago(factory.lastOk, now)}, refreshes every few seconds
		{:else}
			Connecting…
		{/if}
	</Tooltip.Content>
</Tooltip.Root>
