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
	import FileView from './FileView.svelte'
	import StageBadge from './StageBadge.svelte'
	import StageIcon from './StageIcon.svelte'

	// `onreview` opens the ticket's branch in the diff viewer
	let {
		job,
		config,
		now,
		onreview,
		open = $bindable(false),
	}: { job: Job | null; config: Config; now: number; onreview?: (job: Job) => void; open?: boolean } = $props()

	let tab = $state('ticket')
	let selected = $state<string | null>(null)

	// a new ticket opens on its request, with no file picked
	let shownId = $state<string | null>(null)
	$effect(() => {
		if (job && job.id !== shownId) {
			shownId = job.id
			tab = 'ticket'
			selected = null
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

	const kindDot: Record<string, string> = {
		created: 'bg-muted-foreground',
		moved: 'bg-primary',
		check: 'bg-tone-sky',
		note: 'bg-muted-foreground/60',
		blocked: 'bg-tone-amber',
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
					{#if job.branch}
						<span class="inline-flex items-center gap-1 font-mono"><GitBranchIcon class="size-3" />{job.branch}</span>
					{/if}
				</Sheet.Description>
				{#if job.branch && onreview}
					<div>
						<Button variant="outline" size="sm" onclick={() => ((open = false), onreview(job))}><GitCompareIcon />Review changes</Button>
					</div>
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
									blockedHere && 'bg-tone-amber'
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
						<Tabs.Trigger value="activity">Activity <span class="text-muted-foreground tabular-nums">{job.activity.length}</span></Tabs.Trigger>
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
