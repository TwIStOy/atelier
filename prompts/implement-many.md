---
description: Fan out N implement targets into parallel git worktrees — one pi agent per pane in a new herdr tab or tmux window, each seeded with /implement plus an unattended contract to push, open a PR, keep it green, and wait for the user to merge
argument-hint: "<#issue | spec-path | description> ..."
---

# Implement Many

## 0. Targets

$@

Each whitespace-separated token above is one implement target (an issue ref like `#77`, a spec/ticket path, or a short description). If empty, ask the user for the targets before starting.

## Goal

Run `/implement <target>` in parallel: one isolated git worktree + git branch per target, one pi agent per pane, all panes in a single **new** herdr tab or tmux window. You only set up worktrees, panes, and seeds, then verify they started — you do **not** implement anything yourself. Each pane's agent owns its own work.

## Preconditions

- You know which pane environment you are in: herdr (`$HERDR_ENV` is set) or tmux (`$TMUX` is set); if both are set, treat it as herdr. If neither, stop and tell the user this needs a herdr or tmux session. Every pane step below (4–7) has a tmux path and a herdr path — follow the one for your environment consistently.
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

From the repo root, one `git worktree add` per target:

```
git fetch origin "$BASE"
mkdir -p "$HOME/Projects/worktree/$REPO/agent-sessions"
git worktree add -b "$BRANCH" "$WORKTREE" "$BASE"
```

### 4. New tab/window + one pane per worktree

Create one new tab (herdr) or window (tmux) — never reuse the current one — with exactly one pane per target.

**tmux** — the first pane is the window itself, each further target is a split:

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

**herdr** — with the `herdr` skill loaded, drive the `herdr` CLI. Create one tab — its root pane is target 0 — then split one further pane per remaining target into that tab, each with its worktree as cwd and no focus steal:

```
herdr tab create     # add a label if the installed CLI supports one (check `herdr tab`); parse .result.tab and .result.root_pane
herdr pane split --pane "<root pane id>" --direction right --cwd "$WORKTREE_1" --no-focus   # parse .result.pane.pane_id
herdr pane split --pane "<root pane id>" --direction right --cwd "$WORKTREE_2" --no-focus
```

There is no tiled-layout equivalent; split wide panes right and narrow/tall panes down, per the skill. Parse every pane ID from the JSON responses, never predict them: `pane[i] ↔ target[i]`, with the tab's root pane as `pane[0]`.

### 5. Seed each pane with /implement + the unattended contract

The pane agents run unattended, so each seed carries a standing contract: decide open questions from the issue instead of asking, commit and push, open a PR, keep it green (CI + rebase), and wait for the user to merge — all non-interactively. The template expands server-side, so do not paste an expanded brief, and never pass the contract as extra `/implement` arguments (a second CLI message arg is dropped; trailing prose gets swallowed into the template's `$@`, i.e. its "Work to implement" section). Instead write the contract to a file once and pass its path via `--append-system-prompt`, which reads file contents:

```
cat > /tmp/pi-impl-many-unattended.md <<'EOF'
You run unattended in a background tmux/herdr pane: nobody can answer an interactive prompt. Keep every commit and push non-interactive so a failure fails fast instead of hanging; if a command genuinely needs interaction, stop and report.

Do not ask the user questions (no ask_user_question, no pausing on decisions): the originating issue is already split into a scope you can implement independently. Resolve every open question from the issue text and the repo's existing conventions, and note non-obvious choices in the PR body. Stop and report only when no reasonable interpretation lets you proceed safely.

Landing your work, in order:

1. When the implementation is done and its checks pass, commit it (stage only files you changed; never git add -A) and push the branch: git push -u origin HEAD.
2. Open the PR right after the push: gh pr create with explicit --title and --body flags only (never interactive), base branch = the repo default branch your worktree forked from, body referencing the originating issue when there is one. If the PR cannot be opened at all (permissions, not a GitHub repo), report that after the push and stop.
3. Wait for CI when the repo has checks: gh pr checks --watch --interval 30, one blocking call is fine. If CI fails on your change, fix it, push, and wait again. Rerun a check once if it looks flaky or infrastructural before treating it as a real failure.
4. Keep the PR mergeable: if it conflicts, or the base branch moved and branch protection now requires an update, fetch the base and git rebase onto it. Resolve conflicts only in files your branch touched — if a conflict lands in files you did not touch, stop and report. Push the rebase with git push --force-with-lease, permitted only for your own PR branch and only after a rebase. CI reruns after the push; go back to step 3.
5. Never merge, never enable auto-merge, never close or reopen the PR: the human merges. After every base-branch move, re-check CI and mergeability (steps 3-4), handle what changed, and keep waiting.
6. Poll gh pr view --json state,mergeable every few minutes with a sleep between polls; never busy-loop. Terminal states: MERGED — report and stop. CLOSED without merge — report and stop.
EOF

# per pane (tmux):
tmux send-keys -t "$SESSION:$WIN.<pane>" "pi --append-system-prompt /tmp/pi-impl-many-unattended.md '/implement <target>'" Enter
```

In herdr, seed each pane with the same command line via `herdr pane run`, prefixing a `cd` into that pane's worktree so the seed does not depend on the pane's initial cwd:

```
herdr pane run "<pane id>" "cd \"$WORKTREE\" && pi --append-system-prompt /tmp/pi-impl-many-unattended.md '/implement <target>'"
```

`<target>` is the **original token from section 0** (e.g. `#77`), not the slug. Quote it so the shell passes it as one arg. Do not delete the contract file afterwards — pi reads it at pane startup, and a missing path is appended as literal text instead of file contents.

### 6. Accept the "Trust project folder?" dialog on every pane

A worktree dir pi has never opened triggers pi's **Trust project folder?** dialog, which blocks the template from expanding (the pane sits blank/stalled). ~5s after seeding, each pane shows it with the cursor already on **Trust**. Accept on every pane:

```
tmux:  tmux send-keys -t "$SESSION:$WIN.<pane>" Enter
herdr: herdr pane run "<pane id>" ""   # run = text + Enter atomically; empty text = a bare Enter
```

This persists trust for that worktree dir; the dialog does not recur for trusted dirs.

### 7. Verify every seed expanded

~15–20s after accepting, capture each pane and confirm the `/implement` body is showing (steps 1–5, "Discipline") and the agent has begun booting (`memory read system://boot`, fetching the issue) — **not** the bare string `/implement #N` and **not** a stalled blank pane:

```
tmux:  tmux capture-pane -t "$SESSION:$WIN.<pane>" -p | tail -25
herdr: herdr pane read "<pane id>" --source recent-unwrapped --lines 25
```

If a pane is still blank or still on the trust dialog, accept again and re-verify.

## Report back

Give the user a table:

| Pane | Target | Branch | Worktree |

Plus how to switch to the new tab/window (tmux: `<prefix> <win-index>`; herdr: the tab's label), and a note that each agent runs `/implement` independently (load → TDD → review → commit → push → PR), then babysits its PR — watching CI, rebasing on conflicts or base-branch moves — until the user merges it; agents never merge themselves. Commits and pushes are non-interactive because the panes run unattended.

## Discipline

- One worktree + one branch + one pane per target. Never share a worktree or branch across targets.
- You set up and verify only; each pane's agent owns its implementation.
- Branch off the repo default branch. Each agent commits, pushes, and opens a PR for its own branch; the user merges — agents never merge and never enable auto-merge.
- Blocked issues are caught by the step-1 precheck and the user decides; do not discover blockers only after a pane is already running. If a blocked target is nonetheless fanned out (user override), its `/implement` agent stops and reports when it cannot continue.
