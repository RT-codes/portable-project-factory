# How the factory works

The central reference: the idea, what gets installed, the pipeline, the journal,
the CLI, the desktop app, and how to work on the factory itself.

## The idea

A factory turns a queue of tickets into reviewed branches with a fixed
pipeline, and remembers why each change was made. **The CLI** does the
deterministic parts: moving state, running the checks, starting each stage,
computing the facts of a change. **Agents** do the judgment in between: what to
build, the code, whether it is good, and why. Every stage leaves a file behind.

Three things it is built around:

- **Portable.** It installs into any git repo with one command, as one hidden
  folder, and comes out again with one command.
- **Any agent.** Claude Code and Codex are both first class. The instructions
  live in `AGENTS.md`, the interface is a CLI that is the same in every shell,
  and the pipeline starts its own stage agents, so it does not lean on one
  agent's sub-agent feature.
- **Files are the truth.** Tickets, the pipeline and the journal are files in
  the repo. The CLI and the desktop app both read and write them; neither
  needs the other to be running.

It started from the
[zazencodes software factory](https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code-v2).

## Install

In the repo you want a factory in (needs Node 20+ and git; the same command on
Linux, macOS and Windows):

```bash
npx -y github:RT-codes/portable-project-factory
```

Or ask your agent to run that. From a checkout: `node install.mjs <repo>`.
`--update` refreshes the factory's own files and keeps yours; `--remove` takes
it out again (your journal, config, rules and roles stay unless you add
`--force`). It asks nothing, needs no admin rights, and writes nothing outside
the repo.

### What it puts in the repo

```
.factory/
  cli.mjs            the CLI, one file, no dependencies        (the factory's: replaced on update)
  version
  config.json        the pipeline, the checks, the roles' default models
  rules.md           the repo's rules for agents: stack, code quality, conventions
  roles/             planner.md, builder.md, reviewer.md: what each stage agent is told
  skills/            how to do one kind of task here, one file each (yours to add)
  journal/           why things changed, one file per change    (committed)
  .gitignore         keeps the three below out of git
  local.json         your own model and effort choices          (not committed)
  jobs/              tickets and what their stages wrote        (not committed)
  worktrees/         one git worktree per ticket being built    (not committed)
AGENTS.md            a short marked block: how to work in this repo
.claude/skills/factory/SKILL.md     /factory for Claude Code
.claude/CLAUDE.md    only when the repo has no CLAUDE.md: imports AGENTS.md
```

That is all: one folder, one block in `AGENTS.md`, and what Claude Code needs
to find it. The desktop app is not in the repo (see *The desktop app*).

### How an agent picks it up

Every agent session starts by reading `AGENTS.md` (Codex and most others) or
`CLAUDE.md` (Claude Code, which is pointed at `AGENTS.md`). The block there is
about ten lines, because it costs context in every session. It says: the CLI
is `node .factory/cli.mjs`; run `context` before changing code; real work goes
through a ticket; record why after a change made outside one; `factory start`
and `factory stop` open and close the app.

Its first line is for the pipeline's own agents: *"If your prompt begins with
`FACTORY ROLE:` you are one stage of the pipeline: ignore this section."* They
run in the same repo and read the same file; without that line they would
start pipelines of their own.

In Claude Code, `/factory start` and `/factory stop` are the skill; anything
else after `/factory` runs the CLI. Other commands are deliberately not slash
commands.

## The pipeline

```
inbox --> plan (planner) --READY--> build (builder) --READY--> check (your checks)
               |                        ^                          |
            BLOCKED                     |---------FAIL-------------|
               v                        |                         PASS
           Needs you                    '--CHANGES-- review (reviewer) <--'
                                                        |
                                                       PASS  (+ the journal entry)
                                                        v
                                                       done
```

`node .factory/cli.mjs run` works every open ticket through its stages,
`concurrency` at a time. For a stage with a role it starts that role's agent
as a subprocess of the agent CLI you use: `claude -p` or `codex exec`.

- **The stage contract**: an agent's final message *is* the stage's file. The
  CLI writes `plan.md`, `build.md`, `review.md`; the agent does not. So the
  planner and the reviewer run read-only, and only the builder may write, in
  the ticket's own worktree (`.factory/worktrees/<id>`, branch `factory/<id>`).
- Each prompt is: `FACTORY ROLE: <role>`, the ticket's header, the role file,
  and `rules.md`. It goes in on stdin.
