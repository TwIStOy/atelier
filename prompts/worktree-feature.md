---
description: Create a fresh worktree under a unified agent dir, then implement the described feature
argument-hint: "<feature-description>"
---

Create an isolated worktree and implement the feature described below. Do each step in order. Stop before merging — the user decides the merge strategy.

## 0. Feature to implement

$@

If anything is ambiguous or under-specified, ask the user before touching code. Do not guess the requirement.

## 1. Create a worktree (outside the repo, under a unified agent dir)

Branch off the repo's default branch, and place the worktree next to every other agent worktree under a single shared directory.

Choose a `SLUG` yourself: summarize the feature into a concise, meaningful English name (lowercase, hyphen-separated, `<= 40` chars, matching `[a-z0-9-]+`). Do **not** mechanically convert the user's input — pick a name that reflects what the feature *does*, even when the input is not English.

```
DEFAULT_BRANCH=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')
# fall back to master/main if the remote lookup fails
DEFAULT_BRANCH=${DEFAULT_BRANCH:-$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | cut -d/ -f2 || echo main)}

SLUG="<the slug you chose>"
BRANCH="agent/$SLUG"
PROJECT=$(basename "$(pwd)")
WORKTREE="$HOME/.agent-worktree/workspaces/$PROJECT/$SLUG"

git fetch origin "$DEFAULT_BRANCH"
mkdir -p "$(dirname "$WORKTREE")"
git worktree add "$WORKTREE" -b "$BRANCH" "origin/$DEFAULT_BRANCH"
```

All subsequent file edits, builds, and tests happen **inside `$WORKTREE`**. `cd` into it for every command that touches the tree.

## 2. Set up the worktree

From inside `$WORKTREE`:

- If the repo has a dependency-install step, run it (e.g. `npm ci`, `pnpm install`).
- If there are non-tracked files the build needs (`.env`, secrets), they must already be ignored or copied — never commit them.

## 3. Implement the feature

Inside the worktree, implement the smallest correct change that satisfies the description in section 0. The repo's `AGENTS.md` and `docs/` are the source of truth for conventions — follow them. Validate before committing: run the repo's typecheck/build and tests (e.g. `npm run check`).

## 4. Commit

Stage only the files you changed (explicit paths, never `-A`/`.`) and commit with a Conventional Commit message. Split into multiple focused commits if the change is naturally separable.

```
git add <path1> <path2>
git commit -m "<type>(<scope>): <imperative summary>"
```

Do **not** push, open a PR, or merge. Stop here.

## 5. Report back

Tell the user:

- The worktree path (`$WORKTREE`) and branch name (`agent/$SLUG`).
- What you implemented and what files changed.
- That the worktree is left in place so they can inspect/iterate. Ask whether they want to merge it back, and offer: squash merge, regular merge commit, or keep working.

Leave cleanup instructions for when they're done: `git worktree remove "$WORKTREE"` and `git branch -d "$BRANCH"` once merged.
