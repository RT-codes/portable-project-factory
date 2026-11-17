<script lang="ts">
	import BrainIcon from '@lucide/svelte/icons/brain'
	import FileTextIcon from '@lucide/svelte/icons/file-text'
	import MessageSquareIcon from '@lucide/svelte/icons/message-square'
	import PencilIcon from '@lucide/svelte/icons/pencil'
	import SearchIcon from '@lucide/svelte/icons/search'
	import TerminalIcon from '@lucide/svelte/icons/terminal'
	import WrenchIcon from '@lucide/svelte/icons/wrench'
	import type { StepKind } from '$lib/types'

	// The kind of thing an agent did: read, edited, ran, searched, said, thought.
	let { kind, class: className = '' }: { kind: StepKind; class?: string } = $props()

	const icons = { read: FileTextIcon, edit: PencilIcon, run: TerminalIcon, search: SearchIcon, say: MessageSquareIcon, think: BrainIcon, other: WrenchIcon }
	const Icon = $derived(icons[kind] ?? WrenchIcon)
</script>

<Icon class={className} />
