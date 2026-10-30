---
description: Fan out N implement targets into parallel git worktrees — one pi agent pane per target, in a dedicated Rex tab in the current session, a shared new tmux window, or a herdr workspace; each agent runs /implement-with-pr, opens a PR, and stops
argument-hint: "<#issue | spec-path | description> ..."
---

# Implement Many

## 0. Targets

$@

Each whitespace-separated token above is one implement target (an issue ref like `#77`, a spec/ticket path, or a short description). If empty, ask the user for the targets before starting.

## Goal

Run `/implement-with-pr <target>` in parallel: one isolated git worktree + git branch per target, one pi agent pane per target. In Rex, each worktree gets a **new dedicated tab in the current session**, then its agent starts in a **new pane inside that tab**, beside the worktree's shell pane. In tmux all agent panes share a single **new** window; in herdr `herdr worktree create` opens one workspace per target. You only set up worktrees, panes, and seeds, then verify they started — you do **not** implement anything yourself. Each pane's agent owns its own work.

## Preconditions

- Select the pane environment once: Rex when both `$REX_SESSION` and `$REX_BLOCK` are nonempty; otherwise herdr when `$HERDR_ENV` is set; otherwise tmux when `$TMUX` is set. Rex takes precedence over inherited herdr/tmux variables. If none matches, stop and report that this needs a Rex, herdr, or tmux session. Follow the selected path consistently through steps 3–7.
- In Rex, require `rex` and `jq`, save `REX_SOURCE_SESSION="$REX_SESSION"`, and verify the source block with `rex block inspect -s "$REX_SOURCE_SESSION" "$REX_BLOCK" --json | jq -e '.block'`. If it fails, stop and report the stale or unreachable context. `REX_SERVER` alone is not session detection: it may be configured globally. Keep the current server endpoint and pass `-s "$REX_SOURCE_SESSION"` on every Rex operation; never create a new session for the fan-out. Resolve `REX_LOGIN_SHELL` to the absolute path of the user's login shell (for example, `command -v fish` for a fish setup). Use that shell for both the worktree shell and the agent so login-profile PATH entries are available.
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

Fetch the base once, then one worktree per target at `$WORKTREE` (`~/Projects/worktree/<repo>/agent-sessions/<slug>`) in every environment:

**Rex or tmux** — plain git, create parents first:

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

### 4. Create the worktree tabs or window

**Rex** — create one new tab per worktree in the saved current session. Rex calls a tab a `window` in its CLI/API. Start a login shell in the worktree, parse the returned `.window_id` and `.block_ids[0]`, then label the tab with the slug:

```bash
REX_TAB_JSON=$(rex run -s "$REX_SOURCE_SESSION" --cwd "$WORKTREE" \
  --shell=none --label "$SLUG-shell" --focus=false --json \
  -- "$REX_LOGIN_SHELL" -l) || exit 1
REX_WINDOW_ID=$(printf '%s\n' "$REX_TAB_JSON" | jq -er '.window_id') || exit 1
REX_ROOT_BLOCK_ID=$(printf '%s\n' "$REX_TAB_JSON" | jq -er '.block_ids[0]') || exit 1
jq -n --arg window "$REX_WINDOW_ID" --arg label "$SLUG" \
  '{window_id: $window, label: $label}' \
  | rex api call -s "$REX_SOURCE_SESSION" session.set_window_label - || exit 1
```

Save `(target, WORKTREE, REX_WINDOW_ID, REX_ROOT_BLOCK_ID)` for each result. Step 5 creates a separate agent pane beside that target's root block. Never split the orchestrator's `$REX_BLOCK`, reuse another worktree's tab, or select the split destination by focus. If setup fails partway through, retain and report the returned IDs before retrying so the same target does not get duplicate tabs or agents.

**herdr** — step 3's `herdr worktree create` already opened one workspace per target with its tab and root pane; proceed to step 5.

**tmux** — create one new window — never reuse the current one — with exactly one pane per target. The first pane is the window itself, each further target is a split:

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

