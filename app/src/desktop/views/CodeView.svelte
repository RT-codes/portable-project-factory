<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
	import EyeIcon from '@lucide/svelte/icons/eye'
	import CodeIcon from '@lucide/svelte/icons/code'
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import SearchIcon from '@lucide/svelte/icons/search'
	import XIcon from '@lucide/svelte/icons/x'
	import { SvelteSet } from 'svelte/reactivity'
	import { WORKTREE, type FileContent, type TreeFile } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { bytes } from '$lib/format'
	import { renderMarkdown } from '$lib/markdown'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import { appearance } from '../appearance.svelte'
	import FileTree from '../components/FileTree.svelte'
	import { lineHtml, tokenize, type Tok } from '../lib/highlight'
	import { buildTree, dirname } from '../lib/tree'

	const tile = getTile()
	// The project's files: the tree of the checkout (or of a commit, when a diff sent us here) and one file,
	// highlighted. Markdown can be read rendered.
	const project = $derived(app.project!)
	const rev = $derived(tile.route.rev ?? WORKTREE)
	const path = $derived(tile.route.path ?? null)

	let files = $state<TreeFile[] | null>(null)
	let treeError = $state<string | null>(null)
	let filter = $state('')
	/** folders opened in the tree, and folders closed in a search's results (which start open) */
	const opened = new SvelteSet<string>()
	const closed = new SvelteSet<string>()

	let content = $state<FileContent | null>(null)
	let fileError = $state<string | null>(null)
	let toks = $state<Tok[][] | null>(null)
	let preview = $state(true)

	async function loadTree() {
		const key = `${project}\n${rev}`
		try {
			const next = await api.tree(project, rev)
			if (key === `${project}\n${rev}`) files = next
			treeError = null
		} catch (e) {
			treeError = message(e)
		}
	}
	$effect(() => {
		void [project, rev]
		files = null
		void loadTree()
	})
	$effect(() => app.onFocus(() => rev === WORKTREE && void loadTree()))

	$effect(() => {
		content = null
		toks = null
		fileError = null
		if (!path) return
		let current = true
		const p = path
		const syntax = appearance.current.syntax
		// the folders down to the open file are open
		for (let d = dirname(p); d; d = dirname(d)) opened.add(d)
		api.file(project, rev, p).then(
			async (c) => {
				if (!current) return
				content = c
				if (c.text !== null) {
					const t = await tokenize(`${rev}:${p}:${c.size}`, p, c.text, syntax)
					if (current) toks = t
				}
			},
			(e) => current && (fileError = message(e))
		)
		return () => (current = false)
	})

	const query = $derived(filter.trim().toLowerCase())
	const matches = $derived(query && files ? files.filter((f) => f.path.toLowerCase().includes(query)).slice(0, 300) : null)
	const tree = $derived(files ? buildTree(matches ?? files) : [])
	const lines = $derived(content?.text?.replace(/\n$/, '').split('\n') ?? [])
	const isMarkdown = $derived(!!path && /\.(md|markdown)$/i.test(path))
	const mark = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U' } as const
	const markTone = { modified: 'text-tone-amber', added: 'text-tone-green', deleted: 'text-tone-rose', untracked: 'text-tone-green' } as const

	const pick = (f: TreeFile) => tile.go({ view: 'code', path: f.path, rev: tile.route.rev })
</script>

