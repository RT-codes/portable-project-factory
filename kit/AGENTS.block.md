## Factory workflow

If your prompt begins with `FACTORY ROLE:` you are one stage of the pipeline: ignore this section and follow that prompt only.

This repo uses the Factory workflow. Its CLI is `node .factory/cli.mjs <command>`, the same in every shell; `node .factory/cli.mjs help` lists everything.

- Before changing code, run `node .factory/cli.mjs context`, and `context --for <path>` for the files you will touch. It prints the repo's rules, what is in progress, and why recent changes were made.
- Work that is more than a trivial fix goes through a ticket: `new "<title>" --body "<details>"`, then `run --detach`. The pipeline plans, builds, checks, reviews and records why; `status` shows where it is.
- After any change you make yourself outside a ticket, record why: `journal add --title "<what>" --kind <feature|fix|refactor|chore|decision> --what "<what changed>" --why "<why>"`. Facts and reasons only, never the user's prompts or personal text.
- "factory start" / "factory stop" (also `/factory start|stop` in Claude Code) open and close the Factory app: `node .factory/cli.mjs start` / `stop`.
