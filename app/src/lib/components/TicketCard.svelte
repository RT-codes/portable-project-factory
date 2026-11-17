<script lang="ts">
	import CirclePauseIcon from '@lucide/svelte/icons/circle-pause'
	import ClockIcon from '@lucide/svelte/icons/clock'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import type { Job, Stage } from '$lib/types'
	import { BLOCKED } from '$lib/types'
	import type { Tone } from '$lib/board'
	import { ago } from '$lib/format'
	import { count, shortModel, stepTone } from '$lib/live'
	import { cn } from '$lib/utils'
	import Elapsed from './Elapsed.svelte'
	import StepIcon from './StepIcon.svelte'
	import GitMergeIcon from '@lucide/svelte/icons/git-merge'
	import HourglassIcon from '@lucide/svelte/icons/hourglass'
	import { weightOf } from '$lib/usage'
	import WeightBadge from './WeightBadge.svelte'
	import WorkStat from './WorkStat.svelte'

	// A ticket on the board. While a run works it, the card says so and keeps saying what is going on: the stage and
	// how long it has taken, the agent's latest step, and how far the work in its worktree is.
	let { job, stage, stages, tone, now, onopen }: { job: Job; stage: Stage; stages: Stage[]; tone: Tone; now: number; onopen: (id: string) => void } = $props()

	const last = $derived(job.activity.at(-1))
	const live = $derived(job.live)
	const running = $derived(live?.state === 'running')
	// where the ticket stands on the track: a blocked ticket stands where it was blocked
	const at = $derived(job.stage === BLOCKED ? (job.blocked_from ?? '') : job.stage)
	const atIndex = $derived(stages.findIndex((s) => s.key === at))
	const facts = $derived(live ? [live.model ? shortModel(live.model) : '', live.turns ? `${live.turns} ${live.turns === 1 ? 'turn' : 'turns'}` : '', live.tokens ? `${count(live.tokens)} tokens` : ''].filter(Boolean) : [])
</script>

<button
	type="button"
	onclick={() => onopen(job.id)}
	data-ticket={job.id}
	data-live={live?.state}
	class={cn(
		'group/card relative w-full overflow-hidden rounded-lg border bg-card p-3 text-left transition-colors',
		'hover:border-foreground/15 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
		running && 'border-primary/40 hover:border-primary/60',
		tone === 'blocked' && 'border-tone-amber/30',
		tone === 'dropped' && 'opacity-60'
	)}
>
	{#if running}<span class="live-bar" aria-hidden="true"></span>{/if}

	<div class="flex items-center gap-2 text-xs text-muted-foreground">
		<span class="font-mono tabular-nums">#{String(job.number).padStart(3, '0')}</span>
		{#if live?.state === 'running'}
			<span class="inline-flex min-w-0 items-center gap-1 font-medium text-primary">
				<LoaderIcon class="size-3.5 shrink-0 animate-spin" aria-label="in progress" />
				<span class="truncate">{stage.label}</span>
				<Elapsed since={live.since} class="shrink-0 font-normal text-primary/80" />
			</span>
		{:else if live?.state === 'waiting'}
			<span class="inline-flex min-w-0 items-center gap-1 text-tone-amber" title="The run holds this ticket until the limit resets, then takes it up again by itself">
				<HourglassIcon class="size-3.5 shrink-0" /><span class="truncate">Waiting for a limit</span>
			</span>
		{:else if live?.state === 'queued'}
			<span class="inline-flex min-w-0 items-center gap-1"><ClockIcon class="size-3.5 shrink-0" /><span class="truncate">Queued</span></span>
		{:else if live?.state === 'stalled'}
			<span class="inline-flex min-w-0 items-center gap-1" title="No run is working this ticket. Start one: node .factory/cli.mjs run">
				<CirclePauseIcon class="size-3.5 shrink-0" /><span class="truncate">Not running</span>
			</span>
		{/if}
		{#if job.round > 0}
			<span class="ms-auto inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums" title="Build round">
				<RefreshCwIcon class="size-3" />R{job.round}
			</span>
		{/if}
	</div>

	<p class="mt-1.5 line-clamp-2 text-sm leading-snug font-medium text-foreground">{job.title}</p>

	{#if tone === 'blocked' && job.blocked_reason}
		<p class="mt-2 rounded-md bg-tone-amber/10 px-2 py-1.5 text-xs text-tone-amber"><span class="line-clamp-2">{job.blocked_reason}</span></p>
	{:else if running}
		<!-- what the agent is doing right now -->
		<p class="mt-2 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-xs" data-step>
			{#if live?.step}
				<StepIcon kind={live.step.kind} class={cn('size-3.5 shrink-0', stepTone[live.step.kind])} />
				{#key live.step.text}<span class="row-in min-w-0 truncate text-foreground/90" title={live.step.detail ?? live.step.text}>{live.step.text}</span>{/key}
			{:else}
				<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"></span>
				<span class="min-w-0 truncate text-muted-foreground">{stage.role ? `The ${stage.role} is starting…` : 'Starting…'}</span>
			{/if}
		</p>
	{:else if live?.state === 'queued'}
		<p class="mt-2 line-clamp-1 text-xs text-muted-foreground">Waiting for a free slot in the run.</p>
	{:else if last}
		<p class="mt-2 line-clamp-1 text-xs text-muted-foreground">{last.text}</p>
	{/if}

	<!-- where the ticket stands: a segment per stage -->
	{#if atIndex > 0 || live}
		<div class="mt-2.5 flex items-center gap-0.5" aria-hidden="true" data-track>
			{#each stages as s, i (s.key)}
				{@const passed = i < atIndex || (s.terminal && job.stage === s.key)}
				{@const here = i === atIndex && !s.terminal}
				<span
					class={cn(
						'h-1 min-w-0 flex-1 rounded-full bg-muted',
						passed && 'bg-tone-green/60',
						here && (job.stage === BLOCKED ? 'bg-tone-amber' : live?.state === 'stalled' ? 'bg-muted-foreground/50' : 'bg-primary'),
						here && running && 'track-live'
					)}
					title={s.label}
				></span>
			{/each}
		</div>
	{/if}

	<div class="mt-2.5 flex items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground/80">
		{#if job.landed}
			<span class="inline-flex min-w-0 shrink items-center gap-1 text-tone-green" title="Its branch was brought into {job.landed.into} at {job.landed.sha}" data-landed><GitMergeIcon class="size-3 shrink-0" /><span class="truncate">Landed in {job.landed.into}</span></span>
		{:else if job.branch}
			<span class="inline-flex min-w-0 shrink items-center gap-1 font-mono" title="Worktree {job.worktree ?? ''} on {job.branch}"><GitBranchIcon class="size-3 shrink-0" /><span class="truncate">{job.branch}</span></span>
		{/if}
		{#if !running}<span class="ms-auto shrink-0 tabular-nums">{ago(job.updated_at, now)}</span>{/if}
	</div>
	{#if (job.work && (job.work.commits || job.work.files.length)) || weightOf(job)}
		<div class="mt-1 flex items-center gap-3 text-[0.6875rem] text-muted-foreground/80">
			{#if job.work}<WorkStat work={job.work} />{/if}
			<WeightBadge {job} class="ms-auto" />
		</div>
	{/if}
	{#if running && facts.length}
		<p class="mt-1 truncate text-[0.6875rem] text-muted-foreground/70" data-facts>{facts.join(' · ')}</p>
	{/if}
</button>
