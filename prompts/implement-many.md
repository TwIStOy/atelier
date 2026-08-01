---
description: Fan out N implement targets into parallel git worktrees — one pi agent per pane in a new tmux window, each seeded with /implement
argument-hint: "<#issue | spec-path | description> ..."
---

# Implement Many

## 0. Targets

$@

Each whitespace-separated token above is one implement target (an issue ref like `#77`, a spec/ticket path, or a short description). If empty, ask the user for the targets before starting.

## Goal

Run `/implement <target>` in parallel: one isolated git worktree + git branch per target, one pi agent per tmux pane, all panes in a single **new** tmux window. You only set up worktrees, panes, and seeds, then verify they started — you do **not** implement anything yourself. Each pane's agent owns its own work.

## Preconditions

- You are inside tmux (`$TMUX` is set). If not, stop and tell the user this needs a tmux session.
- The current directory is the repo root whose default branch the worktrees fan out from.

## Process

### 1. Plan the fan-out

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

### 2. Create the worktrees

From the repo root, one `git worktree add` per target:

```
git fetch origin "$BASE"
mkdir -p "$HOME/Projects/worktree/$REPO/agent-sessions"
git worktree add -b "$BRANCH" "$WORKTREE" "$BASE"
```

### 3. New tmux window + one pane per worktree

Create one new window (do not reuse the current one); the first pane is the window itself, each further target is a split:

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

### 4. Seed each pane with /implement

One bare invocation per pane — the template expands server-side, so do not paste an expanded brief:

```
tmux send-keys -t "$SESSION:$WIN.<pane>" "pi '/implement <target>'" Enter
```

`<target>` is the **original token from section 0** (e.g. `#77`), not the slug. Quote it so the shell passes it as one arg.

### 5. Accept the "Trust project folder?" dialog on every pane

A worktree dir pi has never opened triggers pi's **Trust project folder?** dialog, which blocks the template from expanding (the pane sits blank/stalled). ~5s after seeding, each pane shows it with the cursor already on **Trust**. Accept on every pane:

```
tmux send-keys -t "$SESSION:$WIN.<pane>" Enter
```

This persists trust for that worktree dir; the dialog does not recur for trusted dirs.

### 6. Verify every seed expanded

~15–20s after accepting, capture each pane and confirm the `/implement` body is showing (steps 1–5, "Discipline") and the agent has begun booting (`memory read system://boot`, fetching the issue) — **not** the bare string `/implement #N` and **not** a stalled blank pane:

```
tmux capture-pane -t "$SESSION:$WIN.<pane>" -p | tail -25
```

If a pane is still blank or still on the trust dialog, accept again and re-verify.

## Report back

Give the user a table:

| Pane | Target | Branch | Worktree |

Plus the tmux target to switch to the window (`<prefix> <win-index>`), and a note that each agent runs `/implement` independently (load → TDD → review → commit), stopping on its own if it hits a blocker.

## Discipline

- One worktree + one branch + one pane per target. Never share a worktree or branch across targets.
- You set up and verify only; each pane's agent owns its implementation.
- Branch off the repo default branch. Do not push or open PRs — agents commit to their own branches and stop.
- If a target is an issue that declares blockers, note it to the user but still proceed; the `/implement` agent will stop and report if it cannot continue.
