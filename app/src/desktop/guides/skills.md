# Writing a skill for this repo

A skill tells an agent **how to do one kind of task in this repo**: cut a release, add a database migration, add an API endpoint the way the others are built. It is a markdown file in `.factory/skills/`, and any agent can use it, Claude Code and Codex alike.

Agents do not load skills up front. They see each skill's **name and one-line description**, and read the whole file only when the task in front of them matches. So a skill costs almost nothing until it is needed, and you can have many.

## Rule, role or skill?

| | What it is | When an agent reads it |
|---|---|---|
| **Rules** (`rules.md`) | What is always true here: the stack, code quality, conventions | Always, before any work |
| **Roles** (`roles/`) | What the planner, builder and reviewer each do | Always, by that stage of the pipeline |
| **Skills** (`skills/`) | How to do one specific kind of task | Only when the task calls for it |

If it applies to every change, it is a rule. If it is a procedure for one kind of change, it is a skill.

## When to write one

- You have explained the same procedure to an agent twice.
- A task has steps in an order that matters, and an agent would not guess them from the code.
- There is a trap: a file that must be updated together with another, a command that must run first, a thing that looks right and is wrong.
- A review keeps sending the same kind of work back for the same reason.

Do not write a skill for what a capable agent does well unprompted. "How to write a unit test" is not a skill. "How tests are laid out and run **here**, and which fixtures to reuse" is.

## The shape of a skill

```markdown
---
name: add-migration
description: Use when a change needs a new database table, column or index.
---

# Add a database migration

## Steps
1. Create the file with `npm run db:new -- <name>`: never by hand, the timestamp orders them.
2. Write `up` and `down`. `down` must really undo `up`.
3. Run `npm run db:migrate` and `npm run db:rollback` locally, once each.
4. Update `src/db/schema.ts` in the same change: the types are generated from it.

## Watch out
- Never edit a migration that is already on `main`. Add a new one.
- A new column on a large table needs a default, or the deploy locks the table.

## Done when
- `npm run db:migrate && npm run db:rollback && npm run db:migrate` passes.
- `schema.ts` and the migration describe the same thing.
```

The file name is the skill's name: `add-migration.md`. The sections are a suggestion that works well, not a format the factory enforces.

## The description is the trigger

It is the only part an agent sees before deciding to read the skill, so write it as **when to use it**, in the words a task would use.

- Weak: `Database stuff.`
- Weak: `Explains our migration process.`
- Strong: `Use when a change needs a new database table, column or index.`

If two skills could match the same task, say in each description what sets it apart.

## Make it specific to this repo

- **Name real things.** Real commands, real paths, real file names. `npm run db:new`, not "use the migration tool".
- **Say the order, and why.** A reason ("the timestamp orders them") lets the agent handle the case you did not foresee.
- **Write the traps down.** The thing that bit you is the most valuable line in the file.
- **End with a check.** "Done when" is what the agent, and the reviewer, can verify: a command that passes, a file that exists.
- **Point, do not copy.** Link to the example to follow (`see src/api/users.ts`) instead of pasting code that will go stale.
- **Leave the rules in the rules.** A skill does not repeat `rules.md`; every agent has read that already.

## Keep it short

Aim for one screen. A skill is read in the middle of a task, and every line competes with the work for attention. If it grows past that, it is probably two skills, or part of it is a rule.

## Try it

1. Save the skill and commit it (the pipeline's stage agents read the committed files).
2. Ask your agent for a task the skill should match, without mentioning the skill.
3. See whether it found and followed it. If it did not find it, sharpen the description. If it found it and went wrong, the steps are missing something: add the line that would have prevented it.

`node .factory/cli.mjs skills` lists what agents see, and `node .factory/cli.mjs skill <name>` prints one as they read it.

## One more thing

A ticket cannot change a skill: like the rules, skills steer the agents, so a branch that edits one fails its check. Change skills here, or yourself, and commit them on their own.
