import path from 'node:path'
import type { GraphEdge, GraphNode, ImportGraph } from '../shared/api'
import { readMany, tree } from './git'

// Which files import which, around the files a diff touches: what a change reaches, and what it leans on.
// Imports are read with regular expressions, not a parser. That is deliberate: it is fast, works on any revision
// without installing the project, and a missed edge only costs a line in a picture.

const JS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'svelte', 'vue', 'astro']
const STYLE = ['css', 'scss', 'sass', 'less']
const SOURCE = new Set([...JS, ...STYLE, 'py'])
/** tried in order when an import names no extension */
const RESOLVE_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'svelte', 'vue', 'd.ts', 'json', 'css', 'scss']
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|vendor|\.next|\.svelte-kit|__pycache__|\.venv|venv)\//

const MAX_FILES = 6000
const MAX_SIZE = 400_000
/** dependents shown per changed file before the rest fold into a count */
const MAX_DEPENDENTS = 8
/** project files sent for the map; past that, the ones furthest from the change are left off */
const MAX_MAP = 5000

const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const join = (...parts: string[]) => path.posix.normalize(parts.filter(Boolean).join('/'))

const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g
const CSS_IMPORT = /@(?:import|use|forward)\s+(?:url\()?\s*(['"])([^'"\n]+)\1/g
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+\(?([^\n#]*)/gm
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm

interface Alias {
  /** the folder the config applies to ('' is the repo root) */
  scope: string
  /** "$lib/" or "@/": a prefix, or an exact name when `exact` */
  prefix: string
  exact: boolean
  /** repo paths the prefix maps to */
  targets: string[]
}

/** `paths` from every tsconfig/jsconfig in the tree, plus SvelteKit's `$lib`. */
function readAliases(configs: Map<string, string>, files: Set<string>): Alias[] {
  const aliases: Alias[] = []
  for (const [file, raw] of configs) {
    let json: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    try {
      // tsconfig allows comments and trailing commas
      json = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
    } catch {
      continue
    }
    const scope = dir(file)
    const base = join(scope, json.compilerOptions?.baseUrl ?? '.')
    for (const [key, values] of Object.entries(json.compilerOptions?.paths ?? {})) {
      if (!Array.isArray(values)) continue
      const exact = !key.endsWith('*')
      aliases.push({
        scope,
        prefix: exact ? key : key.slice(0, -1),
        exact,
        targets: values.map((v) => join(base, exact ? v : v.replace(/\*$/, ''))).map((t) => (t === '.' ? '' : t)),
      })
    }
  }
  for (const f of files) {
    if (/(^|\/)svelte\.config\.[cm]?[jt]s$/.test(f)) {
      const scope = dir(f)
      aliases.push({ scope, prefix: '$lib/', exact: false, targets: [join(scope, 'src/lib')] }, { scope, prefix: '$lib', exact: true, targets: [join(scope, 'src/lib')] })
    }
  }
  // the nearest config wins
  return aliases.sort((a, b) => b.scope.length - a.scope.length)
}

function resolveFile(candidate: string, files: Set<string>): string | null {
  const c = candidate.replace(/^\.\//, '')
  if (files.has(c)) return c
  for (const e of RESOLVE_EXT) if (files.has(`${c}.${e}`)) return `${c}.${e}`
  // "./x.js" in TypeScript source means x.ts
  const m = c.match(/^(.*)\.([cm]?)js(x?)$/)
  if (m) for (const e of [`${m[2]}ts${m[3]}`, 'ts', 'tsx']) if (files.has(`${m[1]}.${e}`)) return `${m[1]}.${e}`
  for (const e of RESOLVE_EXT) if (files.has(`${c}/index.${e}`)) return `${c}/index.${e}`
  // a Sass partial: "a/b" is a/_b.scss
  const partial = join(dir(c), `_${c.slice(c.lastIndexOf('/') + 1)}`)
  for (const e of STYLE) if (files.has(`${partial}.${e}`)) return `${partial}.${e}`
  return null
}

function resolveJs(from: string, spec: string, files: Set<string>, aliases: Alias[]): string | null {
  const clean = spec.replace(/[?#].*$/, '')
  if (clean.startsWith('.')) return resolveFile(join(dir(from), clean), files)
  if (clean.startsWith('/')) return resolveFile(clean.slice(1), files)
  for (const a of aliases) {
    if (a.scope && !from.startsWith(a.scope + '/')) continue
    if (a.exact ? clean !== a.prefix : !clean.startsWith(a.prefix)) continue
    for (const t of a.targets) {
      const hit = resolveFile(a.exact ? t : join(t, clean.slice(a.prefix.length)), files)
      if (hit) return hit
    }
  }
  return null
}

function resolvePy(from: string, module: string, files: Set<string>): string | null {
  const dots = module.match(/^\.*/)![0].length
  const rest = module.slice(dots).split('.').filter(Boolean).join('/')
  const hit = (base: string) => {
    const p = join(base, rest)
    if (rest && files.has(`${p}.py`)) return `${p}.py`
    if (files.has(join(p, '__init__.py'))) return join(p, '__init__.py')
    return null
  }
  if (dots > 0) {
    let base = dir(from)
    for (let i = 1; i < dots; i++) base = dir(base)
    return hit(base)
  }
  // an absolute import: its root is the repo, or any folder above the importing file (src/, a package root)
  for (let base = dir(from); ; base = dir(base)) {
    const found = hit(base)
    if (found) return found
    if (!base) return null
  }
}

function importsOf(file: string, source: string, files: Set<string>, aliases: Alias[]): Set<string> {
  const found = new Set<string>()
  const add = (target: string | null) => target && target !== file && found.add(target)
  const kind = ext(file)
  if (kind === 'py') {
    for (const m of source.matchAll(PY_FROM)) {
      add(resolvePy(file, m[1], files))
      // "from pkg import mod" may name a module, not a symbol
      for (const name of m[2].split(',')) {
        const n = name.trim().split(/\s+/)[0]
        if (/^\w+$/.test(n)) add(resolvePy(file, m[1].endsWith('.') ? m[1] + n : `${m[1]}.${n}`, files))
      }
    }
    for (const m of source.matchAll(PY_IMPORT)) for (const name of m[1].split(',')) add(resolvePy(file, name.trim(), files))
    return found
  }
  if (STYLE.includes(kind)) {
    for (const m of source.matchAll(CSS_IMPORT)) add(resolveJs(file, m[2].startsWith('.') || m[2].startsWith('/') ? m[2] : `./${m[2]}`, files, aliases))
    return found
  }
  for (const m of source.matchAll(JS_IMPORT)) add(resolveJs(file, m[2], files, aliases))
  for (const m of source.matchAll(CSS_IMPORT)) add(resolveJs(file, m[2], files, aliases))
  return found
}

export async function importGraph(repo: string, at: string, changed: string[]): Promise<ImportGraph> {
  const all = (await tree(repo, at)).map((f) => f.path)
  const files = new Set(all)
  const changedSet = new Set(changed)
  let sources = all.filter((p) => SOURCE.has(ext(p)) && (!SKIP_DIR.test(p) || changedSet.has(p)))
  const partial = sources.length > MAX_FILES
  const near = (p: string) => (changedSet.has(p) ? 0 : Math.min(...changed.map((c) => distance(dir(p), dir(c)))))
  if (partial) {
    // keep the changed files and what sits nearest to them
    const rank = new Map(sources.map((p) => [p, near(p)]))
    sources = sources.sort((a, b) => rank.get(a)! - rank.get(b)!).slice(0, MAX_FILES)
  }
  const configs = all.filter((p) => /(^|\/)[tj]sconfig(\.[\w-]+)?\.json$/.test(p) && !SKIP_DIR.test(p)).slice(0, 200)
  // changed files that are not source (docs, config) are read too, only to know how long they are
  const sourceSet = new Set(sources)
  const others = changed.filter((p) => !sourceSet.has(p))
  const [texts, configTexts, otherTexts] = await Promise.all([readMany(repo, at, sources, MAX_SIZE), readMany(repo, at, configs, MAX_SIZE), readMany(repo, at, others, MAX_SIZE)])
  const lines: Record<string, number> = {}
  for (const [file, source] of [...texts, ...otherTexts]) lines[file] = source ? source.split('\n').length - (source.endsWith('\n') ? 1 : 0) : 0
  const aliases = readAliases(configTexts, files)

  const imports = new Map<string, Set<string>>()
  for (const [file, source] of texts) imports.set(file, importsOf(file, source, files, aliases))

  const nodes = new Map<string, GraphNode>(changed.map((p) => [p, { path: p, kind: 'changed' }]))
  const edges: GraphEdge[] = []
  const dependents = new Map<string, string[]>()
  for (const [from, targets] of imports) {
    for (const to of targets) {
      const fromChanged = changedSet.has(from)
      const toChanged = changedSet.has(to)
      if (fromChanged && toChanged) edges.push({ from, to })
      else if (fromChanged) {
        if (!nodes.has(to)) nodes.set(to, { path: to, kind: 'dependency' })
        edges.push({ from, to })
      } else if (toChanged) dependents.set(to, [...(dependents.get(to) ?? []), from])
    }
  }
  // A widely used file can have hundreds of dependents. Show the nearest few and count the rest.
  for (const [to, froms] of dependents) {
    const shown = froms.sort((a, b) => distance(dir(a), dir(to)) - distance(dir(b), dir(to)) || a.localeCompare(b)).slice(0, MAX_DEPENDENTS)
    for (const from of shown) {
      // a file can be both: imported by one changed file and importing another. Dependent is the more telling role.
      nodes.set(from, { path: from, kind: 'dependent' })
      edges.push({ from, to })
    }
    if (froms.length > shown.length) nodes.get(to)!.hiddenDependents = froms.length - shown.length
  }
  // The map of the project: every file in it (and the changed ones that are gone from it); in a huge repo, the
  // files of the graph and what is nearest to the change.
  let shown = [...new Set([...all, ...nodes.keys()])]
  const total = shown.length
  if (shown.length > MAX_MAP) {
    const rank = new Map(shown.map((p) => [p, nodes.has(p) ? -1 : near(p)]))
    shown = shown.sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b)).slice(0, Math.max(MAX_MAP, nodes.size))
  }
  shown.sort((a, b) => a.localeCompare(b))
  return { nodes: [...nodes.values()], edges, files: shown, lines, hiddenFiles: Math.max(0, total - shown.length), scanned: texts.size, partial }
}

/** How many folder steps apart two folders are. */
function distance(a: string, b: string): number {
  const x = a ? a.split('/') : []
  const y = b ? b.split('/') : []
  let same = 0
  while (same < x.length && same < y.length && x[same] === y[same]) same++
  return x.length + y.length - 2 * same
}
