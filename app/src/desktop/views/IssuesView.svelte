<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
	import FactoryIcon from '@lucide/svelte/icons/factory'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import MessageSquareIcon from '@lucide/svelte/icons/message-square'
	import PlusIcon from '@lucide/svelte/icons/plus'
	import UnplugIcon from '@lucide/svelte/icons/unplug'
	import type { Issue, IssueSummary, Page } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { factory } from '$lib/factory.svelte'
	import { ago } from '$lib/format'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import Avatar from '../components/Avatar.svelte'
	import CommentCard from '../components/CommentCard.svelte'
	import Composer from '../components/Composer.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import Labels from '../components/Labels.svelte'
	import ListToolbar from '../components/ListToolbar.svelte'
	import StateBadge from '../components/StateBadge.svelte'

	// Issues: the list on the left, the open one on the right. An issue can be handed to the factory as a ticket.
	let { now }: { now: number } = $props()
	const tile = getTile()

	const project = $derived(app.project!)
	const number = $derived(tile.route.number ?? null)
	const back = $derived(tile.route.from === 'board' ? 'Back to the board' : 'Back to the issues')

	let status = $state<'open' | 'closed'>('open')
	let search = $state('')
	let page = $state<Page<IssueSummary> | null>(null)
	let loading = $state(false)
	let listError = $state<string | null>(null)

	let issue = $state<Issue | null>(null)
	let issueError = $state<string | null>(null)
	let creating = $state(false)
	let newTitle = $state('')
	let createError = $state<string | null>(null)
	let stateBusy = $state(false)
	let filed = $state<{ number: number; id: string } | null>(null)
	let fileError = $state<string | null>(null)

	async function loadList(more = false) {
		const key = `${project}\n${status}\n${search}`
		loading = true
		listError = null
		try {
			const next = await api.issues(project, { state: status, search, after: more ? page?.next : null })
			if (key !== `${project}\n${status}\n${search}`) return
			page = more && page ? { ...next, items: [...page.items, ...next.items] } : next
			if (status === 'open' && !search.trim()) app.counts = { ...app.counts, issues: next.total }
		} catch (e) {
			listError = message(e)
		} finally {
			loading = false
		}
	}

	async function loadIssue(n: number) {
		try {
			const next = await api.issue(project, n)
			if (n !== number) return
			issue = next
			issueError = null
		} catch (e) {
			if (n === number) issueError = message(e)
		}
	}

	$effect(() => {
		void [project, status, search]
		if (!app.info?.github) return
		page = null
		void loadList()
	})
	$effect(() => {
		issue = null
		issueError = null
		fileError = null
		if (number && app.info?.github) void loadIssue(number)
	})
	$effect(() =>
		app.onFocus(() => {
			if (!app.info?.github) return
			void loadList()
			if (number) void loadIssue(number)
		})
	)

	function open(n: number) {
		creating = false
		tile.go({ view: 'issues', number: n })
	}

	async function create(body: string) {
		const title = newTitle.trim()
		if (!title) throw new Error('Give the issue a title.')
		const n = await api.issueCreate(project, title, body)
		newTitle = ''
		creating = false
		status = 'open'
		await loadList()
		open(n)
	}

	async function setState(next: 'open' | 'closed', comment: string) {
		if (!issue) return
		stateBusy = true
		try {
			if (comment) await api.issueComment(project, issue.number, comment)
			await api.issueSetState(project, issue.number, next)
			await Promise.all([loadIssue(issue.number), loadList()])
		} finally {
			stateBusy = false
		}
	}

	// the issue as a factory ticket: its title, its text, and where it came from
	async function sendToFactory() {
		if (!issue) return
		fileError = null
		try {
			const id = await api.factoryCreate(project, issue.title, `${issue.body.trim()}\n\nFrom GitHub issue #${issue.number}: ${issue.url}\n`)
			filed = { number: issue.number, id }
			void factory.refresh()
		} catch (e) {
			fileError = message(e)
		}
	}
</script>

