<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
	import ChevronsDownIcon from '@lucide/svelte/icons/chevrons-down'
	import ChevronsUpIcon from '@lucide/svelte/icons/chevrons-up'
	import FileCodeIcon from '@lucide/svelte/icons/file-code'
	import MessageSquareIcon from '@lucide/svelte/icons/message-square'
	import PlusIcon from '@lucide/svelte/icons/plus'
	import UnfoldVerticalIcon from '@lucide/svelte/icons/unfold-vertical'
	import { untrack } from 'svelte'
	import type { DiffFile, DraftComment, Side } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import * as Tooltip from '$lib/components/ui/tooltip/index.js'
	import { cn } from '$lib/utils'
	import { api } from '../api'
	import { appearance } from '../appearance.svelte'
	import { anchorKey, anchorOf, EXPAND_STEP, isGenerated, splitRows, unifiedRows, type Expanded, type GapRow, type LineRow } from '../lib/diff'
	import { lineHtml, tokenize, type Tok } from '../lib/highlight'
	import { STATUS_LETTER, STATUS_TONE, type ReviewHooks } from '../lib/review'
	import { basename, dirname } from '../lib/tree'
	import Composer from './Composer.svelte'
	import Markdown from './Markdown.svelte'
	import ThreadView from './ThreadView.svelte'

	// One file of a diff: a header that sticks while its lines scroll, then the lines, unified or side by side,
	// with review threads and pending comments under the lines they belong to.
	let {
		project,
		base,
		head,
		file,
		split,
		viewed,
		hooks,
		now,
		onviewed,
		onopen,
	}: {
		project: string
		/** revisions the old and new side are read from */
		base: string
		head: string
		file: DiffFile
		split: boolean
		viewed: boolean
		hooks: ReviewHooks | null
		now: number
		onviewed: (viewed: boolean) => void
		/** open the file in the code view */
		onopen: (path: string) => void
	} = $props()

	let root = $state<HTMLElement | null>(null)
	/** has been near the viewport: its lines are only built from then on */
	let seen = $state(false)
	// svelte-ignore state_referenced_locally -- the starting state only; from here on the header's toggle decides
	let folded = $state(viewed || isGenerated(file.path))
	let expanded = $state<Expanded>({})
	let oldToks = $state<Tok[][] | null>(null)
	let newToks = $state<Tok[][] | null>(null)
	let newLines = $state<string[] | null>(null)
	let composing = $state<string | null>(null)
	let editing = $state<DraftComment | null>(null)

	$effect(() => {
		if (!root) return
		// measured against the list the file scrolls in, so files are ready a screen or two before they are reached
		const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && ((seen = true), io.disconnect()), {
			root: root.closest('[data-scroller]'),
			rootMargin: '1500px 0px',
		})
		io.observe(root)
		return () => io.disconnect()
	})

	// marking a file as viewed folds it; unmarking opens it again
	let wasViewed = untrack(() => viewed)
	$effect(() => {
		if (viewed !== wasViewed) {
			wasViewed = viewed
			folded = viewed
		}
	})

	// both sides of the file, for colours and for opening the unchanged stretches
	$effect(() => {
		if (!seen || folded || file.binary || file.tooLarge) return
		const syntax = appearance.current.syntax
		let current = true
		const oldPath = file.oldPath ?? file.path
		if (file.status !== 'added')
			api.file(project, base, oldPath).then(async (c) => {
				const toks = c.text === null ? null : await tokenize(`${base}:${oldPath}`, oldPath, c.text, syntax)
				if (current) oldToks = toks
			}, () => {})
		if (file.status !== 'deleted')
			api.file(project, head, file.path).then(async (c) => {
				if (c.text === null) return
				if (current) newLines = c.text.split('\n')
				// the checkout changes under us: its key carries the content's size so a stale colouring is not reused
				const toks = await tokenize(`${head}:${file.path}:${c.size}`, file.path, c.text, syntax)
				if (current) newToks = toks
			}, () => {})
		return () => (current = false)
	})

	const rows = $derived(seen && !folded ? unifiedRows(file, expanded, newLines) : [])
	const pairs = $derived(split ? splitRows(rows) : [])

	const threads = $derived(hooks?.threads.filter((t) => t.path === file.path) ?? [])
	const drafts = $derived(hooks?.drafts.filter((d) => d.path === file.path) ?? [])
	const present = $derived.by(() => {
		const keys = new Set<string>()
		for (const r of rows) {
			if (r.type !== 'line') continue
			if (r.line.new !== null) keys.add(anchorKey('RIGHT', r.line.new))
			if (r.line.old !== null) keys.add(anchorKey('LEFT', r.line.old))
		}
		return keys
	})
	function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
		const map = new Map<string, T[]>()
		for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item])
		return map
	}
	const threadsAt = $derived(groupBy(threads.filter((t) => t.line !== null), (t) => anchorKey(t.side, t.line!)))
	const draftsAt = $derived(groupBy(drafts, (d) => anchorKey(d.side, d.line)))
	/** threads whose line is not in what is shown: outdated, or on a line the diff no longer has */
	const adrift = $derived(threads.filter((t) => t.line === null || !present.has(anchorKey(t.side, t.line))))
	const commentCount = $derived(threads.length + drafts.length)

	/** The anchors a row can carry comments on. A context line is both an old and a new line. */
	function keysOf(row: LineRow): string[] {
		const { line } = row
		if (line.kind === 'add') return [anchorKey('RIGHT', line.new!)]
		if (line.kind === 'del') return [anchorKey('LEFT', line.old!)]
		return [anchorKey('RIGHT', line.new!), anchorKey('LEFT', line.old!)]
	}
	const hasBlock = (key: string) => threadsAt.has(key) || draftsAt.has(key) || composing === key

	function html(row: LineRow): string {
		const { line } = row
		const toks = line.kind === 'del' ? oldToks?.[line.old! - 1] : newToks?.[line.new! - 1]
		// colours only when they are for this exact text (the file on disk may have moved on since the diff)
		const ok = toks && toks.reduce((n, t) => n + t.t.length, 0) === line.text.length
		return lineHtml(ok ? toks : null, line.text, row.mark)
	}

	function compose(row: LineRow) {
		const a = anchorOf(row.line)
		composing = anchorKey(a.side, a.line)
		editing = null
	}

	function expand(gap: GapRow, where: 'top' | 'bottom' | 'all') {
		const cur = expanded[gap.id] ?? { top: 0, bottom: 0 }
		if (where === 'all') expanded[gap.id] = { top: cur.top + gap.count, bottom: cur.bottom }
		else expanded[gap.id] = { ...cur, [where]: cur[where] + EXPAND_STEP }
	}

	const sign = { add: '+', del: '-', ctx: ' ' } as const
	const rowTone = { add: 'diff-add', del: 'diff-del', ctx: '' } as const
