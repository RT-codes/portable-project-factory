import { SvelteMap } from 'svelte/reactivity'
import type { AgentEntry } from '$shared/api'
import { api, message } from './api'

// The agent files of the open project (the Agents view lists them, the editor changes them), and the edits not
// saved yet. Drafts are kept here, by path, and not in the editor: a file whose panel was closed or pointed at
// something else still has its unsaved text when it is opened again.

class Agents {
  entries = $state<AgentEntry[] | null>(null)
  error = $state<string | null>(null)
  /** path -> the text as edited, for files that differ from what is on disk */
  drafts = new SvelteMap<string, string>()
  #project: string | null = null

  /** Read the list again. Called when the view opens, when the window gets focus, and after every change. */
  async refresh(project: string) {
    if (project !== this.#project) {
      this.#project = project
      this.entries = null
      this.drafts.clear()
    }
    try {
      const next = await api.agentFiles(project)
      if (project === this.#project) {
        this.entries = next
        this.error = null
      }
    } catch (e) {
      if (project === this.#project) this.error = message(e)
    }
  }

  /** A file was renamed or moved: its draft goes with it. */
  moved(from: string, to: string) {
    for (const [path, text] of [...this.drafts]) {
      if (path === from || path.startsWith(from + '/')) {
        this.drafts.delete(path)
        this.drafts.set(to + path.slice(from.length), text)
      }
    }
  }

  removed(path: string) {
    for (const key of [...this.drafts.keys()]) if (key === path || key.startsWith(path + '/')) this.drafts.delete(key)
  }
}

export const agents = new Agents()

/** What a new file starts with, by where it is made: an agent gets the frontmatter Claude Code reads. */
export function templateFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  if (/^\.claude\/agents\/[^/]+\.md$/.test(path)) {
    return `---\nname: ${name}\ndescription: When to use this agent, in a sentence.\ntools: Read, Grep, Glob\n---\n\nYou are the ${name}. Say here what it does, what it reads, and what it writes.\n`
  }
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)) {
    const skill = path.split('/').at(-2)
    return `---\nname: ${skill}\ndescription: What this skill does and when to use it.\n---\n\n# ${skill}\n\nThe steps to follow.\n`
  }
  // a skill of the repo, for any agent: when to use it, the steps, the traps, how to tell it is done
  if (/^\.factory\/skills\/[^/]+\.md$/.test(path)) {
    return `---\nname: ${name}\ndescription: Use when ... (one sentence, in the words a task would use: it is all an agent sees before reading this).\n---\n\n# ${name}\n\n## Steps\n1. The first thing to do, with the real command or file.\n2. The next, and why the order matters.\n\n## Watch out\n- The trap: what looks right here and is wrong.\n\n## Done when\n- A check an agent and a reviewer can run.\n`
  }
  if (/^\.claude\/commands\/.+\.md$/.test(path)) return `---\ndescription: What /${name} does.\n---\n\nThe prompt this command sends.\n`
  if (path.endsWith('.json')) return '{}\n'
  if (path.endsWith('.md')) return `# ${name}\n`
  return ''
}

/** YAML frontmatter at the top of a markdown file, as its lines and the text after it. null when there is none. */
export function frontmatter(text: string): { fields: { key: string; value: string }[]; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return null
  const fields: { key: string; value: string }[] = []
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) fields.push({ key: kv[1], value: kv[2] })
    // a continuation of the value above (a folded description, a list item)
    else if (fields.length && line.trim()) fields[fields.length - 1].value += (fields[fields.length - 1].value ? ' ' : '') + line.trim()
  }
  return { fields, body: text.slice(m[0].length) }
}
