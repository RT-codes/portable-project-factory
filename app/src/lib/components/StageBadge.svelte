<script lang="ts">
	import type { Stage } from '$lib/types'
	import { toneChip, type Tone } from '$lib/board'
	import { cn } from '$lib/utils'
	import StageIcon from './StageIcon.svelte'

	let { stage, tone, class: className }: { stage: Stage; tone: Tone; class?: string } = $props()
</script>

<span class={cn('inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap', toneChip[tone], className)}>
	<StageIcon name={stage.icon} class={cn('size-3', tone === 'agent' && 'animate-pulse')} />
	{stage.label}
</span>
