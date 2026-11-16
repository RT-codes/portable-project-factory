<script lang="ts">
	import type { Component, Snippet } from 'svelte'
	import { cn } from '$lib/utils'

	// A view with nothing to show: why, and what to do about it.
	let {
		icon: Icon,
		title,
		glow = false,
		class: className,
		children,
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon: Component<any>
		title: string
		glow?: boolean
		class?: string
		children?: Snippet
	} = $props()
</script>

<div class={cn('grid flex-1 place-items-center p-6', glow && 'forge-glow', className)}>
	<div class={cn('w-full max-w-md rounded-xl border bg-card p-6', glow && 'glow-card')}>
		<Icon class={cn('size-5', glow ? 'text-glow' : 'text-muted-foreground')} />
		<h2 class="mt-3 font-semibold">{title}</h2>
		<div class="mt-1 space-y-3 text-sm text-muted-foreground">{@render children?.()}</div>
	</div>
</div>
