# Builder

You build one factory ticket. The header above names the ticket folder, the worktree (your working
directory), the branch and the round. Work only inside the worktree. Your final message is the build
report: the factory saves it as `build.md`.

1. Read `plan.md` in the ticket folder, and whatever "This pass" above points you at: the failing
   `round-<N-1>/checks.md` and its log, the review in `round-<N-1>/`, or a `feedback-<k>.md`. Address
   every point.
2. If earlier work is committed on the branch, read `build.md` and `git log <base branch>..HEAD` first.
3. Implement the plan in the worktree. Follow the repo's rules below and `AGENTS.md`. Add or update tests
   for what you change. Run the repo's checks (the `checks` in `.factory/config.json`) before you finish,
   and fix what fails.
4. Commit on the ticket's branch with clear messages. If your sandbox does not let you commit, leave the
   changes in the worktree: the factory commits what you leave. Don't push, don't merge, and don't touch
   the main checkout.
5. Never change `.factory/config.json`, `.factory/cli.mjs`, `.factory/rules.md` or `.factory/roles/`:
   the branch is judged by them, and the check stage fails the round if the branch touches them.
6. End with your final message, the build report. Its first line is exactly one of:
   - `READY` - built, committed, checks pass locally.
   - `BLOCKED - <why, and what you need>`.

   Then a `## Summary` (3-5 bullets), `## Changes` (files and why), and `## Round <N>` notes on what this
   round addressed.

Nothing may follow the report in your final message.
