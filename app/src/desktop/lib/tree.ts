// A flat list of repo paths as a folder tree. Folders with a single folder inside are joined ("src/lib"), so a
// deep path does not cost a click per level.

export interface TreeNode<T> {
  /** what the row shows: a file name, or one or more folder names joined with / */
  name: string
  /** the full path of the file or folder */
  path: string
  children: TreeNode<T>[] | null
  item?: T
  /** files below, at any depth */
  count: number
}

export function buildTree<T extends { path: string }>(items: T[]): TreeNode<T>[] {
  interface Dir {
    dirs: Map<string, Dir>
    files: T[]
  }
  const root: Dir = { dirs: new Map(), files: [] }
  for (const item of items) {
    const parts = item.path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      dir = next
    }
    dir.files.push(item)
  }
  const build = (dir: Dir, prefix: string): TreeNode<T>[] => {
    const folders = [...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]): TreeNode<T> => {
        let label = name
        let path = prefix + name
        while (sub.files.length === 0 && sub.dirs.size === 1) {
          const [[only, inner]] = sub.dirs
          label += '/' + only
          path += '/' + only
          sub = inner
        }
        const children = build(sub, path + '/')
        return { name: label, path, children, count: children.reduce((n, c) => n + c.count, 0) }
      })
    const files = dir.files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((item): TreeNode<T> => ({ name: item.path.slice(item.path.lastIndexOf('/') + 1), path: item.path, children: null, item, count: 1 }))
    return [...folders, ...files]
  }
  return build(root, '')
}

/** Every file in the tree, in the order the tree shows them. */
export function flatten<T>(nodes: TreeNode<T>[]): T[] {
  return nodes.flatMap((n) => (n.children ? flatten(n.children) : n.item ? [n.item] : []))
}

export const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
