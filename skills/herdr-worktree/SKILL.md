---
name: herdr-worktree
description: >
  Create, drive, and clean up a herdr worktree — an isolated workspace + git branch for one task.
  Use when running a task in its own checkout, spawning a pi agent inside a worktree pane, or doing
  any parallel work that needs its own branch + pane. Covers `herdr worktree create/open/remove/list`
  and driving the worktree's pane from inside a pi session.
---

# herdr worktree: isolate a task in its own branch + pane

A herdr worktree gives a task its own git worktree (isolated branch + checkout) **and** its own
herdr workspace (a live pane you can drive). Use it to run parallel tasks without their working
trees colliding.

The whole skill runs on one word: **verify**. `herdr worktree create` has failure modes that fail
*silently* (wrong repo, agent never starts) and only a follow-up check catches them. Every step
below ends on an explicit verify gate — do not skip them.

## Quick start

```bash
WS=${HERDR_PANE_ID%%:*}            # workspace YOUR pane lives in, e.g. "w1"
herdr worktree create --workspace "$WS" --branch feat/thing --base master --no-focus --json \
  | tee /tmp/_wt.json
PANE=$(python3 -c 'import json;d=json.load(open("/tmp/_wt.json"));print(d["result"]["root_pane"]["pane_id"])')
# VERIFY gate 1 (see below): result.workspace.worktree.repo_name == intended repo
```

Then run the task in `$PANE` (see *Driving the pane*). When done, clean up (see *Lifecycle*).

## CRITICAL — always pass `--workspace`, then verify the repo

`herdr worktree create` with **no** `--workspace`/`--cwd` targets the workspace the herdr TUI
currently has **focused** — usually *not* the one your pane lives in, often a **different repo**.
Observed: a pane in workspace `w1` silently created worktrees under a *different* repo because
that repo's workspace was TUI-active at the time.

**Always** do one of: `--workspace "${HERDR_PANE_ID%%:*}"` (the workspace your pane is in), or
`--cwd <repo-root>`. Pane id format is `wN:pM`; the workspace is the `wN` part. Then **verify**
`result.workspace.worktree.repo_name` equals the intended repo before driving anything.

## Useful JSON fields from `worktree create --json`

```
result.root_pane.pane_id            # the pane to drive
result.workspace.workspace_id       # new workspace id (for focus/remove)
result.workspace.worktree.repo_name # VERIFY == intended repo
result.worktree.path                # checkout path (cwd of the pane)
result.worktree.branch              # the branch name
```

Parse with python3 reading the JSON, e.g. `d["result"]["root_pane"]["pane_id"]`.

## Driving the pane

The created worktree's root pane is the entry point. Drive it with the **herdr CLI** — plain shell
commands typed + Enter:

```bash
herdr pane run <pane> 'npm test'
herdr pane read <pane> --lines 40
```

- `herdr pane run <pane> <command>` — types `<command>` + Enter. Preferred for anything executable.
- `herdr pane send-text <pane> <text>` — raw text, **no** Enter. (The subcommand is `send-text`, not
  `send` — there is no `herdr pane send`.)
- `herdr pane send-keys <pane> <key>...` — special keys (`C-c`, `C-u`). Clears a stuck partial line.
- `herdr pane process-info --pane <pane>` — foreground process name. VERIFY it is what you launched.

> **Optional: if the `@ogulcancelik/pi-herdr` extension tool is installed**, pane `run`/`read`/`watch`/
> `wait_agent` are nicer than the CLI (atomic submit, regex watch, agent-status wait). Default to the
> CLI so the skill works everywhere; see [Extension tool alternative](references/GOTCHAS.md#extension-tool-alternative).

**Launching a pi agent inside the worktree** has its own failure mode (big prompts get silently
mangled) — that is its own workflow: see [Launch a pi agent in the worktree](references/LAUNCH_AGENT.md).

## Lifecycle (workspace vs git worktree)

- Closing a workspace does **not** delete the git worktree — it stays in `herdr worktree list`.
- Reopen a closed worktree as a fresh workspace + pane:
  `herdr worktree open --branch <name> --label <text> --no-focus --json`
- List worktrees for a repo: `herdr worktree list --workspace "$WS" --json`.
- **Clean up after a task is done or merged** — do not leave finished worktrees around. Two steps,
  then **verify** only intended refs remain:
  1. `herdr worktree remove --workspace <id> --force --json` — closes the workspace + removes the checkout.
  2. `git branch -d <branch>` — deletes the branch ref (`-d` refuses unless merged; `-D` to discard).
  Verify with `git worktree list` + `git branch`.

## Verify gates (do not skip)

1. After `create`: `result.workspace.worktree.repo_name` == intended repo.
2. After launching an agent: `herdr pane process-info --pane <pane>` foreground `name` == `pi` (not the shell).
3. After cleanup: `git worktree list` + `git branch` show only intended refs.

For the silent-failure mechanics behind these and the rest of the gotchas (big-prompt mangling,
`send`-vs-`send-text`, stale-checkout reuse), see [references/GOTCHAS.md](references/GOTCHAS.md).
