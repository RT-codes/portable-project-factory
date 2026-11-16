<script lang="ts">
	import BotIcon from '@lucide/svelte/icons/bot'
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows'
	import GitGraphIcon from '@lucide/svelte/icons/git-graph'
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request'
	import HouseIcon from '@lucide/svelte/icons/house'
	import NotebookTextIcon from '@lucide/svelte/icons/notebook-text'
	import KanbanIcon from '@lucide/svelte/icons/square-kanban'
	import XIcon from '@lucide/svelte/icons/x'
	import ActivityIcon from '@lucide/svelte/icons/activity'
	import { Button } from '$lib/components/ui/button/index.js'
	import { app, type Route, type View } from './app.svelte'
	import { layout, type PaneNode } from './layout.svelte'
	import { setTile } from './pane'
	import ActivityView from './views/ActivityView.svelte'
	import AgentsView from './views/AgentsView.svelte'
	import BoardView from './views/BoardView.svelte'
	import ChangesView from './views/ChangesView.svelte'
	import CodeView from './views/CodeView.svelte'
	import EditView from './views/EditView.svelte'
	import GuideView from './views/GuideView.svelte'
	import HistoryView from './views/HistoryView.svelte'
	import HomeView from './views/HomeView.svelte'
	import IssuesView from './views/IssuesView.svelte'
	import JournalView from './views/JournalView.svelte'
	import ModelsView from './views/ModelsView.svelte'
	import PullsView from './views/PullsView.svelte'
	import SettingsView from './views/SettingsView.svelte'

	// One panel of the main area: the view it shows, or, while it is empty, the views it can open.
	let { pane, now }: { pane: PaneNode; now: number } = $props()

	// svelte-ignore state_referenced_locally -- a panel keeps its id for as long as it lives
	const id = pane.id
	setTile({
		id,
		get route() {
			return pane.route ?? { view: 'home' }
		},
		get active() {
			return layout.active.id === id
		},
		go: (route: Route) => layout.go(route, id),
		openBeside: (route: Route, dir?: 'row' | 'col') => layout.openBeside(route, id, dir),
		close: (fallback: Route = { view: 'agents' }) => (layout.single ? layout.go(fallback, id) : layout.close(id)),
	})

	const views: { view: View; label: string; icon: typeof KanbanIcon; count: number | null; off?: boolean }[] = $derived([
		{ view: 'home', label: 'Home', icon: HouseIcon, count: null },
		{ view: 'board', label: 'Board', icon: KanbanIcon, count: null },
		{ view: 'activity', label: 'Activity', icon: ActivityIcon, count: (app.counts.pulls ?? 0) + (app.counts.issues ?? 0) || null },
		{ view: 'changes', label: 'Changes', icon: GitCompareIcon, count: app.counts.changes, off: app.info ? !app.info.isGit : false },
		{ view: 'pulls', label: 'Pull requests', icon: GitPullRequestIcon, count: app.counts.pulls },
		{ view: 'issues', label: 'Issues', icon: CircleDotIcon, count: app.counts.issues },
		{ view: 'code', label: 'Code', icon: FolderTreeIcon, count: null },
		{ view: 'history', label: 'History', icon: GitGraphIcon, count: null, off: app.info ? !app.info.isGit : false },
		{ view: 'journal', label: 'Journal', icon: NotebookTextIcon, count: null },
		{ view: 'agents', label: 'Agents', icon: BotIcon, count: null },
	])
</script>

{#if !pane.route}
	<div class="forge-glow grid min-h-0 flex-1 place-items-center overflow-y-auto p-4" data-empty-pane>
		<div class="w-full max-w-xs">
			<p class="mb-2 text-center text-xs text-muted-foreground">Open in this panel</p>
			<div class="space-y-1">
				{#each views as v (v.view)}
					<button
						type="button"
						class="flex h-9 w-full items-center gap-2.5 rounded-md border bg-card px-3 text-sm transition-colors hover:border-foreground/20 hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
						disabled={v.off}
						onclick={() => layout.go({ view: v.view }, id)}
					>
						<v.icon class="size-4 text-muted-foreground" />
						<span class="flex-1 text-left">{v.label}</span>
						{#if v.count}<span class="rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{v.count}</span>{/if}
					</button>
				{/each}
			</div>
			{#if !layout.single}
				<div class="mt-3 text-center">
					<Button variant="ghost" size="xs" onclick={() => layout.close(id)}><XIcon />Close this panel</Button>
				</div>
			{/if}
		</div>
	</div>
{:else if pane.route.view === 'home'}
	<HomeView {now} />
{:else if pane.route.view === 'board'}
	<BoardView {now} />
{:else if pane.route.view === 'activity'}
	<ActivityView {now} />
{:else if pane.route.view === 'changes'}
	<ChangesView {now} />
{:else if pane.route.view === 'pulls'}
	<PullsView {now} />
{:else if pane.route.view === 'issues'}
	<IssuesView {now} />
{:else if pane.route.view === 'history'}
	<HistoryView {now} />
{:else if pane.route.view === 'journal'}
	<JournalView {now} />
{:else if pane.route.view === 'guide'}
	<GuideView />
{:else if pane.route.view === 'models'}
	<ModelsView />
{:else if pane.route.view === 'agents'}
	<AgentsView {now} />
{:else if pane.route.view === 'edit'}
	{#key pane.route.path}
		<EditView />
	{/key}
{:else if pane.route.view === 'settings'}
	<SettingsView />
{:else}
	<CodeView />
{/if}
