<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import DownloadIcon from '@lucide/svelte/icons/download'
	import UploadIcon from '@lucide/svelte/icons/upload'
	import MoonIcon from '@lucide/svelte/icons/moon'
	import PaletteIcon from '@lucide/svelte/icons/palette'
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
	import SunIcon from '@lucide/svelte/icons/sun'
	import Trash2Icon from '@lucide/svelte/icons/trash-2'
	import type { Snippet } from 'svelte'
	import { Button } from '$lib/components/ui/button/index.js'
	import { cn } from '$lib/utils'
	import { message } from '../api'
	import { appearance, BUILTIN, CORNERS, COLOR_GROUPS, CUT_SHAPES, type Corner, type Theme } from '../appearance.svelte'
	import { lineHtml, SYNTAX_THEMES, tokenize, type Tok } from '../lib/highlight'

	// Appearance: pick a theme, change its colours, borders, corners, cutouts and fonts, and keep the result as a
	// theme of your own. Every change shows at once, on the whole app and in the sample on the right; it stays a
	// draft until it is saved. Themes travel as JSON files (export, import).
	const theme = $derived(appearance.current)

	let naming = $state(false)
	let newName = $state('')
	let confirmDelete = $state<string | null>(null)
	let confirmReset = $state<string | null>(null)
	/** a theme picked while there are unsaved changes: switching would lose them, so it asks first */
	let switchTo = $state<string | null>(null)
	let fileError = $state<string | null>(null)
	let picker = $state<HTMLInputElement | null>(null)

	function pick(id: string) {
		if (id === appearance.activeId && !appearance.dirty) return
		if (appearance.dirty) switchTo = id
		else appearance.select(id)
	}

	function exportTheme() {
		const url = URL.createObjectURL(new Blob([appearance.export()], { type: 'application/json' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}.factory-theme.json`
		link.click()
		URL.revokeObjectURL(url)
	}

	async function importTheme(file: File | undefined) {
		if (!file) return
		fileError = null
		try {
			if (file.size > 200_000) throw new Error('That file is too large to be a theme.')
			appearance.import(await file.text())
		} catch (e) {
			fileError = message(e)
		} finally {
			if (picker) picker.value = ''
		}
	}

	const cornerName: Record<Corner, string> = { tl: 'Top left', tr: 'Top right', br: 'Bottom right', bl: 'Bottom left' }
	const cornerAt: Record<Corner, string> = { tl: 'top-0 left-0', tr: 'top-0 right-0', br: 'right-0 bottom-0', bl: 'bottom-0 left-0' }

	function startSaveAs() {
		newName = appearance.isBuiltin ? '' : `${appearance.active.name} copy`
		naming = true
	}
	function saveAs() {
		if (!newName.trim()) return
		appearance.saveAs(newName)
		naming = false
	}

	const builtinIds = new Set(BUILTIN.map((t) => t.id))
	const swatch = (t: Theme) => ['background', 'card', 'primary', 'foreground'].map((key) => appearance.colorOf(t, key))

	// ---- the sample: a piece of a diff, coloured as the code views colour it
	const sample = ['export function total(lines: Line[], discount?: Discount): Cents {', '  const net = subtotal(lines, discount)', '  return net + vat(net) // VAT comes last', '}']
	const removed = '  return subtotal(lines) + vat(lines)'
	const rows = [
		{ kind: 'ctx', old: 18, new: 18, at: 0 },
		{ kind: 'del', old: 19, new: null, at: -1 },
		{ kind: 'add', old: null, new: 19, at: 1 },
		{ kind: 'add', old: null, new: 20, at: 2 },
		{ kind: 'ctx', old: 20, new: 21, at: 3 },
	] as const
	let toks = $state<{ lines: Tok[][] | null; removed: Tok[][] | null }>({ lines: null, removed: null })
	$effect(() => {
		const syntax = theme.syntax
		let current = true
		Promise.all([tokenize('sample', 'sample.ts', sample.join('\n'), syntax), tokenize('sample-removed', 'sample.ts', removed, syntax)]).then(
			([lines, gone]) => current && (toks = { lines, removed: gone })
		)
		return () => (current = false)
	})
	const tone = { add: 'diff-add', del: 'diff-del', ctx: '' } as const
	const sign = { add: '+', del: '-', ctx: ' ' } as const

	const px = (rem: number) => Math.round(rem * theme.fontSize)
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<PaletteIcon class="size-4 shrink-0 text-muted-foreground" />
		<h1 class="shrink-0 text-[0.9375rem] font-semibold tracking-tight">Appearance</h1>
		<span class="min-w-0 truncate text-xs text-muted-foreground">
			{appearance.active.name}{#if appearance.dirty}<span class="ms-2 rounded-full bg-tone-amber/15 px-2 py-0.5 font-medium text-tone-amber">Unsaved changes</span>{/if}
		</span>
		<div class="relative ms-auto flex shrink-0 items-center gap-2">
			{#if appearance.dirty}
				<Button variant="ghost" size="sm" onclick={() => appearance.discard()}><RotateCcwIcon />Discard</Button>
				<Button variant="outline" size="sm" onclick={() => appearance.save()} title="Keep these changes in {appearance.active.name}">Save</Button>
			{/if}
			<Button size="sm" variant={appearance.dirty ? 'default' : 'outline'} onclick={startSaveAs} aria-expanded={naming}>Save as new theme</Button>
			{#if naming}
				<form
					class="absolute end-0 top-10 z-30 w-80 rounded-xl border bg-popover p-3 shadow-float"
					aria-label="Save as new theme"
					onsubmit={(e) => (e.preventDefault(), saveAs())}
				>
					<label class="text-sm font-medium" for="theme-name">Name the theme</label>
					<!-- svelte-ignore a11y_autofocus -- the form was just asked for -->
					<input
						id="theme-name"
						bind:value={newName}
						autofocus
						maxlength="60"
						placeholder="My theme"
						onkeydown={(e) => e.key === 'Escape' && (naming = false)}
						class="mt-2 h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
					/>
					<div class="mt-3 flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={() => (naming = false)}>Cancel</Button>
						<Button size="sm" type="submit" disabled={!newName.trim()}>Save theme</Button>
					</div>
				</form>
			{/if}
		</div>
	</header>

	<!-- side by side when the panel is wide enough, the themes above the editor when it is not -->
	<div class="flex min-h-0 flex-1 flex-col @3xl/pane:flex-row">
		<!-- the themes -->
		<aside class="flex max-h-64 w-full shrink-0 flex-col border-b @3xl/pane:max-h-none @3xl/pane:w-48 @3xl/pane:border-e @3xl/pane:border-b-0 @4xl/pane:w-60" aria-label="Themes">
			<h2 class="px-4 pt-4 pb-2 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Themes</h2>
			<ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
				{#each appearance.themes as t (t.id)}
					{@const active = t.id === appearance.activeId}
					<li class={cn('group/theme flex items-center rounded-md hover:bg-accent/60', active && 'bg-accent')}>
						<button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left" aria-pressed={active} onclick={() => pick(t.id)}>
							<span class="flex shrink-0 overflow-hidden rounded-md border" aria-hidden="true">
								{#each swatch(t) as c, i (i)}<span class="h-6 w-2.5" style:background={c}></span>{/each}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm">{t.name}</span>
								<span class="block text-[0.6875rem] text-muted-foreground">{builtinIds.has(t.id) ? (t.id in appearance.edited ? 'Built in · edited' : 'Built in') : t.dark ? 'Dark' : 'Light'}</span>
							</span>
							{#if active}<CheckIcon class="size-3.5 shrink-0 text-glow" />{/if}
						</button>
						{#if t.id in appearance.edited}
							<!-- a built-in theme with saved changes can always go back to how it shipped -->
							{#if confirmReset === t.id}
								<Button variant="destructive" size="xs" class="me-1" onclick={() => (appearance.reset(t.id), (confirmReset = null))} onblur={() => (confirmReset = null)}>Reset</Button>
							{:else}
								<Button variant="ghost" size="icon-xs" class="me-1 text-muted-foreground" aria-label="Reset {t.name}" title="Put {t.name} back as it shipped" onclick={() => (confirmReset = t.id)}><RotateCcwIcon /></Button>
							{/if}
						{:else if !builtinIds.has(t.id)}
							{#if confirmDelete === t.id}
								<Button variant="destructive" size="xs" class="me-1" onclick={() => (appearance.remove(t.id), (confirmDelete = null))} onblur={() => (confirmDelete = null)}>Delete</Button>
							{:else}
								<Button
									variant="ghost"
									size="icon-xs"
									class="me-1 opacity-0 group-hover/theme:opacity-100 focus-visible:opacity-100"
									aria-label="Delete {t.name}"
									onclick={() => (confirmDelete = t.id)}
								>
									<Trash2Icon />
								</Button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if switchTo}
				<div class="border-t px-3 py-3 text-xs" role="alertdialog" aria-label="Unsaved changes">
					<p>Switch to <span class="font-medium">{appearance.themes.find((t) => t.id === switchTo)?.name}</span> and lose your unsaved changes?</p>
					<div class="mt-2 flex gap-2">
						<Button size="xs" variant="destructive" onclick={() => (appearance.select(switchTo!), (switchTo = null))}>Discard and switch</Button>
						<Button size="xs" variant="ghost" onclick={() => (switchTo = null)}>Keep editing</Button>
					</div>
				</div>
			{/if}
			<div class="border-t p-3">
				<div class="flex gap-2">
					<Button variant="outline" size="xs" class="flex-1" onclick={() => picker?.click()}><UploadIcon />Import</Button>
					<Button variant="outline" size="xs" class="flex-1" onclick={exportTheme}><DownloadIcon />Export</Button>
				</div>
				<input bind:this={picker} type="file" accept=".json,application/json" class="hidden" aria-label="Import a theme file" onchange={(e) => importTheme(e.currentTarget.files?.[0])} />
				{#if fileError}<p class="mt-2 text-xs text-destructive" role="alert">{fileError}</p>{/if}
				<p class="mt-2 hidden text-xs text-muted-foreground @3xl/pane:block">Change anything on the right, then save it as a theme of your own. Save keeps changes in the theme itself; a built-in theme you changed can be reset.</p>
			</div>
		</aside>

		<!-- the editor -->
		<div class="min-w-0 flex-1 overflow-y-auto">
			<div class="mx-auto max-w-2xl space-y-8 p-6">
				{#snippet section(title: string, hint: string, body: Snippet)}
					<section>
						<h2 class="text-sm font-semibold">{title}</h2>
						<p class="mt-0.5 mb-3 text-xs text-muted-foreground">{hint}</p>
						{@render body()}
					</section>
				{/snippet}

				{@render section('Base', 'Dark or light. Every colour you leave alone comes from the base.', base)}
				{@render section('Colours', 'Click a swatch to pick, or type a hex value. The arrow hands a colour back to the base.', colours)}
				{@render section('Borders and corners', 'The width of every border and divider, and how round the corners are.', borders)}
				{@render section('Cutouts', 'Cut corners out of panels instead of rounding them. Pick the corners, the shape and the size.', cutouts)}
				{@render section('Panels', 'When the main area is split: the space between panels, and around them all.', panels)}
				{@render section('Fonts', 'Any font installed on this computer, for the interface and for code.', fonts)}
			</div>
		</div>

		<!-- the sample -->
		<aside class="hidden w-[25rem] shrink-0 flex-col overflow-y-auto border-s bg-background p-5 @6xl/pane:flex" aria-label="Sample">
			<h2 class="mb-3 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Sample</h2>
			<div class="space-y-4">
				<div class="glow-card rounded-xl border p-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<span class="font-mono">#042</span>
						<span class="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">Build</span>
						<span class="ms-auto">2 min. ago</span>
					</div>
					<p class="mt-2 font-medium">Take the discount off before VAT</p>
					<p class="mt-1 text-sm text-muted-foreground">The receipt and the cart disagree by a cent on some totals.</p>
					<div class="mt-3 flex flex-wrap gap-1.5 text-[0.6875rem] font-medium">
						<span class="rounded-full bg-tone-green/15 px-2 py-0.5 text-tone-green">Passed</span>
						<span class="rounded-full bg-tone-amber/15 px-2 py-0.5 text-tone-amber">Needs you</span>
						<span class="rounded-full bg-tone-rose/15 px-2 py-0.5 text-tone-rose">Changes</span>
						<span class="rounded-full bg-tone-sky/15 px-2 py-0.5 text-tone-sky">Check</span>
						<span class="rounded-full bg-tone-violet/15 px-2 py-0.5 text-tone-violet">Merged</span>
						<span class="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">Failed</span>
					</div>
					<div class="mt-4 flex gap-2">
						<Button size="sm">Submit review</Button>
						<Button size="sm" variant="outline">Cancel</Button>
						<Button size="sm" variant="ghost">Skip</Button>
					</div>
				</div>

				<div class="rounded-xl border bg-card">
					<div class="flex h-9 items-center gap-2 border-b px-3 font-mono text-xs">
						<span class="font-semibold text-tone-amber">M</span>
						<span><span class="text-muted-foreground">src/</span><span class="font-medium">pricing.ts</span></span>
						<span class="ms-auto text-tone-green">+2</span><span class="text-tone-rose">-1</span>
					</div>
					<div class="overflow-hidden rounded-b-xl">
						{#each rows as row (row.kind + row.at)}
							{@const text = row.at < 0 ? removed : sample[row.at]}
							<div class={cn('grid grid-cols-[2.25rem_2.25rem_minmax(0,1fr)]', tone[row.kind])}>
								<span class="num px-1.5 text-right font-mono text-[0.6875rem] leading-[calc(var(--code-size)+8px)] text-muted-foreground/70 tabular-nums">{row.old ?? ''}</span>
								<span class="num px-1.5 text-right font-mono text-[0.6875rem] leading-[calc(var(--code-size)+8px)] text-muted-foreground/70 tabular-nums">{row.new ?? ''}</span>
								<span class="code flex min-w-0 ps-1">
									<span class="w-4 shrink-0 text-center text-muted-foreground/70">{sign[row.kind]}</span>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- lineHtml escapes the text -->
									<span class="min-w-0 flex-1 pe-2 [overflow-wrap:anywhere] whitespace-pre-wrap">{@html lineHtml(row.at < 0 ? toks.removed?.[0] : toks.lines?.[row.at], text)}</span>
								</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="rounded-xl border bg-card p-4">
					<label class="flex h-8 items-center rounded-md border bg-background px-2.5 text-xs">
						<input placeholder="A text field" class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70" />
					</label>
					<p class="mt-3 text-sm">Body text, with <code class="rounded bg-muted px-1 font-mono text-[0.85em]">inline code</code> and a <span class="text-primary underline underline-offset-4">link</span>.</p>
					<pre class="mt-3 rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed">npm run app -- ~/code/shop</pre>
				</div>
			</div>
		</aside>
	</div>
</div>

{#snippet base()}
	<div class="flex h-9 w-fit items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="Base">
		{#each [{ dark: true, label: 'Dark', icon: MoonIcon }, { dark: false, label: 'Light', icon: SunIcon }] as o (o.label)}
			<button
				type="button"
				class={cn('flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground', theme.dark === o.dark && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
				aria-pressed={theme.dark === o.dark}
				onclick={() => theme.dark !== o.dark && appearance.edit({ dark: o.dark })}
			>
				<o.icon class="size-3.5" />{o.label}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet colours()}
	<div class="space-y-5">
		{#each COLOR_GROUPS as group (group.title)}
			<div>
				<h3 class="mb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{group.title}</h3>
				<div class="grid gap-x-6 gap-y-1 @4xl/pane:grid-cols-2">
					{#each group.colors as c (c.key)}
						{@const value = appearance.colorOf(theme, c.key)}
						{@const own = appearance.isOwnColor(c.key)}
						<div class="flex h-9 items-center gap-2.5">
							<input
								type="color"
								{value}
								aria-label={c.label}
								class="size-6 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-md border bg-transparent p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
								oninput={(e) => appearance.setColor(c.key, e.currentTarget.value)}
							/>
							<span class="min-w-0 flex-1 truncate text-sm">{c.label}</span>
							<input
								{value}
								aria-label="{c.label}, as hex"
								spellcheck="false"
								maxlength="7"
								class={cn('h-7 w-[4.75rem] rounded-md border bg-background px-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30', !own && 'text-muted-foreground')}
								onchange={(e) => {
									const typed = e.currentTarget.value.trim()
									appearance.setColor(c.key, typed.startsWith('#') ? typed : `#${typed}`)
									// a value that is not a colour changes nothing: show what is in effect again
									e.currentTarget.value = appearance.colorOf(appearance.current, c.key)
								}}
							/>
							<Button variant="ghost" size="icon-xs" class={cn(!own && 'invisible')} aria-label="Reset {c.label}" onclick={() => appearance.setColor(c.key, null)}><RotateCcwIcon /></Button>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet slider(id: string, label: string, value: number, min: number, max: number, step: number, shown: string, set: (n: number) => void)}
	<div class="flex h-9 items-center gap-3">
		<label for={id} class="w-36 shrink-0 text-sm">{label}</label>
		<input {id} type="range" {min} {max} {step} {value} class="h-1 min-w-0 flex-1 cursor-pointer accent-primary" oninput={(e) => set(Number(e.currentTarget.value))} />
		<span class="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">{shown}</span>
	</div>
{/snippet}

