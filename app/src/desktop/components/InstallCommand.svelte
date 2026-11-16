<script lang="ts" module>
	/** How the factory is installed into a repo: run from the repo's root. */
	export const INSTALL = 'npx -y github:RT-codes/portable-project-factory'
</script>

<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import CopyIcon from '@lucide/svelte/icons/copy'
	import DownloadIcon from '@lucide/svelte/icons/download'
	import LoaderIcon from '@lucide/svelte/icons/loader-circle'
	import { Button } from '$lib/components/ui/button/index.js'
	import { factory } from '$lib/factory.svelte'
	import { cn } from '$lib/utils'
	import { api, message } from '../api'
	import { app } from '../app.svelte'

	// How to get the factory into this repo: one button that does it from the copy the app carries, or the
	// command to run yourself (or hand to an agent).
	let { class: className }: { class?: string } = $props()

	let copied = $state(false)
	let timer: ReturnType<typeof setTimeout> | undefined
	async function copy() {
		try {
			await navigator.clipboard.writeText(INSTALL)
			copied = true
			clearTimeout(timer)
			timer = setTimeout(() => (copied = false), 1600)
		} catch {
			/* no clipboard: the command is there to select by hand */
		}
	}

	let installing = $state(false)
	let error = $state<string | null>(null)
	async function install() {
		const project = app.project
		if (!project || installing) return
		installing = true
		error = null
		try {
			await api.factoryInstall(project)
			// the repo has a factory now: every view that said it had none shows what it is for
			await app.refreshInfo()
			void factory.refresh()
		} catch (e) {
			error = message(e)
		} finally {
			installing = false
		}
	}
</script>

<div class={cn('space-y-3', className)} data-install>
	<div>
		<Button onclick={install} disabled={installing || !app.info?.isGit}>
			{#if installing}<LoaderIcon class="animate-spin" />Installing…{:else}<DownloadIcon />Install it in this repo{/if}
		</Button>
		<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
			{#if app.info && !app.info.isGit}
				This folder is not a git repository yet: run <span class="font-mono text-foreground/80">git init</span> in it first.
			{:else}
				Runs here, from this app: no download, no admin rights, no system prompt. It adds a <span class="font-mono text-foreground/80">.factory/</span> folder, a short block in
				<span class="font-mono text-foreground/80">AGENTS.md</span> and the <span class="font-mono text-foreground/80">/factory</span> skill, all inside this repo and nothing outside it. Nothing is committed for you.
			{/if}
		</p>
		{#if error}<p class="mt-2 text-xs text-destructive" role="alert">Could not install it: {error}</p>{/if}
	</div>
	<div>
		<p class="mb-1.5 text-xs text-muted-foreground">Or run this yourself at the repo's root, or hand it to your agent:</p>
		<div class="flex items-center gap-2 rounded-lg border bg-code py-1.5 ps-3 pe-1.5">
			<!-- no width of its own: a long command shortens with an ellipsis rather than widening whatever holds it -->
			<code class="w-0 min-w-0 flex-1 truncate font-mono text-xs text-foreground/90 select-all" title={INSTALL}><span class="me-2 text-muted-foreground select-none">$</span>{INSTALL}</code>
			<Button variant="ghost" size="icon-xs" class="shrink-0" onclick={copy} aria-label={copied ? 'Copied' : 'Copy the install command'} title="Copy">
				{#if copied}<CheckIcon class="text-tone-green" />{:else}<CopyIcon />{/if}
			</Button>
		</div>
	</div>
</div>
