<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open'
	import BotIcon from '@lucide/svelte/icons/bot'
	import BracesIcon from '@lucide/svelte/icons/braces'
	import FileCogIcon from '@lucide/svelte/icons/file-cog'
	import FilePlusIcon from '@lucide/svelte/icons/file-plus'
	import FileTextIcon from '@lucide/svelte/icons/file-text'
	import FolderIcon from '@lucide/svelte/icons/folder'
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'
	import { untrack } from 'svelte'
	import { SvelteSet } from 'svelte/reactivity'
	import type { AgentEntry } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { ago, bytes } from '$lib/format'
	import { cn } from '$lib/utils'
	import { agents, templateFor } from '../agents.svelte'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import FileTree from '../components/FileTree.svelte'
	import { buildTree, dirname } from '../lib/tree'
	import { getTile } from '../pane'

	// Agents: the files that tell agents how to work in this repo, as a tree. Everything under .claude/ (agents,
	// skills, commands, settings), the instruction files at the root (CLAUDE.md, AGENTS.md...), and the factory's
	// rules, role prompts and pipeline (.factory/). A file opens in an editor in the panel beside this one.
	let { now }: { now: number } = $props()
	const tile = getTile()
	const project = $derived(app.project!)

	let loading = $state(false)
	let opened = $state<string | null>(null)
	/** where a new file or folder goes: the folder last clicked, or of the file last opened */
	let folder = $state('.claude/agents')
	let making = $state<'file' | 'folder' | null>(null)
	let newPath = $state('')
	let makeError = $state<string | null>(null)
	const toggled = new SvelteSet<string>()

	async function refresh() {
		loading = true
		await agents.refresh(project)
		loading = false
	}
	$effect(() => {
		void project
		void refresh()
	})
	$effect(() => app.onFocus(() => void agents.refresh(project)))

	// opened on a folder (Home's "Skills" does this): ready to make a file in it
	const asked = untrack(() => tile.route.path)
	if (asked) {
		folder = asked
		making = 'file'
		newPath = `${asked}/`
	}
	const inSkills = $derived(newPath.startsWith('.factory/skills/'))

	const entries = $derived(agents.entries ?? [])
	/** files, and the folders with nothing in them (the others show as the files' own folders) */
	const items = $derived(entries.filter((e) => !e.dir || !entries.some((o) => o.path.startsWith(e.path + '/'))))
	const tree = $derived(buildTree(items))

	function pick(entry: AgentEntry) {
		if (entry.dir) {
			folder = entry.path
			return
		}
		folder = dirname(entry.path) || folder
		opened = entry.path
		tile.openBeside({ view: 'edit', path: entry.path })
	}

	function start(kind: 'file' | 'folder', at = folder) {
		making = kind
		makeError = null
		newPath = `${at}/`
	}

	async function make() {
		const path = newPath.trim().replace(/^\/+|\/+$/g, '')
		if (!path) return
		makeError = null
		try {
			if (making === 'folder') {
				await api.agentMkdir(project, path)
				folder = path
			} else {
				await api.agentWrite(project, path, templateFor(path), null)
				folder = dirname(path) || folder
			}
			const made = making
			making = null
			await agents.refresh(project)
			if (made === 'file') pick({ path, dir: false, size: 0, mtime: 0 })
		} catch (e) {
			makeError = message(e)
		}
	}

	const iconOf = (e: AgentEntry) => (e.dir ? FolderIcon : /\.(md|markdown)$/i.test(e.path) ? FileTextIcon : /\.json$/i.test(e.path) ? BracesIcon : /\.(log|txt)$/i.test(e.path) ? ScrollTextIcon : FileCogIcon)
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<BotIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">Agents</h1>
			<p class="truncate text-xs text-muted-foreground">What agents read in this repo: <span class="font-mono">.claude</span>, the instruction files, the factory's rules and roles</p>
		</div>
		<div class="ms-auto flex shrink-0 items-center gap-1.5">
			<Button variant="outline" size="sm" onclick={() => start('file')}><FilePlusIcon /><span class="hidden @xl/pane:inline">New file</span></Button>
			<Button variant="outline" size="sm" onclick={() => start('folder', folder.startsWith('.claude') || folder.startsWith('.factory/roles') ? folder : '.claude')} aria-label="New folder"><FolderPlusIcon /><span class="hidden @xl/pane:inline">New folder</span></Button>
			<Button variant="ghost" size="icon-sm" onclick={() => tile.openBeside({ view: 'guide', path: 'skills' })} aria-label="How to write a skill" title="How to write a skill"><BookOpenIcon /></Button>
			<Button variant="ghost" size="icon-sm" onclick={refresh} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
		</div>
	</header>

	{#if making}
		<form class="shrink-0 border-b bg-muted/30 p-3" aria-label={making === 'file' ? 'New file' : 'New folder'} onsubmit={(e) => (e.preventDefault(), make())}>
			<label class="text-xs font-medium" for="agent-new-path">{making === 'file' ? 'Path of the new file' : 'Path of the new folder'}</label>
			<div class="mt-1.5 flex gap-2">
				<!-- svelte-ignore a11y_autofocus -- the form was just asked for -->
				<input
					id="agent-new-path"
					bind:value={newPath}
					autofocus
					spellcheck="false"
					placeholder={making === 'file' ? '.claude/agents/tester.md' : '.claude/commands'}
					onkeydown={(e) => e.key === 'Escape' && (making = null)}
					class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
				/>
				<Button size="sm" type="submit" disabled={!newPath.trim() || newPath.trim().endsWith('/')}>Create</Button>
				<Button size="sm" variant="ghost" onclick={() => (making = null)}>Cancel</Button>
			</div>
			{#if makeError}
				<p class="mt-1.5 text-xs text-destructive" role="alert">{makeError}</p>
			{:else if making === 'file' && inSkills}
				<p class="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
					<span>A skill is one markdown file, named after the task: <span class="font-mono text-foreground/80">.factory/skills/add-migration.md</span>. Any agent can use it.</span>
					<button type="button" class="text-primary underline underline-offset-4" onclick={() => tile.openBeside({ view: 'guide', path: 'skills' })}>How to write one</button>
				</p>
			{:else if making === 'file'}
				<p class="mt-1.5 text-xs text-muted-foreground">A new agent, skill or command starts from a template with the fields it needs.</p>
			{/if}
		</form>
	{/if}

	{#if agents.error}
		<p class="p-6 text-sm text-destructive">{agents.error}</p>
	{:else if agents.entries === null}
		<p class="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Listing files…</p>
	{:else if items.length === 0}
		<EmptyState icon={BotIcon} title="No agent files in this repo yet" glow>
			<p>Agents read their instructions from files: <span class="font-mono">CLAUDE.md</span> for the repo as a whole, and <span class="font-mono">.claude/agents/</span> for each role.</p>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" onclick={() => ((making = 'file'), (newPath = 'CLAUDE.md'), (makeError = null))}>Create CLAUDE.md</Button>
				<Button size="sm" variant="outline" onclick={() => start('file', '.claude/agents')}>New agent</Button>
			</div>
		</EmptyState>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			<FileTree nodes={tree} selected={opened} defaultOpen {toggled} onpick={pick}>
				{#snippet leading(e: AgentEntry)}
					{@const Icon = iconOf(e)}
					<Icon class={cn('size-3.5 shrink-0', e.dir ? 'text-muted-foreground/70' : 'text-muted-foreground')} />
				{/snippet}
				{#snippet trailing(e: AgentEntry)}
					{#if agents.drafts.has(e.path)}
						<span class="size-1.5 shrink-0 rounded-full bg-tone-amber" title="Unsaved changes" aria-label="Unsaved changes"></span>
					{/if}
					{#if e.dir}
						<span class="shrink-0 text-[0.6875rem] text-muted-foreground/70">empty</span>
					{:else}
						<span class="hidden w-16 shrink-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums @md/pane:inline">{bytes(e.size)}</span>
						<span class="hidden w-20 shrink-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums @lg/pane:inline">{ago(e.mtime, now)}</span>
					{/if}
				{/snippet}
			</FileTree>
		</div>
		<p class="shrink-0 truncate border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
			New files go in <span class="font-mono">{folder}/</span> · click a folder to change that · a file opens in the panel beside this one
		</p>
	{/if}
</div>
