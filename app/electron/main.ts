import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Api, GithubRepo, ProjectInfo } from '../shared/api'
import * as factory from './factory'
import * as files from './files'
import * as git from './git'
import * as github from './github'
import { importGraph } from './graph'
import { Projects } from './projects'

// The desktop app's main process: one window, and the `Api` (shared/api.ts) behind it. The window's page is the
// Svelte app in src/, built into dist-desktop/.

const DEV_URL = process.env.FACTORY_APP_DEV_URL
const PAGE_ROOT = path.join(__dirname, '..', 'dist-desktop')
const ORIGIN = 'app://factory'
// The kit's installer: beside the app's code when packaged (package.json, extraResources), in the checkout otherwise.
const INSTALLER = app.isPackaged ? path.join(process.resourcesPath, 'kit-installer', 'install.mjs') : path.join(__dirname, '..', '..', 'install.mjs')

// the end-to-end tests give each run a data folder of its own
if (process.env.FACTORY_APP_DATA) app.setPath('userData', process.env.FACTORY_APP_DATA)
app.setName('Factory')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let projects: Projects
let win: BrowserWindow | null = null

// ---------------------------------------------------------------- the api

const GITHUB_TTL = 60_000
const repos = new Map<string, { at: number; repo: Promise<GithubRepo> }>()

/** The GitHub repo behind a project. Looked up through `gh` once a minute at most. */
function repoOf(project: string, fresh = false): Promise<GithubRepo> {
  const hit = repos.get(project)
  if (hit && !fresh && Date.now() - hit.at < GITHUB_TTL) return hit.repo
  const repo = github.repoOf(project)
  repos.set(project, { at: Date.now(), repo })
  repo.catch(() => repos.delete(project))
  return repo
}

const p = (project: string) => projects.check(project)

/** The app's version from its own package.json: app.getVersion() only knows it in a packaged build. */
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version as string
  } catch {
    return app.getVersion()
  }
})()

const api: Api = {
  async projects() {
    return projects.list()
  },
  async openProject() {
    return chooseProject()
  },
  async selectProject(dir) {
    projects.select(dir)
  },
  async forgetProject(dir) {
    projects.forget(dir)
  },
  async projectInfo(project) {
    const dir = p(project)
    const info: ProjectInfo = { path: dir, name: path.basename(dir), isGit: false, branch: null, hasFactory: await factory.hasFactory(dir), github: null, githubError: null }
    info.isGit = await git.isGit(dir)
    if (!info.isGit) {
      info.githubError = 'This folder is not a git repository.'
      return info
    }
    info.branch = await git.currentBranch(dir)
    try {
      info.github = await repoOf(dir, true)
    } catch (e) {
      info.githubError = (e as Error).message
    }
    return info
  },

  factoryState: (project) => factory.factoryState(p(project)),
  factoryFile: (project, job, file) => factory.factoryFile(p(project), job, file),
  factoryInstall: (project) => factory.factoryInstall(p(project), INSTALLER),
  factoryCreate: (project, title, body) => factory.factoryCreate(p(project), title, body),
  journal: (project) => factory.journal(p(project)),
  doctor: (project) => factory.doctor(p(project), VERSION),
  modelSettings: (project) => factory.modelSettings(p(project)),
  saveLocalSettings: (project, local) => factory.saveLocalSettings(p(project), local),

  branches: (project) => git.branches(p(project)),
  tree: (project, rev) => git.tree(p(project), rev),
  file: (project, rev, file) => git.file(p(project), rev, file),
  compare: (project, base, head) => git.compare(p(project), base, head),
  importGraph: (project, rev, changed) => importGraph(p(project), rev, changed),
  history: (project, scope, limit) => git.history(p(project), scope, limit),
  worktrees: (project) => git.worktrees(p(project)),
  commitMessage: (project, sha) => git.commitMessage(p(project), sha),
  commitFacts: (project, shas) => git.commits(p(project), Array.isArray(shas) ? shas : []),

  issues: async (project, query) => github.issues(await repoOf(p(project)), query),
  issue: async (project, number) => github.issue(await repoOf(p(project)), number),
  issueCreate: async (project, title, body) => github.issueCreate(await repoOf(p(project)), title, body),
  issueComment: async (project, number, body) => github.issueComment(await repoOf(p(project)), number, body),
  issueSetState: async (project, number, state) => github.issueSetState(await repoOf(p(project)), number, state),

  pulls: async (project, query) => github.pulls(await repoOf(p(project)), query),
  pull: async (project, number) => github.pull(await repoOf(p(project)), number),
  async pullCompare(project, number) {
    const dir = p(project)
    const repo = await repoOf(dir)
    const pr = await github.pull(repo, number)
    const remote = (await git.remoteFor(dir, repo.owner, repo.repo)) ?? `${repo.url}.git`
    await git.fetchPull(dir, remote, number, pr.baseRef, pr.baseSha, pr.headSha)
    let from = await git.mergeBase(dir, pr.baseSha, pr.headSha)
    if (!from) {
      // a shallow clone does not hold the history that joins the two: GitHub knows where they part
      from = await github.mergeBase(repo, pr.baseSha, pr.headSha)
      await git.fetchCommit(dir, remote, from)
    }
    return git.between(dir, from, pr.headSha)
  },
  pullReview: async (project, number, review) => github.pullReview(await repoOf(p(project)), number, review),
  pullReply: async (project, number, inReplyTo, body) => github.pullReply(await repoOf(p(project)), number, inReplyTo, body),
  pullResolve: async (project, threadId, resolved) => {
    p(project)
    await github.pullResolve(threadId, resolved)
  },
  pullMerge: async (project, number, method, headSha) => github.pullMerge(await repoOf(p(project)), number, method, headSha),

  agentFiles: (project) => files.agentFiles(p(project)),
  agentRead: (project, file) => files.agentRead(p(project), file),
  agentWrite: (project, file, text, expected, force) => files.agentWrite(p(project), file, text, expected, force),
  agentMkdir: (project, dir) => files.agentMkdir(p(project), dir),
  agentRename: (project, from, to) => files.agentRename(p(project), from, to),
  agentDelete: (project, file) => files.agentDelete(p(project), file),
  agentOpen: (project, file) => files.agentOpen(p(project), file),
  agentReveal: (project, file) => files.agentReveal(p(project), file),

  async openExternal(url) {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  },
}

