<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
	import CircleSlashIcon from '@lucide/svelte/icons/circle-slash'
	import GitMergeIcon from '@lucide/svelte/icons/git-merge'
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request'
	import GitPullRequestClosedIcon from '@lucide/svelte/icons/git-pull-request-closed'
	import GitPullRequestDraftIcon from '@lucide/svelte/icons/git-pull-request-draft'
	import { cn } from '$lib/utils'

	// The state of an issue or pull request, as an icon alone (lists) or a labelled pill (headers).
	let {
		kind,
		state,
		draft = false,
		reason = null,
		pill = false,
		class: className,
	}: { kind: 'issue' | 'pull'; state: string; draft?: boolean; reason?: string | null; pill?: boolean; class?: string } = $props()

	const look = $derived.by(() => {
		if (kind === 'pull') {
			if (state === 'MERGED') return { icon: GitMergeIcon, tone: 'text-tone-violet', bg: 'bg-tone-violet/15', label: 'Merged' }
			if (state === 'CLOSED') return { icon: GitPullRequestClosedIcon, tone: 'text-tone-rose', bg: 'bg-tone-rose/15', label: 'Closed' }
			if (draft) return { icon: GitPullRequestDraftIcon, tone: 'text-muted-foreground', bg: 'bg-muted', label: 'Draft' }
			return { icon: GitPullRequestIcon, tone: 'text-tone-green', bg: 'bg-tone-green/15', label: 'Open' }
		}
		if (state === 'OPEN') return { icon: CircleDotIcon, tone: 'text-tone-green', bg: 'bg-tone-green/15', label: 'Open' }
		if (reason === 'NOT_PLANNED') return { icon: CircleSlashIcon, tone: 'text-muted-foreground', bg: 'bg-muted', label: 'Not planned' }
		return { icon: CircleCheckIcon, tone: 'text-tone-violet', bg: 'bg-tone-violet/15', label: 'Closed' }
	})
	const Icon = $derived(look.icon)
</script>

{#if pill}
	<span class={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', look.tone, look.bg, className)}>
		<Icon class="size-3.5" />{look.label}
	</span>
{:else}
	<Icon class={cn('size-4 shrink-0', look.tone, className)} aria-label={look.label} />
{/if}
