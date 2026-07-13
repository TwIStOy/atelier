# Gotchas

Silent failures unique to herdr worktrees. Each one looks fine until you verify.

## `herdr worktree create` without `--workspace` → wrong repo

`create` with no `--workspace`/`--cwd` targets the TUI's **focused** workspace, which is often a
**different repo** than the one your pane lives in. Always pass `--workspace "${HERDR_PANE_ID%%:*}"`
(or `--cwd <repo-root>`) and verify `result.workspace.worktree.repo_name` == intended repo before
driving anything. This is the #1 silent failure; the rest are smaller.

## Inlining a big prompt as `pi ... "<task>"` → pi never starts

`herdr pane run` types the line + Enter; a prompt with nested quotes / backticks / `$` is silently
mangled by shell quoting and `pi` never launches. Symptom: `herdr pane process-info --pane <pane>`
shows the foreground process is the shell (`fish`/`bash`), not `pi`. The echoed text in `herdr pane
read` looks fine — that is misleading. Fix: write the prompt to a file and pipe it via stdin. Full
mechanics in [LAUNCH_AGENT.md](LAUNCH_AGENT.md).

## `herdr pane send` does not exist

The pane-input subcommands are `send-text` (raw text, no Enter) and `send-keys` (special keys like
`C-c`). There is **no** `herdr pane send`. A wrong subcommand name just prints the command list and
exits 0 — no error, easy to miss.

## Pane-scoped commands need an existing pane

`herdr pane run`/`read`/etc. target an **existing** pane (the one from `worktree create`/`open`).
Don't pass a workspace id or tab id to pane-scoped commands. If a pane alias/id is stale, re-`list`
or re-create before retrying.

## Stale checkouts: reuse, don't recreate

A finished/merged worktree left un-removed lingers as a stale checkout that the next session trips
over and has to `worktree open` to reuse, instead of `create`. Always remove the worktree + delete
the merged branch after a merge (see SKILL.md *Lifecycle*).

## Workspace != git worktree

A workspace opened over a worktree is just a **live view**. Closing it does **not** delete the git
worktree — it stays registered in `herdr worktree list`. herdr does **not** auto-collect workspaces;
one only disappears if explicitly closed. Don't assume one "vanished on its own".

## Extension tool alternative

If the [`@ogulcancelik/pi-herdr`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-herdr)
extension is installed (it registers a `herdr` tool with actions `run`/`read`/`watch`/`send`/`stop`/
`pane_split`/`tab_create`/`workspace_create`/`focus`/`wait_agent`), prefer it for pane I/O over the
raw CLI:

- `run` submits text **+ Enter atomically** (vs the CLI typing the line) — sidesteps the
  shell-quoting hazard for *commands*, though a big **prompt** still needs the file-pipe method.
- `watch` waits on a text/regex match with a timeout and abort support.
- `wait_agent` waits until a pane running a recognized coding agent reaches `working`/`blocked`/
  `done`/`idle` — use it (not a generic watch) to know when a sibling pi agent finished. Wait for
  `done` for a background pane, `idle` if the pane was focused while it finished.

The extension is inert outside herdr (no `HERDR_ENV`/`HERDR_PANE_ID` → unregistered). It does **not**
cover worktree lifecycle (`create`/`open`/`remove`/`list` are CLI-only), so those always stay CLI.
Default the skill to the CLI so it works on any host; reach for the extension tool only when present.
