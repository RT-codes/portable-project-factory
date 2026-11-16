<script lang="ts">
	import AppWindowIcon from '@lucide/svelte/icons/app-window'
	import BracesIcon from '@lucide/svelte/icons/braces'
	import CodeIcon from '@lucide/svelte/icons/code'
	import EyeIcon from '@lucide/svelte/icons/eye'
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line'
	import SaveIcon from '@lucide/svelte/icons/save'
	import Trash2Icon from '@lucide/svelte/icons/trash-2'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import UndoIcon from '@lucide/svelte/icons/undo-2'
	import type { Component } from 'svelte'
	import type { AgentFile } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { bytes } from '$lib/format'
	import { renderMarkdown } from '$lib/markdown'
	import { cn } from '$lib/utils'
	import { agents, frontmatter } from '../agents.svelte'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import Editor from '../components/Editor.svelte'
	import { keys } from '../keys.svelte'
	import { basename, dirname } from '../lib/tree'
	import { getTile } from '../pane'

	// The editor for one agent file. The bar under its name saves, reverts, renames and deletes it, switches a
	// markdown file between its source and how it reads, tidies JSON, and hands the file to the system's own
	// editor. What is typed is a draft (kept even if this panel shows something else) until it is saved.
	const tile = getTile()
	const project = $derived(app.project!)
	// svelte-ignore state_referenced_locally -- this view lives for one file (the panel keys it by path)
	const path = tile.route.path ?? ''

	let file = $state<AgentFile | null>(null)
	let error = $state<string | null>(null)
	let text = $state('')
	let rich = $state(false)
	let busy = $state(false)
	let notice = $state<string | null>(null)
	/** the file on disk is no longer the one this text started from */
	let conflict = $state(false)
	let renaming = $state(false)
	let newName = $state('')
	let deleting = $state(false)
	let actionError = $state<string | null>(null)

	const isMarkdown = /\.(md|markdown|mdx)$/i.test(path)
	const isJson = /\.json$/i.test(path)
	const dirty = $derived(file?.text != null && text !== file.text)
	const jsonError = $derived.by(() => {
		if (!isJson || !file || file.text === null || !text.trim()) return null
		try {
			JSON.parse(text)
			return null
		} catch (e) {
			return message(e).replace(/^JSON\.parse: /, '')
		}
	})
	const matter = $derived(isMarkdown && rich ? frontmatter(text) : null)

	async function load(keepDraft = true) {
		try {
			const next = await api.agentRead(project, path)
			file = next
			error = null
			conflict = false
			text = (keepDraft ? agents.drafts.get(path) : undefined) ?? next.text ?? ''
		} catch (e) {
			error = message(e)
		}
	}
	$effect(() => {
		void load()
	})

	// what is typed is remembered as the file's draft, and forgotten once it equals what is on disk again
	$effect(() => {
		if (!file || file.text === null) return
		if (text !== file.text) agents.drafts.set(path, text)
		else agents.drafts.delete(path)
	})

	// back in the window: an agent or another editor may have changed the file meanwhile
	$effect(() =>
		app.onFocus(async () => {
			if (!file) return
			const now = await api.agentRead(project, path).catch(() => null)
			if (!now) return void (conflict = true)
			if (Math.abs(now.mtime - file.mtime) <= 1) return
			if (dirty) conflict = true
			else void load(false)
		})
	)

	async function save(force = false) {
		if (!file || file.text === null || busy || (!dirty && !force)) return
		busy = true
		actionError = null
		try {
			const saved = await api.agentWrite(project, path, text, file.mtime, force)
			file = { ...file, ...saved, text }
			conflict = false
			notice = 'Saved'
			setTimeout(() => (notice = null), 1800)
			void agents.refresh(project)
		} catch (e) {
			if (message(e).startsWith('conflict')) conflict = true
			else actionError = message(e)
		} finally {
			busy = false
		}
	}

	function revert() {
		if (file?.text != null) text = file.text
	}

	function format() {
		try {
			text = JSON.stringify(JSON.parse(text), null, 2) + '\n'
		} catch {
			/* the bar already says what is wrong with it */
		}
	}

	function startRename() {
		newName = path
		renaming = true
		deleting = false
		actionError = null
	}
	async function rename() {
		const to = newName.trim().replace(/^\/+|\/+$/g, '')
		if (!to || to === path) return void (renaming = false)
		actionError = null
		try {
			await api.agentRename(project, path, to)
			agents.moved(path, to)
			void agents.refresh(project)
			tile.go({ view: 'edit', path: to })
		} catch (e) {
			actionError = message(e)
		}
	}

	async function remove() {
		actionError = null
		try {
			await api.agentDelete(project, path)
			agents.removed(path)
			void agents.refresh(project)
			tile.close()
		} catch (e) {
			actionError = message(e)
		}
	}

	const outside = (run: Promise<void>) => run.catch((e) => (actionError = message(e)))

	function onkeydown(e: KeyboardEvent) {
		// in the rendered view there is no editor to catch the save key
		if (tile.active && !e.defaultPrevented && keys.is('editor.save', e)) {
			e.preventDefault()
			void save()
		}
	}
</script>

<svelte:window {onkeydown} />

