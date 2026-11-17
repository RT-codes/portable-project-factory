<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity'
	import BotIcon from '@lucide/svelte/icons/bot'
	import CheckIcon from '@lucide/svelte/icons/check'
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down'
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
	import GitBranchIcon from '@lucide/svelte/icons/git-branch'
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows'
	import GitGraphIcon from '@lucide/svelte/icons/git-graph'
	import HouseIcon from '@lucide/svelte/icons/house'
	import KeyboardIcon from '@lucide/svelte/icons/keyboard'
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column'
	import NotebookTextIcon from '@lucide/svelte/icons/notebook-text'
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close'
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open'
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request'
	import KanbanIcon from '@lucide/svelte/icons/square-kanban'
	import SettingsIcon from '@lucide/svelte/icons/settings'
	import XIcon from '@lucide/svelte/icons/x'
	import { onMount } from 'svelte'
	import { Button } from '$lib/components/ui/button/index.js'
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import Logo from '$lib/components/Logo.svelte'
	import { factory } from '$lib/factory.svelte'
	import { BLOCKED } from '$lib/types'
	import { cn } from '$lib/utils'
	import { agents } from './agents.svelte'
	import { onAppEvent } from './api'
	import { app, type View } from './app.svelte'
	// importing it applies the saved theme
	import './appearance.svelte'
	import { keys } from './keys.svelte'
	import KeysPanel from './KeysPanel.svelte'
	import { layout, type Side } from './layout.svelte'
	import PaneArea from './PaneArea.svelte'

	// The desktop app: a sidebar to pick the project and the view, and the view beside it.
	let now = $state(Date.now())
	let switcher = $state(false)
	/** the sidebar folded to a strip of icons; remembered */
	let folded = $state(
		(() => {
			try {
				return localStorage.getItem('factory-sidebar') === 'folded'
			} catch {
				return false
			}
		})()
	)
	function fold() {
		folded = !folded
		try {
			localStorage.setItem('factory-sidebar', folded ? 'folded' : 'open')
		} catch {
			/* then it lasts for this visit */
		}
	}

	onMount(() => {
		void app.load()
		const stopPolling = factory.start()
		const tick = setInterval(() => (now = Date.now()), 5_000)
		const stopEvents = onAppEvent((name) => {
			if (name === 'projects') void app.load()
			if (name === 'focus') app.focused()
		})
		return () => {
			stopPolling()
			clearInterval(tick)
			stopEvents()
		}
	})

	const info = $derived(app.info)
	/** what the active panel shows: the sidebar marks it, and a click on the sidebar changes it */
	const shown = $derived(layout.active.route?.view ?? null)
	// the editor belongs to Agents, the models to Home (it is reached from there)
	const current = $derived(shown === 'edit' || shown === 'guide' ? 'agents' : shown === 'models' ? 'home' : shown)
	const needsYou = $derived(factory.state?.jobs.filter((j) => j.stage === BLOCKED).length ?? 0)
	const nav = $derived<{ view: View; label: string; icon: typeof KanbanIcon; count: number | null; alert?: boolean; off?: boolean }[]>([
		{ view: 'home', label: 'Home', icon: HouseIcon, count: null },
		{ view: 'activity', label: 'Activity', icon: ActivityIcon, count: (app.counts.pulls ?? 0) + (app.counts.issues ?? 0) || null },
		{ view: 'board', label: 'Board', icon: KanbanIcon, count: needsYou || null, alert: true },
		{ view: 'changes', label: 'Changes', icon: GitCompareIcon, count: app.counts.changes || null, off: info ? !info.isGit : false },
		{ view: 'pulls', label: 'Pull requests', icon: GitPullRequestIcon, count: app.counts.pulls || null },
		{ view: 'issues', label: 'Issues', icon: CircleDotIcon, count: app.counts.issues || null },
		{ view: 'code', label: 'Code', icon: FolderTreeIcon, count: null },
		{ view: 'history', label: 'History', icon: GitGraphIcon, count: null, off: info ? !info.isGit : false },
		{ view: 'journal', label: 'Journal', icon: NotebookTextIcon, count: null },
		{ view: 'usage', label: 'Usage', icon: ChartColumnIcon, count: null },
		{ view: 'agents', label: 'Agents', icon: BotIcon, count: agents.drafts.size || null, alert: true },
	])

	$effect(() => {
		document.title = info ? `${info.name} · Factory` : 'Factory'
	})

	/** Show the view before or after the active panel's in the sidebar, past the ones that are off, and around. */
	function step(by: 1 | -1) {
		const on = nav.filter((item) => !item.off)
		const at = on.findIndex((item) => item.view === current)
		const next = on[at < 0 ? (by > 0 ? 0 : on.length - 1) : (at + by + on.length) % on.length]
		if (next) app.go({ view: next.view })
	}
	function focusPane(side: Side) {
		const next = layout.neighbour(side)
		if (next) layout.focus(next)
	}

	/** What the app-wide shortcuts do (keys.svelte.ts has their keys). All but the first need an open project. */
	const actions: Record<string, () => void> = {
		'keys.open': () => (keys.open = !keys.open),
		'settings.open': () => app.go({ view: 'settings' }),
		'sidebar.fold': fold,
		'view.prev': () => step(-1),
		'view.next': () => step(1),
		'pane.split.right': () => layout.split('row'),
		'pane.split.down': () => layout.split('col'),
		'pane.focus.left': () => focusPane('left'),
		'pane.focus.right': () => focusPane('right'),
		'pane.focus.up': () => focusPane('top'),
		'pane.focus.down': () => focusPane('bottom'),
		'pane.rotate': () => layout.rotate(),
		'pane.swap': () => layout.swap(),
		'pane.close': () => layout.close(),
	}

	// In the capture phase, so a shortcut is the app's wherever the focus is (an editor has uses of its own for
	// Alt and the arrows, say).
	function onkeydown(e: KeyboardEvent) {
		if (keys.listening) return
		if (e.key === 'Escape') switcher = false
		const id = keys.toggles(e) ? 'keys.open' : keys.find(e)
		if (!id || (id !== 'keys.open' && !app.project)) return
		let run = actions[id]
		if (!run && id.startsWith('view.')) {
			const item = nav.find((n) => `view.${n.view}` === id)
			if (item && !item.off) run = () => app.go({ view: item.view })
		}
		if (!run) return
		e.preventDefault()
		e.stopPropagation()
		switcher = false
		run()
	}
