<script lang="ts">
	import FileDiffIcon from '@lucide/svelte/icons/file-diff'
	import FolderGitIcon from '@lucide/svelte/icons/folder-git-2'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitGraphIcon from '@lucide/svelte/icons/git-graph'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import LockIcon from '@lucide/svelte/icons/lock'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import TagIcon from '@lucide/svelte/icons/tag'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import XIcon from '@lucide/svelte/icons/x'
	import { EMPTY_TREE, WORKTREE, type Compare, type HistoryScope, type LogCommit, type Ref, type Worktree } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { factory } from '$lib/factory.svelte'
	import { ago, stamp } from '$lib/format'
	import { stageOf } from '$lib/board'
	import type { Job } from '$lib/types'
	import WorkStat from '$lib/components/WorkStat.svelte'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import { dotX, laneColor, lanesOf, LANE_W, pathIn, pathOut, pathThrough, ROW_H } from '../lib/lanes'
	import { getTile } from '../pane'
	import { STATUS_LETTER, STATUS_TONE } from '../lib/review'

	// History: the repo's commits as a graph, with what is checked out where. The worktrees are listed beside it
	// (the checkout the app has open, and any others, such as the factory's per-ticket ones), and the scope
	// buttons choose whose history is drawn: this checkout's, the local branches', the remote's, or all of it.
	//
	// The graph also draws history that is still being made: work a worktree holds and has not committed, and a
	// ticket a run is working on, sit above the commit they grow from, on a dashed line. So a ticket shows up here
	// the moment it is picked up, its worktree the moment it exists, and its commits as they land.
	let { now }: { now: number } = $props()
	const tile = getTile()
	const project = $derived(app.project!)

	const PAGE = 300
	const scopes: { value: HistoryScope; label: string; hint: string }[] = [
		{ value: 'head', label: 'Checked out', hint: 'The history of what is checked out here' },
		{ value: 'local', label: 'Local', hint: 'Every local branch' },
		{ value: 'remote', label: 'Remote', hint: 'What the remote has, as of the last fetch' },
		{ value: 'all', label: 'All', hint: 'Local and remote branches, and tags' },
	]

	let scope = $state<HistoryScope>('local')
	let limit = $state(PAGE)
	let commits = $state<LogCommit[] | null>(null)
	let trees = $state<Worktree[]>([])
	let error = $state<string | null>(null)
	let loading = $state(false)
	let selected = $state<string | null>(null)
	let scroller = $state<HTMLElement | null>(null)

	// what was drawn at the last look, to tell which rows are new: null until the first look at a history
	let seen: { key: string; rows: Set<string> } | null = null
	/** rows that appeared since the last look: they arrive with a flash */
	let arrived = $state(new Set<string>())
	let busy = false

	/** `quiet`: a look to keep up with what is happening, which changes nothing on screen unless the repo changed */
	async function load(quiet = false) {
		if (quiet && busy) return
		const key = `${project}\n${scope}\n${limit}`
		busy = true
		if (!quiet) loading = true
		try {
			const [log, wt] = await Promise.all([api.history(project, scope, limit), api.worktrees(project)])
			if (key !== `${project}\n${scope}\n${limit}`) return
			// the same history again is not a change: nothing is redrawn for it
			if (JSON.stringify(log) !== JSON.stringify(commits)) commits = log
			if (JSON.stringify(wt) !== JSON.stringify(trees)) trees = wt
			error = null
		} catch (e) {
			if (!quiet) error = message(e)
		} finally {
			busy = false
			if (!quiet) loading = false
		}
	}
	$effect(() => {
		void [project, scope, limit]
		void load()
	})
	$effect(() => app.onFocus(() => void load()))
	// keep up: often while a run is making history, now and then otherwise
	const making = $derived(!!factory.state?.run)
	$effect(() => {
		const timer = setInterval(() => !document.hidden && void load(true), making ? 1500 : 6000)
		return () => clearInterval(timer)
	})

	// ---- history in the making: what is not a commit yet, drawn above the commit it grows from
	interface Wip {
		key: string
		parent: string
		tree: Worktree | null
		job: Job | null
	}
	const WIP = 'wip:'
	const jobs = $derived(factory.state?.jobs ?? [])
	const wips = $derived.by((): Wip[] => {
		if (!commits || scope === 'remote') return []
		const known = new Set(commits.map((c) => c.sha))
		const list: Wip[] = []
		for (const w of trees) {
			if (!w.head || w.bare || w.prunable || !known.has(w.head)) continue
			const job = (w.branch && jobs.find((j) => j.branch === w.branch)) || null
			// uncommitted work, or a run at work in it right now (a worktree made a second ago has nothing in it yet)
			if (w.changes || job?.live?.state === 'running') list.push({ key: WIP + w.path, parent: w.head, tree: w, job })
		}
		// a ticket being planned has no branch yet: it will grow from the base branch
		const base = factory.state?.config.base_branch
		const tip = commits.find((c) => c.refs.some((r) => r.kind === 'branch' && r.name === base))?.sha
		if (tip) for (const job of jobs) if (job.live?.state === 'running' && !job.worktree) list.push({ key: `${WIP}ticket:${job.id}`, parent: tip, tree: null, job })
		// the checkout that is open keeps its line; the others branch off it
		return list.sort((a, b) => Number(!!b.tree?.current) - Number(!!a.tree?.current) || a.key.localeCompare(b.key))
	})
	const wipOf = $derived(new Map(wips.map((w) => [w.key, w])))
	/** branches that have no commit of their own yet: the row of their work stands for them, not a label on the base commit */
	const unborn = $derived(new Set(wips.filter((w) => w.tree?.branch && !w.tree.current && w.job?.work?.commits === 0).map((w) => w.tree!.branch!)))
	/** the commits, with what is in the making placed above the commit it grows from */
	const drawn = $derived.by((): LogCommit[] | null => {
		if (!commits) return null
		const above = new Map<string, Wip[]>()
		for (const w of wips) above.set(w.parent, [...(above.get(w.parent) ?? []), w])
		return commits.flatMap((c) => [...(above.get(c.sha) ?? []).map((w): LogCommit => ({ sha: w.key, parents: [c.sha], subject: '', author: '', date: '', refs: [] })), c])
	})
	$effect(() => {
		if (!drawn) return
		const key = `${project}\n${scope}`
		const rows = new Set(drawn.map((c) => c.sha))
		const before = seen
		seen = { key, rows }
		// the first look at a history is not news, and neither is a longer page of it
		if (!before || before.key !== key) return
		const fresh = new Set([...rows].filter((sha) => !before.rows.has(sha)))
		if (fresh.size === 0 || fresh.size > 20) return
		arrived = fresh
	})

	function openWip(w: Wip) {
		if (w.job) tile.openBeside({ view: 'board', path: w.job.id })
		else if (w.tree?.current) tile.openBeside({ view: 'changes', source: { base: 'HEAD', head: WORKTREE } })
		else if (w.tree?.head) reveal(w.tree.head)
	}

	const graph = $derived(drawn ? lanesOf(drawn) : null)
	const graphWidth = $derived(Math.max(1, Math.min(graph?.width ?? 1, 14)) * LANE_W)
	/** the worktrees that have each commit checked out */
	const checkedOut = $derived.by(() => {
		const map = new Map<string, Worktree[]>()
		for (const w of trees) if (w.head) map.set(w.head, [...(map.get(w.head) ?? []), w])
		return map
	})
	const here = $derived(trees.find((w) => w.current) ?? null)
	const commit = $derived(commits?.find((c) => c.sha === selected) ?? null)

	// ---- the selected commit: its message and what it changed
	let body = $state<string | null>(null)
	let changed = $state<Compare | null>(null)
	let detailError = $state<string | null>(null)
	const parentOf = (c: LogCommit) => c.parents[0] ?? EMPTY_TREE
	$effect(() => {
		body = null
		changed = null
		detailError = null
		const c = commit
		if (!c) return
		let current = true
		api.commitMessage(project, c.sha).then(
			(m) => current && (body = m),
			(e) => current && (detailError = message(e))
		)
		api.compare(project, parentOf(c), c.sha).then(
			(r) => current && (changed = r),
			(e) => current && (detailError = message(e))
		)
		return () => (current = false)
	})

	function reveal(sha: string | null) {
		if (!sha) return
		selected = sha
		// a commit the scope does not reach is not in the list: widen the scope to find it
		if (commits && !commits.some((c) => c.sha === sha) && scope !== 'all') scope = 'all'
		requestAnimationFrame(() => scroller?.querySelector(`[data-commit="${sha}"]`)?.scrollIntoView({ block: 'center' }))
	}

	const refTone: Record<Ref['kind'], string> = {
		branch: 'border-tone-green/40 bg-tone-green/10 text-tone-green',
		remote: 'border-tone-sky/40 bg-tone-sky/10 text-tone-sky',
		tag: 'border-tone-amber/40 bg-tone-amber/10 text-tone-amber',
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<GitGraphIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">History</h1>
			<p class="truncate text-xs text-muted-foreground">
				{#if here?.branch}On <span class="font-mono">{here.branch}</span>{:else if here?.head}Detached at <span class="font-mono">{here.head.slice(0, 7)}</span>{:else}&nbsp;{/if}
				{#if trees.length > 1}· {trees.length} worktrees{/if}
			</p>
		</div>
		<div class="ms-auto flex shrink-0 items-center gap-2">
			<div class="flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="Whose history">
				{#each scopes as s (s.value)}
					<button
						type="button"
						class={cn(
							'h-full rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
							scope === s.value && 'bg-background text-foreground shadow-xs dark:bg-input/60'
						)}
						aria-pressed={scope === s.value}
						title={s.hint}
						onclick={() => ((scope = s.value), (limit = PAGE))}
					>
						{s.label}
					</button>
				{/each}
			</div>
			<Button variant="ghost" size="icon-sm" onclick={() => load()} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
		</div>
	</header>

	{#if error}
		<EmptyState icon={TriangleAlertIcon} title="Can't read the history">
			<p class="font-mono text-xs text-destructive/90">{error}</p>
		</EmptyState>
	{:else if !commits || !graph}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Reading the history…</p>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col @5xl/pane:flex-row">
			<!-- the worktrees: what is checked out, and where -->
			<aside class="hidden w-60 shrink-0 flex-col border-e @3xl/pane:flex" aria-label="Worktrees">
				<h2 class="px-4 pt-4 pb-2 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Worktrees</h2>
				<ul class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
					{#each trees as w (w.path)}
						<li>
							<button
								type="button"
								class={cn(
									'w-full rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
									w.current && 'border-primary/50',
									w.head !== null && w.head === selected && 'bg-accent/60'
								)}
								title={w.path}
								disabled={!w.head}
								onclick={() => reveal(w.head)}
							>
								<span class="flex items-center gap-1.5 text-sm font-medium">
									<FolderGitIcon class={cn('size-3.5 shrink-0', w.current ? 'text-glow' : 'text-muted-foreground')} />
									<span class="min-w-0 flex-1 truncate">{w.name}</span>
									{#if w.locked}<LockIcon class="size-3 shrink-0 text-muted-foreground" aria-label="Locked" />{/if}
									{#if w.current}<span class="shrink-0 rounded-full bg-primary/15 px-1.5 text-[0.625rem] font-medium text-primary">open here</span>{/if}
								</span>
								<span class="mt-1 flex items-center gap-1 font-mono text-[0.6875rem] text-muted-foreground">
									<GitBranchIcon class="size-3 shrink-0" />
									<span class="min-w-0 flex-1 truncate">{w.branch ?? (w.bare ? 'bare' : w.detached ? 'detached' : 'no branch')}</span>
									{#if w.head}<span class="shrink-0">{w.head.slice(0, 7)}</span>{/if}
								</span>
								<span class={cn('mt-1 block text-[0.6875rem]', w.prunable ? 'text-destructive' : w.changes ? 'text-tone-amber' : 'text-muted-foreground')}>
									{w.prunable ? 'Its folder is gone' : w.changes === null ? '' : w.changes === 0 ? 'Clean' : `${w.changes} uncommitted ${w.changes === 1 ? 'file' : 'files'}`}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</aside>

			<!-- the graph -->
			<div bind:this={scroller} class="min-h-0 min-w-0 flex-1 overflow-auto" aria-label="Commits">
				{#if commits.length === 0}
					<p class="p-6 text-sm text-muted-foreground">
						{scope === 'remote' ? 'No remote branches here. Fetch from a remote to see them.' : 'No commits yet.'}
					</p>
				{:else}
					<ol>
						{#each graph.rows as row (row.commit.sha)}
							{@const c = row.commit}
							<!-- a worktree drawn as a row of its own (work in the making) is not named again on its commit -->
							{@const at = (checkedOut.get(c.sha) ?? []).filter((w) => w.current || !wipOf.has(WIP + w.path))}
							{@const wip = wipOf.get(c.sha)}
							{#if wip}
								{@const job = wip.job}
								{@const live = job?.live?.state === 'running' ? job.live : null}
								{@const stage = job && factory.state ? stageOf(factory.state.config, job.stage) : undefined}
								<li>
									<button
										type="button"
										class={cn('flex w-full items-center gap-3 px-3 text-left text-sm hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none', arrived.has(c.sha) && 'row-new row-in')}
										style:height="{ROW_H}px"
										data-wip={job?.id ?? wip.tree?.name}
										title={wip.tree ? `${wip.tree.branch ?? 'detached'} in ${wip.tree.path}` : undefined}
										data-wip-live={live ? 'running' : undefined}
										onclick={() => openWip(wip)}
									>
										<svg width={graphWidth} height={ROW_H} class="shrink-0 overflow-visible" aria-hidden="true" fill="none" stroke-width="1.75">
											{#each row.through as lane (lane)}<path d={pathThrough(lane)} stroke={laneColor(lane)} />{/each}
											{#each row.to as lane, i (i)}<path d={pathOut(row.lane, lane)} stroke={laneColor(row.lane)} class={cn(live && 'wip-line')} stroke-dasharray="3 3" />{/each}
											{#if live}<circle cx={dotX(row.lane)} cy={ROW_H / 2} r="5" fill={laneColor(row.lane)} class="wip-dot" stroke="none" />{/if}
											<circle cx={dotX(row.lane)} cy={ROW_H / 2} r="4.5" fill="var(--background)" stroke={laneColor(row.lane)} stroke-dasharray="2.5 2" />
										</svg>
										<span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
											{#if job}
												<span class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-primary/50 bg-primary/10 px-1.5 font-mono text-[0.6875rem] font-medium text-primary">
													{#if live}<LoaderIcon class="size-3 animate-spin" />{/if}#{String(job.number).padStart(3, '0')}
												</span>
												{#if !wip.tree}
													<span class="inline-flex h-5 shrink-0 items-center rounded-md border border-dashed px-1.5 text-[0.6875rem] text-muted-foreground" title="A ticket gets its branch and worktree when its build starts. Until then it is planned in the main checkout.">no branch yet</span>
												{/if}
												<span class="min-w-0 shrink truncate">{job.title}</span>
												<span class="min-w-[30%] flex-1 truncate text-xs text-muted-foreground">
													{#if live}
														<span class="font-medium text-primary">{stage?.label ?? job.stage}</span>
														· {live.step?.text ?? 'starting'}
													{:else}
														{wip.tree?.changes} {wip.tree?.changes === 1 ? 'file' : 'files'} not in any commit yet
													{/if}
												</span>
											{:else}
												<!-- one line, whatever the width: the row has a set height -->
												<span class="shrink-0 whitespace-nowrap text-tone-amber">Uncommitted changes{wip.tree?.current ? '' : ` in ${wip.tree?.name}`}</span>
												<span class="min-w-0 truncate text-xs text-muted-foreground">{wip.tree?.changes} {wip.tree?.changes === 1 ? 'file' : 'files'}, not in any commit yet</span>
											{/if}
										</span>
										{#if job?.work}
											<span class="hidden shrink-0 text-xs text-muted-foreground @2xl/pane:flex"><WorkStat work={job.work} /></span>
										{/if}
									</button>
								</li>
							{:else}
							<li>
								<button
									type="button"
									class={cn(
										'flex w-full items-center gap-3 px-3 text-left hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
										selected === c.sha && 'bg-accent/70',
										at.some((w) => w.current) && selected !== c.sha && 'bg-primary/5',
										arrived.has(c.sha) && 'row-new row-in'
									)}
									style:height="{ROW_H}px"
									data-commit={c.sha}
									aria-pressed={selected === c.sha}
									onclick={() => (selected = selected === c.sha ? null : c.sha)}
								>
									<svg width={graphWidth} height={ROW_H} class="shrink-0 overflow-visible" aria-hidden="true" fill="none" stroke-width="1.75">
										{#each row.through as lane (lane)}<path d={pathThrough(lane)} stroke={laneColor(lane)} />{/each}
										{#each row.from as lane (lane)}<path d={pathIn(lane, row.lane)} stroke={laneColor(lane)} />{/each}
										{#each row.to as lane, i (i)}<path d={pathOut(row.lane, lane)} stroke={laneColor(lane)} />{/each}
										<circle
											cx={dotX(row.lane)}
											cy={ROW_H / 2}
											r={c.parents.length > 1 ? 3.5 : 4.5}
											fill={c.parents.length > 1 ? 'var(--background)' : laneColor(row.lane)}
											stroke={laneColor(row.lane)}
										/>
										{#if at.length > 0}<circle cx={dotX(row.lane)} cy={ROW_H / 2} r="8" stroke={laneColor(row.lane)} stroke-width="1.25" opacity="0.7" />{/if}
									</svg>
									<!-- the labels give way before the subject does: they shorten, it keeps a third of the row -->
									<span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
										{#each at as w (w.path)}
											<span
												class={cn('inline-flex h-5 max-w-40 items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-medium', w.current ? 'shrink-0' : 'min-w-10', w.current ? 'border-primary/60 bg-primary/15 text-primary' : 'border-foreground/20 bg-muted text-foreground/80')}
												title="Checked out in {w.path}"
											>
												<FolderGitIcon class="size-3 shrink-0" /><span class="truncate">{w.current ? 'HEAD' : w.name}</span>
											</span>
										{/each}
										{#each c.refs.filter((r) => r.kind !== 'branch' || !unborn.has(r.name)) as ref (ref.kind + ref.name)}
											<span class={cn('inline-flex h-5 max-w-56 min-w-10 items-center gap-1 rounded-md border px-1.5 font-mono text-[0.6875rem]', refTone[ref.kind], ref.head && 'font-semibold')}>
												{#if ref.kind === 'tag'}<TagIcon class="size-3 shrink-0" />{:else}<GitBranchIcon class="size-3 shrink-0" />{/if}
												<span class="truncate">{ref.name}</span>
											</span>
										{/each}
										<span class="min-w-[35%] flex-1 truncate text-sm">{c.subject}</span>
									</span>
									<span class="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground @2xl/pane:flex">
										<span class="max-w-32 truncate">{c.author}</span>
										<span class="w-20 text-right tabular-nums" title={stamp(c.date)}>{ago(c.date, now)}</span>
										<span class="font-mono">{c.sha.slice(0, 7)}</span>
									</span>
								</button>
							</li>
							{/if}
						{/each}
					</ol>
					{#if commits.length >= limit}
						<div class="p-3 text-center">
							<Button variant="outline" size="sm" disabled={loading} onclick={() => (limit += PAGE)}>Show {PAGE} more commits</Button>
						</div>
					{/if}
				{/if}
			</div>

			<!-- the selected commit -->
			{#if commit}
				<aside class="flex max-h-[45%] shrink-0 flex-col border-t @5xl/pane:max-h-none @5xl/pane:w-96 @5xl/pane:border-s @5xl/pane:border-t-0" aria-label="Commit">
					<div class="flex items-start gap-2 border-b p-4">
						<div class="min-w-0 flex-1">
							<h2 class="text-sm leading-snug font-semibold [overflow-wrap:anywhere]">{commit.subject}</h2>
							<p class="mt-1 text-xs text-muted-foreground">
								<span class="font-medium text-foreground">{commit.author}</span> · {stamp(commit.date)} · <span class="font-mono">{commit.sha.slice(0, 10)}</span>
							</p>
						</div>
						<Button variant="ghost" size="icon-xs" onclick={() => (selected = null)} aria-label="Close the commit"><XIcon /></Button>
					</div>
					<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
						{#if body && body.trim() !== commit.subject}
							<pre class="font-sans text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{body.slice(body.indexOf('\n') + 1).trim()}</pre>
						{/if}
						{#if commit.parents.length > 0}
							<p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
								{commit.parents.length > 1 ? 'Merge of' : 'Parent'}
								{#each commit.parents as p (p)}
									<button type="button" class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground/80 hover:bg-accent" onclick={() => reveal(p)}>{p.slice(0, 7)}</button>
								{/each}
							</p>
						{/if}
						{#if detailError}
							<p class="text-xs text-destructive">{detailError}</p>
						{:else if !changed}
							<p class="flex items-center gap-2 text-xs text-muted-foreground"><LoaderIcon class="size-3.5 animate-spin" />Reading what it changed…</p>
						{:else}
							<div>
								<div class="mb-2 flex items-center gap-2">
									<h3 class="text-xs font-medium text-muted-foreground">
										{changed.files.length} {changed.files.length === 1 ? 'file' : 'files'}
										<span class="ms-1 font-mono text-tone-green">+{changed.files.reduce((n, f) => n + f.additions, 0)}</span>
										<span class="font-mono text-tone-rose">-{changed.files.reduce((n, f) => n + f.deletions, 0)}</span>
									</h3>
									{#if changed.files.length > 0}
										<Button
											variant="outline"
											size="xs"
											class="ms-auto"
											onclick={() => tile.openBeside({ view: 'changes', source: { base: parentOf(commit), head: commit.sha, title: commit.subject } })}
										>
											<FileDiffIcon />Open the diff
										</Button>
									{/if}
								</div>
								<ul class="space-y-0.5">
									{#each changed.files as f (f.path)}
										<li class="flex items-center gap-2 font-mono text-xs" title={f.path}>
											<span class={cn('w-3 shrink-0 text-center font-semibold', STATUS_TONE[f.status])}>{STATUS_LETTER[f.status]}</span>
											<span class="min-w-0 flex-1 truncate">{f.path}</span>
											<span class="shrink-0 text-[0.625rem] tabular-nums">
												{#if f.additions}<span class="text-tone-green">+{f.additions}</span>{/if}
												{#if f.deletions}<span class="ms-0.5 text-tone-rose">-{f.deletions}</span>{/if}
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				</aside>
			{/if}
		</div>
	{/if}
</div>
