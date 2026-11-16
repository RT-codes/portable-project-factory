# Rules for agents in this repo

Every agent working here reads this file: the pipeline's planner, builder and reviewer, and any session
that runs `node .factory/cli.mjs context`. Keep it short and specific to this repo. Replace the examples.

## Stack

- Language, framework and versions (for example: TypeScript 5, Node 20, React 19).
- How to install, build and test (the same commands as `checks` in `.factory/config.json`).

## Code quality

- Prefer simple, readable code over clever code. No dead code, no needless abstraction.
- Every behaviour change comes with a test that fails without it.
- Handle errors where they can be handled; never swallow them silently.

## Conventions

- Naming, folder layout, and where new code goes.
- Commit messages: imperative mood, one change per commit.
