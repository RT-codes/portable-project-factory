<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity'
	import ArchiveXIcon from '@lucide/svelte/icons/archive-x'
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
	import HandIcon from '@lucide/svelte/icons/hand'
	import LayersIcon from '@lucide/svelte/icons/layers'
	import TerminalIcon from '@lucide/svelte/icons/terminal'
	import { Button } from '$lib/components/ui/button/index.js'
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import StageIcon from '$lib/components/StageIcon.svelte'
	import TicketCard from '$lib/components/TicketCard.svelte'
	import TicketSheet from '$lib/components/TicketSheet.svelte'
	import { columns, DROPPED_STAGE, isActive, toneText } from '$lib/board'
	import { BLOCKED, DROPPED, type FactoryState, type Job } from '$lib/types'
	import { cn } from '$lib/utils'

	// The board: the summary tiles, one column per stage, and the ticket sheet. `onreview` opens a ticket's branch in
	// the diff viewer; `ticket` opens that ticket's sheet when the board is shown.
	let { snap, now, onreview, ticket }: { snap: FactoryState; now: number; onreview?: (job: Job) => void; ticket?: string | null } = $props()

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
				<h2 class="text-sm font-medium text-muted-foreground">Board</h2>
				{#if dropped.length > 0}
					<Button variant="ghost" size="xs" onclick={() => (showDropped = !showDropped)}>
						<ArchiveXIcon />{showDropped ? 'Hide' : 'Show'} dropped ({dropped.length})
					</Button>
				{/if}
			</div>
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

	<TicketSheet job={openJob} {config} {now} {onreview} bind:open={sheetOpen} />

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
				<span class="ms-auto rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{list.length}</span>
			</div>
			<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
				{#each list as job (job.id)}
					<TicketCard {job} {tone} {now} onopen={openTicket} />
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
