<script lang="ts">
	import GitCommitIcon from '@lucide/svelte/icons/git-commit-horizontal'
	import type { Work } from '$lib/types'
	import { workWords } from '$lib/live'

	// How far a ticket's work is, in a line: commits made, files that differ from the base branch, lines in and out.
	let { work, class: className = '' }: { work: Work; class?: string } = $props()
	const title = $derived(
		work.uncommitted
			? `${work.uncommitted} ${work.uncommitted === 1 ? 'file is' : 'files are'} changed in the worktree and not committed yet`
			: 'Against the base branch'
	)
</script>

{#if work.commits || work.files.length}
	<span class={['inline-flex min-w-0 items-center gap-1 tabular-nums', className]} {title} data-work>
		<GitCommitIcon class="size-3 shrink-0" />
		<span class="truncate">{workWords(work)}</span>
		{#if work.additions}<span class="shrink-0 font-mono text-tone-green">+{work.additions}</span>{/if}
		{#if work.deletions}<span class="shrink-0 font-mono text-tone-rose">-{work.deletions}</span>{/if}
		{#if work.uncommitted}<span class="size-1.5 shrink-0 rounded-full border border-dashed border-tone-amber" aria-label="uncommitted work"></span>{/if}
	</span>
{/if}
