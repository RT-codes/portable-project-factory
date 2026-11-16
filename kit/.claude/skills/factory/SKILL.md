---
name: factory
description: The Factory workflow. Use when the user types /factory followed by start, stop, or anything else (a ticket to create, run, status, the journal, a question about tickets).
---

# /factory

Everything goes through the CLI, `node .factory/cli.mjs <command>`, run from the repo root. Show the user
what it prints.

- `/factory start` - `node .factory/cli.mjs start`: opens the Factory app on this repo and prints the
  repo's context. Read that context; it is for you.
- `/factory stop` - `node .factory/cli.mjs stop`: closes the app.
- `/factory <anything else>` - run the CLI command it names, e.g. `/factory status` is
  `node .factory/cli.mjs status`. If the words are not a command, run `node .factory/cli.mjs help` and
  pick the command that does what the user asked:
  - a request to build something: `new "<short imperative title>" --body "<the rest, verbatim>"`;
  - `run`: always `run --detach` (a run outlives your command timeout), then `status` when asked.
- When the CLI refuses, its message says why. Fix the cause or tell the user; never work around it, and
  never edit `.factory/jobs/` by hand.