</script>

<section bind:this={root} class="scroll-mt-4 rounded-xl border bg-card" data-file={file.path}>
	<header class={cn('sticky top-0 z-10 flex h-10 items-center gap-2 rounded-t-xl border-b bg-card px-2', folded && 'rounded-b-xl border-b-transparent')}>
		<Button variant="ghost" size="icon-xs" onclick={() => (folded = !folded)} aria-label={folded ? 'Show the diff' : 'Hide the diff'} aria-expanded={!folded}>
			{#if folded}<ChevronRightIcon />{:else}<ChevronDownIcon />{/if}
		</Button>
		<span class={cn('w-3 shrink-0 text-center font-mono text-xs font-semibold', STATUS_TONE[file.status])} title={file.status}>{STATUS_LETTER[file.status]}</span>
		<h3 class="flex min-w-0 items-baseline font-mono text-xs" title={file.path}>
			{#if file.oldPath}<span class="truncate text-muted-foreground">{file.oldPath}</span><span class="mx-1.5 shrink-0 text-muted-foreground">→</span>{/if}
			{#if dirname(file.path)}<span class="truncate text-muted-foreground">{dirname(file.path)}/</span>{/if}
			<span class="shrink-0 font-medium">{basename(file.path)}</span>
		</h3>
		<span class="shrink-0 font-mono text-[0.6875rem] tabular-nums">
			{#if file.additions}<span class="text-tone-green">+{file.additions}</span>{/if}
			{#if file.deletions}<span class="ms-1 text-tone-rose">-{file.deletions}</span>{/if}
		</span>
		{#if commentCount > 0}
			<span class="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums"><MessageSquareIcon class="size-3" />{commentCount}</span>
		{/if}
		<div class="ms-auto flex shrink-0 items-center gap-1">
			{#if file.status !== 'deleted'}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-xs" onclick={() => onopen(file.path)} aria-label="Open the whole file"><FileCodeIcon /></Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Open the whole file</Tooltip.Content>
				</Tooltip.Root>
			{/if}
			<label class={cn('flex h-6 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs select-none', viewed ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
				<input type="checkbox" class="size-3 accent-primary" checked={viewed} onchange={(e) => onviewed(e.currentTarget.checked)} />
				Viewed
			</label>
		</div>
	</header>

	{#if !folded}
		{#if file.binary}
			<p class="px-4 py-6 text-center text-sm text-muted-foreground">Binary file, not shown.</p>
		{:else if file.tooLarge}
			<p class="px-4 py-6 text-center text-sm text-muted-foreground">This diff is too large to show ({file.additions + file.deletions} changed lines).</p>
		{:else if file.hunks.length === 0}
			<p class="px-4 py-6 text-center text-sm text-muted-foreground">
				{file.status === 'renamed' ? 'Renamed without changes.' : file.status === 'added' ? 'Empty file.' : 'No changes to its text (mode or type only).'}
			</p>
		{:else if !seen}
			<!-- room for the lines to come, so the scrollbar does not jump as files fill in -->
			<div style:height="{Math.min(file.additions + file.deletions + file.hunks.length * 6, 400) * 20}px"></div>
		{:else}
			<div class="overflow-hidden rounded-b-xl">
				{#if adrift.length > 0 && hooks}
					<div class="space-y-2 border-b bg-background/60 p-3">
						<p class="text-xs text-muted-foreground">On lines this diff no longer shows</p>
						{#each adrift as t (t.id)}
							<ThreadView thread={t} {hooks} {now} label={t.outdated ? 'outdated' : undefined} />
						{/each}
					</div>
				{/if}
				{#if split}
					{#each pairs as row, i (i)}
						{#if row.type === 'pair'}
							<div class="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]">
								{@render half(row.left, 'old')}
								{@render half(row.right, 'new')}
							</div>
							{#each new Set([...(row.left ? keysOf(row.left) : []), ...(row.right ? keysOf(row.right) : [])]) as key (key)}
								{@render block(key)}
							{/each}
						{:else if row.type === 'gap'}
							{@render gapRow(row)}
						{:else}
							{@render hunkRow(row.section)}
						{/if}
					{/each}
				{:else}
					{#each rows as row, i (i)}
						{#if row.type === 'line'}
							<div class={cn('group/line grid grid-cols-[3rem_3rem_minmax(0,1fr)]', rowTone[row.line.kind])} data-anchor={keysOf(row)[0]}>
								<span class="num px-2 text-right font-mono text-[0.6875rem] leading-[calc(var(--code-size)+8px)] text-muted-foreground/70 tabular-nums select-none">{row.line.old ?? ''}</span>
								<span class="num px-2 text-right font-mono text-[0.6875rem] leading-[calc(var(--code-size)+8px)] text-muted-foreground/70 tabular-nums select-none">{row.line.new ?? ''}</span>
								{@render code(row)}
							</div>
							{#each keysOf(row) as key (key)}
								{@render block(key)}
							{/each}
						{:else if row.type === 'gap'}
							{@render gapRow(row)}
						{:else}
							{@render hunkRow(row.section)}
						{/if}
					{/each}
				{/if}
			</div>
		{/if}
	{/if}
</section>

{#snippet code(row: LineRow)}
	<span class="code relative flex min-w-0 ps-1">
		{#if hooks && row.inHunk}
			<button
				type="button"
				class="absolute start-0.5 top-0 z-[1] grid size-5 scale-90 place-items-center rounded bg-primary text-primary-foreground opacity-0 shadow-sm transition-opacity group-hover/line:opacity-100 hover:scale-100 focus-visible:opacity-100"
				aria-label="Comment on this line"
				onclick={() => compose(row)}
			>
				<PlusIcon class="size-3.5" />
			</button>
		{/if}
		<span class="w-4 shrink-0 text-center text-muted-foreground/70 select-none">{sign[row.line.kind]}</span>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- lineHtml escapes the text -->
		<span class="min-w-0 flex-1 pe-3 [overflow-wrap:anywhere] whitespace-pre-wrap">{@html html(row)}</span>
	</span>
{/snippet}

{#snippet half(row: LineRow | null, side: 'old' | 'new')}
	{#if row}
		{@const tone = row.line.kind === 'ctx' ? '' : rowTone[row.line.kind]}
		<span class={cn('num px-2 text-right font-mono text-[0.6875rem] leading-[calc(var(--code-size)+8px)] text-muted-foreground/70 tabular-nums select-none', tone, side === 'new' && 'border-s')}>
			{side === 'old' ? (row.line.old ?? '') : (row.line.new ?? '')}
		</span>
		<span class={cn('group/line min-w-0', tone)} data-anchor={row.line.kind === 'ctx' ? keysOf(row)[side === 'new' ? 0 : 1] : keysOf(row)[0]}>{@render code(row)}</span>
	{:else}
		<span class={cn('bg-muted/40', side === 'new' && 'border-s')}></span>
		<span class="bg-muted/40"></span>
	{/if}
{/snippet}

{#snippet hunkRow(section: string)}
	<div class="truncate border-y border-border/60 bg-muted/40 px-3 font-mono text-[0.6875rem] leading-6 text-muted-foreground first:border-t-0">{section}</div>
{/snippet}

{#snippet gapRow(gap: GapRow)}
	<div class="flex h-7 items-center gap-1 border-y border-border/60 bg-muted/40 px-1.5 text-xs text-muted-foreground first:border-t-0 last:border-b-0">
		{#if newLines}
			{#if gap.above && gap.count > EXPAND_STEP}
				<Button variant="ghost" size="icon-xs" onclick={() => expand(gap, 'top')} aria-label="Show {EXPAND_STEP} more lines below"><ChevronsDownIcon /></Button>
			{/if}
			{#if gap.below && gap.count > EXPAND_STEP}
				<Button variant="ghost" size="icon-xs" onclick={() => expand(gap, 'bottom')} aria-label="Show {EXPAND_STEP} more lines above"><ChevronsUpIcon /></Button>
			{/if}
			<Button variant="ghost" size="xs" class="font-normal" onclick={() => expand(gap, 'all')}>
				<UnfoldVerticalIcon />Show {gap.count} unchanged {gap.count === 1 ? 'line' : 'lines'}
			</Button>
		{:else}
			<span class="px-2">{gap.count} unchanged {gap.count === 1 ? 'line' : 'lines'}</span>
		{/if}
	</div>
{/snippet}

{#snippet block(key: string)}
	{#if hooks && hasBlock(key)}
		{@const [side, n] = key.split(':') as [Side, string]}
		<div class="border-y border-border/60 bg-background/70 px-3 py-3 font-sans">
			<div class="max-w-3xl space-y-2">
				{#each threadsAt.get(key) ?? [] as t (t.id)}
					<ThreadView thread={t} {hooks} {now} />
				{/each}
				{#each draftsAt.get(key) ?? [] as d (d)}
					{#if editing === d}
						<Composer value={d.body} submitLabel="Save" autofocus oncancel={() => (editing = null)} onsubmit={(text) => {
								hooks.updateDraft(d, text)
								editing = null
							}} />
					{:else}
						<div class="rounded-lg border border-tone-amber/40 bg-card p-3" data-draft>
							<div class="mb-1.5 flex items-center gap-2 text-xs">
								<span class="rounded-full bg-tone-amber/15 px-2 py-0.5 font-medium text-tone-amber">Pending</span>
								<span class="text-muted-foreground">Sent when you submit your review</span>
								<span class="ms-auto flex gap-1">
									<Button variant="ghost" size="xs" onclick={() => (editing = d)}>Edit</Button>
									<Button variant="ghost" size="xs" onclick={() => hooks.removeDraft(d)}>Delete</Button>
								</span>
							</div>
							<Markdown text={d.body} />
						</div>
					{/if}
				{/each}
				{#if composing === key}
					<Composer
						placeholder="Comment on line {n}"
						submitLabel="Add to review"
						autofocus
						oncancel={() => (composing = null)}
						onsubmit={(text) => {
							hooks.addDraft({ path: file.path, line: Number(n), side, body: text })
							composing = null
						}}
					/>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}
