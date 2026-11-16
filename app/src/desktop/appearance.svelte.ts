import { defaultSyntax } from './lib/highlight'

// The look of the desktop app: the built-in themes and the ones the user saves. A theme is a base palette (dark
// or light, from app.css) plus whatever it changes: colours, the border width, the corner radius, cut corners, the
// fonts and their sizes, the syntax palette. It is applied by setting CSS variables and a few data attributes on
// <html>, so everything follows at once.

export const CORNERS = ['tl', 'tr', 'br', 'bl'] as const
export type Corner = (typeof CORNERS)[number]
export const CUT_SHAPES = ['bevel', 'notch', 'scoop'] as const

/** Corners cut out of panels instead of rounded (CSS corner-shape, so borders and fills follow the cut). */
export interface Cut {
  on: boolean
  /** which corners are cut; the others keep the corner radius */
  corners: Record<Corner, boolean>
  /** how far along each edge the cut reaches, in px */
  size: number
  /** bevel: a straight diagonal. notch: a square step. scoop: a round bite. */
  shape: (typeof CUT_SHAPES)[number]
  /** cut buttons and fields too, at half the size */
  controls: boolean
}

export interface Theme {
  id: string
  name: string
  /** the base palette: what every colour the theme does not set falls back to */
  dark: boolean
  /** colour overrides, by CSS variable name without the dashes ("background"), as #rrggbb */
  colors: Record<string, string>
  /** width of borders and dividers, in px */
  line: number
  /** corner radius, in rem */
  radius: number
  /** font family names; empty is the app's own font */
  fontSans: string
  fontMono: string
  /** interface text size, in px (the size of 1rem) */
  fontSize: number
  /** code text size, in px */
  codeSize: number
  /** the syntax palette (one of SYNTAX_THEMES) */
  syntax: string
  cut: Cut
  /** space between split panels, and between them and the edge of the window, in px */
  gap: number
  gapOuter: number
}

const NO_CUT: Cut = { on: false, corners: { tl: false, tr: false, br: true, bl: false }, size: 12, shape: 'bevel', controls: false }
const DEFAULTS = { colors: {}, line: 1, radius: 0.625, fontSans: '', fontMono: '', fontSize: 16, codeSize: 12, cut: NO_CUT, gap: 8, gapOuter: 8 }
/** The mono font the app ships: a theme can use it for the interface too, on any machine. */
const BUNDLED_MONO = 'JetBrains Mono Variable'

/** The theme a fresh install shows. */
export const DEFAULT_THEME = 'carbon'

export const BUILTIN: Theme[] = [
  // Carbon is the theme the app starts in: Nexo's monochrome default, with its cut-corner cards.
  {
    id: 'carbon',
    name: 'Carbon',
    dark: true,
    ...DEFAULTS,
    colors: {
      background: '#000000',
      card: '#0a0a0a',
      popover: '#141414',
      muted: '#1a1a1a',
      accent: '#242424',
      code: '#070707',
      foreground: '#ffffff',
      'muted-foreground': '#9e9e9e',
      primary: '#ffffff',
      'primary-foreground': '#000000',
      glow: '#b3b3b3',
      border: '#2e2e2e',
    },
    radius: 0,
    fontSans: BUNDLED_MONO,
    fontSize: 15,
    syntax: 'min-dark',
    cut: { on: true, corners: { tl: false, tr: false, br: true, bl: false }, size: 10, shape: 'bevel', controls: false },
  },
  { id: 'dark', name: 'Themis Dark', dark: true, ...DEFAULTS, syntax: defaultSyntax(true) },
  { id: 'light', name: 'Themis Light', dark: false, ...DEFAULTS, syntax: defaultSyntax(false) },
  // Neon also comes from Nexo: its cyberpunk style.
  {
    id: 'neon',
    name: 'Neon',
    dark: true,
    ...DEFAULTS,
    colors: {
      background: '#05060f',
      card: '#10122b',
      popover: '#13152f',
      muted: '#171a3d',
      accent: '#1d1f4d',
      code: '#02030a',
      foreground: '#d6e4ff',
      'muted-foreground': '#8a96d6',
      primary: '#00f0ff',
      'primary-foreground': '#02030a',
      glow: '#00f0ff',
      border: '#2a2f6b',
      'tone-green': '#39ff88',
      'tone-rose': '#ff2bd6',
      'tone-amber': '#fcee0c',
      'tone-sky': '#4d9fff',
      'tone-violet': '#b388ff',
      destructive: '#ff3860',
    },
    radius: 0,
    fontSans: BUNDLED_MONO,
    fontSize: 15,
    syntax: 'synthwave-84',
    cut: { on: true, corners: { tl: true, tr: false, br: true, bl: false }, size: 12, shape: 'bevel', controls: true },
  },
]