- A stage agent is a lean session: only the tools its role needs, and none of
  your MCP servers, skills or slash commands (with Claude Code:
  `--strict-mcp-config --disable-slash-commands --tools ...`). Loading a
  whole personal setup into every turn of every stage cost about eighty times
  more tokens in a real run.
- The CLI records what each stage really ran on: the model version the agent
  reported, turns, tokens, and the price at API rates when the agent says.
  It is in the ticket's activity and in the journal's `by`.
- **Which agent CLI**: `FACTORY_AGENT`, else your `local.json`, else the one
  the command is run from inside, else the first of `claude` and `codex` found.
- **Which model and effort**: per role and per agent, from `config.json` (the
  team's default) with your `local.json` on top. A model belongs to an agent
  (`sonnet` means nothing to Codex), so a role may hold a part for each:
  `"planner": { "effort": "high", "claude": { "model": "sonnet" }, "codex": { "model": "gpt-6-luna" } }`.
  The part for the agent that runs wins. `default` passes no flag, so the
  agent uses its own default model: that works on any subscription.
- Each pass through **build** is a round. After `max_rounds` the ticket goes
  to *Needs you*. An agent that fails, times out or says nothing usable blocks
  its ticket with the reason; nothing loops forever.
- **done** means reviewed and ready. Merging the branch is your call.
- `run --detach` runs in the background (a run outlives an agent's command
  timeout); `status` shows it, `cancel` stops it.

### Making it your own

Everything about the flow is in `.factory/config.json`:

```jsonc
{
  "checks": ["npm run lint", "npm test"],  // run in the ticket's worktree, in order; any shell, any OS
  "concurrency": 2, "max_rounds": 3,
  "roles": { "planner": { "model": "default", "effort": "default" }, ... },
  "stages": [{
    "key": "review", "label": "Review", "icon": "scan-eye",     // any Lucide icon name
    "role": "reviewer",                       // start this role's agent   - or -
    "run": "checks",                          // run the checks
    "output": "round-{round}/review.md",      // the file this stage must leave
    "next": { "done": "PASS", "build": "CHANGES" },   // allowed moves -> the first word the file must open with
    "starts_round": true,                     // entering this stage opens a new round (build)
    "terminal": true                          // a finished stage (done)
  }]
}
```

A ticket moves only where its stage's `next` allows, only once the stage's
file exists, and only if the file opens with the word that move needs
(`PASS`, `PASS - fine`, `## VERDICT: PASS` all read `PASS`). To add a stage,
add it to `stages` and point the stage before it at it; a new role is a new
file in `.factory/roles/`.

`.factory/rules.md` is where the repo's stack, code quality rules and
conventions go. Every stage agent gets it, and so does any session that runs
`context`.

## Skills: how to do one kind of task here

A skill is a markdown file in `.factory/skills/`: how to cut a release, add a
migration, add an endpoint the way the others are built. It works for any
agent, because it does not use an agent's own skill system: the factory tells
agents which skills exist, and they read one when they need it.

```markdown
---
name: add-migration
description: Use when a change needs a new database table, column or index.
---
# Add a database migration
## Steps ...   ## Watch out ...   ## Done when ...
```

- **Not loaded up front.** `context` lists each skill's name and description
  (the frontmatter's, or the first line of prose), and the stage agents'
  prompts do the same. The text of a skill is read only when the task calls
  for it: `node .factory/cli.mjs skill <name>`, or the file itself.
- `skills` lists them as agents see them.
- Rules are what is always true; roles are what each pipeline stage does;
  skills are procedures for one kind of change.
- A ticket cannot change a skill, as it cannot change the rules: a branch that
  edits `.factory/skills/` fails its check. Commit skills yourself (the stage
  agents read the committed files).
- In the app, Home's *Skills* opens the Agents view ready to make one, with a
  guide to writing repo-specific skills in the panel beside
  (`app/src/desktop/guides/skills.md`).

## The journal: why things changed

Git says what changed. The journal says why, so an agent that arrives months
later does not have to guess. It is committed, and holds summaries, facts and
reasons, never anyone's prompts.

One file per change, `.factory/journal/<year>/<date>-<slug>.md`:

```
---
id: 2026-11-15-add-a-subtract-function
at: 2026-11-15T16:09:37Z
title: Add a subtract function to the math module
kind: feature                     feature | fix | refactor | chore | decision
ticket: 001-add-a-subtract-function
branch: factory/001-add-a-subtract-function
commits: ["bbce20c"]
files: ["math.mjs","test.mjs"]
tags: ["math","arithmetic"]
by: {"planner":"claude:default","builder":"claude:default","reviewer":"claude:default"}
---
## What changed
## Why
## Decisions
## Watch out
```

- **The facts are the CLI's**: when, which ticket, branch, commits and files
  (from git), and who did each stage. The agent writes only the title, kind,
  tags and the prose.
- **A ticket cannot finish without one.** The reviewer writes it with its
  `PASS`, from the plan and the diff. The CLI commits it on the ticket's
  branch, so the reason merges with the change, and a branch that is never
  merged leaves no entry.
- **Work outside a ticket**: `journal add --title ... --what ... --why ...`.
- One file per entry, so two branches never conflict over it. Plain files and
  no database: thousands of entries read in milliseconds, they diff and merge
  like any text, and there is nothing to keep in step.

### Loading it without flooding the context

`node .factory/cli.mjs context` prints what an agent should know before it
works, in layers that get thinner with age:

1. the workflow in three lines, and `rules.md`;
2. the tickets in progress and what waits on you;
3. the last few changes in full: what, why, decisions (`journal.recent`, 5);
4. the ones before as one line each (`journal.titles`, 20);
5. everything older as one line per month: how many, and where;
6. how to dig: `recall` and `journal show`.

`context --for <path>` puts the changes that touched those files or folders
first, in full, however old they are. `recall <words or a path>` searches
every entry (ranked by word match over titles, tags, files and prose) and
`journal show <id>` prints one whole. So the detail is there when asked for,
and not before.

## The CLI

`node .factory/cli.mjs <command>`, the same in every shell. `help` prints this:

```
new <title...> [--body <text>]     create a ticket (prints its id)
list | show <id> | status          what is where, what waits on you
note | block | unblock | drop | advance | check     move tickets by hand
run [<id>] [--once] [--detach]     work the tickets through their stages
cancel                             stop a background run
context [--for <path>]...          what to load before work
journal add | list | show          the journal
recall <words or a path>           find why something changed
start | stop                       open and close the desktop app
doctor                             check the setup
```

`--json` on `list`, `status`, `context`, `journal list`, `recall` and `doctor`
gives the same as data. It is one file with no dependencies, so it also works
where the app is not: on a server, in CI, in an agent's cloud sandbox.

## The desktop app

The board, and the rest of the review loop around it. It is not in the repo:
it is installed once per user, in your home folder, and opens whichever repo
you point it at. That keeps a repo's footprint to one small folder, and needs
no admin rights, no sudo and no installer.

- `node .factory/cli.mjs start` (or `/factory start`, or "factory start" to
  any agent) opens it on the repo, and prints the context for the agent. The
  first time, it downloads the app for your platform from the factory's GitHub
  release into `~/.factory/app/<version>/` and unpacks it there.
- `stop` closes it.
- Opened by itself, it asks for a repo, and remembers the ones you opened.
- In a repo without a factory it offers to install it: *Install it in this
  repo* runs the same installer as the `npx` command, from the copy the app
  carries (`resources/kit-installer`), so it needs no download, no Node on
  the machine and no admin rights, and nothing on the system asks for
  permission. It writes inside the repo only and commits nothing.
- **Your preferences are yours**: themes, layout, the sidebar and the recent
  projects live in the app's own storage on your machine, never in a repo. The
  one personal file inside a repo is `.factory/local.json` (your model and
  effort choices), which git ignores.

It works in any git repo, with or without a factory.

**Views** (the sidebar, Ctrl/Cmd+1..9, or Ctrl/Cmd+Alt+Up/Down for the one
before or after):

- **Home**: where a project opens. What needs you, the numbers at a glance,
  the latest changes and why, a setup checklist (the CLI's `doctor`), and
  *Change how agents work here*: the rules, the roles, and the models. In a
  repo without a factory it leads with the install command.
- **Journal**: the journal as a timeline by month, with search and a filter by
  kind. An entry opens with its sections and its facts; its ticket, files and
  commits are links (a commit opens its diff in the panel beside).
- **Models** (from Home): which model and effort the planner, builder and
  reviewer use on Claude Code and on Codex, and which of the two runs them.
  Each model field is a dropdown of that agent's models with their versions
  ("Sonnet 5.5", "GPT-6.1-Sol"); the pencil beside it takes a model typed by
  hand. The list, and what each agent's own default is (shown large at the
  top), come from the model lists the two CLIs keep in your home folder: the
  app reads those files and never the network. They are the CLIs' private
  cache, so when one is missing or changes shape the list falls back to the
  short names that always work. It shows the team's default from
  `config.json` beside each field and saves your choice in
  `.factory/local.json`: yours only. Under each role it shows the exact
  model version the role last ran on and what that run took (turns, tokens,
  and for Claude Code the price at API rates), which the CLI records from the
  agent's own output; and what `default` means on this machine, read from
  each CLI's own settings.

- **Board**: as above. *Review changes* on a ticket opens its branch against
  `base_branch` in the diff viewer, before any pull request exists.
- **Activity**: one view of what is going on. On top a strip with the pull
  requests, the issues and the history side by side (stacked in a narrow
  panel), each with its own filter and search; under it the board. A pull
  request or an issue picked in the strip takes the board's place, and its
  back arrow brings the board back. The handle between the strip and the
  rest drags to share the height (a quarter for the strip to start with).
  The four are also still views of their own. It has no shortcut until you
  give it one (Keyboard shortcuts).
- **Changes**: the checkout against its last commit (untracked files
  included), or a branch against the base branch. It rereads when the window
  gets focus back, so it follows an agent working in the repo.
- **Pull requests**: the list, then one pull request as *Conversation* (body,
  comments, reviews, open threads, checks, commits, merge) and *Changes*.
- **Issues**: list and detail side by side. Comment, close, reopen, create.
  *Send to factory* files the issue as a ticket through the repo's CLI.
- **Code**: the checkout's files (or a commit's, when a diff sends you there),
  with uncommitted files marked.

**Panels**: the main area tiles, the way Hyprland or a split editor does. Every
panel has a strip at its top; the active panel's strip carries the buttons:
split right or down (a new panel is empty and lists the views to open in it),
turn a split between side by side and stacked, swap its halves, and close the
panel (the last one stays). The other panels' strips name what they show.

- The active panel has a highlighted border. A click in a panel makes it
  active; the sidebar and the shortcuts act on it.
- The handle between two panels drags to resize (arrow keys work on it too,
  and a double click evens it out).
- Hold **Alt** and drag a panel: it moves as you drag, to the side of the
  panel under the pointer that the pointer is nearest to. It keeps what it
  shows; nothing reloads.
- Keys: Ctrl/Cmd+\\ split right, +Shift split down, Alt+arrows move focus
  to the panel on that side, Ctrl/Cmd+Alt+R turn, +S swap, +W close.
- The space between panels and around them is part of the theme (Appearance,
  *Panels*). A single panel always fills the window.
- Up to eight panels. The layout is remembered per project. Views adapt to
  the width of their panel (container queries, not the window's width).

`src/desktop/layout.svelte.ts` holds the tree of splits and works out each
panel's rectangle; `PaneArea.svelte` draws panels from those rectangles in a
fixed order, so moving one only changes its position. A view reaches its own
panel through `getTile()` (`src/desktop/pane.ts`): `tile.go(route)` navigates
inside it, and `tile.openBeside(route)` shows something next to it, in an
empty panel or a new split.

**Appearance** (the gear at the top of the sidebar, or Ctrl/Cmd+,): pick a
theme, or make one. A theme is a base (dark or light) plus what it changes:

- colours (surfaces, text, accent, borders, the status colours), by picker or hex;
- the width of every border and divider, and the corner radius;
- the space between split panels, and around them;
- cutouts: corners cut out of panels instead of rounded. Each of the four
  corners is on or off, the cut has a size and a shape (bevel, notch or
  scoop), and buttons and fields can take it too at half the size;
- the interface font and size, the code font and size (any font installed on
  the machine; the fields suggest them), and the syntax colours.

Four themes are built in. **Carbon** (black and white, mono type, one cut
corner, from Nexo) is the one the app starts in; then Themis Dark and Light,
and Nexo's **Neon** (cyan on deep blue, bevelled corners).

Changes show at once, on the whole app and on a sample, as a draft. *Save*
keeps the draft in the theme itself and *Save as new theme* keeps it under a
new name. A built-in theme you saved changes to is marked *edited* and gets a
reset button that puts it back as it shipped; a theme of your own can be
deleted. Picking another
theme with unsaved changes asks first. Themes live in the app's own storage on
this machine; *Export* writes the one on screen to a `.factory-theme.json`
file and *Import* reads one (every value is checked and brought into range). How it works: a theme is a set of CSS
variables put on `<html>` (`src/desktop/appearance.svelte.ts`); `app.css` holds
the defaults, including `--line`, which Tailwind's border utilities read
through `--default-border-width`. Cutouts are `<html data-cut="tl br">` plus
CSS `corner-shape` on everything with one of Tailwind's larger radii, so
borders, fills and clipping follow the cut with no clip-path or extra
elements. `public/theme.js` applies the saved theme before the first paint.

- **History**: the commits as a graph, newest on top, one lane per line of
  work, merges as hollow dots. Rows carry their branches (local green, remote
  blue), tags, and a chip for every worktree that has the commit checked out
  (the open one says HEAD). *Checked out / Local / Remote / All* choose whose
  history is drawn; Remote is what the last fetch brought. The worktrees are
  listed beside the graph (the factory's per-ticket ones among them) with
  their branch and how many files are uncommitted; a click jumps to their
  commit. A commit opens with its message and files, and *Open the diff*
  shows it in a panel beside the history, reused for the next one.

- **Agents**: the files that tell agents how to work here, as a tree:
  the repo's skills (`.factory/skills/`), everything under `.claude/` (agents,
  Claude Code's own skills, commands, settings), the
  instruction files at the root (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`...)
  and the factory's rules, roles and `config.json`. *New file* and *New
  folder* make them (a new agent, skill or command starts from the
  frontmatter Claude Code expects). A file opens in an **editor** in the
  panel beside the tree, with a bar of its own: save (Ctrl/Cmd+S), revert,
  *Raw* / *Rich* for markdown (the source, or how it reads, with the
  frontmatter as fields), *Format* for JSON (which is also checked as you
  type), rename or move, delete (to the system's trash), *Open in editor*
  (the app your system opens that kind of file with) and *Show in folder*.
  What you type is a draft, marked in the tree and kept even if the panel
  is closed, until it is saved or reverted. If an agent or another editor
  changes the file meanwhile, saving stops and asks: load theirs, or save
  yours over it.

  This is the one place the app writes to a project, so `electron/files.ts`
  is strict: only those places, never through a symlink that leaves them,
  and the factory's own files can be edited but not renamed or deleted.

The sidebar folds to a strip of icons with the button at its top (Ctrl/Cmd+B).

**Keyboard shortcuts** (the keyboard button at the top of the sidebar, or
Ctrl/Cmd+Alt+K): a floating list of every shortcut, with a search (by action
or by keys). *Change* waits for the next key press and makes it the shortcut;
keys that another action had are taken from it. Each changed shortcut can be
reset, or all at once. Escape or a click outside closes it. The shortcuts are
kept on your machine, for every project.

**The diff viewer** is shared by Changes and Pull requests:

- Files as a tree on the left, every file's diff in one scroll on the right,
  unified or split, with syntax colours and the changed part of a line marked.
- The unchanged lines between hunks open in place.
- `j` / `k` step through files; `v` marks the current one as viewed, folds it
  and moves on. Viewed is remembered per pull request or branch, and a file
  comes back unviewed when its diff changes.
- On a pull request, the `+` on a line writes a comment. Comments are held as
  *pending* (they survive closing the app) and go out together when you
  *Submit review* as Comment, Approve or Request changes. Threads sit under
  their lines, with reply and resolve.
- **Graph** draws the change against the project, left to right. On the left
  a map of the project as a tree: every folder a box, its subfolders boxes
  inside it, every file a chip (past 300 files, folders the change does not
  touch fold to a line with their file count). On it the changed files are lit in
  the colour of what happened to them, and the files that import a changed
  file stand out (what the change can reach). Right of the map the changed
  files in one column, each tied to its place on the map, with an arrow from
  every file that imports it; right of them, the files they import. Drag or
  scroll to pan and Ctrl/Cmd+scroll to zoom; both glide. A panel at the top
  picks the background (dots, grid, plain); one at the lower right leaves the
  rest of the project out (*Only affected files*), hides the imported
  files, makes a file's chip as tall as the file is long (*Size by length*,
  with a slider for how much), and draws the lines with square corners
  (*Angular lines*, with a slider for the space between them, from over each
  other to apart). The colours are explained in the middle at the top: green
  added, amber changed, red removed, blue renamed. *File types*, above the
  options, opens to a list of the project's file types: switch one off and
  its files leave the graph, with their lines. All of this, and where you
  left the graph (place and zoom, per diff), is kept in the app's own storage
  on your machine: never in the repo. It reads JS/TS/Svelte/Vue/CSS and Python imports with regular
  expressions (tsconfig `paths` and SvelteKit's `$lib` included), which is
  fast and needs no install of the project; a missed edge costs one line in a
  picture. A box opens its file. **Both** shows the graph on the left
  and the diff on the right, with a handle between them to drag; the Changes
  view starts that way, a pull request starts on the diff alone, and your
  choice is kept. In the graph, a changed file brings its diff up on the
  right; any other file opens in Code in a panel below.

**How it talks to GitHub**: through the `gh` CLI (`electron/github.ts`). `gh`
already holds your login, SSO and Enterprise hosts, so the app stores no token;
without `gh`, or signed out, the GitHub views say what to do and everything
local still works. A pull request's diff is not GitHub's (which truncates): the
app fetches the pull request's commits into `refs/factory-app/` (a namespace of
its own: no branch is created or moved, the checkout is untouched) and diffs
them with git. Nothing is written to GitHub except what you send: a comment, a
review, a state change, a merge (which asks twice).

**How it is built**: `app/` is a Svelte page and an Electron main process.

```
src/                 the page. src/lib is the board; src/desktop the shell, the panels and the views
electron/            the main process: window, git, gh, the factory's files, the import graph
shared/api.ts        the contract between the two: every call the page can make
e2e/                 end-to-end tests, the fixture project, the stand-in for gh
```

The page runs sandboxed, with context isolation and a content security policy,
and reaches the machine only through `shared/api.ts`. Every call names a
project, and the main process serves only projects you opened and only paths
inside them (`e2e/setup.spec.ts` checks this).

**Tests**: `npm test` builds the app and drives it with Playwright (no window
appears on Linux: it draws offscreen). Each test gets a project of its own from
`e2e/fixture.mjs`: a real git repo with a pull request that is really fetched,
uncommitted work, and a factory with tickets. `e2e/fake-gh.mjs` stands in for
`gh`, answers from a JSON file and records every call, so tests assert exactly
what would have gone to GitHub and nothing reaches the real one.

**Releasing the app**: `git tag app-v1.0.0 && git push origin app-v1.0.0`.
`.github/workflows/desktop.yml` runs the kit's and the app's tests, builds a
`tar.gz` for Linux and a `zip` for Windows and macOS (plain archives: nothing
that asks for admin rights), and attaches them to a draft release. The CLI
downloads them by name, and the kit's version says which release: keep the
two versions in step. They are not code-signed.

## Working on the factory

```
install.mjs          the installer (what `npx github:...` runs)
kit/                 what gets installed: .factory/ (the CLI, config, rules, roles), the skill, the AGENTS.md block
kit/test/            the kit's tests: `npm test` at the repo root
app/                 the desktop app
docs/FACTORY.md      this file
```

- **The kit**: `npm test` (Node's own test runner, real temporary git repos,
  a stand-in for the agent CLIs). To try a change by hand:
  `node install.mjs /tmp/some-repo`, then use the CLI there.
- **The app**: `cd app && npm install`, then `npm run dev -- <repo>` (hot
  reload), `npm run check`, `npm test`. `npm run demo` opens it on a made-up
  project with a made-up GitHub.
- Stack of the app: Electron, Svelte 5 (runes), Vite, Tailwind 4,
  shadcn-svelte on bits-ui, `@lucide/svelte`, CodeMirror, shiki.

## Guardrails

- Stage agents work only in their ticket's worktree. The planner and the
  reviewer cannot write at all. Nothing is pushed or merged unless you ask.
- A branch cannot change what it is judged by: the checks come from the main
  checkout's `config.json`, and a branch that touches `.factory/config.json`,
  `cli.mjs`, `rules.md` or `roles/` fails its check.
- The journal's facts come from git and the CLI, not from an agent.
- At most `max_rounds` rounds per ticket before a human decides.
- The app writes to a repo in two places only, and never through a link that
  leaves them: the agent files (`.claude/`, `.factory/roles/`, `rules.md`,
  `config.json`, the instruction files at the root) and your `local.json`.
