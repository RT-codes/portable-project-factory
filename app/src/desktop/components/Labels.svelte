<script lang="ts">
	import type { Label } from '$shared/api'

	let { labels }: { labels: Label[] } = $props()
</script>

{#each labels as l (l.name)}
	<span
		class="inline-flex h-[1.125rem] shrink-0 items-center rounded-full border px-1.5 text-[0.6875rem] leading-none font-medium"
		style:background="color-mix(in oklab, #{l.color} 16%, transparent)"
		style:border-color="color-mix(in oklab, #{l.color} 45%, transparent)"
	>
		{l.name}
	</span>
{/each}