/** The colours a theme can set, as the settings list them. */
export const COLOR_GROUPS: { title: string; colors: { key: string; label: string }[] }[] = [
  {
    title: 'Surfaces',
    colors: [
      { key: 'background', label: 'Background' },
      { key: 'card', label: 'Cards' },
      { key: 'popover', label: 'Menus' },
      { key: 'muted', label: 'Muted fill' },
      { key: 'accent', label: 'Hover' },
      { key: 'code', label: 'Code blocks' },
    ],
  },
  {
    title: 'Text',
    colors: [
      { key: 'foreground', label: 'Text' },
      { key: 'muted-foreground', label: 'Secondary' },
    ],
  },
  {
    title: 'Accent',
    colors: [
      { key: 'primary', label: 'Buttons' },
      { key: 'primary-foreground', label: 'Button text' },
      { key: 'glow', label: 'Highlight' },
    ],
  },
  { title: 'Lines', colors: [{ key: 'border', label: 'Borders' }] },
  {
    title: 'Status',
    colors: [
      { key: 'tone-green', label: 'Added' },
      { key: 'tone-rose', label: 'Removed' },
      { key: 'tone-amber', label: 'Warning' },
      { key: 'tone-sky', label: 'Info' },
      { key: 'tone-violet', label: 'Merged' },
      { key: 'destructive', label: 'Error' },
    ],
  },
]

/** Variables that follow a colour the settings do list, so a theme stays coherent without listing thirty of them. */
const FOLLOWS: Record<string, string[]> = {
  foreground: ['card-foreground', 'popover-foreground', 'accent-foreground', 'secondary-foreground'],
  muted: ['secondary'],
  border: ['input'],
}

const FONT_FALLBACK = { sans: 'ui-sans-serif, system-ui, sans-serif', mono: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
/** Offered when the system's fonts cannot be listed. */
const COMMON_FONTS = {
  sans: ['Inter', 'Segoe UI', 'SF Pro Text', 'Helvetica Neue', 'Roboto', 'Ubuntu', 'Noto Sans', 'IBM Plex Sans', 'Arial', 'Verdana', 'Georgia'],
  mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'Menlo', 'Consolas', 'Source Code Pro', 'IBM Plex Mono', 'Hack', 'Ubuntu Mono', 'Courier New'],
}

const STORE = 'factory-appearance'
const HEX = /^#[0-9a-f]{6}$/i

/** A font name fit to put in a CSS value: nothing that could end the value or the declaration. */
const fontName = (name: string) => name.replace(/["'\\;{}<>]/g, '').trim().slice(0, 80)

/**
 * What a theme sets on <html>: CSS variables (--name) and data attributes (data-name). Only what differs from
 * app.css, so the plain built-in themes set nothing.
 */
export function settingsOf(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.colors)) {
    if (!HEX.test(value)) continue
    vars[`--${key}`] = value
    for (const follower of FOLLOWS[key] ?? []) vars[`--${follower}`] = value
    if (key === 'primary') vars['--ring'] = `color-mix(in oklab, ${value} 60%, transparent)`
  }
  if (theme.line !== DEFAULTS.line) vars['--line'] = `${theme.line}px`
  if (theme.radius !== DEFAULTS.radius) vars['--radius'] = `${theme.radius}rem`
  if (fontName(theme.fontSans)) vars['--app-font-sans'] = `"${fontName(theme.fontSans)}", 'Inter Variable', ${FONT_FALLBACK.sans}`
  if (fontName(theme.fontMono)) vars['--app-font-mono'] = `"${fontName(theme.fontMono)}", 'JetBrains Mono Variable', ${FONT_FALLBACK.mono}`
  if (theme.fontSize !== DEFAULTS.fontSize) vars['--ui-size'] = `${theme.fontSize}px`
  if (theme.codeSize !== DEFAULTS.codeSize) vars['--code-size'] = `${theme.codeSize}px`
  if (theme.gap !== DEFAULTS.gap) vars['--pane-gap'] = `${theme.gap}px`
  if (theme.gapOuter !== DEFAULTS.gapOuter) vars['--pane-outer'] = `${theme.gapOuter}px`
  const corners = CORNERS.filter((c) => theme.cut.corners[c])
  if (theme.cut.on && corners.length > 0) {
    // app.css turns these into corner shapes: data-cut lists the corners, as in data-cut="tl br"
    vars['data-cut'] = corners.join(' ')
    vars['--cut-size'] = `${theme.cut.size}px`
    vars['--cut-shape'] = theme.cut.shape
    if (theme.cut.controls) vars['data-cut-controls'] = ''
  }
  return vars
}

