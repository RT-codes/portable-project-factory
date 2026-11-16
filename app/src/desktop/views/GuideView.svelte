<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open'
	import { renderMarkdown } from '$lib/markdown'
	import skills from '../guides/skills.md?raw'
	import { getTile } from '../pane'

	// A guide to read beside the work it is about: opened next to the Agents view when a skill is being written.
	// Guides are markdown files in src/desktop/guides/, shipped with the app.
	const tile = getTile()
	const guides: Record<string, { title: string; about: string; text: string }> = {
		skills: { title: 'Writing a skill', about: 'How to teach agents one kind of task in this repo', text: skills },
	}
	const guide = $derived(guides[tile.route.path ?? ''] ?? guides.skills)
	// the guide's own first heading is its title: the header shows it, so the page does not repeat it
	const body = $derived(guide.text.replace(/^# .*\n+/, ''))
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
		<BookOpenIcon class="size-4 shrink-0 text-muted-foreground" />
		<div class="min-w-0">
			<h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">{guide.title}</h1>
			<p class="truncate text-xs text-muted-foreground">{guide.about}</p>
		</div>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto" data-guide>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML; the text is the app's own -->
		<article class="md mx-auto max-w-2xl p-6 @2xl/pane:p-8">{@html renderMarkdown(body)}</article>
	</div>
</div>
