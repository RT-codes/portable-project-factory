<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
	import GitCommitIcon from '@lucide/svelte/icons/git-commit-horizontal'
	import GitMergeIcon from '@lucide/svelte/icons/git-merge'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import type { Compare, DraftComment, MergeMethod, Pull, ReviewInput } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { ago } from '$lib/format'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import Avatar from '../components/Avatar.svelte'
	import CheckIcon from '../components/CheckIcon.svelte'
	import CommentCard from '../components/CommentCard.svelte'
	import Composer from '../components/Composer.svelte'
	import DiffView from '../components/DiffView.svelte'
	import Labels from '../components/Labels.svelte'
	import Markdown from '../components/Markdown.svelte'
	import StateBadge from '../components/StateBadge.svelte'
	import ThreadView from '../components/ThreadView.svelte'
	import type { ReviewHooks } from '../lib/review'

	// One pull request: the conversation, and the changes with a review in progress. Comments written on the diff
	// are kept as drafts (they survive closing the app) until the review is submitted.
	let { number, now, onchanged }: { number: number; now: number; onchanged: () => void } = $props()
	const tile = getTile()
	const back = $derived(tile.route.from === 'board' ? 'Back to the board' : 'Back to pull requests')

	const project = $derived(app.project!)
	const github = $derived(app.info!.github!)

	let pr = $state<Pull | null>(null)
	let compare = $state<Compare | null>(null)
	let error = $state<string | null>(null)
	let compareError = $state<string | null>(null)
	let refreshing = $state(false)
	let tab = $state<'conversation' | 'changes'>('conversation')

	// svelte-ignore state_referenced_locally -- this component lives for one pull request (the list keys it)
	const draftKey = `factory-drafts:${app.project}:${number}`
	let drafts = $state<DraftComment[]>(
		(() => {
			try {
				return JSON.parse(localStorage.getItem(draftKey) ?? '[]')
			} catch {
				return []
			}
		})()
	)
	$effect(() => {
		try {
			if (drafts.length) localStorage.setItem(draftKey, JSON.stringify(drafts))
			else localStorage.removeItem(draftKey)
		} catch {
			/* drafts then last for this visit */
		}
	})

	async function load() {
		refreshing = true
		try {
			const next = await api.pull(project, number)
			const moved = pr && pr.headSha !== next.headSha
			pr = next
			error = null
			if (!compare || moved) void loadCompare()
		} catch (e) {
			error = message(e)
		} finally {
			refreshing = false
		}
	}

	async function loadCompare() {
		compareError = null
		try {
			compare = await api.pullCompare(project, number)
		} catch (e) {
			compareError = message(e)
		}
	}

	$effect(() => {
		void load()
	})
	$effect(() => app.onFocus(() => void load()))

	const hooks = $derived<ReviewHooks | null>(
		pr && {
			threads: pr.threads,
			drafts,
			addDraft: (d) => (drafts = [...drafts, d]),
			updateDraft: (d, body) => (drafts = drafts.map((x) => (x === d ? { ...x, body } : x))),
			removeDraft: (d) => (drafts = drafts.filter((x) => x !== d)),
			reply: async (thread, body) => {
				await api.pullReply(project, number, thread.comments[0].id, body)
				await load()
			},
			resolve: async (thread, resolved) => {
				await api.pullResolve(project, thread.id, resolved)
				await load()
			},
		}
	)

	// ---- the review being written
	let reviewOpen = $state(false)
	let reviewBody = $state('')
	let reviewEvent = $state<ReviewInput['event']>('COMMENT')
	const own = $derived(pr?.author.login === github.viewer)
	const events = $derived<{ value: ReviewInput['event']; label: string; hint: string }[]>([
		{ value: 'COMMENT', label: 'Comment', hint: 'Feedback without a verdict' },
		...(own
			? []
			: ([
					{ value: 'APPROVE', label: 'Approve', hint: 'Good to merge' },
					{ value: 'REQUEST_CHANGES', label: 'Request changes', hint: 'Must be addressed first' },
				] as const)),
	])

	async function submitReview(body: string) {
		if (!pr) return
		if (reviewEvent !== 'APPROVE' && !body && drafts.length === 0) throw new Error('Write a comment first.')
		await api.pullReview(project, number, { event: reviewEvent, body, comments: drafts, commitId: pr.headSha })
		drafts = []
		reviewOpen = false
		reviewEvent = 'COMMENT'
		await load()
		onchanged()
	}

	// ---- merging
	let method = $state<MergeMethod | null>(null)
	let confirming = $state(false)
	let merging = $state(false)
	let mergeError = $state<string | null>(null)
	const methodLabel = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' } as const
	const chosen = $derived(method ?? pr?.mergeMethods[0] ?? null)
	const blocker = $derived.by(() => {
		if (!pr || pr.state !== 'OPEN') return null
		if (pr.draft) return 'This pull request is still a draft.'
		if (pr.mergeable === 'CONFLICTING') return 'It has conflicts with the base branch.'
		if (pr.mergeState === 'BLOCKED') return 'Branch protection blocks it: a required review or check is missing.'
		if (pr.mergeState === 'BEHIND') return 'The branch is behind its base and must be updated first.'
		return null
	})

	async function merge() {
		if (!pr || !chosen) return
		merging = true
		mergeError = null
		try {
			await api.pullMerge(project, number, chosen, pr.headSha)
			confirming = false
			await load()
			onchanged()
		} catch (e) {
			mergeError = message(e)
		} finally {
			merging = false
		}
	}

	const timeline = $derived(
		pr
			? [
					...pr.thread.map((c) => ({ at: c.createdAt, author: c.author, body: c.body, state: null as string | null, key: `c${c.id}` })),
					...pr.reviews.map((r, i) => ({ at: r.submittedAt, author: r.author, body: r.body, state: r.state as string | null, key: `r${i}` })),
				].sort((a, b) => a.at.localeCompare(b.at))
			: []
	)
	const reviewWord: Record<string, { label: string; tone: string }> = {
		APPROVED: { label: 'approved', tone: 'bg-tone-green/15 text-tone-green' },
		CHANGES_REQUESTED: { label: 'requested changes', tone: 'bg-tone-rose/15 text-tone-rose' },
		COMMENTED: { label: 'reviewed', tone: 'bg-muted text-muted-foreground' },
		DISMISSED: { label: 'review dismissed', tone: 'bg-muted text-muted-foreground' },
	}
	const openThreads = $derived(pr?.threads.filter((t) => !t.resolved) ?? [])
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="shrink-0 border-b px-4 pt-3">
		<div class="flex items-start gap-3">
			<Button variant="ghost" size="icon-sm" class="-ms-1 shrink-0" onclick={() => tile.go({ view: tile.route.from ?? 'pulls' })} aria-label={back} title={back}><ArrowLeftIcon /></Button>
			<div class="min-w-0 flex-1">
				<h1 class="text-[0.9375rem] leading-8 font-semibold tracking-tight">
					<span class="[overflow-wrap:anywhere]">{pr?.title ?? 'Pull request'}</span>
					<span class="ms-1 font-mono font-normal text-muted-foreground tabular-nums">#{number}</span>
				</h1>
				{#if pr}
					<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<StateBadge kind="pull" state={pr.state} draft={pr.draft} pill />
						<span class="inline-flex items-center gap-1"><Avatar actor={pr.author} class="size-4" /><span class="font-medium text-foreground">{pr.author.login}</span></span>
						<span>wants to merge</span>
						<span class="rounded bg-muted px-1.5 py-0.5 font-mono">{pr.headRef}</span>
						<span>into</span>
						<span class="rounded bg-muted px-1.5 py-0.5 font-mono">{pr.baseRef}</span>
						{#if pr.checks}<span class="inline-flex items-center gap-1"><CheckIcon state={pr.checks} />checks</span>{/if}
						<Labels labels={pr.labels} />
					</p>
				{/if}
			</div>
			<div class="relative flex shrink-0 items-center gap-1.5">
				<Button variant="ghost" size="icon-sm" onclick={load} aria-label="Refresh"><RefreshCwIcon class={cn(refreshing && 'animate-spin')} /></Button>
				{#if pr}
					<Button variant="ghost" size="icon-sm" onclick={() => api.openExternal(pr!.url)} aria-label="Open on GitHub"><ExternalLinkIcon /></Button>
					{#if pr.state === 'OPEN'}
						<Button size="sm" onclick={() => (reviewOpen = !reviewOpen)} aria-expanded={reviewOpen}>
							Submit review
							{#if drafts.length}<span class="rounded-full bg-primary-foreground/20 px-1.5 text-[0.6875rem] tabular-nums">{drafts.length}</span>{/if}
						</Button>
					{/if}
				{/if}
				{#if reviewOpen && pr}
					<div class="absolute end-0 top-10 z-30 w-[26rem] rounded-xl border bg-popover p-3 shadow-float" role="dialog" aria-label="Submit review">
						<p class="mb-2 text-sm font-medium">Finish your review</p>
						<div class="mb-2 space-y-1">
							{#each events as ev (ev.value)}
								<label class={cn('flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm', reviewEvent === ev.value ? 'border-primary/50 bg-primary/10' : 'hover:bg-accent/50')}>
									<input type="radio" name="review-event" class="accent-primary" value={ev.value} bind:group={reviewEvent} />
									<span class="font-medium">{ev.label}</span>
									<span class="text-xs text-muted-foreground">{ev.hint}</span>
								</label>
							{/each}
						</div>
						<Composer
							bind:value={reviewBody}
							placeholder="Summary (optional with inline comments)"
							submitLabel={drafts.length ? `Submit with ${drafts.length} ${drafts.length === 1 ? 'comment' : 'comments'}` : 'Submit review'}
							allowEmpty
							oncancel={() => (reviewOpen = false)}
							onsubmit={submitReview}
						/>
						{#if own}<p class="mt-2 text-xs text-muted-foreground">This is your own pull request, so you can comment but not approve it.</p>{/if}
					</div>
				{/if}
			</div>
		</div>
		<nav class="mt-2 -mb-px flex gap-1" aria-label="Pull request">
			{#each [{ id: 'conversation', label: 'Conversation', n: pr ? pr.thread.length + pr.reviews.length : null }, { id: 'changes', label: 'Changes', n: pr?.changedFiles ?? null }] as const as t (t.id)}
				<button
					type="button"
					class={cn('flex h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground', tab === t.id && 'border-primary text-foreground')}
					aria-current={tab === t.id ? 'page' : undefined}
					onclick={() => (tab = t.id)}
				>
					{t.label}
					{#if t.n !== null}<span class="rounded-full bg-muted px-1.5 text-[0.6875rem] text-muted-foreground tabular-nums">{t.n}</span>{/if}
				</button>
			{/each}
		</nav>
	</header>

	{#if error && !pr}
		<p class="p-6 text-sm text-destructive">{error}</p>
	{:else if !pr}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
	{:else if tab === 'conversation'}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="mx-auto grid max-w-6xl gap-6 p-5 @4xl/pane:grid-cols-[minmax(0,1fr)_19rem]">
				<div class="min-w-0 space-y-4">
					<CommentCard author={pr.author} at={pr.createdAt} body={pr.body} {now} />
					{#each timeline as item (item.key)}
						<CommentCard author={item.author} at={item.at} body={item.body} {now}>
							{#snippet badge()}
								{#if item.state && reviewWord[item.state]}
									<span class={cn('rounded-full px-2 py-0.5 text-[0.6875rem] font-medium', reviewWord[item.state].tone)}>{reviewWord[item.state].label}</span>
								{/if}
							{/snippet}
						</CommentCard>
					{/each}
					{#if openThreads.length > 0 && hooks}
						<section class="space-y-2" aria-label="Open review threads">
							<h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Open review threads</h2>
							{#each openThreads as t (t.id)}
								<ThreadView thread={t} {hooks} {now} label={`${t.path}${t.line ? `:${t.line}` : ''}${t.outdated ? ' · outdated' : ''}`} />
							{/each}
						</section>
					{/if}
					<Composer
						placeholder="Add a comment to the conversation"
						onsubmit={async (text) => {
							await api.issueComment(project, number, text)
							await load()
						}}
					/>
				</div>

				<aside class="space-y-4 text-sm">
					<section class={cn('rounded-xl border bg-card p-4', pr.state === 'OPEN' && !blocker && 'glow-card')}>
						<h2 class="flex items-center gap-2 font-medium"><GitMergeIcon class="size-4 text-muted-foreground" />Merge</h2>
						{#if pr.state === 'MERGED'}
							<p class="mt-2 text-xs text-muted-foreground">Merged into <span class="font-mono">{pr.baseRef}</span>.</p>
						{:else if pr.state === 'CLOSED'}
							<p class="mt-2 text-xs text-muted-foreground">Closed without merging.</p>
						{:else if !github.canWrite}
							<p class="mt-2 text-xs text-muted-foreground">You don't have write access to this repo.</p>
						{:else}
							{#if blocker}
								<p class="mt-2 text-xs text-tone-amber">{blocker}</p>
							{:else}
								<p class="mt-2 text-xs text-muted-foreground">{pr.mergeable === 'UNKNOWN' ? 'GitHub is still working out whether it merges cleanly.' : 'No conflicts with the base branch.'}</p>
							{/if}
							{#if pr.mergeMethods.length > 1}
								<select
									class="mt-3 h-8 w-full cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
									aria-label="Merge method"
									value={chosen}
									onchange={(e) => ((method = e.currentTarget.value as MergeMethod), (confirming = false))}
								>
									{#each pr.mergeMethods as m (m)}<option value={m}>{methodLabel[m]}</option>{/each}
								</select>
							{/if}
							{#if confirming}
								<div class="mt-3 flex gap-2">
									<Button size="sm" class="flex-1" disabled={merging} onclick={merge}>
										{#if merging}<LoaderIcon class="animate-spin" />{/if}Confirm merge
									</Button>
									<Button size="sm" variant="ghost" disabled={merging} onclick={() => (confirming = false)}>Cancel</Button>
								</div>
							{:else}
								<Button size="sm" class="mt-3 w-full" variant={blocker ? 'outline' : 'default'} disabled={!chosen || pr.draft || pr.mergeable === 'CONFLICTING'} onclick={() => (confirming = true)}>
									{chosen ? methodLabel[chosen] : 'Merging is disabled for this repo'}
								</Button>
							{/if}
							{#if mergeError}<p class="mt-2 text-xs text-destructive">{mergeError}</p>{/if}
						{/if}
					</section>

					{#if pr.checkList.length > 0}
						<section class="rounded-xl border bg-card p-4">
							<h2 class="font-medium">Checks</h2>
							<ul class="mt-2 space-y-1.5">
								{#each pr.checkList as c (c.name)}
									<li class="flex items-center gap-2 text-xs">
										<CheckIcon state={c.state} />
										{#if c.url}
											<button type="button" class="min-w-0 truncate text-left hover:underline" onclick={() => api.openExternal(c.url!)}>{c.name}</button>
										{:else}
											<span class="min-w-0 truncate">{c.name}</span>
										{/if}
									</li>
								{/each}
							</ul>
						</section>
					{/if}

					<section class="rounded-xl border bg-card p-4">
						<h2 class="font-medium">Commits</h2>
						{#if compare}
							<ul class="mt-2 space-y-2">
								{#each compare.commits as c (c.sha)}
									<li class="flex gap-2 text-xs">
										<GitCommitIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
										<span class="min-w-0">
											<span class="line-clamp-2 [overflow-wrap:anywhere]">{c.subject}</span>
											<span class="text-muted-foreground"><span class="font-mono">{c.sha.slice(0, 7)}</span> · {c.author} · {ago(c.date, now)}</span>
										</span>
									</li>
								{/each}
							</ul>
						{:else if compareError}
							<p class="mt-2 text-xs text-destructive">{compareError}</p>
						{:else}
							<p class="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><LoaderIcon class="size-3.5 animate-spin" />Fetching…</p>
						{/if}
					</section>
				</aside>
			</div>
		</div>
	{:else if compareError}
		<div class="p-6">
			<p class="text-sm text-destructive">{compareError}</p>
			<Button class="mt-3" variant="outline" size="sm" onclick={loadCompare}>Try again</Button>
		</div>
	{:else if !compare}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Fetching the pull request's commits…</p>
	{:else if compare.files.length === 0}
		<p class="p-6 text-sm text-muted-foreground">This pull request changes no files.</p>
	{:else}
		<DiffView {project} {compare} {hooks} scope={`pull:${number}`} {now} onopen={(path) => tile.go({ view: 'code', path, rev: compare!.head })} />
	{/if}
</div>