</script>

<svelte:window onkeydowncapture={onkeydown} onclick={() => (switcher = false)} />

<Tooltip.Provider delayDuration={300}>
	{#if app.loading}
		<div class="h-svh"></div>
	{:else if !app.project}
		<main class="forge-glow grid h-svh place-items-center p-6">
			<div class="glow-card w-full max-w-md rounded-xl border p-8 text-center">
				<Logo class="mx-auto size-10" />
				<h1 class="mt-4 text-lg font-semibold tracking-tight">Factory</h1>
				<p class="mt-1 text-sm text-muted-foreground">Open a repo to see its board, review its changes and pull requests, and work its issues.</p>
				<Button class="mt-5" onclick={() => app.open()}><FolderOpenIcon />Open a project</Button>
				{#if app.error}<p class="mt-3 text-xs text-destructive">{app.error}</p>{/if}
			</div>
		</main>
	{:else}
		<div class="flex h-svh">
			<nav class={cn('flex shrink-0 flex-col border-e bg-muted/30 transition-[width] duration-200 dark:bg-card/40', folded ? 'w-14' : 'w-56')} aria-label="Views" data-folded={folded}>
				<!-- the header: the app's own buttons -->
				<div class={cn('flex items-center gap-1 border-b p-2', folded && 'flex-col')}>
					<Button
						variant="ghost"
						size="icon-sm"
						class={cn(current === 'settings' && 'bg-accent text-glow')}
						onclick={() => app.go({ view: 'settings' })}
						aria-label="Appearance settings"
						aria-current={current === 'settings' ? 'page' : undefined}
						title="Appearance settings{keys.hint('settings.open')}"
					>
						<SettingsIcon />
					</Button>
					<Button variant="ghost" size="icon-sm" class={cn(keys.open && 'bg-accent text-glow')} onclick={() => (keys.open = true)} aria-label="Shortcuts" aria-haspopup="dialog" title="Shortcuts{keys.hint('keys.open')}">
						<KeyboardIcon />
					</Button>
					<Button variant="ghost" size="icon-sm" class={cn(!folded && 'ms-auto')} onclick={fold} aria-label={folded ? 'Open the sidebar' : 'Fold the sidebar'} aria-expanded={!folded} title="{folded ? 'Open' : 'Fold'} the sidebar{keys.hint('sidebar.fold')}">
						{#if folded}<PanelLeftOpenIcon />{:else}<PanelLeftCloseIcon />{/if}
					</Button>
				</div>
				<div class="relative p-2">
					<button
						type="button"
						class={cn('flex h-12 w-full items-center gap-2.5 rounded-lg text-left hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', folded ? 'justify-center' : 'px-2')}
						aria-haspopup="menu"
						aria-label="Project: {info?.name ?? ''}"
						title={folded ? (info?.name ?? '') : undefined}
						aria-expanded={switcher}
						onclick={(e) => (e.stopPropagation(), (switcher = !switcher))}
					>
						<Logo />
						<span class={cn('min-w-0 flex-1', folded && 'hidden')}>
							<span class="block truncate text-sm leading-tight font-semibold tracking-tight">{info?.name ?? app.recent.find((p) => p.path === app.project)?.name}</span>
							<span class="flex items-center gap-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
								{#if info?.branch}<GitBranchIcon class="size-3 shrink-0" /><span class="truncate">{info.branch}</span>{:else if info && !info.isGit}not a git repo{:else}&nbsp;{/if}
							</span>
						</span>
						<ChevronsUpDownIcon class={cn('size-3.5 shrink-0 text-muted-foreground', folded && 'hidden')} />
					</button>
					{#if switcher}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- only keeps clicks inside from closing it -->
						<div class="absolute start-2 top-14 z-40 w-72 rounded-xl border bg-popover p-1 shadow-float" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
							<p class="px-2 pt-1.5 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Projects</p>
							{#each app.recent as p (p.path)}
								<div class="group/item flex items-center rounded-md hover:bg-accent/60">
									<button type="button" role="menuitem" class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" onclick={() => ((switcher = false), app.select(p.path))}>
										<CheckIcon class={cn('size-3.5 shrink-0', p.path !== app.project && 'invisible')} />
										<span class="min-w-0">
											<span class="block truncate text-sm">{p.name}</span>
											<span class="block truncate font-mono text-[0.625rem] text-muted-foreground" title={p.path}>{p.path}</span>
										</span>
									</button>
									<Button variant="ghost" size="icon-xs" class="me-1 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100" onclick={() => app.forget(p.path)} aria-label="Remove {p.name} from the list"><XIcon /></Button>
								</div>
							{/each}
							<div class="my-1 border-t"></div>
							<button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60" onclick={() => ((switcher = false), app.open())}>
								<FolderOpenIcon class="size-3.5" />Open a project…
							</button>
						</div>
					{/if}
				</div>

				<ul class="flex-1 space-y-0.5 overflow-y-auto px-2">
					{#each nav as item (item.view)}
						<!-- Home and Activity are the overviews; a short line sets them apart from the views of one thing -->
						{#if item.view === 'board'}<li role="separator" class={cn('mx-auto my-1.5 border-t', folded ? 'w-4' : 'w-[calc(100%-2.5rem)]')}></li>{/if}
						<li>
							<button
								type="button"
								class={cn(
									'relative flex h-8 w-full items-center gap-2.5 rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
									folded ? 'justify-center' : 'px-2.5',
									current === item.view && 'bg-accent font-medium text-foreground',
									item.off && 'pointer-events-none opacity-40'
								)}
								aria-current={current === item.view ? 'page' : undefined}
								disabled={item.off}
								title="{item.label}{folded && item.count ? ` · ${item.count}` : ''}{keys.hint(`view.${item.view}`)}"
								onclick={() => app.go({ view: item.view })}
							>
								<item.icon class={cn('size-4 shrink-0', current === item.view && 'text-glow')} />
								<span class={cn('flex-1 text-left', folded && 'sr-only')}>{item.label}</span>
								{#if item.count && !folded}
									<span class={cn('rounded-full px-1.5 font-mono text-[0.6875rem] tabular-nums', item.alert ? 'bg-tone-amber/15 text-tone-amber' : 'bg-muted text-muted-foreground')}>{item.count}</span>
								{:else if item.count}
									<!-- folded: a dot says there is something, the tooltip says how much -->
									<span class={cn('absolute top-1 right-2 size-1.5 rounded-full', item.alert ? 'bg-tone-amber' : 'bg-muted-foreground/70')} aria-hidden="true"></span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>

				<!-- the footer: the GitHub connection, on two lines so the login is never cut short (a long one wraps) -->
				<div
					class={cn('flex gap-2 border-t text-xs', folded ? 'h-10 items-center justify-center' : 'items-start px-4 py-2.5')}
					title={info?.githubError ?? (info?.github ? `${info.github.owner}/${info.github.repo}` : '')}
					data-github={info?.github ? 'connected' : info ? 'off' : 'connecting'}
				>
					<span class={cn('size-1.5 shrink-0 rounded-full', !folded && 'mt-[0.4375rem]', info?.github ? 'bg-tone-green' : info ? 'bg-muted-foreground/50' : 'animate-pulse bg-muted-foreground/50')}></span>
					<p class={cn('min-w-0 flex-1 leading-5', folded && 'sr-only')}>
						<span class="block font-medium">GitHub</span>
						<span class={cn('block text-[0.6875rem] leading-4 text-muted-foreground', info?.github && 'font-mono break-all')}>{info?.github ? info.github.viewer : info ? 'Not connected' : 'Connecting…'}</span>
					</p>
				</div>
			</nav>

			{#key app.project}
				<PaneArea {now} />
			{/key}
		</div>
	{/if}
	{#if keys.open}<KeysPanel />{/if}
</Tooltip.Provider>
