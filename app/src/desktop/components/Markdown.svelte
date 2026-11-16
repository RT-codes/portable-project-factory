<script lang="ts">
	import { renderGithubMarkdown } from '../lib/markdown'
	import { cn } from '$lib/utils'

	let { text, class: className, empty = 'No description.' }: { text: string; class?: string; empty?: string } = $props()
</script>

{#if text.trim()}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderGithubMarkdown -->
	<div class={cn('md md-github', className)}>{@html renderGithubMarkdown(text)}</div>
{:else}
	<p class={cn('text-sm text-muted-foreground italic', className)}>{empty}</p>
{/if}
