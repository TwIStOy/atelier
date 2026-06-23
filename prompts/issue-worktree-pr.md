---
description: Implement or fix a GitHub issue end-to-end in a fresh worktree, then open a PR
argument-hint: "<issue-number>"
---

Resolve GitHub issue **#$1** following this workflow. Do each step in order and stop only after the PR is opened.

## 1. Read the issue

Fetch and read the full issue so the goal is unambiguous:

```
gh issue view $1
```

Summarize the requirement/bug in 2-3 sentences before touching code. If anything is ambiguous, ask the user — do not guess.

## 2. Create a worktree

Derive a short slug from the issue title and create a worktree branching off the default branch (`master`). Put the worktree next to the repo:

```
DEFAULT_BRANCH=master
SLUG=$(gh issue view $1 --json title -q .title | sed -E 's/[^a-zA-Z0-9]+/-/g; s/^-+//; s/-+$//; s/.*/\L&/' | cut -c1-40)
BRANCH="pi/issue/$1-$SLUG"
WORKTREE="../$(basename "$(pwd)")-$1"
git fetch origin "$DEFAULT_BRANCH"
git worktree add "$WORKTREE" -b "$BRANCH" "origin/$DEFAULT_BRANCH"
```

All subsequent file edits, builds, and tests happen **inside `$WORKTREE`** — `cd` into it for every command that touches the tree.

## 3. Implement the fix or feature

Inside the worktree:

- Follow repo conventions: read `AGENTS.md`, relevant `docs/`, and sibling packages before adding code. Reuse `@htwang-contrib/common` where it fits.
- Implement the smallest correct change that satisfies the issue.
- Validate before committing: run the typecheck/build and tests the repo uses (`npx tsc --build`, `npm test`), and `npm run format`.

## 4. Commit

Stage and commit with a Conventional Commit message. Reference the issue so the PR links to it:

```
git add -A
git commit -m "<type>(<scope>): <imperative summary>" -m "Closes #$1"
```

Split into multiple focused commits if the change is naturally separable.

## 5. Push and open the PR

Push the branch and create the PR against `master`:

```
git push -u origin "$BRANCH"
gh pr create \
  --base "$DEFAULT_BRANCH" \
  --head "$BRANCH" \
  --title "<type>(<scope>): <imperative summary>" \
  --body "## Summary

What changed and why.

Closes #$1"
```

## 6. Report back

Post the PR URL plus a short list of what you implemented. Leave the worktree in place so the user can inspect it; tell them how to remove it later (`git worktree remove "$WORKTREE"`).
