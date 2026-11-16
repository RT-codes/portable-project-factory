<script lang="ts">
	import type { Actor } from '$shared/api'
	import { cn } from '$lib/utils'

	let { actor, class: className }: { actor: Actor; class?: string } = $props()
	let failed = $state(false)
</script>

{#if failed || !actor.avatarUrl}
	<span class={cn('grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[0.625rem] leading-none font-medium text-muted-foreground uppercase', className)} aria-hidden="true">
		{actor.login.slice(0, 1)}
	</span>
{:else}
	<img src={actor.avatarUrl} alt="" class={cn('size-6 shrink-0 rounded-full bg-muted', className)} loading="lazy" onerror={() => (failed = true)} />
{/if}
