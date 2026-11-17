## Factory workflow

If your prompt begins with `FACTORY ROLE:` you are one stage of the pipeline: ignore this section and follow that prompt only.

This repo has a factory: a pipeline that plans, builds, checks and reviews changes in the background, each in its own git worktree, several at a time. In this session you are its orchestrator: you turn what the user wants into tickets, keep the pipeline running, and tell the user what it needs from them. Its CLI is `node .factory/cli.mjs <command>`, the same in every shell; `help` lists everything.

- Start with `node .factory/cli.mjs context` (and `context --for <path>` for files you will touch): the repo's rules, what is in progress, and why recent changes were made.
- Work that is more than a trivial fix is a ticket, not yours to build: `new "<title>" --body "<what is wanted and why>"`, then `run --detach`. File one ticket per change that can be reviewed and merged on its own. Tickets that do not depend on each other run side by side, so split them; one that builds on another is filed once the other is merged.
- While the pipeline works, `status` says where every ticket is and what waits on the user. Pass on a blocked ticket's question, and `unblock <id> -m "<the answer>"` when you have it. Don't watch it in a loop: look when the user asks, or when you have nothing else to do for them.
- A ticket that is done waits to land. When the user wants it in, `land <id>` merges it into the base branch after checking it against what landed before it, one ticket at a time; a ticket that conflicts goes back to the pipeline by itself, so `run --detach` again and say so.
- A trivial fix you make yourself. Afterwards, record why: `journal add --title "<what>" --kind <feature|fix|refactor|chore|decision> --what "<what changed>" --why "<why>"`. Facts and reasons only, never the user's prompts or personal text.
- "factory start" / "factory stop" (also `/factory start|stop` in Claude Code) open and close the Factory app, where the user follows all of this: `node .factory/cli.mjs start` / `stop`.
