<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down'
	import { tick } from 'svelte'
	import type { Live } from '$lib/types'
	import { stepTone } from '$lib/live'
	import { cn } from '$lib/utils'
	import StepIcon from './StepIcon.svelte'

	// What a stage's agent has been doing, step by step, newest last. It follows the newest step for as long as the
	// reader stays at the bottom, and stops following when they scroll up to read.
	let { live }: { live: Live } = $props()

	let box = $state<HTMLElement | null>(null)
	let stick = $state(true)
	const key = (i: number) => `${live.steps[i].at ?? ''}|${live.steps[i].text}|${i}`
	const newest = $derived(live.steps.length ? key(live.steps.length - 1) : '')

	function onscroll() {
		if (box) stick = box.scrollHeight - box.scrollTop - box.clientHeight < 24
	}
	$effect(() => {
		void newest
		if (stick) void tick().then(() => box?.scrollTo({ top: box.scrollHeight }))
	})

	const clock = (at: string | null) => (at ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '')
</script>

<div class="relative min-h-0 flex-1">
	<div bind:this={box} {onscroll} class="h-full overflow-y-auto px-5 py-4" data-feed>
		{#if live.steps.length === 0}
			<p class="flex items-center gap-2 text-sm text-muted-foreground">
				{#if live.state === 'running'}
					<span class="size-1.5 animate-pulse rounded-full bg-primary"></span>Waiting for the first step…
				{:else}
					Nothing to show: this stage has not logged a step.
				{/if}
			</p>
		{:else}
			<ol class="space-y-0.5 font-mono text-xs leading-relaxed">
				{#each live.steps as s, i (key(i))}
					{@const last = i === live.steps.length - 1}
					<li class={cn('flex items-start gap-2 rounded px-1.5 py-1', last && live.state === 'running' && 'bg-primary/10')} data-step-kind={s.kind}>
						<span class="w-16 shrink-0 text-muted-foreground/60 tabular-nums">{clock(s.at)}</span>
						<StepIcon kind={s.kind} class={cn('mt-0.5 size-3.5 shrink-0', stepTone[s.kind])} />
						<span class="min-w-0 flex-1">
							<span class={cn('[overflow-wrap:anywhere]', s.kind === 'think' && 'text-tone-violet/90 italic', s.kind === 'say' && 'font-sans text-[0.8125rem]')}>{s.text}</span>
							{#if s.detail}<span class="block [overflow-wrap:anywhere] text-muted-foreground">{s.detail}</span>{/if}
						</span>
						{#if last && live.state === 'running'}<span class="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-primary"></span>{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
	{#if !stick}
		<button
			type="button"
			class="absolute bottom-3 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border bg-popover/90 px-3 text-xs font-medium shadow-sm backdrop-blur hover:bg-accent"
			onclick={() => ((stick = true), box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }))}
		>
			<ArrowDownIcon class="size-3" />Latest
		</button>
	{/if}
</div>