{#snippet borders()}
	{@render slider('line', 'Border width', theme.line, 0, 3, 0.5, `${theme.line} px`, (n) => appearance.edit({ line: n }))}
	{@render slider('radius', 'Corner radius', theme.radius, 0, 1.25, 0.125, `${px(theme.radius)} px`, (n) => appearance.edit({ radius: n }))}
	{#if theme.cut.on}<p class="mt-1 text-xs text-muted-foreground">Corners that are cut out take the cutout's size instead.</p>{/if}
{/snippet}

{#snippet panels()}
	{@render slider('gap', 'Between panels', theme.gap, 0, 32, 1, `${theme.gap} px`, (n) => appearance.edit({ gap: n }))}
	{@render slider('gap-outer', 'Around the panels', theme.gapOuter, 0, 32, 1, `${theme.gapOuter} px`, (n) => appearance.edit({ gapOuter: n }))}
	<p class="mt-1 text-xs text-muted-foreground">A single panel always fills the window. Split it with the buttons above the main area.</p>
{/snippet}

{#snippet cutouts()}
	{@const cut = theme.cut}
	<div class="flex flex-wrap items-start gap-x-8 gap-y-4">
		<!-- the panel in small: click a corner to cut it -->
		<!-- the corner buttons sit just outside the box, so the shape they cut stays in view -->
		<div class={cn('relative m-6 h-24 w-44 shrink-0', !cut.on && 'opacity-50')}>
			<div
				class="absolute inset-0 border bg-card"
				style:border-radius={CORNERS.map((c) => (cut.on && cut.corners[c] ? `${Math.min(cut.size, 40)}px` : `${theme.radius}rem`)).join(' ')}
				style:corner-shape={CORNERS.map((c) => (cut.on && cut.corners[c] ? cut.shape : 'round')).join(' ')}
				style:border-width="max(var(--line), 1px)"
			></div>
			{#each CORNERS as c (c)}
				<button
					type="button"
					class={cn(
						'absolute grid size-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
						cornerAt[c],
						c === 'tl' && '-translate-x-[85%] -translate-y-[85%]',
						c === 'tr' && 'translate-x-[85%] -translate-y-[85%]',
						c === 'br' && 'translate-x-[85%] translate-y-[85%]',
						c === 'bl' && '-translate-x-[85%] translate-y-[85%]',
						cut.corners[c] && 'border-primary bg-primary text-primary-foreground hover:text-primary-foreground'
					)}
					style:border-radius="9999px"
					aria-label={cornerName[c]}
					aria-pressed={cut.corners[c]}
					disabled={!cut.on}
					onclick={() => appearance.setCut({ corners: { [c]: !cut.corners[c] } })}
				>
					{#if cut.corners[c]}<CheckIcon class="size-3.5" />{/if}
				</button>
			{/each}
			<span class="pointer-events-none absolute inset-0 grid place-items-center text-[0.6875rem] text-muted-foreground">click a corner</span>
		</div>

		<div class="min-w-64 flex-1 space-y-1">
			<div class="flex h-9 items-center gap-3">
				<span class="w-36 shrink-0 text-sm" id="cut-on">Cut corners</span>
				{@render toggle('cut-on', cut.on, (on) => appearance.setCut({ on }))}
			</div>
			<div class="flex h-9 items-center gap-3">
				<span class="w-36 shrink-0 text-sm">Shape</span>
				<div class="flex h-8 items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="Cut shape">
					{#each CUT_SHAPES as shape (shape)}
						<button
							type="button"
							class={cn('h-full rounded-md px-2.5 text-xs font-medium text-muted-foreground capitalize hover:text-foreground', cut.shape === shape && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
							aria-pressed={cut.shape === shape}
							onclick={() => appearance.setCut({ shape })}
						>
							{shape}
						</button>
					{/each}
				</div>
			</div>
			{@render slider('cut-size', 'Size', cut.size, 4, 32, 1, `${cut.size} px`, (n) => appearance.setCut({ size: n }))}
			<div class="flex h-9 items-center gap-3">
				<span class="w-36 shrink-0 text-sm" id="cut-controls">Buttons and fields too</span>
				{@render toggle('cut-controls', cut.controls, (controls) => appearance.setCut({ controls }))}
			</div>
		</div>
	</div>
{/snippet}

{#snippet toggle(labelledby: string, on: boolean, set: (on: boolean) => void)}
	<button
		type="button"
		role="switch"
		aria-checked={on}
		aria-labelledby={labelledby}
		class={cn('relative h-5 w-9 shrink-0 border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', on ? 'border-primary bg-primary' : 'bg-muted')}
		style:border-radius="9999px"
		onclick={() => set(!on)}
	>
		<span class={cn('absolute top-1/2 size-3.5 -translate-y-1/2 bg-background shadow-sm transition-[left]', on ? 'left-[1.125rem]' : 'left-0.5')} style:border-radius="9999px"></span>
	</button>
{/snippet}

{#snippet fontField(id: string, label: string, value: string, fallback: string, list: string[], set: (name: string) => void)}
	<div class="flex h-9 items-center gap-3">
		<label for={id} class="w-36 shrink-0 text-sm">{label}</label>
		<input
			{id}
			{value}
			list="{id}-list"
			placeholder="{fallback} (the app's own)"
			spellcheck="false"
			class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
			onfocus={() => appearance.loadFonts()}
			oninput={(e) => set(e.currentTarget.value)}
		/>
		<datalist id="{id}-list">
			{#each list as name (name)}<option value={name}></option>{/each}
		</datalist>
	</div>
{/snippet}

{#snippet fonts()}
	<div class="space-y-1">
		{@render fontField('font-sans', 'Interface font', theme.fontSans, 'Inter', appearance.fonts.sans, (name) => appearance.edit({ fontSans: name }))}
		{@render slider('font-size', 'Interface size', theme.fontSize, 13, 20, 1, `${theme.fontSize} px`, (n) => appearance.edit({ fontSize: n }))}
		{@render fontField('font-mono', 'Code font', theme.fontMono, 'JetBrains Mono', appearance.fonts.mono, (name) => appearance.edit({ fontMono: name }))}
		{@render slider('code-size', 'Code size', theme.codeSize, 10, 18, 1, `${theme.codeSize} px`, (n) => appearance.edit({ codeSize: n }))}
		<div class="flex h-9 items-center gap-3">
			<label for="syntax" class="w-36 shrink-0 text-sm">Syntax colours</label>
			<select
				id="syntax"
				value={theme.syntax}
				class="h-8 min-w-0 flex-1 cursor-pointer rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
				onchange={(e) => appearance.edit({ syntax: e.currentTarget.value })}
			>
				<optgroup label="Dark">
					{#each SYNTAX_THEMES.filter((s) => s.dark) as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</optgroup>
				<optgroup label="Light">
					{#each SYNTAX_THEMES.filter((s) => !s.dark) as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</optgroup>
			</select>
		</div>
	</div>
{/snippet}
