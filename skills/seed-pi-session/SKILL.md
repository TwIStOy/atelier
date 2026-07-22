---
name: seed-pi-session
description: Spin up a pi agent primed for a task by passing a prompt template (`/implement #N`, `/triage`, …) as the CLI initial message — typically in its own git worktree + tmux window. Use when launching or starting one or more pi agents to work on issues/tasks, creating worktrees or tmux tabs for pi, or seeding pi via `/implement`.
---

# Seed a pi session with a prompt template

Launch a pi agent already primed for a task by passing a **prompt template** as pi's CLI initial
message. The template expands server-side, so the seed is a tiny string instead of a pasted
mega-prompt. This skill runs on one word: **seed** — pass the slash-command, not the expanded text.

## The key fact

**pi prompt templates expand when passed as the CLI initial message**, not only when typed in the
editor (verified pi 0.80.10):

```bash
pi '/implement #3'     # expands prompts/implement.md with $@ = #3, then starts working
```

## Why a template, not a hand-written prompt

- **Short seed** — `pi '/implement #3'` is a few bytes; a pasted brief is kilobytes. Big prompts
  handed to a freshly-launched agent can get silently mangled (see the `herdr-worktree` skill's
  *Launch a pi agent* note). A template invocation never does.
- **Structured workflow for free** — `/implement` drives load-context → TDD → code-review → commit;
  `/triage`, `/to-tickets`, etc. each carry their own discipline. You don't reinvent it per launch.

## Quick start — one agent per worktree + tmux tab

Commit any shared context (specs, `CONTEXT.md`, ADRs) to the base branch first, so worktrees
inherit it.

```bash
# 1. worktree on a new branch from <base> (e.g. master)
git worktree add -b <topic-branch> <worktree-path> <base>
#    htw repo: `htw worktree create -b <topic-branch>` computes the canonical path.

# 2. tmux window in that worktree
tmux new-window -d -n <short-name> -c <worktree-path>

# 3. seed pi with the template — one send-keys; template expands + agent starts
tmux send-keys -t <session>:<short-name> "pi '/implement #<issue>'" Enter
```

Repeat per issue; switch tabs with `<prefix>+<n>`.

## Verify the seed took

The expanded template is large; a blank/dead pane means it didn't fire. After ~5–7s:

```bash
tmux capture-pane -t <session>:<short-name> -p | tail -20
```

Expect the template's body (e.g. `/implement`'s "…Commit … Stage only the files you changed … TDD
…") and the agent bootstrapping — **not** the bare string `/implement #N`.

## Where templates come from

This user's templates are supplied globally by the installed package `~/pi-extensions`
(`settings.json` → `packages`), under `~/pi-extensions/prompts/*.md`: `/implement`, `/triage`,
`/to-tickets`, `/grill-with-docs`, `/teach`, `/worktree-feature`, … `~/.pi/agent/prompts/` does not
exist; don't look there. Load extras ad hoc with `--prompt-template <path>`.

## Related

- **`herdr-worktree`** — the herdr-managed variant (herdr workspaces/panes, not plain git worktrees
  + tmux tabs). Its *Launch a pi agent* note warns about big-prompt mangling — the template-seed
  technique above sidesteps it entirely.
- **`/implement`** — turns `#<issue>` into a full implement → TDD → review → commit run.
