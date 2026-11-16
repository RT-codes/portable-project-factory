// The keyboard shortcuts: every action the keyboard can reach, the keys it has by default, and the keys the user
// gave it instead (the shortcuts panel, KeysPanel.svelte). A shortcut is written as its held modifiers and the
// physical key, "Ctrl+Alt+KeyK": the physical key (KeyboardEvent.code), so a shortcut stays on the same key in
// every keyboard layout and whatever Alt or Shift turn the character into.

const mac = window.factoryApp?.platform === 'darwin'
/** the main modifier: Cmd on a Mac, Ctrl elsewhere */
const MOD = mac ? 'Meta' : 'Ctrl'
const STORE = 'factory-keys'

export interface Action {
  id: string
  label: string
  group: string
  /** the shortcut it has until the user gives it another; null is none */
  keys: string | null
  /** set outside the page (the app's menu): shown, but not changed here */
  fixed?: boolean
}

/** The views Ctrl+1..9 open, in the sidebar's order. */
const VIEWS = [
  ['home', 'Home'],
  ['board', 'Board'],
  ['changes', 'Changes'],
  ['pulls', 'Pull requests'],
  ['issues', 'Issues'],
  ['code', 'Code'],
  ['history', 'History'],
  ['journal', 'Journal'],
  ['agents', 'Agents'],
] as const

export const ACTIONS: Action[] = [
  { id: 'keys.open', group: 'General', label: 'Keyboard shortcuts', keys: `${MOD}+Alt+KeyK` },
  { id: 'settings.open', group: 'General', label: 'Appearance settings', keys: `${MOD}+Comma` },
  { id: 'sidebar.fold', group: 'General', label: 'Fold or open the sidebar', keys: `${MOD}+KeyB` },
  { id: 'project.open', group: 'General', label: 'Open a project', keys: `${MOD}+KeyO`, fixed: true },

  { id: 'view.prev', group: 'Views', label: 'Previous view in the sidebar', keys: `${MOD}+Alt+ArrowUp` },
  { id: 'view.next', group: 'Views', label: 'Next view in the sidebar', keys: `${MOD}+Alt+ArrowDown` },
  ...VIEWS.map(([view, label], i) => ({ id: `view.${view}`, group: 'Views', label: `Go to ${label}`, keys: `${MOD}+Digit${i + 1}` })),
  // came after the nine above had their digits: it has no keys until it is given some
  { id: 'view.activity', group: 'Views', label: 'Go to Activity', keys: null },

  { id: 'pane.split.right', group: 'Panels', label: 'Split right', keys: `${MOD}+Backslash` },
  { id: 'pane.split.down', group: 'Panels', label: 'Split down', keys: `${MOD}+Shift+Backslash` },
  { id: 'pane.focus.left', group: 'Panels', label: 'Focus the panel to the left', keys: 'Alt+ArrowLeft' },
  { id: 'pane.focus.right', group: 'Panels', label: 'Focus the panel to the right', keys: 'Alt+ArrowRight' },
  { id: 'pane.focus.up', group: 'Panels', label: 'Focus the panel above', keys: 'Alt+ArrowUp' },
  { id: 'pane.focus.down', group: 'Panels', label: 'Focus the panel below', keys: 'Alt+ArrowDown' },
  { id: 'pane.rotate', group: 'Panels', label: 'Turn the split: side by side or stacked', keys: `${MOD}+Alt+KeyR` },
  { id: 'pane.swap', group: 'Panels', label: 'Swap with its neighbour', keys: `${MOD}+Alt+KeyS` },
  { id: 'pane.close', group: 'Panels', label: 'Close this panel', keys: `${MOD}+Alt+KeyW` },

  { id: 'diff.next', group: 'Review', label: 'Next file in a diff', keys: 'KeyJ' },
  { id: 'diff.prev', group: 'Review', label: 'Previous file in a diff', keys: 'KeyK' },
  { id: 'diff.viewed', group: 'Review', label: 'Mark the file as viewed', keys: 'KeyV' },
  { id: 'comment.send', group: 'Review', label: 'Send the comment being written', keys: `${MOD}+Enter` },

  { id: 'editor.save', group: 'Editor', label: 'Save the file', keys: `${MOD}+KeyS` },
]

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]))
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta']
const MODIFIER_KEY = /^(Control|Alt|Shift|Meta|OS)(Left|Right)$|^(AltGraph|CapsLock|NumLock|ScrollLock|Fn|FnLock)$/
/** keys that type a character: alone (or with Shift) they are only a shortcut where nothing is being typed */
const TYPES = /^(Key[A-Z]|Digit\d|Numpad.+|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash)$/
const FUNCTION_KEY = /^F\d{1,2}$/
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])'

/** The shortcut a key press spells, or null while only modifiers are down. */
export function comboOf(e: KeyboardEvent): string | null {
  if (!e.code || MODIFIER_KEY.test(e.code)) return null
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.code].filter(Boolean).join('+')
}

const codeOf = (combo: string) => combo.slice(combo.lastIndexOf('+') + 1)
/** no Ctrl, Alt or Cmd in it: it would also be typed into a field */
const bare = (combo: string) => !/(^|\+)(Ctrl|Alt|Meta)\+/.test(combo)

const NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Escape: 'Esc',
  Delete: 'Del',
  Insert: 'Ins',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}
