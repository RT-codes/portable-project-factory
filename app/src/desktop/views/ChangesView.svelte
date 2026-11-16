<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import { EMPTY_TREE, WORKTREE, type Branch, type Compare } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { factory } from '$lib/factory.svelte'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import DiffView from '../components/DiffView.svelte'
	import EmptyState from '../components/EmptyState.svelte'

	// What changed, before there is a pull request: the uncommitted work in the checkout, or a branch against
	// the base branch (a factory ticket's branch, say).
	let { now }: { now: number } = $props()
	const tile = getTile()

	const project = $derived(app.project!)
	const source = $derived(tile.route.source ?? { base: 'HEAD', head: WORKTREE })
	const worktree = $derived(source.head === WORKTREE)

	let compare = $state<Compare | null>(null)
	let error = $state<string | null>(null)
	let loading = $state(false)
	let branches = $state<Branch[]>([])

	const baseBranch = $derived.by(() => {
		const names = new Set(branches.map((b) => b.name))
		return [factory.state?.config.base_branch, app.info?.github?.defaultBranch, 'main', 'master'].find((n) => n && names.has(n)) ?? null
	})

	async function load(quiet = false) {
		const key = `${project}\n${source.base}\n${source.head}`
		if (!quiet) compare = null
		loading = true
		error = null
		try {
			const [c, b] = await Promise.all([api.compare(project, source.base, source.head), api.branches(project)])
			if (key !== `${project}\n${source.base}\n${source.head}`) return
			compare = c
			branches = b
			if (worktree) app.counts = { ...app.counts, changes: c.files.length }
		} catch (e) {
			error = message(e)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		void [project, source.base, source.head]
		void load()
	})
	// coming back to the window: the checkout has probably changed
	$effect(() => app.onFocus(() => worktree && void load(true)))

	/** A revision as a person reads it: a commit by its short hash, the empty tree as what it is. */
	const short = (r: string) => (r === EMPTY_TREE ? 'nothing (the first commit)' : /^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r)

	function pick(value: string) {
		if (value === WORKTREE) tile.go({ view: 'changes' })
		else tile.go({ view: 'changes', source: { base: baseBranch ?? 'HEAD', head: value } })
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<GitCompareIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">{worktree ? 'Uncommitted changes' : (source.title ?? short(source.head))}</h1>
			<p class="truncate text-xs text-muted-foreground">
				{#if worktree}
					The checkout against its last commit{app.info?.branch ? ` on ${app.info.branch}` : ''}
				{:else}
					<span class="font-mono">{short(source.head)}</span> against <span class="font-mono">{short(source.base)}</span>{compare ? ` · ${compare.commits.length} ${compare.commits.length === 1 ? 'commit' : 'commits'}` : ''}
				{/if}
			</p>
		</div>
		<div class="ms-auto flex items-center gap-2">
			<label class="flex h-8 items-center gap-1.5 rounded-md border bg-background ps-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
				<GitBranchIcon class="size-3.5 text-muted-foreground" />
				<span class="sr-only">Compare</span>
				<select class="h-full max-w-56 cursor-pointer truncate bg-transparent pe-2 font-mono outline-none" value={source.head} onchange={(e) => pick(e.currentTarget.value)}>
					<option value={WORKTREE}>uncommitted changes</option>
					{#each branches.filter((b) => b.name !== baseBranch) as b (b.name)}
						<option value={b.name}>{b.name}</option>
					{/each}
					{#if !worktree && !branches.some((b) => b.name === source.head)}
						<option value={source.head}>{short(source.head)}</option>
					{/if}
				</select>
			</label>
			<Button variant="ghost" size="icon-sm" onclick={() => load(true)} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
		</div>
	</header>

	{#if error}
		<EmptyState icon={TriangleAlertIcon} title="Can't read the changes">
			<p class="font-mono text-xs text-destructive/90">{error}</p>
		</EmptyState>
	{:else if !compare}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Reading the diff…</p>
	{:else if compare.files.length === 0}
		<EmptyState icon={CircleCheckIcon} title={worktree ? 'Nothing uncommitted' : 'No differences'} glow>
			<p>
				{#if worktree}
					The checkout matches its last commit. Changes an agent makes here show up when you come back to this window.
				{:else}
					<span class="font-mono">{source.head}</span> has nothing that <span class="font-mono">{source.base}</span> lacks.
				{/if}
			</p>
		</EmptyState>
	{:else}
		<DiffView {project} {compare} graph scope={worktree ? 'worktree' : `branch:${source.head}`} {now} onopen={(path) => tile.go({ view: 'code', path, rev: compare!.head })} />
	{/if}
</div>
