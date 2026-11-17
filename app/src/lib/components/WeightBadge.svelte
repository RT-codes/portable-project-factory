<script lang="ts">
	import type { Job } from '$lib/types'
	import { count } from '$lib/live'
	import { money, weightOf } from '$lib/usage'
	import { cn } from '$lib/utils'

	// How heavy a ticket has been so far, at a glance: light, medium or heavy, from what its agent runs took.
	// It informs; it limits nothing.
	let { job, class: className = '' }: { job: Job; class?: string } = $props()
	const w = $derived(weightOf(job))
	const bars = $derived(w ? { light: 1, medium: 2, heavy: 3 }[w.level] : 0)
	const title = $derived(
		w
			? `${w.level[0].toUpperCase()}${w.level.slice(1)} so far: ${count(w.tokens)} tokens over ${w.runs} agent ${w.runs === 1 ? 'run' : 'runs'}${w.cost_usd ? `, ${money(w.cost_usd)} at API prices` : ''}. Most tokens are cheap reads from the cache; the weight counts each kind by what it costs.`
			: ''
	)
</script>

{#if w}
	<span class={cn('inline-flex shrink-0 items-center gap-1', w.level === 'heavy' ? 'text-tone-amber' : 'text-muted-foreground', className)} {title} data-weight={w.level}>
		<span class="flex items-end gap-px" aria-hidden="true">
			{#each [1, 2, 3] as n (n)}
				<span class={cn('w-[3px] rounded-[1px]', n <= bars ? 'bg-current' : 'bg-current opacity-25')} style:height="{3 + n * 2}px"></span>
			{/each}
		</span>
		{w.level}
	</span>
{/if}
