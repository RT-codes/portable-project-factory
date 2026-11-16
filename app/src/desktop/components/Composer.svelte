<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import type { Snippet } from 'svelte'
	import { Button } from '$lib/components/ui/button/index.js'
	import { cn } from '$lib/utils'
	import { message } from '../api'
	import { keys } from '../keys.svelte'

	// A comment box. Ctrl/Cmd+Enter submits, Escape cancels. `onsubmit` may be async: the box stays busy and
	// shows what went wrong if it fails, keeping the text.
	let {
		value = $bindable(''),
		placeholder = 'Leave a comment',
		submitLabel = 'Comment',
		rows = 3,
		autofocus = false,
		allowEmpty = false,
		onsubmit,
		oncancel,
		extra,
		class: className,
	}: {
		value?: string
		placeholder?: string
		submitLabel?: string
		rows?: number
		autofocus?: boolean
		allowEmpty?: boolean
		onsubmit: (text: string) => void | Promise<void>
		oncancel?: () => void
		/** more buttons, left of submit */
		extra?: Snippet<[{ busy: boolean; text: string }]>
		class?: string
	} = $props()

	let busy = $state(false)
	let error = $state<string | null>(null)
	let area = $state<HTMLTextAreaElement | null>(null)

	$effect(() => {
		if (autofocus) area?.focus()
	})

	async function submit() {
		const text = value.trim()
		if (busy || (!text && !allowEmpty)) return
		busy = true
		error = null
		try {
			await onsubmit(text)
			value = ''
		} catch (e) {
			error = message(e)
		} finally {
			busy = false
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (keys.is('comment.send', e)) {
			e.preventDefault()
			void submit()
		} else if (e.key === 'Escape' && oncancel) {
			e.preventDefault()
			e.stopPropagation()
			oncancel()
		}
	}
</script>

<div class={cn('rounded-lg border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30', className)}>
	<textarea
		bind:this={area}
		bind:value
		{rows}
		{placeholder}
		{onkeydown}
		disabled={busy}
		class="block field-sizing-content max-h-80 min-h-16 w-full resize-none bg-transparent px-3 py-2 font-sans text-sm outline-none placeholder:text-muted-foreground/70"
	></textarea>
	<div class="flex items-center gap-2 px-2 pb-2">
		{#if error}
			<p class="min-w-0 flex-1 truncate ps-1 text-xs text-destructive" title={error}>{error}</p>
		{:else}
			<p class="min-w-0 flex-1 truncate ps-1 text-[0.6875rem] text-muted-foreground/70">Markdown{keys.text('comment.send') ? ` · ${keys.text('comment.send')} to send` : ''}</p>
		{/if}
		{#if oncancel}
			<Button variant="ghost" size="xs" onclick={oncancel} disabled={busy}>Cancel</Button>
		{/if}
		{@render extra?.({ busy, text: value.trim() })}
		<Button size="xs" onclick={submit} disabled={busy || (!value.trim() && !allowEmpty)}>
			{#if busy}<LoaderIcon class="animate-spin" />{/if}{submitLabel}
		</Button>
	</div>
</div>
