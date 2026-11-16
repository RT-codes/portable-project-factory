<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
	import { cn } from '$lib/utils'

	// A dropdown: the whole field is the button, with an arrow that is always there. A click anywhere on it
	// opens the list; arrows, Enter and Escape work it from the keyboard. Each option may carry a second line.
	export interface Option {
		value: string
		label: string
		/** shown smaller, after the label: the exact model id, say */
		detail?: string | null
		/** a second line: what the option is for */
		note?: string | null
	}

	let {
		options,
		value,
		label,
		onchange,
		class: className,
	}: {
		options: Option[]
		value: string
		/** what the field is, for screen readers ("Model of the planner on Claude Code") */
		label: string
		onchange: (value: string) => void
		class?: string
	} = $props()

	let open = $state(false)
	let active = $state(0)
	let root = $state<HTMLElement | null>(null)
	let list = $state<HTMLElement | null>(null)
	/** opens upwards when there is no room below */
	let up = $state(false)

	// a value that is not in the list (a model typed by hand) is shown as it is
	const current = $derived(options.find((o) => o.value === value) ?? { value, label: value, detail: 'custom' })

	function toggle(next = !open) {
		open = next
		if (!open) return
		active = Math.max(0, options.findIndex((o) => o.value === value))
		const box = root!.getBoundingClientRect()
		const room = (root!.closest('[data-pane]') ?? document.body).getBoundingClientRect().bottom - box.bottom
		// downwards unless there is hardly any room there and more above
		up = room < Math.min(220, options.length * 44 + 16) && box.top > room
		requestAnimationFrame(() => list?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
	}

	function pick(option: Option) {
		open = false
		if (option.value !== value) onchange(option.value)
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault()
				toggle(true)
			}
			return
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			open = false
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			active = (active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
			requestAnimationFrame(() => list?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			pick(options[active])
		} else if (e.key === 'Tab') open = false
	}
</script>

<svelte:window onpointerdown={(e) => open && !root?.contains(e.target as Node) && (open = false)} />

<div bind:this={root} class={cn('relative min-w-0', className)}>
	<button
		type="button"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? 'select-list' : undefined}
		aria-label="{label}: {current.label}"
		class={cn(
			'flex h-9 w-full items-center gap-2 rounded-md border bg-background ps-2.5 pe-2 text-left text-sm transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none',
			open && 'border-ring ring-3 ring-ring/30'
		)}
		onclick={() => toggle()}
		{onkeydown}
	>
		<span class="min-w-0 flex-1 truncate">
			<span class="font-medium">{current.label}</span>
			{#if current.detail}<span class="ms-1.5 font-mono text-xs text-muted-foreground">{current.detail}</span>{/if}
		</span>
		<ChevronDownIcon class={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
	</button>
	{#if open}
		<ul
			bind:this={list}
			id="select-list"
			role="listbox"
			aria-label={label}
			class={cn('absolute z-40 max-h-80 w-full min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-float', up ? 'bottom-full mb-1' : 'top-full mt-1')}
		>
			{#each options as o, i (o.value)}
				<!-- svelte-ignore a11y_click_events_have_key_events -- the keys are handled by the field above, which keeps the focus -->
				<li
					role="option"
					aria-selected={o.value === value}
					data-active={i === active}
					class={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-accent text-accent-foreground')}
					onpointerenter={() => (active = i)}
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => pick(o)}
				>
					<CheckIcon class={cn('mt-0.5 size-3.5 shrink-0 text-glow', o.value !== value && 'invisible')} />
					<span class="min-w-0 flex-1">
						<span class="flex flex-wrap items-baseline gap-x-1.5">
							<span class="font-medium">{o.label}</span>
							{#if o.detail}<span class="font-mono text-[0.6875rem] text-muted-foreground">{o.detail}</span>{/if}
						</span>
						{#if o.note}<span class="block text-xs text-muted-foreground">{o.note}</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
