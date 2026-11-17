<script lang="ts">
	import { elapsed } from '$lib/live'

	// How long something has been going on, counting by the second while it is shown.
	let { since, class: className = '' }: { since: string | number | null; class?: string } = $props()

	let now = $state(Date.now())
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000)
		return () => clearInterval(timer)
	})
</script>

{#if since !== null}<span class={['tabular-nums', className]} data-elapsed>{elapsed(since, now)}</span>{/if}