{#if !app.info?.github}
	<EmptyState icon={UnplugIcon} title="GitHub is not connected">
		<p>{app.info?.githubError ?? 'Looking for the GitHub repo…'}</p>
		<p>The app uses the GitHub CLI's login, so there is no token to paste here.</p>
	</EmptyState>
{:else}
	<div class="flex min-h-0 flex-1">
		<!-- under Activity's strip, which has the list already, an open issue has the room to itself -->
		<div class={cn('w-full shrink-0 flex-col', !tile.route.from && '@4xl/pane:flex @4xl/pane:w-[26rem] @4xl/pane:border-e', number || creating ? 'hidden' : 'flex')}>
			<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
				<CircleDotIcon class="size-4 text-muted-foreground" />
				<h1 class="text-[0.9375rem] font-semibold tracking-tight">Issues</h1>
				<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{app.info.github.owner}/{app.info.github.repo}</span>
				<Button size="sm" onclick={() => ((creating = true), tile.go({ view: 'issues' }))}><PlusIcon />New issue</Button>
			</header>
			<ListToolbar bind:status bind:search placeholder="Search issues" {loading} onrefresh={() => loadList()} />
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if listError}
					<p class="p-4 text-sm text-destructive">{listError}</p>
				{:else if !page}
					<p class="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
				{:else if page.items.length === 0}
					<p class="p-4 text-sm text-muted-foreground">No {status} issues{search.trim() ? ' match' : ''}.</p>
				{:else}
					<ul class="divide-y">
						{#each page.items as it (it.number)}
							<li>
								<button
									type="button"
									class={cn('flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none', it.number === number && 'bg-accent/60')}
									aria-current={it.number === number ? 'true' : undefined}
									onclick={() => open(it.number)}
								>
									<StateBadge kind="issue" state={it.state} class="mt-0.5" />
									<span class="min-w-0 flex-1">
										<span class="line-clamp-2 text-sm leading-snug font-medium">{it.title}</span>
										{#if it.labels.length}<span class="mt-1.5 flex flex-wrap gap-1"><Labels labels={it.labels} /></span>{/if}
										<span class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
											<span class="font-mono tabular-nums">#{it.number}</span>
											<span class="truncate">{it.author.login}</span>
											<span class="shrink-0">{ago(it.updatedAt, now)}</span>
											{#if it.comments}<span class="ms-auto inline-flex shrink-0 items-center gap-1 tabular-nums"><MessageSquareIcon class="size-3.5" />{it.comments}</span>{/if}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
					{#if page.next}
						<div class="p-3 text-center">
							<Button variant="outline" size="sm" disabled={loading} onclick={() => loadList(true)}>Load more ({page.total - page.items.length} left)</Button>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<div class={cn('min-w-0 flex-1 flex-col @4xl/pane:flex', number || creating ? 'flex' : 'hidden')}>
			{#if creating}
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="mx-auto max-w-3xl space-y-3 p-6">
						<h2 class="text-lg font-semibold tracking-tight">New issue</h2>
						<!-- svelte-ignore a11y_autofocus -- the form was just asked for -->
						<input
							bind:value={newTitle}
							autofocus
							placeholder="Title"
							aria-label="Title"
							class="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
						/>
						<Composer placeholder="Describe it (optional)" submitLabel="Create issue" rows={8} allowEmpty oncancel={() => (creating = false)} onsubmit={create} />
						{#if createError}<p class="text-xs text-destructive">{createError}</p>{/if}
					</div>
				</div>
			{:else if !number}
				<div class="forge-glow grid flex-1 place-items-center p-6 text-sm text-muted-foreground">Pick an issue to read it.</div>
			{:else if issueError && !issue}
				<p class="p-6 text-sm text-destructive">{issueError}</p>
			{:else if !issue}
				<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
			{:else}
				<header class="shrink-0 border-b px-6 py-4">
					<!-- in a narrow panel the buttons drop under the title instead of squeezing it -->
					<div class="flex flex-wrap items-start justify-end gap-x-3 gap-y-2">
						<!-- in Activity the way back (to the board) is always there. Else only where the list is not beside it. -->
						<Button
							variant="ghost"
							size="icon-sm"
							class={cn('-ms-2 shrink-0', !tile.route.from && '@4xl/pane:hidden')}
							onclick={() => tile.go({ view: tile.route.from ?? 'issues' })}
							aria-label={back}
							title={back}
						>
							<ArrowLeftIcon />
						</Button>
						<h2 class="min-w-56 flex-1 text-lg leading-snug font-semibold tracking-tight">
							<span class="[overflow-wrap:anywhere]">{issue.title}</span>
							<span class="ms-1 font-mono font-normal text-muted-foreground tabular-nums">#{issue.number}</span>
						</h2>
						<div class="flex shrink-0 items-center gap-1.5">
							{#if app.info.hasFactory}
								{#if filed?.number === issue.number}
									<Button variant="outline" size="sm" onclick={() => tile.go({ view: 'board', path: filed!.id })}><FactoryIcon />Filed as {filed.id.split('-')[0]}, open the board</Button>
								{:else}
									<Button variant="outline" size="sm" onclick={sendToFactory}><FactoryIcon />Send to factory</Button>
								{/if}
							{/if}
							<Button variant="ghost" size="icon-sm" onclick={() => api.openExternal(issue!.url)} aria-label="Open on GitHub"><ExternalLinkIcon /></Button>
						</div>
					</div>
					<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<StateBadge kind="issue" state={issue.state} reason={issue.stateReason} pill />
						<span class="inline-flex items-center gap-1"><Avatar actor={issue.author} class="size-4" /><span class="font-medium text-foreground">{issue.author.login}</span></span>
						<span>opened {ago(issue.createdAt, now)}</span>
						<span>· {issue.thread.length} {issue.thread.length === 1 ? 'comment' : 'comments'}</span>
						<Labels labels={issue.labels} />
					</p>
					{#if fileError}<p class="mt-2 text-xs text-destructive">Could not file the ticket: {fileError}</p>{/if}
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="mx-auto max-w-3xl space-y-4 p-6">
						<CommentCard author={issue.author} at={issue.createdAt} body={issue.body} {now} />
						{#each issue.thread as c (c.id)}
							<CommentCard author={c.author} at={c.createdAt} body={c.body} {now} />
						{/each}
						<Composer
							placeholder="Leave a comment"
							onsubmit={async (text) => {
								await api.issueComment(project, issue!.number, text)
								await Promise.all([loadIssue(issue!.number), loadList()])
							}}
						>
							{#snippet extra({ busy, text })}
								<Button variant="outline" size="xs" disabled={busy || stateBusy} onclick={() => setState(issue!.state === 'OPEN' ? 'closed' : 'open', text)}>
									{#if stateBusy}<LoaderIcon class="animate-spin" />{/if}
									{issue!.state === 'OPEN' ? (text ? 'Close with comment' : 'Close issue') : 'Reopen'}
								</Button>
							{/snippet}
						</Composer>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
