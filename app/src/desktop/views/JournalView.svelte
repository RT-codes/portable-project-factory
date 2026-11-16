<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain'
	import FileCodeIcon from '@lucide/svelte/icons/file-code'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitCommitIcon from '@lucide/svelte/icons/git-commit-horizontal'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import NotebookTextIcon from '@lucide/svelte/icons/notebook-text'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import SearchIcon from '@lucide/svelte/icons/search'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import XIcon from '@lucide/svelte/icons/x'
	import { EMPTY_TREE, JOURNAL_KINDS, type CommitFacts, type JournalEntry } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { factory } from '$lib/factory.svelte'
	import { ago, stamp } from '$lib/format'
	import { renderMarkdown } from '$lib/markdown'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import InstallCommand from '../components/InstallCommand.svelte'
	import { byMonth, day, gist, kindChip, kindLabel, matches } from '../lib/journal'
	import { getTile } from '../pane'

	// The journal: why things changed. The factory writes an entry when a ticket is done (and anyone can add one),
	// committed under .factory/journal/, so the reasons travel with the code. A timeline by month, a search and a
	// filter by kind, and the open entry beside the list (below it in a narrow panel), with its commits and files a
	// click away. `route.path` names the entry to open.
	let { now }: { now: number } = $props()
	const tile = getTile()

	// how much of the journal an agent is handed before it works: the repo's own setting (the CLI's defaults otherwise)
	const recent = $derived(factory.state?.config.journal?.recent ?? 5)
	const titles = $derived(factory.state?.config.journal?.titles ?? 20)
	/** the explanation at the top stays open until it is hidden, and stays hidden after that */
	let aboutOpen = $state(
		(() => {
			try {
				return localStorage.getItem('factory-journal-about') !== 'hidden'
			} catch {
				return true
			}
		})()
	)
	function setAbout(open: boolean) {
		aboutOpen = open
		try {
			localStorage.setItem('factory-journal-about', open ? 'open' : 'hidden')
		} catch {
			/* then it lasts for this visit */
		}
	}
	const project = $derived(app.project!)

	let entries = $state<JournalEntry[] | null>(null)
	let error = $state<string | null>(null)
	let loading = $state(false)
	let query = $state('')
	let kind = $state<string | null>(null)
	let selected = $state<string | null>(null)
	let list = $state<HTMLElement | null>(null)

	async function load() {
		const p = project
		loading = true
		try {
			const next = await api.journal(p)
			if (p !== project) return
			entries = next
			error = null
		} catch (e) {
			if (p === project) error = message(e)
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void project
		void load()
	})
	$effect(() => app.onFocus(() => void load()))

	// the entry the route names (Home sends people here that way), shown once the list is read
	$effect(() => {
		const want = tile.route.path ?? null
		if (!want || !entries) return
		selected = want
		requestAnimationFrame(() => list?.querySelector(`[data-entry="${CSS.escape(want)}"]`)?.scrollIntoView({ block: 'nearest' }))
	})

	const shown = $derived((entries ?? []).filter((e) => (!kind || e.kind === kind) && matches(e, query)))
	const months = $derived(byMonth(shown))
	const entry = $derived(entries?.find((e) => e.id === selected) ?? null)
	const counts = $derived(Object.fromEntries(JOURNAL_KINDS.map((k) => [k, (entries ?? []).filter((e) => e.kind === k).length])))

	function pick(id: string) {
		selected = selected === id ? null : id
		// the route remembers it, so the panel comes back to it
		tile.go({ view: 'journal', ...(selected ? { path: selected } : {}) })
	}

	// ---- the open entry's commits: whether they are here, and what to diff them against
	let facts = $state<CommitFacts[] | null>(null)
	$effect(() => {
		facts = null
		const e = entry
		if (!e || e.commits.length === 0) return
		let current = true
		api.commitFacts(project, e.commits).then(
			(f) => current && (facts = f),
			() => current && (facts = e.commits.map((sha) => ({ sha, full: null, parent: null, subject: null })))
		)
		return () => (current = false)
	})

	const ticketHere = $derived(!!entry?.ticket && !!factory.state?.jobs.some((j) => j.id === entry!.ticket))
	const roleOrder = ['planner', 'builder', 'reviewer']
	const byRoles = $derived(entry ? Object.entries(entry.by).sort(([a], [b]) => (roleOrder.indexOf(a) + 1 || 9) - (roleOrder.indexOf(b) + 1 || 9)) : [])
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<NotebookTextIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">Journal</h1>
			<p class="truncate text-xs text-muted-foreground">
				Why things changed{#if entries?.length}&nbsp;· {entries.length} {entries.length === 1 ? 'entry' : 'entries'}{/if}
			</p>
		</div>
		<Button variant="ghost" size="icon-sm" class="ms-auto shrink-0" onclick={load} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
	</header>

	<!-- what this is and why it is here, for whoever opens the view: it can be folded away once read -->
	{#if app.info?.hasFactory}
		<section class="shrink-0 border-b bg-muted/30" aria-label="About the journal">
			{#if aboutOpen}
				<div class="flex gap-3 px-4 py-3">
					<BrainIcon class="mt-0.5 size-4 shrink-0 text-glow" />
					<div class="min-w-0 flex-1 space-y-1.5 text-sm leading-relaxed">
						<p class="font-medium">The repo's memory for agents.</p>
						<p class="text-muted-foreground">
							Git records <span class="text-foreground/90">what</span> changed. The journal records <span class="text-foreground/90">why</span>: the reason, the decisions made on the way, and what to watch
							out for. Agents read it so they build on earlier work instead of undoing a decision or repeating a fix that was already tried.
						</p>
						<ul class="space-y-1 text-muted-foreground">
							<li class="flex gap-2">
								<span class="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"></span>
								<span>
									<span class="text-foreground/90">Loaded at the start of work:</span> the last <span class="font-medium text-foreground/90 tabular-nums">{recent}</span>
									{recent === 1 ? 'change' : 'changes'} in full, the <span class="font-medium text-foreground/90 tabular-nums">{titles}</span> before as one line each, and everything older as a line per month.
								</span>
							</li>
							<li class="flex gap-2">
								<span class="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"></span>
								<span><span class="text-foreground/90">Searchable on demand:</span> an agent can look up any older change by words or by file when it needs the detail.</span>
							</li>
							<li class="flex gap-2">
								<span class="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"></span>
								<span><span class="text-foreground/90">Written when a ticket finishes,</span> and committed with the code: facts and reasons, never your prompts.</span>
							</li>
						</ul>
					</div>
					<Button variant="ghost" size="xs" class="shrink-0 text-muted-foreground" onclick={() => setAbout(false)}>Hide</Button>
				</div>
			{:else}
				<button type="button" class="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground" onclick={() => setAbout(true)}>
					<BrainIcon class="size-3.5 shrink-0" />
					<span class="truncate">The repo's memory for agents: why things changed, loaded before they work</span>
					<span class="ms-auto shrink-0 underline underline-offset-4">What is this?</span>
				</button>
			{/if}
		</section>
	{/if}

	{#if error}
		<EmptyState icon={TriangleAlertIcon} title="Can't read the journal">
			<p class="font-mono text-xs text-destructive/90">{error}</p>
		</EmptyState>
	{:else if entries === null}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Reading the journal…</p>
	{:else if entries.length === 0}
		<EmptyState icon={NotebookTextIcon} title="No journal entries yet" glow>
			<p>
				The journal keeps why things changed, next to the code: what changed, why, the decisions made on the way and what to watch out for. Each entry is a file in <span class="font-mono">.factory/journal/</span>,
				committed with the work, so agents and people read it later.
			</p>
			{#if app.info?.hasFactory}
				<p>The factory writes an entry when a ticket is done. To write one yourself:</p>
				<pre class="rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"><span class="text-muted-foreground">$</span> node .factory/cli.mjs journal add</pre>
			{:else}
				<p>It comes with the factory:</p>
				<InstallCommand />
			{/if}
		</EmptyState>
	{:else}
		<!-- search and filter -->
		<div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
			<label class="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
				<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
				<input bind:value={query} placeholder="Search titles, tags, files and what was written" aria-label="Search the journal" class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70" />
				{#if query}<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => (query = '')} aria-label="Clear the search"><XIcon class="size-3.5" /></button>{/if}
			</label>
			<div class="flex h-8 max-w-full items-center overflow-x-auto rounded-lg bg-muted p-[3px]" role="group" aria-label="Kind">
				{#each [null, ...JOURNAL_KINDS] as k (k ?? 'all')}
					<button
						type="button"
						class={cn(
							'flex h-full shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
							kind === k && 'bg-background text-foreground shadow-xs dark:bg-input/60'
						)}
						aria-pressed={kind === k}
						disabled={k !== null && counts[k] === 0}
						onclick={() => (kind = k)}
					>
						{k === null ? 'All' : kindLabel(k)}
					</button>
				{/each}
			</div>
		</div>

		<div class="flex min-h-0 flex-1 flex-col @5xl/pane:flex-row">
			<!-- the timeline -->
			<div bind:this={list} class="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="Entries">
				{#if shown.length === 0}
					<p class="p-6 text-sm text-muted-foreground">No entry matches{query ? ` "${query.trim()}"` : ''}{kind ? ` among the ${kindLabel(kind).toLowerCase()}s` : ''}.</p>
				{/if}
				{#each months as m (m.month)}
					<section>
						<h2 class="sticky top-0 z-10 border-b bg-background/95 px-4 py-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">{m.month}</h2>
						<ol>
							{#each m.entries as e (e.id)}
								<li>
									<button
										type="button"
										class={cn(
											'flex w-full items-start gap-3 border-b border-border/50 px-4 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
											selected === e.id && 'bg-accent/70 hover:bg-accent/70'
										)}
										data-entry={e.id}
										aria-pressed={selected === e.id}
										onclick={() => pick(e.id)}
									>
										<span class="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums" title={stamp(e.at)}>{day(e.at)}</span>
										<span class="min-w-0 flex-1">
											<span class="flex items-center gap-2">
												<span class={cn('shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] font-medium', kindChip(e.kind))}>{kindLabel(e.kind)}</span>
												<span class="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
											</span>
											<span class="mt-1 flex min-w-0 items-center gap-3 text-[0.6875rem] text-muted-foreground">
												{#if e.ticket}<span class="shrink-0 font-mono">{e.ticket.replace(/^(\d+)-.*/, '#$1')}</span>{/if}
												{#if e.files.length}
													<span class="flex min-w-0 items-center gap-1 truncate font-mono" title={e.files.join('\n')}>
														<FileCodeIcon class="size-3 shrink-0" /><span class="truncate">{e.files.slice(0, 3).map((f) => f.split('/').at(-1)).join(', ')}{e.files.length > 3 ? ` +${e.files.length - 3}` : ''}</span>
													</span>
												{:else if gist(e)}
													<span class="truncate">{gist(e)}</span>
												{/if}
											</span>
										</span>
									</button>
								</li>
							{/each}
						</ol>
					</section>
				{/each}
			</div>

			<!-- the open entry -->
			{#if entry}
				<aside class="flex max-h-[60%] shrink-0 flex-col border-t @5xl/pane:max-h-none @5xl/pane:w-[28rem] @5xl/pane:border-s @5xl/pane:border-t-0 @7xl/pane:w-[34rem]" aria-label="Entry">
					<div class="flex items-start gap-2 border-b p-4">
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-2 text-xs text-muted-foreground">
								<span class={cn('rounded-full px-1.5 py-px text-[0.6875rem] font-medium', kindChip(entry.kind))}>{kindLabel(entry.kind)}</span>
								<span title={stamp(entry.at)}>{stamp(entry.at)} · {ago(entry.at, now)}</span>
							</p>
							<h2 class="mt-1.5 text-base leading-snug font-semibold [overflow-wrap:anywhere]">{entry.title}</h2>
						</div>
						<Button variant="ghost" size="icon-xs" onclick={() => pick(entry.id)} aria-label="Close the entry"><XIcon /></Button>
					</div>
					<div class="min-h-0 flex-1 overflow-y-auto">
						<div class="space-y-5 p-4">
							{#each entry.sections as s, i (i)}
								<section>
									{#if s.heading}<h3 class="mb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{s.heading}</h3>{/if}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
									<div class="md text-sm">{@html renderMarkdown(s.body)}</div>
								</section>
							{/each}
						</div>

						<!-- the facts -->
						<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t p-4 text-xs" aria-label="Facts">
							<dt class="text-muted-foreground">When</dt>
							<dd>{stamp(entry.at)}</dd>
							{#if entry.ticket}
								<dt class="text-muted-foreground">Ticket</dt>
								<dd>
									{#if ticketHere}
										<button type="button" class="font-mono text-primary hover:underline" onclick={() => tile.openBeside({ view: 'board', path: entry.ticket! })}>{entry.ticket}</button>
									{:else}
										<span class="font-mono">{entry.ticket}</span>
										<span class="text-muted-foreground"> · not on this machine (tickets are not committed)</span>
									{/if}
								</dd>
							{/if}
							{#if entry.branch}
								<dt class="text-muted-foreground">Branch</dt>
								<dd class="flex min-w-0 items-center gap-1 font-mono"><GitBranchIcon class="size-3 shrink-0 text-muted-foreground" /><span class="truncate">{entry.branch}</span></dd>
							{/if}
							{#if byRoles.length}
								<dt class="text-muted-foreground">Done by</dt>
								<dd class="flex flex-wrap gap-1.5">
									{#each byRoles as [role, who] (role)}
										<span class="rounded-md border px-1.5 py-0.5"><span class="text-muted-foreground">{role}</span> <span class="font-mono">{who}</span></span>
									{/each}
								</dd>
							{/if}
							{#if entry.tags.length}
								<dt class="text-muted-foreground">Tags</dt>
								<dd class="flex flex-wrap gap-1.5">
									{#each entry.tags as t (t)}
										<button type="button" class="rounded-full bg-muted px-2 py-0.5 hover:bg-accent" title="Search for {t}" onclick={() => (query = t)}>{t}</button>
									{/each}
								</dd>
							{/if}
							{#if entry.files.length}
								<dt class="text-muted-foreground">Files</dt>
								<dd>
									<ul class="space-y-0.5">
										{#each entry.files as f (f)}
											<li>
												<button type="button" class="flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 -mx-1 text-left font-mono hover:bg-accent" title="Open {f} in Code" onclick={() => tile.openBeside({ view: 'code', path: f })}>
													<FileCodeIcon class="size-3 shrink-0 text-muted-foreground" /><span class="truncate">{f}</span>
												</button>
											</li>
										{/each}
									</ul>
								</dd>
							{/if}
							{#if entry.commits.length}
								<dt class="text-muted-foreground">Commits</dt>
								<dd>
									<ul class="space-y-0.5" aria-label="Commits">
										{#each entry.commits as sha, i (sha + i)}
											{@const c = facts?.find((f) => f.sha === sha)}
											<li>
												{#if !facts}
													<span class="flex items-center gap-1.5 font-mono text-muted-foreground"><GitCommitIcon class="size-3 shrink-0" />{sha.slice(0, 7)}</span>
												{:else if c?.full}
													<button
														type="button"
														class="-mx-1 flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent"
														title="Open the diff of {c.full.slice(0, 10)}"
														onclick={() => tile.openBeside({ view: 'changes', source: { base: c.parent ?? EMPTY_TREE, head: c.full!, title: c.subject ?? entry.title } })}
													>
														<GitCommitIcon class="size-3 shrink-0 text-muted-foreground" /><span class="shrink-0 font-mono text-primary">{sha.slice(0, 7)}</span><span class="truncate">{c.subject}</span>
													</button>
												{:else}
													<span class="flex items-center gap-1.5" data-missing>
														<GitCommitIcon class="size-3 shrink-0 text-muted-foreground" /><span class="font-mono text-muted-foreground line-through decoration-muted-foreground/50">{sha.slice(0, 7)}</span>
														<span class="text-muted-foreground">not in this repo (not fetched, or rewritten)</span>
													</span>
												{/if}
											</li>
										{/each}
									</ul>
								</dd>
							{/if}
							<dt class="text-muted-foreground">File</dt>
							<dd class="truncate font-mono text-muted-foreground" title={entry.path}>{entry.path}</dd>
						</dl>
					</div>
				</aside>
			{:else}
				<!-- a wide panel keeps the place of the entry, and says what goes there -->
				<div class="hidden w-[28rem] shrink-0 place-items-center border-s p-6 text-center text-sm text-muted-foreground @5xl/pane:grid @7xl/pane:w-[34rem]">
					<div>
						<NotebookTextIcon class="mx-auto size-5 opacity-60" />
						<p class="mt-2">Pick an entry to read what changed and why.</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