function sanitizeCut(raw: unknown): Cut {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Cut>
  const corners = (c.corners && typeof c.corners === 'object' ? c.corners : {}) as Partial<Record<Corner, unknown>>
  return {
    on: c.on === true,
    corners: { tl: corners.tl === true, tr: corners.tr === true, br: corners.br === undefined ? NO_CUT.corners.br : corners.br === true, bl: corners.bl === true },
    size: clamp(c.size, 2, 40, NO_CUT.size),
    shape: CUT_SHAPES.includes(c.shape as Cut['shape']) ? (c.shape as Cut['shape']) : 'bevel',
    controls: c.controls === true,
  }
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback)

/**
 * A theme from outside the running app (storage, an imported file): every field checked and brought into range,
 * since it is only as good as what wrote it. null when it is not a theme at all.
 */
export function sanitize(raw: unknown, builtin = false): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<Theme>
  // a theme of the user's own may not pose as a built-in one; a saved edit of a built-in theme must be one
  if (typeof t.id !== 'string' || !t.id || BUILTIN.some((b) => b.id === t.id) !== builtin) return null
  const dark = t.dark !== false
  return {
    id: t.id,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 60) : 'Untitled',
    dark,
    colors: Object.fromEntries(Object.entries(t.colors ?? {}).filter(([k, v]) => /^[a-z-]+$/.test(k) && typeof v === 'string' && HEX.test(v))),
    line: clamp(t.line, 0, 4, DEFAULTS.line),
    radius: clamp(t.radius, 0, 1.5, DEFAULTS.radius),
    fontSans: typeof t.fontSans === 'string' ? fontName(t.fontSans) : '',
    fontMono: typeof t.fontMono === 'string' ? fontName(t.fontMono) : '',
    fontSize: clamp(t.fontSize, 12, 22, DEFAULTS.fontSize),
    codeSize: clamp(t.codeSize, 9, 20, DEFAULTS.codeSize),
    syntax: typeof t.syntax === 'string' ? t.syntax : defaultSyntax(dark),
    cut: sanitizeCut(t.cut),
    gap: clamp(t.gap, 0, 48, DEFAULTS.gap),
    gapOuter: clamp(t.gapOuter, 0, 48, DEFAULTS.gapOuter),
  }
}

class Appearance {
  /** the themes the user saved */
  custom = $state<Theme[]>([])
  /** built-in themes the user changed and saved, by id: shown in place of the original until reset */
  edited = $state<Record<string, Theme>>({})
  activeId = $state(DEFAULT_THEME)
  /** edits not saved yet: shown live, gone when discarded or when another theme is picked */
  draft = $state<Theme | null>(null)
  /** font families to suggest; the system's own once they could be listed */
  fonts = $state<{ sans: string[]; mono: string[] }>(COMMON_FONTS)

  themes = $derived([...BUILTIN.map((b) => this.edited[b.id] ?? b), ...this.custom])
  active = $derived(this.themes.find((t) => t.id === this.activeId) ?? BUILTIN[0])
  /** what is on screen */
  current = $derived(this.draft ?? this.active)
  dirty = $derived(this.draft !== null)
  isBuiltin = $derived(BUILTIN.some((t) => t.id === this.activeId))

