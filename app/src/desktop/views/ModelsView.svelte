<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
	import CpuIcon from '@lucide/svelte/icons/cpu'
	import InfoIcon from '@lucide/svelte/icons/info'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import LockIcon from '@lucide/svelte/icons/lock'
	import CheckIcon from '@lucide/svelte/icons/check'
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line'
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
	import XIcon from '@lucide/svelte/icons/x'
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
	import type { Agent, LastRun, ModelSettings } from '$shared/api'
	import { Button } from '$lib/components/ui/button/index.js'
	import { ago } from '$lib/format'
	import { ROLES, type AgentCli, type LocalSettings, type Role, type RoleSettings } from '$lib/types'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'
	import EmptyState from '../components/EmptyState.svelte'
	import InstallCommand from '../components/InstallCommand.svelte'
	import Select, { type Option } from '../components/Select.svelte'
	import { getTile } from '../pane'

	// Models and effort: which model each role (planner, builder, reviewer) runs on, how hard it thinks, and which
	// agent CLI runs the stages. The team's defaults come from .factory/config.json (committed); what is changed here
	// is this user's own and goes to .factory/local.json, which git ignores. Every change is saved at once.
	const tile = getTile()
	const project = $derived(app.project!)

	let settings = $state<ModelSettings | null>(null)
	let error = $state<string | null>(null)
	let saveError = $state<string | null>(null)
	let saved = $state(false)
	/** the field whose model is being typed by hand ("planner:claude"), and what is typed */
	let custom = $state<string | null>(null)
	let typed = $state('')
	let timer: ReturnType<typeof setTimeout> | undefined

	async function load() {
		const p = project
		try {
			const next = await api.modelSettings(p)
			if (p !== project) return
			settings = next
			error = null
		} catch (e) {
			if (p === project) error = message(e)
		}
	}
	$effect(() => {
		void project
		if (app.info?.hasFactory) void load()
	})
	$effect(() => app.onFocus(() => app.info?.hasFactory && void load()))

	const local = $derived(settings?.local ?? {})

	async function save(next: LocalSettings) {
		saveError = null
		try {
			const written = await api.saveLocalSettings(project, next)
			if (settings) settings = { ...settings, local: written }
			saved = true
			clearTimeout(timer)
			timer = setTimeout(() => (saved = false), 1600)
		} catch (e) {
			saveError = message(e)
		}
	}

	/** what this user set for a role on an agent: the part for that agent, else a hand-written one for any agent */
	const mine = (role: Role, agent: Agent, field: keyof RoleSettings) => local.roles?.[role]?.[agent]?.[field] ?? local.roles?.[role]?.[field]

	/** set one field of a role on an agent, or (with null) drop the override so the team's default applies again */
	function setRole(role: Role, agent: Agent, field: keyof RoleSettings, value: string | null) {
		const roles = $state.snapshot(local.roles ?? {}) as NonNullable<LocalSettings['roles']>
		const whole = { ...roles[role] }
		const part: Partial<RoleSettings> = { ...whole[agent] }
		if (value === null || value === '') {
			delete part[field]
			// a hand-written setting for any agent would shine through: dropping the override drops that too
			delete whole[field]
		} else part[field] = value
		if (Object.keys(part).length) whole[agent] = part
		else delete whole[agent]
		if (Object.keys(whole).length) roles[role] = whole
		else delete roles[role]
		void save({ ...(local.agent ? { agent: local.agent } : {}), ...(Object.keys(roles).length ? { roles } : {}) })
	}

	function setAgent(agent: AgentCli) {
		void save({ ...(agent ? { agent } : {}), ...(local.roles && Object.keys(local.roles).length ? { roles: local.roles } : {}) })
	}

	function startCustom(role: Role, agent: Agent, value: string) {
		custom = `${role}:${agent}`
		typed = value === 'default' ? '' : value
	}
	function commitCustom(role: Role, agent: Agent) {
		const value = typed.trim()
		custom = null
		if (value !== (mine(role, agent, 'model') ?? '')) setRole(role, agent, 'model', value || null)
	}

	const roleHint: Record<Role, string> = {
		planner: 'Turns a ticket into a plan: reads the code, names the files, says how it will be checked.',
		builder: 'Builds the plan on the branch of the ticket, and fixes what the checks or the review send back.',
		reviewer: 'Reads the diff against the plan and the rules, and passes it or asks for changes.',
	}
	const AGENTS: Agent[] = ['claude', 'codex']
	const agentName: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' }
	const agents: { value: AgentCli; label: string }[] = [
		{ value: null, label: 'Auto' },
		{ value: 'claude', label: 'Claude Code' },
		{ value: 'codex', label: 'Codex' },
	]

	/** The models to pick from on an agent: its default first, named with what it stands for, then its list. */
	function modelOptions(agent: Agent): Option[] {
		const c = settings!.catalog[agent]
		return [
			{ value: 'default', label: c.defaultModel ? `Default (${c.defaultModel.label})` : 'Default', detail: c.defaultModel?.id ?? null, note: `Whatever ${agentName[agent]} uses by default: works on any subscription` },
			...c.models.map((m) => ({ value: m.value, label: m.label, detail: m.id && m.id !== m.value ? m.id : m.value !== m.label ? m.value : null, note: m.note })),
		]
	}
	function effortOptions(agent: Agent): Option[] {
		const c = settings!.catalog[agent]
		return [{ value: 'default', label: c.defaultEffort ? `Default (${c.defaultEffort})` : 'Default', note: `Whatever ${agentName[agent]} uses by default` }, ...c.efforts.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]
	}
	/** a saved value as the team line names it: with its version when the list knows it */
	const named = (agent: Agent, model: string) => modelOptions(agent).find((o) => o.value === model)?.label ?? model

	/** 34336 -> "34K": how much a run took, at a glance */
	const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))
	const cost = (usd: number) => (usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`)
	/** what a run took, as far as its agent reported it */
	const took = (r: LastRun) =>
		[r.effort && `effort ${r.effort}`, r.turns !== null && `${r.turns} turns`, r.tokens !== null && `${short(r.tokens)} tokens`, r.costUsd !== null && `${cost(r.costUsd)} at API prices`].filter(Boolean).join(' · ')
</script>

{#snippet segmented(label: string, options: { value: string | null; label: string }[], current: string | null, set: (v: string | null) => void)}
	<div class="flex h-8 w-fit max-w-full items-center overflow-x-auto rounded-lg bg-muted p-[3px]" role="group" aria-label={label}>
		{#each options as o (o.value ?? 'auto')}
			<button
				type="button"
				class={cn('h-full shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground capitalize transition-colors hover:text-foreground', current === o.value && 'bg-background text-foreground shadow-xs dark:bg-input/60')}
				aria-pressed={current === o.value}
				onclick={() => set(o.value)}
			>
				{o.label}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet teamLine(team: string, overridden: boolean, reset: () => void)}
	<p class="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
		<span>Team default: <span class="text-foreground/80">{team}</span></span>
		{#if overridden}
			<span class="rounded-full bg-primary/15 px-1.5 text-[0.6875rem] font-medium text-primary">yours</span>
			<Button variant="ghost" size="xs" class="h-6 text-muted-foreground" onclick={reset}><RotateCcwIcon />Use the team default</Button>
		{/if}
	</p>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<Button variant="ghost" size="icon-sm" class="-ms-2 shrink-0" onclick={() => tile.go({ view: 'home' })} aria-label="Back to Home"><ArrowLeftIcon /></Button>
		<CpuIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">Models and effort</h1>
			<p class="truncate text-xs text-muted-foreground">Which model each role runs on, and how hard it thinks</p>
		</div>
		{#if saved}<span class="ms-auto shrink-0 rounded-full bg-tone-green/15 px-2 py-0.5 text-[0.6875rem] font-medium text-tone-green">Saved</span>{/if}
	</header>

	{#if app.info && !app.info.hasFactory}
		<EmptyState icon={CpuIcon} title="No factory in this repo yet" glow>
			<p>Models and effort are the factory's: each role it runs (planner, builder, reviewer) can use a model of its own.</p>
			<InstallCommand />
		</EmptyState>
	{:else if error}
		<EmptyState icon={TriangleAlertIcon} title="Can't read the model settings">
			<p class="font-mono text-xs text-destructive/90">{error}</p>
		</EmptyState>
	{:else if !settings}
		<p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderIcon class="size-4 animate-spin" />Loading…</p>
	{:else}
		{@const team = settings.team}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="mx-auto max-w-3xl space-y-4 p-4 @2xl/pane:p-6">
				<div class="space-y-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
					<p class="flex items-center gap-2"><LockIcon class="size-3.5 shrink-0" /><span>Yours only: saved in <span class="font-mono text-foreground/80">.factory/local.json</span>, which git ignores</span></p>
					<p class="flex items-center gap-2"><InfoIcon class="size-3.5 shrink-0" /><span>Each role has a model for Claude Code and one for Codex: the one that runs the stages is the one that counts. <span class="font-medium text-foreground/80">Default</span> works on any subscription</span></p>
				</div>
				{#if saveError}<p class="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{saveError}</p>{/if}

				<section class="rounded-xl border bg-card p-4" aria-label="Agent">
					<h2 class="text-sm font-semibold tracking-tight">Agent</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">Which agent CLI runs the stages. Auto uses the one the factory finds on this machine.</p>
					<div class="mt-3">
						{@render segmented('Agent', agents, local.agent ?? null, (v) => setAgent(v as AgentCli))}
					</div>
					{@render teamLine('auto', !!local.agent, () => setAgent(null))}
					<!-- what "default" means here: each CLI's own setting, large enough to read at a glance -->
					<div class="mt-4 grid gap-3 @xl/pane:grid-cols-2" aria-label="What default means">
						{#each AGENTS as agent (agent)}
							{@const c = settings.catalog[agent]}
							<div class="glow-card rounded-lg border p-3" data-default={agent}>
								<p class="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{agentName[agent]}'s default</p>
								{#if c.defaultModel}
									<p class="mt-1 text-lg leading-tight font-semibold tracking-tight">{c.defaultModel.label}</p>
									<p class="mt-0.5 font-mono text-xs text-muted-foreground">
										{c.defaultModel.id}{#if c.defaultEffort}<span class="ms-1.5 font-sans">· effort {c.defaultEffort}</span>{/if}
									</p>
								{:else}
									<p class="mt-1 text-sm font-medium">Chosen by {agentName[agent]}</p>
									<p class="mt-0.5 text-xs text-muted-foreground">It does not say which model: the exact one shows under a role after its first run.</p>
								{/if}
							</div>
						{/each}
					</div>
				</section>

				{#each ROLES as role (role)}
					<section class="rounded-xl border bg-card p-4" aria-label={role}>
						<h2 class="text-sm font-semibold tracking-tight capitalize">{role}</h2>
						<p class="mt-0.5 text-xs text-muted-foreground">{roleHint[role]}</p>
						{#each AGENTS as agent (agent)}
							{@const t = team[role][agent]}
							{@const model = mine(role, agent, 'model') ?? t.model}
							{@const effort = mine(role, agent, 'effort') ?? t.effort}
							{@const last = settings.lastRuns[role]?.[agent]}
							{@const typing = custom === `${role}:${agent}`}
							<div class="mt-4 border-t pt-3" data-settings="{role}:{agent}">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{agentName[agent]}</h3>
								<div class="mt-2 grid gap-x-4 gap-y-3 @2xl/pane:grid-cols-[minmax(0,1fr)_12rem]">
									<div class="min-w-0">
										<p class="mb-1.5 text-xs font-medium">Model</p>
										<div class="flex gap-1.5">
											{#if typing}
												<!-- svelte-ignore a11y_autofocus -- the field was just asked for -->
												<input
													bind:value={typed}
													autofocus
													spellcheck="false"
													autocomplete="off"
													maxlength="100"
													placeholder="a model name or id, as {agentName[agent]} takes it"
													aria-label="Custom model of the {role} on {agentName[agent]}"
													onkeydown={(e) => {
														if (e.key === 'Enter') commitCustom(role, agent)
														if (e.key === 'Escape') custom = null
													}}
													class="h-9 min-w-0 flex-1 rounded-md border border-ring bg-background px-2.5 font-mono text-sm ring-3 ring-ring/30 outline-none placeholder:font-sans placeholder:text-muted-foreground/60"
												/>
												<Button variant="outline" size="icon" class="size-9 shrink-0" onclick={() => commitCustom(role, agent)} aria-label="Use this model"><CheckIcon /></Button>
												<Button variant="ghost" size="icon" class="size-9 shrink-0" onclick={() => (custom = null)} aria-label="Back to the list"><XIcon /></Button>
											{:else}
												<Select class="flex-1" options={modelOptions(agent)} value={model} label="Model of the {role} on {agentName[agent]}" onchange={(v) => setRole(role, agent, 'model', v)} />
												<Button
													variant="outline"
													size="icon"
													class="size-9 shrink-0"
													onclick={() => startCustom(role, agent, model)}
													aria-label="Type a model for the {role} on {agentName[agent]}"
													title="Type a model that is not in the list"
												>
													<PencilLineIcon />
												</Button>
											{/if}
										</div>
										{@render teamLine(named(agent, t.model), mine(role, agent, 'model') !== undefined, () => setRole(role, agent, 'model', null))}
									</div>
									<div class="min-w-0">
										<p class="mb-1.5 text-xs font-medium">Effort</p>
										<Select options={effortOptions(agent)} value={effort} label="Effort of the {role} on {agentName[agent]}" onchange={(v) => setRole(role, agent, 'effort', v)} />
										{@render teamLine(effortOptions(agent).find((o) => o.value === t.effort)?.label ?? t.effort, mine(role, agent, 'effort') !== undefined, () => setRole(role, agent, 'effort', null))}
									</div>
								</div>
								<!-- the version behind the name: what this role really ran on, and what that took -->
								<p class="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs" data-last-run="{role}:{agent}">
									{#if last}
										<span class="text-muted-foreground">Last ran on</span>
										<span class="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">{last.model}</span>
										<span class="text-muted-foreground">{took(last) ? `${took(last)} · ` : ''}{ago(last.at)}</span>
									{:else}
										<span class="text-muted-foreground">Not run on {agentName[agent]} yet.</span>
									{/if}
								</p>
							</div>
						{/each}
					</section>
				{/each}
			</div>
		</div>
	{/if}
</div>
