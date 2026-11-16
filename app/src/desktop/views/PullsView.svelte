<script lang="ts">
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import MessageSquareIcon from '@lucide/svelte/icons/message-square'
	import UnplugIcon from '@lucide/svelte/icons/unplug'
	import type { Page, PullSummary } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { ago } from '$lib/format'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import Avatar from '../components/Avatar.svelte'
	import CheckIcon from '../components/CheckIcon.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import Labels from '../components/Labels.svelte'
	import ListToolbar from '../components/ListToolbar.svelte'
	import StateBadge from '../components/StateBadge.svelte'
	import PullDetail from './PullDetail.svelte'

	let { now }: { now: number } = $props()
	const tile = getTile()

	const project = $derived(app.project!)
	let status = $state<'open' | 'closed'>('open')
	let search = $state('')
	let page = $state<Page<PullSummary> | null>(null)
	let loading = $state(false)
	let error = $state<string | null>(null)

	async function load(more = false) {
		const key = `${project}\n${status}\n${search}`
		loading = true
		error = null
		try {
			const next = await api.pulls(project, { state: status, search, after: more ? page?.next : null })
			if (key !== `${project}\n${status}\n${search}`) return
			page = more && page ? { ...next, items: [...page.items, ...next.items] } : next
			if (status === 'open' && !search.trim()) app.counts = { ...app.counts, pulls: next.total }
		} catch (e) {
			error = message(e)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		void [project, status, search]
		if (!app.info?.github) return
		page = null
		void load()
	})
	$effect(() => app.onFocus(() => app.info?.github && !tile.route.number && void load()))

	const decision: Record<string, { label: string; tone: string }> = {
		APPROVED: { label: 'Approved', tone: 'text-tone-green' },
		CHANGES_REQUESTED: { label: 'Changes requested', tone: 'text-tone-rose' },
		REVIEW_REQUIRED: { label: 'Review required', tone: 'text-tone-amber' },
	}
</script>

{#if !app.info?.github}
	<EmptyState icon={UnplugIcon} title="GitHub is not connected">
		<p>{app.info?.githubError ?? 'Looking for the GitHub repo…'}</p>
		<p>The app uses the GitHub CLI's login, so there is no token to paste here.</p>
	</EmptyState>
{:else if tile.route.number}
	{#key tile.route.number}
		<PullDetail number={tile.route.number} {now} onchanged={() => load()} />
	{/key}
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
			<GitPullRequestIcon class="size-4 text-muted-foreground" />
			<h1 class="text-[0.9375rem] font-semibold tracking-tight">Pull requests</h1>
			<span class="truncate font-mono text-xs text-muted-foreground">{app.info.github.owner}/{app.info.github.repo}</span>
		</header>
		<ListToolbar bind:status bind:search placeholder="Search pull requests" {loading} onrefresh={() => load()} />
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if error}
				<p class="p-6 text-sm text-destructive">{error}</p>
			{:else if !page}
				<p class="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
			{:else if page.items.length === 0}
				<p class="p-6 text-sm text-muted-foreground">No {status} pull requests{search.trim() ? ' match' : ''}.</p>
			{:else}
				<ul class="divide-y">
					{#each page.items as pr (pr.number)}
						{@const d = pr.reviewDecision ? decision[pr.reviewDecision] : null}
						<li>
							<button type="button" class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none" onclick={() => tile.go({ view: 'pulls', number: pr.number })}>
								<StateBadge kind="pull" state={pr.state} draft={pr.draft} class="mt-0.5" />
								<span class="min-w-0 flex-1">
									<span class="flex flex-wrap items-center gap-x-2 gap-y-1">
										<span class="text-sm leading-snug font-medium">{pr.title}</span>
										<Labels labels={pr.labels} />
									</span>
									<span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
										<span class="font-mono tabular-nums">#{pr.number}</span>
										<span class="inline-flex items-center gap-1"><Avatar actor={pr.author} class="size-4" />{pr.author.login}</span>
										<span>updated {ago(pr.updatedAt, now)}</span>
										<span class="truncate font-mono">{pr.headRef} → {pr.baseRef}</span>
									</span>
								</span>
								<span class="hidden shrink-0 items-center gap-3 pt-0.5 text-xs text-muted-foreground @2xl/pane:flex">
									{#if d}<span class={d.tone}>{d.label}</span>{/if}
									{#if pr.checks}<CheckIcon state={pr.checks} />{/if}
									<span class="w-20 text-right font-mono tabular-nums"><span class="text-tone-green">+{pr.additions}</span> <span class="text-tone-rose">-{pr.deletions}</span></span>
									<span class="inline-flex w-9 items-center gap-1 tabular-nums"><MessageSquareIcon class="size-3.5" />{pr.comments}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if page.next}
					<div class="p-3 text-center">
						<Button variant="outline" size="sm" disabled={loading} onclick={() => load(true)}>Load more ({page.total - page.items.length} left)</Button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
