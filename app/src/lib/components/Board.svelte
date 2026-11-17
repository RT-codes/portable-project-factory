<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity'
	import ArchiveXIcon from '@lucide/svelte/icons/archive-x'
	import CirclePauseIcon from '@lucide/svelte/icons/circle-pause'
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
	import HandIcon from '@lucide/svelte/icons/hand'
	import HourglassIcon from '@lucide/svelte/icons/hourglass'
	import LayersIcon from '@lucide/svelte/icons/layers'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import PauseIcon from '@lucide/svelte/icons/pause'
	import PlayIcon from '@lucide/svelte/icons/play'
	import TerminalIcon from '@lucide/svelte/icons/terminal'
	import { Button } from '$lib/components/ui/button/index.js'
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import StageIcon from '$lib/components/StageIcon.svelte'
	import Elapsed from '$lib/components/Elapsed.svelte'
	import TicketCard from '$lib/components/TicketCard.svelte'
	import TicketSheet from '$lib/components/TicketSheet.svelte'
	import { columns, DROPPED_STAGE, isActive, toneText } from '$lib/board'
	import { BLOCKED, DROPPED, type FactoryState, type Job } from '$lib/types'
	import { cn } from '$lib/utils'

	// The board: the summary tiles, one column per stage, and the ticket sheet. `onreview` opens a ticket's branch in
	// the diff viewer; `ticket` opens that ticket's sheet when the board is shown.
	// `onrun` and `onpause` start and stop the factory's run; `ondelete` removes a ticket for good. Each resolves when
	// it is done and rejects with why it could not be.
	let {
		snap,
		now,
		onreview,
		ticket,
		onrun,
		onpause,
		ondelete,
		onland,
	}: {
		snap: FactoryState
		now: number
		onreview?: (job: Job) => void
		ticket?: string | null
		onrun?: () => Promise<void>
		onpause?: () => Promise<void>
		ondelete?: (job: Job, reason: string) => Promise<void>
		/** brings a finished ticket into the base branch; resolves to what happened */
		onland?: (job: Job) => Promise<string>
	} = $props()

	// starting or stopping a run: one at a time, and what went wrong stays in view until the next try
	let acting = $state<'run' | 'pause' | null>(null)
	let actError = $state<string | null>(null)
	async function act(what: 'run' | 'pause') {
		const fn = what === 'run' ? onrun : onpause
		if (!fn || acting) return
		acting = what
		actError = null
		try {
			await fn()
		} catch (e) {
			actError = e instanceof Error ? e.message : String(e)
		} finally {
			acting = null
		}
	}

	let showDropped = $state(false)
	let openId = $state<string | null>(null)
	let sheetOpen = $state(false)

	const config = $derived(snap.config)
	const jobs = $derived(snap.jobs)
	const board = $derived(columns(config, jobs))
	const dropped = $derived(jobs.filter((j) => j.stage === DROPPED))
	const openJob = $derived(jobs.find((j) => j.id === openId) ?? null)

	const stats = $derived.by(() => {
		const terminal = new Set(config.stages.filter((s) => s.terminal).map((s) => s.key))
		return {
			active: jobs.filter((j) => isActive(config, j)).length,
			running: jobs.filter((j) => j.live?.state === 'running').length,
			stalled: jobs.filter((j) => j.live?.state === 'stalled').length,
			// what a run would take up: everything that is not finished, dropped or waiting on a person
			workable: jobs.filter((j) => !terminal.has(j.stage) && j.stage !== DROPPED && j.stage !== BLOCKED).length,
			blocked: jobs.filter((j) => j.stage === BLOCKED).length,
			done: jobs.filter((j) => terminal.has(j.stage)).length,
			open: jobs.filter((j) => !terminal.has(j.stage) && j.stage !== DROPPED).length,
		}
	})

	function openTicket(id: string) {
		openId = id
		sheetOpen = true
	}

	// asked to show a ticket (from Home, or the journal): once, when it is known
	let shown: string | null = null
	$effect(() => {
		if (ticket && ticket !== shown && jobs.some((j) => j.id === ticket)) {
			shown = ticket
			openTicket(ticket)
		}
	})