  #applied: string[] = []
  #base = new Map<string, string>()
  #fontsAsked = false

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) {
        this.custom = (Array.isArray(saved.custom) ? saved.custom : []).map((raw: unknown) => sanitize(raw)).filter((t: Theme | null): t is Theme => t !== null)
        for (const raw of Object.values(saved.edited && typeof saved.edited === 'object' ? saved.edited : {})) {
          const theme = sanitize(raw, true)
          // its name stays the built-in's own
          if (theme) this.edited[theme.id] = { ...theme, name: BUILTIN.find((b) => b.id === theme.id)!.name }
        }
        this.activeId = typeof saved.activeId === 'string' ? saved.activeId : DEFAULT_THEME
      } else if (localStorage.getItem('factory-theme') === 'light') {
        // the light/dark choice made before there were themes
        this.activeId = 'light'
      }
      if (!this.themes.some((t) => t.id === this.activeId)) this.activeId = DEFAULT_THEME
      // a first start: leave the theme where public/theme.js finds it, so the next start paints it at once
      if (!saved) this.#persist()
    } catch {
      /* unreadable storage: the default theme */
    }
    if (!this.themes.some((t) => t.id === this.activeId)) this.activeId = DEFAULT_THEME
    this.#apply()
  }

  select(id: string) {
    if (!this.themes.some((t) => t.id === id)) return
    this.draft = null
    this.activeId = id
    this.#persist()
    this.#apply()
  }

  /** Change the theme on screen. The change is a draft until it is saved. */
  edit(patch: Partial<Omit<Theme, 'id'>>) {
    const next = { ...$state.snapshot(this.current), ...patch }
    // a theme that changes its base and kept the base's own syntax palette follows the new base
    if (patch.dark !== undefined && patch.syntax === undefined && this.current.syntax === defaultSyntax(this.current.dark)) next.syntax = defaultSyntax(patch.dark)
    this.draft = next
    this.#apply()
  }

  /** The built-in theme as it shipped, for a theme that is one (edited or not). */
  original(id: string): Theme | null {
    return BUILTIN.find((b) => b.id === id) ?? null
  }

  /** Whether a colour of the theme on screen differs from where a reset would put it. */
  isOwnColor(key: string): boolean {
    const shipped = this.original(this.current.id)?.colors[key]
    return shipped === undefined ? key in this.current.colors : this.current.colors[key] !== shipped
  }

  /**
   * Set one colour, or with null hand it back: to what the built-in theme shipped with, or, for a theme of the
   * user's own, to its base palette.
   */
  setColor(key: string, value: string | null) {
    const colors = { ...$state.snapshot(this.current.colors) }
    const shipped = this.original(this.current.id)?.colors[key]
    if (value === null && shipped !== undefined) colors[key] = shipped
    else if (value === null) delete colors[key]
    else if (HEX.test(value)) colors[key] = value.toLowerCase()
    else return
    this.edit({ colors })
  }

  /**
   * Keep the draft in the theme it was made from. A built-in theme keeps its changes too, as an edit laid over
   * the original, which `reset` takes away again.
   */
  save() {
    if (!this.draft) return
    const saved = { ...$state.snapshot(this.draft), id: this.activeId, name: this.active.name }
    if (this.isBuiltin) this.edited = { ...this.edited, [this.activeId]: saved }
    else this.custom = this.custom.map((t) => (t.id === this.activeId ? saved : t))
    this.draft = null
    this.#persist()
    this.#apply()
  }

  /** Keep what is on screen as a new theme, and switch to it. */
  saveAs(name: string): Theme {
    const taken = new Set(this.themes.map((t) => t.name.toLowerCase()))
    let unique = name.trim().slice(0, 60) || 'My theme'
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name.trim() || 'My theme'} ${n}`
    const theme: Theme = { ...$state.snapshot(this.current), id: crypto.randomUUID(), name: unique }
    this.custom = [...this.custom, theme]
    this.draft = null
    this.activeId = theme.id
    this.#persist()
    this.#apply()
    return theme
  }

  discard() {
    this.draft = null
    this.#apply()
  }

  /** Put a built-in theme back as it shipped: its saved changes go, and so does a draft on top of them. */
  reset(id: string) {
    if (!(id in this.edited)) return
    const { [id]: _gone, ...rest } = this.edited
    this.edited = rest
    if (this.activeId === id) this.draft = null
    this.#persist()
    this.#apply()
  }

  /** Change the cut corners: any of its fields, or one corner. */
  setCut(patch: Partial<Omit<Cut, 'corners'>> & { corners?: Partial<Record<Corner, boolean>> }) {
    const cut = $state.snapshot(this.current.cut)
    this.edit({ cut: { ...cut, ...patch, corners: { ...cut.corners, ...patch.corners } } })
  }

  /** What is on screen as a file's worth of JSON: a theme someone else can import. */
  export(): string {
    const { id: _id, ...theme } = $state.snapshot(this.current)
    return JSON.stringify({ factoryTheme: 1, ...theme }, null, 2) + '\n'
  }

  /** Add a theme from exported JSON and switch to it. Throws with a reason when the text is not a theme. */
  import(text: string): Theme {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('That file is not JSON.')
    }
    if (!raw || typeof raw !== 'object' || (raw as { factoryTheme?: unknown }).factoryTheme !== 1) throw new Error('That file is not a Factory theme.')
    const theme = sanitize({ ...raw, id: crypto.randomUUID() })
    if (!theme) throw new Error('That file is not a Factory theme.')
    this.draft = theme
    return this.saveAs(theme.name)
  }

  remove(id: string) {
    const theme = this.custom.find((t) => t.id === id)
    if (!theme) return
    this.custom = this.custom.filter((t) => t.id !== id)
    if (this.activeId === id) {
      this.draft = null
      this.activeId = theme.dark ? DEFAULT_THEME : 'light'
    }
    this.#persist()
    this.#apply()
  }

  /**
   * A colour of a base palette as #rrggbb, read from app.css through a hidden element that carries the palette's
   * class. Colours with transparency (the dark border is white at 9%) are flattened onto the palette's background.
   */
  baseColor(dark: boolean, key: string): string {
    const id = `${dark}:${key}`
    const hit = this.#base.get(id)
    if (hit) return hit
    const probe = document.createElement('div')
    probe.className = dark ? 'dark' : 'theme-light'
    probe.hidden = true
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.canvas.width = ctx.canvas.height = 1
    for (const layer of ['--background', `--${key}`]) {
      ctx.fillStyle = style.getPropertyValue(layer).trim() || '#000'
      ctx.fillRect(0, 0, 1, 1)
    }
    probe.remove()
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
    this.#base.set(id, hex)
    return hex
  }

  /** A colour as a theme shows it: its own, or its base palette's. */
  colorOf(theme: Theme, key: string): string {
    return theme.colors[key] ?? this.baseColor(theme.dark, key)
  }

  /** List the fonts installed on this machine, once, for the font fields to suggest. Needs a click to be allowed. */
  async loadFonts() {
    if (this.#fontsAsked) return
    this.#fontsAsked = true
    try {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
      if (!query) return
      const families = [...new Set((await query()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
      if (families.length === 0) return
      const mono = families.filter((f) => /mono|code|consol|courier|menlo|hack|terminal|fixed/i.test(f))
      this.fonts = { sans: families, mono: mono.length ? [...mono, ...families.filter((f) => !mono.includes(f))] : families }
    } catch {
      /* not allowed, or not supported: the common names stay */
    }
  }

  #apply() {
    const theme = this.current
    const root = document.documentElement
    root.classList.toggle('dark', theme.dark)
    const next = settingsOf(theme)
    // drop what the theme before set and this one does not, including what public/theme.js set before the first paint
    const stale = [...this.#applied, ...root.style, ...root.getAttributeNames().filter((n) => n.startsWith('data-cut'))]
    for (const name of stale) {
      if (name in next) continue
      if (name.startsWith('--')) root.style.removeProperty(name)
      else if (name.startsWith('data-')) root.removeAttribute(name)
    }
    for (const [name, value] of Object.entries(next)) {
      if (name.startsWith('--')) root.style.setProperty(name, value)
      else root.setAttribute(name, value)
    }
    this.#applied = Object.keys(next)
  }

  /** Save the themes, and the active one's variables where public/theme.js finds them before the next paint. */
  #persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ activeId: this.activeId, custom: this.custom, edited: this.edited }))
      localStorage.setItem('factory-theme', this.active.dark ? 'dark' : 'light')
      localStorage.setItem('factory-theme-vars', JSON.stringify(settingsOf(this.active)))
    } catch {
      /* storage is full or off: the themes last for this visit */
    }
  }
}

export const appearance = new Appearance()
