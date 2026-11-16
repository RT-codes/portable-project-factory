import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'
import { bundledThemes, type BundledTheme } from 'shiki/themes'

// Syntax highlighting for the diff and code viewers. Grammars load on first use, one chunk per language.
// A line is kept as tokens (not HTML) so a diff can mark the changed part of a line across token boundaries.

/** One coloured run of a line. `s` is its inline style: its colour in the syntax palette it was tokenized with. */
export interface Tok {
  t: string
  s: string
}

const EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  svelte: 'svelte', vue: 'vue', astro: 'astro', py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  ps1: 'powershell', json: 'json', jsonc: 'jsonc', json5: 'json5', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', md: 'markdown',
  mdx: 'mdx', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', sass: 'sass', less: 'less', sql: 'sql',
  graphql: 'graphql', gql: 'graphql', lua: 'lua', dart: 'dart', ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', scala: 'scala',
  clj: 'clojure', r: 'r', tf: 'terraform', nix: 'nix', zig: 'zig', proto: 'proto', diff: 'diff', patch: 'diff', dockerfile: 'docker',
  prisma: 'prisma', vim: 'viml', tex: 'latex', mk: 'make',
}
const NAME: Record<string, string> = { dockerfile: 'docker', makefile: 'make', gemfile: 'ruby', rakefile: 'ruby', justfile: 'just', '.gitignore': 'ini', '.env': 'dotenv' }

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const lang = NAME[name] ?? (name.startsWith('.env') ? 'dotenv' : EXT[name.slice(name.lastIndexOf('.') + 1)])
  return lang && lang in bundledLanguages ? lang : null
}

/** Above these a file is shown plain: tokenizing it would stall the window. */
const MAX_CHARS = 300_000
const MAX_LINES = 8000

/** The syntax palettes a theme can pick from (a subset of what shiki ships), dark ones first. */
export const SYNTAX_THEMES: { id: BundledTheme; name: string; dark: boolean }[] = [
  { id: 'vitesse-dark', name: 'Vitesse Dark', dark: true },
  { id: 'github-dark-default', name: 'GitHub Dark', dark: true },
  { id: 'one-dark-pro', name: 'One Dark Pro', dark: true },
  { id: 'dracula', name: 'Dracula', dark: true },
  { id: 'tokyo-night', name: 'Tokyo Night', dark: true },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', dark: true },
  { id: 'gruvbox-dark-medium', name: 'Gruvbox Dark', dark: true },
  { id: 'nord', name: 'Nord', dark: true },
  { id: 'rose-pine', name: 'Rosé Pine', dark: true },
  { id: 'monokai', name: 'Monokai', dark: true },
  { id: 'solarized-dark', name: 'Solarized Dark', dark: true },
  { id: 'synthwave-84', name: "Synthwave '84", dark: true },
  { id: 'min-dark', name: 'Min Dark', dark: true },
  { id: 'vitesse-light', name: 'Vitesse Light', dark: false },
  { id: 'github-light-default', name: 'GitHub Light', dark: false },
  { id: 'one-light', name: 'One Light', dark: false },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', dark: false },
  { id: 'gruvbox-light-medium', name: 'Gruvbox Light', dark: false },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', dark: false },
  { id: 'solarized-light', name: 'Solarized Light', dark: false },
]
export const defaultSyntax = (dark: boolean): string => (dark ? 'vitesse-dark' : 'vitesse-light')

let core: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<void>>()

function highlighter() {
  core ??= createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) })
  return core
}

/** Load a grammar or a palette once, however many files ask for it at the same time. */
function once(key: string, load: () => Promise<void>): Promise<void> {
  let work = loaded.get(key)
  if (!work) loaded.set(key, (work = load()))
  return work
}

const cache = new Map<string, Promise<Tok[][] | null>>()
const CACHE_MAX = 300

/**
 * A file's lines as tokens coloured with a syntax palette, or null when the file has no grammar or is too big.
 * `key` names the exact content (revision and path), so a file is tokenized once per palette however often it
 * is shown.
 */
export function tokenize(key: string, path: string, text: string, theme: string): Promise<Tok[][] | null> {
  const full = `${theme}\n${key}`
  const hit = cache.get(full)
  if (hit) return hit
  const work = run(path, text, theme).catch(() => null)
  cache.set(full, work)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return work
}

async function run(path: string, text: string, theme: string): Promise<Tok[][] | null> {
  const lang = languageOf(path)
  if (!lang || text.length > MAX_CHARS || !(theme in bundledThemes)) return null
  const hl = await highlighter()
  await Promise.all([
    once(`lang:${lang}`, () => hl.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages])),
    once(`theme:${theme}`, () => hl.loadTheme(bundledThemes[theme as BundledTheme])),
  ])
  if (text.split('\n').length > MAX_LINES) return null
  const { tokens } = hl.codeToTokens(text, { lang, theme })
  return tokens.map((line) => line.map((tok) => ({ t: tok.content, s: tok.color ? `color:${tok.color}` : '' })))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * One line as HTML. `mark` is a [start, end) character range to emphasise: the part of the line that changed.
 * Without tokens the text is shown plain.
 */
export function lineHtml(toks: Tok[] | null | undefined, text: string, mark?: [number, number] | null): string {
  const runs: Tok[] = toks && toks.length ? toks : [{ t: text, s: '' }]
  let html = ''
  let pos = 0
  const span = (t: string, s: string, marked: boolean) => {
    if (!t) return
    html += `<span${s ? ` style="${s}"` : ''}${marked ? ' class="chg"' : ''}>${esc(t)}</span>`
  }
  for (const r of runs) {
    const start = pos
    const end = pos + r.t.length
    pos = end
    if (!mark || mark[1] <= start || mark[0] >= end) {
      span(r.t, r.s, false)
      continue
    }
    const a = Math.max(mark[0], start) - start
    const b = Math.min(mark[1], end) - start
    span(r.t.slice(0, a), r.s, false)
    span(r.t.slice(a, b), r.s, true)
    span(r.t.slice(b), r.s, false)
  }
  return html || ' '
}