`/implement-with-pr` carries the whole unattended contract itself: implement from the issue without asking questions, then commit, push, and open a PR. So the seed is just the template invocation — no contract file, no `--append-system-prompt`. The template expands server-side, so do not paste an expanded brief, and pass `<target>` as the single message arg (a second CLI message arg is dropped; trailing prose gets swallowed into the template's `$@`, i.e. its "Work to implement" section):

**Rex** — for each target, use its saved root block ID to create a new agent pane in that worktree's tab. Pass the command as arguments; Rex loads the specified shell's login environment before running `pi`:

```bash
REX_AGENT_JSON=$(rex split -s "$REX_SOURCE_SESSION" -b "$REX_ROOT_BLOCK_ID" \
  --cwd "$WORKTREE" --shell "$REX_LOGIN_SHELL" --label "$SLUG-pi" \
  --focus=false --keep-open --json -- pi '/implement-with-pr <target>') || exit 1
REX_AGENT_BLOCK_ID=$(printf '%s\n' "$REX_AGENT_JSON" | jq -er '.block_ids[0]') || exit 1
```

Store `REX_AGENT_BLOCK_ID` alongside that target's session, window, and root block IDs. Use the agent block ID for every capture and keypress below. `--keep-open` preserves the pane's output if the command exits. Before continuing, verify `.block.window_id` matches `REX_WINDOW_ID`, and the foreground process's cwd matches `WORKTREE`:

```bash
rex block inspect -s "$REX_SOURCE_SESSION" "$REX_AGENT_BLOCK_ID" --json | jq -e '.block'
rex block call -s "$REX_SOURCE_SESSION" -b "$REX_AGENT_BLOCK_ID" process
```

**tmux**:

```
# per pane (tmux):
tmux send-keys -t "$SESSION:$WIN.<pane>" "pi '/implement-with-pr <target>'" Enter
```

In herdr, seed each root pane from step 3 via `herdr pane run` — its cwd is already its worktree, so no `cd` prefix is needed:

```
herdr pane run "<pane id>" "pi '/implement-with-pr <target>'"
```

`<target>` is the **original token from section 0** (e.g. `#77`), not the slug. Quote it so the shell passes it as one arg.

### 6. Handle the "Trust project folder?" dialog when shown

A new worktree may trigger pi's **Trust project folder?** dialog, which blocks the template from expanding. Inspect each agent pane using step 7's capture command. Only when that pane visibly shows the trust dialog with **Trust** selected, send Enter to accept:

```
Rex:   rex send-key -s "$REX_SOURCE_SESSION" -b "$REX_AGENT_BLOCK_ID" enter
tmux:  tmux send-keys -t "$SESSION:$WIN.<pane>" Enter
herdr: herdr pane run "<pane id>" ""   # run = text + Enter atomically; empty text = a bare Enter
```

This persists trust for that worktree dir; the dialog does not recur for trusted dirs. Do not send Enter just because time has passed or a pane looks blank; inspect it again and report startup errors instead of typing into a running agent.

### 7. Verify every seed expanded

~15–20s after accepting, capture each pane and confirm the `/implement-with-pr` body is showing (steps 1–5, "Discipline") and the agent has begun booting (`memory read system://boot`, fetching the issue) — **not** the bare string `/implement-with-pr #N` and **not** a stalled blank pane:

```
Rex:   rex capture -s "$REX_SOURCE_SESSION" -b "$REX_AGENT_BLOCK_ID" --trim --unwrap
tmux:  tmux capture-pane -t "$SESSION:$WIN.<pane>" -p | tail -25
herdr: herdr pane read "<pane id>" --source recent-unwrapped --lines 25
```

If a pane is still on the trust dialog, follow step 6 and re-verify. If it remains blank or shows an error, inspect the process and startup output; do not seed a second agent into the same pane.

## Report back

Give the user a table:

| Tab / workspace / window | Agent pane | Target | Branch | Worktree |
| --- | --- | --- | --- | --- |

For Rex, include the saved session ID and each target's window ID, tab label, and agent block ID. Explain that the user can select the slug-labeled tab in the same session, with its worktree shell and Pi agent in separate panes. For tmux, give `<prefix> <win-index>`; for herdr, point to each target's own workspace, labeled with its slug — see `herdr workspace list`. Note that each agent runs `/implement-with-pr` independently (load → TDD → review → commit → push → PR) and then stops; the user takes the PR from there — agents never babysit, merge, or enable auto-merge. Commits and pushes are non-interactive because the panes run unattended.

## Discipline

- One worktree + one branch + one Pi agent pane per target. Rex: one dedicated tab per worktree in the source session, with a worktree shell and a separate new agent pane; herdr: one workspace per target. Never share a worktree or branch across targets.
- You set up and verify only; each pane's agent owns its implementation.
- Branch off the repo default branch. Each agent commits, pushes, and opens a PR for its own branch; the user merges — agents never merge and never enable auto-merge.
- Blocked issues are caught by the step-1 precheck and the user decides; do not discover blockers only after a pane is already running. If a blocked target is nonetheless fanned out (user override), its `/implement-with-pr` agent stops and reports when it cannot continue.
