<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check'
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed'
	import MinusIcon from '@lucide/svelte/icons/minus'
	import XIcon from '@lucide/svelte/icons/x'
	import type { CheckState } from '$shared/api'
	import { cn } from '$lib/utils'

	let { state, class: className }: { state: CheckState; class?: string } = $props()

	const look = {
		SUCCESS: { icon: CheckIcon, tone: 'text-tone-green', label: 'Checks pass' },
		FAILURE: { icon: XIcon, tone: 'text-destructive', label: 'Checks fail' },
		PENDING: { icon: CircleDashedIcon, tone: 'text-tone-amber', label: 'Checks running' },
		NEUTRAL: { icon: MinusIcon, tone: 'text-muted-foreground', label: 'Skipped' },
	} as const
	const Icon = $derived(look[state].icon)
</script>

<Icon class={cn('size-3.5 shrink-0', look[state].tone, className)} aria-label={look[state].label} />
