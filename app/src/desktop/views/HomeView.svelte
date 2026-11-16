<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity'
	import BotIcon from '@lucide/svelte/icons/bot'
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
	import CpuIcon from '@lucide/svelte/icons/cpu'
	import EyeIcon from '@lucide/svelte/icons/eye'
	import FactoryIcon from '@lucide/svelte/icons/factory'
	import FileDiffIcon from '@lucide/svelte/icons/file-diff'
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows'
	import GitGraphIcon from '@lucide/svelte/icons/git-graph'
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request'
	import HandIcon from '@lucide/svelte/icons/hand'
	import HouseIcon from '@lucide/svelte/icons/house'
	import ListChecksIcon from '@lucide/svelte/icons/list-checks'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import NotebookTextIcon from '@lucide/svelte/icons/notebook-text'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal'
	import SparklesIcon from '@lucide/svelte/icons/sparkles'
	import CircleCheckBigIcon from '@lucide/svelte/icons/circle-check-big'
	import UsersIcon from '@lucide/svelte/icons/users'
	import type { Component } from 'svelte'
	import type { Doctor, JournalEntry } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { isActive } from '$lib/board'
	import { factory } from '$lib/factory.svelte'
	import { ago, stamp } from '$lib/format'
	import { BLOCKED } from '$lib/types'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app, type Route } from '../app.svelte'
	import InstallCommand from '../components/InstallCommand.svelte'
	import { gist, kindChip, kindLabel } from '../lib/journal'
	import { getTile } from '../pane'

	// Home: where a project opens, and the way to everything else. What needs you, the numbers at a glance, how
	// agents are told to work here, the latest changes and why they were made, and whether the factory is set up
	// right. Every card leads somewhere in one click. A repo without a factory leads with how to install it.
	let { now }: { now: number } = $props()
	const tile = getTile()

	/** what the app gives a developer, in three short points */
	const points = [
		{
			icon: BotIcon,
			title: 'Agents pick it up on their own',
			text: 'Any agent that starts in a repo with the factory, Claude Code or Codex, reads its rules and roles and follows the same workflow. There is nothing to set up per session.',
		},
		{
			icon: EyeIcon,
			title: 'See the whole process',
			text: 'Tickets moving through plan, build, check and review, the changes they produce, and the reason behind each one. Less guessing about what happened while you were away.',
		},
		{
			icon: SlidersIcon,
			title: 'Steer it, and extend it',
			text: 'Rules, roles and models are plain files in the repo, edited from here. Change how agents behave in this project, as much or as little as you like, without touching your own setup.',
		},
	]
	/** the introduction stays open until it is hidden, and stays hidden after that */
	let aboutOpen = $state(
		(() => {
			try {
				return localStorage.getItem('factory-home-about') !== 'hidden'
			} catch {
				return true
			}
		})()
	)
	function setAbout(open: boolean) {
		aboutOpen = open
		try {
			localStorage.setItem('factory-home-about', open ? 'open' : 'hidden')
		} catch {
			/* then it lasts for this visit */
		}
	}
	const project = $derived(app.project!)
	const info = $derived(app.info)
	const installed = $derived(info ? info.hasFactory : null)

	let entries = $state<JournalEntry[] | null>(null)
	let doctor = $state<Doctor | null>(null)
	let checking = $state(false)

	async function loadJournal() {
		const p = project
		try {
			const next = await api.journal(p)
			if (p === project) entries = next
		} catch {
			if (p === project) entries = []
		}
	}

	async function check() {
		const p = project
		checking = true
		try {
			const next = await api.doctor(p)
			if (p === project) doctor = next
		} catch (e) {
			if (p === project) doctor = { items: [], error: message(e), kitVersion: null, appVersion: '' }
		} finally {
			checking = false
		}
	}

	$effect(() => {
		void [project, installed]
		if (installed === null) return
		void loadJournal()
		void check()
	})
	$effect(() => app.onFocus(() => void loadJournal()))

	const config = $derived(factory.state?.config ?? null)
	const jobs = $derived(factory.state?.jobs ?? [])
	const blocked = $derived(jobs.filter((j) => j.stage === BLOCKED).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
	const active = $derived(config ? jobs.filter((j) => isActive(config, j)).length : 0)
	const done = $derived(config ? jobs.filter((j) => config.stages.some((s) => s.terminal && s.key === j.stage)).length : 0)
	const github = $derived(!!info?.github)

	interface Stat {
		label: string
		/** what the number is, in full */
		title?: string
		value: number | null
		icon: Component<{ class?: string }>
		tone: string
		to: Route
		off?: boolean
		hint?: string
	}
	const stats = $derived<Stat[]>([
		...(installed
			? [
					{ label: 'In progress', value: active, icon: ActivityIcon, tone: 'text-primary', to: { view: 'board' } } satisfies Stat,
					{ label: 'Done', value: done, icon: CircleCheckBigIcon, tone: 'text-tone-green', to: { view: 'board' } } satisfies Stat,
				]
			: []),
		{ label: 'Uncommitted', title: 'Uncommitted files', value: app.counts.changes, icon: FileDiffIcon, tone: 'text-tone-amber', to: { view: 'changes' }, off: info ? !info.isGit : false },
		{ label: 'Pull requests', title: 'Open pull requests', value: github ? app.counts.pulls : null, icon: GitPullRequestIcon, tone: 'text-tone-sky', to: { view: 'pulls' }, hint: github ? undefined : 'GitHub is not connected' },
		{ label: 'Issues', title: 'Open issues', value: github ? app.counts.issues : null, icon: CircleDotIcon, tone: 'text-tone-violet', to: { view: 'issues' }, hint: github ? undefined : 'GitHub is not connected' },
		...(installed ? [{ label: 'Journal', title: 'Journal entries', value: entries?.length ?? null, icon: NotebookTextIcon, tone: 'text-glow', to: { view: 'journal' } } satisfies Stat] : []),
	])

	/** what the app knows itself and the factory's check does not say: GitHub, and the app's own version */
	const extra = $derived.by(() => {
		const out: { id: string; ok: boolean; text: string }[] = []
		if (!doctor?.items.some((i) => /github|\bgh\b/i.test(i.id))) {
			out.push(
				info?.github
					? { id: 'app-github', ok: true, text: `GitHub connected: ${info.github.owner}/${info.github.repo}, signed in as ${info.github.viewer}` }
					: { id: 'app-github', ok: false, text: `GitHub is not connected. ${info?.githubError ?? ''}`.trim() }
			)
		}
		if (doctor?.appVersion) out.push({ id: 'app-version', ok: true, text: `Factory app ${doctor.appVersion}` })
		return out
	})
	// the factory's own line about the app is about the copy its CLI downloads: this one is running, and says so above
	const checklist = $derived([...(doctor?.items ?? []).filter((i) => i.id !== 'app'), ...extra])
	const problems = $derived(checklist.filter((i) => !i.ok).length)

	/** the Agents view here, and a file of it in the editor beside */
	function edit(path: string) {
		tile.go({ view: 'agents' })
		tile.openBeside({ view: 'edit', path })
	}

	/** the Agents view ready to make a skill in .factory/skills/, and the guide to writing one beside it */
	function newSkill() {
		tile.go({ view: 'agents', path: '.factory/skills' })
		tile.openBeside({ view: 'guide', path: 'skills' })
	}

	const without: { view: Route['view']; label: string; icon: Component<{ class?: string }>; git?: boolean }[] = [
		{ view: 'changes', label: 'Changes', icon: GitCompareIcon, git: true },
		{ view: 'pulls', label: 'Pull requests', icon: GitPullRequestIcon },
		{ view: 'issues', label: 'Issues', icon: CircleDotIcon },
		{ view: 'code', label: 'Code', icon: FolderTreeIcon },
		{ view: 'history', label: 'History', icon: GitGraphIcon, git: true },
		{ view: 'agents', label: 'Agents', icon: BotIcon },
	]
</script>

{#snippet cardHead(Icon: Component<{ class?: string }>, title: string, more?: { label: string; run: () => void })}
	<div class="flex items-center gap-2">
		<Icon class="size-4 shrink-0 text-muted-foreground" />
		<h2 class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</h2>
		{#if more}
			<Button variant="ghost" size="xs" class="-me-2 shrink-0 text-muted-foreground" onclick={more.run}>{more.label}<ChevronRightIcon /></Button>
		{/if}
	</div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<HouseIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">Home</h1>
			<p class="flex items-center gap-1 truncate text-xs text-muted-foreground">
				{info?.name ?? ''}
				{#if info?.branch}<span aria-hidden="true">·</span><GitBranchIcon class="size-3 shrink-0" /><span class="truncate font-mono">{info.branch}</span>{/if}
				{#if config?.name && config.name !== 'Factory'}<span aria-hidden="true">·</span><span class="truncate">{config.name}</span>{/if}
			</p>
		</div>
	</header>

	<div class="forge-glow min-h-0 flex-1 overflow-y-auto">
		{#if installed === null}
			<p class="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
		{:else}
			<div class="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 @2xl/pane:p-6 @4xl/pane:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<!-- what the app is for, for someone meeting it: it folds to a line once read -->
				<section class="@4xl/pane:col-span-2" aria-label="About Factory">
					{#if aboutOpen}
						<div class="rounded-xl border bg-card p-5">
							<div class="flex items-start gap-3">
								<div class="min-w-0 flex-1">
									<h2 class="text-lg leading-snug font-semibold tracking-tight">Your workflow, with a clearer view.</h2>
									<p class="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
										Factory sits beside the way you already work with coding agents. You keep your editor, your prompts and your git habits. What you gain is a view of what the agents are doing,
										and one place to steer them.
									</p>
								</div>
								<Button variant="ghost" size="xs" class="shrink-0 text-muted-foreground" onclick={() => setAbout(false)}>Hide</Button>
							</div>
							<div class="mt-4 grid gap-x-6 gap-y-4 @3xl/pane:grid-cols-3">
								{#each points as point (point.title)}
									<div class="flex gap-3">
										<span class="grid size-8 shrink-0 place-items-center rounded-lg border bg-background"><point.icon class="size-4 text-glow" /></span>
										<div class="min-w-0">
											<h3 class="text-sm font-medium">{point.title}</h3>
											<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">{point.text}</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
							onclick={() => setAbout(true)}
						>
							<FactoryIcon class="size-3.5 shrink-0" />
							<span class="truncate">Your workflow, with a clearer view: what agents are doing here, and one place to steer them</span>
							<span class="ms-auto shrink-0 underline underline-offset-4">What is Factory?</span>
						</button>
					{/if}
				</section>
				{#if !installed}
					<!-- no factory: how to get one comes first -->
					<section class="glow-card rounded-xl border p-5 @4xl/pane:col-span-2" aria-label="Install the factory">
						<FactoryIcon class="size-5 text-glow" />
						<h2 class="mt-3 font-semibold tracking-tight">Install the factory in this repo</h2>
						<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
							It adds one folder, <span class="font-mono">.factory/</span>, and a small CLI. Tickets then move through plan, build, check and review, worked by Claude Code or Codex, and every finished change leaves a
							note on why it was made.
						</p>
						<InstallCommand class="mt-4 max-w-2xl" />
						<p class="mt-3 text-xs text-muted-foreground">This page picks it up once it is installed.</p>
					</section>
				{/if}

				<div class="flex min-w-0 flex-col gap-4">
					{#if installed}
						<!-- what is waiting on a person -->
						<section class={cn('rounded-xl border p-4', blocked.length ? 'glow-card' : 'bg-card')} aria-label="Needs you">
							{@render cardHead(HandIcon, 'Needs you', { label: 'Board', run: () => tile.go({ view: 'board' }) })}
							{#if blocked.length === 0}
								<p class="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
									<CircleCheckIcon class="size-4 shrink-0 text-tone-green" />Nothing is waiting on you.{#if active}&nbsp;{active} {active === 1 ? 'ticket is' : 'tickets are'} moving.{/if}
								</p>
							{:else}
								<ul class="mt-3 space-y-2">
									{#each blocked as job (job.id)}
										<li>
											<button
												type="button"
												class="w-full rounded-lg border border-tone-amber/30 bg-background/60 p-3 text-left transition-colors hover:border-tone-amber/60 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
												onclick={() => tile.go({ view: 'board', path: job.id })}
											>
												<span class="flex items-baseline gap-2">
													<span class="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{String(job.number).padStart(3, '0')}</span>
													<span class="min-w-0 flex-1 truncate text-sm font-medium">{job.title}</span>
													<span class="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{ago(job.updated_at, now)}</span>
												</span>
												<span class="mt-1.5 block rounded-md bg-tone-amber/10 px-2 py-1.5 text-xs text-tone-amber"><span class="line-clamp-2">{job.blocked_reason ?? 'Blocked without a reason.'}</span></span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</section>

						<!-- the journal: what changed lately, and why -->
						<section class="rounded-xl border bg-card p-4" aria-label="Recent changes and why">
							{@render cardHead(NotebookTextIcon, 'Recent changes and why', { label: 'Journal', run: () => tile.go({ view: 'journal' }) })}
							{#if entries === null}
								<p class="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Reading the journal…</p>
							{:else if entries.length === 0}
								<p class="mt-2 text-sm text-muted-foreground">
									No entries yet. The factory writes one when a ticket is done, saying what changed and why; <span class="font-mono text-xs">node .factory/cli.mjs journal add</span> writes one by hand.
								</p>
							{:else}
								<ul class="mt-2 -mx-2">
									{#each entries.slice(0, 3) as e (e.id)}
										<li>
											<button
												type="button"
												class="w-full rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
												onclick={() => tile.go({ view: 'journal', path: e.id })}
											>
												<span class="flex items-center gap-2">
													<span class={cn('shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] font-medium', kindChip(e.kind))}>{kindLabel(e.kind)}</span>
													<span class="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
													<span class="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums" title={stamp(e.at)}>{ago(e.at, now)}</span>
												</span>
												{#if gist(e)}<span class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{gist(e)}</span>{/if}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</section>
					{:else}
						<!-- the views that need no factory -->
						<section class="rounded-xl border bg-card p-4" aria-label="Works without it">
							{@render cardHead(FolderTreeIcon, 'Works without it')}
							<div class="mt-3 grid grid-cols-2 gap-2 @xl/pane:grid-cols-3">
								{#each without as v (v.view)}
									<button
										type="button"
										class="flex h-10 items-center gap-2.5 rounded-lg border bg-background/60 px-3 text-sm transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
										disabled={v.git && info ? !info.isGit : false}
										onclick={() => tile.go({ view: v.view })}
									>
										<v.icon class="size-4 shrink-0 text-muted-foreground" /><span class="truncate">{v.label}</span>
									</button>
								{/each}
							</div>
						</section>
					{/if}
				</div>

				<div class="flex min-w-0 flex-col gap-4">
					<!-- the numbers, each a way to its view -->
					<section class="rounded-xl border bg-card p-4" aria-label="At a glance">
						{@render cardHead(ActivityIcon, 'At a glance')}
						<!-- six numbers in two or three columns; without a factory, three in a row -->
						<div class={cn('mt-3 grid gap-2', installed ? 'grid-cols-2 @xl/pane:grid-cols-3 @4xl/pane:grid-cols-2 @7xl/pane:grid-cols-3' : 'grid-cols-1 @sm/pane:grid-cols-3')}>
							{#each stats as s (s.label)}
								<button
									type="button"
									class="rounded-lg border bg-background/60 px-3 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
									disabled={s.off}
									title={s.hint ?? s.title ?? s.label}
									onclick={() => tile.go(s.to)}
								>
									<span class="flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
										<span class="truncate">{s.label}</span>
										<s.icon class={cn('size-3.5 shrink-0', s.tone)} />
									</span>
									<span class={cn('mt-0.5 block text-xl font-semibold tracking-tight tabular-nums', s.value === null && 'text-muted-foreground/60')}>{s.value ?? '-'}</span>
								</button>
							{/each}
						</div>
					</section>

					{#if installed}
						<!-- how agents are told to work here -->
						<section class="rounded-xl border bg-card p-4" aria-label="Change how agents work here">
							{@render cardHead(SlidersIcon, 'Change how agents work here', { label: 'Agents', run: () => tile.go({ view: 'agents' }) })}
							<ul class="mt-2 -mx-2">
								{@render action(ScrollTextIcon, 'Rules', 'The stack, code quality and conventions every agent follows here', () => edit('.factory/rules.md'))}
								{@render action(UsersIcon, 'Roles', 'What the planner, builder and reviewer are each told to do', () => edit('.factory/roles/planner.md'))}
								{@render action(SparklesIcon, 'Skills', 'Teach agents one kind of task here: a new skill, with a guide to writing it beside', newSkill)}
								{@render action(CpuIcon, 'Models and effort', 'Which model each role runs on, and how hard it thinks', () => tile.go({ view: 'models' }))}
							</ul>
						</section>
					{/if}

					<!-- is everything in place -->
					<section class={cn('rounded-xl border bg-card p-4', problems > 0 && 'border-tone-amber/30')} aria-label="Setup">
						<div class="flex items-center gap-2">
							<ListChecksIcon class="size-4 shrink-0 text-muted-foreground" />
							<h2 class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">Setup</h2>
							{#if doctor?.kitVersion}<span class="max-w-32 shrink-0 truncate rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground" title="The factory kit installed in this repo">kit {doctor.kitVersion}</span>{/if}
							<Button variant="ghost" size="icon-xs" class="-me-1 shrink-0" onclick={check} disabled={checking} aria-label="Check again"><RefreshCwIcon class={cn(checking && 'animate-spin')} /></Button>
						</div>
						{#if !doctor}
							<p class="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Checking…</p>
						{:else}
							<ul class="mt-3 space-y-2" aria-label="Checklist">
								{#if !installed}
									<li class="flex gap-2.5 text-sm" data-ok="false">
										<CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-tone-amber" /><span class="min-w-0">The factory is not installed in this repo. Install it with the command above.</span>
									</li>
								{/if}
								{#if doctor.error}
									<li class="flex gap-2.5 text-sm" data-ok="false">
										<CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-tone-amber" /><span class="min-w-0 [overflow-wrap:anywhere]">{doctor.error}</span>
									</li>
								{/if}
								{#each checklist as item (item.id)}
									<li class="flex gap-2.5 text-sm" data-ok={item.ok}>
										{#if item.ok}<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-tone-green" />{:else}<CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-tone-amber" />{/if}
										<span class={cn('min-w-0 [overflow-wrap:anywhere]', item.ok ? 'text-muted-foreground' : 'text-foreground')}>
											<!-- `code` in the factory's words, as code -->
											{#each item.text.split('`') as part, i (i)}{#if i % 2}<code class="rounded bg-muted px-1 font-mono text-[0.8125em]">{part}</code>{:else}{part}{/if}{/each}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				</div>
			</div>
		{/if}
	</div>
</div>

{#snippet action(Icon: Component<{ class?: string }>, title: string, hint: string, run: () => void)}
	<li>
		<button type="button" class="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" onclick={run}>
			<span class="grid size-8 shrink-0 place-items-center rounded-md border bg-background/60"><Icon class="size-4 text-glow" /></span>
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-medium">{title}</span>
				<span class="line-clamp-2 block text-xs text-muted-foreground">{hint}</span>
			</span>
			<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
		</button>
	</li>
{/snippet}
