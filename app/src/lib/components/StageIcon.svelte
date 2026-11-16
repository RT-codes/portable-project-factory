<script lang="ts">
	import type { Component } from 'svelte'
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed'
	import { cachedIcon, loadIcon } from '$lib/icons'

	// A Lucide icon picked by name from config.json. Until the icon set has loaded, and for an unknown name, a dashed
	// circle stands in, so the board never waits on an icon or breaks on a typo.
	let { name = '', class: className }: { name?: string; class?: string } = $props()

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let loaded = $state<Component<any> | null>(null)

	$effect(() => {
		const wanted = name
		const known = wanted ? cachedIcon(wanted) : null
		if (known !== undefined) {
			loaded = known
			return
		}
		let current = true
		loadIcon(wanted).then((icon) => current && (loaded = icon))
		return () => (current = false)
	})

	const Shown = $derived(loaded ?? CircleDashedIcon)
</script>

<Shown class={className} aria-hidden="true" />
