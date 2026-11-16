<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import { readFile } from '$lib/factory.svelte'
	import { renderMarkdown } from '$lib/markdown'
	import { verdictOf } from '$lib/format'
	import { cn } from '$lib/utils'

	// One file from a ticket's folder. It reloads when the file changes on disk (its mtime), so a stage writing its
	// output shows up while you watch.
	let { job, path, mtime, showVerdict = true }: { job: string; path: string; mtime: number; showVerdict?: boolean } = $props()

	let text = $state<string | null>(null)
	let error = $state<string | null>(null)

	$effect(() => {
		const key = `${job}/${path}@${mtime}`
		let current = true
		error = null
		readFile(job, path)
			.then((t) => current && (text = t))
			.catch((e) => current && (error = String(e)))
		return () => {
			current = false
			void key
		}
	})

	const verdictTone: Record<string, string> = {
		PASS: 'bg-tone-green/15 text-tone-green',
		READY: 'bg-tone-green/15 text-tone-green',
		FAIL: 'bg-destructive/15 text-destructive',
		CHANGES: 'bg-tone-amber/15 text-tone-amber',
		BLOCKED: 'bg-tone-amber/15 text-tone-amber',
	}
	const isMarkdown = $derived(path.endsWith('.md'))
	const verdict = $derived(text && isMarkdown ? verdictOf(text) : '')
	const badge = $derived(showVerdict && verdict in verdictTone)
	// With the badge shown, the verdict line itself is not repeated; a reason after it ("BLOCKED - why") is kept.
	const body = $derived.by(() => {
		if (!text || !badge) return text ?? ''
		const lines = text.split('\n')
		const i = lines.findIndex((l) => l.trim() !== '')
		const rest = lines[i]
			.replace(/^[#>*\s]+/, '')
			.replace(/^(STATUS|VERDICT|RESULT)\s*:\s*/i, '')
			.replace(/^[A-Za-z][A-Za-z_-]*/, '')
			.replace(/^[\s:\-\u2013\u2014]+/, '')
		lines.splice(i, 1, ...(rest ? [rest] : []))
		return lines.join('\n')
	})
</script>

{#if error}
	<p class="text-sm text-destructive">Could not read {path}: {error}</p>
{:else if text === null}
	<p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
{:else if isMarkdown}
	{#if badge}
		<span class={cn('mb-3 inline-flex h-5 items-center rounded-full px-2 font-mono text-[0.6875rem] font-medium', verdictTone[verdict])}>{verdict}</span>
	{/if}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
	<div class="md">{@html renderMarkdown(body)}</div>
{:else}
	<pre class="overflow-x-auto rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
{/if}
