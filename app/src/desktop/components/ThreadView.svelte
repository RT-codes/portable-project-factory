<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import type { ReviewThread } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { cn } from '$lib/utils'
	import { message } from '../api'
	import type { ReviewHooks } from '../lib/review'
	import CommentCard from './CommentCard.svelte'
	import Composer from './Composer.svelte'

	// A review thread under a diff line: its comments, a reply box, and resolve. A resolved thread folds to one line.
	let { thread, hooks, now, label }: { thread: ReviewThread; hooks: ReviewHooks; now: number; label?: string } = $props()

	let unfolded = $state(false)
	let replying = $state(false)
	let busy = $state(false)
	let error = $state<string | null>(null)
	const folded = $derived(thread.resolved && !unfolded)

	async function setResolved(resolved: boolean) {
		busy = true
		error = null
		try {
			await hooks.resolve(thread, resolved)
			unfolded = false
		} catch (e) {
			error = message(e)
		} finally {
			busy = false
		}
	}
</script>

<div class={cn('rounded-lg border bg-card font-sans', thread.resolved && 'border-dashed')} data-thread={thread.id}>
	{#if folded}
		<button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground" onclick={() => (unfolded = true)}>
			<ChevronRightIcon class="size-3.5" />
			<CheckIcon class="size-3.5 text-tone-green" />
			<span>Resolved thread · {thread.comments[0]?.author.login} · {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}</span>
		</button>
	{:else}
		<div class="space-y-3 p-3">
			{#if label}<p class="font-mono text-[0.6875rem] text-muted-foreground">{label}</p>{/if}
			{#each thread.comments as c (c.id)}
				<CommentCard author={c.author} at={c.createdAt} body={c.body} {now} compact />
			{/each}
		</div>
		<div class="border-t p-2">
			{#if replying}
				<Composer
					placeholder="Reply"
					submitLabel="Reply"
					rows={2}
					autofocus
					oncancel={() => (replying = false)}
					onsubmit={async (text) => {
						await hooks.reply(thread, text)
						replying = false
					}}
				/>
			{:else}
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="h-7 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-left text-xs text-muted-foreground/80 hover:border-foreground/20"
						onclick={() => (replying = true)}
					>
						Reply…
					</button>
					<Button variant="outline" size="xs" disabled={busy} onclick={() => setResolved(!thread.resolved)}>
						{#if busy}<LoaderIcon class="animate-spin" />{:else if !thread.resolved}<CheckIcon />{/if}
						{thread.resolved ? 'Unresolve' : 'Resolve'}
					</Button>
				</div>
				{#if error}<p class="mt-1.5 px-1 text-xs text-destructive">{error}</p>{/if}
			{/if}
		</div>
	{/if}
</div>
