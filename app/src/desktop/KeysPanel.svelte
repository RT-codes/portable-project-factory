<script lang="ts">
	import KeyboardIcon from '@lucide/svelte/icons/keyboard'
	import ResetIcon from '@lucide/svelte/icons/rotate-ccw'
	import SearchIcon from '@lucide/svelte/icons/search'
	import { onMount } from 'svelte'
	import { Button } from '$lib/components/ui/button/index.js'
	import { cn } from '$lib/utils'
	import { ACTIONS, comboOf, keys, type Action, type SetResult } from './keys.svelte'

	// The keyboard shortcuts, floating over the app: every action with the keys it has, a search, and per action a
	// button that waits for the next key press and makes it the shortcut. A click outside or Escape closes it.
	let query = $state('')
	/** what the last change did, or why it was refused */
	let notice = $state<{ text: string; bad: boolean } | null>(null)
	let panel = $state<HTMLElement | null>(null)
	let field = $state<HTMLInputElement | null>(null)

	const kbd = 'rounded border bg-muted px-1.5 py-px font-mono text-[0.6875rem] leading-4 text-foreground'

	const groups = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const out: { name: string; actions: Action[] }[] = []
		for (const action of ACTIONS) {
			const text = `${action.label} ${action.group} ${keys.parts(keys.binding(action.id)).join('+')}`.toLowerCase()
			if (!words.every((w) => text.includes(w))) continue
			const group = out.find((g) => g.name === action.group)
			if (group) group.actions.push(action)
			else out.push({ name: action.group, actions: [action] })
		}
		return out
	})

	onMount(() => {
		// focus returns to where it was when the panel closes
		const before = document.activeElement
		field?.focus()
		return () => {
			keys.listening = null
			if (before instanceof HTMLElement && before.isConnected) before.focus()
		}
	})

	function close() {
		keys.open = false
	}

	function report(action: Action, result: SetResult) {
		if (!result.ok) notice = { text: result.why, bad: true }
		else if (result.took) notice = { text: `"${result.took.label}" used those keys and has none now.`, bad: true }
		else notice = { text: `"${action.label}" is now ${keys.text(action.id) || 'not set'}.`, bad: false }
	}

	function onkeydown(e: KeyboardEvent) {
		const plainEscape = e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
		if (keys.listening) {
			// every key belongs to the shortcut being recorded; Escape gives up
			e.preventDefault()
			e.stopPropagation()
			if (plainEscape) {
				keys.listening = null
				return
			}
			const combo = comboOf(e)
			const action = ACTIONS.find((a) => a.id === keys.listening)
			if (!combo || !action) return
			const result = keys.set(action.id, combo)
			report(action, result)
			if (result.ok) keys.listening = null
			return
		}
		if (plainEscape) {
			e.preventDefault()
			e.stopPropagation()
			close()
		} else if (e.key === 'Tab' && panel) {
			// Tab stays in the panel
			const stops = [...panel.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
			const [first, last] = [stops[0], stops.at(-1)]
			const at = document.activeElement
			if (!panel.contains(at) || (e.shiftKey ? at === first : at === last)) {
				e.preventDefault()
				;(e.shiftKey ? last : first)?.focus()
			}
		}
	}

	function listen(action: Action, button: HTMLElement) {
		notice = null
		keys.listening = keys.listening === action.id ? null : action.id
		// the button holds the focus while it waits: leaving it (a click elsewhere) stops the wait
		button.focus()
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="fixed inset-0 z-50 bg-background/55" data-keys-backdrop onpointerdown={close} aria-hidden="true"></div>
<div
	bind:this={panel}
	role="dialog"
	aria-modal="true"
	aria-label="Keyboard shortcuts"
	class="fixed top-[54%] left-1/2 z-50 flex h-[min(34rem,calc(100svh-5rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-float"
>
	<div class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
		<label class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
			<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
			<input bind:this={field} bind:value={query} type="search" placeholder="Search shortcuts: an action or its keys" aria-label="Search shortcuts" class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden" />
		</label>
		<span class="shrink-0 text-[0.6875rem] text-muted-foreground"><kbd class={kbd}>Esc</kbd> to close</span>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto pb-2" data-keys-list>
		{#each groups as group (group.name)}
			<section aria-label={group.name}>
				<h2 class="px-4 pt-3 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{group.name}</h2>
				<ul>
					{#each group.actions as action (action.id)}
						{@const parts = keys.parts(keys.binding(action.id))}
						{@const listening = keys.listening === action.id}
						<li class={cn('flex h-9 items-center gap-2 px-4 text-sm hover:bg-accent/40', listening && 'bg-accent/60 hover:bg-accent/60')} data-action={action.id}>
							<span class="min-w-0 flex-1 truncate">{action.label}</span>
							<span class="flex shrink-0 items-center gap-1" data-keys aria-label={listening ? 'Waiting for keys' : parts.length ? parts.join('+') : 'Not set'}>
								{#if listening}
									<span class="animate-pulse text-xs text-glow">Press the new keys…</span>
								{:else if parts.length}
									{#each parts as part, i (i)}<kbd class={kbd}>{part}</kbd>{/each}
								{:else}
									<span class="text-xs text-muted-foreground/70">Not set</span>
								{/if}
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								class={cn('text-muted-foreground', (!keys.changed(action.id) || listening) && 'invisible')}
								onclick={() => report(action, keys.reset(action.id))}
								aria-label="Reset {action.label} to its default"
								title="Back to the default"
							>
								<ResetIcon />
							</Button>
							{#if action.fixed}
								<span class="w-20 shrink-0 text-center text-[0.6875rem] text-muted-foreground/70" title="Set by the app's menu">fixed</span>
							{:else}
								<Button
									variant="outline"
									size="xs"
									class={cn('w-20 shrink-0', listening && 'border-ring ring-3 ring-ring/30')}
									aria-pressed={listening}
									aria-label="{listening ? 'Stop changing' : 'Change'} the keys of {action.label}"
									onclick={(e) => listen(action, e.currentTarget as HTMLElement)}
									onblur={() => listening && (keys.listening = null)}
								>
									{#if listening}Cancel{:else}<KeyboardIcon />Change{/if}
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="px-4 py-10 text-center text-sm text-muted-foreground">No shortcut matches "{query}".</p>
		{/each}
	</div>

	<div class="flex h-10 shrink-0 items-center gap-2 border-t ps-4 pe-2 text-[0.6875rem] text-muted-foreground">
		<p class={cn('min-w-0 flex-1 truncate', notice?.bad && 'text-tone-amber')} role="status" title={notice?.text}>
			{notice?.text ?? 'Change, then press the keys you want. Esc gives up.'}
		</p>
		<Button variant="ghost" size="xs" disabled={!keys.customised} onclick={() => (keys.resetAll(), (notice = { text: 'Every shortcut is back to its default.', bad: false }))}>
			<ResetIcon />Reset all
		</Button>
	</div>
</div>
