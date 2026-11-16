<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { Actor } from '$shared/api'
	import { ago, stamp } from '$lib/format'
	import { cn } from '$lib/utils'
	import Avatar from './Avatar.svelte'
	import Markdown from './Markdown.svelte'

	// One comment in a conversation: who, when, what.
	let {
		author,
		at,
		body,
		now,
		badge,
		compact = false,
		class: className,
	}: {
		author: Actor
		at: string
		body: string
		now: number
		/** shown after the name: "approved", "Pending" */
		badge?: Snippet
		/** inside a diff thread: no frame of its own */
		compact?: boolean
		class?: string
	} = $props()
</script>

<article class={cn(!compact && 'rounded-xl border bg-card', className)}>
	<header class={cn('flex items-center gap-2 text-xs text-muted-foreground', compact ? 'pb-1.5' : 'border-b px-4 py-2.5')}>
		<Avatar actor={author} class={compact ? 'size-5' : 'size-6'} />
		<span class="font-medium text-foreground">{author.login}</span>
		{@render badge?.()}
		<span title={stamp(at)}>{ago(at, now)}</span>
	</header>
	<div class={cn(compact ? 'ps-7' : 'px-4 py-3')}>
		<Markdown text={body} empty="No text." />
	</div>
</article>