</script>

	<main class="@container flex min-h-0 flex-1 flex-col">
		<!-- the numbers that matter -->
		<section class="grid shrink-0 grid-cols-2 gap-3 px-4 pt-5 @2xl:px-6 @4xl:grid-cols-4" aria-label="Summary">
			{@render tile('In progress', stats.active, ActivityIcon, 'text-primary', false)}
			{@render tile('Needs you', stats.blocked, HandIcon, 'text-tone-amber', stats.blocked > 0)}
			{@render tile('Done', stats.done, CircleCheckIcon, 'text-tone-green', false)}
			{@render tile('Open', stats.open, LayersIcon, 'text-muted-foreground', false)}
		</section>

		{#if jobs.length === 0}
			<div class="forge-glow grid flex-1 place-items-center p-6">
				<div class="glow-card max-w-lg rounded-xl border p-6">
					<TerminalIcon class="size-5 text-glow" />
					<h2 class="mt-3 font-semibold">No tickets yet</h2>
					<p class="mt-1 text-sm text-muted-foreground">Ask your agent (Claude Code or Codex) to file one with the factory skill, or file it from a terminal. The board fills in as the factory works.</p>
					<pre class="mt-4 rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"><span class="text-muted-foreground">$</span> node .factory/cli.mjs new Add a dark mode toggle to settings
<span class="text-muted-foreground">$</span> node .factory/cli.mjs run</pre>
				</div>
			</div>
		{:else}
			<div class="mt-5 flex items-center justify-between px-4 @2xl:px-6">
				<div class="flex min-w-0 items-center gap-3">
					<h2 class="text-sm font-medium text-muted-foreground">Board</h2>
					<!-- whether anything is being worked at all: a board without a run does not move -->
					{#if snap.run?.waiting}
						<!-- a limit was reached: the run is alive, holds its tickets, and goes on by itself -->
						<span
							class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-tone-amber/15 px-2 text-xs font-medium text-tone-amber"
							title="No ticket failed. The run waits and takes every stage up again; Pause stops the waiting too."
							data-run="waiting"
						>
							<HourglassIcon class="size-3 shrink-0" />
							<span class="truncate">Waiting: {snap.run.waiting.reason} · goes on at {new Date(snap.run.waiting.until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
						</span>
					{:else if snap.run}
						<span class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 text-xs font-medium text-primary" data-run="on">
							<LoaderIcon class="size-3 shrink-0 animate-spin" />
							<span class="truncate">{stats.running > 0 ? `Run in progress · ${stats.running} ${stats.running === 1 ? 'ticket' : 'tickets'} being worked` : 'Run in progress'}</span>
							<Elapsed since={snap.run.started_at} class="shrink-0 font-normal text-primary/80" />
						</span>
					{:else if stats.stalled > 0}
						<span
							class="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 text-xs text-muted-foreground"
							title="Tickets move while a run works them. Start one: node .factory/cli.mjs run (or ask your agent to run the factory)"
							data-run="off"
						>
							<CirclePauseIcon class="size-3 shrink-0" />
							<span class="truncate">No run · {stats.stalled} {stats.stalled === 1 ? 'ticket waits' : 'tickets wait'} for one</span>
						</span>
					{/if}
					{#if snap.run && onpause}
						<Button variant="outline" size="xs" disabled={acting !== null} onclick={() => act('pause')} title="Stop the run. Tickets stay where they are, and Run takes them up again.">
							{#if acting === 'pause'}<LoaderIcon class="animate-spin" />{:else}<PauseIcon />{/if}Pause
						</Button>
					{:else if !snap.run && onrun && stats.workable > 0}
						<Button size="xs" disabled={acting !== null} onclick={() => act('run')} title="Start a run: it works every open ticket, {config.concurrency} at a time, until none is left to work">
							{#if acting === 'run'}<LoaderIcon class="animate-spin" />{:else}<PlayIcon />{/if}Run
						</Button>
					{/if}
				</div>
				{#if dropped.length > 0}
					<Button variant="ghost" size="xs" onclick={() => (showDropped = !showDropped)}>
						<ArchiveXIcon />{showDropped ? 'Hide' : 'Show'} dropped ({dropped.length})
					</Button>
				{/if}
			</div>
			{#if actError}
				<p class="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive @2xl:mx-6" role="alert">{actError}</p>
			{/if}
			<!-- the board scrolls sideways; each column scrolls on its own -->
			<section class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pt-3 pb-4 @2xl:px-6" aria-label="Board">
				{#each board as col (col.stage.key)}
					{@render column(col.stage, col.tone, col.jobs)}
				{/each}
				{#if showDropped}
					{@render column(DROPPED_STAGE, 'dropped', dropped)}
				{/if}
			</section>
		{/if}
	</main>

	<TicketSheet job={openJob} {config} {now} {onreview} {ondelete} {onland} bind:open={sheetOpen} />

<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
{#snippet tile(label: string, value: number, Icon: any, iconClass: string, glow: boolean)}
	<div class={cn('rounded-xl border bg-card px-4 py-3', glow && 'glow-card')}>
		<div class="flex items-center justify-between text-xs text-muted-foreground">
			{label}
			<Icon class={cn('size-4', iconClass)} />
		</div>
		<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
	</div>
{/snippet}

{#snippet column(stage: import('$lib/types').Stage, tone: import('$lib/board').Tone, list: import('$lib/types').Job[])}
	{#if list.length === 0}
		<!-- an empty stage folds to a strip, so every stage fits on a laptop screen -->
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<div {...props} class="flex w-11 shrink-0 flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/20 py-3 dark:bg-card/20">
						<StageIcon name={stage.icon} class={cn('size-4 opacity-70', toneText[tone])} />
						<span class="text-sm font-medium text-muted-foreground [writing-mode:vertical-rl]">{stage.label}</span>
						<span class="font-mono text-[0.6875rem] text-muted-foreground/70">0</span>
					</div>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom" class="max-w-64">
				{@render stageInfo(stage)}
			</Tooltip.Content>
		</Tooltip.Root>
	{:else}
		{@const busy = list.filter((j) => j.live?.state === 'running').length}
		<div
			class={cn(
				'flex max-w-96 min-w-60 shrink-0 grow basis-0 flex-col rounded-xl border bg-muted/30 dark:bg-card/40',
				tone === 'blocked' && 'border-tone-amber/25'
			)}
		>
			<div class="flex items-center gap-2 px-3 pt-3 pb-2">
				<StageIcon name={stage.icon} class={cn('size-4', toneText[tone])} />
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<h3 {...props} class="text-sm font-medium">{stage.label}</h3>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content class="max-w-64">
						{@render stageInfo(stage)}
					</Tooltip.Content>
				</Tooltip.Root>
				{#if busy > 0}
					<span class="ms-auto inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary" title="{busy} being worked right now">
						<LoaderIcon class="size-3 animate-spin" />{busy} running
					</span>
				{/if}
				<span class={cn('rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground tabular-nums', busy === 0 && 'ms-auto')}>{list.length}</span>
			</div>
			<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
				{#each list as job (job.id)}
					<TicketCard {job} {stage} stages={config.stages} {tone} {now} onopen={openTicket} />
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet stageInfo(stage: import('$lib/types').Stage)}
	<span class="block font-medium">{stage.label}</span>
	{#if stage.description}<span class="mt-0.5 block opacity-90">{stage.description}</span>{/if}
	{#if stage.role}<span class="mt-1 block font-mono opacity-80">role: {stage.role}</span>{/if}
	{#if stage.run}<span class="mt-1 block font-mono opacity-80">runs: {stage.run === 'checks' ? 'the checks' : stage.run}</span>{/if}
{/snippet}