<div class="flex min-h-0 flex-1">
	<aside class={cn('w-full shrink-0 flex-col @3xl/pane:flex @3xl/pane:w-64 @3xl/pane:border-e @6xl/pane:w-72', path ? 'hidden' : 'flex')} aria-label="Files">
		<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
			<FolderTreeIcon class="size-4 text-muted-foreground" />
			<h1 class="text-[0.9375rem] font-semibold tracking-tight">Code</h1>
			{#if rev !== WORKTREE}
				<span class="ms-auto inline-flex h-6 items-center gap-1 rounded-full border ps-2 pe-0.5 font-mono text-[0.6875rem] text-muted-foreground" title="Showing the files of this commit">
					at {rev.slice(0, 7)}
					<Button variant="ghost" size="icon-xs" class="size-5 rounded-full" onclick={() => tile.go({ view: 'code', path: path ?? undefined })} aria-label="Back to the checkout"><XIcon /></Button>
				</span>
			{:else if files}
				<span class="ms-auto text-xs text-muted-foreground tabular-nums">{files.length} files</span>
			{/if}
		</header>
		<div class="p-2">
			<label class="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
				<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
				<input bind:value={filter} placeholder="Find a file" class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70" />
			</label>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
			{#if treeError}
				<p class="px-2 py-3 text-xs text-destructive">{treeError}</p>
			{:else if !files}
				<p class="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><LoaderIcon class="size-3.5 animate-spin" />Listing files…</p>
			{:else if tree.length === 0}
				<p class="px-2 py-3 text-xs text-muted-foreground">{query ? 'No file matches.' : 'No files.'}</p>
			{:else}
				<!-- a search shows its matches open; the whole tree starts closed -->
				{#key !!matches}
					<FileTree nodes={tree} selected={path} defaultOpen={!!matches} toggled={matches ? closed : opened} onpick={pick}>
						{#snippet trailing(f: TreeFile)}
							{#if f.change}<span class={cn('shrink-0 font-mono text-[0.625rem] font-semibold', markTone[f.change])} title={f.change}>{mark[f.change]}</span>{/if}
						{/snippet}
					</FileTree>
				{/key}
				{#if matches?.length === 300}<p class="px-2 pt-2 text-[0.6875rem] text-muted-foreground">The first 300 matches. Keep typing to narrow it down.</p>{/if}
			{/if}
		</div>
	</aside>

	<div class={cn('min-w-0 flex-1 flex-col @3xl/pane:flex', path ? 'flex' : 'hidden')}>
		{#if !path}
			<div class="forge-glow grid flex-1 place-items-center p-6 text-sm text-muted-foreground">Pick a file to read it.</div>
		{:else}
			<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
				<Button variant="ghost" size="icon-sm" class="-ms-2 shrink-0 @3xl/pane:hidden" onclick={() => tile.go({ view: 'code', rev: tile.route.rev })} aria-label="Back to the files"><ArrowLeftIcon /></Button>
				<h2 class="flex min-w-0 items-baseline font-mono text-xs" title={path}>
					{#if dirname(path)}<span class="truncate text-muted-foreground">{dirname(path)}/</span>{/if}
					<span class="shrink-0 font-medium text-foreground">{path.slice(path.lastIndexOf('/') + 1)}</span>
				</h2>
				{#if content && !content.missing}
					<span class="shrink-0 text-xs text-muted-foreground tabular-nums">{content.text !== null ? `${lines.length} lines · ` : ''}{bytes(content.size)}</span>
				{/if}
				{#if isMarkdown && content?.text != null}
					<div class="ms-auto flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group">
						{#each [{ on: true, label: 'Preview', icon: EyeIcon }, { on: false, label: 'Source', icon: CodeIcon }] as o (o.label)}
							<button
								type="button"
								class={cn('flex h-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground', preview === o.on && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
								aria-pressed={preview === o.on}
								onclick={() => (preview = o.on)}
							>
								<o.icon class="size-3.5" />{o.label}
							</button>
						{/each}
					</div>
				{/if}
			</header>
			<div class="min-h-0 flex-1 overflow-auto">
				{#if fileError}
					<p class="p-6 text-sm text-destructive">{fileError}</p>
				{:else if !content}
					<p class="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
				{:else if content.missing}
					<p class="p-6 text-sm text-muted-foreground">This file does not exist {rev === WORKTREE ? 'in the checkout' : 'at this commit'}.</p>
				{:else if content.binary}
					<p class="p-6 text-sm text-muted-foreground">Binary file ({bytes(content.size)}), not shown.</p>
				{:else if content.text === null}
					<p class="p-6 text-sm text-muted-foreground">This file is too large to show ({bytes(content.size)}).</p>
				{:else if isMarkdown && preview}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
					<div class="md mx-auto max-w-3xl p-8">{@html renderMarkdown(content.text)}</div>
				{:else}
					<div class="code min-w-fit py-2">
						{#each lines as line, i (i)}
							<div class="flex hover:bg-accent/30">
								<span class="w-14 shrink-0 pe-4 text-right text-[0.6875rem] text-muted-foreground/60 tabular-nums select-none">{i + 1}</span>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- lineHtml escapes the text -->
								<span class="pe-6 whitespace-pre">{@html lineHtml(toks?.[i], line)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
