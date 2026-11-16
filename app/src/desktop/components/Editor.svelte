<script lang="ts">
	import { json } from '@codemirror/lang-json'
	import { markdown } from '@codemirror/lang-markdown'
	import { yaml } from '@codemirror/lang-yaml'
	import { syntaxHighlighting } from '@codemirror/language'
	import { EditorState } from '@codemirror/state'
	import { EditorView } from '@codemirror/view'
	import { classHighlighter } from '@lezer/highlight'
	import { basicSetup } from 'codemirror'
	import { untrack } from 'svelte'
	import { keys } from '../keys.svelte'

	// A code editor (CodeMirror) for the agent files: line numbers, undo, search (Ctrl/Cmd+F), bracket matching,
	// and colours for markdown, JSON and YAML. Its look comes from the theme's variables (see app.css, .cm-*).
	let { value = $bindable(''), path, onsave }: { value?: string; path: string; onsave: () => void } = $props()

	let host = $state<HTMLElement | null>(null)
	let view: EditorView | null = null

	function language(file: string) {
		if (/\.(md|markdown|mdx)$/i.test(file)) return [markdown()]
		if (/\.(json|jsonc|mcp\.json)$/i.test(file) || /(^|\/)\.mcp\.json$/.test(file)) return [json()]
		if (/\.(ya?ml)$/i.test(file)) return [yaml()]
		return []
	}

	$effect(() => {
		if (!host) return
		const file = path
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				// the starting text, read without subscribing: typing must not rebuild the editor under the cursor
				doc: untrack(() => value),
				extensions: [
					basicSetup,
					// the save shortcut is the user's to choose (keys.svelte.ts), so it is matched here and not in a keymap
					EditorView.domEventHandlers({
						keydown: (e) => {
							if (!keys.is('editor.save', e)) return false
							e.preventDefault()
							untrack(() => onsave)()
							return true
						},
					}),
					EditorView.lineWrapping,
					syntaxHighlighting(classHighlighter),
					...language(file),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) value = update.state.doc.toString()
					}),
				],
			}),
		})
		return () => {
			view?.destroy()
			view = null
		}
	})

	// the text was replaced from outside (reverted, reloaded from disk, formatted): show that
	$effect(() => {
		const next = value
		if (view && next !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
	})

	export function focus() {
		view?.focus()
	}
</script>

<div bind:this={host} class="editor min-h-0 flex-1 overflow-hidden"></div>
