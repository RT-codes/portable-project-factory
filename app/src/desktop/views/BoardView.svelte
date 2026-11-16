<script lang="ts">
	import FactoryIcon from '@lucide/svelte/icons/factory'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import KanbanIcon from '@lucide/svelte/icons/square-kanban'
	import Board from '$lib/components/Board.svelte'
	import LivePill from '$lib/components/LivePill.svelte'
	import { factory } from '$lib/factory.svelte'
	import type { Job } from '$lib/types'
	import { app } from '../app.svelte'
	import { getTile } from '../pane'
	import EmptyState from '../components/EmptyState.svelte'
	import InstallCommand from '../components/InstallCommand.svelte'

	// The factory's board. `route.path` may name a ticket to open.
	let { now }: { now: number } = $props()
	const tile = getTile()

	// a ticket's branch against the factory's base branch, in the diff viewer
	function review(job: Job) {
		if (!job.branch || !factory.state) return
		tile.go({ view: 'changes', source: { base: factory.state.config.base_branch, head: job.branch, title: job.title } })
	}
</script>

{#if factory.state}
	{@const config = factory.state.config}
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<KanbanIcon class="size-4 shrink-0 text-muted-foreground" />
		<h1 class="max-w-[60%] shrink-0 truncate text-[0.9375rem] font-semibold tracking-tight">{config.name ?? 'Factory'}</h1>
		<span class="min-w-0 truncate text-xs text-muted-foreground">
			{config.stages.length} stages · {config.concurrency} at a time · base <span class="font-mono">{config.base_branch}</span>
		</span>
		<div class="ms-auto shrink-0"><LivePill {now} hint="Can't read .factory/" /></div>
	</header>
	<Board snap={factory.state} {now} onreview={review} ticket={tile.route.path ?? null} />
{:else if factory.error}
	<EmptyState icon={TriangleAlertIcon} title="Can't read the factory">
		<p class="font-mono text-xs text-destructive/90">{factory.error}</p>
	</EmptyState>
{:else if app.info && !app.info.hasFactory}
	<EmptyState icon={FactoryIcon} title="No factory in this repo yet" glow>
		<p>The board shows tickets moving through plan, build, check and review. Install the factory, then file a ticket with your agent (Claude Code or Codex).</p>
		<InstallCommand />
		<p>Changes, pull requests, issues and code work without it.</p>
	</EmptyState>
{:else}
	<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
{/if}
