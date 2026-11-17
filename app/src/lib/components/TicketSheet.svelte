<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import FileTextIcon from '@lucide/svelte/icons/file-text'
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows'
	import { Button } from '$lib/components/ui/button/index.js'
	import HandIcon from '@lucide/svelte/icons/hand'
	import * as Sheet from '$lib/components/ui/sheet/index.js'
	import * as Tabs from '$lib/components/ui/tabs/index.js'
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
	import type { Config, Job, JobFile } from '$lib/types'
	import { BLOCKED, DROPPED } from '$lib/types'
	import { stageOf, toneOf, toneText } from '$lib/board'
	import { ago, bytes, stamp } from '$lib/format'
	import { cn } from '$lib/utils'
	import CirclePauseIcon from '@lucide/svelte/icons/circle-pause'
	import ClockIcon from '@lucide/svelte/icons/clock'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import GitMergeIcon from '@lucide/svelte/icons/git-merge'
	import Trash2Icon from '@lucide/svelte/icons/trash-2'
	import { count, shortModel } from '$lib/live'
	import Elapsed from './Elapsed.svelte'
	import FileView from './FileView.svelte'
	import LiveFeed from './LiveFeed.svelte'
	import HourglassIcon from '@lucide/svelte/icons/hourglass'
	import WeightBadge from './WeightBadge.svelte'
	import WorkStat from './WorkStat.svelte'
	import StageBadge from './StageBadge.svelte'
	import StageIcon from './StageIcon.svelte'

	// `onreview` opens the ticket's branch in the diff viewer
	let {
		job,
		config,
		now,
		onreview,
		ondelete,
		onland,
		open = $bindable(false),
	}: {
		job: Job | null
		config: Config
		now: number
		onreview?: (job: Job) => void
		ondelete?: (job: Job, reason: string) => Promise<void>
		onland?: (job: Job) => Promise<string>
		open?: boolean
	} = $props()

	// landing a finished ticket: it can take as long as the checks do, and what came of it stays in view
	let landing = $state(false)
	let landed = $state<{ ok: boolean; text: string } | null>(null)
	async function landIt() {
		if (!job || !onland || landing) return
		landing = true
		landed = null
		try {
			const text = await onland(job)
			landed = { ok: /^landed/i.test(text), text }
		} catch (e) {
			landed = { ok: false, text: e instanceof Error ? e.message : String(e) }
		} finally {
			landing = false
		}
	}

	// deleting a ticket: asked for, then confirmed with the reason the journal will keep
	let deleting = $state(false)
	let reason = $state('')
	let deleteBusy = $state(false)
	let deleteError = $state<string | null>(null)
	async function confirmDelete() {
		if (!job || !ondelete || !reason.trim() || deleteBusy) return
		deleteBusy = true
		deleteError = null
		try {
			await ondelete(job, reason)
			deleting = false
			reason = ''
			open = false
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e)
		} finally {
			deleteBusy = false
		}
	}

	let tab = $state('ticket')
	let selected = $state<string | null>(null)

	// a new ticket opens on its request, with no file picked
	let shownId = $state<string | null>(null)
	$effect(() => {
		if (job && job.id !== shownId) {
			shownId = job.id
			// a ticket that is being worked opens on what is happening to it
			tab = job.live?.state === 'running' ? 'live' : 'ticket'
			selected = null
			deleting = false
			reason = ''
			deleteError = null
			landed = null
		}
	})

	const first = $derived(config.stages[0]?.key ?? '')
	const stage = $derived(job ? stageOf(config, job.stage) : undefined)
	const tone = $derived(job && stage ? toneOf(stage, job.stage, first) : 'idle')
	// where the ticket stands on the track: a blocked ticket stands where it was blocked
	const at = $derived(job ? (job.stage === BLOCKED ? (job.blocked_from ?? '') : job.stage) : '')
	const atIndex = $derived(config.stages.findIndex((s) => s.key === at))

	const ticketFile = $derived(job?.files.find((f) => f.path === 'ticket.md'))
	// the files a stage wrote: the folder's own first, then each round's, newest round first
	const groups = $derived.by(() => {
		if (!job) return []
		const byGroup = new Map<string, JobFile[]>()
		for (const f of job.files) {
			if (f.path === 'ticket.md') continue
			const slash = f.path.indexOf('/')
			const group = slash === -1 ? '' : f.path.slice(0, slash)
			byGroup.set(group, [...(byGroup.get(group) ?? []), f])
		}
		const round = (g: string) => Number(g.match(/\d+/)?.[0] ?? 0)
		return [...byGroup.entries()]
			.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : round(b) - round(a)))
			.map(([group, files]) => ({ group, label: group === '' ? 'Ticket folder' : group.replace('-', ' '), files }))
	})
	const current = $derived(job?.files.find((f) => f.path === selected) ?? null)
	const fileCount = $derived((job?.files.length ?? 1) - (ticketFile ? 1 : 0))

	function pick(path: string) {
		selected = path
	}

	const live = $derived(job?.live)
	const running = $derived(live?.state === 'running')
	const work = $derived(job?.work)
	// a tab that is gone (the stage ended, the worktree is merged) gives way to the ticket
	$effect(() => {
		if ((tab === 'live' && !live) || (tab === 'work' && !work?.files.length)) tab = 'ticket'
	})
	function openLog() {
		if (!live?.log) return
		selected = live.log
		tab = 'files'
	}
	const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

	const kindDot: Record<string, string> = {
		created: 'bg-muted-foreground',
		moved: 'bg-primary',
		check: 'bg-tone-sky',
		note: 'bg-muted-foreground/60',
		blocked: 'bg-tone-amber',
		waiting: 'bg-tone-amber',
		agent: 'bg-primary',
		dropped: 'bg-muted-foreground',
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
		{#if job && stage}
			<Sheet.Header class="gap-3 border-b p-5 pe-14">
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<span class="font-mono tabular-nums">#{String(job.number).padStart(3, '0')}</span>
					<StageBadge {stage} {tone} />
					{#if job.round > 0}
						<span class="font-mono tabular-nums">round {job.round}/{config.max_rounds}</span>
					{/if}
				</div>
				<Sheet.Title class="text-lg leading-snug font-semibold">{job.title}</Sheet.Title>
				<Sheet.Description class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
					<span>Created {stamp(job.created_at)}</span>
					<span>Updated {ago(job.updated_at, now)}</span>
					{#if job.landed}
						<span class="inline-flex items-center gap-1 text-tone-green"><GitMergeIcon class="size-3" />Landed in <span class="font-mono">{job.landed.into}</span> at {job.landed.sha}</span>
					{:else if job.branch}
						<span class="inline-flex items-center gap-1 font-mono"><GitBranchIcon class="size-3" />{job.branch}</span>
					{/if}
				</Sheet.Description>
				{#if (job.branch && onreview) || ondelete || onland}
					<div class="flex items-center gap-2">
						{#if stage.terminal && job.branch && job.worktree && !job.landed && onland}
							<Button size="sm" disabled={landing} onclick={landIt} title="Merge {config.base_branch} into this ticket's branch if it has moved, run the checks on the result, then move {config.base_branch}. What conflicts goes back to the builder.">
								{#if landing}<LoaderIcon class="animate-spin" />Landing…{:else}<GitMergeIcon />Land in {config.base_branch}{/if}
							</Button>
						{/if}
						{#if job.branch && job.worktree && onreview}
							<Button variant="outline" size="sm" onclick={() => ((open = false), onreview(job))}><GitCompareIcon />Review changes</Button>
						{/if}
						{#if ondelete}
							<Button
								variant="ghost"
								size="sm"
								class="ms-auto text-muted-foreground hover:text-destructive"
								disabled={running}
								title={running ? 'A run is working this ticket: pause the run first' : 'Remove this ticket for good'}
								onclick={() => (deleting = !deleting)}
							>
								<Trash2Icon />Delete
							</Button>
						{/if}
					</div>
				{/if}
				{#if landed}
					<p class={cn('rounded-lg border px-3 py-2 text-xs', landed.ok ? 'border-tone-green/40 bg-tone-green/10 text-tone-green' : 'border-tone-amber/40 bg-tone-amber/10 text-foreground/90')} role="status" data-landed={landed.ok ? 'yes' : 'no'}>{landed.text}</p>
				{/if}
				{#if deleting && ondelete}
					<!-- nothing is deleted before this is confirmed -->
					<form class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" onsubmit={(e) => (e.preventDefault(), void confirmDelete())} data-delete>
						<p class="font-medium text-destructive">Delete this ticket for good?</p>
						<p class="mt-1 text-xs text-foreground/85">
							Its folder{#if job.branch && !job.landed}, its worktree and its branch <span class="font-mono">{job.branch}</span>{/if} are removed.
							{#if work?.commits || work?.uncommitted}
								<strong class="font-medium text-destructive">
									Its work is not merged into <span class="font-mono">{config.base_branch}</span> and will be lost{#if work.commits}: {work.commits} {work.commits === 1 ? 'commit' : 'commits'}{/if}{#if work.uncommitted}{work.commits ? ' and' : ':'} {work.uncommitted} uncommitted {work.uncommitted === 1 ? 'file' : 'files'}{/if}.
								</strong>
							{:else if job.landed}
								Its work stays in <span class="font-mono">{job.landed.into}</span>, where it landed.
							{:else if job.branch && !work}
								Anything on the branch that is not merged into <span class="font-mono">{config.base_branch}</span> is lost.
							{/if}
							The journal keeps a note that it existed, with your reason, so the next person or agent knows.
						</p>
						<label class="mt-2 block text-xs font-medium" for="delete-reason">Why is it deleted?</label>
						<input
							id="delete-reason"
							bind:value={reason}
							class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							placeholder="Filed twice, no longer wanted, ..."
							autocomplete="off"
						/>
						{#if deleteError}<p class="mt-2 text-xs text-destructive" role="alert">{deleteError}</p>{/if}
						<div class="mt-3 flex justify-end gap-2">
							<Button type="button" variant="ghost" size="sm" onclick={() => (deleting = false)}>Keep it</Button>
							<Button type="submit" variant="destructive" size="sm" disabled={!reason.trim() || deleteBusy}>
								{#if deleteBusy}<LoaderIcon class="animate-spin" />{:else}<Trash2Icon />{/if}Delete for good
							</Button>
						</div>
					</form>
				{/if}

				<!-- the stage track -->
				<ol class="mt-1 flex items-center gap-1" aria-label="Stages">
					{#each config.stages as s, i (s.key)}
						{@const passed = job.stage !== DROPPED && (i < atIndex || (s.terminal && job.stage === s.key))}
						{@const here = i === atIndex && !s.terminal}
						{@const blockedHere = here && job.stage === BLOCKED}
						<li class="flex min-w-0 flex-1 flex-col gap-1.5" title={s.description}>
							<div
								class={cn(
									'h-1 rounded-full bg-muted',
									passed && 'bg-tone-green/70',
									here && 'bg-primary',
									here && live?.state === 'stalled' && 'bg-muted-foreground/50',
									blockedHere && 'bg-tone-amber',
									here && running && 'track-live'
								)}
							></div>
							<span
								class={cn(
									'flex items-center gap-1 truncate text-[0.6875rem] text-muted-foreground',
									passed && 'text-foreground/80',
									here && 'font-medium text-primary',
									blockedHere && 'text-tone-amber'
								)}
							>
								{#if passed}<CheckIcon class="size-3 shrink-0" />{:else}<StageIcon name={s.icon} class="size-3 shrink-0" />{/if}
								<span class="truncate">{s.label}</span>
							</span>
						</li>
					{/each}
				</ol>

				<!-- what is happening on the ticket right now -->
				{#if live}
					<div class={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs', running ? 'border-primary/40 bg-primary/10' : 'bg-muted/40')} data-now={live.state}>
						{#if live.state === 'running'}
							<span class="inline-flex items-center gap-1.5 font-medium text-primary">
								<LoaderIcon class="size-3.5 animate-spin" />
								{stage.role ? `The ${stage.role} is working` : stage.run ? 'The checks are running' : 'Working'}
							</span>
							<Elapsed since={live.since} class="text-foreground/80" />
						{:else if live.state === 'waiting'}
							<span class="inline-flex items-center gap-1.5 font-medium text-tone-amber"><HourglassIcon class="size-3.5" />Waiting for a limit to reset</span>
							<span class="text-muted-foreground">Nothing is lost: the run takes this stage up again by itself. See the Activity tab for when.</span>
						{:else if live.state === 'queued'}
							<span class="inline-flex items-center gap-1.5 font-medium"><ClockIcon class="size-3.5" />Queued</span>
							<span class="text-muted-foreground">The run takes it when a slot is free ({config.concurrency} at a time).</span>
						{:else}
							<span class="inline-flex items-center gap-1.5 font-medium"><CirclePauseIcon class="size-3.5" />Not running</span>
							<span class="text-muted-foreground">No run is working this ticket. Start one with <span class="font-mono">node .factory/cli.mjs run</span>, or ask your agent to run the factory.</span>
						{/if}
						{#if live.model}<span class="font-mono text-muted-foreground" title={live.agent}>{shortModel(live.model)}</span>{/if}
						{#if live.turns}<span class="text-muted-foreground tabular-nums">{live.turns} {live.turns === 1 ? 'turn' : 'turns'}</span>{/if}
						{#if live.tokens}<span class="text-muted-foreground tabular-nums">{count(live.tokens)} tokens</span>{/if}
						{#if running && live.step}
							<span class="basis-full truncate text-foreground/90" title={live.step.detail ?? live.step.text}>{live.step.text}</span>
						{/if}
					</div>
				{/if}
				<div class="flex items-center gap-4 text-xs text-muted-foreground empty:hidden">
					{#if work && (work.commits || work.files.length)}<WorkStat {work} />{/if}
					<WeightBadge {job} />
				</div>
			</Sheet.Header>

			{#if job.stage === BLOCKED}
				<div class="mx-5 mt-4 flex gap-3 rounded-lg border border-tone-amber/30 bg-tone-amber/10 p-3 text-sm">
					<HandIcon class="mt-0.5 size-4 shrink-0 text-tone-amber" />
					<div class="min-w-0">
						<p class="font-medium text-tone-amber">Needs you</p>
						<p class="mt-0.5 text-foreground/85">{job.blocked_reason ?? 'Blocked without a reason.'}</p>
						<p class="mt-2 text-xs text-muted-foreground">
							Answer it in your agent's session (Claude Code or Codex, through the factory skill), or unblock or drop the ticket there.
						</p>
					</div>
				</div>
			{/if}

			<Tabs.Root bind:value={tab} class="min-h-0 flex-1 gap-0">
				<div class="px-5 pt-4">
					<Tabs.List>
						<Tabs.Trigger value="ticket">Ticket</Tabs.Trigger>
						{#if live}
							<Tabs.Trigger value="live">
								{#if running}<span class="size-1.5 animate-pulse rounded-full bg-primary"></span>{/if}Live
							</Tabs.Trigger>
						{/if}
						<Tabs.Trigger value="activity">Activity <span class="text-muted-foreground tabular-nums">{job.activity.length}</span></Tabs.Trigger>
						{#if work?.files.length}
							<Tabs.Trigger value="work">Changes <span class="text-muted-foreground tabular-nums">{work.files.length}</span></Tabs.Trigger>
						{/if}
						<Tabs.Trigger value="files">Files <span class="text-muted-foreground tabular-nums">{fileCount}</span></Tabs.Trigger>
					</Tabs.List>
				</div>

				<Tabs.Content value="ticket" class="min-h-0">
					<ScrollArea class="h-full">
						<div class="p-5">
							{#if ticketFile}
								<FileView job={job.id} path="ticket.md" mtime={ticketFile.mtime} showVerdict={false} />
							{:else}
								<p class="text-sm text-muted-foreground">No ticket.md in this ticket's folder.</p>
							{/if}
						</div>
					</ScrollArea>
				</Tabs.Content>

				{#if live}
					<Tabs.Content value="live" class="flex min-h-0 flex-col">
						<LiveFeed {live} />
						{#if live.log}
							<p class="flex shrink-0 items-center gap-2 border-t px-5 py-2.5 text-xs text-muted-foreground">
								The latest {live.steps.length} steps of this stage.
								<button type="button" class="font-medium text-foreground underline-offset-2 hover:underline" onclick={openLog}>Open the whole log</button>
							</p>
						{/if}
					</Tabs.Content>
				{/if}

				{#if work?.files.length}
					<Tabs.Content value="work" class="min-h-0">
						<ScrollArea class="h-full">
							<div class="p-5">
								<p class="mb-3 text-xs text-muted-foreground">
									What the worktree holds against <span class="font-mono">{config.base_branch}</span>:
									{work.commits} {work.commits === 1 ? 'commit' : 'commits'}{#if work.uncommitted}, and {work.uncommitted} {work.uncommitted === 1 ? 'file' : 'files'} not committed yet{/if}.
								</p>
								<ul class="space-y-0.5">
									{#each work.files as f (f.path)}
										<li class="flex items-center gap-2 font-mono text-xs" title={f.uncommitted ? 'Changed in the worktree, in no commit yet' : 'Committed on the branch'}>
											<span class={cn('size-1.5 shrink-0 rounded-full', f.uncommitted ? 'border border-dashed border-tone-amber' : 'bg-tone-green/70')}></span>
											<span class="min-w-0 flex-1 truncate">{f.path}</span>
											{#if f.uncommitted}<span class="shrink-0 font-sans text-[0.625rem] text-tone-amber">not committed</span>{/if}
											<span class="shrink-0 text-[0.625rem] tabular-nums">
												{#if f.additions}<span class="text-tone-green">+{f.additions}</span>{/if}
												{#if f.deletions}<span class="ms-0.5 text-tone-rose">-{f.deletions}</span>{/if}
											</span>
										</li>
									{/each}
								</ul>
							</div>
						</ScrollArea>
					</Tabs.Content>
				{/if}

				<Tabs.Content value="activity" class="min-h-0">
					<ScrollArea class="h-full">
						<ol class="relative p-5">
							{#each [...job.activity].reverse() as a, i (i)}
								<li class="group/item relative flex gap-3 pb-4 last:pb-0">
									<!-- the thread between entries -->
									<span class="absolute start-[3px] top-4 bottom-0 w-px bg-border group-last/item:hidden"></span>
									<span class="relative mt-1.5 flex flex-col items-center">
										<span class={cn('size-2 rounded-full ring-4 ring-popover', kindDot[a.kind] ?? 'bg-muted-foreground')}></span>
									</span>
									<div class="min-w-0 flex-1">
										<p class="text-sm text-foreground/90">
											{a.text}
											{#if a.result}
												<span class={cn('ms-1 font-mono text-xs', a.result === 'PASS' ? 'text-tone-green' : 'text-destructive')}>{a.result}</span>
											{/if}
										</p>
										<p class="text-xs text-muted-foreground" title={stamp(a.at)}>
											<!-- a move with a note of its own still says where it went -->
											{#if a.to && !a.text.includes('→')}
												{@const to = stageOf(config, a.to)}
												<span class={cn('me-1.5', toneText[toneOf(to, a.to, first)])}>{to?.label ?? a.to}</span>
											{/if}
											{ago(a.at, now)}
										</p>
										<!-- what the stage's agent really ran on, and what it took -->
										{#if a.model || a.turns || a.tokens}
											<p class="mt-0.5 flex flex-wrap gap-x-2 text-[0.6875rem] text-muted-foreground/80" data-facts>
												{#if a.model}<span class="font-mono">{shortModel(a.model)}</span>{/if}
												{#if a.effort}<span>{a.effort} effort</span>{/if}
												{#if a.turns}<span class="tabular-nums">{a.turns} turns</span>{/if}
												{#if a.tokens}<span class="tabular-nums">{count(a.tokens)} tokens</span>{/if}
												{#if a.cost_usd}<span class="tabular-nums" title="At API prices: on a subscription, a measure of usage rather than a bill">{money(a.cost_usd)}</span>{/if}
											</p>
										{/if}
									</div>
								</li>
							{/each}
						</ol>
					</ScrollArea>
				</Tabs.Content>

				<Tabs.Content value="files" class="flex min-h-0 flex-col">
					{#if fileCount === 0}
						<p class="p-5 text-sm text-muted-foreground">No stage has written a file yet.</p>
					{:else}
						<div class="flex flex-wrap gap-x-6 gap-y-3 border-b px-5 py-4">
							{#each groups as g (g.group)}
								<div class="min-w-0">
									<p class="mb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>
									<div class="flex flex-wrap gap-1.5">
										{#each g.files as f (f.path)}
											{@const name = f.path.split('/').at(-1)}
											<button
												type="button"
												onclick={() => pick(f.path)}
												class={cn(
													'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-xs transition-colors hover:bg-accent',
													selected === f.path && 'border-primary/50 bg-primary/10 text-primary'
												)}
												title={`${bytes(f.size)} · ${ago(f.mtime * 1000, now)}`}
											>
												{#if name?.endsWith('.md')}<FileTextIcon class="size-3.5" />{:else}<ScrollTextIcon class="size-3.5" />{/if}
												{name}
											</button>
										{/each}
									</div>
								</div>
							{/each}
						</div>
						<ScrollArea class="min-h-0 flex-1">
							<div class="p-5">
								{#if current}
									<FileView job={job.id} path={current.path} mtime={current.mtime} />
								{:else}
									<p class="text-sm text-muted-foreground">Pick a file to read it.</p>
								{/if}
							</div>
						</ScrollArea>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{/if}
	</Sheet.Content>
</Sheet.Root>
