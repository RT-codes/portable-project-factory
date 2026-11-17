<script lang="ts">
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import type { UsageRun } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { count, elapsed, shortModel } from '$lib/live'
	import { money, weigh } from '$lib/usage'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import { getTile } from '../pane'

	// Usage: what the factory's agent runs took, over the repo's history. The numbers come with the tickets: the
	// ones on this machine, and for finished and deleted ones the rows their journal entry carries. One row of
	// filters scopes everything below it, so the totals, the charts and the table always agree.
	const tile = getTile()
	const project = $derived(app.project!)

	let runs = $state<UsageRun[] | null>(null)
	let error = $state<string | null>(null)
	let loading = $state(false)
	async function load() {
		const at = project
		loading = true
		try {
			const got = await api.usage(at)
			if (at !== project) return
			runs = got
			error = null
		} catch (e) {
			error = message(e)
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void project
		runs = null
		void load()
	})
	$effect(() => app.onFocus(() => void load()))

	// ---- filters
	const RANGES = [
		{ days: 7, label: '7 days' },
		{ days: 30, label: '30 days' },
		{ days: 90, label: '90 days' },
		{ days: 0, label: 'All' },
	]
	const recall = (key: string, fallback: string) => {
		try {
			return localStorage.getItem(key) ?? fallback
		} catch {
			return fallback
		}
	}
	const keep = (key: string, value: string) => {
		try {
			localStorage.setItem(key, value)
		} catch {}
	}
	let days = $state(Number(recall('factory-usage-days', '30')))
	let model = $state('')
	let stage = $state('')
	/** what the charts measure: what it cost, or how many tokens it was */
	let metric = $state<'cost' | 'tokens'>(recall('factory-usage-metric', 'cost') === 'tokens' ? 'tokens' : 'cost')
	$effect(() => keep('factory-usage-days', String(days)))
	$effect(() => keep('factory-usage-metric', metric))

	const DAY = 86_400_000
	const dayOf = (iso: string) => {
		const d = new Date(iso)
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
	}
	const today = $derived(dayOf(new Date().toISOString()))
	const models = $derived([...new Set((runs ?? []).map((r) => r.model).filter(Boolean))].sort())
	const stages = $derived([...new Set((runs ?? []).map((r) => r.stage).filter(Boolean))])
	const shown = $derived((runs ?? []).filter((r) => (!days || dayOf(r.at) > today - days * DAY) && (!model || r.model === model) && (!stage || r.stage === stage)))
	// a cost is only known where the agent reports one: without any, the charts count tokens
	const priced = $derived(shown.some((r) => r.cost_usd > 0))
	const unit = $derived(metric === 'cost' && priced ? 'cost' : 'tokens')

	const tokensOf = (r: UsageRun) => r.input + r.cache_read + r.cache_write + r.output + r.unsplit
	const valueOf = (r: UsageRun) => (unit === 'cost' ? r.cost_usd : tokensOf(r))
	const show = (v: number) => (unit === 'cost' ? money(v) : count(Math.round(v)))

	// ---- a run that did not count: it failed, was stopped by a limit, or its round was redone or thrown away
	const lastRound = $derived.by(() => {
		const map = new Map<string, number>()
		for (const r of runs ?? []) map.set(r.ticket, Math.max(map.get(r.ticket) ?? 0, r.round))
		return map
	})
	const lost = (r: UsageRun) => r.result === 'ERROR' || r.result === 'WAIT' || r.state === 'deleted' || r.state === 'dropped' || (r.round > 0 && r.round < (lastRound.get(r.ticket) ?? 0))

	const totals = $derived.by(() => {
		const t = { cost: 0, tokens: 0, fresh: 0, cached: 0, runs: shown.length, tickets: new Set(shown.map((r) => r.ticket)).size, lost: 0, all: 0, secs: 0 }
		for (const r of shown) {
			t.cost += r.cost_usd
			t.tokens += tokensOf(r)
			t.cached += r.cache_read
			t.fresh += tokensOf(r) - r.cache_read
			t.secs += r.secs
			const v = unit === 'cost' ? r.cost_usd : weigh(r, r.unsplit)
			t.all += v
			if (lost(r)) t.lost += v
		}
		return t
	})

	// ---- over time: a bar per day, or per week when the days would not fit
	const KINDS = [
		{ key: 'input', label: 'Fresh input', color: 'var(--tone-sky)' },
		{ key: 'cache_write', label: 'Written to the cache', color: 'var(--tone-amber)' },
		{ key: 'output', label: 'Output', color: 'var(--tone-violet)' },
		{ key: 'cache_read', label: 'Read from the cache', color: 'var(--tone-green)' },
		{ key: 'unsplit', label: 'Not told apart', color: 'var(--muted-foreground)' },
	] as const
	const series = $derived(unit === 'cost' ? [{ key: 'cost_usd', label: 'Cost', color: 'var(--tone-sky)' } as const] : KINDS.filter((k) => shown.some((r) => r[k.key] > 0)))
	const buckets = $derived.by(() => {
		if (!shown.length) return []
		const first = days ? today - (days - 1) * DAY : dayOf(shown[0].at)
		const span = Math.round((today - first) / DAY) + 1
		const step = span > 92 ? 7 : 1
		const n = Math.ceil(span / step)
		const list = Array.from({ length: n }, (_, i) => ({ from: first + i * step * DAY, values: series.map(() => 0), total: 0, runs: 0 }))
		for (const r of shown) {
			const b = list[Math.floor(Math.round((dayOf(r.at) - first) / DAY) / step)]
			if (!b) continue
			series.forEach((s, i) => (b.values[i] += r[s.key]))
			b.runs++
		}
		for (const b of list) b.total = b.values.reduce((a, v) => a + v, 0)
		return list.map((b) => ({ ...b, step }))
	})
	const peak = $derived(Math.max(0, ...buckets.map((b) => b.total)))
	/** a round number at or above the peak, so the axis reads easily */
	const top = $derived.by(() => {
		if (peak <= 0) return 1
		const mag = 10 ** Math.floor(Math.log10(peak))
		return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= peak) ?? peak
	})
	const dateLabel = (ms: number, step = 1) => {
		const d = new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
		return step > 1 ? `Week of ${d}` : d
	}
	let hover = $state<number | null>(null)

	// ---- by model, by stage
	function groupBy(key: (r: UsageRun) => string) {
		const map = new Map<string, { name: string; value: number; runs: number }>()
		for (const r of shown) {
			const name = key(r) || 'unknown'
			const g = map.get(name) ?? { name, value: 0, runs: 0 }
			g.value += valueOf(r)
			g.runs++
			map.set(name, g)
		}
		return [...map.values()].sort((a, b) => b.value - a.value)
	}
	const byModel = $derived(groupBy((r) => r.model))
	const byStage = $derived(groupBy((r) => r.stage))

	// ---- by ticket
	const STATE: Record<UsageRun['state'], { label: string; tone: string }> = {
		open: { label: 'On the board', tone: 'text-primary' },
		done: { label: 'Done, not merged', tone: 'text-tone-green' },
		merged: { label: 'Merged', tone: 'text-muted-foreground' },
		dropped: { label: 'Dropped', tone: 'text-muted-foreground' },
		deleted: { label: 'Deleted', tone: 'text-tone-rose' },
	}
	const tickets = $derived.by(() => {
		const map = new Map<string, { id: string; title: string; state: UsageRun['state']; runs: number; rounds: number; secs: number; tokens: number; cost: number; value: number; lost: number; last: string }>()
		for (const r of shown) {
			const t = map.get(r.ticket) ?? { id: r.ticket, title: r.title, state: r.state, runs: 0, rounds: 0, secs: 0, tokens: 0, cost: 0, value: 0, lost: 0, last: r.at }
			t.runs++
			t.rounds = Math.max(t.rounds, r.round)
			t.secs += r.secs
			t.tokens += tokensOf(r)
			t.cost += r.cost_usd
			t.value += valueOf(r)
			if (lost(r)) t.lost += valueOf(r)
			if (r.at > t.last) t.last = r.at
			map.set(r.ticket, t)
		}
		return [...map.values()].sort((a, b) => b.value - a.value)
	})
	const ticketPeak = $derived(Math.max(0, ...tickets.map((t) => t.value)))
	let allTickets = $state(false)
	const number = (id: string) => `#${id.match(/^\d+/)?.[0] ?? id}`
	const select = 'h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<ChartColumnIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">Usage</h1>
			<p class="truncate text-xs text-muted-foreground">What the factory's agent runs took, ticket by ticket</p>
		</div>
		<div class="ms-auto flex shrink-0 items-center gap-2">
			<div class="flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="What the charts measure">
				{#each [['cost', 'Cost'], ['tokens', 'Tokens']] as const as [value, label] (value)}
					<button
						type="button"
						class={cn('h-full rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50', unit === value && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
						aria-pressed={unit === value}
						disabled={value === 'cost' && !priced}
						title={value === 'cost' ? (priced ? 'At API prices, as Claude Code reports it. On a subscription it measures usage; it is not a bill.' : 'No run here reported a cost (Codex does not)') : 'Every token, of every kind'}
						onclick={() => (metric = value)}
					>
						{label}
					</button>
				{/each}
			</div>
			<Button variant="ghost" size="icon-sm" onclick={() => load()} aria-label="Refresh"><RefreshCwIcon class={cn(loading && 'animate-spin')} /></Button>
		</div>
	</header>

	{#if error}
		<EmptyState icon={TriangleAlertIcon} title="Can't read the usage">
			<p class="font-mono text-xs text-destructive/90">{error}</p>
		</EmptyState>
	{:else if !runs}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Adding it up…</p>
	{:else if runs.length === 0}
		<EmptyState icon={ChartColumnIcon} title="Nothing has run yet" glow>
			<p>Once the factory works a ticket, every agent run shows up here: which model it was, how many tokens of which kind, and what it cost.</p>
			<p>Nothing extra is kept for this: a finished ticket's numbers are a line in its journal entry, committed with the change.</p>
		</EmptyState>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class={cn('mx-auto max-w-6xl space-y-5 p-4 transition-opacity @2xl/pane:p-6', loading && 'opacity-60')}>
				<!-- one row of filters, for everything below -->
				<div class="flex flex-wrap items-center gap-2" aria-label="Filters">
					<div class="flex h-7 items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="Period">
						{#each RANGES as r (r.days)}
							<button
								type="button"
								class={cn('h-full rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground', days === r.days && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
								aria-pressed={days === r.days}
								onclick={() => (days = r.days)}
							>
								{r.label}
							</button>
						{/each}
					</div>
					<select class={select} bind:value={model} aria-label="Model">
						<option value="">Every model</option>
						{#each models as m (m)}<option value={m}>{shortModel(m)}</option>{/each}
					</select>
					<select class={select} bind:value={stage} aria-label="Stage">
						<option value="">Every stage</option>
						{#each stages as s (s)}<option value={s}>{s}</option>{/each}
					</select>
					{#if model || stage}
						<Button variant="ghost" size="xs" onclick={() => ((model = ''), (stage = ''))}>Clear</Button>
					{/if}
				</div>

				{#if shown.length === 0}
					<p class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No agent ran in this period{model || stage ? ' with these filters' : ''}.</p>
				{:else}
					<!-- the totals -->
					<section class="grid grid-cols-2 gap-3 @3xl/pane:grid-cols-4" aria-label="Totals">
						<div class="rounded-xl border bg-card px-4 py-3" data-total="cost">
							<p class="text-xs text-muted-foreground">Cost</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{priced ? money(totals.cost) : 'not reported'}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">{priced ? 'at API prices' : 'Codex reports tokens only'}</p>
						</div>
						<div class="rounded-xl border bg-card px-4 py-3" data-total="tokens">
							<p class="text-xs text-muted-foreground">Tokens</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{count(totals.tokens)}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">{totals.tokens ? Math.round((totals.cached / totals.tokens) * 100) : 0}% read from the cache, at a tenth of the price</p>
						</div>
						<div class="rounded-xl border bg-card px-4 py-3" data-total="runs">
							<p class="text-xs text-muted-foreground">Agent runs</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{totals.runs}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">on {totals.tickets} {totals.tickets === 1 ? 'ticket' : 'tickets'}{totals.secs ? `, ${elapsed(0, totals.secs * 1000)} of work` : ''}</p>
						</div>
						<div class="rounded-xl border bg-card px-4 py-3" data-total="lost">
							<p class="text-xs text-muted-foreground">Did not make it</p>
							<p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{totals.all ? Math.round((totals.lost / totals.all) * 100) : 0}%</p>
							<p class="mt-0.5 text-xs text-muted-foreground">redone rounds, failed runs, dropped tickets</p>
						</div>
					</section>

					<!-- over time -->
					<section class="rounded-xl border bg-card p-4" aria-label="Over time">
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
							<h2 class="text-sm font-medium">{unit === 'cost' ? 'Cost' : 'Tokens'} per {buckets[0]?.step === 7 ? 'week' : 'day'}</h2>
							{#if series.length > 1}
								<ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
									{#each series as s (s.key)}
										<li class="inline-flex items-center gap-1.5"><span class="size-2 rounded-[2px]" style:background={s.color}></span>{s.label}</li>
									{/each}
								</ul>
							{/if}
						</div>
						<div class="mt-4 flex gap-2">
							<!-- one axis, with a round number at the top -->
							<div class="flex h-44 w-10 shrink-0 flex-col justify-between text-right text-[0.625rem] text-muted-foreground tabular-nums" aria-hidden="true">
								<span>{show(top)}</span><span>{show(top / 2)}</span><span>0</span>
							</div>
							<div class="relative min-w-0 flex-1">
								<div class="pointer-events-none absolute inset-0 flex h-44 flex-col justify-between" aria-hidden="true">
									<span class="border-t border-dashed"></span><span class="border-t border-dashed"></span><span class="border-t"></span>
								</div>
								<div class="relative flex h-44 items-end gap-[2px]" role="group" aria-label="Bars" onmouseleave={() => (hover = null)}>
									{#each buckets as b, i (b.from)}
										<button
											type="button"
											class="group/bar flex h-full min-w-0 flex-1 flex-col justify-end outline-none"
											aria-label="{dateLabel(b.from, b.step)}: {show(b.total)}, {b.runs} {b.runs === 1 ? 'run' : 'runs'}"
											onmouseenter={() => (hover = i)}
											onfocus={() => (hover = i)}
											onblur={() => (hover = null)}
											data-bar={b.total > 0 ? 'on' : 'off'}
										>
											<span class={cn('mx-auto flex w-full max-w-7 flex-col-reverse gap-[2px] transition-[filter]', hover === i && 'brightness-125')} style:height="{(b.total / top) * 100}%">
												{#each series as s, k (s.key)}
													{#if b.values[k] > 0}
														<span class="min-h-[2px] w-full last:rounded-t-[4px]" style:background={s.color} style:flex-grow={b.values[k]} style:flex-basis="0"></span>
													{/if}
												{/each}
											</span>
										</button>
									{/each}
								</div>
								<div class="mt-1.5 flex justify-between text-[0.625rem] text-muted-foreground" aria-hidden="true">
									<span>{dateLabel(buckets[0].from)}</span>
									{#if buckets.length > 2}<span>{dateLabel(buckets[Math.floor(buckets.length / 2)].from)}</span>{/if}
									<span>{buckets.length > 1 ? dateLabel(buckets.at(-1)!.from) : ''}</span>
								</div>
								{#if hover !== null && buckets[hover]}
									{@const b = buckets[hover]}
									<div
										class="pointer-events-none absolute top-0 z-10 w-52 rounded-lg border bg-popover p-2.5 text-xs shadow-md"
										style:left="clamp(0px, calc({((hover + 0.5) / buckets.length) * 100}% - 6.5rem), calc(100% - 13rem))"
										data-tip
									>
										<p class="font-medium">{dateLabel(b.from, b.step)}</p>
										<p class="text-muted-foreground">{b.runs} {b.runs === 1 ? 'run' : 'runs'}</p>
										<ul class="mt-1.5 space-y-0.5">
											{#each series as s, k (s.key)}
												<li class="flex items-center gap-1.5">
													<span class="h-0.5 w-3 rounded-full" style:background={s.color}></span>
													<span class="font-medium tabular-nums">{show(b.values[k])}</span>
													<span class="truncate text-muted-foreground">{s.label}</span>
												</li>
											{/each}
										</ul>
										{#if series.length > 1}<p class="mt-1.5 border-t pt-1.5 font-medium tabular-nums">{show(b.total)} <span class="font-normal text-muted-foreground">in all</span></p>{/if}
									</div>
								{/if}
							</div>
						</div>
					</section>

					<!-- where it went -->
					<div class="grid gap-3 @4xl/pane:grid-cols-2">
						{#each [{ title: 'By model', rows: byModel, pick: (n: string) => (model = model === n ? '' : n), on: model, name: shortModel }, { title: 'By stage', rows: byStage, pick: (n: string) => (stage = stage === n ? '' : n), on: stage, name: (n: string) => n }] as g (g.title)}
							<section class="rounded-xl border bg-card p-4" aria-label={g.title}>
								<h2 class="text-sm font-medium">{g.title}</h2>
								<ul class="mt-3 space-y-2.5">
									{#each g.rows as row (row.name)}
										<li>
											<button
												type="button"
												class="group/row block w-full text-left outline-none"
												title="{row.runs} {row.runs === 1 ? 'run' : 'runs'}. Click to {g.on === row.name ? 'show everything again' : 'show only this'}."
												onclick={() => g.pick(row.name)}
											>
												<span class="flex items-baseline justify-between gap-3 text-xs">
													<span class={cn('min-w-0 truncate font-mono', g.on === row.name && 'font-semibold')}>{g.name(row.name)}</span>
													<span class="shrink-0 tabular-nums">
														<span class="font-medium">{show(row.value)}</span>
														<span class="text-muted-foreground">· {row.runs} {row.runs === 1 ? 'run' : 'runs'}</span>
													</span>
												</span>
												<span class="mt-1 block h-1.5 rounded-full bg-muted">
													<span class="block h-full min-w-[2px] rounded-full bg-tone-sky transition-[filter] group-hover/row:brightness-125 group-focus-visible/row:brightness-125" style:width="{g.rows[0].value ? (row.value / g.rows[0].value) * 100 : 0}%"></span>
												</span>
											</button>
										</li>
									{/each}
								</ul>
							</section>
						{/each}
					</div>

					<!-- ticket by ticket: also the table of everything above -->
					<section class="rounded-xl border bg-card" aria-label="By ticket">
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 pb-2">
							<h2 class="text-sm font-medium">By ticket</h2>
							<ul class="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Legend">
								<li class="inline-flex items-center gap-1.5"><span class="size-2 rounded-[2px] bg-tone-sky"></span>Made it into the change</li>
								<li class="inline-flex items-center gap-1.5"><span class="lost size-2 rounded-[2px]"></span>Did not: redone, failed or thrown away</li>
							</ul>
						</div>
						<div class="overflow-x-auto">
							<table class="w-full text-left text-xs">
								<thead class="text-muted-foreground">
									<tr class="border-b">
										<th class="w-[38%] px-4 py-2 font-medium">Ticket</th>
										<th class="px-2 py-2 font-medium">State</th>
										<th class="px-2 py-2 text-right font-medium">Runs</th>
										<th class="px-2 py-2 text-right font-medium">Rounds</th>
										<th class="px-2 py-2 text-right font-medium">Time</th>
										<th class="px-2 py-2 text-right font-medium">Tokens</th>
										<th class="px-2 py-2 text-right font-medium">Cost</th>
										<th class="w-[18%] px-4 py-2 font-medium">{unit === 'cost' ? 'Cost' : 'Tokens'}</th>
									</tr>
								</thead>
								<tbody>
									{#each allTickets ? tickets : tickets.slice(0, 12) as t (t.id)}
										<tr class="border-b last:border-b-0 hover:bg-accent/40" data-usage-ticket={t.id}>
											<td class="max-w-0 px-4 py-2">
												{#if t.state === 'open' || t.state === 'done' || t.state === 'dropped'}
													<button type="button" class="flex w-full min-w-0 items-baseline gap-2 text-left hover:underline" onclick={() => tile.openBeside({ view: 'board', path: t.id })}>
														<span class="shrink-0 font-mono text-muted-foreground">{number(t.id)}</span><span class="truncate font-medium">{t.title}</span>
													</button>
												{:else}
													<span class="flex min-w-0 items-baseline gap-2"><span class="shrink-0 font-mono text-muted-foreground">{number(t.id)}</span><span class="truncate font-medium">{t.title}</span></span>
												{/if}
											</td>
											<td class={cn('px-2 py-2 whitespace-nowrap', STATE[t.state].tone)}>{STATE[t.state].label}</td>
											<td class="px-2 py-2 text-right tabular-nums">{t.runs}</td>
											<td class="px-2 py-2 text-right tabular-nums">{t.rounds || ''}</td>
											<td class="px-2 py-2 text-right whitespace-nowrap tabular-nums">{t.secs ? elapsed(0, t.secs * 1000) : ''}</td>
											<td class="px-2 py-2 text-right tabular-nums">{count(t.tokens)}</td>
											<td class="px-2 py-2 text-right tabular-nums">{t.cost ? money(t.cost) : ''}</td>
											<td class="px-4 py-2">
												<span class="flex h-1.5 gap-[2px]" title="{show(t.value - t.lost)} made it, {show(t.lost)} did not" style:width="{ticketPeak ? Math.max(2, (t.value / ticketPeak) * 100) : 0}%">
													{#if t.value - t.lost > 0}<span class="rounded-full bg-tone-sky" style:flex-grow={t.value - t.lost} style:flex-basis="0"></span>{/if}
													{#if t.lost > 0}<span class="lost rounded-full" style:flex-grow={t.lost} style:flex-basis="0"></span>{/if}
												</span>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if tickets.length > 12}
							<div class="border-t p-2 text-center">
								<Button variant="ghost" size="xs" onclick={() => (allTickets = !allTickets)}>{allTickets ? 'Show the 12 largest' : `Show all ${tickets.length} tickets`}</Button>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* what did not make it: hatched as well as grey, so it does not rest on colour alone */
	.lost {
		background: repeating-linear-gradient(135deg, var(--muted-foreground) 0 2px, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 2px 4px);
	}
</style>