async function chooseProject() {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: 'Open a project', properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  let dir = res.filePaths[0]
  // a folder inside a repo opens the repo
  const top = await git.git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true }).catch(() => null)
  if (top?.code === 0) dir = path.resolve(top.stdout.toString('utf8').trim())
  return projects.open(dir)
}

// ---------------------------------------------------------------- the window

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json',
  woff2: 'font/woff2',
  woff: 'font/woff',
  png: 'image/png',
}

// The page may run only its own scripts, and reach nothing but GitHub's image hosts (avatars, screenshots in
// issue bodies). Inline styles stay allowed: Svelte and the syntax highlighter set them.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function servePage() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(PAGE_ROOT, rel)
    if (url.host !== 'factory' || !file.startsWith(PAGE_ROOT + path.sep)) return new Response('not found', { status: 404 })
    try {
      const data = await fs.promises.readFile(file)
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Factory',
    icon: process.platform === 'linux' ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  win.on('focus', () => win?.webContents.send('event', 'focus'))

  const own = (url: string) => url.startsWith(DEV_URL ?? `${ORIGIN}/`)
  // links in issues and comments open in the browser, never in the app's window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (own(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  void win.loadURL(DEV_URL ?? `${ORIGIN}/index.html`)
}

function buildMenu() {
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (await chooseProject()) win?.webContents.send('event', 'projects')
          },
        },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** `factory-app <folder>` opens that project. */
function projectFromArgs(argv: string[]): string | null {
  for (const arg of argv.slice(1).reverse()) {
    if (arg.startsWith('-')) continue
    try {
      if (fs.statSync(arg).isDirectory()) return path.resolve(arg)
    } catch {
      /* not a folder: the app's own script, a flag value */
    }
  }
  return null
}

// `factory-app --quit` asks the running app to quit (the factory's CLI does this on `stop`). With nothing running it
// has nothing to do, and exits before any window is made.
const quitting = process.argv.includes('--quit')

if (!app.requestSingleInstanceLock({ quit: quitting })) {
  app.quit()
} else if (quitting) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv, cwd, data) => {
    if (argv.includes('--quit') || (data as { quit?: boolean } | null)?.quit) {
      app.quit()
      return
    }
    const dir = projectFromArgs(argv.map((a, i) => (i > 0 && !a.startsWith('-') ? path.resolve(cwd, a) : a)))
    if (dir && dir !== app.getAppPath()) {
      projects.open(dir)
      win?.webContents.send('event', 'projects')
    }
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    projects = new Projects(app.getPath('userData'))
    const dir = projectFromArgs(process.argv)
    if (dir && dir !== app.getAppPath()) projects.open(dir)

    ipcMain.handle('api', async (event, method: string, args: unknown[]) => {
      // only the app's own page may call, and only methods of the api
      if (event.sender !== win?.webContents || !Object.hasOwn(api, method)) return { ok: false, error: 'not allowed' }
      try {
        const fn = api[method as keyof Api] as (...a: unknown[]) => Promise<unknown>
        return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })

    // The page gets no browser permission (camera, location, notifications...) but two: listing the installed
    // fonts, which the appearance settings offer to pick from, and putting text on the clipboard (a copy button).
    // Reading the clipboard stays denied.
    const allowed = (permission: string) => permission === 'local-fonts' || permission === 'clipboard-sanitized-write'
    session.defaultSession.setPermissionRequestHandler((contents, permission, grant) => grant(contents === win?.webContents && allowed(permission)))
    session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === win?.webContents && allowed(permission))

    if (!DEV_URL) servePage()
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
