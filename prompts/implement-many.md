---
description: Fan out N implement targets into parallel git worktrees — one pi agent per pane, in a single new tmux window or one herdr workspace per target opened by herdr worktree; each pane is seeded with /implement-with-pr, which implements unattended, opens a PR, keeps it green and handles review comments, and waits for the user to merge
argument-hint: "<#issue | spec-path | description> ..."
---

# Implement Many

## 0. Targets

$@

Each whitespace-separated token above is one implement target (an issue ref like `#77`, a spec/ticket path, or a short description). If empty, ask the user for the targets before starting.

## Goal

Run `/implement-with-pr <target>` in parallel: one isolated git worktree + git branch per target, one pi agent per pane — in tmux all panes share a single **new** window; in herdr `herdr worktree create` opens one workspace per target. You only set up worktrees, panes, and seeds, then verify they started — you do **not** implement anything yourself. Each pane's agent owns its own work.

## Preconditions

- You know which pane environment you are in: herdr (`$HERDR_ENV` is set) or tmux (`$TMUX` is set); if both are set, treat it as herdr. If neither, stop and tell the user this needs a herdr or tmux session. Steps 3–4 differ per environment (herdr: `herdr worktree create` per target; tmux: `git worktree add` plus a window of splits); the pane steps (5–7) each have a tmux path and a herdr path — follow the one for your environment consistently.
- In herdr, load the `herdr` skill before touching panes: it owns the `herdr` CLI reference — command syntax, ID handling, safety rules — that the herdr paths below rely on.
- The current directory is the repo root whose default branch the worktrees fan out from.

## Process

### 1. Precheck: no target issue is blocked

Before planning anything, check every target that is an issue ref (`#N` or `N`) for open blockers. Both sources count:

- **Native dependencies**: `gh api repos/<owner>/<repo>/issues/<N> --jq '{title, summary: .issue_dependencies_summary, body}'` — `issue_dependencies_summary.blocked_by > 0` means open native blockers (missing/null summary = none).
- **Body mentions**: scan `.body` for a `Blocked by: #<n>` line (fallback convention) and looser "blocked by #N" phrasing; each referenced issue that is still open (`gh issue view <n> --json state -q .state`) is a blocker. Mentions of closed issues or of non-issues are not.

If any target has an open blocker from either source, stop and report the blocked targets with their blockers, then ask the user whether to drop them (fan out only the unblocked rest) or proceed anyway. Never silently fan out a blocked issue.

### 2. Plan the fan-out

For each target derive `(SLUG, BRANCH, WORKTREE)`:

- **Issue ref** (`#N` or `N`): `gh issue view <N> --json title -q .title`, then pick a concise **English** slug yourself that reflects what the issue is about (lowercase, `[a-z0-9-]+`, `<= 40` chars). For non-English titles do **not** mechanically transliterate — name the feature. For ASCII titles `sed -E 's/[^a-zA-Z0-9]+/-/g; s/^-+//; s/-+$//; s/.*/\L&/' | cut -c1-40` is an acceptable shortcut. Prefix the issue number: `SLUG="<N>-<name>"`.
- **Path or description**: read it, pick a concise English slug yourself.

Then:

```
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | cut -d/ -f2); BASE=${BASE:-master}

# Reuse the <repo> segment already used by this repo's worktrees, else the repo's dir name.
REPO=$(git worktree list --porcelain \
  | awk '/^worktree .*\/Projects\/worktree\// {print $2}' \
  | sed -E 's@.*/Projects/worktree/([^/]+)/.*@\1@' | head -1)
REPO=${REPO:-$(basename "$(git rev-parse --show-toplevel)")}

# per target:
BRANCH="agent-sessions/$SLUG"
WORKTREE="$HOME/Projects/worktree/$REPO/agent-sessions/$SLUG"
```

Stop and ask the user if any slug collides with an existing branch/worktree, or two targets would yield the same slug.

### 3. Create the worktrees

Fetch the base once, then one worktree per target at `$WORKTREE` (`~/Projects/worktree/<repo>/agent-sessions/<slug>`) in both environments:

**tmux** — plain git, create parents first:

```
git fetch origin "$BASE"
mkdir -p "$HOME/Projects/worktree/$REPO/agent-sessions"
git worktree add -b "$BRANCH" "$WORKTREE" "$BASE"
```