const MODIFIER_NAMES: Record<string, string> = mac ? { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' } : { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: window.factoryApp?.platform === 'win32' ? 'Win' : 'Super' }

function read(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>
    for (const [id, combo] of Object.entries(saved ?? {})) {
      const action = BY_ID.get(id)
      if (action && !action.fixed && (combo === null || typeof combo === 'string')) out[id] = combo
    }
  } catch {
    /* unreadable: the defaults */
  }
  return out
}

export type SetResult = { ok: true; took: Action | null } | { ok: false; why: string }

class Keys {
  /** the shortcuts panel is open: the app's shortcuts rest meanwhile */
  open = $state(false)
  /** the action whose new shortcut the panel is waiting for */
  listening = $state<string | null>(null)
  /** what the user changed, by action id; null is "no shortcut" */
  #custom = $state<Record<string, string | null>>(read())
  /** what each physical key types in the user's keyboard layout, where the system tells */
  #layout = $state<Map<string, string> | null>(null)

  /** which action each shortcut runs */
  #bound = $derived.by(() => {
    const out = new Map<string, string>()
    for (const a of ACTIONS) {
      const combo = this.binding(a.id)
      if (combo && !out.has(combo)) out.set(combo, a.id)
    }
    return out
  })
  customised = $derived(Object.keys(this.#custom).length > 0)

  constructor() {
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard
    keyboard?.getLayoutMap().then(
      (map) => (this.#layout = map),
      () => {}
    )
  }

  binding(id: string): string | null {
    return id in this.#custom ? this.#custom[id] : (BY_ID.get(id)?.keys ?? null)
  }

  changed(id: string) {
    return id in this.#custom
  }

  /** A shortcut as the names on the keys, one per key: ["Ctrl", "Alt", "K"]. */
  parts(combo: string | null): string[] {
    if (!combo) return []
    const code = codeOf(combo)
    const held = combo.slice(0, -code.length).split('+').filter(Boolean)
    return [...MODIFIERS.filter((m) => held.includes(m)).map((m) => MODIFIER_NAMES[m]), this.#keyName(code)]
  }

  /** An action's shortcut as text, for a tooltip: "Ctrl+Alt+K" ("⌥⌘K" on a Mac); empty when it has none. */
  text(id: string): string {
    return this.parts(this.binding(id)).join(mac ? '' : '+')
  }

  /** The same in brackets with a space before, to put after a label: " (Ctrl+B)". */
  hint(id: string): string {
    const text = this.text(id)
    return text ? ` (${text})` : ''
  }

  /**
   * Is this key press the action's shortcut? Not while the shortcuts panel is open, and a shortcut that is a plain
   * key is not one while typing in a field.
   */
  is(id: string, e: KeyboardEvent): boolean {
    return this.find(e) === id
  }

  /** The action a key press is the shortcut of, if any (with the same exceptions as `is`). */
  find(e: KeyboardEvent): string | null {
    if (this.open) return null
    const combo = comboOf(e)
    if (!combo) return null
    if (bare(combo) && e.target instanceof Element && e.target.closest(TYPING)) return null
    return this.#bound.get(combo) ?? null
  }

  /** The panel's own shortcut also works while it is open: it closes it. */
  toggles(e: KeyboardEvent): boolean {
    const combo = comboOf(e)
    return !!combo && !this.listening && this.#bound.get(combo) === 'keys.open'
  }

  /** Give an action a shortcut. One that another action had is taken from it: `took` says which. */
  set(id: string, combo: string): SetResult {
    const action = BY_ID.get(id)
    if (!action || action.fixed) return { ok: false, why: 'That shortcut cannot be changed.' }
    const code = codeOf(combo)
    if (bare(combo) && !TYPES.test(code) && !FUNCTION_KEY.test(code)) return { ok: false, why: `${this.parts(combo).join('+')} needs Ctrl, Alt or ${MODIFIER_NAMES.Meta} with it.` }
    const holder = ACTIONS.find((a) => a.id !== id && this.binding(a.id) === combo) ?? null
    if (holder?.fixed) return { ok: false, why: `${this.parts(combo).join('+')} belongs to "${holder.label}", which cannot be changed.` }
    const custom = { ...this.#custom }
    if (holder) custom[holder.id] = null
    if (combo === action.keys) delete custom[id]
    else custom[id] = combo
    this.#save(custom)
    return { ok: true, took: holder }
  }

  /** Back to the shortcut it came with. As with `set`, another action using it loses it. */
  reset(id: string): SetResult {
    const action = BY_ID.get(id)
    if (!action || !(id in this.#custom)) return { ok: true, took: null }
    if (action.keys) return this.set(id, action.keys)
    const custom = { ...this.#custom }
    delete custom[id]
    this.#save(custom)
    return { ok: true, took: null }
  }

  resetAll() {
    this.#save({})
  }

  #keyName(code: string): string {
    if (NAMES[code]) return NAMES[code]
    const typed = this.#layout?.get(code)
    if (typed && typed.trim()) return typed.toUpperCase()
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit\d$/.test(code)) return code.slice(5)
    if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
    return code
  }

  #save(custom: Record<string, string | null>) {
    this.#custom = custom
    try {
      localStorage.setItem(STORE, JSON.stringify(custom))
    } catch {
      /* the shortcuts then last for this visit */
    }
  }
}

export const keys = new Keys()