{#snippet tool(label: string, Icon: Component<{ class?: string }>, run: () => void, opts: { off?: boolean; primary?: boolean; pressed?: boolean; title?: string } = {})}
	<Button
		variant={opts.primary ? 'default' : 'ghost'}
		size="xs"
		class={cn('h-7', opts.pressed && 'bg-accent text-foreground')}
		disabled={opts.off}
		aria-pressed={opts.pressed}
		aria-label={label}
		title={opts.title ?? label}
		onclick={run}
	>
		<Icon class="size-3.5" /><span class="hidden @2xl/pane:inline">{label}</span>
	</Button>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" data-editing={path}>
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		{#if renaming}
			<form class="flex min-w-0 flex-1 items-center gap-2" aria-label="Rename" onsubmit={(e) => (e.preventDefault(), rename())}>
				<!-- svelte-ignore a11y_autofocus -- the form was just asked for -->
				<input
					bind:value={newName}
					autofocus
					spellcheck="false"
					aria-label="New path"
					onkeydown={(e) => e.key === 'Escape' && (renaming = false)}
					class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
				/>
				<Button size="sm" type="submit">Rename</Button>
				<Button size="sm" variant="ghost" onclick={() => (renaming = false)}>Cancel</Button>
			</form>
		{:else}
			<h1 class="flex min-w-0 items-baseline font-mono text-sm" title={path}>
				{#if dirname(path)}<span class="truncate text-muted-foreground">{dirname(path)}/</span>{/if}
				<span class="shrink-0 font-semibold">{basename(path)}</span>
			</h1>
			{#if dirty}
				<span class="shrink-0 rounded-full bg-tone-amber/15 px-2 py-0.5 text-[0.6875rem] font-medium text-tone-amber">Unsaved</span>
			{:else if notice}
				<span class="shrink-0 rounded-full bg-tone-green/15 px-2 py-0.5 text-[0.6875rem] font-medium text-tone-green">{notice}</span>
			{/if}
			{#if file}<span class="ms-auto hidden shrink-0 text-xs text-muted-foreground tabular-nums @xl/pane:inline">{bytes(new Blob([text]).size)}</span>{/if}
		{/if}
	</header>

	<!-- the file's own bar: everything that can be done to it -->
	{#if file}
		<div class="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2" role="toolbar" aria-label="File">
			{#if file.text !== null}
				{@render tool('Save', SaveIcon, () => save(), { off: !dirty || busy, primary: dirty, title: `Save${keys.hint('editor.save')}` })}
				{@render tool('Revert', UndoIcon, revert, { off: !dirty, title: 'Throw away the unsaved changes' })}
				<span class="mx-1 h-4 shrink-0 border-s"></span>
				{#if isMarkdown}
					{@render tool('Raw', CodeIcon, () => (rich = false), { pressed: !rich, title: 'The markdown source, to edit' })}
					{@render tool('Rich', EyeIcon, () => (rich = true), { pressed: rich, title: 'How it reads' })}
					<span class="mx-1 h-4 shrink-0 border-s"></span>
				{/if}
				{#if isJson}
					{@render tool('Format', BracesIcon, format, { off: jsonError !== null, title: 'Indent the JSON evenly' })}
					<span class="mx-1 h-4 shrink-0 border-s"></span>
				{/if}
			{/if}
			{#if !file.fixed}
				{@render tool('Rename', PencilLineIcon, startRename, { title: 'Rename or move' })}
				{#if deleting}
					<Button variant="destructive" size="xs" class="h-7" onclick={remove}>Move to the trash</Button>
					<Button variant="ghost" size="xs" class="h-7" onclick={() => (deleting = false)}>Keep</Button>
				{:else}
					{@render tool('Delete', Trash2Icon, () => ((deleting = true), (renaming = false)))}
				{/if}
				<span class="mx-1 h-4 shrink-0 border-s"></span>
			{/if}
			{@render tool('Open in editor', AppWindowIcon, () => outside(api.agentOpen(project, path)), { title: 'Open in the app your system uses for this kind of file' })}
			{@render tool('Show in folder', FolderOpenIcon, () => outside(api.agentReveal(project, path)), { title: 'Show in the file manager' })}
			{#if jsonError}
				<span class="ms-auto flex min-w-0 shrink-0 items-center gap-1.5 ps-3 text-xs text-destructive" title={jsonError}><TriangleAlertIcon class="size-3.5 shrink-0" /><span class="max-w-72 truncate">Not valid JSON: {jsonError}</span></span>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<p class="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">{actionError}</p>
	{/if}
	{#if conflict}
		<div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-tone-amber/10 px-4 py-2 text-xs" role="alert">
			<TriangleAlertIcon class="size-3.5 shrink-0 text-tone-amber" />
			<span class="min-w-0 flex-1">This file changed on disk since you opened it: an agent or another editor wrote to it.</span>
			<Button variant="outline" size="xs" onclick={() => load(false)}>Load theirs</Button>
			<Button variant="outline" size="xs" onclick={() => save(true)}>Save mine over it</Button>
		</div>
	{/if}

	{#if error}
		<p class="p-6 text-sm text-destructive">{error}</p>
	{:else if !file}
		<p class="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
	{:else if file.text === null}
		<div class="p-6 text-sm text-muted-foreground">
			<p>{file.reason === 'binary' ? 'This is not a text file' : `This file is too large to edit here (${bytes(file.size)})`}. Open it in another app with the button above.</p>
		</div>
	{:else if isMarkdown && rich}
		<div class="min-h-0 flex-1 overflow-y-auto" data-rich>
			<div class="mx-auto max-w-3xl p-8">
				{#if matter && matter.fields.length > 0}
					<dl class="mb-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-card p-4 text-sm">
						{#each matter.fields as f (f.key)}
							<dt class="font-mono text-xs leading-6 text-muted-foreground">{f.key}</dt>
							<dd class="[overflow-wrap:anywhere]">{f.value}</dd>
						{/each}
					</dl>
				{/if}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
				<div class="md">{@html renderMarkdown(matter ? matter.body : text)}</div>
			</div>
		</div>
	{:else}
		<Editor bind:value={text} {path} onsave={() => save()} />
	{/if}
</div>
