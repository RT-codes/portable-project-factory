<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import type { Job } from '$lib/types'
	import type { Tone } from '$lib/board'
	import { ago } from '$lib/format'
	import { cn } from '$lib/utils'

	let { job, tone, now, onopen }: { job: Job; tone: Tone; now: number; onopen: (id: string) => void } = $props()

	const last = $derived(job.activity.at(-1))
	const working = $derived(tone === 'agent' || tone === 'script')
</script>

<button
	type="button"
	onclick={() => onopen(job.id)}
	class={cn(
		'group/card w-full rounded-lg border bg-card p-3 text-left transition-colors',
		'hover:border-foreground/15 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
		tone === 'blocked' && 'border-tone-amber/30',
		tone === 'dropped' && 'opacity-60'
	)}
>
	<div class="flex items-center gap-2 text-xs text-muted-foreground">
		<span class="font-mono tabular-nums">#{String(job.number).padStart(3, '0')}</span>
		{#if working}
			<span class="relative flex size-1.5" aria-label="in progress">
				<span class="absolute inline-flex size-full animate-ping rounded-full bg-glow opacity-60"></span>
				<span class="relative inline-flex size-1.5 rounded-full bg-glow"></span>
			</span>
		{/if}
		{#if job.round > 0}
			<span class="ms-auto inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums" title="Build round">
				<RefreshCwIcon class="size-3" />R{job.round}
			</span>
		{/if}
	</div>

	<p class="mt-1.5 line-clamp-2 text-sm leading-snug font-medium text-foreground">{job.title}</p>

	{#if tone === 'blocked' && job.blocked_reason}
		<p class="mt-2 rounded-md bg-tone-amber/10 px-2 py-1.5 text-xs text-tone-amber"><span class="line-clamp-2">{job.blocked_reason}</span></p>
	{:else if last}
		<p class="mt-2 line-clamp-1 text-xs text-muted-foreground">{last.text}</p>
	{/if}

	<div class="mt-2.5 flex items-center gap-2 text-[0.6875rem] text-muted-foreground/80">
		{#if job.branch}
			<span class="inline-flex min-w-0 items-center gap-1 truncate font-mono"><GitBranchIcon class="size-3 shrink-0" />{job.branch}</span>
		{/if}
		<span class="ms-auto shrink-0 tabular-nums">{ago(job.updated_at, now)}</span>
	</div>
</button>