**herdr** — use `herdr worktree create`, which creates the worktree **and** opens it as its own workspace (one tab; the root pane's cwd is the worktree). Always pass `--path`: without it herdr parks worktrees under `~/.herdr/worktrees/<repo>/<branch-dashed>`, off the preferred path. `--label` names that workspace in the sidebar — pass the slug. Parse `.result.root_pane.pane_id` from each JSON response, never predict it; `pane[i] ↔ target[i]`:

```
git fetch origin "$BASE"
herdr worktree create --cwd "$PWD" --branch "$BRANCH" --base "$BASE" --path "$WORKTREE" --label "$SLUG" --no-focus
```

For herdr this also completes step 4: every target already has its workspace, tab, and one ready pane at the worktree.

### 4. New window + one pane per worktree (tmux only)

In herdr this step does not exist — step 3's `herdr worktree create` already opened one workspace per target with its tab and root pane. In tmux, create one new window — never reuse the current one — with exactly one pane per target. The first pane is the window itself, each further target is a split:

```
SESSION=$(tmux display-message -p '#S')
WIN="<short name>"                 # shared topic, else "impl-<count>"
tmux new-window -d -n "$WIN" -c "$WORKTREE_0"
tmux split-window  -t "$SESSION:$WIN" -c "$WORKTREE_1"
tmux split-window  -t "$SESSION:$WIN" -c "$WORKTREE_2"
# ...
tmux select-layout -t "$SESSION:$WIN" tiled   # 2 -> side-by-side; 3+ -> grid. Use even-horizontal for strict side-by-side.
```

Panes come back in index order from `tmux list-panes -t "$SESSION:$WIN" -F '#{pane_index}'`, so `pane[i] ↔ target[i]`. Verify each pane's cwd is its own worktree: `tmux list-panes -t "$SESSION:$WIN" -F '#{pane_index}: #{pane_current_path}'`.

### 5. Seed each pane with /implement-with-pr

`/implement-with-pr` carries the whole unattended contract itself: implement from the issue without asking questions, then commit, push, open a PR, keep it green (CI + rebase), and wait for the user to merge. So the seed is just the template invocation — no contract file, no `--append-system-prompt`. The template expands server-side, so do not paste an expanded brief, and pass `<target>` as the single message arg (a second CLI message arg is dropped; trailing prose gets swallowed into the template's `$@`, i.e. its "Work to implement" section):

```
# per pane (tmux):
tmux send-keys -t "$SESSION:$WIN.<pane>" "pi '/implement-with-pr <target>'" Enter
```

In herdr, seed each root pane from step 3 via `herdr pane run` — its cwd is already its worktree, so no `cd` prefix is needed:

```
herdr pane run "<pane id>" "pi '/implement-with-pr <target>'"
```

`<target>` is the **original token from section 0** (e.g. `#77`), not the slug. Quote it so the shell passes it as one arg.

### 6. Accept the "Trust project folder?" dialog on every pane

A worktree dir pi has never opened triggers pi's **Trust project folder?** dialog, which blocks the template from expanding (the pane sits blank/stalled). ~5s after seeding, each pane shows it with the cursor already on **Trust**. Accept on every pane:

```
tmux:  tmux send-keys -t "$SESSION:$WIN.<pane>" Enter
herdr: herdr pane run "<pane id>" ""   # run = text + Enter atomically; empty text = a bare Enter
```

This persists trust for that worktree dir; the dialog does not recur for trusted dirs.

### 7. Verify every seed expanded

~15–20s after accepting, capture each pane and confirm the `/implement-with-pr` body is showing (steps 1–6, "Discipline") and the agent has begun booting (`memory read system://boot`, fetching the issue) — **not** the bare string `/implement-with-pr #N` and **not** a stalled blank pane:

```
tmux:  tmux capture-pane -t "$SESSION:$WIN.<pane>" -p | tail -25
herdr: herdr pane read "<pane id>" --source recent-unwrapped --lines 25
```

If a pane is still blank or still on the trust dialog, accept again and re-verify.

## Report back

Give the user a table:

| Pane | Target | Branch | Worktree |

Plus how to switch to the fan-out (tmux: `<prefix> <win-index>`; herdr: each target's own workspace, labeled with its slug — see `herdr workspace list`), and a note that each agent runs `/implement-with-pr` independently (load → TDD → review → commit → push → PR), then babysits its PR — watching CI, rebasing on conflicts or base-branch moves, and reacting to and acting on review comments — until the user merges it; agents never merge themselves. Commits and pushes are non-interactive because the panes run unattended.

## Discipline

- One worktree + one branch + one pane per target (herdr: one workspace per target). Never share a worktree or branch across targets.
- You set up and verify only; each pane's agent owns its implementation.
- Branch off the repo default branch. Each agent commits, pushes, and opens a PR for its own branch; the user merges — agents never merge and never enable auto-merge.
- Blocked issues are caught by the step-1 precheck and the user decides; do not discover blockers only after a pane is already running. If a blocked target is nonetheless fanned out (user override), its `/implement-with-pr` agent stops and reports when it cannot continue.
